// Characteristic curves of the forward path (CHB-012 guide §2.5, §5.3; textbook §2.2; spektrafilm
// model/density_curves.py, model/parametric.py; Chromogen stock.js parametric).
// Tables are the truth for rendering (spektrafilm's convention: min-subtracted, gamma as an axis
// stretch f(g·x), clamped at both ends); the two-softplus parametric form describes and fits them.
import type { Vec3 } from '../spectral/linalg.ts';
import type { Stock } from '../spectral/stock.ts';

export type Layer = 0 | 1 | 2;

/** Clamped linear interpolation on an increasing axis (spektrafilm fast_interp / np.interp). */
export function interpClamp(xs: ArrayLike<number>, ys: ArrayLike<number>, x: number): number {
  const n = xs.length;
  if (!(x > xs[0]!)) return ys[0]!;
  if (x >= xs[n - 1]!) return ys[n - 1]!;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (xs[m]! <= x) lo = m;
    else hi = m;
  }
  const d = xs[hi]! - xs[lo]!;
  return d === 0 ? ys[hi]! : ys[lo]! + ((x - xs[lo]!) / d) * (ys[hi]! - ys[lo]!);
}

/** Three tabulated curves on a common log H axis, evaluated at g·x (gamma as axis stretch). */
export class FilmCurves {
  readonly logH: Float64Array;
  readonly f: [Float64Array, Float64Array, Float64Array];
  readonly gamma: Vec3;
  constructor(logH: ArrayLike<number>, f: readonly ArrayLike<number>[], gamma: Vec3 = [1, 1, 1]) {
    this.logH = Float64Array.from(logH);
    this.f = [Float64Array.from(f[0]!), Float64Array.from(f[1]!), Float64Array.from(f[2]!)];
    this.gamma = [...gamma] as Vec3;
  }
  /** The min-subtracted datasheet curves of a stock (spektrafilm develop.develop normalisation). */
  static ofStock(s: Stock): FilmCurves {
    const f = s.data.curves.map((c) => {
      let m = Infinity;
      for (const v of c) if (Number.isFinite(v) && v < m) m = v;
      return c.map((v) => (Number.isFinite(v) ? v - m : 0));
    });
    return new FilmCurves(s.data.logExposure, f);
  }
  at(k: Layer, x: number): number {
    return interpClamp(this.logH, this.f[k], x * this.gamma[k]);
  }
  develop(u: ArrayLike<number>, out: Float64Array | number[] = [0, 0, 0]): typeof out {
    out[0] = this.at(0, u[0]!); out[1] = this.at(1, u[1]!); out[2] = this.at(2, u[2]!);
    return out;
  }
  slope(k: Layer, x: number, h = 1e-4): number {
    return (this.at(k, x + h) - this.at(k, x - h)) / (2 * h);
  }
  /** Largest x with f(x) ≤ d (the table is non-decreasing): the curve's inverse, clamped. */
  inverse(k: Layer, d: number): number {
    const f = this.f[k], x = this.logH, g = this.gamma[k];
    const n = f.length;
    if (d <= f[0]!) return x[0]! / g;
    if (d >= f[n - 1]!) return x[n - 1]! / g;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (f[m]! <= d) lo = m;
      else hi = m;
    }
    const df = f[hi]! - f[lo]!;
    return (df === 0 ? x[lo]! : x[lo]! + ((d - f[lo]!) / df) * (x[hi]! - x[lo]!)) / g;
  }
  max(k: Layer): number {
    let m = -Infinity;
    for (const v of this.f[k]) if (v > m) m = v;
    return m;
  }
  withGamma(g: Vec3): FilmCurves {
    return new FilmCurves(this.logH, this.f, g);
  }
  /** A 1-D table of the curve with the gamma baked in on [lo, hi] (the GPU's curve rows). */
  sample(k: Layer, n: number, lo: number, hi: number): Float64Array {
    return Float64Array.from({ length: n }, (_, i) => this.at(k, lo + ((hi - lo) * i) / (n - 1)));
  }
}

// ---- the two-softplus parametric curve ------------------------------------------------------------

export interface Parametric { gamma: number; x0: number; D: number; toe: number; shoulder: number; dmin: number }

const softplus10 = (z: number): number => (z > 30 ? z : Math.log10(1 + 10 ** z));
const logistic10 = (z: number): number => 1 / (1 + 10 ** -z);

/** f(x) = d_min + γ t sp((x − x₀)/t) − γ s sp((x − x₀ − D/γ)/s), sp(z) = log₁₀(1 + 10^z). */
export function parametric(p: Parametric, x: number): number {
  return p.dmin + p.gamma * p.toe * softplus10((x - p.x0) / p.toe) - p.gamma * p.shoulder * softplus10((x - p.x0 - p.D / p.gamma) / p.shoulder);
}

