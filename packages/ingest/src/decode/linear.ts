// RawImage → CameraLinear (guide §5.3, DR-1): native integer planes stay as they are and every read
// goes through a per-channel LUT, transfer((u − black) / (white − black)), with any DNG
// LinearizationTable folded in. Values are linear before anything averages them.
import type { Encoding } from '@chromobench/contract';
import { transferOf } from './encoding.ts';
import type { Plane, RawImage } from './types.ts';

export interface CameraLinear {
  readonly width: number;
  readonly height: number;
  /** 3 = RGB, 4 = RGB + infrared. Grey sources are read as three equal channels. */
  readonly channels: 3 | 4;
  readonly sha256: string;
  /** Linear values of channel c on sensor row y into out[0..width): 0 = black level, 1 = white level. */
  row(c: number, y: number, out: Float32Array | Float64Array): void;
  /** Per pixel: 1 if any channel reached its white level. */
  readonly clipped: Uint8Array | null;
  readonly clippedFraction: number;
}

export interface LineariseOptions {
  sha256: string;
  encoding?: Encoding;
  levels?: { black: number[]; white: number[] } | undefined;
  /** Keep a fourth (infrared) plane when the source has one (default true). */
  ir?: boolean | undefined;
}

export function linearise(img: RawImage, o: LineariseOptions): CameraLinear {
  const enc = o.encoding ?? img.encoding.value;
  const f = transferOf(enc);
  const black = o.levels?.black ?? img.levels.black;
  const white = o.levels?.white ?? img.levels.white;
  const { width: w, height: h } = img;
  const keepIr = img.channels === 4 && o.ir !== false;
  const channels: 3 | 4 = keepIr ? 4 : 3;
  const planeOf = (c: number): number => (img.channels === 1 ? 0 : c);
  const lvl = (arr: number[], c: number): number => arr[Math.min(planeOf(c), arr.length - 1)]!;
  const lin = img.meta.linearization;

  // One reader per channel.
  const readers: ((y: number, out: Float32Array | Float64Array) => void)[] = [];
  for (let c = 0; c < channels; c++) {
    const p = img.planes[planeOf(c)]!;
    const b = lvl(black, c);
    const span = lvl(white, c) - b || 1;
    if (img.sample === 'uint' && img.bits <= 16) {
      const n = 2 ** img.bits;
      const lut = new Float32Array(n);
      for (let u = 0; u < n; u++) {
        const v = lin ? lin[Math.min(u, lin.length - 1)]! : u;
        lut[u] = f((v - b) / span);
      }
      const q = p as Uint8Array | Uint16Array;
      readers.push((y, out) => {
        const o0 = y * w;
        for (let x = 0; x < w; x++) out[x] = lut[q[o0 + x]!]!;
      });
    } else {
      const q = p as Uint32Array | Float32Array;
      readers.push((y, out) => {
        const o0 = y * w;
        for (let x = 0; x < w; x++) out[x] = f((q[o0 + x]! - b) / span);
      });
    }
  }

  // Clipping: a stored sample at or above its white level.
  let clipped: Uint8Array | null = img.meta.clipped ?? null;
  let nClipped = 0;
  if (clipped) for (let i = 0; i < w * h; i++) nClipped += clipped[i]! ? 1 : 0;
  for (let c = 0; c < (img.meta.clipped ? 0 : Math.min(3, img.planes.length)); c++) {
    const p: Plane = img.planes[c]!;
    const wl = img.levels.white[Math.min(c, img.levels.white.length - 1)]!;
    const lim = o.levels?.white?.[c] ?? wl;
    for (let i = 0; i < w * h; i++) {
      const u = lin && img.sample === 'uint' ? lin[Math.min(p[i]!, lin.length - 1)]! : p[i]!;
      if (u >= lim) {
        clipped ??= new Uint8Array(w * h);
        if (!clipped[i]) nClipped++;
        clipped[i] = 1;
      }
    }
  }
  return {
    width: w, height: h, channels, sha256: o.sha256, clipped, clippedFraction: nClipped / (w * h),
    row: (c, y, out) => readers[c]!(y, out),
  };
}

/** A CameraLinear over in-memory linear values (interleaved RGB or RGBI), for synthetic frames and tests. */
export function cameraLinearFromInterleaved(width: number, height: number, data: Float32Array | Float64Array, channels: 3 | 4 = 3, sha256 = 'synthetic'): CameraLinear {
  if (data.length !== width * height * channels) throw new Error('cameraLinearFromInterleaved: data length mismatch');
  return {
    width, height, channels, sha256, clipped: null, clippedFraction: 0,
    row: (c, y, out) => {
      const o0 = y * width * channels + c;
      for (let x = 0; x < width; x++) out[x] = data[o0 + x * channels]!;
    },
  };
}

/** Reads a whole CameraLinear into interleaved Float32 (small images and tests only). */
export function toInterleaved(src: CameraLinear): Float32Array {
  const { width: w, height: h, channels: n } = src;
  const out = new Float32Array(w * h * n);
  const row = new Float32Array(w);
  for (let c = 0; c < n; c++) for (let y = 0; y < h; y++) {
    src.row(c, y, row);
    for (let x = 0; x < w; x++) out[(y * w + x) * n + c] = row[x]!;
  }
  return out;
}
