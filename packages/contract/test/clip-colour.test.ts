// CHB-048 (LAY-2, CHB-037 P10-9): the OkLCh blend modes keep the gamut by W3C ClipColor in OkLCh. Laws: a result in
// the gamut is unchanged bit for bit; a clipped result is in the gamut, keeps its lightness and hue, and has the
// largest chroma that fits; clipping is idempotent; luminosity left the gamut without it (the reason for the item).
import { describe, expect, it } from 'vitest';
import { blendOkLch, clipColour, CLIP_EPS, CLIP_MARCH, CLIP_STEPS, gamutTop, NON_SEPARABLE_BLENDS } from '../src/index.ts';

// Ottosson's OkLab over linear sRGB (the contract test's own conversion; engines pass theirs)
const M1 = [[0.4122214708, 0.5363325363, 0.0514459929], [0.2119034982, 0.6806995451, 0.1073969566], [0.0883024619, 0.2817188376, 0.6299787005]];
const M2 = [[0.2104542553, 0.793617785, -0.0040720468], [1.9779984951, -2.428592205, 0.4505937099], [0.0259040371, 0.7827717662, -0.808675766]];
const M2I = [[1, 0.3963377774, 0.2158037573], [1, -0.1055613458, -0.0638541728], [1, -0.0894841775, -1.291485548]];
const M1I = [[4.0767416621, -3.3077115913, 0.2309699292], [-1.2684380046, 2.6097574011, -0.3413193965], [-0.0041960863, -0.7034186147, 1.707614701]];
const mv = (A: number[][], x: ArrayLike<number>): number[] => A.map((r) => r[0]! * x[0]! + r[1]! * x[1]! + r[2]! * x[2]!);
const toLab = (rgb: ArrayLike<number>): [number, number, number] => mv(M2, mv(M1, rgb).map(Math.cbrt)) as [number, number, number];
const toRgb = (lab: ArrayLike<number>): number[] => mv(M1I, mv(M2I, lab).map((v) => v * v * v));
// in the gamut as clipColour counts it (CLIP_EPS of the top: f32 noise on an edge colour)
const inGamut = (c: number[], top: number, eps = CLIP_EPS * top + 1e-12): boolean => c.every((v) => v >= -eps && v <= top + eps);
const hue = (lab: ArrayLike<number>): number => Math.atan2(lab[2]!, lab[1]!);

/** A small deterministic sample of linear RGB colours in [0, 1] (saturated corners included). */
function colours(): number[][] {
  const out: number[][] = [];
  const v = [0, 0.02, 0.1, 0.3, 0.6, 0.9, 1];
  for (const r of v) for (const g of v) for (const b of v) out.push([r, g, b]);
  return out;
}

describe('ClipColor in OkLCh (contract clipColour)', () => {
  it('luminosity of a saturated dark backdrop and a light source left the gamut before (the item\'s reason)', () => {
    const b = toLab([0.02, 0.05, 0.6]), s = toLab([0.9, 0.9, 0.9]);
    const raw = toRgb(blendOkLch('luminosity', b, s));
    expect(inGamut(raw, 1)).toBe(false);
    const clipped = toRgb(clipColour(blendOkLch('luminosity', b, s), gamutTop([0.02, 0.05, 0.6], [0.9, 0.9, 0.9]), toRgb as never));
    expect(inGamut(clipped, 1)).toBe(true);
  });

  it('every OkLCh mode over a grid of colours: in the gamut, L and hue kept, unchanged when it fitted, the largest chroma, idempotent', () => {
    const cs = colours();
    let clipped = 0, kept = 0;
    for (const mode of NON_SEPARABLE_BLENDS) {
      for (let i = 0; i < cs.length; i += 7) {
        for (let j = 3; j < cs.length; j += 11) {
          const rb = cs[i]!, rs = cs[j]!;
          const top = gamutTop(rb, rs);
          expect(top).toBe(1);
          const raw = blendOkLch(mode, toLab(rb), toLab(rs));
          const out = clipColour(raw, top, toRgb as never);
          const rgb = toRgb(out);
          if (inGamut(toRgb(raw), top, 0)) {
            // in the gamut: unchanged, bit for bit
            if (inGamut(toRgb(raw), top)) expect(out).toEqual(raw);
            kept++;
            continue;
          }
          clipped++;
          expect(inGamut(rgb, top), `${mode} ${rb} ${rs}`).toBe(true);
          expect(out[0]).toBe(raw[0]);
          const C = Math.hypot(raw[1], raw[2]);
          if (C > 1e-6 && Math.hypot(out[1], out[2]) > 1e-9) expect(Math.abs(hue(out) - hue(raw))).toBeLessThan(1e-9);
          // the largest chroma: a little more leaves the gamut (unless the grey itself is on its edge)
          const t = C > 0 ? Math.hypot(out[1], out[2]) / C : 0;
          const dt = 2 ** -(CLIP_STEPS - 2) / CLIP_MARCH;
          const g = raw[0] ** 3;
          if (t > 0 && t < 1 - dt && g > 1e-4 && g < top * (1 - 1e-4)) {
            const more = toRgb([raw[0], raw[1] * (t + dt), raw[2] * (t + dt)]);
            expect(inGamut(more, top), `${mode}: chroma not maximal`).toBe(false);
          }
          // the first exit: the whole way from grey to the result is in the gamut
          for (let k = 1; k <= 16; k++) expect(inGamut(toRgb([raw[0], (raw[1] * t * k) / 16, (raw[2] * t * k) / 16]), top), `${mode}: left on the way`).toBe(true);
          // idempotent
          expect(clipColour(out, top, toRgb as never)).toEqual(out);
        }
      }
    }
    expect(clipped).toBeGreaterThan(20);
    expect(kept).toBeGreaterThan(20);
  });

  it('the top follows a scene-linear highlight above white, so its colour stays; a grey outside the gamut stays grey', () => {
    const rb = [2.4, 1.8, 1.2], rs = [0.5, 0.5, 0.5];
    expect(gamutTop(rb, rs)).toBe(2.4);
    const raw = blendOkLch('colour', toLab(rb), toLab(rs));
    expect(clipColour(raw, gamutTop(rb, rs), toRgb as never)).toEqual(raw);
    const neg = clipColour([-0.1, 0.05, 0.02], 1, toRgb as never);
    expect(neg).toEqual([-0.1, 0, 0]);
  });
});
