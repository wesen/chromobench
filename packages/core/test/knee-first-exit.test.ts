// CHB-048: the display knee's chroma search finds the first exit from grey. Along a ray of constant OkLab L and hue the
// sRGB gamut need not be one interval: a deep blue leaves it, comes back and leaves again. The bisection over [0, cHi]
// landed on either exit, so two print colours 1e-5 apart displayed 8 % apart in blue (found by the GPU parity of a
// blends document once ClipColor put colours on the working gamut's edge, LAY-2); the GPU's okMaxChroma marches alike.
import { describe, expect, it } from 'vitest';
import { adaptBradford, D65, displayLinear, displaySetup, maxChromaOf, mulMV, nodePacksData, paperWhiteXYZ, perceptual, PhysicsEnv, SPEKTRAFILM, whiteXYZ } from '../src/index.ts';

describe('display knee: the first exit from grey', () => {
  const env = new PhysicsEnv(nodePacksData(), SPEKTRAFILM);
  const v = env.viewing('kodak_portra_endura', 'D50');
  const ds = displaySetup({ rendering: 'scan-of-print', white: D65, paperWhite: adaptBradford(paperWhiteXYZ(v), whiteXYZ(v), D65), space: 'srgb', knee: 'oklch' });
  const a = [0.0814962163567543, 0.03526230528950691, 0.420273095369339], b = [0.08150083048134485, 0.035264134577057835, 0.4202833749361063];

  it('the ray of a deep blue leaves the sRGB gamut twice; maxChromaOf returns the first edge, and the whole way to it is inside', () => {
    const P = perceptual('oklch', 'srgb');
    const [L, A, B] = P.fwd(mulMV(ds.M, a));
    const h = Math.atan2(B, A);
    const inside = (C: number) => P.inGamut(L, C * Math.cos(h), C * Math.sin(h));
    let changes = 0;
    for (let C = 0.005; C < 0.4; C += 0.001) if (inside(C) !== inside(C - 0.001)) changes++;
    expect(changes).toBeGreaterThanOrEqual(3); // out, in, out: not one interval
    const Cmax = maxChromaOf(P, L, h);
    for (let k = 1; k <= 100; k++) expect(inside((Cmax * k) / 100)).toBe(true);
    expect(inside(Cmax + 1e-6)).toBe(false);
  });

  it('between two print colours 1e-5 apart the display moves smoothly (it jumped by 0.037 in blue)', () => {
    // the edge is steep here (the red channel is 2e-5 from the sRGB edge, so Cmax moves with it): 8.6e-4 over the
    // segment, in eight steps of at most 1.2e-4 each, no jump
    let prev = displayLinear(a, ds);
    for (let k = 1; k <= 8; k++) {
      const next = displayLinear(a.map((q, i) => q + (k / 8) * (b[i]! - q)), ds);
      for (let c = 0; c < 3; c++) expect(Math.abs(next[c]! - prev[c]!)).toBeLessThan(1.5e-4);
      prev = next;
    }
  });
});
