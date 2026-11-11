// Inversion (§3.1–3.4): forward model with the fused closed-form Jacobian and the bounded
// Levenberg–Marquardt dye solve with an active set. A line-by-line port of Chromogen solve.js
// spectral() (05-inline.js 647–790) with two changes (guide §5.5): the start defaults to the
// base-weighted K, and the result carries the stop reason and the pass count.
import type { Stock } from '../spectral/stock.ts';
import { baseWeightedK, secant, tangentAtZero } from '../spectral/channels.ts';
import { inv3, minSingular, mulMV, type Mat3, type Vec3 } from '../spectral/linalg.ts';
import type { ScannerModel } from './scanner.ts';

export type StartMatrix = 'base-weighted' | 'secant' | 'tangent0';

/** What the solve needs: the fused forward/Jacobian pass, the base reading and the start matrix. */
export interface ForwardCore {
  /** Absolute scanner densities of dye amounts c. */
  D(c: ArrayLike<number>, out?: Float64Array | number[]): Vec3;
  /** r = D(c) − d and J (row-major, 9) in one pass; returns ‖r‖². */
  DJ(c: ArrayLike<number>, d: ArrayLike<number>, r: Float64Array, J: Float64Array | null): number;
  /** The channels' reading of the stock's base. */
  Dbase: Vec3;
  K: Mat3;
  Kinv: Mat3;
}

export interface ForwardModel extends ForwardCore {
  stock: Stock;
  scanner: ScannerModel;
  start: StartMatrix;
}

type Arr = ArrayLike<number>;

/** The forward model's arrays: channel responsivities with the pass mask folded in, unit dyes, base, start K. */
export interface ForwardArrays {
  P: readonly [Arr, Arr, Arr];
  E: readonly [Arr, Arr, Arr];
  B: Arr;
  K: Mat3;
}

/**
 * A forward model over plain arrays (the form a worker or a GPU table key receives). makeForward
 * builds its arrays from a scanner and a stock and calls this, so both give bit-identical solves.
 */
export function forwardFromArrays(a: ForwardArrays): ForwardCore {
  const [P0, P1, P2] = a.P;
  const [E0, E1, E2] = a.E;
  const B = a.B;
  const n = B.length;
  const LN10 = Math.LN10;
  const DJ = (c: ArrayLike<number>, d: ArrayLike<number>, r: Float64Array, J: Float64Array | null): number => {
    const c0 = c[0]!;
    const c1 = c[1]!;
    const c2 = c[2]!;
    let s0 = 0, s1 = 0, s2 = 0, a00 = 0, a01 = 0, a02 = 0, a10 = 0, a11 = 0, a12 = 0, a20 = 0, a21 = 0, a22 = 0;
    for (let i = 0; i < n; i++) {
      const t = Math.exp(-LN10 * (B[i]! + c0 * E0[i]! + c1 * E1[i]! + c2 * E2[i]!));
      const w0 = P0[i]! * t;
      const w1 = P1[i]! * t;
      const w2 = P2[i]! * t;
      s0 += w0; s1 += w1; s2 += w2;
      if (J) {
        const e0 = E0[i]!, e1 = E1[i]!, e2 = E2[i]!;
        a00 += w0 * e0; a01 += w0 * e1; a02 += w0 * e2;
        a10 += w1 * e0; a11 += w1 * e1; a12 += w1 * e2;
        a20 += w2 * e0; a21 += w2 * e1; a22 += w2 * e2;
      }
    }
    r[0] = -Math.log10(s0) - d[0]!;
    r[1] = -Math.log10(s1) - d[1]!;
    r[2] = -Math.log10(s2) - d[2]!;
    if (J) {
      J[0] = a00 / s0; J[1] = a01 / s0; J[2] = a02 / s0;
      J[3] = a10 / s1; J[4] = a11 / s1; J[5] = a12 / s1;
      J[6] = a20 / s2; J[7] = a21 / s2; J[8] = a22 / s2;
    }
    return r[0] * r[0] + r[1] * r[1] + r[2] * r[2];
  };
  const zero = [0, 0, 0];
  const rr = new Float64Array(3);
  const D = (c: ArrayLike<number>): Vec3 => {
    DJ(c, zero, rr, null);
    return [rr[0]!, rr[1]!, rr[2]!];
  };
  return { D, DJ, Dbase: D(zero), K: a.K, Kinv: inv3(a.K) };
}

export function makeForward(s: ScannerModel, stock: Stock, opt: { start?: StartMatrix } = {}): ForwardModel {
  const start = opt.start ?? 'base-weighted';
  const ch = s.channels;
  const K = start === 'secant' ? secant(ch, stock) : start === 'tangent0' ? tangentAtZero(ch, stock) : baseWeightedK(ch, stock);
  const core = forwardFromArrays(forwardArraysOf(s, stock, K));
  return { ...core, stock, scanner: s, start };
}

