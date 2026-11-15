// CHB-045 GPUC-3 (CHB-037 P10-26): the density mask takes log10 of the blurred transmittance; a negative dense enough
// for 10^−PD to underflow (f64: below 10⁻³²⁴) gave −∞ and NaN. Floored at the contract's MASK_T_FLOOR (density 8).
import { describe, expect, it } from 'vitest';
import { MASK_T_FLOOR } from '@chromobench/contract';
import { maskDensity, maskDensityPolar } from '../src/print/densityMask.ts';

describe('density mask: the log of the mask exposure is floored (CHB-045)', () => {
  // three layers per pixel: two pixels whose transmittance underflows to 0, one at T = 1e-12, one at T = 0.1
  const pd = Float64Array.from([400, 400, 400, 310, 310, 310, 12, 12, 12, 1, 1, 1]);
  it('a zero (underflowed) and a subnormal transmittance give finite densities', () => {
    expect(10 ** -400).toBe(0);
    expect(10 ** -310).toBeGreaterThan(0); // a subnormal f64
    expect(10 ** -310).toBeLessThan(2 ** -1022);
    for (const d of [maskDensity(pd, 4, 1, 3, 0.5, 0), maskDensityPolar(pd, 4, 1, 3, 0.5, 0, 'same')]) {
      expect([...d].every(Number.isFinite)).toBe(true);
    }
    const d = maskDensity(pd, 4, 1, 3, 0.5, 0);
    // the reference is the floored smallest exposure: everything at or below the floor has density 0
    expect([...d]).toEqual([0, 0, 0, 0.5 * (Math.log10(0.1) - Math.log10(MASK_T_FLOOR))]);
    const s = maskDensityPolar(pd, 4, 1, 3, 0.5, 0, 'same');
    expect(s[0]).toBeCloseTo(0.5 * (Math.log10(0.1) - Math.log10(MASK_T_FLOOR)), 12);
    expect(s[3]).toBe(0);
  });
});