/** f'(x) = γ [L((x − x₀)/t) − L((x − x₀ − D/γ)/s)], L(z) = 1/(1 + 10^−z). */
export function parametricSlope(p: Parametric, x: number): number {
  return p.gamma * (logistic10((x - p.x0) / p.toe) - logistic10((x - p.x0 - p.D / p.gamma) / p.shoulder));
}

/** Newton from the straight part, guarded by bisection, to 1e-12 (the curve is strictly increasing). */
export function parametricInverse(p: Parametric, y: number): number {
  const lo0 = p.dmin, hi0 = p.dmin + p.D;
  if (y <= lo0) return -Infinity;
  if (y >= hi0) return Infinity;
  let lo = p.x0 - 50, hi = p.x0 + p.D / p.gamma + 50;
  let x = Math.min(hi, Math.max(lo, p.x0 + (y - p.dmin) / p.gamma));
  for (let it = 0; it < 200; it++) {
    const r = parametric(p, x) - y;
    if (Math.abs(r) < 1e-13) break;
    if (r > 0) hi = x;
    else lo = x;
    const d = parametricSlope(p, x);
    let nx = x - r / d;
    if (!(nx > lo && nx < hi)) nx = (lo + hi) / 2;
    if (Math.abs(nx - x) < 1e-15) { x = nx; break; }
    x = nx;
  }
  return x;
}

/**
 * Least-squares fit of the parametric curve to layer k of `c` on `range` (0.01 log H samples):
 * Levenberg–Marquardt on (γ, x₀, D, t, s) with d_min fixed (0 for min-subtracted curves).
 */
export function fitParametric(c: FilmCurves, k: Layer, range: [number, number] = [-2.5, 3.5], o: { dmin?: number } = {}): Parametric & { rms: number; max: number } {
  const xs: number[] = [];
  for (let x = range[0]; x <= range[1] + 1e-9; x += 0.01) xs.push(x);
  const ys = xs.map((x) => c.at(k, x));
  const P = (q: number[]): Parametric => ({ gamma: q[0]!, x0: q[1]!, D: q[2]!, toe: Math.max(q[3]!, 1e-3), shoulder: Math.max(q[4]!, 1e-3), dmin: o.dmin ?? 0 });
  const res = (q: number[]): number[] => { const p = P(q); return xs.map((x, i) => parametric(p, x) - ys[i]!); };
  const ymax = Math.max(...ys);
  // start: slope at the grey card, toe where the curve leaves its base
  let q = [Math.max(0.2, c.slope(k, 0)), -1.3, ymax - ys[0]!, 0.4, 0.4];
  let lam = 1e-3;
  let r = res(q);
  let cost = r.reduce((a, v) => a + v * v, 0);
  for (let it = 0; it < 400; it++) {
    const J = q.map((_, m) => {
      const h = 1e-6 * Math.max(1, Math.abs(q[m]!));
      const qq = [...q];
      qq[m]! += h;
      const r2 = res(qq);
      return r2.map((v, i) => (v - r[i]!) / h);
    });
    const n = q.length;
    const A = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => J[a]!.reduce((s, v, i) => s + v * J[b]![i]!, 0)));
    const g = Array.from({ length: n }, (_, a) => J[a]!.reduce((s, v, i) => s + v * r[i]!, 0));
    let improved = false;
    for (let tries = 0; tries < 12; tries++) {
      const M = A.map((row, a) => row.map((v, b) => (a === b ? v * (1 + lam) + 1e-12 : v)));
      const step = solveSym(M, g.map((v) => -v));
      if (!step) { lam *= 10; continue; }
      const qn = q.map((v, m) => v + step[m]!);
      const rn = res(qn);
      const cn = rn.reduce((a, v) => a + v * v, 0);
      if (cn < cost) {
        const done = cost - cn < 1e-15 * Math.max(1, cost);
        q = qn; r = rn; cost = cn; lam = Math.max(lam / 3, 1e-12); improved = true;
        if (done) it = 1e9;
        break;
      }
      lam *= 10;
    }
    if (!improved) break;
  }
  const p = P(q);
  const rms = Math.sqrt(cost / xs.length);
  const max = Math.max(...r.map(Math.abs));
  return { ...p, rms, max };
}

function solveSym(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    if (Math.abs(M[p]![c]!) < 1e-300) return null;
    [M[c], M[p]] = [M[p]!, M[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / M[c]![c]!;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  return M.map((r, i) => r[n]! / M[i]![i]!);
}
