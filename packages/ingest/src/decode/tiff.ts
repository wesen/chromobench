// TIFF and LinearRaw DNG decoder: a port of Chromogen's decodeTIFF (05-inline.js 2259–2335) with the
// bugs of guide §4.2 fixed and goja-cv's strictness (decode_tiff.go 352–467): every unsupported
// feature is E_FORMAT naming it; CFA and JPEG-compressed DNGs are handed to LibRaw (NeedsLibRaw).
//
// Fixes over Chromogen: 2**bits − 1 for 32-bit integers; IEEE half floats; predictor 3 and predictor 2
// on 32-bit integers undone; signed and SRATIONAL tag types and type 13 (IFD) read; a fourth sample
// kept as infrared; blocks decoded into fresh buffers (never into the caller's file); short strips and
// tiles refused; DNG BlackLevel/WhiteLevel/LinearizationTable/ActiveArea/DefaultCrop and colour tags
// read; the Orientation tag reported.
import { halfToFloat, inflate, lzwDecode, packbitsDecode } from './codecs.ts';
import { chooseEncoding, parseChromobenchMeta } from './encoding.ts';
import { formatError, NeedsLibRaw } from './errors.ts';
import type { Diagnostic } from '@chromobench/contract';
import type { DngColour, Encoding, Plane, RawImage } from './types.ts';

/** Byte size per TIFF field type (1 BYTE … 13 IFD; 16–18 BigTIFF types are refused with the file). */
export const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 };

export interface Ifd {
  offset: number;
  tags: Map<number, number[]>;
  strings: Map<number, string>;
  types: Map<number, number>;
}

export const T = {
  NewSubfileType: 254, ImageWidth: 256, ImageLength: 257, BitsPerSample: 258, Compression: 259,
  Photometric: 262, ImageDescription: 270, Make: 271, Model: 272, StripOffsets: 273, Orientation: 274,
  SamplesPerPixel: 277, RowsPerStrip: 278, StripByteCounts: 279, PlanarConfig: 284, Predictor: 317,
  TileWidth: 322, TileLength: 323, TileOffsets: 324, TileByteCounts: 325, SubIFDs: 330, ExtraSamples: 338,
  SampleFormat: 339, DNGVersion: 50706, UniqueCameraModel: 50708, LinearizationTable: 50712,
  BlackLevelRepeatDim: 50713, BlackLevel: 50714, BlackLevelDeltaH: 50715, BlackLevelDeltaV: 50716,
  WhiteLevel: 50717, DefaultCropOrigin: 50719, DefaultCropSize: 50720, ColorMatrix1: 50721, ColorMatrix2: 50722,
  CameraCalibration1: 50723, CameraCalibration2: 50724, AnalogBalance: 50727, AsShotNeutral: 50728,
  AsShotWhiteXY: 50729, BaselineExposure: 50730, CalibrationIlluminant1: 50778, CalibrationIlluminant2: 50779,
  ActiveArea: 50829, ForwardMatrix1: 50964, ForwardMatrix2: 50965,
} as const;

export const PHOTOMETRIC = { WhiteIsZero: 0, BlackIsZero: 1, RGB: 2, Palette: 3, CFA: 32803, LinearRaw: 34892 } as const;

export function isTiff(b: Uint8Array): boolean {
  return b.length >= 8 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 42 && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 42));
}

