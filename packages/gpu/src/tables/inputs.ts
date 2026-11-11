// What a table build consumes. Everything a table's values depend on is in these arrays, so the
// content key (keys.ts) hashes exactly these, and the f64 oracle (core's solveNode / spectralNode)
// builds the same table from them. The arrays come from @chromobench/core (physics/core.ts):
// SolveArrays from core's forward model, SpectralArrays from its enlarger and viewing.
import type { SolveArrays, SpectralArrays } from '@chromobench/core/tables';

export type Vec3 = [number, number, number];
export type Mat3 = [Vec3, Vec3, Vec3];

/** Table domains (Chromogen model.js 1628–1633; core tables.ts uses the same). */
export const N3 = 33;
export const A_RANGE: [number, number] = [-0.25, 2.55];
export const C_RANGE: [number, number] = [0, 2.6];
export const CP_RANGE: [number, number] = [0, 2.7];
export const X_RANGE: [number, number] = [-2.5, 2.5];

/** The dye-solve table: a = K⁻¹(D − D_base) → (c, residual); d = K a + Dbase. */
export interface SolveInputs extends SolveArrays {
  kind: 'solve';
  range: [number, number];
  N: number;
}

/** 'pd': printing density −log₁₀ Σ W 10^−D; 'print': XYZ under the viewing light, M · Σ W 10^−D. */
export interface SpectralInputs extends SpectralArrays {
  kind: 'pd' | 'print';
  range: [number, number];
  N: number;
}

export type TableInputs = SolveInputs | SpectralInputs;

/** A built N³ table, x fastest, four f32 per node. */
export interface Table {
  N: number;
  range: [number, number];
  data: Float32Array;
}

export function nodeAt(q: number, N: number, lo: number, hi: number): Vec3 {
  const st = (hi - lo) / (N - 1);
  return [lo + (q % N) * st, lo + (Math.floor(q / N) % N) * st, lo + Math.floor(q / (N * N)) * st];
}
