// A general TIFF/DNG writer for fixtures and tests (guide §7 stage 1 "fixture generator"): either byte
// order, 8/16/32-bit integer or 16/32-bit float samples, none/LZW/Deflate/PackBits, predictors 2 and 3,
// strips or tiles, chunky or planar, 1/3/4 samples, extra tags (DNG levels and colour), SubIFDs of
// type LONG or IFD. Also writes the M1 walking-skeleton TIFF (writeTiff16).
import { deflate, floatToHalf, lzwEncode, packbitsEncode } from './codecs.ts';
import type { Plane } from './types.ts';

export interface TagValue {
  tag: number;
  /** TIFF field type: 1 BYTE, 2 ASCII, 3 SHORT, 4 LONG, 5 RATIONAL, 8 SSHORT, 9 SLONG, 10 SRATIONAL, 11 FLOAT, 12 DOUBLE, 13 IFD. */
  type: number;
  values: number[] | string;
}

export interface TiffImageSpec {
  width: number;
  height: number;
  /** One plane per sample, row-major. */
  planes: Plane[] | number[][];
  bits: 8 | 16 | 32;
  sampleFormat?: 'uint' | 'float';
  compression?: 'none' | 'lzw' | 'deflate' | 'packbits';
  predictor?: 1 | 2 | 3;
  tile?: [number, number];
  rowsPerStrip?: number;
  planar?: boolean;
  photometric?: number;
  extraSamples?: number[];
  newSubfileType?: number;
  tags?: TagValue[];
}

export interface TiffFileSpec {
  littleEndian?: boolean;
  /** The main IFD chain. */
  images: TiffImageSpec[];
  /** SubIFDs of the first image. */
  subImages?: TiffImageSpec[];
  /** Field type of the SubIFDs tag: 4 (LONG, common) or 13 (IFD). */
  subIfdType?: 4 | 13;
  /** Extra tags on IFD0 only (DNGVersion, colour matrices …). */
  ifd0Tags?: TagValue[];
}

const SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 };

interface Entry { tag: number; type: number; count: number; values: number[] | string; pos?: number; fill?: 'blocks' | 'subifds' }
interface IfdLayout { entries: Entry[]; blocks: Uint8Array[]; pos: number; blockPos: number[]; sub: IfdLayout[] }

