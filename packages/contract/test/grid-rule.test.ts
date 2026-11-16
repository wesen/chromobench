// CHB-045 GPUC-2 (CHB-037 P10-15): the one grid rule. Output pixel p of an n-pixel grid over [x, x + w) reads image
// pixel x + ⌊(2p + 1)·w / 2n⌋ — exact in integers, ties included — which core, the mock and the GPU (kernels/grid.wgsl,
// u32) all compute. The broken variant is the GPU's rule before: ⌊(p + ½)·f32(w / n)⌋ in f32.
import { describe, expect, it } from 'vitest';
import { GRID_LIMIT, gridAxis, gridCheck, gridSample, isChromobenchError } from '../src/index.ts';

/** The exact rule in BigInt: no floating point at all. */
const exact = (x: number, w: number, n: number, p: number): number => x + Number(((2n * BigInt(p) + 1n) * BigInt(w)) / (2n * BigInt(n)));
/** The rule before CHB-045 on the GPU: (p + ½) times the f32 ratio w/n, each product rounded to f32. */
const f32Rule = (x: number, w: number, n: number, p: number): number => {
  const z = Math.fround(w / n);
  return x + Math.min(w - 1, Math.floor(Math.fround((p + 0.5) * z)));
};

describe('the grid rule (CHB-045)', () => {
  it('equals the exact rule for every output width 1…4000 of a 4000-px region, and every height 1…2674 of a 2674-px one', () => {
    for (const [W, x] of [[4000, 0], [2674, 0], [4000, 17]] as const) {
      for (let n = 1; n <= W; n++) {
        const xs = gridAxis(x, W, n);
        for (let p = 0; p < n; p++) if (xs[p] !== exact(x, W, n, p)) throw new Error(`W ${W} n ${n} p ${p}: ${xs[p]} vs ${exact(x, W, n, p)}`);
        expect(xs[0]).toBeGreaterThanOrEqual(x);
        expect(xs[n - 1]).toBeLessThan(x + W);
      }
    }
  });

  it('puts a tie on the right pixel: the 106-px thumbnail of a 4000-px image reads pixel 1000 at column 26', () => {
    expect(((2 * 26 + 1) * 4000) % (2 * 106)).toBe(0); // centre 26.5 · 4000/106 = 1000 exactly
    expect(gridSample(0, 4000, 106, 26)).toBe(1000);
    expect(f32Rule(0, 4000, 106, 26)).toBe(999); // the f32 ratio rounds down: the left pixel
  });

  it('broken variant: the f32 rule reads another pixel in at least one column of 554 of the 3901 widths 100…4000', () => {
    let widths = 0, columns = 0, ties = 0;
    for (let n = 100; n <= 4000; n++) {
      let bad = 0;
      for (let p = 0; p < n; p++) {
        if (f32Rule(0, 4000, n, p) !== gridSample(0, 4000, n, p)) {
          bad++;
          if (((2 * p + 1) * 4000) % (2 * n) === 0) ties++;
        }
      }
      if (bad) widths++;
      columns += bad;
    }
    expect(widths).toBe(554);
    expect(ties).toBe(1419); // CHB-043 ch. 3: 1,419 mismatching columns at ties and 6 near ties
    expect(columns).toBe(1425);
  });

  it('refuses a grid whose rule could wrap in u32 (n·w ≥ 2³¹)', () => {
    expect(() => gridCheck(46341, 46341)).toThrow(/grid rule's range/);
    try {
      gridAxis(0, 2 ** 16, 2 ** 15);
      throw new Error('no throw');
    } catch (e) {
      expect(isChromobenchError(e) && e.code).toBe('E_ARG_RANGE');
    }
    expect(() => gridCheck(16384, 16384)).not.toThrow(); // the largest 2-D texture on any adapter we target
    expect(16384 * 16384).toBeLessThan(GRID_LIMIT);
  });
});
