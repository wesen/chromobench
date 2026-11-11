// Test helpers for @chromobench/output.
import type { DirHandleLike, FileHandleLike, WritableLike } from '../src/encode/sinks.ts';
import { bundledProfile } from '../src/spaces.ts';

/** In-memory stand-in for an OPFS directory (enough for ProfileLibrary and opfsSink). */
export function memoryDir(): DirHandleLike & { files: Map<string, Uint8Array>; dirs: Map<string, DirHandleLike> } {
  const files = new Map<string, Uint8Array>();
  const dirs = new Map<string, DirHandleLike>();
  const fileHandle = (name: string): FileHandleLike => ({
    name,
    async createWritable() {
      let buf = new Uint8Array(0);
      let pos = 0;
      const put = (data: Uint8Array, at: number) => {
        if (at + data.length > buf.length) { const nb = new Uint8Array(at + data.length); nb.set(buf); buf = nb; }
        buf.set(data, at);
        pos = at + data.length;
      };
      const w: WritableLike = {
        async write(d) {
          if (d instanceof Uint8Array) put(d, pos);
          else if (ArrayBuffer.isView(d)) put(new Uint8Array(d.buffer, d.byteOffset, d.byteLength), pos);
          else if (d instanceof ArrayBuffer) put(new Uint8Array(d), pos);
          else if (d.type === 'write') put(d.data instanceof Uint8Array ? d.data : new Uint8Array(d.data as ArrayBuffer), d.position);
          else pos = d.position;
        },
        async close() { files.set(name, buf); },
        async abort() { /* nothing committed */ },
      };
      return w;
    },
    async getFile() {
      const b = files.get(name);
      if (!b) throw new Error(`NotFoundError: ${name}`);
      return new File([b as Uint8Array<ArrayBuffer>], name);
    },
  });
  const dir: DirHandleLike & { files: Map<string, Uint8Array>; dirs: Map<string, DirHandleLike> } = {
    files, dirs,
    async getDirectoryHandle(name, o) {
      let d = dirs.get(name);
      if (!d) {
        if (!o?.create) throw new Error(`NotFoundError: ${name}`);
        d = memoryDir();
        dirs.set(name, d);
      }
      return d;
    },
    async getFileHandle(name, o) {
      if (!files.has(name) && !o?.create) throw new Error(`NotFoundError: ${name}`);
      return fileHandle(name);
    },
    async removeEntry(name) { files.delete(name); },
  };
  return dir;
}

/**
 * The synthetic narrow-gamut "printer" of guide §8: the sRGB v4 profile with its class set to 'prtr',
 * its colorants pulled 20 % towards white (D50) and its profile ID cleared. A valid matrix/TRC output
 * profile that lcms accepts in both directions.
 */
export function syntheticPrinterProfile(pull = 0.2): Uint8Array {
  const b = bundledProfile('sRGB-v4').slice();
  const dv = new DataView(b.buffer);
  b.set([0x70, 0x72, 0x74, 0x72], 12); // 'prtr'
  b.fill(0, 84, 100); // profile ID (MD5) not computed
  const n = dv.getUint32(128);
  const tags = new Map<string, number>();
  for (let i = 0; i < n; i++) tags.set(String.fromCharCode(...b.subarray(132 + 12 * i, 136 + 12 * i)), dv.getUint32(136 + 12 * i));
  const off = (s: string) => tags.get(s)!;
  const get = (s: string) => [0, 1, 2].map((k) => dv.getInt32(off(s) + 8 + 4 * k) / 65536);
  const cols = ['rXYZ', 'gXYZ', 'bXYZ'].map(get);
  const white = [0, 1, 2].map((k) => cols[0]![k]! + cols[1]![k]! + cols[2]![k]!);
  // pulling every primary towards the white by `pull` keeps their sum the white
  cols.forEach((c, j) => {
    const s = ['rXYZ', 'gXYZ', 'bXYZ'][j]!;
    for (let k = 0; k < 3; k++) dv.setInt32(off(s) + 8 + 4 * k, Math.round(((1 - pull) * c[k]! + (pull * white[k]!) / 3) * 65536));
  });
  // a recognisable description is not needed; the class is what the library checks
  return b;
}
