// Density noise σ (guide §2.6, §5.9; textbook §1.7): a port of Chromogen's sigmaD (05-inline.js
// 2508–2537). Each pixel's density is compared with the leave-one-out mean of its (2R+1)² box, from
// f64 summed-area tables; σ = 1.4826 × the median departure. σ is measured at the scale it is used (DR-8).
import type { Box, Diagnostic, Vec3 } from '@chromobench/contract';
import type { CameraLinear } from '../decode/linear.ts';
import { region, type RegionOptions } from './resample.ts';

export const MAD_K = 1.4826;

/** Median of a typed array (sorts a copy). */
export function median(a: Float64Array | Float32Array): number {
  const s = Float64Array.from(a).sort();
  return s[s.length >> 1]!;
}

/** 1.4826 · median |x − median(x)|. */
export function madSigma(a: ArrayLike<number>): number {
  const x = Float64Array.from(a);
  const m = median(x);
  for (let i = 0; i < x.length; i++) x[i] = Math.abs(x[i]! - m);
  return MAD_K * median(x);
}

/**
 * σ per channel of D_k = −log10(T_k / Treb_k) over interleaved RGB `rgb` (w×h). Pixels with keep(i)
 * false are excluded from boxes and departures. Boxes with fewer than 9 kept pixels are skipped; fewer
 * than 60 departures gives null. Floor 1e-4. `f32Tables` is the deliberately broken variant (§8.4).
 */
export function sigmaD(rgb: Float32Array, w: number, h: number, Treb: Vec3, keep: ((i: number) => boolean) | null = null, R = 4, f32Tables = false, stride = 3): Vec3 | null {
  const out: number[] = [];
  const Table = f32Tables ? Float32Array : Float64Array;
  for (let k = 0; k < 3; k++) {
    const D = new Float64Array(w * h);
    const m = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      D[i] = -Math.log10(Math.max(rgb[stride * i + k]!, 1e-6) / Treb[k]!);
      m[i] = !keep || keep(i) ? 1 : 0;
    }
    const W1 = w + 1;
    const S = new Table(W1 * (h + 1));
    const C = new Table(W1 * (h + 1));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const q = (y + 1) * W1 + x + 1;
      S[q] = (m[i] ? D[i]! : 0) + S[q - 1]! + S[q - W1]! - S[q - W1 - 1]!;
      C[q] = m[i]! + C[q - 1]! + C[q - W1]! - C[q - W1 - 1]!;
    }
    const box = (T: Float32Array | Float64Array, x0: number, y0: number, x1: number, y1: number): number =>
      T[y1 * W1 + x1]! - T[y0 * W1 + x1]! - T[y1 * W1 + x0]! + T[y0 * W1 + x0]!;
    const dev = new Float64Array(w * h);
    let nd = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!m[i]) continue;
      const x0 = Math.max(0, x - R);
      const y0 = Math.max(0, y - R);
      const x1 = Math.min(w, x + R + 1);
      const y1 = Math.min(h, y + R + 1);
      const n = box(C, x0, y0, x1, y1);
      if (n < 9) continue;
      const mu = (box(S, x0, y0, x1, y1) - D[i]!) / (n - 1);
      dev[nd++] = Math.abs(D[i]! - mu);
    }
    if (nd < 60) return null;
    const d = dev.subarray(0, nd).sort();
    out.push(Math.max(1e-4, MAD_K * d[nd >> 1]!));
  }
  return out as Vec3;
}

export interface NoiseEstimate {
  sigma: Vec3;
  from: 'rebate' | 'frame' | 'assumed';
  /** Output pixels per source pixel. */
  scale: number;
  /** Size of the image the σ belongs to. */
  size: [number, number];
  notes: Diagnostic[];
}

/**
 * Chromogen's Source.noise (2608–2621): the rebate box at this scale, else thin frame pixels
 * (D < 0.08 in every channel) of `frame`, else 0.01 × min(1, scale) with W_SIGMA_ASSUMED.
 */
export function noiseAtScale(src: CameraLinear, Treb: Vec3, scale: number, frame: { rgb: Float32Array; w: number; h: number }, rebateBox: Box | null, cond: RegionOptions = {}): NoiseEstimate {
  const size: [number, number] = [frame.w, frame.h];
  if (rebateBox) {
    const bw = Math.max(2, Math.round(rebateBox.w * scale));
    const bh = Math.max(2, Math.round(rebateBox.h * scale));
    const s = sigmaD(region(src, rebateBox, bw, bh, { ...cond, channels: 3 }), bw, bh, Treb);
    if (s) return { sigma: s, from: 'rebate', scale, size, notes: [] };
  }
  const { rgb, w, h } = frame;
  const thin = (i: number): boolean => {
    for (let k = 0; k < 3; k++) if (-Math.log10(Math.max(rgb[3 * i + k]!, 1e-6) / Treb[k]!) > 0.08) return false;
    return true;
  };
  const s = sigmaD(rgb, w, h, Treb, thin);
  if (s) return { sigma: s, from: 'frame', scale, size, notes: [] };
  const v = 0.01 * Math.min(1, scale);
  return { sigma: [v, v, v], from: 'assumed', scale, size, notes: [{ code: 'W_SIGMA_ASSUMED', message: `Too few thin pixels to measure noise; σ = ${v.toFixed(4)} D assumed.`, hint: 'Pick a rebate box.' }] };
}

/**
 * The textbook's shadow floor (Figure 3.4): the 1st percentile of each channel's density in bands of
 * bandPx columns (or rows), counted from the given side of the frame.
 */
export function shadowFloor(rgb: Float32Array, w: number, h: number, Treb: Vec3, bandPx = 25, from: 'left' | 'right' | 'top' | 'bottom' = 'left', p = 0.01): { band: number; p01: Vec3 }[] {
  const along = from === 'left' || from === 'right' ? w : h;
  const nb = Math.floor(along / bandPx);
  const out: { band: number; p01: Vec3 }[] = [];
  for (let b = 0; b < nb; b++) {
    const lo = b * bandPx;
    const p01: number[] = [];
    for (let k = 0; k < 3; k++) {
      const vals: number[] = [];
      for (let t = lo; t < lo + bandPx; t++) {
        const pos = from === 'right' || from === 'bottom' ? along - 1 - t : t;
        const across = from === 'left' || from === 'right' ? h : w;
        for (let a = 0; a < across; a++) {
          const i = from === 'left' || from === 'right' ? a * w + pos : pos * w + a;
          vals.push(-Math.log10(Math.max(rgb[3 * i + k]!, 1e-6) / Treb[k]!));
        }
      }
      const s = Float64Array.from(vals).sort();
      p01.push(s[Math.floor(p * s.length)]!);
    }
    out.push({ band: b, p01: p01 as Vec3 });
  }
  return out;
}
