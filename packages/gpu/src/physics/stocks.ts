// INTERIM stock registry: Chromogen's spektrafilm-format JSON for three stocks plus the generic Bayer
// camera (fixtures/chromogen, copied from st-data/cg). TODO(CHB-004): resolve stock ids through data
// packs; the engine then hashes the pack arrays into its table keys (keys.ts already hashes arrays).
import goldText from '../../../../fixtures/chromogen/kodak_gold_200.json?raw';
import portraText from '../../../../fixtures/chromogen/kodak_portra_400.json?raw';
import enduraText from '../../../../fixtures/chromogen/kodak_portra_endura.json?raw';
import cameraText from '../../../../fixtures/chromogen/generic-bayer.json?raw';
import { ChromobenchError } from '@chromobench/contract';
import { loadStock, type CameraJson, type Stock, type StockJson } from './spectral.ts';

const STOCKS: Record<string, string> = { kodak_gold_200: goldText, kodak_portra_400: portraText, kodak_portra_endura: enduraText };
const cache = new Map<string, Stock>();

export function stock(id: string): Stock {
  let s = cache.get(id);
  if (!s) {
    const t = STOCKS[id];
    if (!t) throw new ChromobenchError({ code: 'E_STOCK_UNKNOWN', message: `the GPU engine's interim stock data has no ${id}`, valid: Object.keys(STOCKS) });
    s = loadStock(JSON.parse(t) as StockJson);
    cache.set(id, s);
  }
  return s;
}
export const knownStocks = (): string[] => Object.keys(STOCKS);
let cam: CameraJson | null = null;
export const camera = (): CameraJson => (cam ??= JSON.parse(cameraText) as CameraJson);
