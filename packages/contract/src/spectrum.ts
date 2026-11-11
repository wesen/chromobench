// Spectral grid and the spectrum-kind algebra. Numeric spectra live in CHB-003 (packages/core/spectral);
// they call productKind/sumKind so the rules exist once. Ported from Chromogen spectrum.js (05-inline.js 218–383).
import { fail } from './errors.ts';

export interface Grid {
  readonly lo: number;
  readonly hi: number;
  readonly step: number;
  readonly n: number;
  key(): string;
  wavelengths(): number[];
}

function makeGrid(lo: number, hi: number, step: number): Grid {
  const n = Math.round((hi - lo) / step) + 1;
  return Object.freeze({
    lo, hi, step, n,
    key: () => `${lo}:${hi}:${step}`,
    wavelengths: () => Array.from({ length: n }, (_, i) => lo + i * step),
  });
}

/** 380–780 nm in 5 nm steps, 81 samples. */
export const GRID: Grid = makeGrid(380, 780, 5);

export type SpectrumKind = 'power' | 'reflectance' | 'transmittance' | 'density' | 'responsivity';
export const SPECTRUM_KINDS: readonly SpectrumKind[] = ['power', 'reflectance', 'transmittance', 'density', 'responsivity'];

/** Transmittance floor before taking a logarithm: T = 0 reads as 8 D. */
export const T_FLOOR = 1e-8;

const FILTERS: ReadonlySet<SpectrumKind> = new Set(['reflectance', 'transmittance']);

/** Kind of a wavelength-wise product a·b, or E_KIND. */
export function productKind(a: SpectrumKind, b: SpectrumKind): SpectrumKind {
  if (a === 'density' || b === 'density') fail('E_KIND', 'densities add; multiply transmittances instead');
  if (FILTERS.has(a) && FILTERS.has(b)) return a === b ? a : 'reflectance';
  if (FILTERS.has(b)) return a; // power·T = power, responsivity·T = responsivity
  if (FILTERS.has(a)) return b;
  if ((a === 'power' && b === 'responsivity') || (a === 'responsivity' && b === 'power')) return 'power'; // integrand of a channel signal
  return fail('E_KIND', `cannot multiply ${a} by ${b}`);
}

/** Kind of a wavelength-wise sum a+b, or E_KIND. */
export function sumKind(a: SpectrumKind, b: SpectrumKind): SpectrumKind {
  if (a === 'transmittance' || b === 'transmittance') fail('E_KIND', 'transmittances multiply; add densities instead');
  if (a === 'reflectance' || b === 'reflectance') fail('E_KIND', 'reflectances do not add; combine them physically or add densities');
  if (a !== b) fail('E_KIND', `cannot add ${b} to ${a}`);
  return a;
}

/** Scalar Beer–Lambert helpers (the vector versions belong to CHB-003). */
export const toDensity = (t: number): number => -Math.log10(Math.max(t, T_FLOOR));
export const toTransmittance = (d: number): number => 10 ** -d;
