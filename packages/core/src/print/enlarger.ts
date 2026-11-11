// The enlarger: negative → paper log exposure (§2.6, guide §5.4).
// x_k = log10 Σ L·F·pass·10^−D·s_k + offset; lights are added afterwards (they factor out of the sum).
// Normalised mode follows spektrafilm printing._compute_exposure_factor_midgray (Filmbench 345–366).
import type { Cmy } from '../data/provider.ts';
import type { Conventions } from '../spectral/conventions.ts';
import type { Mat3, Vec3 } from '../spectral/linalg.ts';
import type { Stock } from '../spectral/stock.ts';
import { NW } from '../spectral/spectrum.ts';

import type { Triple } from '../spectral/channels.ts';
export type { Triple };

/** lamp × Π_k [1 − (1 − F_k)(1 − 10^(−CC_k/100))] (Filmbench enlargerIlluminant 137–146). */
export function filteredLamp(lamp: ArrayLike<number>, dichroic: Triple<ArrayLike<number>>, cc: Cmy): Float64Array {
  const t = [10 ** (-cc.c / 100), 10 ** (-cc.m / 100), 10 ** (-cc.y / 100)];
  const out = new Float64Array(NW);
  for (let i = 0; i < NW; i++) {
    let tot = 1;
    for (let k = 0; k < 3; k++) tot *= 1 - (1 - dichroic[k]![i]!) * (1 - t[k]!);
    out[i] = lamp[i]! * tot;
  }
  return out;
}

/** CHB-010 hook. The stub is a placeholder: offset = log10(t/10) − 2·log10(N/8). */
export interface RealExposureModel {
  offset_logH(e: { time_s: number; fstop: number; lamp: string }): number;
}
export const STUB_REAL_EXPOSURE: RealExposureModel = {
  offset_logH: ({ time_s, fstop }) => Math.log10(time_s / 10) - 2 * Math.log10(fstop / 8),
};

export interface EnlargerSetup {
  film: Stock;
  paper: Stock;
  lamp: ArrayLike<number>;
  lampName?: string;
  dichroic: Triple<ArrayLike<number>>;
  /** Absolute filter pack in CC (database neutral pack + user shift). */
  filtration_CC: Cmy;
  mode: 'normalised' | 'real';
  /** Real mode: time and aperture (CHB-010 replaces the model). */
  real?: { model?: RealExposureModel; time_s: number; fstop: number; calibrationCC?: Cmy };
  /** Spectral density of the mid-grey; default the film at log H = 0 through its raw curves. RAW frames: CHB-012. */
  midgray?: Float64Array;
  /** spektrafilm flags: normalize_print_exposure (default true) and print_exposure_compensation with the camera EV. */
  normalize?: boolean;
  compensation?: { ev: number } | null;
  conv: Conventions;
}

export interface Enlarger {
  setup: EnlargerSetup;
  /** The filtered lamp L·F. */
  light: Float64Array;
  /** Paper log H without lights: the tabulable part. */
  exposure(c: ArrayLike<number>): Vec3;
  /** Same, from a spectral density. */
  exposureOfDensity(D: ArrayLike<number>): Vec3;
  /** Raw (unnormalised) log10 Σ L F pass 10^−D s_k. */
  rawLog(D: ArrayLike<number>): Vec3;
  /** Log H through an empty gate (Chromogen print.js 834). */
  clear(): Vec3;
  /** Offset added to the raw log exposure (−mean log10 raw(mid-grey) when normalising). */
  offset_logH: number;
  midgray: Float64Array;
  /** ∂x/∂v per CC at the current pack for the mid-grey (rows layers, cols filters C, M, Y). */
  dxdCC(D?: ArrayLike<number>, h?: number): Mat3;
}

const LOG10_2 = Math.log10(2);

export function midgrayDensity(film: Stock, logH = 0): Float64Array {
  const c = film.rawCurves.map((cv) => cv.at(logH));
  return film.spectral(c);
}

function rawLogWith(light: Float64Array, film: Stock, paper: Stock, D: ArrayLike<number>): Vec3 {
  const out: Vec3 = [0, 0, 0];
  const S = paper.sens;
  const pass = film.pass;
  for (let k = 0; k < 3; k++) {
    const s = S[k]!;
    let t = 0;
    for (let i = 0; i < NW; i++) if (pass[i]) t += light[i]! * 10 ** -D[i]! * s[i]!;
    out[k] = Math.log10(Math.max(t, 1e-300));
  }
  return out;
}

const meanLog = (v: Vec3): number => (v[0] + v[1] + v[2]) / 3;

/** −mean_k log10 raw_k(midgray) under the four spektrafilm flag combinations. */
function normalisationOffset(light: Float64Array, s: EnlargerSetup, mid: Float64Array): number {
  const normalize = s.normalize ?? true;
  const comp = s.compensation ?? null;
  if (s.conv.printNormalise === 'none' || (!normalize && !comp)) return 0;
  const fM = -meanLog(rawLogWith(light, s.film, s.paper, mid));
  if (!comp) return fM;
  const fC = -meanLog(rawLogWith(light, s.film, s.paper, midgrayDensity(s.film, comp.ev * LOG10_2)));
  return normalize ? fC : fC - fM;
}

export function makeEnlarger(s: EnlargerSetup): Enlarger {
  const light = filteredLamp(s.lamp, s.dichroic, s.filtration_CC);
  const mid = s.midgray ?? midgrayDensity(s.film);
  let offset: number;
  if (s.mode === 'real') {
    // Calibration held at a fixed pack (the database neutral by default): filter changes now move density too.
    const calLight = filteredLamp(s.lamp, s.dichroic, s.real?.calibrationCC ?? s.filtration_CC);
    const cal = s.conv.printNormalise === 'none' ? 0 : -meanLog(rawLogWith(calLight, s.film, s.paper, mid));
    const model = s.real?.model ?? STUB_REAL_EXPOSURE;
    offset = cal + model.offset_logH({ time_s: s.real?.time_s ?? 10, fstop: s.real?.fstop ?? 8, lamp: s.lampName ?? 'lamp' });
  } else offset = normalisationOffset(light, s, mid);
  const scratch = new Float64Array(NW);
  const exposureOfDensity = (D: ArrayLike<number>): Vec3 => {
    const r = rawLogWith(light, s.film, s.paper, D);
    return [r[0] + offset, r[1] + offset, r[2] + offset];
  };
  return {
    setup: s, light, offset_logH: offset, midgray: mid,
    exposure: (c) => exposureOfDensity(s.film.spectral(c, scratch)),
    exposureOfDensity,
    rawLog: (D) => rawLogWith(light, s.film, s.paper, D),
    clear: () => rawLogWith(light, s.film, s.paper, new Float64Array(NW)).map((v) => v + offset) as Vec3,
    dxdCC(D = mid, h = 0.5) {
      const J: Mat3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      const keys = ['c', 'm', 'y'] as const;
      for (let j = 0; j < 3; j++) {
        const pack = (sgn: number): Cmy => ({ ...s.filtration_CC, [keys[j]!]: s.filtration_CC[keys[j]!] + sgn * h });
        const xp = makeEnlarger({ ...s, filtration_CC: pack(1) }).exposureOfDensity(D);
        const xm = makeEnlarger({ ...s, filtration_CC: pack(-1) }).exposureOfDensity(D);
        for (let k = 0; k < 3; k++) J[k]![j] = (xp[k]! - xm[k]!) / (2 * h);
      }
      return J;
    },
  };
}