class Reader {
  readonly dv: DataView;
  readonly le: boolean;
  readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.le = bytes[0] === 0x49;
  }
  u16 = (o: number): number => this.dv.getUint16(o, this.le);
  u32 = (o: number): number => this.dv.getUint32(o, this.le);

  readIfd(off: number): Ifd & { next: number } {
    const len = this.bytes.length;
    if (off + 2 > len) formatError(`TIFF: IFD offset ${off} beyond end of file`);
    const n = this.u16(off);
    if (off + 2 + 12 * n + 4 > len) formatError(`TIFF: IFD at ${off} with ${n} entries is truncated`);
    const tags = new Map<number, number[]>();
    const strings = new Map<number, string>();
    const types = new Map<number, number>();
    const dv = this.dv;
    const le = this.le;
    for (let i = 0; i < n; i++) {
      const e = off + 2 + 12 * i;
      const tag = this.u16(e);
      const type = this.u16(e + 2);
      const count = this.u32(e + 4);
      const size = TYPE_SIZE[type];
      if (!size) continue; // unknown type: skip, as the TIFF spec requires
      const total = size * count;
      const at = total <= 4 ? e + 8 : this.u32(e + 8);
      if (at + total > len) continue; // dangling value: ignored like an unknown tag
      types.set(tag, type);
      if (type === 2) {
        let s = '';
        for (let k = 0; k < count; k++) {
          const c = this.bytes[at + k]!;
          if (c === 0) break;
          s += String.fromCharCode(c);
        }
        strings.set(tag, s);
        continue;
      }
      const vals = new Array<number>(count);
      for (let k = 0; k < count; k++) {
        const p = at + k * size;
        switch (type) {
          case 1: case 7: vals[k] = dv.getUint8(p); break;
          case 6: vals[k] = dv.getInt8(p); break;
          case 3: vals[k] = dv.getUint16(p, le); break;
          case 8: vals[k] = dv.getInt16(p, le); break;
          case 4: case 13: vals[k] = dv.getUint32(p, le); break;
          case 9: vals[k] = dv.getInt32(p, le); break;
          case 5: { const d = dv.getUint32(p + 4, le); vals[k] = d ? dv.getUint32(p, le) / d : 0; break; }
          case 10: { const d = dv.getInt32(p + 4, le); vals[k] = d ? dv.getInt32(p, le) / d : 0; break; }
          case 11: vals[k] = dv.getFloat32(p, le); break;
          case 12: vals[k] = dv.getFloat64(p, le); break;
        }
      }
      tags.set(tag, vals);
    }
    return { offset: off, tags, strings, types, next: this.u32(off + 2 + 12 * n) };
  }
}

/** Every IFD of the file: the main chain and their SubIFDs (two levels), in file order. */
export function readIfds(bytes: Uint8Array): Ifd[] {
  if (!isTiff(bytes)) {
    if (bytes.length >= 4 && (bytes[2] === 43 || bytes[3] === 43)) formatError('BigTIFF is not supported');
    formatError('not a TIFF file');
  }
  const r = new Reader(bytes);
  const out: Ifd[] = [];
  const seen = new Set<number>();
  const visit = (off: number, depth: number): void => {
    if (!off || seen.has(off) || seen.size > 256) return;
    seen.add(off);
    const d = r.readIfd(off);
    out.push(d);
    if (depth < 2) for (const s of d.tags.get(T.SubIFDs) ?? []) visit(s, depth + 1);
  };
  let off = r.u32(4);
  let guard = 0;
  while (off && guard++ < 64) {
    if (seen.has(off)) break;
    visit(off, 0);
    off = r.readIfd(off).next;
  }
  if (!out.length) formatError('TIFF: no image file directory');
  return out;
}

const one = (d: Ifd, tag: number, def?: number): number => {
  const v = d.tags.get(tag)?.[0];
  if (v !== undefined) return v;
  if (def !== undefined) return def;
  return formatError(`TIFF: missing required tag ${tag}`);
};

/** Picks the image to decode: the full-resolution LinearRaw or CFA image of a DNG, else the largest full-resolution IFD. */
export function chooseImage(ifds: Ifd[]): Ifd {
  const full = ifds.filter((t) => t.tags.has(T.ImageWidth) && t.tags.has(T.ImageLength) && !((t.tags.get(T.NewSubfileType)?.[0] ?? 0) & 1));
  const area = (t: Ifd): number => one(t, T.ImageWidth) * one(t, T.ImageLength);
  const pool = full.length ? full : ifds.filter((t) => t.tags.has(T.ImageWidth));
  if (!pool.length) formatError('TIFF: no IFD with an image');
  const raw = pool.filter((t) => [PHOTOMETRIC.LinearRaw, PHOTOMETRIC.CFA].includes((t.tags.get(T.Photometric)?.[0] ?? -1) as 32803));
  const cands = raw.length ? raw : pool;
  return [...cands].sort((a, b) => {
    const la = (a.tags.get(T.Photometric)?.[0] === PHOTOMETRIC.LinearRaw ? 1 : 0) - (b.tags.get(T.Photometric)?.[0] === PHOTOMETRIC.LinearRaw ? 1 : 0);
    return la ? -la : area(b) - area(a);
  })[0]!;
}

