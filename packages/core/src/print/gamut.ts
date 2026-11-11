// Gamut knee and output compression (§2.7, spektrafilm utils/gamut_compression.py).
// The knee is the LAST colour operation before encoding: a gain after it leaves the cube again.
// Decision (guide §5.4): OkLCh compression with spektrafilm's knee parameters; cam16-ucs later.
import { mulMV, type Mat3, type Vec3 } from '../spectral/linalg.ts';

/** Reinhard knee: identity below t, asymptotic to l. d' = t + s·n/(1 + n^p)^(1/p), n = (d − t)/s, s = l − t. */
export function knee(d: number, t: number, l: number, p: number): number {
  if (d <= t) return d;
  const s = l - t;
  const n = (d - t) / s;
  return t + (s * n) / (1 + n ** p) ** (1 / p);
}

// OKLab (Ottosson) from linear sRGB.
const M1: Mat3 = [[0.4122214708, 0.5363325363, 0.0514459929], [0.2119034982, 0.6806995451, 0.1073969566], [0.0883024619, 0.2817188376, 0.6299787005]];
const M2: Mat3 = [[0.2104542553, 0.793617785, -0.0040720468], [1.9779984951, -2.428592205, 0.4505937099], [0.0259040371, 0.7827717662, -0.808675766]];
const M2I: Mat3 = [[1, 0.3963377774, 0.2158037573], [1, -0.1055613458, -0.0638541728], [1, -0.0894841775, -1.291485548]];
const M1I: Mat3 = [[4.0767416621, -3.3077115913, 0.2309699292], [-1.2684380046, 2.6097574011, -0.3413193965], [-0.0041960863, -0.7034186147, 1.707614701]];

export function rgbToOklab(rgb: ArrayLike<number>): Vec3 {
  const lms = mulMV(M1, rgb).map(Math.cbrt);
  return mulMV(M2, lms);
}
export function oklabToRgb(lab: ArrayLike<number>): Vec3 {
  const lms = mulMV(M2I, lab).map((v) => v * v * v);
  return mulMV(M1I, lms);
}

const inCube = (rgb: Vec3, eps = 1e-9): boolean => rgb.every((v) => v >= -eps && v <= 1 + eps);

/** Largest in-gamut chroma at (L, h) by bisection. */
function maxChroma(L: number, h: number): number {
  let lo = 0;
  let hi = 0.5;
  const ca = Math.cos(h);
  const sa = Math.sin(h);
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (inCube(oklabToRgb([L, m * ca, m * sa]))) lo = m;
    else hi = m;
  }
  return lo;
}

export interface CompressSpec {
  algorithm: 'oklch' | 'clip' | 'tanh-shoulder';
  chroma: [number, number, number];
  lightness: [number, number, number];
}
export const DEFAULT_COMPRESS: CompressSpec = { algorithm: 'oklch', chroma: [0, 1, 6], lightness: [0.7, 1, 2.2] };

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Linear RGB → linear RGB inside [0, 1]³. */
export function compressOutput(rgbLin: ArrayLike<number>, spec: CompressSpec = DEFAULT_COMPRESS): Vec3 {
  const rgb: Vec3 = [rgbLin[0]!, rgbLin[1]!, rgbLin[2]!];
  if (spec.algorithm === 'clip') return rgb.map(clamp01) as Vec3;
  if (spec.algorithm === 'tanh-shoulder') {
    // Chromogen's per-channel shoulder above 0.82 (shifts hue; kept for comparison).
    return rgb.map((v) => clamp01(v <= 0.82 ? v : 0.82 + 0.18 * Math.tanh((v - 0.82) / 0.18))) as Vec3;
  }
  const [L0, a, b] = rgbToOklab(rgb);
  if (!Number.isFinite(L0) || L0 <= 0) return [0, 0, 0];
  const L = Math.min(knee(L0, spec.lightness[0], spec.lightness[1], spec.lightness[2]), 1);
  const C = Math.hypot(a, b);
  const h = Math.atan2(b, a);
  let out: Vec3;
  if (L >= 1) out = [1, 1, 1];
  else {
    const Cmax = maxChroma(L, h);
    const Cn = Cmax > 0 ? Cmax * knee(C / Cmax, spec.chroma[0], spec.chroma[1], spec.chroma[2]) : 0;
    out = oklabToRgb([L, Cn * Math.cos(h), Cn * Math.sin(h)]);
  }
  // Bisection leaves |overshoot| ≤ 1e-9; the clamp only removes round-off, it is not a gain.
  return out.map(clamp01) as Vec3;
}
