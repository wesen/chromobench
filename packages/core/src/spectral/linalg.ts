// Small dense linear algebra (Chromogen linalg.js, 05-inline.js 569–645).
import { fail } from '@chromobench/contract';

export type Vec3 = [number, number, number];
export type Mat3 = [Vec3, Vec3, Vec3]; // row-major: M[row][col]

export const transpose = (A: Mat3): Mat3 => [[A[0][0], A[1][0], A[2][0]], [A[0][1], A[1][1], A[2][1]], [A[0][2], A[1][2], A[2][2]]];
export const mulMV = (A: Mat3, x: ArrayLike<number>): Vec3 => [
  A[0][0] * x[0]! + A[0][1] * x[1]! + A[0][2] * x[2]!,
  A[1][0] * x[0]! + A[1][1] * x[1]! + A[1][2] * x[2]!,
  A[2][0] * x[0]! + A[2][1] * x[1]! + A[2][2] * x[2]!,
];
export const mulMM = (A: Mat3, B: Mat3): Mat3 => [0, 1, 2].map((i) => [0, 1, 2].map((j) => A[i]![0] * B[0][j]! + A[i]![1] * B[1][j]! + A[i]![2] * B[2][j]!)) as Mat3;
export const det3 = (A: Mat3): number =>
  A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);

export function inv3(A: Mat3): Mat3 {
  const d = det3(A);
  if (!(Math.abs(d) > 1e-300)) fail('E_EVAL', 'singular 3×3 matrix');
  const c = (i: number, j: number): number => {
    const r = [0, 1, 2].filter((x) => x !== i);
    const s = [0, 1, 2].filter((x) => x !== j);
    return A[r[0]!]![s[0]!]! * A[r[1]!]![s[1]!]! - A[r[0]!]![s[1]!]! * A[r[1]!]![s[0]!]!;
  };
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => (((i + j) % 2 ? -1 : 1) * c(j, i)) / d)) as Mat3;
}
export const solve3 = (A: Mat3, b: ArrayLike<number>): Vec3 => mulMV(inv3(A), b);
export const norm2 = (r: ArrayLike<number>): number => {
  let s = 0;
  for (let i = 0; i < r.length; i++) s += r[i]! * r[i]!;
  return s;
};
export const sub3 = (a: ArrayLike<number>, b: ArrayLike<number>): Vec3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
export const eye3 = (): Mat3 => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/** Eigenvalues of a symmetric 3×3 matrix, ascending (cyclic Jacobi). */
export function symEig3(S: Mat3): Vec3 {
  let M = S.map((r) => r.slice()) as Mat3;
  for (let sweep = 0; sweep < 60; sweep++) {
    let p = 0;
    let qq = 1;
    for (const [i, j] of [[0, 1], [0, 2], [1, 2]] as const) if (Math.abs(M[i][j]) > Math.abs(M[p]![qq]!)) { p = i; qq = j; }
    if (Math.abs(M[p]![qq]!) < 1e-300 || Math.abs(M[p]![qq]!) < 1e-17 * (Math.abs(M[p]![p]!) + Math.abs(M[qq]![qq]!))) break;
    const th = 0.5 * Math.atan2(2 * M[p]![qq]!, M[qq]![qq]! - M[p]![p]!);
    const c = Math.cos(th);
    const s = Math.sin(th);
    const R = eye3();
    R[p]![p] = c; R[qq]![qq] = c; R[p]![qq] = s; R[qq]![p] = -s;
    M = mulMM(mulMM(transpose(R), M), R);
  }
  return [M[0][0], M[1][1], M[2][2]].sort((a, b) => a - b) as Vec3;
}

/** Singular values, descending. */
export function singularValues3(A: Mat3): Vec3 {
  const e = symEig3(mulMM(transpose(A), A));
  return [Math.sqrt(Math.max(0, e[2])), Math.sqrt(Math.max(0, e[1])), Math.sqrt(Math.max(0, e[0]))];
}
export const minSingular = (A: Mat3): number => singularValues3(A)[2];

/** Generic bounded Levenberg–Marquardt (Chromogen lm): finite-difference Jacobian unless given. */
export function lm(
  f: (x: number[]) => number[], x0: number[],
  o: { jac?: (x: number[]) => number[][]; lo?: number; hi?: number; tol?: number; maxIt?: number; h?: number } = {},
): { x: number[]; residual: number; iterations: number } {
  const { lo = -Infinity, hi = Infinity, tol = 1e-12, maxIt = 50, h = 1e-6 } = o;
  const clip = (x: number[]): number[] => x.map((v) => Math.min(hi, Math.max(lo, v)));
  const J = o.jac ?? ((x: number[]): number[][] => {
    const r0 = f(x);
    return r0.map((_, k) => x.map((_v, j) => {
      const y = x.slice();
      y[j]! += h;
      return (f(y)[k]! - r0[k]!) / h;
    }));
  });
  const n = x0.length;
  let x = clip(x0);
  let r = f(x);
  let F = norm2(r);
  let mu = 1e-3;
  let it = 0;
  for (; it < maxIt && F > tol; it++) {
    const Jx = J(x);
    const A = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_v, j) => Jx.reduce((s, row) => s + row[i]! * row[j]!, 0)));
    const g = Array.from({ length: n }, (_, j) => Jx.reduce((s, row, k) => s + row[j]! * r[k]!, 0));
    let improved = false;
    for (let tries = 0; tries < 12 && !improved; tries++) {
      const B = A.map((row, i) => row.map((v, j) => v + (i === j ? mu * (1 + A[i]![i]!) : 0)));
      const step = solveN(B, g.map((v) => -v));
      if (!step) { mu *= 10; continue; }
      const x1 = clip(x.map((v, i) => v + step[i]!));
      const r1 = f(x1);
      const F1 = norm2(r1);
      if (F1 < F) {
        x = x1; r = r1; F = F1;
        mu = Math.max(mu / 3, 1e-12);
        improved = true;
      } else mu *= 4;
    }
    if (!improved) break;
  }
  return { x, residual: Math.sqrt(F), iterations: it };
}

/** Gaussian elimination with partial pivoting; null if singular. */
export function solveN(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    if (!(Math.abs(M[p]![c]!) > 1e-300)) return null;
    [M[c], M[p]] = [M[p]!, M[c]!];
    for (let r = c + 1; r < n; r++) {
      const k = M[r]![c]! / M[c]![c]!;
      for (let j = c; j <= n; j++) M[r]![j]! -= k * M[c]![j]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r]![n]!;
    for (let j = r + 1; j < n; j++) s -= M[r]![j]! * x[j]!;
    x[r] = s / M[r]![r]!;
  }
  return x;
}