export interface TiffDecodeOptions {
  declaredEncoding?: Encoding;
}

const COMPRESSION_NAMES: Record<number, string> = { 2: 'CCITT RLE', 3: 'CCITT G3', 4: 'CCITT G4', 6: 'old-style JPEG', 7: 'JPEG', 34892: 'lossy JPEG', 52546: 'JPEG XL', 34887: 'LERC', 50000: 'ZSTD', 50001: 'WebP' };

export function decodeTiff(bytes: Uint8Array, o: TiffDecodeOptions = {}): RawImage {
  const ifds = readIfds(bytes);
  const isDng = ifds.some((t) => t.tags.has(T.DNGVersion));
  const d = chooseImage(ifds);
  const r = new Reader(bytes);
  const notes: Diagnostic[] = [];

  let w = one(d, T.ImageWidth);
  let h = one(d, T.ImageLength);
  const spp = one(d, T.SamplesPerPixel, 1);
  const bitsArr = d.tags.get(T.BitsPerSample) ?? [1];
  const bits = bitsArr[0]!;
  if (bitsArr.some((b) => b !== bits)) formatError(`TIFF: mixed bits per sample (${bitsArr.join(', ')})`);
  const comp = one(d, T.Compression, 1);
  const pred = one(d, T.Predictor, 1);
  const fmt = d.tags.get(T.SampleFormat)?.[0] ?? 1;
  const planar = one(d, T.PlanarConfig, 1);
  const photometric = one(d, T.Photometric, spp >= 3 ? 2 : 1);

  if (photometric === PHOTOMETRIC.CFA) {
    if (isDng) throw new NeedsLibRaw('DNG with a CFA (mosaic) image');
    formatError('TIFF holds an undemosaiced CFA mosaic', 'Export a demosaiced linear TIFF or DNG, or open the camera RAW file.');
  }
  if (isDng && [7, 34892, 52546].includes(comp)) throw new NeedsLibRaw(`DNG with ${COMPRESSION_NAMES[comp]} compression`);
  if (![1, 5, 8, 32946, 32773].includes(comp)) formatError(`TIFF compression ${COMPRESSION_NAMES[comp] ?? comp} is not supported (none, LZW, Deflate and PackBits are)`);
  if (photometric === PHOTOMETRIC.Palette) formatError('palette TIFF is not supported');
  if (photometric === PHOTOMETRIC.WhiteIsZero) formatError('WhiteIsZero TIFF is not supported');
  if (![PHOTOMETRIC.BlackIsZero, PHOTOMETRIC.RGB, PHOTOMETRIC.LinearRaw].includes(photometric as 1)) formatError(`TIFF photometric interpretation ${photometric} is not supported (YCbCr, CMYK, CIELab and LogLuv are not)`);
  if (fmt === 2) formatError('signed-integer TIFF samples are not supported');
  if (fmt !== 1 && fmt !== 3) formatError(`TIFF SampleFormat ${fmt} is not supported`);
  if (fmt === 1 && ![8, 16, 32].includes(bits)) formatError(`TIFF with ${bits}-bit integer samples is not supported (8, 16 and 32 are)`);
  if (fmt === 3 && bits !== 16 && bits !== 32) formatError(`TIFF with ${bits}-bit float samples is not supported (16 and 32 are)`);
  if (spp < 1 || spp > 4) formatError(`TIFF with ${spp} samples per pixel is not supported`);
  if (pred !== 1 && pred !== 2 && pred !== 3) formatError(`TIFF predictor ${pred} is not supported`);
  if (pred === 2 && fmt === 3) formatError('TIFF predictor 2 on floating-point samples is not supported');
  if (pred === 3 && fmt !== 3) formatError('TIFF predictor 3 on integer samples is invalid');

  // Which stored samples become channels.
  const extra = d.tags.get(T.ExtraSamples) ?? [];
  const isGrey = photometric === PHOTOMETRIC.BlackIsZero || (photometric === PHOTOMETRIC.LinearRaw && spp < 3);
  const colour = isGrey ? 1 : 3;
  if (spp < colour) formatError(`TIFF: ${spp} samples per pixel for a ${isGrey ? 'grey' : 'colour'} image`);
  let keep = colour;
  let irPlane: number | undefined;
  if (!isGrey && spp === 4) {
    const kind = extra[0] ?? 0;
    // ExtraSamples 1/2 is alpha (dropped); 0 or absent is kept as an infrared plane (Chromogen dropped it).
    if (kind !== 1 && kind !== 2) {
      keep = 4;
      irPlane = 3;
    }
  }

  const bps = bits / 8;
  const tiled = d.tags.has(T.TileWidth);
  const tw = tiled ? one(d, T.TileWidth) : w;
  const th = tiled ? one(d, T.TileLength) : Math.min(h, one(d, T.RowsPerStrip, h) || h);
  const offs = d.tags.get(tiled ? T.TileOffsets : T.StripOffsets) ?? formatError(`TIFF: no ${tiled ? 'tile' : 'strip'} offsets`);
  const cnts = d.tags.get(tiled ? T.TileByteCounts : T.StripByteCounts) ?? formatError(`TIFF: no ${tiled ? 'tile' : 'strip'} byte counts`);
  const spPlane = planar === 2 ? 1 : spp;
  const across = Math.ceil(w / tw);
  const blocksPerPlane = tiled ? across * Math.ceil(h / th) : Math.ceil(h / th);
  const nPlanes = planar === 2 ? spp : 1;
  if (offs.length < blocksPerPlane * nPlanes || cnts.length < offs.length) formatError(`TIFF: ${offs.length} ${tiled ? 'tiles' : 'strips'} for an image needing ${blocksPerPlane * nPlanes}`);

  const isFloat = fmt === 3;
  const outBits = (isFloat ? 32 : bits) as 8 | 16 | 32;
  const mk = (): Plane => (isFloat ? new Float32Array(w * h) : bits === 8 ? new Uint8Array(w * h) : bits === 16 ? new Uint16Array(w * h) : new Uint32Array(w * h));
  let planes: Plane[] = Array.from({ length: keep }, mk);

  for (let b = 0; b < blocksPerPlane * nPlanes; b++) {
    const plane = Math.floor(b / blocksPerPlane);
    const bi = b % blocksPerPlane;
    const bx = tiled ? (bi % across) * tw : 0;
    const by = tiled ? Math.floor(bi / across) * th : bi * th;
    const rows = tiled ? th : Math.min(th, h - by);
    const cols = tiled ? tw : w;
    const expected = rows * cols * spPlane * bps;
    const off = offs[b]!;
    const cnt = cnts[b]!;
    if (off + cnt > bytes.length) formatError(`TIFF: ${tiled ? 'tile' : 'strip'} ${b} runs past the end of the file`);
    const src = bytes.subarray(off, off + cnt);
    let data: Uint8Array;
    if (comp === 1) {
      if (cnt < expected) formatError(`TIFF: ${tiled ? 'tile' : 'strip'} ${b} holds ${cnt} bytes, needs ${expected}`);
      data = src.slice(0, expected); // a copy: predictors never write into the caller's buffer
    } else if (comp === 5) data = lzwDecode(src, expected);
    else if (comp === 32773) data = packbitsDecode(src, expected);
    else {
      data = inflate(src);
      if (data.length < expected) formatError(`TIFF: deflate ${tiled ? 'tile' : 'strip'} ${b} holds ${data.length} bytes, needs ${expected}`);
    }
    const n = rows * cols * spPlane;
    const bdv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const le = r.le;
    let vals: Uint8Array | Uint16Array | Uint32Array | Float32Array;
    if (pred === 3) {
      // Adobe TIFF Technical Note 3: per row, bytes are differenced with a stride of spPlane, then
      // stored by significance (most significant byte of every sample first).
      const rowBytes = cols * spPlane * bps;
      const nRow = cols * spPlane;
      const f = new Float32Array(n);
      const tmp = new Uint8Array(rowBytes);
      const fb = new DataView(new ArrayBuffer(4));
      for (let rr = 0; rr < rows; rr++) {
        const base = rr * rowBytes;
        for (let i = spPlane; i < rowBytes; i++) data[base + i] = (data[base + i]! + data[base + i - spPlane]!) & 255;
        for (let i = 0; i < nRow; i++) for (let k = 0; k < bps; k++) tmp[i * bps + k] = data[base + k * nRow + i]!;
        for (let i = 0; i < nRow; i++) {
          if (bps === 4) {
            for (let k = 0; k < 4; k++) fb.setUint8(k, tmp[i * 4 + k]!);
            f[rr * nRow + i] = fb.getFloat32(0, false);
          } else f[rr * nRow + i] = halfToFloat((tmp[i * 2]! << 8) | tmp[i * 2 + 1]!);
        }
      }
      vals = f;
    } else if (isFloat) {
      const f = new Float32Array(n);
      for (let i = 0; i < n; i++) f[i] = bps === 4 ? bdv.getFloat32(i * 4, le) : halfToFloat(bdv.getUint16(i * 2, le));
      vals = f;
    } else if (bps === 1) vals = data.subarray(0, n);
    else if (bps === 2) {
      const u = new Uint16Array(n);
      for (let i = 0; i < n; i++) u[i] = bdv.getUint16(i * 2, le);
      vals = u;
    } else {
      const u = new Uint32Array(n);
      for (let i = 0; i < n; i++) u[i] = bdv.getUint32(i * 4, le);
      vals = u;
    }
    if (pred === 2) {
      for (let rr = 0; rr < rows; rr++) {
        const base = rr * cols * spPlane;
        for (let i = spPlane; i < cols * spPlane; i++) vals[base + i] = vals[base + i]! + vals[base + i - spPlane]!; // typed arrays wrap modulo 2^bits
      }
    }
    for (let rr = 0; rr < rows; rr++) {
      const y = by + rr;
      if (y >= h) break;
      for (let c = 0; c < cols; c++) {
        const x = bx + c;
        if (x >= w) break;
        for (let s = 0; s < spPlane; s++) {
          const ch = planar === 2 ? plane : s;
          if (ch >= keep) continue;
          planes[ch]![y * w + x] = vals[(rr * cols + c) * spPlane + s]!;
        }
      }
    }
  }

  // Levels: defaults, then DNG tags.
  const white0 = isFloat ? 1 : 2 ** bits - 1; // 2 ** 32 − 1, not (1 << 32) − 1 = 0 (Chromogen bug)
  let black = new Array<number>(keep).fill(0);
  let white = new Array<number>(keep).fill(white0);
  let from: RawImage['levels']['from'] = 'default';
  let linearization: number[] | undefined;
  let defaultCrop: RawImage['meta']['defaultCrop'];
  if (isDng) {
    const bl = d.tags.get(T.BlackLevel);
    if (bl) {
      const [rr, cc] = d.tags.get(T.BlackLevelRepeatDim) ?? [1, 1];
      const period = (rr ?? 1) * (cc ?? 1);
      black = Array.from({ length: keep }, (_, ch) => {
        const sIdx = Math.min(ch, spp - 1);
        let s = 0;
        let m = 0;
        for (let p = 0; p < period; p++) {
          const v = bl[(p * spp + sIdx) % bl.length];
          if (v !== undefined) { s += v; m++; }
        }
        return m ? s / m : 0;
      });
      if (period > 1) notes.push({ code: 'W_DECODE_NOTE', message: `DNG BlackLevelRepeatDim ${rr}×${cc}: the pattern's mean black level is used per channel.` });
      from = 'file';
    }
    if (d.tags.has(T.BlackLevelDeltaH) || d.tags.has(T.BlackLevelDeltaV)) notes.push({ code: 'W_DECODE_NOTE', message: 'DNG BlackLevelDeltaH/V are ignored.' });
    const wl = d.tags.get(T.WhiteLevel);
    if (wl) {
      white = Array.from({ length: keep }, (_, ch) => wl[Math.min(ch, wl.length - 1)]!);
      from = 'file';
    }
    linearization = d.tags.get(T.LinearizationTable);
    const aa = d.tags.get(T.ActiveArea);
    if (aa && aa.length === 4) {
      const [top, left, bottom, right] = aa as [number, number, number, number];
      if (top > 0 || left > 0 || bottom < h || right < w) {
        if (!(top >= 0 && left >= 0 && bottom <= h && right <= w && bottom > top && right > left)) formatError(`DNG ActiveArea [${aa.join(', ')}] outside the ${w}×${h} image`);
        const nw = right - left;
        const nh = bottom - top;
        planes = planes.map((p) => {
          const q = new (p.constructor as new (n: number) => Plane)(nw * nh);
          for (let y = 0; y < nh; y++) q.set(p.subarray((y + top) * w + left, (y + top) * w + right) as never, y * nw);
          return q;
        });
        w = nw;
        h = nh;
      }
    }
    const co = d.tags.get(T.DefaultCropOrigin);
    const cs = d.tags.get(T.DefaultCropSize);
    if (co && cs) defaultCrop = { x: co[0]!, y: co[1]!, w: cs[0]!, h: cs[1]! };
  }

  // Metadata: IFD0 carries the DNG colour tags and the camera; the chosen IFD may be a SubIFD.
  const ifd0 = ifds[0]!;
  const tagOf = (tag: number): number[] | undefined => d.tags.get(tag) ?? ifd0.tags.get(tag);
  const str = (tag: number): string | undefined => d.strings.get(tag) ?? ifd0.strings.get(tag);
  const dng = isDng ? dngColourOf(tagOf) : undefined;
  const make = str(T.Make);
  const model = str(T.Model) ?? str(T.UniqueCameraModel);
  const orientation = tagOf(T.Orientation)?.[0];
  const desc = str(T.ImageDescription);
  const metaEnc = desc ? parseChromobenchMeta(desc) : undefined;
  const enc = chooseEncoding({
    format: isDng ? 'dng' : 'tiff', bits, sample: isFloat ? 'float' : 'uint',
    evidence: metaEnc ? { metadata: metaEnc } : {}, declared: o.declaredEncoding,
  });
  notes.push(...enc.notes);

  const meta: RawImage['meta'] = { format: isDng ? 'dng' : 'tiff', cfa: 'none', notes };
  if (orientation !== undefined) meta.orientationTag = orientation;
  if (make || model) meta.camera = { make: make ?? '', model: model ?? '' };
  if (dng) meta.dng = dng;
  if (defaultCrop) meta.defaultCrop = defaultCrop;
  if (linearization) meta.linearization = linearization;
  if (irPlane !== undefined) meta.irPlane = irPlane;
  return {
    width: w, height: h, channels: keep as 1 | 3 | 4, planes, sample: isFloat ? 'float' : 'uint', bits: outBits,
    levels: { black, white, from }, encoding: { value: enc.value, evidence: enc.evidence }, meta,
  };
}

