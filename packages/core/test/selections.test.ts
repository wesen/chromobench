// Contract 1.6 (CHB-049, D3): the selections' components and the mask's grow, density and stroke flow, in f64 —
// what they compute and their laws (invert twice is the identity, grow then contract by the same radius lies between
// the mask and the grown mask, contract then grow lies under the mask, grow and contract are dual, feather and grow
// are monotone, the wand's contiguous region is inside its non-contiguous one).
import { describe, expect, it } from 'vitest';
import { maskCombine } from '@chromobench/contract';
import { ellipseAt, fullGrid, gaussianBlur1, gridCentres, growMask, growPlan, paintMask, polygonMask, rectAt, wandMask, type Stroke } from '../src/index.ts';

const W = 48, H = 40;
const raster = (f: (x: number, y: number) => number): Float64Array => {
  const { xs, ys } = gridCentres(fullGrid(W, H));
  const out = new Float64Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out[y * W + x] = f(xs[x]!, ys[y]!);
  return out;
};
const all = (a: Float64Array, b: Float64Array, ok: (x: number, y: number) => boolean): boolean => a.every((v, i) => ok(v, b[i]!));
/** a soft mask with holes and specks: an ellipse minus a smaller one, plus a speck */
const holey = (): Float64Array => raster((X, Y) => {
  const outer = ellipseAt(X, Y, { x: 6, y: 5, w: 34, h: 28 }, 20);
  const hole = ellipseAt(X, Y, { x: 18, y: 15, w: 6, h: 5 }, 0);
  const speck = rectAt(X, Y, { x: 42, y: 34, w: 2, h: 2 }, 0);
  return Math.max(maskCombine('subtract', outer, hole), speck);
});

describe('mask.rect', () => {
  it('is 1 inside, 0 outside, ½ on the edge; a quarter turn of a square is the same square', () => {
    const b = { x: 10, y: 8, w: 20, h: 12 };
    expect(rectAt(20, 14, b, 0)).toBe(1);
    expect(rectAt(5, 14, b, 0)).toBe(0);
    expect(rectAt(10, 14, b, 0)).toBe(0.5);
    const sq = { x: 10, y: 10, w: 16, h: 16 };
    const a = raster((X, Y) => rectAt(X, Y, sq, 0)), c = raster((X, Y) => rectAt(X, Y, sq, 90));
    expect(all(a, c, (x, y) => Math.abs(x - y) < 1e-12)).toBe(true);
  });
});

describe('mask.polygon (the lassos)', () => {
  it('an axis-aligned square outline is the rectangle away from its outside corners', () => {
    const p = polygonMask([[8, 6], [30, 6], [30, 26], [8, 26]], fullGrid(W, H));
    const r = raster((X, Y) => rectAt(X, Y, { x: 8, y: 6, w: 22, h: 20 }, 0));
    let worst = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) worst = Math.max(worst, Math.abs(p[y * W + x]! - r[y * W + x]!));
    expect(worst).toBeLessThan(1e-12); // pixel centres sit at .5, never within ½ px of a corner diagonally outside
  });
  it('the even-odd rule: a self-crossing star leaves its centre out; the order of the points does not matter', () => {
    const star = [0, 1, 2, 3, 4].map((k) => { const t = (k * 4 * Math.PI) / 5 - Math.PI / 2; return [24 + 16 * Math.cos(t), 20 + 16 * Math.sin(t)]; });
    const m = polygonMask(star, fullGrid(W, H));
    expect(m[20 * W + 24]).toBe(0);
    expect(m[7 * W + 24]).toBe(1); // inside the top point
    const back = polygonMask([...star].reverse(), fullGrid(W, H));
    expect(all(m, back, (a, b) => Math.abs(a - b) < 1e-9)).toBe(true);
  });
  it('on a half-scale grid it is the polygon at the grid\'s pixel centres', () => {
    const pts = [[4, 4], [40, 10], [20, 36]];
    const half = polygonMask(pts, { w: W / 2, h: H / 2, region: { x: 0, y: 0, w: W, h: H } });
    const full = polygonMask(pts, fullGrid(W, H));
    // interior pixels agree (the edge is ½ document px wide, so a coarse grid sees it at other centres)
    let same = 0, n = 0;
    for (let y = 0; y < H / 2; y++) for (let x = 0; x < W / 2; x++) {
      const f = full[(2 * y + 1) * W + 2 * x + 1]!;
      if (f === 0 || f === 1) { n++; if (half[y * (W / 2) + x] === f) same++; }
    }
    expect(same / n).toBeGreaterThan(0.97);
  });
});

