// The f64 oracle the parity harness and the worker build run against: @chromobench/core's dye solve
// and spectral integrals over the table arrays (core/src/tables/arrays.ts), so the GPU's f64 tables
// are core's tables (CHB-017; the interim Chromogen port that stood here is gone). Plus the CPU models
// of the GPU's lookups.
import { solveNode, spectralNode } from '@chromobench/core/tables';
import { nodeAt, type SolveInputs, type SpectralInputs, type Table, type Vec3 } from '../tables/inputs.ts';

export interface SolveResult { c: Vec3; residual: number; iterations: number }

export interface F64Oracle {
  readonly name: string;
  solve(inp: SolveInputs, d: Vec3): SolveResult;
  spectral(inp: SpectralInputs, c: Vec3): Vec3;
}

/** core's f64 physics: solveDyes on forwardFromArrays(inp), and the table spectral integral. */
export const coreOracle: F64Oracle = {
  name: 'core-f64',
  solve(inp, d) {
    const r = solveNode(inp, d);
    return { c: r.c, residual: r.residual_D, iterations: r.iterations };
  },
  spectral: (inp, c) => spectralNode(inp, c),
};

/** Nodes q0..q1 of a table (model.js solveNodes / pdNodes / printNodes). */
export function tableNodes(oracle: F64Oracle, inp: SolveInputs | SpectralInputs, q0: number, q1: number): Float32Array {
  const out = new Float32Array((q1 - q0) * 4);
  const [lo, hi] = inp.range;
  for (let q = q0; q < q1; q++) {
    const a = nodeAt(q, inp.N, lo, hi);
    const o = 4 * (q - q0);
    if (inp.kind === 'solve') {
      const K = inp.K;
      const d: Vec3 = [0, 1, 2].map((k) => K[k]![0] * a[0] + K[k]![1] * a[1] + K[k]![2] * a[2] + inp.Dbase[k]!) as Vec3;
      const r = oracle.solve(inp, d);
      out[o] = r.c[0]; out[o + 1] = r.c[1]; out[o + 2] = r.c[2]; out[o + 3] = r.residual;
    } else {
      const v = oracle.spectral(inp, a);
      out[o] = v[0]; out[o + 1] = v[1]; out[o + 2] = v[2]; out[o + 3] = 1;
    }
  }
  return out;
}

/** Main-thread f64 build (the last-resort backend and the reference for bitwise worker checks). */
export function buildTableF64(oracle: F64Oracle, inp: SolveInputs | SpectralInputs): Table {
  return { N: inp.N, range: inp.range, data: tableNodes(oracle, inp, 0, inp.N ** 3) };
}

// ---- CPU models of the GPU lookups ----

/** Trilinear lookup without the half-texel offset (model.js look3): node i at u = i/(N−1). */
export function look3(T: Table, a: readonly number[]): number[] {
  const { N, data, range: [lo, hi] } = T;
  const f = (v: number): [number, number] => {
    const u = Math.min(N - 1, Math.max(0, ((v - lo) / (hi - lo)) * (N - 1)));
    const i = Math.min(N - 2, Math.floor(u));
    return [i, u - i];
  };
  const [i, fx] = f(a[0]!);
  const [j, fy] = f(a[1]!);
  const [k, fz] = f(a[2]!);
  const out = [0, 0, 0, 0];
  for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
    const q = 4 * (i + dx + N * (j + dy + N * (k + dz)));
    for (let c = 0; c < 4; c++) out[c]! += w * data[q + c]!;
  }
  return out;
}

/** Tetrahedral lookup (Kasson et al. 1995), the CPU model of kernels' tetra(). */
export function tetra3(T: Table, a: readonly number[]): number[] {
  const { N, data, range: [lo, hi] } = T;
  const u = [0, 1, 2].map((k) => Math.min(1, Math.max(0, (a[k]! - lo) / (hi - lo))) * (N - 1));
  const i = u.map((x) => Math.min(Math.floor(x), N - 2));
  const t = u.map((x, k) => x - i[k]!);
  const at = (dx: number, dy: number, dz: number, c: number) => data[4 * (i[0]! + dx + N * (i[1]! + dy + N * (i[2]! + dz))) + c]!;
  const [tx, ty, tz] = t as [number, number, number];
  let e1: Vec3, e2: Vec3, f: Vec3;
  if (tx >= ty && ty >= tz) { e1 = [1, 0, 0]; e2 = [1, 1, 0]; f = [tx, ty, tz]; }
  else if (tx >= tz && tz >= ty) { e1 = [1, 0, 0]; e2 = [1, 0, 1]; f = [tx, tz, ty]; }
  else if (tz >= tx && tx >= ty) { e1 = [0, 0, 1]; e2 = [1, 0, 1]; f = [tz, tx, ty]; }
  else if (ty >= tx && tx >= tz) { e1 = [0, 1, 0]; e2 = [1, 1, 0]; f = [ty, tx, tz]; }
  else if (ty >= tz && tz >= tx) { e1 = [0, 1, 0]; e2 = [0, 1, 1]; f = [ty, tz, tx]; }
  else { e1 = [0, 0, 1]; e2 = [0, 1, 1]; f = [tz, ty, tx]; }
  return [0, 1, 2, 3].map((c) => (1 - f[0]) * at(0, 0, 0, c) + (f[0] - f[1]) * at(e1[0], e1[1], e1[2], c) + (f[1] - f[2]) * at(e2[0], e2[1], e2[2], c) + f[2] * at(1, 1, 1, c));
}
