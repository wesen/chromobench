// The f64 oracle interface the parity harness and the worker build run against, and its INTERIM
// implementation: a port of Chromogen's solve.js makeSolver (05-inline.js 648–790), model.js
// solveNodes / pdOf / printNodes (1669–1803) and look3 (1884–1897).
//
// TODO(CHB-003): plug @chromobench/core in here. Implement F64Oracle with core's solver and spectral
// integrals and pass it to buildTableF64 / the parity page (src/parity/page-api.ts `setOracle`).
import { nodeAt, type SolveInputs, type SpectralInputs, type Table, type Vec3 } from '../tables/inputs.ts';

export interface SolveResult { c: Vec3; residual: number; iterations: number }

export interface F64Oracle {
  readonly name: string;
  solve(inp: SolveInputs, d: Vec3): SolveResult;
  spectral(inp: SpectralInputs, c: Vec3): Vec3;
}

const LN10 = Math.LN10;

/** Chromogen's spectral LM solve with the active-set step, f64. */
function solveF64(inp: SolveInputs, d: Vec3): SolveResult {
  const [P0, P1, P2] = inp.P;
  const [E0, E1, E2] = inp.E;
  const B = inp.B;
  const n = B.length;
  const { lo, hi, tol, gtol, maxIt, activeSet } = inp;
  const J = new Float64Array(9);
  const r = new Float64Array(3);
  const evalF = (c0: number, c1: number, c2: number, withJ: boolean): number => {
    let s0 = 0, s1 = 0, s2 = 0, a00 = 0, a01 = 0, a02 = 0, a10 = 0, a11 = 0, a12 = 0, a20 = 0, a21 = 0, a22 = 0;
    for (let i = 0; i < n; i++) {
      const t = Math.exp(-LN10 * (B[i]! + c0 * E0[i]! + c1 * E1[i]! + c2 * E2[i]!));
      const w0 = P0[i]! * t, w1 = P1[i]! * t, w2 = P2[i]! * t;
      s0 += w0; s1 += w1; s2 += w2;
      if (withJ) {
        const e0 = E0[i]!, e1 = E1[i]!, e2 = E2[i]!;
        a00 += w0 * e0; a01 += w0 * e1; a02 += w0 * e2;
        a10 += w1 * e0; a11 += w1 * e1; a12 += w1 * e2;
        a20 += w2 * e0; a21 += w2 * e1; a22 += w2 * e2;
      }
    }
    r[0] = -Math.log10(s0) - d[0];
    r[1] = -Math.log10(s1) - d[1];
    r[2] = -Math.log10(s2) - d[2];
    if (withJ) {
      J[0] = a00 / s0; J[1] = a01 / s0; J[2] = a02 / s0;
      J[3] = a10 / s1; J[4] = a11 / s1; J[5] = a12 / s1;
      J[6] = a20 / s2; J[7] = a21 / s2; J[8] = a22 / s2;
    }
    return r[0] * r[0] + r[1] * r[1] + r[2] * r[2];
  };
  const clip = (v: number) => (v < lo ? lo : v > hi ? hi : v);
  // analytical start K⁻¹(d − Dbase)
  const start = mulInv(inp.K, [d[0] - inp.Dbase[0], d[1] - inp.Dbase[1], d[2] - inp.Dbase[2]]);
  let x0 = clip(start[0]), x1 = clip(start[1]), x2 = clip(start[2]);
  let F = evalF(x0, x1, x2, true);
  let mu = 1e-3;
  let it = 0;
  for (; it < maxIt && F > tol; it++) {
    const A00 = J[0]! * J[0]! + J[3]! * J[3]! + J[6]! * J[6]!, A01_ = J[0]! * J[1]! + J[3]! * J[4]! + J[6]! * J[7]!, A02_ = J[0]! * J[2]! + J[3]! * J[5]! + J[6]! * J[8]!;
    const A11 = J[1]! * J[1]! + J[4]! * J[4]! + J[7]! * J[7]!, A12_ = J[1]! * J[2]! + J[4]! * J[5]! + J[7]! * J[8]!, A22 = J[2]! * J[2]! + J[5]! * J[5]! + J[8]! * J[8]!;
    let g0 = J[0]! * r[0]! + J[3]! * r[1]! + J[6]! * r[2]!, g1 = J[1]! * r[0]! + J[4]! * r[1]! + J[7]! * r[2]!, g2 = J[2]! * r[0]! + J[5]! * r[1]! + J[8]! * r[2]!;
    let h0 = false, h1 = false, h2 = false;
    if (activeSet) {
      h0 = (x0 <= lo && g0 > 0) || (x0 >= hi && g0 < 0);
      h1 = (x1 <= lo && g1 > 0) || (x1 >= hi && g1 < 0);
      h2 = (x2 <= lo && g2 > 0) || (x2 >= hi && g2 < 0);
      if (Math.max(h0 ? 0 : Math.abs(g0), h1 ? 0 : Math.abs(g1), h2 ? 0 : Math.abs(g2)) < gtol) break;
      if (h0) g0 = 0;
      if (h1) g1 = 0;
      if (h2) g2 = 0;
    }
    let improved = false;
    for (let tries = 0; tries < 12 && !improved; tries++) {
      let b00 = A00 + mu * (1 + A00), b11 = A11 + mu * (1 + A11), b22 = A22 + mu * (1 + A22), A01 = A01_, A02 = A02_, A12 = A12_;
      if (h0) { b00 = 1; A01 = 0; A02 = 0; }
      if (h1) { b11 = 1; A01 = 0; A12 = 0; }
      if (h2) { b22 = 1; A02 = 0; A12 = 0; }
      const det = b00 * (b11 * b22 - A12 * A12) - A01 * (A01 * b22 - A12 * A02) + A02 * (A01 * A12 - b11 * A02);
      if (!(Math.abs(det) > 1e-300)) { mu *= 10; continue; }
      const i00 = (b11 * b22 - A12 * A12) / det, i01 = (A02 * A12 - A01 * b22) / det, i02 = (A01 * A12 - A02 * b11) / det;
      const i11 = (b00 * b22 - A02 * A02) / det, i12 = (A01 * A02 - b00 * A12) / det, i22 = (b00 * b11 - A01 * A01) / det;
      const y0 = clip(x0 - (i00 * g0 + i01 * g1 + i02 * g2)), y1 = clip(x1 - (i01 * g0 + i11 * g1 + i12 * g2)), y2 = clip(x2 - (i02 * g0 + i12 * g1 + i22 * g2));
      const F1 = evalF(y0, y1, y2, false);
      if (F1 < F) {
        x0 = y0; x1 = y1; x2 = y2;
        mu = Math.max(mu / 3, 1e-12);
        improved = true;
        F = evalF(x0, x1, x2, true);
      } else mu *= 4;
    }
    if (!improved) break;
  }
  return { c: [x0, x1, x2], residual: Math.sqrt(F), iterations: it };
}