/** A scanner and a stock as forward arrays: the pass mask folded into P, the stock's dyes and base, start K. */
export function forwardArraysOf(s: ScannerModel, stock: Stock, K: Mat3): ForwardArrays {
  const pass = stock.pass;
  const P = [0, 1, 2].map((k) => Float64Array.from(s.channels.P[k]!, (v, i) => v * pass[i]!)) as [Float64Array, Float64Array, Float64Array];
  return { P, E: [stock.dyes[0]!, stock.dyes[1]!, stock.dyes[2]!], B: stock.base, K };
}

/** The arrays makeForward solves with (pass folded into P), for workers and table keys. */
export function forwardArrays(f: ForwardModel): ForwardArrays {
  return forwardArraysOf(f.scanner, f.stock, f.K);
}

/** Closed-form J at c (3×3). */
export function forwardJacobian(f: ForwardCore, c: ArrayLike<number>): Mat3 {
  const r = new Float64Array(3);
  const J = new Float64Array(9);
  f.DJ(c, [0, 0, 0], r, J);
  return [[J[0]!, J[1]!, J[2]!], [J[3]!, J[4]!, J[5]!], [J[6]!, J[7]!, J[8]!]];
}

export interface SolveOptions {
  lo?: number;
  hi?: number;
  activeSet?: boolean;
  gtol?: number;
  tolerance?: number;
  maxIterations?: number;
  stall?: number;
  sigma?: boolean;
  /** Record (c, |r|, mu, tries) after the start and every iteration. */
  trace?: boolean;
  /** Law-harness hook: which dyes the active set holds. Default: a bound pushing outward (Bertsekas). */
  heldRule?: (x: number, g: number, lo: number, hi: number) => boolean;
}
const HELD = (x: number, g: number, lo: number, hi: number): boolean => (x <= lo && g > 0) || (x >= hi && g < 0);
export type StopReason = 'tolerance' | 'gtol' | 'maxIterations' | 'noImprovement' | 'stall';
export interface SolveResult {
  c: Vec3;
  start: Vec3;
  residual_D: number;
  iterations: number;
  passes: number;
  stop: StopReason;
  held: [boolean, boolean, boolean];
  sigmaMin?: number;
  trace?: { c: Vec3; residual: number; mu: number; tries: number }[];
}

/** Studio defaults (model.js SOLVE_OPTS): active set on, gtol 1e-9. */
export const SOLVE_DEFAULTS: Required<Omit<SolveOptions, 'trace' | 'heldRule'>> = { lo: 0, hi: 4, activeSet: true, gtol: 1e-9, tolerance: 1e-12, maxIterations: 50, stall: 0, sigma: false };

