// Temporary reader and writer for uncompressed baseline TIFF (8/16-bit, 1 or 3 samples, chunky).
// Lives here until CHB-006's decoders land; only the M1 walking skeleton needs it.
import { ChromobenchError } from '@chromobench/contract';

export interface RawImage {
  width: number;
  height: number;
  samples: 1 | 3;
  bits: 8 | 16;
  /** Interleaved samples, row-major. */
  data: Uint16Array;
}

const bad = (msg: string): never => {
  throw new ChromobenchError({ code: 'E_FORMAT', message: `TIFF: ${msg}`, hint: 'The mock reads uncompressed 8/16-bit RGB or grey TIFF only (CHB-006 brings real decoders).' });
};

export function isTiff(b: Uint8Array): boolean {
  return b.length >= 8 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 42 && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 42));
}

export function readTiff(bytes: Uint8Array): RawImage {
  if (!isTiff(bytes)) bad('not a TIFF file');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const le = bytes[0] === 0x49;
  const u16 = (o: number): number => dv.getUint16(o, le);
  const u32 = (o: number): number => dv.getUint32(o, le);
  const ifd = u32(4);
  const n = u16(ifd);
  const tags = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    const tag = u16(e);
    const type = u16(e + 2);
    const count = u32(e + 4);
    const size = type === 3 ? 2 : type === 4 ? 4 : type === 1 ? 1 : 0;
    if (!size) continue;
    const inline = size * count <= 4;
    const base = inline ? e + 8 : u32(e + 8);
    const vals: number[] = [];
    for (let k = 0; k < count; k++) vals.push(size === 2 ? u16(base + 2 * k) : size === 4 ? u32(base + 4 * k) : dv.getUint8(base + k));
    tags.set(tag, vals);
  }
  const one = (t: number, def?: number): number => tags.get(t)?.[0] ?? def ?? bad(`missing tag ${t}`);
  const width = one(256);
  const height = one(257);
  const samples = one(277, 1);
  const bits = one(258, 1);
  if (one(259, 1) !== 1) bad('compressed TIFF');
  if (one(284, 1) !== 1) bad('planar TIFF');
  if (samples !== 1 && samples !== 3) bad(`${samples} samples per pixel`);
  if (bits !== 8 && bits !== 16) bad(`${bits} bits per sample`);
  const offsets = tags.get(273) ?? bad('no strip offsets');
  const counts = tags.get(279) ?? bad('no strip byte counts');
  const total = width * height * samples;
  const data = new Uint16Array(total);
  let k = 0;
  for (let s = 0; s < offsets.length && k < total; s++) {
    const off = offsets[s]!;
    const len = counts[s]!;
    if (off + len > bytes.length) bad('strip beyond end of file');
    const step = bits / 8;
    for (let p = 0; p < len && k < total; p += step) data[k++] = bits === 16 ? u16(off + p) : dv.getUint8(off + p);
  }
  if (k !== total) bad('truncated pixel data');
  return { width, height, samples: samples as 1 | 3, bits: bits as 8 | 16, data };
}

/** Writes an uncompressed little-endian 16-bit RGB TIFF in one strip. */
export function writeTiff16(width: number, height: number, rgb: Uint16Array): Uint8Array {
  if (rgb.length !== width * height * 3) throw new Error('writeTiff16: data length mismatch');
  const entries: [number, number, number, number][] = []; // tag, type, count, value/offset
  const nTags = 10;
  const ifdOff = 8;
  const ifdSize = 2 + nTags * 12 + 4;
  const bpsOff = ifdOff + ifdSize;
  const dataOff = bpsOff + 6;
  const dataLen = rgb.length * 2;
  entries.push([256, 3, 1, width], [257, 3, 1, height], [258, 3, 3, bpsOff], [259, 3, 1, 1], [262, 3, 1, 2], [273, 4, 1, dataOff], [277, 3, 1, 3], [278, 3, 1, height], [279, 4, 1, dataLen], [284, 3, 1, 1]);
  const out = new Uint8Array(dataOff + dataLen);
  const dv = new DataView(out.buffer);
  out.set([0x49, 0x49, 42, 0]);
  dv.setUint32(4, ifdOff, true);
  dv.setUint16(ifdOff, nTags, true);
  entries.forEach(([tag, type, count, val], i) => {
    const e = ifdOff + 2 + i * 12;
    dv.setUint16(e, tag, true);
    dv.setUint16(e + 2, type, true);
    dv.setUint32(e + 4, count, true);
    if (type === 3 && count === 1) dv.setUint16(e + 8, val, true);
    else dv.setUint32(e + 8, val, true);
  });
  dv.setUint32(ifdOff + 2 + nTags * 12, 0, true);
  for (let i = 0; i < 3; i++) dv.setUint16(bpsOff + 2 * i, 16, true);
  for (let i = 0; i < rgb.length; i++) dv.setUint16(dataOff + 2 * i, rgb[i]!, true);
  return out;
}
