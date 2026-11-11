// The contract's ScannerForward (source.ts, DR-9) on core's forward model: what packages/ingest needs
// for stock ranking, the base check and the conditioning map, without depending on core itself.
import type { ScannerForward } from '@chromobench/contract';
import type { PhysicsData } from '../data/provider.ts';
import { DEFAULT_CONVENTIONS, type Conventions } from '../spectral/conventions.ts';
import { minSingular, type Mat3 } from '../spectral/linalg.ts';
import { resolveStock } from '../spectral/stock.ts';
import { makeScanner } from './scanner.ts';
import { forwardArraysOf, forwardFromArrays, forwardJacobian, type ForwardCore } from './solve.ts';

const I3: Mat3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/**
 * readBase(stock) = the scanner's reading of the base; sigmaMin(stock, c) = σ₃ of ∂D/∂c at c (§3.2).
 * Same forward arrays as invert.dyes under `conv`; no start matrix is needed, so a degenerate stock
 * (σ₃ = 0, the ill-conditioned case the conditioning map flags) is fine.
 */
export function scannerForward(data: PhysicsData, scanner: string, conv: Conventions = DEFAULT_CONVENTIONS): ScannerForward {
  const model = makeScanner(data, scanner);
  const memo = new Map<string, ForwardCore>();
  const fwd = (stock: string): ForwardCore => {
    let f = memo.get(stock);
    if (!f) memo.set(stock, (f = forwardFromArrays(forwardArraysOf(model, resolveStock(data.stock(stock), conv), I3))));
    return f;
  };
  return {
    scanner,
    readBase: (stock) => [...fwd(stock).Dbase],
    sigmaMin: (stock, c) => minSingular(forwardJacobian(fwd(stock), c)),
  };
}