/** Bounded LM with active set. `d` is ABSOLUTE scanner density (density above rebate + f.Dbase). */
export function solveDyes(f: ForwardCore, d: ArrayLike<number>, o: SolveOptions = {}): SolveResult {
  const { lo, hi, activeSet, gtol, tolerance, maxIterations, stall, sigma } = { ...SOLVE_DEFAULTS, ...o };
  const clip = (v: number): number => (v < lo ? lo : v > hi ? hi : v);
  const held = o.heldRule ?? HELD;
  const r = new Float64Array(3);
  const J = new Float64Array(9);
  const r1 = new Float64Array(3);
  const start = mulMV(f.Kinv, [d[0]! - f.Dbase[0], d[1]! - f.Dbase[1], d[2]! - f.Dbase[2]]);
  let x0 = clip(start[0]), x1 = clip(start[1]), x2 = clip(start[2]);
  let F = f.DJ([x0, x1, x2], d, r, J);
  let passes = 1;
  let mu = 1e-3;
  let it = 0;
  let stop: StopReason = 'tolerance';
  let a0 = false, a1 = false, a2 = false;
  const trace = o.trace ? [{ c: [x0, x1, x2] as Vec3, residual: Math.sqrt(F), mu, tries: 0 }] : undefined;
  for (; ; it++) {
    if (!(F > tolerance)) { stop = 'tolerance'; break; }
    if (it >= maxIterations) { stop = 'maxIterations'; break; }
    const A00 = J[0]! * J[0]! + J[3]! * J[3]! + J[6]! * J[6]!;
    const A01_ = J[0]! * J[1]! + J[3]! * J[4]! + J[6]! * J[7]!;
    const A02_ = J[0]! * J[2]! + J[3]! * J[5]! + J[6]! * J[8]!;
    const A11 = J[1]! * J[1]! + J[4]! * J[4]! + J[7]! * J[7]!;
    const A12_ = J[1]! * J[2]! + J[4]! * J[5]! + J[7]! * J[8]!;
    const A22 = J[2]! * J[2]! + J[5]! * J[5]! + J[8]! * J[8]!;
    let g0 = J[0]! * r[0]! + J[3]! * r[1]! + J[6]! * r[2]!;
    let g1 = J[1]! * r[0]! + J[4]! * r[1]! + J[7]! * r[2]!;
    let g2 = J[2]! * r[0]! + J[5]! * r[1]! + J[8]! * r[2]!;
    a0 = a1 = a2 = false;
    if (activeSet) {
      a0 = held(x0, g0, lo, hi);
      a1 = held(x1, g1, lo, hi);
      a2 = held(x2, g2, lo, hi);
      if (Math.max(a0 ? 0 : Math.abs(g0), a1 ? 0 : Math.abs(g1), a2 ? 0 : Math.abs(g2)) < gtol) { stop = 'gtol'; break; }
      if (a0) g0 = 0;
      if (a1) g1 = 0;
      if (a2) g2 = 0;
    }
    let improved = false;
    let stalled = false;
    let tries = 0;
    for (; tries < 12 && !improved; tries++) {
      let b00 = A00 + mu * (1 + A00), b11 = A11 + mu * (1 + A11), b22 = A22 + mu * (1 + A22), A01 = A01_, A02 = A02_, A12 = A12_;
      if (a0) { b00 = 1; A01 = 0; A02 = 0; }
      if (a1) { b11 = 1; A01 = 0; A12 = 0; }
      if (a2) { b22 = 1; A02 = 0; A12 = 0; }
      const det = b00 * (b11 * b22 - A12 * A12) - A01 * (A01 * b22 - A12 * A02) + A02 * (A01 * A12 - b11 * A02);
      if (!(Math.abs(det) > 1e-300)) { mu *= 10; continue; }
      const i00 = (b11 * b22 - A12 * A12) / det, i01 = (A02 * A12 - A01 * b22) / det, i02 = (A01 * A12 - A02 * b11) / det;
      const i11 = (b00 * b22 - A02 * A02) / det, i12 = (A01 * A02 - b00 * A12) / det, i22 = (b00 * b11 - A01 * A01) / det;
      const y0 = clip(x0 - (i00 * g0 + i01 * g1 + i02 * g2));
      const y1 = clip(x1 - (i01 * g0 + i11 * g1 + i12 * g2));
      const y2 = clip(x2 - (i02 * g0 + i12 * g1 + i22 * g2));
      const F1 = f.DJ([y0, y1, y2], d, r1, null);
      passes++;
      if (F1 < F) {
        x0 = y0; x1 = y1; x2 = y2;
        mu = Math.max(mu / 3, 1e-12);
        improved = F - F1 > stall * F;
        F = f.DJ([x0, x1, x2], d, r, J);
        passes++;
        if (!improved) { stalled = true; break; }
      } else mu *= 4;
    }
    if (trace) trace.push({ c: [x0, x1, x2], residual: Math.sqrt(F), mu, tries: stalled ? tries + 1 : tries });
    if (stalled) { stop = 'stall'; break; }
    if (!improved) { stop = 'noImprovement'; break; }
  }
  const c: Vec3 = [x0, x1, x2];
  const res: SolveResult = { c, start, residual_D: Math.sqrt(F), iterations: it, passes, stop, held: [a0, a1, a2] };
  if (sigma) res.sigmaMin = minSingular(forwardJacobian(f, c));
  if (trace) res.trace = trace;
  return res;
}

// ---- scanner flare (§3.1, §3.7) ----------------------------------------------------------------

/** Density above the rebate as read with flare f (fraction of the open-gate signal): −log10((T + f)/(T_reb + f)). */
export function withFlare(Dabove: ArrayLike<number>, Treb: ArrayLike<number>, f: number): Vec3 {
  return [0, 1, 2].map((k) => {
    const T = Treb[k]! * 10 ** -Dabove[k]!;
    return -Math.log10((T + f) / (Treb[k]! + f));
  }) as Vec3;
}

/** Inverse of withFlare: subtract f in linear transmittance. */
export function removeFlare(Dmeasured: ArrayLike<number>, Treb: ArrayLike<number>, f: number): Vec3 {
  return [0, 1, 2].map((k) => {
    const Tm = (Treb[k]! + f) * 10 ** -Dmeasured[k]!;
    return -Math.log10(Math.max(Tm - f, 1e-12) / Treb[k]!);
  }) as Vec3;
}

/** Fits f from a neutral wedge (flat densities read as-is in every channel, §3.7): golden-section on the RMS. */
export function fitFlare(steps_D: readonly number[], readings_D: readonly number[]): { f: number; rms: number } {
  const rms = (f: number): number => {
    let s = 0;
    steps_D.forEach((d, i) => {
      const pred = -Math.log10((10 ** -d + f) / (1 + f));
      s += (pred - readings_D[i]!) ** 2;
    });
    return Math.sqrt(s / steps_D.length);
  };
  let a = 0;
  let b = 0.1;
  const g = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 200; i++) {
    const c = b - g * (b - a);
    const d = a + g * (b - a);
    if (rms(c) < rms(d)) b = d;
    else a = c;
  }
  const f = (a + b) / 2;
  return { f, rms: rms(f) };
}
