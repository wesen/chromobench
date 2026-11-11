// Streaming PNG writer for RGB at 16 bits (or 8 bits dithered from 16), ported from Chromogen export.js
// png16 (05-inline.js 3249–3274) and extended (guide §5.6): colour chunks by space (sRGB, iCCP, cICP),
// pHYs, iTXt metadata, and IDAT chunks emitted from a streaming compressor about every 1 MiB, so a
// 600 MB image never exists as one buffer. Samples are written big-endian (PNG-3 §7.2) through explicit
// byte writes, whatever the platform's endianness. Filter type 0 on every row, like the Studio.
import { crcFinish, crcUpdate } from './crc32.ts';
import { DeflateStream, deflateAll } from './deflate.ts';
import { ditherTo8 } from './quantise.ts';
import type { ByteSink } from './sinks.ts';

export const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

/** The colour chunks a PNG carries (the policy per space lives in spaces.ts). */
export interface PngColour {
  /** sRGB chunk with this rendering intent (0 perceptual … 3 absolute). */
  srgbIntent?: number;
  /** iCCP: profile name (1–79 Latin-1 bytes) and the profile bytes (compressed here). */
  icc?: { name: string; bytes: Uint8Array };
  /** cICP: ITU-T H.273 colour primaries, transfer, matrix (0 for RGB), full-range flag. */
  cicp?: readonly [number, number, number, number];
}

export interface PngOptions {
  width: number;
  height: number;
  /** 16 (default) or 8 (dithered from the 16-bit input). */
  bits?: 16 | 8;
  colour?: PngColour;
  /** pHYs in pixels per metre from dots per inch (300 dpi → 11,811). */
  dpi?: number;
  /** iTXt entries (UTF-8, uncompressed). */
  text?: Record<string, string>;
  /** Compressed bytes per IDAT chunk (default 1 MiB). */
  idatBytes?: number;
}

const latin1 = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0) & 255);

/** One PNG chunk: length, type, data, CRC over type + data. */
export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crcFinish(crcUpdate(out.subarray(4, 8 + data.length))));
  return out;
}

export const ppmFromDpi = (dpi: number): number => Math.round(dpi / 0.0254);

/** Rows are processed in batches of at most this many (bounds the filtered-row buffer). */
const BATCH_ROWS = 32;

export class Png16Writer {
  private y = 0;
  private pending: Uint8Array[] = [];
  private pendingN = 0;
  private done = false;
  private readonly bits: 16 | 8;
  private readonly idatBytes: number;
  private readonly sink: ByteSink;
  private readonly o: PngOptions;
  private readonly z: DeflateStream;
  private constructor(sink: ByteSink, o: PngOptions, z: DeflateStream) {
    this.sink = sink;
    this.o = o;
    this.z = z;
    this.bits = o.bits ?? 16;
    this.idatBytes = o.idatBytes ?? 1 << 20;
  }