/** DNG colour tags from a tag lookup (the chosen IFD first, then IFD0). */
export function dngColourOf(tagOf: (tag: number) => number[] | undefined): DngColour {
  const dng: DngColour = {};
  const set = <K extends keyof DngColour>(k: K, tag: number, f: (v: number[]) => DngColour[K]): void => {
    const v = tagOf(tag);
    if (v) dng[k] = f(v);
  };
  set('colorMatrix1', T.ColorMatrix1, (v) => v);
  set('colorMatrix2', T.ColorMatrix2, (v) => v);
  set('cameraCalibration1', T.CameraCalibration1, (v) => v);
  set('cameraCalibration2', T.CameraCalibration2, (v) => v);
  set('forwardMatrix1', T.ForwardMatrix1, (v) => v);
  set('forwardMatrix2', T.ForwardMatrix2, (v) => v);
  set('analogBalance', T.AnalogBalance, (v) => v);
  set('asShotNeutral', T.AsShotNeutral, (v) => v);
  set('asShotWhiteXY', T.AsShotWhiteXY, (v) => [v[0]!, v[1]!]);
  set('baselineExposure', T.BaselineExposure, (v) => v[0]);
  set('calibrationIlluminant1', T.CalibrationIlluminant1, (v) => v[0]);
  set('calibrationIlluminant2', T.CalibrationIlluminant2, (v) => v[0]);
  return dng;
}

/** DNG colour tags of a DNG file (any image type, including CFA), or null for other files. */
export function readDngColour(bytes: Uint8Array): DngColour | null {
  if (!isTiff(bytes)) return null;
  const ifds = readIfds(bytes);
  if (!ifds.some((t) => t.tags.has(T.DNGVersion))) return null;
  return dngColourOf((tag) => ifds.find((d) => d.tags.has(tag))?.tags.get(tag));
}
