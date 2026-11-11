// Stock data and its resolution under a convention (§1.2, guide §5.2–5.3).
// StockData is the shape CHB-004 ships; core never parses files (see data/ for the interim loader).
import { fail } from '@chromobench/contract';
import type { Conventions } from './conventions.ts';
import type { Mat3, Vec3 } from './linalg.ts';
import { interp, NW } from './spectrum.ts';

export interface CurveModel {
  /** [channel][sublayer] */
  centres: Mat3;
  amps: Mat3;
  sigmas: Mat3;
}

export interface StockData {
  id: string;
  name?: string;
  role: 'film' | 'paper';
  type: 'negative' | 'positive' | string;
  /** 3 × 81 log10 sensitivities, NaN allowed. */
  logSensitivity: Float64Array[];
  /** 3 × 81 unit dye spectra (spectral density of one unit of dye), NaN allowed. */
  dyes: Float64Array[];
  /** 81 base density (support, mask, fog), NaN allowed. */
  base: Float64Array;
  /** 256 log exposures (−3 … 4). */
  logExposure: Float64Array;
  /** 3 characteristic curves on logExposure (dye amounts). */
  curves: Float64Array[];
  curveModel?: CurveModel;
  meta: { refIlluminant: string; viewIlluminant: string; antihalation?: string; use?: string; targetPrint?: string | null; densitometer?: string };
  license?: string;
}

/** Monotone characteristic curve (Chromogen stock.js 393–417: running max + 1e-9). */
export class Curve {
  readonly logH: Float64Array;
  readonly D: Float64Array;
  constructor(logH: ArrayLike<number>, D: ArrayLike<number>) {
    const d = Float64Array.from(D);
    for (let i = 1; i < d.length; i++) if (d[i]! <= d[i - 1]!) d[i] = d[i - 1]! + 1e-9;
    this.logH = Float64Array.from(logH);
    this.D = d;
  }
  at(x: number): number {
    return interp(this.logH, this.D, x, this.D[0]!, this.D[this.D.length - 1]!);
  }
  inverse(y: number): number {
    return interp(this.D, this.logH, y, this.logH[0]!, this.logH[this.logH.length - 1]!);
  }
  slope(x: number, h = 1e-3): number {
    return (this.at(x + h) - this.at(x - h)) / (2 * h);
  }
  shift(dx_logH: number): Curve {
    return new Curve(this.logH.map((v) => v + dx_logH), this.D);
  }
  scaleGamma(g: number, about_logH = 0): Curve {
    const d0 = this.at(about_logH);
    return new Curve(this.logH, this.D.map((v) => d0 + g * (v - d0)));
  }
  min(): number {
    return this.D[0]!;
  }
}

/** StockData resolved under a convention: NaN → 0 plus a pass mask (guide §5.2). */
export interface Stock {
  data: StockData;
  conv: Conventions;
  /** 10^logSensitivity, missing → 0. */
  sens: Float64Array[];
  /** Unit dye spectra, missing → 0. */
  dyes: Float64Array[];
  /** Base density, missing → 0. */
  base: Float64Array;
  /** 1 where light passes; 0 where base or a dye is missing under 'opaque' (all ones under 'zero'). */
  pass: Float64Array;
  curves: Curve[];
  /** Raw curves without minimum subtraction (spektrafilm mid-grey normalisation uses these). */
  rawCurves: Curve[];
  /** Spectral density b + Σ c_j ε_j (missing samples hold 0; read through `pass`). */
  spectral(c: ArrayLike<number>, out?: Float64Array): Float64Array;
  /** Dye amounts at film log exposure (develop through the curves). */
  develop(logH: ArrayLike<number>): Vec3;
}

const fin = (v: number): number => (Number.isFinite(v) ? v : 0);

export function resolveStock(d: StockData, conv: Conventions): Stock {
  if (d.base.length !== NW || d.dyes.length !== 3 || d.dyes.some((e) => e.length !== NW)) fail('E_DATA_GRID', `stock ${d.id} is not on the 380–780 nm, 5 nm grid`);
  const pass = new Float64Array(NW).fill(1);
  if (conv.nan === 'opaque') {
    for (let i = 0; i < NW; i++) {
      if (!Number.isFinite(d.base[i]!) || d.dyes.some((e) => !Number.isFinite(e[i]!))) pass[i] = 0;
    }
  }
  const sens = d.logSensitivity.map((s) => s.map((v) => (Number.isFinite(v) ? 10 ** v : 0)));
  const dyes = d.dyes.map((e) => e.map(fin));
  const base = d.base.map(fin);
  const rawCurves = d.curves.map((c) => new Curve(d.logExposure, c.map(fin)));
  const curves = conv.curveMin === 'subtract'
    ? d.curves.map((c) => {
      let m = Infinity;
      for (const v of c) if (Number.isFinite(v) && v < m) m = v;
      return new Curve(d.logExposure, c.map((v) => fin(v) - m));
    })
    : rawCurves;
  const E0 = dyes[0]!;
  const E1 = dyes[1]!;
  const E2 = dyes[2]!;
  return {
    data: d, conv, sens, dyes, base, pass, curves, rawCurves,
    spectral(c, out = new Float64Array(NW)) {
      const c0 = c[0]!;
      const c1 = c[1]!;
      const c2 = c[2]!;
      for (let i = 0; i < NW; i++) out[i] = pass[i] ? base[i]! + c0 * E0[i]! + c1 * E1[i]! + c2 * E2[i]! : 0;
      return out;
    },
    develop(logH) {
      return [curves[0]!.at(logH[0]!), curves[1]!.at(logH[1]!), curves[2]!.at(logH[2]!)];
    },
  };
}
