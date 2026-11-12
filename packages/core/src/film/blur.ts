// Separable Gaussian blurs for the film stage's spatial effects (f64 reference; CHB-012 guide §5.4).
// Boundary: scipy 'reflect' (half-sample symmetric), as spektrafilm's filters.

/**
 * fast_exponential_filter's three-Gaussian fit of e^(−r/λ)/(2πλ²): (amplitude, σ/λ). Upstream's
 * amplitudes sum to 0.9999; core divides by that sum so a uniform field stays exactly uniform.
 */
const EXP_RAW: readonly (readonly [number, number])[] = [[0.1633, 0.536], [0.6496, 1.5236], [0.187, 2.7684]];
const EXP_SUM = EXP_RAW.reduce((a, [w]) => a + w, 0);
export const EXP_GAUSSIANS: readonly (readonly [number, number])[] = EXP_RAW.map(([w, r]) => [w / EXP_SUM, r] as const);

// ---- separable Gaussian blur, f64 reference (reflect boundary, truncated at 4σ, normalised) ----

/** Normalised Gaussian taps for σ px (radius ⌈4σ⌉); σ ≤ 0: identity. */
export function filmGaussianTaps(sigma: number, truncate = 4): Float64Array {
  if (!(sigma > 0)) return Float64Array.of(1);
  const R = Math.max(1, Math.ceil(truncate * sigma));
  const t = new Float64Array(2 * R + 1);
  let s = 0;
  for (let i = -R; i <= R; i++) { const v = Math.exp(-0.5 * (i / sigma) ** 2); t[i + R] = v; s += v; }
  for (let i = 0; i < t.length; i++) t[i]! /= s;
  return t;
}

/** scipy 'reflect' (half-sample symmetric) index. */
const refl = (i: number, n: number): number => {
  if (n === 1) return 0;
  const p = 2 * n;
  let m = ((i % p) + p) % p;
  if (m >= n) m = p - 1 - m;
  return m;
};

/** Blur channel k of an interleaved c-channel image with σ px (per channel), in place into `out`. */
export function blurField(src: Float64Array, w: number, h: number, c: number, sigmas: readonly number[]): Float64Array {
  const tmp = new Float64Array(src.length);
  const out = new Float64Array(src.length);
  for (let k = 0; k < c; k++) {
    const taps = filmGaussianTaps(sigmas[k] ?? 0);
    const R = (taps.length - 1) / 2;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let a = 0;
      for (let i = -R; i <= R; i++) a += taps[i + R]! * src[(y * w + refl(x + i, w)) * c + k]!;
      tmp[(y * w + x) * c + k] = a;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let a = 0;
      for (let i = -R; i <= R; i++) a += taps[i + R]! * tmp[(refl(y + i, h) * w + x) * c + k]!;
      out[(y * w + x) * c + k] = a;
    }
  }
  return out;
}

/** Σ_g w_g ⊙ (G_{σ_g} ∗ src), per channel weights and σ (px). */
export function gaussianKernelSum(src: Float64Array, w: number, h: number, c: number, terms: readonly { w: readonly number[]; sigma: readonly number[] }[]): Float64Array {
  const out = new Float64Array(src.length);
  for (const t of terms) {
    const b = t.sigma.some((s) => s > 0) ? blurField(src, w, h, c, t.sigma) : src;
    for (let i = 0; i < src.length; i++) out[i]! += t.w[i % c]! * b[i]!;
  }
  return out;
}

