// Scatter and halation (CHB-012 guide §2.7, §5.4; textbook §2.4; spektrafilm model/diffusion.apply_halation_um).
// Both redistribute light, so they are normalised convolutions of linear exposure, in µm on the film:
//   E1 = (1 − w) G_σc ∗ E0 + w X_λt ∗ E0                       (in-emulsion scatter)
//   E2 = (E1 + a Σ_k w_k G_{σh√k} ∗ E1) / (1 + a)              (back-reflection, three bounces)
// film.halation reads and writes film-logH: E = 10^u − 1e-10, convolve, log10(max(E, 0) + 1e-10).
import type { Vec3 } from '../spectral/linalg.ts';
import type { Stock } from '../spectral/stock.ts';
import { EXP_GAUSSIANS, gaussianKernelSum } from './blur.ts';
import { erf } from '../print/paper.ts';

export interface HalationSpec {
  scatter: { core_um: Vec3; tail_um: Vec3; tailWeight: Vec3; amount: number; scale: number };
  halation: { strength: Vec3; sigma_um: Vec3; bounces: number; decay: number; amount: number; scale: number; renormalise: boolean };
}

/** spektrafilm params_builder._HALATION_PRESETS by anti-halation tag (strengths per layer R, G, B). */
export const HALATION_STRENGTH: Record<'strong' | 'weak' | 'no', Vec3> = { strong: [0.015, 0.005, 0], weak: [0.08, 0.02, 0], no: [0.3, 0.1, 0.015] };
/** HalationParams scatter defaults (µm) and the first-bounce σ for still and cine film. */
export const SCATTER = Object.freeze({ core_um: [2.2, 2.0, 1.6] as Vec3, tail_um: [9.3, 9.7, 9.1] as Vec3, tailWeight: [0.78, 0.65, 0.67] as Vec3 });
export const HALATION_SIGMA_UM = Object.freeze({ still: 65, cine: 50 });

export function halationForStock(s: Stock, o: { strength?: number; antihalation?: 'strong' | 'weak' | 'no' } = {}): HalationSpec {
  const tag = o.antihalation ?? (s.data.meta.antihalation === 'strong' || s.data.meta.antihalation === 'no' ? s.data.meta.antihalation : 'weak');
  const sig = s.data.meta.use === 'cine' ? HALATION_SIGMA_UM.cine : HALATION_SIGMA_UM.still;
  return {
    scatter: { core_um: [...SCATTER.core_um] as Vec3, tail_um: [...SCATTER.tail_um] as Vec3, tailWeight: [...SCATTER.tailWeight] as Vec3, amount: 1, scale: 1 },
    halation: { strength: [...HALATION_STRENGTH[tag]] as Vec3, sigma_um: [sig, sig, sig], bounces: 3, decay: 0.5, amount: o.strength ?? 1, scale: 1, renormalise: true },
  };
}

/** The combined kernel of a layer as a mixture of Gaussians (weight, σ µm); weights sum to 1. */
export function halationKernel(s: HalationSpec, k: 0 | 1 | 2): { w: number; sigma_um: number }[] {
  const sc = s.scatter;
  const scatter: { w: number; sigma_um: number }[] = sc.amount > 0
    ? [
      { w: 1 - sc.amount, sigma_um: 0 },
      { w: sc.amount * (1 - sc.tailWeight[k]), sigma_um: sc.core_um[k] * sc.scale },
      ...EXP_GAUSSIANS.map(([a, r]) => ({ w: sc.amount * sc.tailWeight[k] * a, sigma_um: r * sc.tail_um[k] * sc.scale })),
    ].filter((g) => g.w !== 0)
    : [{ w: 1, sigma_um: 0 }];
  const h = s.halation;
  const a = h.strength[k] * h.amount;
  if (!(a > 0) || h.bounces < 1) return scatter;
  const dec = Array.from({ length: h.bounces }, (_, i) => h.decay ** i);
  const ds = dec.reduce((x, y) => x + y, 0);
  const norm = h.renormalise ? 1 + a : 1;
  const bounce = [{ w: 1 / norm, sigma_um: 0 }, ...dec.map((d, i) => ({ w: (a * d) / ds / norm, sigma_um: h.sigma_um[k] * h.scale * Math.sqrt(i + 1) }))];
  const out: { w: number; sigma_um: number }[] = [];
  for (const p of scatter) for (const q of bounce) out.push({ w: p.w * q.w, sigma_um: Math.hypot(p.sigma_um, q.sigma_um) });
  return out;
}