function encodeBlocks(img: TiffImageSpec, le: boolean): { blocks: Uint8Array[]; th: number; tw: number } {
  const { width: w, height: h, bits } = img;
  const spp = img.planes.length;
  const planar = !!img.planar;
  const isFloat = img.sampleFormat === 'float';
  const bps = bits / 8;
  const tw = img.tile ? img.tile[0] : w;
  const th = img.tile ? img.tile[1] : Math.min(h, img.rowsPerStrip ?? h);
  const across = Math.ceil(w / tw);
  const down = Math.ceil(h / th);
  const spPlane = planar ? 1 : spp;
  const blocks: Uint8Array[] = [];
  const pred = img.predictor ?? 1;
  for (let p = 0; p < (planar ? spp : 1); p++) {
    for (let bi = 0; bi < across * down; bi++) {
      const bx = img.tile ? (bi % across) * tw : 0;
      const by = img.tile ? Math.floor(bi / across) * th : bi * th;
      const rows = img.tile ? th : Math.min(th, h - by);
      const cols = img.tile ? tw : w;
      const n = rows * cols * spPlane;
      const vals = new Float64Array(n);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) for (let s = 0; s < spPlane; s++) {
        const x = bx + c;
        const y = by + r;
        const ch = planar ? p : s;
        vals[(r * cols + c) * spPlane + s] = x < w && y < h ? Number(img.planes[ch]![y * w + x]) : 0;
      }
      const raw = new Uint8Array(n * bps);
      const dv = new DataView(raw.buffer);
      if (pred === 3) {
        const nRow = cols * spPlane;
        const rowBytes = nRow * bps;
        const fb = new DataView(new ArrayBuffer(4));
        for (let r = 0; r < rows; r++) {
          const base = r * rowBytes;
          for (let i = 0; i < nRow; i++) {
            const v = vals[r * nRow + i]!;
            let be: number[];
            if (bps === 4) { fb.setFloat32(0, v, false); be = [fb.getUint8(0), fb.getUint8(1), fb.getUint8(2), fb.getUint8(3)]; }
            else { const hv = floatToHalf(v); be = [hv >> 8, hv & 255]; }
            for (let k = 0; k < bps; k++) raw[base + k * nRow + i] = be[k]!;
          }
          for (let i = rowBytes - 1; i >= spPlane; i--) raw[base + i] = (raw[base + i]! - raw[base + i - spPlane]!) & 255;
        }
      } else {
        const stored = new Float64Array(vals);
        if (pred === 2) {
          const mod = 2 ** bits;
          for (let r = 0; r < rows; r++) for (let i = cols * spPlane - 1; i >= spPlane; i--) {
            const q = r * cols * spPlane + i;
            stored[q] = (((vals[q]! - vals[q - spPlane]!) % mod) + mod) % mod;
          }
        }
        for (let i = 0; i < n; i++) {
          const v = stored[i]!;
          if (isFloat) { if (bps === 4) dv.setFloat32(i * 4, v, le); else dv.setUint16(i * 2, floatToHalf(v), le); }
          else if (bps === 1) dv.setUint8(i, v);
          else if (bps === 2) dv.setUint16(i * 2, v, le);
          else dv.setUint32(i * 4, v, le);
        }
      }
      const comp = img.compression ?? 'none';
      blocks.push(comp === 'lzw' ? lzwEncode(raw) : comp === 'deflate' ? deflate(raw) : comp === 'packbits' ? packbitsEncode(raw) : raw);
    }
  }
  return { blocks, th, tw };
}

function layoutImage(img: TiffImageSpec, le: boolean, extra: TagValue[]): IfdLayout {
  const { blocks, th, tw } = encodeBlocks(img, le);
  const spp = img.planes.length;
  const comp = { none: 1, lzw: 5, deflate: 8, packbits: 32773 }[img.compression ?? 'none'];
  const e: Entry[] = [];
  const add = (tag: number, type: number, values: number[] | string): void => {
    e.push({ tag, type, count: typeof values === 'string' ? values.length + 1 : values.length, values });
  };
  if (img.newSubfileType !== undefined) add(254, 4, [img.newSubfileType]);
  add(256, 4, [img.width]);
  add(257, 4, [img.height]);
  add(258, 3, new Array<number>(spp).fill(img.bits));
  add(259, 3, [comp]);
  add(262, 3, [img.photometric ?? (spp >= 3 ? 2 : 1)]);
  const offTag = img.tile ? 324 : 273;
  const cntTag = img.tile ? 325 : 279;
  e.push({ tag: offTag, type: 4, count: blocks.length, values: new Array<number>(blocks.length).fill(0), fill: 'blocks' });
  add(277, 3, [spp]);
  if (!img.tile) add(278, 4, [th]);
  add(cntTag, 4, blocks.map((b) => b.length));
  add(284, 3, [img.planar ? 2 : 1]);
  if ((img.predictor ?? 1) !== 1) add(317, 3, [img.predictor!]);
  if (img.tile) { add(322, 4, [tw]); add(323, 4, [th]); }
  if (img.extraSamples) add(338, 3, img.extraSamples);
  add(339, 3, new Array<number>(spp).fill(img.sampleFormat === 'float' ? 3 : 1));
  for (const t of [...(img.tags ?? []), ...extra]) add(t.tag, t.type, t.values);
  e.sort((a, b) => a.tag - b.tag);
  return { entries: e, blocks, pos: 0, blockPos: [], sub: [] };
}

