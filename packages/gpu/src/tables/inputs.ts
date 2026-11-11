// What a table build consumes. Everything a table's values depend on is in these arrays, so the
// content key (keys.ts) hashes exactly these, and an f64 oracle (interim port or CHB-003 core) can
// build the same table from them.
export type Vec3 = [number, number, number];
export type Mat3 = [Vec3, Vec3, Vec3];
type F = Float64Array | Float32Array | number[];

/** Table domains (Chromogen model.js 1628–1633). */
export const N3 = 33;
export const A_RANGE: [number, number] = [-0.25, 2.55];
export const C_RANGE: [number, number] = [0, 2.6];
export const CP_RANGE: [number, number] = [0, 2.7];
export const X_RANGE: [number, number] = [-2.5, 2.5];

export interface SolveInputs {
  kind: 'solve';
  /** Normalised channel responsivities P̂_k. */
  P: [F, F, F];
  /** Unit dye spectra ε_j. */
  E: [F, F, F];
  /** Base density spectrum. */
  B: F;
  /** K_kj = density channel k reads from one unit of dye j; d = K a + Dbase. */
  K: Mat3;
  Dbase: Vec3;
  /** Dye bounds. */
  lo: number;
  hi: number;
  tol: number;
  gtol: number;
  maxIt: number;
  activeSet: boolean;
  range: [number, number];
  N: number;
}

export interface SpectralInputs {
  kind: 'pd' | 'print';
  /** 'log': −log₁₀ Σ W 10^−D (printing density); 'lin': M · Σ W 10^−D (adapted XYZ). */
  mode: 'log' | 'lin';
  E: [F, F, F];
  B: F;
  W: [F, F, F];
  M: Mat3;
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
