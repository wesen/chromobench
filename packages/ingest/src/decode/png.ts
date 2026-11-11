// PNG decoder for 8- and 16-bit grey/RGB(A), a port of Chromogen's decodePNG (05-inline.js 2336–2388)
// that also reads the colour chunks (sRGB, gAMA, iCCP) and chromobench's own tEXt key, so the encoding
// follows the evidence table of guide §5.2 instead of always being sRGB (bug 2). Plus a writer for fixtures.
import { deflate, inflate } from './codecs.ts';
import { chooseEncoding, parseChromobenchMeta, type ColourEvidence } from './encoding.ts';
import { formatError } from './errors.ts';
import type { Encoding, Plane, RawImage } from './types.ts';

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

export function isPng(b: Uint8Array): boolean {
  return b.length >= 8 && SIG.every((v, i) => b[i] === v);
}

export interface PngChunk { type: string; data: Uint8Array }

export function readChunks(bytes: Uint8Array): PngChunk[] {
  if (!isPng(bytes)) formatError('not a PNG file');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: PngChunk[] = [];
  let p = 8;
  while (p + 12 <= bytes.length) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(bytes[p + 4]!, bytes[p + 5]!, bytes[p + 6]!, bytes[p + 7]!);
    if (p + 12 + len > bytes.length) formatError(`PNG: chunk ${type} runs past the end of the file`);
    out.push({ type, data: bytes.subarray(p + 8, p + 8 + len) });
    p += 12 + len;
    if (type === 'IEND') break;
  }
  return out;
}

const latin1 = (b: Uint8Array): string => {
  let s = '';
  for (const c of b) s += String.fromCharCode(c);
  return s;
};