export function writeTiff(spec: TiffFileSpec): Uint8Array {
  const le = spec.littleEndian ?? true;
  const main = spec.images.map((img, i) => layoutImage(img, le, i === 0 ? spec.ifd0Tags ?? [] : []));
  const subs = (spec.subImages ?? []).map((img) => layoutImage(img, le, []));
  if (subs.length) {
    main[0]!.entries.push({ tag: 330, type: spec.subIfdType ?? 4, count: subs.length, values: new Array<number>(subs.length).fill(0), fill: 'subifds' });
    main[0]!.entries.sort((a, b) => a.tag - b.tag);
    main[0]!.sub = subs;
  }
  const all = [...main, ...subs];
  // Layout: header, then per IFD: directory, overflow values, blocks.
  let pos = 8;
  const even = (): void => { pos += pos & 1; };
  for (const L of all) {
    even();
    L.pos = pos;
    pos += 2 + 12 * L.entries.length + 4;
    for (const en of L.entries) {
      const size = SIZE[en.type]! * en.count;
      if (size > 4) { even(); en.pos = pos; pos += size; }
    }
    for (const b of L.blocks) { even(); L.blockPos.push(pos); pos += b.length; }
  }
  for (const L of all) for (const en of L.entries) {
    if (en.fill === 'blocks') en.values = L.blockPos;
    if (en.fill === 'subifds') en.values = L.sub.map((s) => s.pos);
  }
  const out = new Uint8Array(pos);
  const dv = new DataView(out.buffer);
  out.set(le ? [0x49, 0x49, 42, 0] : [0x4d, 0x4d, 0, 42]);
  dv.setUint32(4, main[0]!.pos, le);
  const writeVal = (p: number, type: number, v: number): void => {
    switch (type) {
      case 1: case 7: dv.setUint8(p, v); break;
      case 6: dv.setInt8(p, v); break;
      case 3: dv.setUint16(p, v, le); break;
      case 8: dv.setInt16(p, v, le); break;
      case 4: case 13: dv.setUint32(p, v, le); break;
      case 9: dv.setInt32(p, v, le); break;
      case 5: { const d = 1_000_000; dv.setUint32(p, Math.round(v * d), le); dv.setUint32(p + 4, d, le); break; }
      case 10: { const d = 1_000_000; dv.setInt32(p, Math.round(v * d), le); dv.setInt32(p + 4, d, le); break; }
      case 11: dv.setFloat32(p, v, le); break;
      case 12: dv.setFloat64(p, v, le); break;
    }
  };
  all.forEach((L, i) => {
    dv.setUint16(L.pos, L.entries.length, le);
    L.entries.forEach((en, k) => {
      const e = L.pos + 2 + 12 * k;
      dv.setUint16(e, en.tag, le);
      dv.setUint16(e + 2, en.type, le);
      dv.setUint32(e + 4, en.count, le);
      const at = en.pos ?? e + 8;
      if (en.pos !== undefined) dv.setUint32(e + 8, en.pos, le);
      if (typeof en.values === 'string') for (let j = 0; j < en.values.length; j++) out[at + j] = en.values.charCodeAt(j);
      else en.values.forEach((v, j) => writeVal(at + j * SIZE[en.type]!, en.type, v));
    });
    const next = i < main.length - 1 ? main[i + 1]!.pos : 0; // SubIFDs end their own chain
    dv.setUint32(L.pos + 2 + 12 * L.entries.length, next, le);
    L.blocks.forEach((b, j) => out.set(b, L.blockPos[j]!));
  });
  return out;
}

/**
 * An uncompressed little-endian 16-bit RGB TIFF in one strip, from interleaved codes. Byte-identical to
 * the mock engine's former writer (packages/engine-mock/src/tiff16.ts), so the checked-in M1 fixture
 * (fixtures/synthetic/m1-negative-96x64.tif) does not change.
 */
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