describe('mask.wand', () => {
  // two grey squares of the same value on a dark ground, one with a slightly different square inside
  const img = (): Float64Array => {
    const d = new Float64Array(W * H * 3).fill(0.1);
    const fill = (x0: number, y0: number, x1: number, y1: number, v: number) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) for (let k = 0; k < 3; k++) d[(y * W + x) * 3 + k] = v + k * 0.001;
    };
    fill(2, 2, 18, 18, 0.6);
    fill(26, 4, 44, 30, 0.6);
    fill(30, 8, 36, 14, 0.66);
    return d;
  };
  const s = { tolerance: 0.05, softness: 0, contiguous: true, lo: 0, hi: 1 };
  it('contiguous selects the clicked square only; not contiguous, every pixel close enough', () => {
    const c = wandMask(img(), W, H, 3, 5, 5, s);
    expect(c[5 * W + 5]).toBe(1);
    expect(c[20 * W + 30]).toBe(0);
    expect(c[0]).toBe(0);
    const nc = wandMask(img(), W, H, 3, 5, 5, { ...s, contiguous: false });
    expect(nc[20 * W + 30]).toBe(1);
    // the contiguous region lies inside the non-contiguous one
    expect(all(c, nc, (a, b) => a <= b)).toBe(true);
  });
  it('the tolerance is the largest channel difference over the range; a wider tolerance selects more', () => {
    const tight = wandMask(img(), W, H, 3, 28, 6, s);
    expect(tight[10 * W + 32]).toBe(0); // 0.06 brighter
    const wide = wandMask(img(), W, H, 3, 28, 6, { ...s, tolerance: 0.07 });
    expect(wide[10 * W + 32]).toBe(1);
    expect(all(tight, wide, (a, b) => a <= b)).toBe(true);
    // the range scales the difference: on a domain four times as wide, 0.06 is 0.015
    expect(wandMask(img(), W, H, 3, 28, 6, { ...s, hi: 4 })[10 * W + 32]).toBe(1);
  });
  it('a soft edge is 1 − smoothstep beyond the tolerance', () => {
    const c = wandMask(img(), W, H, 3, 28, 6, { ...s, contiguous: false, softness: 0.02 });
    const u = (0.06 - 0.05) / 0.02;
    expect(c[10 * W + 32]).toBeCloseTo(1 - u * u * (3 - 2 * u), 9);
  });
});

