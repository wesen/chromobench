// Wavelength grid and typed spectra (textbook §1.1). Ported from Chromogen spectrum.js
// (05-inline.js 218–383); the kind algebra is the contract's (productKind, sumKind), so the rules exist once.
import { fail, productKind, sumKind, T_FLOOR, type SpectrumKind } from '@chromobench/contract';

export type { SpectrumKind };

export interface Grid {
  readonly start_nm: number;
  readonly stop_nm: number;
  readonly step_nm: number;
  readonly n: number;
  readonly wl: Float64Array;
}

/** 380–780 nm in 5 nm steps: 81 samples (spektrafilm SPECTRAL_SHAPE, Chromogen Grid). */
export const GRID: Grid = Object.freeze({
  start_nm: 380, stop_nm: 780, step_nm: 5, n: 81,
  wl: Float64Array.from({ length: 81 }, (_, i) => 380 + 5 * i),
});
export const NW = 81;

export class Spectrum {
  readonly kind: SpectrumKind;
  readonly values: Float64Array;
  readonly grid: Grid;
  constructor(values: ArrayLike<number>, kind: SpectrumKind, grid: Grid = GRID) {
    if (values.length !== grid.n) fail('E_KIND', `${values.length} values for a grid of ${grid.n}`);
    this.kind = kind;
    this.values = Float64Array.from(values);
    this.grid = grid;
  }
  map(f: (v: number, i: number) => number, kind: SpectrumKind = this.kind): Spectrum {
    return new Spectrum(this.values.map(f), kind, this.grid);
  }
  /** Wavelength-wise product; refuses densities (they add). */
  mul(s: Spectrum): Spectrum {
    const kind = productKind(this.kind, s.kind);
    return new Spectrum(this.values.map((v, i) => v * s.values[i]!), kind, this.grid);
  }
  /** Wavelength-wise sum; refuses transmittances (they multiply). */
  add(s: Spectrum): Spectrum {
    const kind = sumKind(this.kind, s.kind);
    return new Spectrum(this.values.map((v, i) => v + s.values[i]!), kind, this.grid);
  }
  scale(k: number): Spectrum {
    return new Spectrum(this.values.map((v) => v * k), this.kind, this.grid);
  }
  /** −log10 T, with T floored at 1e-8 (zero transmittance reads 8 D). */
  toDensity(): Spectrum {
    if (this.kind !== 'transmittance' && this.kind !== 'reflectance') fail('E_KIND', `toDensity needs a transmittance, not ${this.kind}`);
    return new Spectrum(this.values.map((t) => -Math.log10(Math.max(t, T_FLOOR))), 'density', this.grid);
  }
  toTransmittance(): Spectrum {
    if (this.kind !== 'density') fail('E_KIND', `toTransmittance needs a density, not ${this.kind}`);
    return new Spectrum(this.values.map((d) => 10 ** -d), 'transmittance', this.grid);
  }
  sum(): number {
    let s = 0;
    for (const v of this.values) s += v;
    return s;
  }
  at(nm: number): number {
    return this.values[Math.round((nm - this.grid.start_nm) / this.grid.step_nm)]!;
  }
}

/** Linear interpolation, `left`/`right` outside (Chromogen interp). */
export function interp(xs: ArrayLike<number>, ys: ArrayLike<number>, x: number, left = 0, right = 0): number {
  const n = xs.length;
  if (x < xs[0]!) return left;
  if (x > xs[n - 1]!) return right;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (xs[m]! <= x) lo = m;
    else hi = m;
  }
  const t = xs[hi] === xs[lo] ? 0 : (x - xs[lo]!) / (xs[hi]! - xs[lo]!);
  return ys[lo]! + t * (ys[hi]! - ys[lo]!);
}

/** Planck radiator normalised to 1 at 560 nm (Chromogen blackbody). */
export function blackbody(T_K: number, grid: Grid = GRID): Spectrum {
  const c1 = 3.741771852e-16;
  const c2 = 0.01438776877;
  const p = (w: number): number => {
    const l = w * 1e-9;
    return c1 / l ** 5 / (Math.exp(c2 / (l * T_K)) - 1);
  };
  const ref = p(560);
  return new Spectrum(Array.from(grid.wl, (w) => p(w) / ref), 'power', grid);
}

/** Gaussian (optionally asymmetric) of given FWHM, peak 1. */
export function gaussian(centre_nm: number, fwhm_nm: number | [number, number], kind: SpectrumKind = 'power', grid: Grid = GRID): Spectrum {
  const [fl, fr] = Array.isArray(fwhm_nm) ? fwhm_nm : [fwhm_nm, fwhm_nm];
  const sl = fl / 2.3548;
  const sr = fr / 2.3548;
  return new Spectrum(Array.from(grid.wl, (w) => Math.exp(-0.5 * ((w - centre_nm) / (w < centre_nm ? sl : sr)) ** 2)), kind, grid);
}

/** c2 of the sigmoid that is flat at reflectance r (c0 = c1 = 0). */
export const sigmoidFlatC2 = (r: number): number => (2 * r - 1) / (2 * Math.sqrt(r * (1 - r)));

/** Chromogen's fitted multi-lobe CMFs (05-inline.js 324–337). Legacy: for reproducing Chromogen fixtures only. */
export function cmfChromogenFit(grid: Grid = GRID): [Float64Array, Float64Array, Float64Array] {
  const g = (x: number, mu: number, s1: number, s2: number): number => Math.exp(-0.5 * ((x - mu) / (x < mu ? s1 : s2)) ** 2);
  const X = new Float64Array(grid.n);
  const Y = new Float64Array(grid.n);
  const Z = new Float64Array(grid.n);
  grid.wl.forEach((w, i) => {
    X[i] = 1.056 * g(w, 599.8, 37.9, 31) + 0.362 * g(w, 442, 16, 26.7) - 0.065 * g(w, 501.1, 20.4, 26.2);
    Y[i] = 0.821 * g(w, 568.8, 46.9, 40.5) + 0.286 * g(w, 530.9, 16.3, 31.1);
    Z[i] = 1.217 * g(w, 437, 11.8, 36) + 0.681 * g(w, 459, 26, 13.8);
  });
  return [X, Y, Z];
}
