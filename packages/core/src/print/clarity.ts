// clarity (contract 1.0, design §8, §23): local contrast on the print, a large unsharp mask weighted to the
// midtones, the f64 reference (packages/gpu mirrors it). It replaces finishing.clarity, whose radius was in preview
// pixels; the radius is now millimetres on the print, so the same layer gives the same picture at every export size.
//
// On print-xyz (linear light) with the print's white Y_w:
//   Ȳ  = G_σ * Y                              the low-pass, in linear light (luminance only), σ = radius on the print
//   L  = (Y / Y_w)^⅓,  L̄ = (Ȳ / Y_w)^⅓       lightness: the OkLab L of a neutral of that luminance
//   w  = max(0, 1 − (2L − 1)²)                 midtone weight (0 at black and white, 1 at L = ½)
//   L′ = max(0, L + s·w·(L − L̄))              s = strength (negative softens)
//   out = XYZ · (L′ / L)³                      the detail scales the colour, so chromaticity is kept
// σ in pixels = radius_mm · 1000 / (ImageInfo.umPerPx.paper). A pixel with Y ≤ 0 is left as it is.
import { fail } from '@chromobench/contract';
import { gaussianBlur1 } from './masks.ts';

/** σ in print pixels of a clarity radius in mm; the image must carry the print's pitch (µm per pixel). */
export function claritySigma(radius_mm: number, umPerPxPaper: number | undefined): number {
  if (umPerPxPaper === undefined) fail('E_EVAL', 'clarity: the image has no print pitch (ImageInfo.umPerPx.paper)', { hint: 'build the chain through print.expose from source.open with its umPerPx (compile does)' });
  return (radius_mm * 1000) / umPerPxPaper;
}

/** The clarity gain (L′ / L)³ of one pixel: its luminance Y, the low-passed Ȳ, the white's Y_w and the strength. */
export function clarityGain(Y: number, Yb: number, Yw: number, strength: number): number {
  if (!(Y > 0)) return 1;
  const L = Math.cbrt(Y / Yw), Lb = Math.cbrt(Math.max(Yb, 0) / Yw);
  const w = Math.max(0, 1 - (2 * L - 1) ** 2);
  const L2 = Math.max(0, L + strength * w * (L - Lb));
  return (L2 / L) ** 3;
}

/** clarity on an interleaved c-channel print-xyz image (Y = channel 1); channels beyond three are copied. */
export function clarity(src: Float64Array, w: number, h: number, c: number, strength: number, sigma_px: number, Yw: number): Float64Array {
  const out = src.slice();
  if (strength === 0) return out;
  const Y = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) Y[i] = src[i * c + 1]!;
  const Yb = gaussianBlur1(Y, w, h, sigma_px);
  for (let i = 0; i < w * h; i++) {
    const g = clarityGain(Y[i]!, Yb[i]!, Yw, strength);
    for (let k = 0; k < Math.min(3, c); k++) out[i * c + k] = src[i * c + k]! * g;
  }
  return out;
}