describe('mask.grow', () => {
  it('the octagon: half-side round(r(√2 − 1)), diagonals round(r(1 − √2/2)), its reach about r', () => {
    expect(growPlan(10)).toMatchObject({ s: 4, a: 3, grow: true, reach: 10 });
    expect(growPlan(-5)).toMatchObject({ s: 2, a: 1, grow: false, reach: 4 });
    expect(growPlan(0.4)).toMatchObject({ s: 0, a: 0, reach: 0 });
  });
  it('a point grows into the octagon of radius r', () => {
    const m = new Float64Array(W * H);
    m[20 * W + 24] = 1;
    const g = growMask(m, W, H, 10);
    expect(g[20 * W + 34]).toBe(1); // r along the row
    expect(g[30 * W + 24]).toBe(1);
    expect(g[20 * W + 35]).toBe(0);
    expect(g[27 * W + 31]).toBe(1); // (7, 7): |x| + |y| = 14 ≤ 2s + 2a
    expect(g[28 * W + 32]).toBe(0);
  });
  it('grow then contract by the same radius lies between the mask and the grown mask; contract then grow under the mask', () => {
    const m = holey();
    for (const r of [2, 3.5, 6]) {
      const grown = growMask(m, W, H, r);
      const closed = growMask(grown, W, H, -r);
      const opened = growMask(growMask(m, W, H, -r), W, H, r);
      expect(all(closed, m, (c, x) => c >= x)).toBe(true);
      expect(all(closed, grown, (c, g) => c <= g)).toBe(true);
      expect(all(opened, m, (o, x) => o <= x)).toBe(true);
    }
    // the hole (6 × 5 px) closes at r = 6; the speck (2 px) opens away at r = 2
    expect(growMask(growMask(m, W, H, 6), W, H, -6)[17 * W + 21]).toBeGreaterThan(0.99);
    expect(growMask(growMask(m, W, H, -2), W, H, 2)[35 * W + 43]).toBe(0);
  });
  it('contract is grow of the inverse, inverted; grow is monotone in the mask and in r; 0 is the identity', () => {
    const m = holey();
    const inv = (x: Float64Array) => x.map((v) => 1 - v);
    const a = growMask(m, W, H, -4), b = inv(growMask(inv(m), W, H, 4));
    expect(all(a, b, (x, y) => Math.abs(x - y) < 1e-15)).toBe(true);
    const smaller = m.map((v) => v * 0.7);
    expect(all(growMask(smaller, W, H, 4), growMask(m, W, H, 4), (x, y) => x <= y)).toBe(true);
    expect(all(growMask(m, W, H, 3), growMask(m, W, H, 6), (x, y) => x <= y)).toBe(true);
    expect(all(growMask(m, W, H, 0), m, (x, y) => x === y)).toBe(true);
  });
});

describe('the mask\'s other laws (contract 1.6)', () => {
  it('invert twice is the identity (to rounding); feather is monotone', () => {
    const m = holey();
    expect(all(m.map((v) => 1 - (1 - v)), m, (x, y) => Math.abs(x - y) <= 1e-16)).toBe(true);
    const smaller = m.map((v, i) => v * (i % 3 === 0 ? 0.5 : 1));
    expect(all(gaussianBlur1(smaller, W, H, 2), gaussianBlur1(m, W, H, 2), (x, y) => x <= y + 1e-15)).toBe(true);
  });
  it('density: 1 − d(1 − m) is the one algebra\'s add of a full mask at 1 − d', () => {
    for (const m of [0, 0.3, 1]) for (const d of [0, 0.4, 1]) expect(maskCombine('add', m, 1, 1 - d)).toBeCloseTo(1 - d * (1 - m), 15);
  });
  it('a stroke\'s flow: 1 is the maximum as before; ½ twice over the same place builds up to ¾', () => {
    const st = (flow?: number): Stroke => ({ points: [[10, 20, 0.5], [38, 20, 0.5]], radius: 5, hardness: 1, mode: 'add', ...(flow === undefined ? {} : { flow }) });
    const one = paintMask([st()], fullGrid(W, H));
    expect(all(paintMask([st(1)], fullGrid(W, H)), one, (a, b) => a === b)).toBe(true);
    const twice = paintMask([st(0.5), st(0.5)], fullGrid(W, H));
    expect(twice[20 * W + 24]).toBeCloseTo(0.75, 15);
    expect(all(paintMask([st(0.5)], fullGrid(W, H)), one, (a, b) => a <= b)).toBe(true);
    const erased = paintMask([st(), { ...st(0.5), mode: 'erase' }], fullGrid(W, H));
    expect(erased[20 * W + 24]).toBeCloseTo(0.5, 15);
  });
});
