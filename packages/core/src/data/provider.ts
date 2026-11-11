// The data core consumes, behind one interface. Interim implementation: ./interim.ts (CHB-001 extracts);
// CHB-004's packs replace it by implementing the same interface.
import type { StockData } from '../spectral/stock.ts';

export type Cmy = { c: number; m: number; y: number };

export interface PhysicsData {
  readonly id: string;
  stockIds(): string[];
  stock(id: string): StockData;
  /** CIE 1931 2° colour-matching functions x̄, ȳ, z̄ on the 81-point grid. */
  cmf(): [Float64Array, Float64Array, Float64Array];
  /** Named illuminant SPD on the grid (D50, D55, D65, TH-KG3, …); 'bb<T>' gives a blackbody. */
  illuminant(name: string): Float64Array;
  illuminantNames(): string[];
  /** Dichroic filter band transmittance profiles F_C, F_M, F_Y. */
  dichroic(): [Float64Array, Float64Array, Float64Array];
  /** Neutral filter pack for (paper, film), in CC; undefined when the database has none. */
  neutralFilter(paper: string, film: string): Cmy | undefined;
  /** Camera responsivities R, G, B. */
  camera(id: string): [Float64Array, Float64Array, Float64Array];
  /** Scanner light SPD. */
  light(id: string): Float64Array;
}
