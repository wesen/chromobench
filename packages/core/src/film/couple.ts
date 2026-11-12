// DIR coupling (CHB-012 guide §2.6, §5.3; textbook §2.3; spektrafilm model/couplers.py).
// Inhibition is a loss of log exposure: a = Mᵀ f(u) (diffused), then d = f⁰(u − a), where the
// pre-correction f⁰ makes every neutral exposure reproduce the datasheet curve f.
import type { Mat3, Vec3 } from '../spectral/linalg.ts';
import type { Stock } from '../spectral/stock.ts';
import { FilmCurves, interpClamp, type Layer } from './curves.ts';
import { EXP_GAUSSIANS, gaussianKernelSum } from './blur.ts';

export interface Dir {
  /** M[donor][receiver], log H lost by the receiver per unit dye formed in the donor (× amount). */
  M: Mat3;
  amount: number;
  /** Inhibitor diffusion: (1 − w) Gaussian(σ) + w exponential(λ), µm. σ = 0: no diffusion. */
  diffusion: { sigma_um: number; tail_um: number; tailWeight: number };
  positive: boolean;
}

/** spektrafilm runtime/params_builder._apply_film_specifics (3bb2c2d): negatives, positives. */
export const DIR_NEGATIVE: Mat3 = [[0.336, 0.353, 0.302], [0.154, 0.319, 0.353], [0.168, 0.226, 0.273]];
export const DIR_POSITIVE: Mat3 = [[0.12, 0.12, 0.06], [0.08, 0.08, 0.06], [0.06, 0.06, 0.06]];
/** DirCouplersParams diffusion defaults. */
export const DIR_DIFFUSION = Object.freeze({ sigma_um: 20, tail_um: 200, tailWeight: 0.06 });

export function dirForStock(s: Stock, o: { amount?: number; diffusion_um?: number } = {}): Dir {
  const positive = s.data.type === 'positive';
  const amount = o.amount ?? 1;
  const base = positive ? DIR_POSITIVE : DIR_NEGATIVE;
  return {
    M: base.map((r) => r.map((v) => v * amount)) as Mat3,
    amount, positive,
    diffusion: { ...DIR_DIFFUSION, sigma_um: o.diffusion_um ?? 0 },
  };
}

/** Silver formed (the inhibitor's source): d for negatives, d_max − d for positives. */
function silver(c: FilmCurves, d: ArrayLike<number>, positive: boolean): Vec3 {
  return positive ? [c.max(0) - d[0]!, c.max(1) - d[1]!, c.max(2) - d[2]!] : [d[0]!, d[1]!, d[2]!];
}

/** a_j = Σ_k M_kj · silver_k(f(u)). */
export function inhibitor(u: ArrayLike<number>, c: FilmCurves, dir: Dir): Vec3 {
  const s = silver(c, c.develop(u, [0, 0, 0]), dir.positive);
  return [0, 1, 2].map((j) => s[0] * dir.M[0][j]! + s[1] * dir.M[1][j]! + s[2] * dir.M[2][j]!) as Vec3;
}

/**
 * The pre-correction f⁰: f⁰_j(t − Σ_k M_kj f_k(t)) = f_j(t), evaluated as np.interp(logH, logH − f@M, f)
 * (compute_density_curves_before_dir_couplers; positives through −f). Keeps c's gamma.
 */
export function precorrectedCurves(c: FilmCurves, dir: Dir): FilmCurves {
  const n = c.logH.length;
  const base = c.withGamma([1, 1, 1]);
  const f0 = [0, 1, 2].map((j) => {
    const x0 = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const s = silver(base, [base.f[0][i]!, base.f[1][i]!, base.f[2][i]!], dir.positive);
      x0[i] = c.logH[i]! - (s[0] * dir.M[0][j]! + s[1] * dir.M[1][j]! + s[2] * dir.M[2][j]!);
    }
    // the shifted axis must increase for np.interp; keep it non-decreasing where a steep curve would fold it
    for (let i = 1; i < n; i++) if (x0[i]! < x0[i - 1]!) x0[i] = x0[i - 1]!;
    const fj = base.f[j as Layer];
    if (dir.positive) return Float64Array.from(c.logH, (x) => -interpClamp(x0, fj.map((v) => -v), x));
    return Float64Array.from(c.logH, (x) => interpClamp(x0, fj, x));
  });
  return new FilmCurves(c.logH, f0, c.gamma);
}

/** Coupled development of one pixel without diffusion: d = f⁰(u − Mᵀ f(u)). */
export function developCoupled(u: ArrayLike<number>, c: FilmCurves, c0: FilmCurves, dir: Dir): Vec3 {
  const a = inhibitor(u, c, dir);
  return [c0.at(0, u[0]! - a[0]), c0.at(1, u[1]! - a[1]), c0.at(2, u[2]! - a[2])];
}

/**
 * Hanson and Horton's gamma matrix, the Jacobian of u ↦ d (rows dyes, columns layers):
 * J = diag(f⁰'(u − a)) · (I − Mᵀ diag(f'(u))) for negatives.
 */
export function effectiveGamma(u: ArrayLike<number>, c: FilmCurves, c0: FilmCurves, dir: Dir, h = 1e-4): Mat3 {
  const a = inhibitor(u, c, dir);
  const s = dir.positive ? -1 : 1;
  const fp = [0, 1, 2].map((k) => c.slope(k as Layer, u[k]!, h));
  const f0p = [0, 1, 2].map((j) => c0.slope(j as Layer, u[j]! - a[j]!, h));
  return [0, 1, 2].map((j) => [0, 1, 2].map((k) => f0p[j]! * ((j === k ? 1 : 0) - s * dir.M[k]![j]! * fp[k]!))) as Mat3;
}

/** The inhibitor diffusion kernel as a list of (weight, σ µm) Gaussians (exponential tail as three). */
export function inhibitorKernel(dir: Dir): { w: number; sigma_um: number }[] {
  const d = dir.diffusion;
  if (!(d.sigma_um > 0)) return [];
  return [{ w: 1 - d.tailWeight, sigma_um: d.sigma_um }, ...EXP_GAUSSIANS.map(([a, r]) => ({ w: d.tailWeight * a, sigma_um: r * d.tail_um }))];
}

/**
 * film.couple on an image: u (n·3 interleaved, w × h) → u − K ∗ (Mᵀ f(u)), K the inhibitor kernel
 * in µm (none when diffusion is 0: the op is then pointwise).
 */
export function coupleImage(u: Float64Array, w: number, h: number, umPerPx: number, c: FilmCurves, dir: Dir): Float64Array {
  const n = w * h;
  const a = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) a.set(inhibitor(u.subarray(i * 3, i * 3 + 3), c, dir), i * 3);
  const K = inhibitorKernel(dir);
  const ab = K.length ? gaussianKernelSum(a, w, h, 3, K.map((k) => ({ w: [k.w, k.w, k.w], sigma: [k.sigma_um / umPerPx, k.sigma_um / umPerPx, k.sigma_um / umPerPx] }))) : a;
  const out = new Float64Array(n * 3);
  for (let i = 0; i < n * 3; i++) out[i] = u[i]! - ab[i]!;
  return out;
}


