// CHB-031 session 04 (S04-N2): a camera RAW without a DNG AsShotNeutral (a NEF) takes its as-shot neutral from the
// camera's as-shot multipliers (LibRaw cam_mul), so "as shot" is the camera's white balance, not daylight.
import { describe, expect, it } from 'vitest';
import { neutralFromCamMul } from '../src/libraw/adapter.ts';

describe('neutralFromCamMul', () => {
  it('is the reciprocal of the multipliers, green = 1', () => {
    // a tungsten-ish shot: red needs little gain, blue a lot → the neutral is red-rich, blue-poor in camera RGB
    expect(neutralFromCamMul([1.6, 1, 2.8, 1])).toEqual([1 / 1.6, 1, 1 / 2.8]);
    // the scale of the multipliers does not matter (Nikon, Canon store them in different units)
    const a = neutralFromCamMul([2, 1, 1.5, 1])!, b = neutralFromCamMul([1024, 512, 768, 512])!;
    for (let k = 0; k < 3; k++) expect(b[k]).toBeCloseTo(a[k]!, 12);
  });
  it('is undefined when the camera recorded none', () => {
    expect(neutralFromCamMul(undefined)).toBeUndefined();
    expect(neutralFromCamMul([0, 0, 0, 0])).toBeUndefined();
    expect(neutralFromCamMul([2, 1, 0, 1])).toBeUndefined();
    expect(neutralFromCamMul([NaN, 1, 1, 1])).toBeUndefined();
  });
});
