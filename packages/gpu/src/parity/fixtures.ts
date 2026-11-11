// The Gold 200 table configuration (guide §8): scanner xt5-fitted, Kodak Gold 200, Portra Endura,
// N = 33. Interim stock data from Chromogen (fixtures/chromogen, copied from st-data/cg).
// TODO(CHB-004): load from data packs.
import goldText from '../../../../fixtures/chromogen/kodak_gold_200.json?raw';
import portraText from '../../../../fixtures/chromogen/kodak_portra_400.json?raw';
import enduraText from '../../../../fixtures/chromogen/kodak_portra_endura.json?raw';
import cameraText from '../../../../fixtures/chromogen/generic-bayer.json?raw';
import { chainConstants, curveRows, pdInputs, printInputs, solveInputs } from '../physics/setup.ts';
import { loadStock, scannerChannels, type CameraJson, type Stock, type StockJson } from '../physics/spectral.ts';
import type { SolveInputs, SpectralInputs } from '../tables/inputs.ts';

const STOCKS: Record<string, string> = { kodak_gold_200: goldText, kodak_portra_400: portraText, kodak_portra_endura: enduraText };
const cache = new Map<string, Stock>();

export function stock(id: string): Stock {
  let s = cache.get(id);
  if (!s) {
    const t = STOCKS[id];
    if (!t) throw new Error(`interim stock data has no ${id}; known: ${Object.keys(STOCKS).join(', ')}`);
    s = loadStock(JSON.parse(t) as StockJson);
    cache.set(id, s);
  }
  return s;
}
export const knownStocks = (): string[] => Object.keys(STOCKS);
export const camera = (): CameraJson => JSON.parse(cameraText) as CameraJson;

export interface Setup { solve: SolveInputs; pd: SpectralInputs; print: SpectralInputs; film: Stock; paper: Stock }

export function setup(film = 'kodak_gold_200', paper = 'kodak_portra_endura', scanner = 'xt5-fitted', N = 33): Setup {
  const f = stock(film);
  const p = stock(paper);
  return { solve: solveInputs(scannerChannels(scanner, camera()), f, N), pd: pdInputs(f, p, 3200, N), print: printInputs(p, { N }), film: f, paper: p };
}

export { chainConstants, curveRows };
