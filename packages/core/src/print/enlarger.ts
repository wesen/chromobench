// The enlarger: negative → paper log exposure (§2.6, CHB-003 guide §5.4, CHB-010 guide §3.1).
//   x_k = log10 Σ L·F_pack·pass·10^−D·s_k + κ + optics;  lights are added afterwards (they factor out).
// κ is one scalar. Normalised mode: κ(F) = −mean_k log10 raw_k(mid-grey) through the current pack, so a
// filter keeps the mid-grey's mean log exposure (spektrafilm printing._compute_exposure_factor_midgray,
// Filmbench 345–366) and optics do nothing. Real mode: κ is fixed at the calibration pack and the
// optics count (time, f-stop, magnification), so filters cost light as on a darkroom enlarger. At the
// calibration (database neutral pack, REFERENCE_OPTICS) both modes agree; elsewhere they differ by a
// scalar per setting, never per layer.
import { fail } from '@chromobench/contract';
import type { Cmy } from '../data/provider.ts';
import type { Conventions } from '../spectral/conventions.ts';
import type { Mat3, Vec3 } from '../spectral/linalg.ts';
import type { Stock } from '../spectral/stock.ts';
import { NW } from '../spectral/spectrum.ts';

import type { Triple } from '../spectral/channels.ts';
export type { Triple };

/** lamp × Π_k [1 − (1 − F_k)(1 − 10^(−CC_k/100))] (Filmbench enlargerIlluminant 137–146; spektrafilm apply_cc). */
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

/** One enlarger setting's optics: exposure time, lens aperture and magnification (head height). */
export interface EnlargerOptics { time_s: number; fstop: number; magnification: number }

/**
 * The calibration reference (CHB-010 guide §3.1): 10 s at f/8, magnification 8 (Kodak E-4020's
 * tricolour example is an 8× enlargement of a Portra negative at f/8). At these optics and the
 * calibration pack, real and normalised mode print identically.
 */
export const REFERENCE_OPTICS: Readonly<EnlargerOptics> = Object.freeze({ time_s: 10, fstop: 8, magnification: 8 });

/**
 * Optics as a log-exposure offset: log10(t/t_ref) − 2·log10(N/N_ref) − 2·log10((m+1)/(m_ref+1)).
 * Light ∝ t, ∝ 1/N², ∝ 1/(m+1)² (the lens-to-easel distance grows with m + 1). No paper reciprocity
 * (guide §6.8: off until a data pack supplies Schwarzschild exponents).
 */
export function opticsLogH(o: Partial<EnlargerOptics> = {}, ref: Readonly<EnlargerOptics> = REFERENCE_OPTICS): number {
  const t = o.time_s ?? ref.time_s;
  const N = o.fstop ?? ref.fstop;
  const m = o.magnification ?? ref.magnification;
  if (!(t > 0 && N > 0 && m >= 0)) fail('E_ARG_RANGE', `enlarger optics out of range: ${t} s, f/${N}, ×${m}`);
  return Math.log10(t / ref.time_s) - 2 * Math.log10(N / ref.fstop) - 2 * Math.log10((m + 1) / (ref.magnification + 1));
}

export interface EnlargerSetup {
  film: Stock;
  paper: Stock;
  lamp: ArrayLike<number>;
  lampName?: string;
  dichroic: Triple<ArrayLike<number>>;
  /** Absolute filter pack in CC (database neutral pack + user shift). */
  filtration_CC: Cmy;
  mode: 'normalised' | 'real';
  /** Real mode: the setting's optics (missing fields: the reference). Normalised mode ignores them. */
  optics?: Partial<EnlargerOptics>;
  /** Where κ is fixed in real mode: the calibration pack (default `filtration_CC`) and reference optics. */
  calibration?: { pack: Cmy; optics?: Readonly<EnlargerOptics> };
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
  /** Printing density of a spectral density through this pack: clear − x (independent of κ and optics). */
  printingDensity(D: ArrayLike<number>): Vec3;
  /** The scalar κ: −mean log10 raw(mid-grey) at the calibration pack (real) or the current pack (normalised). */
  kappa: number;
  /** The optics' log-exposure offset (0 in normalised mode). */
  optics_logH: number;
  /** κ + optics, added to the raw log exposure of every layer. */
  offset_logH: number;
  midgray: Float64Array;
  /** ∂x/∂v per CC at the current pack (rows layers R, G, B; cols filters C, M, Y); central differences ±h CC. */
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

const samePack = (a: Cmy, b: Cmy): boolean => a.c === b.c && a.m === b.m && a.y === b.y;

export function makeEnlarger(s: EnlargerSetup): Enlarger {
  const light = filteredLamp(s.lamp, s.dichroic, s.filtration_CC);
  const mid = s.midgray ?? midgrayDensity(s.film);
  let kappa: number;
  let optics = 0;
  if (s.mode === 'real') {
    // κ held at the calibration pack: filter changes now move density too (guide decision record 1).
    const calPack = s.calibration?.pack ?? s.filtration_CC;
    const calLight = samePack(calPack, s.filtration_CC) ? light : filteredLamp(s.lamp, s.dichroic, calPack);
    kappa = normalisationOffset(calLight, s, mid);
    optics = opticsLogH(s.optics ?? {}, s.calibration?.optics ?? REFERENCE_OPTICS);
  } else kappa = normalisationOffset(light, s, mid);
  const offset = kappa + optics;
  const scratch = new Float64Array(NW);
  const zero = new Float64Array(NW);
  const exposureOfDensity = (D: ArrayLike<number>): Vec3 => {
    const r = rawLogWith(light, s.film, s.paper, D);
    return [r[0] + offset, r[1] + offset, r[2] + offset];
  };
  const rawClear = rawLogWith(light, s.film, s.paper, zero);
  return {
    setup: s, light, kappa, optics_logH: optics, offset_logH: offset, midgray: mid,
    exposure: (c) => exposureOfDensity(s.film.spectral(c, scratch)),
    exposureOfDensity,
    rawLog: (D) => rawLogWith(light, s.film, s.paper, D),
    clear: () => rawClear.map((v) => v + offset) as Vec3,
    printingDensity(D) {
      const r = rawLogWith(light, s.film, s.paper, D);
      return [rawClear[0] - r[0], rawClear[1] - r[1], rawClear[2] - r[2]];
    },
    dxdCC(D = mid, h = 0.5) {
      const J: Mat3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      const keys = ['c', 'm', 'y'] as const;
      // Real mode keeps κ at the calibration pack: pin it so the shifted enlargers share it.
      const cal = s.mode === 'real' ? { calibration: { ...s.calibration, pack: s.calibration?.pack ?? s.filtration_CC } } : {};
      for (let j = 0; j < 3; j++) {
        const pack = (sgn: number): Cmy => ({ ...s.filtration_CC, [keys[j]!]: s.filtration_CC[keys[j]!] + sgn * h });
        const xp = makeEnlarger({ ...s, ...cal, filtration_CC: pack(1) }).exposureOfDensity(D);
        const xm = makeEnlarger({ ...s, ...cal, filtration_CC: pack(-1) }).exposureOfDensity(D);
        for (let k = 0; k < 3; k++) J[k]![j] = (xp[k]! - xm[k]!) / (2 * h);
      }
      return J;
    },
  };
}
