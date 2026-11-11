// INTERIM: a minimal ScannerForward (contract source.ts, DR-9) built from Chromogen's channels.js maths
// (05-inline.js 477–567), until @chromobench/core (CHB-003) provides the real one. Ingest itself only
// depends on the ScannerForward interface; this helper exists for tests and for hosts without core.
import type { ScannerForward, Vec3 } from '@chromobench/contract';

export interface StockSpectra {
  /** Base (mask + support + fog) spectral density on the grid. */
  base: number[];
  /** Unit dye spectral densities, cyan, magenta, yellow. */
  dyes: [number[], number[], number[]];
}

/** Channels: three responsivities on one grid, each normalised to sum 1. */
export function normaliseChannels(P: [number[], number[], number[]]): [number[], number[], number[]] {
  return P.map((p) => {
    const t = p.reduce((s, v) => s + v, 0);
    return p.map((v) => v / t);
  }) as [number[], number[], number[]];
}

/** read(P, D) = −log10 Σ P̂ 10^(−D), per channel. */
export function readChannels(P: [number[], number[], number[]], D: ArrayLike<number>): Vec3 {
  return P.map((p) => {
    let s = 0;
    for (let i = 0; i < p.length; i++) s += p[i]! * 10 ** -D[i]!;
    return -Math.log10(s);
  }) as Vec3;
}

/** Gaussian of the given centre and FWHM sampled on `wl`. */
export function gaussian(wl: number[], centre: number, fwhm: number): number[] {
  const s = fwhm / (2 * Math.sqrt(2 * Math.log(2)));
  return wl.map((l) => Math.exp(-0.5 * ((l - centre) / s) ** 2));
}

/** Eigenvalues of a symmetric 3×3 matrix by cyclic Jacobi rotations. */
export function symEig3(A: number[][]): number[] {
  const a = A.map((r) => [...r]);
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += a[p]![q]! ** 2;
    if (off < 1e-30) break;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) {
      const apq = a[p]![q]!;
      if (Math.abs(apq) < 1e-300) continue;
      const theta = (a[q]![q]! - a[p]![p]!) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k]![p]!, akq = a[k]![q]!;
        a[k]![p] = c * akp - s * akq;
        a[k]![q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p]![k]!, aqk = a[q]![k]!;
        a[p]![k] = c * apk - s * aqk;
        a[q]![k] = s * apk + c * aqk;
      }
    }
  }
  return [a[0]![0]!, a[1]![1]!, a[2]![2]!];
}

/** Smallest singular value of a 3×3 matrix. */
export function minSingular(J: number[][]): number {
  const JtJ = [0, 1, 2].map((i) => [0, 1, 2].map((j) => J[0]![i]! * J[0]![j]! + J[1]![i]! * J[1]![j]! + J[2]![i]! * J[2]![j]!));
  return Math.sqrt(Math.max(0, Math.min(...symEig3(JtJ))));
}

/** A ScannerForward over explicit spectra: readBase and σ₃ of the analytic Jacobian of read(base + Σ c_j E_j). */
export function makeScannerForward(scanner: string, channels: [number[], number[], number[]], stocks: Record<string, StockSpectra>): ScannerForward {
  const P = normaliseChannels(channels);
  const get = (stock: string): StockSpectra => {
    const s = stocks[stock];
    if (!s) throw new Error(`forward stub: unknown stock ${stock}`);
    return s;
  };
  return {
    scanner,
    readBase: (stock) => readChannels(P, get(stock).base),
    sigmaMin: (stock, c) => {
      const s = get(stock);
      const n = s.base.length;
      const T = new Float64Array(n);
      for (let i = 0; i < n; i++) T[i] = 10 ** -(s.base[i]! + c[0] * s.dyes[0][i]! + c[1] * s.dyes[1][i]! + c[2] * s.dyes[2][i]!);
      // ∂D_k/∂c_j = Σ P_k T E_j / Σ P_k T (the density-weighted mean of E_j under channel k)
      const J = P.map((p) => {
        let den = 0;
        const num = [0, 0, 0];
        for (let i = 0; i < n; i++) {
          const wt = p[i]! * T[i]!;
          den += wt;
          for (let j = 0; j < 3; j++) num[j]! += wt * s.dyes[j]![i]!;
        }
        return num.map((v) => v / den);
      });
      return minSingular(J);
    },
  };
}