/** Standard normal CDF. */
const phiOf = (z: number): number => 0.5 * (1 + erf(z / Math.SQRT2));

/**
 * Exact response to a straight edge, r µm into the dark side (r < 0: bright side), in log H:
 * E(r) = E_d + (E_b − E_d) Σ_i w_i Φ(−r/σ_i), the 1-D marginal of each isotropic Gaussian.
 */
export function edgeResponse(s: HalationSpec, k: 0 | 1 | 2, brightLogH: number, darkLogH: number, r_um: number): number {
  const Eb = 10 ** brightLogH, Ed = 10 ** darkLogH;
  let f = 0;
  for (const g of halationKernel(s, k)) f += g.w * (g.sigma_um > 0 ? phiOf(-r_um / g.sigma_um) : r_um < 0 ? 1 : r_um > 0 ? 0 : 0.5);
  return Math.log10(Ed + (Eb - Ed) * f);
}

/**
 * spektrafilm's two passes on linear exposure E (interleaved 3 channels), widths in µm:
 * scatter, then the normalised three-bounce halation. Each pass is a per-layer mixture of Gaussians.
 */
export function applyHalationLinear(E: Float64Array, w: number, h: number, umPerPx: number, s: HalationSpec): Float64Array {
  const sc = s.scatter;
  let cur = E;
  if (sc.amount > 0) {
    const terms = [
      { w: [1 - sc.amount, 1 - sc.amount, 1 - sc.amount], sigma: [0, 0, 0] },
      { w: [0, 1, 2].map((k) => sc.amount * (1 - sc.tailWeight[k as 0]!)), sigma: [0, 1, 2].map((k) => (sc.core_um[k as 0]! * sc.scale) / umPerPx) },
      ...EXP_GAUSSIANS.map(([a, r]) => ({ w: [0, 1, 2].map((k) => sc.amount * sc.tailWeight[k as 0]! * a), sigma: [0, 1, 2].map((k) => (r * sc.tail_um[k as 0]! * sc.scale) / umPerPx) })),
    ];
    cur = gaussianKernelSum(cur, w, h, 3, terms);
  }
  const hp = s.halation;
  const a = [0, 1, 2].map((k) => hp.strength[k as 0]! * hp.amount);
  if (hp.bounces >= 1 && a.some((v) => v > 0)) {
    const dec = Array.from({ length: hp.bounces }, (_, i) => hp.decay ** i);
    const ds = dec.reduce((x, y) => x + y, 0);
    const norm = a.map((v) => (hp.renormalise ? 1 + v : 1));
    const terms = [
      { w: norm.map((n) => 1 / n), sigma: [0, 0, 0] },
      ...dec.map((d, i) => ({ w: a.map((v, k) => (v * d) / ds / norm[k]!), sigma: [0, 1, 2].map((k) => (hp.sigma_um[k as 0]! * hp.scale * Math.sqrt(i + 1)) / umPerPx) })),
    ];
    cur = gaussianKernelSum(cur, w, h, 3, terms);
  }
  return cur;
}

/** film.halation on film-logH (interleaved 3 channels). */
export function applyHalation(logH: Float64Array, w: number, h: number, umPerPx: number, s: HalationSpec): Float64Array {
  const E = logH.map((u) => 10 ** u - 1e-10);
  const E2 = applyHalationLinear(E, w, h, umPerPx, s);
  return E2.map((e) => Math.log10(Math.max(e, 0) + 1e-10));
}
