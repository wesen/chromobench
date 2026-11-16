// Blend modes of the composite law (contract BLEND_MODES, design §5, §22), f64; packages/gpu mirrors them in
// kernels/working.wgsl. The channel formulas are the contract's (pixel.ts blendChannel: W3C Compositing and Blending
// Level 1, as Editor lab's src/engine.js:139–184, and Photoshop's vivid, linear and pin light and hard mix), with three
// definitions that make them chromobench's:
//
//   - separable modes act per channel in linear RGB (white = 1), on any real values (dodge and burn guard their
//     divisions as the W3C does at 0 and 1); an OkLab entry's backdrop and source are converted to RGB for B and back;
//   - the contrast modes (overlay, hard, soft, vivid, linear and pin light, hard mix: CONTRAST_BLENDS) act on those
//     channels in the display encoding (the sRGB curve, pixel.ts blendSeparable), so they switch at display mid-grey
//     as in Photoshop (D7); the mix with the amount stays in the entry's encoding;
//   - hue, saturation, colour and luminosity act in OkLCh: luminance is OkLab L, defined once, in the working space:
//       hue        (L_b, C_b, h_s)      saturation (L_b, C_s, h_b)      colour (L_b, a_s, b_s)      luminosity (L_s, a_b, b_b)
//     and the result keeps the gamut by W3C's ClipColor in OkLCh (contract 3.0, LAY-2: blendOkLch, clipColour): its
//     chroma is reduced at its lightness and hue until no RGB channel is below 0 or above gamutTop (white, or the
//     inputs' brightest channel). A source without hue keeps the backdrop's (hue); a backdrop without hue stays grey.
import { blendOkLch, blendSeparable, clipColour, gamutTop, NON_SEPARABLE_BLENDS, type BlendMode } from '@chromobench/contract';
import { oklabToRgb, rgbToOklab } from './working.ts';

export const isNonSeparable = (mode: BlendMode): boolean => NON_SEPARABLE_BLENDS.includes(mode);

/**
 * B(b, s) of one pixel whose values are in `enc` (the encoding the entry mixes in: 'linear' RGB or 'oklab'; 'stage'
 * values are taken as linear, which only normal may meet). The result is in `enc` too.
 */
export function blendPixel(mode: BlendMode, b: ArrayLike<number>, s: ArrayLike<number>, enc: 'stage' | 'linear' | 'oklab'): [number, number, number] {
  if (mode === 'normal') return [s[0]!, s[1]!, s[2]!];
  if (isNonSeparable(mode)) {
    const [lb, ls] = enc === 'oklab' ? [b, s] : [rgbToOklab(b), rgbToOklab(s)];
    const [rb, rs] = enc === 'oklab' ? [oklabToRgb(b), oklabToRgb(s)] : [b, s];
    const r = clipColour(blendOkLch(mode, lb, ls), gamutTop(rb, rs), oklabToRgb);
    return enc === 'oklab' ? r : oklabToRgb(r);
  }
  const bl = enc === 'oklab' ? oklabToRgb(b) : [b[0]!, b[1]!, b[2]!];
  const sl = enc === 'oklab' ? oklabToRgb(s) : [s[0]!, s[1]!, s[2]!];
  const r: [number, number, number] = [blendSeparable(mode, bl[0]!, sl[0]!), blendSeparable(mode, bl[1]!, sl[1]!), blendSeparable(mode, bl[2]!, sl[2]!)];
  return enc === 'oklab' ? rgbToOklab(r) : r;
}