export function decodePng(bytes: Uint8Array, o: { declaredEncoding?: Encoding } = {}): RawImage {
  const chunks = readChunks(bytes);
  const ihdr = chunks[0];
  if (!ihdr || ihdr.type !== 'IHDR' || ihdr.data.length < 13) formatError('PNG: missing IHDR');
  const hv = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, 13);
  const w = hv.getUint32(0);
  const h = hv.getUint32(4);
  const depth = ihdr.data[8]!;
  const ctype = ihdr.data[9]!;
  if (ihdr.data[12]) formatError('interlaced PNG is not supported', 'Re-save the PNG without Adam7 interlacing.');
  if (ctype === 3) formatError('palette PNG is not supported');
  const nch = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[ctype];
  if (!nch) formatError(`PNG colour type ${ctype} is not valid`);
  if (depth !== 8 && depth !== 16) formatError(`PNG bit depth ${depth} is not supported (8 and 16 are)`);

  const ev: ColourEvidence = {};
  const idat: Uint8Array[] = [];
  for (const c of chunks) {
    if (c.type === 'IDAT') idat.push(c.data);
    else if (c.type === 'sRGB') ev.srgbChunk = true;
    else if (c.type === 'gAMA' && c.data.length >= 4) ev.gama = new DataView(c.data.buffer, c.data.byteOffset, 4).getUint32(0);
    else if (c.type === 'iCCP') ev.iccp = true;
    else if (c.type === 'tEXt' || c.type === 'iTXt') {
      const s = latin1(c.data);
      const z = s.indexOf('\0');
      const key = s.slice(0, z);
      if (key.startsWith('chromobench')) {
        const m = parseChromobenchMeta(`${key}=${s.slice(z + 1).replace(/^[\0-\x1f]*/, '')}`) ?? parseChromobenchMeta(s.slice(z + 1).replace(/\0/g, ''));
        if (m) ev.metadata = m;
      }
    }
  }
  const all = new Uint8Array(idat.reduce((s, a) => s + a.length, 0));
  let off = 0;
  for (const a of idat) { all.set(a, off); off += a.length; }
  const raw = inflate(all);
  const bpp = (nch * depth) / 8;
  const stride = w * bpp;
  if (raw.length < h * (stride + 1)) formatError(`PNG: image data holds ${raw.length} bytes, needs ${h * (stride + 1)}`);
  const colour = nch >= 3 ? 3 : 1;
  const planes: Plane[] = Array.from({ length: colour }, () => (depth === 16 ? new Uint16Array(w * h) : new Uint8Array(w * h)));
  let cur = new Uint8Array(stride);
  let prev = new Uint8Array(stride);
  let ip = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[ip++]!;
    if (f > 4) formatError(`PNG: filter type ${f} on row ${y}`);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp]! : 0;
      const b = prev[i]!;
      const c = i >= bpp ? prev[i - bpp]! : 0;
      let v = raw[ip + i]!;
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 255;
    }
    ip += stride;
    for (let x = 0; x < w; x++) for (let k = 0; k < colour; k++) {
      const q = x * bpp + (k * depth) / 8;
      planes[k]![y * w + x] = depth === 16 ? (cur[q]! << 8) | cur[q + 1]! : cur[q]!;
    }
    [prev, cur] = [cur, prev];
  }
  const enc = chooseEncoding({ format: 'png', bits: depth, sample: 'uint', evidence: ev, declared: o.declaredEncoding });
  const max = 2 ** depth - 1;
  return {
    width: w, height: h, channels: colour as 1 | 3, planes, sample: 'uint', bits: depth as 8 | 16,
    levels: { black: new Array<number>(colour).fill(0), white: new Array<number>(colour).fill(max), from: 'default' },
    encoding: { value: enc.value, evidence: enc.evidence },
    meta: { format: 'png', cfa: 'none', notes: enc.notes },
  };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const p of parts) for (const b of p) c = CRC_TABLE[(c ^ b) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface PngWriteOptions {
  width: number;
  height: number;
  /** One plane per channel (1 grey, 3 RGB, 4 RGBA). */
  planes: Plane[] | number[][];
  bits: 8 | 16;
  /** Extra chunks: sRGB, gAMA (×100000), iCCP (a dummy profile), tEXt chromobench encoding. */
  srgb?: boolean;
  gama?: number;
  iccp?: boolean;
  chromobenchEncoding?: Encoding;
  /** Filter type used on every row (0–4). */
  filter?: 0 | 1 | 2 | 3 | 4;
}

export function writePng(o: PngWriteOptions): Uint8Array {
  const { width: w, height: h, bits } = o;
  const nch = o.planes.length;
  const ctype = nch === 1 ? 0 : nch === 2 ? 4 : nch === 3 ? 2 : 6;
  const bpp = (nch * bits) / 8;
  const stride = w * bpp;
  const raw = new Uint8Array(h * (stride + 1));
  const f = o.filter ?? 0;
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const row = new Uint8Array(stride);
    for (let x = 0; x < w; x++) for (let k = 0; k < nch; k++) {
      const v = Number(o.planes[k]![y * w + x]);
      const q = x * bpp + (k * bits) / 8;
      if (bits === 16) { row[q] = v >> 8; row[q + 1] = v & 255; } else row[q] = v;
    }
    raw[y * (stride + 1)] = f;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp]! : 0;
      const b = prev[i]!;
      const c = i >= bpp ? prev[i - bpp]! : 0;
      let pred = 0;
      if (f === 1) pred = a;
      else if (f === 2) pred = b;
      else if (f === 3) pred = (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      raw[y * (stride + 1) + 1 + i] = (row[i]! - pred) & 255;
    }
    prev = row;
  }
  const chunks: [string, Uint8Array][] = [];
  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, w);
  iv.setUint32(4, h);
  ihdr.set([bits, ctype, 0, 0, 0], 8);
  chunks.push(['IHDR', ihdr]);
  if (o.srgb) chunks.push(['sRGB', Uint8Array.of(0)]);
  if (o.gama !== undefined) {
    const g = new Uint8Array(4);
    new DataView(g.buffer).setUint32(0, o.gama);
    chunks.push(['gAMA', g]);
  }
  if (o.iccp) chunks.push(['iCCP', Uint8Array.from([...'icc'].map((c) => c.charCodeAt(0)).concat([0, 0], [...deflate(new Uint8Array(16))]))]);
  if (o.chromobenchEncoding) chunks.push(['tEXt', Uint8Array.from([...`chromobench:encoding\0${o.chromobenchEncoding}`].map((c) => c.charCodeAt(0)))]);
  chunks.push(['IDAT', deflate(raw)]);
  chunks.push(['IEND', new Uint8Array(0)]);
  const total = 8 + chunks.reduce((s, [, d]) => s + 12 + d.length, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out.set(SIG);
  let p = 8;
  for (const [type, data] of chunks) {
    const t = Uint8Array.from([...type].map((c) => c.charCodeAt(0)));
    dv.setUint32(p, data.length);
    out.set(t, p + 4);
    out.set(data, p + 8);
    dv.setUint32(p + 8 + data.length, crc32([t, data]));
    p += 12 + data.length;
  }
  return out;
}
