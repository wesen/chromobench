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

/** Texel-centre position of v on a table axis (look3), clamped to [0, N − 1]. */
const axisPos = (v: number, N: number, lo: number, hi: number): number => {
  const u = (v - lo) / (hi - lo);
  const tc = (u * (N - 1) + 0.5) / N; // texture coordinate of the GPU sampler
  return Math.min(Math.max(tc * N - 0.5, 0), N - 1);
};

/**
 * Trilinear lookup with the GPU's clamp-to-edge texel-centre mapping. Allocation-free (P3b: the tabulated preview
 * calls it per pixel and per stage); the weights and the sum run in the same order as before, so values are unchanged.
 */
export function look3(t: Table3, v: ArrayLike<number>, out = new Float64Array(4)): Float64Array {
  const { N, lo, hi, data } = t;
  const p0 = axisPos(v[0]!, N, lo, hi), p1 = axisPos(v[1]!, N, lo, hi), p2 = axisPos(v[2]!, N, lo, hi);
  const i0 = Math.min(Math.floor(p0), N - 2), i1 = Math.min(Math.floor(p1), N - 2), i2 = Math.min(Math.floor(p2), N - 2);
  const w0 = p0 - i0, w1 = p1 - i1, w2 = p2 - i2;
  let o0 = 0, o1 = 0, o2 = 0, o3 = 0;
  for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const wt = (dx ? w0 : 1 - w0) * (dy ? w1 : 1 - w1) * (dz ? w2 : 1 - w2);
    const q = 4 * ((i0 + dx) + N * (i1 + dy) + N * N * (i2 + dz));
    o0 = o0 + wt * data[q]!;
    o1 = o1 + wt * data[q + 1]!;
    o2 = o2 + wt * data[q + 2]!;
    o3 = o3 + wt * data[q + 3]!;
  }
  out[0] = o0; out[1] = o1; out[2] = o2; out[3] = o3;
  return out;
}
