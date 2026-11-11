// f64 builders of the GPU's tables (guide §5.6): the oracle CHB-005 compares node by node.
// Node order is the Studio's nodeAt (model.js 1660–1663): x fastest; 4 floats per node.
// look3 reproduces trilinear filtering at texel centres, u' = (u(N − 1) + ½)/N.
import { observe, reflectance, type Viewing } from '../print/colour.ts';
import type { Enlarger } from '../print/enlarger.ts';
import { mulMV, type Vec3 } from '../spectral/linalg.ts';
import { solveDyes, type ForwardModel, type SolveOptions } from '../scan/solve.ts';

/** Studio domains (model.js 1628–1634). A_RANGE was sized for the secant key; see solveKeyRange. */
export const A_RANGE: [number, number] = [-0.25, 2.55];
export const C_RANGE: [number, number] = [0, 2.6];
export const CP_RANGE: [number, number] = [0, 2.7];
export const X_RANGE: [number, number] = [-2.5, 2.5];
export const N3 = 33;

export function nodeAt(q: number, N: number, lo: number, hi: number): Vec3 {
  const st = (hi - lo) / (N - 1);
  return [lo + (q % N) * st, lo + (Math.floor(q / N) % N) * st, lo + Math.floor(q / (N * N)) * st];
}

export interface Table3 { N: number; lo: number; hi: number; channels: 4; data: Float64Array }

export interface SolveTableStats { meanIterations: number; atCap: number; unreachable: number; maxResidual: number }

/** Dye-solve table keyed on a = K⁻¹(D − D_base): channels c0, c1, c2, residual. */
export function buildSolveTable(f: ForwardModel, o: { N?: number; range?: [number, number]; solve?: SolveOptions } = {}): { table: Table3; stats: SolveTableStats } {
  const N = o.N ?? N3;
  const [lo, hi] = o.range ?? A_RANGE;
  const data = new Float64Array(N * N * N * 4);
  let it = 0;
  let cap = 0;
  let un = 0;
  let maxR = 0;
  const maxIt = o.solve?.maxIterations ?? 50;
  for (let q = 0; q < N * N * N; q++) {
    const a = nodeAt(q, N, lo, hi);
    const d = mulMV(f.K, a).map((v, k) => v + f.Dbase[k]!);
    const r = solveDyes(f, d, o.solve);
    data.set([r.c[0], r.c[1], r.c[2], r.residual_D], 4 * q);
    it += r.iterations;
    if (r.iterations >= maxIt) cap++;
    if (r.residual_D > 0.01) un++;
    maxR = Math.max(maxR, r.residual_D);
  }
  const n = N * N * N;
  return { table: { N, lo, hi, channels: 4, data }, stats: { meanIterations: it / n, atCap: cap, unreachable: un / n, maxResidual: maxR } };
}

/** Key a = K⁻¹(D − D_base) for every dye triple in the box: the range a table must cover. */
export function solveKeyRange(f: ForwardModel, cRange: [number, number] = C_RANGE, n = 9): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n ** 3; i++) {
    const c = nodeAt(i, n, cRange[0], cRange[1]);
    const d = f.D(c);
    const a = mulMV(f.Kinv, [d[0] - f.Dbase[0], d[1] - f.Dbase[1], d[2] - f.Dbase[2]]);
    lo = Math.min(lo, ...a);
    hi = Math.max(hi, ...a);
  }
  return [lo, hi];
}

/** Printing density table: film dyes → printing density (clear − x) per paper layer. */
export function buildPdTable(chain: { enlarger: Enlarger }, o: { N?: number; range?: [number, number] } = {}): Table3 {
  const N = o.N ?? N3;
  const [lo, hi] = o.range ?? C_RANGE;
  const clear = chain.enlarger.clear();
  const data = new Float64Array(N * N * N * 4);
  for (let q = 0; q < N * N * N; q++) {
    const x = chain.enlarger.exposure(nodeAt(q, N, lo, hi));
    data.set([clear[0] - x[0], clear[1] - x[1], clear[2] - x[2], 1], 4 * q);
  }
  return { N, lo, hi, channels: 4, data };
}

/** Print XYZ table: paper dyes → XYZ under the viewing light. */
export function buildPrintTable(chain: { viewing: Viewing }, o: { N?: number; range?: [number, number] } = {}): Table3 {
  const N = o.N ?? N3;
  const [lo, hi] = o.range ?? CP_RANGE;
  const data = new Float64Array(N * N * N * 4);
  const R = new Float64Array(81);
  for (let q = 0; q < N * N * N; q++) {
    const X = observe(chain.viewing, reflectance(chain.viewing, nodeAt(q, N, lo, hi), R));
    data.set([X[0], X[1], X[2], 1], 4 * q);
  }
  return { N, lo, hi, channels: 4, data };
}

/** Trilinear lookup with the GPU's clamp-to-edge texel-centre mapping. */
export function look3(t: Table3, v: ArrayLike<number>, out = new Float64Array(4)): Float64Array {
  const { N, lo, hi, data } = t;
  const f = [0, 1, 2].map((k) => {
    const u = (v[k]! - lo) / (hi - lo);
    const tc = (u * (N - 1) + 0.5) / N; // texture coordinate of the GPU sampler
    const p = Math.min(Math.max(tc * N - 0.5, 0), N - 1);
    return p;
  });
  const i = f.map((p) => Math.min(Math.floor(p), N - 2));
  const w = f.map((p, k) => p - i[k]!);
  out.fill(0);
  for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const wt = (dx ? w[0]! : 1 - w[0]!) * (dy ? w[1]! : 1 - w[1]!) * (dz ? w[2]! : 1 - w[2]!);
    const q = (i[0]! + dx) + N * (i[1]! + dy) + N * N * (i[2]! + dz);
    for (let c = 0; c < 4; c++) out[c] = out[c]! + wt * data[4 * q + c]!;
  }
  return out;
}
