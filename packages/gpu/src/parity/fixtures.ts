// The Gold 200 table configuration (guide §8): scanner xt5-fitted, Kodak Gold 200, Portra Endura, N = 33.
import { chainConstants, curveRows, pdInputs, printInputs, solveInputs } from '../physics/setup.ts';
import { scannerChannels, type Stock } from '../physics/spectral.ts';
import { camera, stock } from '../physics/stocks.ts';
import type { SolveInputs, SpectralInputs } from '../tables/inputs.ts';

export interface Setup { solve: SolveInputs; pd: SpectralInputs; print: SpectralInputs; film: Stock; paper: Stock }

export function setup(film = 'kodak_gold_200', paper = 'kodak_portra_endura', scanner = 'xt5-fitted', N = 33): Setup {
  const f = stock(film);
  const p = stock(paper);
  return { solve: solveInputs(scannerChannels(scanner, camera()), f, N), pd: pdInputs(f, p, 3200, N), print: printInputs(p, { N }), film: f, paper: p };
}

export { camera, chainConstants, curveRows, stock };
