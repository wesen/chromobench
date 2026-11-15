// Density masks (CHB-010 guide §6.6): a weak, unsharp positive contact-printed from the negative
// through a diffusing spacer and sandwiched with it. Silver is close to neutral, so the mask adds one
// flat density d_m(x, y) to every printing-density layer (exactly a per-pixel printer light −d_m).
//
// The mask film is exposed by light through the negative, so its exposure is a blur of the
// negative's TRANSMITTANCE (linear light), never of its density:
//   T_m = (1/3) Σ_k 10^(−PD_k)        panchromatic mask film, equal weights
//   H_m = G_σ * T_m                     σ = radius on the film (contract print.densityMask.radius_um, as σ)
//   d_m = γ · (log10 H_m − log10 min H_m)    positive mask, γ = the mask gamma (print.densityMask.gamma)
// H_ref = the frame's smallest H_m (the densest area of the negative, the print's brightest highlight)
// gets no mask density, so d_m ≥ 0 everywhere: a physical mask that keeps the highlights and lifts the
// shadows; the printer re-times the overall density, as in the darkroom. The `same`-polarity and
// highlight (threshold) masks need arguments contract 0.2 does not have (CHB-010 contract request C5).
//
// Contract 0.3 (C5): print.densityMask reads the main print.expose's paper log exposure x and recovers
// PD = x_clear − x (x_clear = that exposure's clear-film x); it returns d_m (one channel), and print.combine
// multiplies every exposure through the negative by 10^−a·m·d_m (its `densities`, contract 1.0). Polarity 'same' is
// d_m = γ(log10 max H_m − log10 H_m). The blur's σ is in µm on the film, converted with the image's film pitch
// (ImageInfo.umPerPx.film, set by source.open): contract 1.0 has no default pitch.
import { fail } from '@chromobench/contract';
import { gaussianBlur1 } from './masks.ts';

/** The mask film's exposure: Gaussian blur (σ px, clamp-to-edge) of the mean transmittance of the three layers. */
export function maskExposure(pd: ArrayLike<number>, w: number, h: number, c: number, sigma_px: number): Float64Array {
  const T = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) {
    let s = 0;
    for (let k = 0; k < 3; k++) s += 10 ** -pd[i * c + Math.min(k, c - 1)]!;
    T[i] = s / 3;
  }
  return gaussianBlur1(T, w, h, sigma_px);
}

/** The mask's density d_m per pixel (≥ 0; 0 at the frame's densest area). */
export function maskDensity(pd: ArrayLike<number>, w: number, h: number, c: number, gamma: number, sigma_px: number): Float64Array {
  const Hm = maskExposure(pd, w, h, c, sigma_px);
  let ref = Infinity;
  for (let i = 0; i < Hm.length; i++) ref = Math.min(ref, Hm[i]!);
  const lref = Math.log10(ref);
  const d = new Float64Array(w * h);
  for (let i = 0; i < Hm.length; i++) d[i] = gamma * (Math.log10(Hm[i]!) - lref);
  return d;
}

/** The mask density for a polarity: positive γ(log H − log min H), same γ(log max H − log H); both ≥ 0. */
export function maskDensityPolar(pd: ArrayLike<number>, w: number, h: number, c: number, gamma: number, sigma_px: number, polarity: 'positive' | 'same'): Float64Array {
  if (polarity === 'positive') return maskDensity(pd, w, h, c, gamma, sigma_px);
  const Hm = maskExposure(pd, w, h, c, sigma_px);
  let ref = -Infinity;
  for (let i = 0; i < Hm.length; i++) ref = Math.max(ref, Hm[i]!);
  const lref = Math.log10(ref);
  const d = new Float64Array(w * h);
  for (let i = 0; i < Hm.length; i++) d[i] = gamma * (lref - Math.log10(Hm[i]!));
  return d;
}

/** PD + d_m in each of the three layers (extra channels pass through): the mask sandwiched with the negative. */
export function applyDensityMask(pd: ArrayLike<number>, w: number, h: number, c: number, gamma: number, sigma_px: number): Float64Array {
  const out = Float64Array.from(pd as ArrayLike<number>);
  if (gamma === 0) return out;
  const d = maskDensity(pd, w, h, c, gamma, sigma_px);
  for (let i = 0; i < w * h; i++) for (let k = 0; k < Math.min(3, c); k++) out[i * c + k] = pd[i * c + k]! + d[i]!;
  return out;
}

/** σ in film pixels for radius_um (the contract's radius is the Gaussian σ on the film); the image must carry its film pitch. */
export function densityMaskSigma(radius_um: number, umPerPxFilm: number | undefined): number {
  if (umPerPxFilm === undefined) fail('E_EVAL', 'print.densityMask: the image has no film pitch (ImageInfo.umPerPx.film)', { hint: 'build the chain from source.open with its umPerPx (compile does)' });
  return radius_um / umPerPxFilm;
}
