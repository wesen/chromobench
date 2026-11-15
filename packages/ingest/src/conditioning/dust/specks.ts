// Dust detection in scanner density (guide §2.8, §5.11): goja-cv's SpeckBackground/DetectSpecks
// (kernels/specks.go 96–277) on the minimum-variance neutral plane, with a neutrality score: dust is an
// additive, equal bump in every channel (Δ = −log10(1 − a)), image detail and grain are not.
import type { Vec3 } from '@chromobench/contract';
import { boxMean, components, gaussianBlur, mad, medianOf, oddPad, smoothstep, squareClosing, squareOpening } from './kernels.ts';

export interface SpeckOptions {
  /** Largest speck, px² (goja-cv detect.specks default 200). */
  maxArea?: number;
  /** Smallest peak contrast, D (default 0.03). */
  minContrastD?: number;
  /** Detection threshold in noise σ (default 4). */
  k?: number;
  /** Use the neutrality factor in the score (default true; false is the broken variant of §8.4). */
  neutrality?: boolean;
}

export interface DustSpot {
  id: number;
  /** Centroid and equivalent radius, sensor px. */
  cx: number;
  cy: number;
  r: number;
  area: number;
  /** Pixel indices (row-major in the analysed plane). */
  pix: Int32Array;
  contrastD: number;
  localNoiseD: number;
  sharpness: number;
  neutrality: number;
  score: number;
  source: 'density' | 'ir';
}

export interface SpeckResult { spots: DustSpot[]; noiseD: number; threshD: number }

/** goja-cv SpeckBackground: σ=1 prefilter, two passes of trend (Gaussian 2r) + box(close(open(oddPad(g − trend)))). */
export function speckBackground(L: Float32Array, w: number, h: number, r: number): Float32Array {
  const g = gaussianBlur(L, w, h, 1);
  let src = g;
  let bg = g;
  for (let pass = 0; pass < 2; pass++) {
    const trend = gaussianBlur(src, w, h, 2 * r);
    const d = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) d[i] = g[i]! - trend[i]!;
    const p = 4 * r + (r >> 1) + 2;
    const { pad, pw, ph } = oddPad(d, w, h, p);
    const c = squareClosing(squareOpening(pad, pw, ph, r), pw, ph, r);
    const bm = boxMean(c, pw, ph, Math.max(1, r >> 1));
    bg = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) bg[y * w + x] = bm[(y + p) * pw + x + p]! + trend[y * w + x]!;
    src = bg;
  }
  return bg;
}

/** Minimum-variance estimate of a neutral bump: Σ D_k/σ_k² / Σ 1/σ_k². */
export function neutralPlane(D: Float32Array[], sigma: Vec3): Float32Array {
  const wts = sigma.map((s) => 1 / (s * s));
  const tot = wts[0]! + wts[1]! + wts[2]!;
  const n = D[0]!.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (wts[0]! * D[0]![i]! + wts[1]! * D[1]![i]! + wts[2]! * D[2]![i]!) / tot;
  return out;
}

/**
 * Detects dust in density planes D (three channels; or `ir`, an infrared density plane, which is used
 * instead of the neutral plane and skips neutrality). Dust is denser than its surround (positive residual).
 */
export function detectSpecks(D: Float32Array[], w: number, h: number, sigma: Vec3, o: SpeckOptions = {}, ir?: Float32Array): SpeckResult {
  const maxArea = o.maxArea ?? 200;
  const minC = o.minContrastD ?? 0.03;
  const k = o.k ?? 4;
  const useNeutral = o.neutrality ?? true;
  const L = ir ?? neutralPlane(D, sigma);
  const r = Math.max(2, Math.ceil(Math.sqrt(Math.max(maxArea, 1) / Math.PI)) + 2);
  const bg = speckBackground(L, w, h, r);
  const res = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) res[i] = L[i]! - bg[i]!;
  const [med, s0] = mad(res);
  for (let i = 0; i < w * h; i++) res[i]! -= med;
  const sig = Math.max(s0, 1e-5);
  const hi = Math.max(minC, k * sig);
  const lo = Math.max(hi / 2, 2.5 * sig);
  const fg = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) fg[i] = res[i]! >= lo ? 1 : 0;
  const cands = components(fg, w, h).filter((pix) => {
    if (pix.length > maxArea) return false;
    let peak = 0;
    for (const p of pix) peak = Math.max(peak, res[p]!);
    return peak >= hi;
  });
  const inSpeck = new Uint8Array(w * h);
  for (const c of cands) for (const p of c) inSpeck[p] = 1;
  const spots: DustSpot[] = [];
  for (const pix of cands) {
    let peak = 0, sum = 0, sx = 0, sy = 0;
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (const p of pix) {
      const x = p % w, y = (p / w) | 0;
      peak = Math.max(peak, res[p]!);
      sum += res[p]!;
      sx += x; sy += y;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const m = 3;
    const ring: number[] = [];
    const ringIdx: number[] = [];
    for (let y = Math.max(0, y0 - m); y <= Math.min(h - 1, y1 + m); y++) for (let x = Math.max(0, x0 - m); x <= Math.min(w - 1, x1 + m); x++) {
      const i = y * w + x;
      if (!inSpeck[i]) { ring.push(res[i]!); ringIdx.push(i); }
    }
    const local = ring.length >= 12 ? Math.max(mad(ring)[1], sig / 2) : sig;
    // Neutrality: each channel's mean excess over its ring median.
    let neutrality = 1;
    if (!ir) {
      const R = D.map((Dk) => {
        const base = medianOf(ringIdx.map((i) => Dk[i]!));
        let s = 0;
        for (const p of pix) s += Dk[p]! - base;
        return s / pix.length;
      });
      const mean = (R[0]! + R[1]! + R[2]!) / 3;
      neutrality = mean > 0 ? Math.max(0, 1 - (Math.max(...R) - Math.min(...R)) / mean) : 0;
    }
    const sharpness = sum / peak / pix.length;
    const snr = peak / Math.max(local, 1e-5);
    const score = smoothstep(k - 1, k + 4, snr) * smoothstep(0.33, 0.45, sharpness) * (ir || !useNeutral ? 1 : smoothstep(0.5, 0.8, neutrality));
    spots.push({
      id: spots.length + 1, cx: sx / pix.length, cy: sy / pix.length, r: Math.sqrt(pix.length / Math.PI), area: pix.length, pix,
      contrastD: peak, localNoiseD: local, sharpness, neutrality, score, source: ir ? 'ir' : 'density',
    });
  }
  return { spots, noiseD: sig, threshD: hi };
}

export interface DustCheck { count: number; verdict: 'clean' | 'light' | 'dusty'; scoreThreshold: number }

/** goja-cv check.dust: specks with score ≥ 0.5; clean (0), light (≤ 5), dusty. */
export function checkDust(r: SpeckResult, scoreThreshold = 0.5): DustCheck {
  const count = r.spots.filter((s) => s.score >= scoreThreshold).length;
  return { count, verdict: count === 0 ? 'clean' : count <= 5 ? 'light' : 'dusty', scoreThreshold };
}
