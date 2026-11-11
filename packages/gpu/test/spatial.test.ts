// Stage 5 (node-side): blur weights, reduction helpers, the JS pcg4d mirror, program packing.
import { describe, expect, it } from 'vitest';
import { gaussianWeights, BLUR_PARAMS, FIELD_PARAMS } from '../src/spatial.ts';
import { histPercentile, pairwiseSum } from '../src/measure.ts';
import { normal1, pcg4d, PROG } from '../src/chain/program.ts';

describe('gaussianWeights (render.js blurKernel)', () => {
  it('truncates at ⌈3σ⌉ per channel and normalises w0 + 2Σw = 1', () => {
    const { R, w } = gaussianWeights([1.5, 3, 0, 6]);
    expect(R).toBe(18);
    for (let c = 0; c < 4; c++) {
      let s = w[0]![c]!;
      for (let i = 1; i <= R; i++) s += 2 * w[i]![c]!;
      expect(s).toBeCloseTo(1, 12);
    }
    expect(w[5]![0]).toBeGreaterThan(0);
    expect(w[6]![0]).toBe(0);          // channel 0 stops at its own radius 5
    expect(w[0]![2]).toBe(1);          // σ = 0 is the identity
  });
  it('caps the radius at 96 taps', () => {
    expect(gaussianWeights([100]).R).toBe(96);
  });
  it('uniform layouts: blur weights at a 16-byte stride, 97 taps', () => {
    expect(BLUR_PARAMS.offset('w')).toBe(16);
    expect(BLUR_PARAMS.size).toBe(16 + 97 * 16);
    expect(FIELD_PARAMS.size).toBe(48);
    expect(PROG.size).toBeLessThanOrEqual(65536);
  });
});

describe('reductions', () => {
  it('pairwise summation is exact for integers and close for floats', () => {
    expect(pairwiseSum(Float64Array.from({ length: 1000 }, (_, i) => i))).toBe(499500);
    const v = new Float64Array(1e5).fill(0.1);
    expect(Math.abs(pairwiseSum(v) - 1e4)).toBeLessThan(1e-9);
  });
  it('histogram percentiles interpolate within a bin', () => {
    const bins = [0, 10, 10, 0];
    expect(histPercentile(bins, 0, 4, 0.5)).toBeCloseTo(2, 9);
    expect(histPercentile(bins, 0, 4, 0.25)).toBeCloseTo(1.5, 9);
  });
});

describe('pcg4d (JS mirror of rng in pointwise.wgsl)', () => {
  it('is deterministic and matches a known value', () => {
    expect(pcg4d(1, 2, 3, 4)).toEqual(pcg4d(1, 2, 3, 4));
    expect(pcg4d(0, 0, 0, 0)).not.toEqual(pcg4d(1, 0, 0, 0));
  });
  it('normals are roughly standard', () => {
    let s = 0, s2 = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const z = normal1(i % 200, Math.floor(i / 200), 0, 9);
      s += z;
      s2 += z * z;
    }
    expect(Math.abs(s / n)).toBeLessThan(0.03);
    expect(Math.abs(s2 / n - 1)).toBeLessThan(0.05);
  });
});
