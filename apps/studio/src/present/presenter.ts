// Presenter interface (guide §5.6). The engine encodes values for the display; the presenter only
// places them: viewport transform, before/after split, the stage around the print.
import type { Box, SampleData } from '@chromobench/contract';

export interface PresentImage {
  width: number;
  height: number;
  channels: number;
  data: SampleData;
  /** Document region the image covers, and engine pixels per document pixel. */
  region: Box;
  scale: number;
}

export interface ViewTransform {
  /** Document size (pixels of the source frame). */
  docW: number;
  docH: number;
  /** Document point at the canvas centre and CSS px per document px. */
  cx: number;
  cy: number;
  zoom: number;
  dpr: number;
  /** Split position as a fraction of the canvas width (before on the left), or null. */
  split: number | null;
}

export interface Colours { stage: [number, number, number]; frame: [number, number, number] }

export interface Presenter {
  readonly kind: 'webgpu' | '2d';
  readonly colorSpace: 'display-p3' | 'srgb';
  readonly format: string;
  setImages(main: PresentImage, before: PresentImage | null): void;
  draw(view: ViewTransform, colours: Colours): void;
  /** Test hook: the 8-bit value presented for one document pixel, read back from the GPU path. */
  readDocPixel(x: number, y: number): Promise<number[] | null>;
  dispose(): void;
}

/** Interleaved samples → RGBA (1 → grey, 4 → first three). */
export function toRgba(img: PresentImage): Float32Array {
  const n = img.width * img.height;
  const out = new Float32Array(n * 4);
  const c = img.channels;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) out[i * 4 + k] = img.data[i * c + Math.min(k, c - 1)]!;
    out[i * 4 + 3] = 1;
  }
  return out;
}

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
/** IEEE half from a float (round to nearest even), for rgba16float uploads. */
export function toHalf(v: number): number {
  f32[0] = v;
  const x = u32[0]!;
  const sign = (x >>> 16) & 0x8000;
  let exp = ((x >>> 23) & 0xff) - 127 + 15;
  let mant = x & 0x7fffff;
  if (exp >= 0x1f) return sign | 0x7c00 | (((x >>> 23) & 0xff) === 0xff && mant ? 0x200 : 0);
  if (exp <= 0) {
    if (exp < -10) return sign;
    mant |= 0x800000;
    const shift = 14 - exp;
    const half = mant >>> shift;
    const rem = mant & ((1 << shift) - 1);
    const mid = 1 << (shift - 1);
    return sign | (half + (rem > mid || (rem === mid && half & 1) ? 1 : 0));
  }
  const half = sign | (exp << 10) | (mant >>> 13);
  const rem = mant & 0x1fff;
  return half + (rem > 0x1000 || (rem === 0x1000 && half & 1) ? 1 : 0);
}

export function fromHalf(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >>> 10) & 0x1f;
  const m = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (m / 1024);
  if (e === 0x1f) return m ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + m / 1024);
}
