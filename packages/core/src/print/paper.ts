// Paper curves (§2.6–2.7): spektrafilm's fitted 3-CDF model with the gamma morph and developer
// exhaustion (utils/morph_curves.py), ported from Filmbench paperCurves (01-inline.js 237–282).
// Preflash: x ↦ log10(10^x + φ).
import type { Mat3, Vec3 } from '../spectral/linalg.ts';
import type { CurveModel, Stock } from '../spectral/stock.ts';

export type PaperCurveModel = CurveModel;
export interface PaperMorph { gamma: number; fast: number; slow: number; rgb: Vec3; exhaustion: number }
export const NO_MORPH: PaperMorph = { gamma: 1, fast: 1, slow: 1, rgb: [1, 1, 1], exhaustion: 0 };

/** erf with ~1e-16 accuracy below 2.5 (series) and Numerical-Recipes erfc above (Filmbench 14–28). */
export function erf(x: number): number {
  const ax = Math.abs(x);
  let r: number;
  if (ax < 2.5) {
    let term = ax;
    let sum = ax;
    const x2 = ax * ax;
    for (let n = 1; n < 90; n++) {
      term *= -x2 / n;
      const t = term / (2 * n + 1);
      sum += t;
      if (Math.abs(t) < 1e-17) break;
    }
    r = 1.1283791670955126 * sum;
  } else {
    const t = 1 / (1 + 0.5 * ax);
    const erfc = t * Math.exp(-ax * ax - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
    r = 1 - erfc;
  }
  return x < 0 ? -r : r;
}
export const Phi = (z: number): number => 0.5 * (1 + erf(z / Math.SQRT2));

const GUMBEL_W = 0.5 * Math.LN2 * Math.sqrt(2 * Math.PI);
const GUMBEL_L = -Math.log(Math.log(2));
function layerCdf(z: number, mix: number): number {
  let c = Phi(z);
  if (mix > 0) c = (1 - mix) * c + mix * Math.exp(-Math.exp(-(z / GUMBEL_W + GUMBEL_L)));
  return c;
}
function channelDensity(x: number, cen: ArrayLike<number>, amp: ArrayLike<number>, sig: ArrayLike<number>, mix?: ArrayLike<number>): number {
  let t = 0;
  for (let i = 0; i < cen.length; i++) t += amp[i]! * layerCdf((x - cen[i]!) / sig[i]!, mix ? mix[i]! : 0);
  return t;
}

export interface MorphedModel extends PaperCurveModel { gumbelMix: Mat3 }

/** Gamma morph: μ/g and max(σ/g, 0.05) per sublayer (fast, slow), per channel; exhaustion re-centres by bisection. */
export function morphPaper(m: PaperCurveModel, g: PaperMorph = NO_MORPH): MorphedModel {
  const centres = m.centres.map((r) => r.slice()) as Mat3;
  const sigmas = m.sigmas.map((r) => r.slice()) as Mat3;
  const amps = m.amps.map((r) => r.slice()) as Mat3;
  const gumbelMix = [0, 1, 2].map(() => [g.exhaustion, g.exhaustion, g.exhaustion]) as Mat3;
  for (let c = 0; c < 3; c++) {
    const cen = centres[c]!;
    const sig = sigmas[c]!;
    const order = [0, 1, 2].sort((a, b) => cen[a]! - cen[b]!);
    const gch = g.rgb[c]!;
    const gF = g.gamma * gch * g.fast;
    const gM = g.gamma * gch * g.slow;
    if (!(gF > 0 && gM > 0)) throw new Error('paper morph: effective gamma must be > 0');
    const apply = (i: number, gg: number): void => {
      sig[i] = Math.max(sig[i]! / gg, 0.05);
      cen[i] = cen[i]! / gg;
    };
    if (gF !== 1 || gM !== 1) {
      apply(order[0]!, gF);
      apply(order[1]!, gM);
      apply(order[2]!, gM);
    }
    if (g.exhaustion > 0) {
      const amp = amps[c]!;
      const tgt = channelDensity(0, cen, amp, sig);
      const mix = gumbelMix[c]!;
      const res = (off: number): number => channelDensity(0, cen.map((v) => v + off), amp, sig, mix) - tgt;
      let lo = -0.25;
      let hi = 0.25;
      let rl = res(lo);
      let rh = res(hi);
      let found = false;
      for (let it = 0; it < 12; it++) {
        if (rl * rh < 0) { found = true; break; }
        lo *= 2; hi *= 2; rl = res(lo); rh = res(hi);
      }
      let off = 0;
      if (found) {
        for (let it = 0; it < 70; it++) {
          const mid = 0.5 * (lo + hi);
          const rm = res(mid);
          if (rl * rm <= 0) hi = mid;
          else { lo = mid; rl = rm; }
        }
        off = 0.5 * (lo + hi);
      }
      for (let i = 0; i < 3; i++) cen[i] = cen[i]! + off;
    }
  }
  return { centres, amps, sigmas, gumbelMix };
}

/** c_p = Σ A Φ((x − μ)/σ) per channel. */
export function paperDevelop(m: PaperCurveModel & { gumbelMix?: Mat3 }, x: ArrayLike<number>): Vec3 {
  return [0, 1, 2].map((c) => channelDensity(x[c]!, m.centres[c]!, m.amps[c]!, m.sigmas[c]!, m.gumbelMix?.[c])) as Vec3;
}

/** dc_p/dx per channel (central difference, h = 1e-4). */
export function paperSlope(m: PaperCurveModel & { gumbelMix?: Mat3 }, x: ArrayLike<number>, h = 1e-4): Vec3 {
  const p = paperDevelop(m, [x[0]! + h, x[1]! + h, x[2]! + h]);
  const n = paperDevelop(m, [x[0]! - h, x[1]! - h, x[2]! - h]);
  return [0, 1, 2].map((k) => (p[k]! - n[k]!) / (2 * h)) as Vec3;
}

/** A paper developer under the stock's conventions: 3-CDF model or the 256-point table. */
export function paperDeveloper(paper: Stock, morph: PaperMorph = NO_MORPH): (x: ArrayLike<number>) => Vec3 {
  const model = paper.data.curveModel;
  if (paper.conv.paperCurve === 'model-3cdf' && model) {
    const mm = morphPaper(model, morph);
    return (x) => paperDevelop(mm, x);
  }
  const g = morph.gamma;
  return (x) => [0, 1, 2].map((k) => paper.curves[k]!.at(x[k]! * g * morph.rgb[k]!)) as Vec3;
}

/**
 * Paper grade → contrast factor γ (Filmbench vfs/controls.js GRADE): grade 2 is the paper as made.
 * Colour papers have no grades; this is a contrast control with darkroom numbering (CHB-010 guide §6.8).
 */
export const GRADE_GAMMA: readonly (readonly [number, number])[] = [[0, 0.7], [1, 0.82], [2, 1], [3, 1.2], [4, 1.45], [5, 1.8]];

/** Piecewise-linear interpolation of GRADE_GAMMA, clamped to grades 0…5. */
export function gradeToGamma(grade: number): number {
  const t = GRADE_GAMMA;
  if (!(grade > t[0]![0])) return t[0]![1];
  for (let i = 1; i < t.length; i++) {
    const [g1, v1] = t[i]!;
    if (grade <= g1) {
      const [g0, v0] = t[i - 1]!;
      return v0 + ((v1 - v0) * (grade - g0)) / (g1 - g0);
    }
  }
  return t[t.length - 1]![1];
}

/**
 * The grade as a gamma about a pivot in paper log exposure: x′ = pivot + γ·(x − pivot) (Chromogen
 * paperX `g + γ(x − g)`). Equals spektrafilm's morph (μ/γ, σ/γ) about the pivot where its σ ≥ 0.05
 * floor does not bind. The engines pivot about the aim grey (ops `gradePivot`), so a grade change
 * leaves the grey card in place and needs no time compensation.
 */
export function gradeX(x: ArrayLike<number>, gamma: number, pivot: ArrayLike<number>): Vec3 {
  return [0, 1, 2].map((k) => pivot[k]! + gamma * (x[k]! - pivot[k]!)) as Vec3;
}

export function preflash(x: ArrayLike<number>, phi: ArrayLike<number>): Vec3 {
  return [0, 1, 2].map((k) => Math.log10(10 ** x[k]! + phi[k]!)) as Vec3;
}

/** Chromogen paperX: φ = 0.35 · p/100 · 10^(g − 0.6), g the grey card's paper exposure (05-inline.js 2119, 2165). */
export function preflashFromSlider(p_percent: number, g: ArrayLike<number>): Vec3 {
  return [0, 1, 2].map((k) => 0.35 * (p_percent / 100) * 10 ** (g[k]! - 0.6)) as Vec3;
}