  /** Writes the signature and every chunk before the image data. */
  static async open(sink: ByteSink, o: PngOptions): Promise<Png16Writer> {
    if (!(o.width > 0 && o.height > 0 && Number.isInteger(o.width) && Number.isInteger(o.height))) throw new RangeError(`bad PNG size ${o.width}×${o.height}`);
    const head: Uint8Array[] = [PNG_SIGNATURE];
    const ihdr = new Uint8Array(13);
    const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, o.width);
    dv.setUint32(4, o.height);
    ihdr[8] = o.bits ?? 16; // bit depth
    ihdr[9] = 2; // colour type: truecolour
    head.push(pngChunk('IHDR', ihdr));
    const c = o.colour ?? {};
    if (c.srgbIntent !== undefined && c.icc) throw new Error('PNG: iCCP and sRGB must not both be present (PNG-3 §4.3)');
    if (c.cicp) head.push(pngChunk('cICP', Uint8Array.from(c.cicp)));
    if (c.icc) {
      const name = latin1(c.icc.name.slice(0, 79));
      if (name.length < 1) throw new Error('PNG: iCCP needs a profile name');
      const z = await deflateAll(c.icc.bytes);
      const data = new Uint8Array(name.length + 2 + z.length);
      data.set(name, 0);
      data[name.length] = 0; // null separator
      data[name.length + 1] = 0; // compression method 0 (zlib)
      data.set(z, name.length + 2);
      head.push(pngChunk('iCCP', data));
    }
    if (c.srgbIntent !== undefined) head.push(pngChunk('sRGB', new Uint8Array([c.srgbIntent])));
    if (o.dpi) {
      const p = new Uint8Array(9);
      const pv = new DataView(p.buffer);
      pv.setUint32(0, ppmFromDpi(o.dpi));
      pv.setUint32(4, ppmFromDpi(o.dpi));
      p[8] = 1; // unit: metre
      head.push(pngChunk('pHYs', p));
    }
    for (const [k, v] of Object.entries(o.text ?? {})) head.push(pngChunk('iTXt', itxt(k, v)));
    for (const h of head) await sink.write(h);
    let w: Png16Writer | null = null;
    const z = new DeflateStream((u8) => w!.onCompressed(u8));
    w = new Png16Writer(sink, o, z);
    return w;
  }

  private async onCompressed(u8: Uint8Array): Promise<void> {
    this.pending.push(u8);
    this.pendingN += u8.length;
    if (this.pendingN >= this.idatBytes) await this.flushIdat();
  }

  private async flushIdat(): Promise<void> {
    if (!this.pendingN) return;
    const data = new Uint8Array(this.pendingN);
    let o = 0;
    for (const p of this.pending) { data.set(p, o); o += p.length; }
    this.pending = [];
    this.pendingN = 0;
    await this.sink.write(pngChunk('IDAT', data));
  }

  /** Rows written so far. */
  get rowsWritten(): number { return this.y; }

  /** Appends `rows` rows of interleaved RGB 16-bit values (native order in; big-endian out). */
  async writeRows(rgb16: Uint16Array, rows: number): Promise<void> {
    const W = this.o.width;
    if (this.done) throw new Error('PNG: writeRows after finish');
    if (rgb16.length < rows * W * 3) throw new RangeError(`PNG: ${rows} rows need ${rows * W * 3} samples, got ${rgb16.length}`);
    if (this.y + rows > this.o.height) throw new RangeError(`PNG: ${this.y + rows} rows exceed the height ${this.o.height}`);
    const bps = this.bits === 16 ? 2 : 1;
    const stride = 1 + W * 3 * bps;
    for (let r0 = 0; r0 < rows; r0 += BATCH_ROWS) {
      const n = Math.min(BATCH_ROWS, rows - r0);
      const out = new Uint8Array(n * stride); // fresh per batch: the compressor may still hold the last one
      for (let r = 0; r < n; r++) {
        const src = (r0 + r) * W * 3;
        let o = r * stride;
        out[o++] = 0; // filter type 0 (None)
        if (bps === 2) {
          for (let i = 0; i < W * 3; i++) {
            const v = rgb16[src + i]!;
            out[o++] = v >>> 8;
            out[o++] = v & 255;
          }
        } else {
          const y = this.y + r0 + r;
          for (let x = 0; x < W; x++) for (let k = 0; k < 3; k++) out[o++] = ditherTo8(rgb16[src + x * 3 + k]!, x, y, k);
        }
      }
      await this.z.write(out);
    }
    this.y += rows;
  }

  /** Flushes the compressor, writes the last IDAT and IEND. */
  async finish(): Promise<void> {
    if (this.y !== this.o.height) throw new Error(`PNG: ${this.y} of ${this.o.height} rows written`);
    this.done = true;
    await this.z.finish();
    await this.flushIdat();
    await this.sink.write(pngChunk('IEND', new Uint8Array(0)));
  }

  async abort(): Promise<void> {
    this.done = true;
    await this.z.abort();
  }
}

function itxt(keyword: string, text: string): Uint8Array {
  const k = latin1(keyword.slice(0, 79));
  const t = new TextEncoder().encode(text);
  // keyword \0 compression-flag compression-method language-tag \0 translated-keyword \0 text
  const out = new Uint8Array(k.length + 5 + t.length);
  out.set(k, 0);
  let o = k.length;
  out[o++] = 0;
  out[o++] = 0; // uncompressed
  out[o++] = 0; // method
  out[o++] = 0; // empty language tag
  out[o++] = 0; // empty translated keyword
  out.set(t, o);
  return out;
}

/** Reads a PNG's chunk list (type, data view) — for checks and tests. */
export function pngChunks(bytes: Uint8Array): { type: string; data: Uint8Array; crcOk: boolean }[] {
  const out: { type: string; data: Uint8Array; crcOk: boolean }[] = [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error('not a PNG');
  let p = 8;
  while (p + 12 <= bytes.length) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
    const data = bytes.subarray(p + 8, p + 8 + len);
    const crc = dv.getUint32(p + 8 + len);
    out.push({ type, data, crcOk: crcFinish(crcUpdate(bytes.subarray(p + 4, p + 8 + len))) === crc });
    p += 12 + len;
    if (type === 'IEND') break;
  }
  return out;
}
