// Stock ranking from the absolute rebate density (guide §2.3, §5.8). Evidence only: the scan cannot
// name its stock (textbook §3.8); the user names it.
import type { ScannerForward, Vec3 } from '@chromobench/contract';

export interface StockRank {
  stock: string;
  /** max_k |D_reb,k − D_base,k|. */
  maxDiffD: number;
  rmsD: number;
  /** Max difference after removing the mean over channels (robust to an unknown common open-gate factor). */
  shapeDiffD: number;
  /** maxDiffD ≤ 0.02 D. */
  consistent: boolean;
}

export function rankStocks(rebateAbsD: Vec3, stocks: string[], fwd: ScannerForward, tol = 0.02): StockRank[] {
  return stocks
    .map((stock) => {
      const b = fwd.readBase(stock);
      const d = rebateAbsD.map((v, k) => v - b[k]!);
      const mean = (d[0]! + d[1]! + d[2]!) / 3;
      const maxDiffD = Math.max(...d.map(Math.abs));
      return {
        stock, maxDiffD,
        rmsD: Math.sqrt(d.reduce((s, v) => s + v * v, 0) / 3),
        shapeDiffD: Math.max(...d.map((v) => Math.abs(v - mean))),
        consistent: maxDiffD <= tol,
      };
    })
    .sort((a, b) => a.maxDiffD - b.maxDiffD || a.stock.localeCompare(b.stock));
}

/** Absolute rebate density, −log10(T_reb / T_open); null without an open gate (W_NO_OPEN_GATE upstream). */
export function rebateAbsoluteD(rebateT: Vec3, openGate: Vec3 | null): Vec3 | null {
  return openGate ? (rebateT.map((t, k) => -Math.log10(t / openGate[k]!)) as Vec3) : null;
}
