// The development model (CHB-012 guide §2.9, §5.5): push/pull as a transform of the datasheet
// curves, labelled by where it comes from. f⁰ is always recomputed from the transformed curves
// (precorrectedCurves), so the neutral-reproduction law keeps holding after any transform.
import type { Vec3 } from '../spectral/linalg.ts';
import type { StockData } from '../spectral/stock.ts';
import { Phi } from '../print/paper.ts';
import { FilmCurves } from './curves.ts';

export type DevelopmentBasis = 'measured' | 'interpolated' | 'transferred' | 'heuristic' | 'none';

export interface DevelopmentResult { curves: FilmCurves; basis: DevelopmentBasis; push: number; note: string }

/**
 * Portra 800's measured change per push stop (guide §2.9, fit f_push(x) ≈ f_normal(g·x + s) over
 * −2…2 log H on the decoded profiles; "derived"): gamma factors and D_max ratios at push 1 and 2.
 */
export const PUSH_TRANSFER: { push: number; gamma: Vec3; dmaxRatio: Vec3 }[] = [
  { push: 0, gamma: [1, 1, 1], dmaxRatio: [1, 1, 1] },
  { push: 1, gamma: [1.25, 1.18, 1.24], dmaxRatio: [2.30 / 1.90, 1.96 / 1.73, 2.26 / 2.03] },
  { push: 2, gamma: [1.38, 1.30, 1.36], dmaxRatio: [2.52 / 1.90, 2.01 / 1.73, 2.52 / 2.03] },
];

function transferAt(p: number): { gamma: Vec3; dmaxRatio: Vec3 } {
  const T = PUSH_TRANSFER;
  const a = Math.abs(p);
  const i = Math.min(T.length - 2, Math.floor(a));
  const t = a - i;
  const lerp = (x: Vec3, y: Vec3): Vec3 => [0, 1, 2].map((k) => x[k]! + t * (y[k]! - x[k]!)) as Vec3;
  let g = lerp(T[i]!.gamma, T[i + 1]!.gamma);
  let r = lerp(T[i]!.dmaxRatio, T[i + 1]!.dmaxRatio);
  if (p < 0) { g = g.map((v) => 1 / v) as Vec3; r = r.map((v) => 1 / v) as Vec3; }
  return { gamma: g, dmaxRatio: r };
}

/**
 * Transfer a gamma stretch about log H = 0 and a shoulder lift to min-subtracted curves:
 * f₁(x) = f(g·x), then above the grey card f₂ = f₁ + (r − 1)·D_max·q², q = (f₁ − f(0))/(D_max − f(0)):
 * D_max moves to r·D_max while the straight part near the grey card keeps the stretched slope.
 */
export function transferCurves(c: FilmCurves, gamma: Vec3, dmaxRatio: Vec3): FilmCurves {
  const f = [0, 1, 2].map((k) => {
    const g = gamma[k]!, r = dmaxRatio[k]!;
    const f0 = c.at(k as 0, 0);
    const D = c.max(k as 0);
    return Float64Array.from(c.logH, (x) => {
      const v = c.at(k as 0, g * x);
      if (!(v > f0) || !(D > f0)) return v;
      const q = (v - f0) / (D - f0);
      return v + (r - 1) * D * q * q;
    });
  });
  return new FilmCurves(c.logH, f, c.gamma);
}

const minSub = (curves: readonly Float64Array[]): Float64Array[] => curves.map((c) => {
  let m = Infinity;
  for (const v of c) if (Number.isFinite(v) && v < m) m = v;
  return c.map((v) => (Number.isFinite(v) ? v - m : 0));
});

/** Evaluate a 3-CDF curve model Σ_i A_i Φ((x − μ_i)/σ_i) on an axis. */
function modelCurve(m: NonNullable<StockData['curveModel']>, k: number, x: ArrayLike<number>): Float64Array {
  return Float64Array.from(x, (v) => {
    let t = 0;
    for (let i = 0; i < 3; i++) t += m.amps[k]![i]! * Phi((v - m.centres[k]![i]!) / m.sigmas[k]![i]!);
    return t;
  });
}

/**
 * Curves for a development of `push` stops. `profiles` maps measured push levels to stock data of
 * the same film (Portra 800: 0, 1, 2); without them every push is 'transferred' (pull: 'heuristic').
 */
export function developmentCurves(base: StockData, push: number, profiles: ReadonlyMap<number, StockData> = new Map()): DevelopmentResult {
  const datasheet = (d: StockData): FilmCurves => new FilmCurves(d.logExposure, minSub(d.curves));
  if (push === 0) return { curves: datasheet(base), basis: 'none', push, note: 'nominal development' };
  const exact = profiles.get(push);
  if (exact) return { curves: datasheet(exact), basis: 'measured', push, note: `${exact.id}` };
  const levels = [...profiles.keys()].sort((a, b) => a - b);
  const lo = levels.filter((l) => l < push).pop();
  const hi = levels.find((l) => l > push);
  if (push > 0 && lo !== undefined && hi !== undefined) {
    const A = profiles.get(lo)!, B = profiles.get(hi)!;
    const t = (push - lo) / (hi - lo);
    const x = A.logExposure;
    const fa = minSub(A.curves), fb = minSub(B.curves);
    const ma = A.curveModel, mb = B.curveModel;
    const f = [0, 1, 2].map((k) => {
      if (!ma || !mb) return Float64Array.from(x, (_, i) => fa[k]![i]! + t * (fb[k]![i]! - fa[k]![i]!));
      // interpolate the 3-CDF parameters, keep the interpolated residual of each profile's fit
      const lerpM = (p: 'amps' | 'centres' | 'sigmas'): number[][] => ma[p].map((r, kk) => r.map((v, i) => v + t * (mb[p][kk]![i]! - v)));
      const mt = { amps: lerpM('amps'), centres: lerpM('centres'), sigmas: lerpM('sigmas') } as NonNullable<StockData['curveModel']>;
      const fm = modelCurve(mt, k, x), fma = modelCurve(ma, k, x), fmb = modelCurve(mb, k, x);
      return Float64Array.from(x, (_, i) => fm[i]! + (1 - t) * (fa[k]![i]! - fma[i]!) + t * (fb[k]![i]! - fmb[i]!));
    });
    return { curves: new FilmCurves(x, minSub(f)), basis: 'interpolated', push, note: `${A.id} … ${B.id} at t = ${t.toFixed(3)}` };
  }
  const tr = transferAt(push);
  const from = profiles.get(0) ?? base;
  return {
    curves: transferCurves(datasheet(from), tr.gamma, tr.dmaxRatio),
    basis: push < 0 ? 'heuristic' : 'transferred', push,
    note: push < 0 ? 'pull as the mirror of the Portra 800 push change (no data)' : 'Portra 800 measured change per stop applied to this stock',
  };
}