function spectralF64(inp: SpectralInputs, c: Vec3): Vec3 {
  const [E0, E1, E2] = inp.E;
  const [W0, W1, W2] = inp.W;
  const B = inp.B;
  let s0 = 0, s1 = 0, s2 = 0;
  for (let i = 0; i < B.length; i++) {
    const t = Math.pow(10, -(B[i]! + c[0] * E0[i]! + c[1] * E1[i]! + c[2] * E2[i]!));
    s0 += W0[i]! * t; s1 += W1[i]! * t; s2 += W2[i]! * t;
  }
  if (inp.mode === 'log') return [-Math.log10(s0), -Math.log10(s1), -Math.log10(s2)];
  const M = inp.M;
  return [M[0][0] * s0 + M[0][1] * s1 + M[0][2] * s2, M[1][0] * s0 + M[1][1] * s1 + M[1][2] * s2, M[2][0] * s0 + M[2][1] * s1 + M[2][2] * s2];
}

export function inv3(A: readonly (readonly number[])[]): number[][] {
  const a = A as number[][];
  const det = a[0]![0]! * (a[1]![1]! * a[2]![2]! - a[1]![2]! * a[2]![1]!) - a[0]![1]! * (a[1]![0]! * a[2]![2]! - a[1]![2]! * a[2]![0]!) + a[0]![2]! * (a[1]![0]! * a[2]![1]! - a[1]![1]! * a[2]![0]!);
  const c = (i: number, j: number) => {
    const rr = [0, 1, 2].filter((x) => x !== i);
    const ss = [0, 1, 2].filter((x) => x !== j);
    return a[rr[0]!]![ss[0]!]! * a[rr[1]!]![ss[1]!]! - a[rr[0]!]![ss[1]!]! * a[rr[1]!]![ss[0]!]!;
  };
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => (((i + j) % 2 ? -1 : 1) * c(j, i)) / det));
}

function mulInv(K: readonly (readonly number[])[], v: number[]): Vec3 {
  const I = inv3(K);
  return [0, 1, 2].map((r) => I[r]![0]! * v[0]! + I[r]![1]! * v[1]! + I[r]![2]! * v[2]!) as Vec3;
}

/** The interim oracle: Chromogen's f64 code, ported. */
export const chromogenOracle: F64Oracle = { name: 'chromogen-f64-interim', solve: solveF64, spectral: spectralF64 };

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
