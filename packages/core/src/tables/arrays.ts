// Table inputs as plain arrays: what a worker receives and what a GPU table key hashes (CHB-005
// keys.ts), built from core's objects, and the f64 evaluator of one table node. packages/gpu's oracle
// is these two evaluators, so its tables are core's tables (tables.ts) to round-off:
//   solve:  bit-identical (the same forwardFromArrays and solveDyes);
//   pd:     clear − exposure(c) = −log10 Σ Ŵ 10^−(B + cE), Ŵ = lamp·filters·s_k·pass normalised;
//   print:  observe(viewing, reflectance(cp)) = Σ W 10^−(B + cE), W = E·x̄·pass / Σ E·ȳ.
import type { Viewing } from '../print/colour.ts';
import type { Enlarger } from '../print/enlarger.ts';
import { forwardArrays, forwardFromArrays, SOLVE_DEFAULTS, solveDyes, type ForwardArrays, type ForwardCore, type ForwardModel, type SolveOptions, type SolveResult } from '../scan/solve.ts';
import type { Mat3, Vec3 } from '../spectral/linalg.ts';
import { NW } from '../spectral/spectrum.ts';

type Arr = ArrayLike<number>;

/** The dye solve of one table: forward arrays, the base reading and the solver settings. */
export interface SolveArrays extends ForwardArrays {
  Dbase: Vec3;
  lo: number;
  hi: number;
  tol: number;
  gtol: number;
  maxIt: number;
  activeSet: boolean;
}

/** 'log': −log₁₀ Σ W 10^−D (printing density); 'lin': M · Σ W 10^−D (XYZ). D = B + Σ c_j E_j. */
export interface SpectralArrays {
  mode: 'log' | 'lin';
  E: readonly [Arr, Arr, Arr];
  B: Arr;
  W: readonly [Arr, Arr, Arr];
  M: Mat3;
}

const I3: Mat3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

export function solveArrays(f: ForwardModel, o: SolveOptions = {}): SolveArrays {
  const s = { ...SOLVE_DEFAULTS, ...o };
  return { ...forwardArrays(f), Dbase: [...f.Dbase] as Vec3, lo: s.lo, hi: s.hi, tol: s.tolerance, gtol: s.gtol, maxIt: s.maxIterations, activeSet: s.activeSet };
}

/** Printing density of the enlarger: pd(c) = clear − exposure(c), independent of the normalisation offset. */
export function pdArrays(enl: Enlarger): SpectralArrays {
  const { film, paper } = enl.setup;
  const W = [0, 1, 2].map((k) => {
    const w = new Float64Array(NW);
    let t = 0;
    for (let i = 0; i < NW; i++) if (film.pass[i]) t += (w[i] = enl.light[i]! * paper.sens[k]![i]!);
    for (let i = 0; i < NW; i++) w[i] = w[i]! / t;
    return w;
  }) as [Float64Array, Float64Array, Float64Array];
  return { mode: 'log', E: [film.dyes[0]!, film.dyes[1]!, film.dyes[2]!], B: film.base, W, M: I3 };
}

/** Print XYZ under the viewing light (Y of a perfect white = 1), not adapted. */
export function printArrays(v: Viewing): SpectralArrays {
  const [cx, cy, cz] = v.cmf;
  const pass = v.paper.pass;
  let k = 0;
  for (let i = 0; i < NW; i++) k += v.illuminant[i]! * cy[i]!;
  const W = [cx, cy, cz].map((c) => Float64Array.from({ length: NW }, (_, i) => (pass[i] ? (v.illuminant[i]! * c[i]!) / k : 0))) as [Float64Array, Float64Array, Float64Array];
  return { mode: 'lin', E: [v.paper.dyes[0]!, v.paper.dyes[1]!, v.paper.dyes[2]!], B: v.paper.base, W, M: I3 };
}

const forwards = new WeakMap<object, ForwardCore>();

/** The f64 dye solve of one table node: absolute scanner density d → dyes (the same solveDyes core uses). */
export function solveNode(inp: SolveArrays, d: ArrayLike<number>): SolveResult {
  let f = forwards.get(inp);
  if (!f) forwards.set(inp, (f = forwardFromArrays(inp)));
  return solveDyes(f, d, { lo: inp.lo, hi: inp.hi, tolerance: inp.tol, gtol: inp.gtol, maxIterations: inp.maxIt, activeSet: inp.activeSet });
}

/** The f64 spectral integral of one table node. */
export function spectralNode(inp: SpectralArrays, c: ArrayLike<number>): Vec3 {
  const [E0, E1, E2] = inp.E;
  const [W0, W1, W2] = inp.W;
  const B = inp.B;
  const c0 = c[0]!, c1 = c[1]!, c2 = c[2]!;
  let s0 = 0, s1 = 0, s2 = 0;
  for (let i = 0; i < B.length; i++) {
    const t = 10 ** -(B[i]! + c0 * E0[i]! + c1 * E1[i]! + c2 * E2[i]!);
    s0 += W0[i]! * t; s1 += W1[i]! * t; s2 += W2[i]! * t;
  }
  if (inp.mode === 'log') return [-Math.log10(s0), -Math.log10(s1), -Math.log10(s2)];
  const M = inp.M;
  return [M[0][0] * s0 + M[0][1] * s1 + M[0][2] * s2, M[1][0] * s0 + M[1][1] * s1 + M[1][2] * s2, M[2][0] * s0 + M[2][1] * s1 + M[2][2] * s2];
}
