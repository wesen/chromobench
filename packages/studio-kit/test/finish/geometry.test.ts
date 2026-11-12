// CHB-022 stage 1: the finish kit's pure geometry. The worked example (3000 × 2000, 1.3°, 4:5 → 1568 × 1960 at
// (716, 20)), toSource/toShown round trips over the eight orientations and ±45°, agreement with the contract's
// reference sampler straighten(), keep-inside, orientation steps that keep the region read, no DOM imports.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mulberry32, ORIENTATIONS, straighten, type Box, type FrameSettings, type Orientation } from '@chromobench/contract';
import {
  angleOf, composeOrientation, constrain, cropCorners, fitCrop, fitsInside, frameValid, largestCrop, orientFrame, orientPoint, parseAspect, sensorTurn,
  shownSize, swapAspect, toShown, toSource, towards, unorientPoint,
} from '../../kits/finish/src/geometry.ts';

const rnd = mulberry32(22);
const r = (lo: number, hi: number): number => lo + rnd.next() * (hi - lo);

describe('geometry: the worked example (guide §10)', () => {
  it('3000 × 2000, 1.3°, 4:5 → crop 1568 × 1960 at (716, 20), valid, ratio exactly 0.8', () => {
    const f = fitCrop(3000, 2000, { angle_deg: 1.3, aspect: '4:5' });
    expect(f).toEqual({ orientation: 'none', angle_deg: 1.3, crop: { x: 716, y: 20, w: 1568, h: 1960 } });
    expect(frameValid(f, 3000, 2000)).toBe(true);
    expect(f.crop!.w / f.crop!.h).toBe(0.8);
    // one step larger does not fit: the keep-inside constraint is what shrank 1600 × 2000
    expect(fitsInside({ x: 714, y: 17.5, w: 1572, h: 1965 }, sensorTurn(f), 3000, 2000)).toBe(false);
    expect(fitCrop(3000, 2000, { aspect: '4:5' }).crop).toEqual({ x: 700, y: 0, w: 1600, h: 2000 });
  });
  it('aspects: original, presets, w:h, swapped orientation shows h:w', () => {
    expect(parseAspect('original', 3000, 2000)).toEqual([3, 2]);
    expect(parseAspect('original', 3000, 2000, 'cw90')).toEqual([2, 3]);
    expect(parseAspect('16:9', 1, 1)).toEqual([16, 9]);
    expect(parseAspect('free', 1, 1)).toBeNull();
    expect(() => parseAspect('banana', 1, 1)).toThrow(/unknown aspect/);
    // a portrait 4:5 on a frame shown turned by 90°: the sensor box is 5:4
    const f = fitCrop(3000, 2000, { aspect: '4:5', orientation: 'cw90' });
    expect(shownSize(f, 3000, 2000)).toEqual({ w: 2000, h: 2500 });
    expect(f.crop).toEqual({ x: 250, y: 0, w: 2500, h: 2000 });
    expect(fitCrop(300, 200, {}).crop).toBeNull();
  });
});

/** the mock's / host's discrete orient(): output pixel (x, y) reads input (sx, sy) */
function orient(data: Float64Array, w: number, h: number, o: Orientation): { d: Float64Array; w: number; h: number } {
  const swap = o === 'cw90' || o === 'ccw90' || o === 'transpose' || o === 'transverse';
  const W = swap ? h : w, H = swap ? w : h;
  const d = new Float64Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let sx = x, sy = y;
    switch (o) {
      case 'cw90': sx = y; sy = h - 1 - x; break;
      case 'ccw90': sx = w - 1 - y; sy = x; break;
      case 'rot180': sx = w - 1 - x; sy = h - 1 - y; break;
      case 'flipH': sx = w - 1 - x; break;
      case 'flipV': sy = h - 1 - y; break;
      case 'transpose': sx = y; sy = x; break;
      case 'transverse': sx = w - 1 - y; sy = h - 1 - x; break;
      default: break;
    }
    d[y * W + x] = data[sy * w + sx]!;
  }
  return { d, w: W, h: H };
}

describe('geometry: shown ↔ source', () => {
  it('toSource ∘ toShown is the identity over 8 orientations, ±45° and random crops', () => {
    const W = 3000, H = 2000;
    let worst = 0;
    for (const o of ORIENTATIONS) for (let i = 0; i < 40; i++) {
      const angle_deg = i === 0 ? 0 : r(-45, 45);
      const f = fitCrop(W, H, { angle_deg, orientation: o, aspect: [Math.round(r(1, 9)), Math.round(r(1, 9))], centre: { x: r(800, 2200), y: r(600, 1400) } });
      const s = shownSize(f, W, H);
      for (let k = 0; k < 5; k++) {
        const X = r(0, s.w), Y = r(0, s.h);
        const p = toSource(f, W, H, X, Y);
        const q = toShown(f, W, H, p.x, p.y);
        worst = Math.max(worst, Math.abs(q.x - X), Math.abs(q.y - Y));
        expect(p.x).toBeGreaterThanOrEqual(-1e-6);
        expect(p.x).toBeLessThanOrEqual(W + 1e-6);
      }
    }
    expect(worst).toBeLessThan(1e-7);
    for (const o of ORIENTATIONS) {
      const p = orientPoint(o, 30, 20, 7.25, 3.5);
      expect(unorientPoint(o, 30, 20, p.x, p.y)).toEqual({ x: 7.25, y: 3.5 });
    }
  });

  it('agrees with the contract sampler: straighten() + orient of a ramp reads the frame where toSource says', () => {
    // value = x + 1000·y is linear, so bilinear sampling returns the sample position exactly
    const W = 60, H = 40;
    const src = new Float64Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) src[y * W + x] = x + 0.5 + 1000 * (y + 0.5);
    for (const o of ORIENTATIONS) for (const angle of [0, 7, -12.5]) {
      const f: FrameSettings = { orientation: o, angle_deg: angle, crop: largestCrop(W, H, { angle_deg: angle, orientation: o, aspect: [5, 4], centre: { x: 28, y: 21 } }) };
      const b = f.crop!;
      const out = orient(straighten(src, W, H, 1, { x: 0, y: 0 }, W, H, b, angle, o), b.w, b.h, o);
      let worst = 0;
      for (let Y = 2; Y < out.h - 2; Y += 3) for (let X = 2; X < out.w - 2; X += 3) {
        const v = out.d[Y * out.w + X]!;
        const p = toSource(f, W, H, X + 0.5, Y + 0.5);
        worst = Math.max(worst, Math.abs(v - (p.x + 1000 * p.y)));
      }
      expect(worst, `${o} ${angle}°`).toBeLessThan(1e-6);
    }
  });
});

describe('geometry: keep-inside and edits', () => {
  it('constrain shrinks an invalid frame about its centre to a valid integer box; a valid one is unchanged', () => {
    const W = 3000, H = 2000;
    for (let i = 0; i < 200; i++) {
      const o = ORIENTATIONS[i % 8]!;
      const f: FrameSettings = { orientation: o, angle_deg: r(-45, 45), crop: { x: Math.round(r(-200, 2500)), y: Math.round(r(-200, 1600)), w: Math.round(r(10, 3200)), h: Math.round(r(10, 2200)) } };
      const c = constrain(f, W, H);
      expect(c.crop).not.toBeNull();
      expect(frameValid(c, W, H)).toBe(true);
      expect([c.crop!.x, c.crop!.y, c.crop!.w, c.crop!.h].every(Number.isInteger)).toBe(true);
      if (frameValid(f, W, H)) expect(c).toBe(f);
    }
    // rotating a full crop shrinks it (the picture appears to zoom in)
    const turned = constrain({ orientation: 'none', angle_deg: 10, crop: null }, W, H);
    expect(turned.crop!.w).toBeLessThan(W);
    expect(turned.crop!.w / turned.crop!.h).toBeCloseTo(1.5, 2);
  });
  it('towards: a move sticks at the edge', () => {
    const a: Box = { x: 100, y: 100, w: 500, h: 400 };
    const m = towards(a, { ...a, x: -300 }, 0, 1000, 800);
    expect(m.x).toBeCloseTo(0, 5);
    expect(m.w).toBe(500);
  });
  it('orientation steps keep the region read; composition is a group', () => {
    let f: FrameSettings = { orientation: 'none', angle_deg: 3, crop: { x: 400, y: 300, w: 1000, h: 800 } };
    const region = cropCorners(f.crop!, sensorTurn(f));
    for (const step of ['cw90', 'flipH', 'ccw90', 'flipV', 'cw90'] as const) {
      f = orientFrame(f, step);
      cropCorners(f.crop!, sensorTurn(f)).forEach((p, i) => {
        expect(p.x).toBeCloseTo(region[i]!.x, 9);
        expect(p.y).toBeCloseTo(region[i]!.y, 9);
      });
    }
    expect(composeOrientation(composeOrientation('none', 'cw90'), 'cw90')).toBe('rot180');
    expect(composeOrientation('cw90', 'ccw90')).toBe('none');
    expect(composeOrientation('none', 'flipH')).toBe('flipH');
    expect(composeOrientation('flipH', 'cw90')).toBe('transverse');
  });
  it('swapAspect turns a landscape crop into a portrait one that fits; angleOf levels a line', () => {
    const f = fitCrop(3000, 2000, { aspect: '3:2', angle_deg: 2 });
    const s = swapAspect(f, 3000, 2000);
    expect(frameValid(s, 3000, 2000)).toBe(true);
    expect(s.crop!.h).toBeGreaterThan(s.crop!.w);
    expect(angleOf({ x: 0, y: 0 }, { x: 100, y: 100 * Math.tan((1.3 * Math.PI) / 180) })).toBeCloseTo(-1.3, 9);
    expect(angleOf({ x: 0, y: 0 }, { x: -2, y: 100 })).toBeCloseTo(-Math.atan2(2, 100) * 180 / Math.PI, 9);
  });
  it('is pure: imports only the contract', () => {
    const src = readFileSync(new URL('../../kits/finish/src/geometry.ts', import.meta.url), 'utf8');
    const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports).toEqual(['@chromobench/contract']);
    expect(src).not.toMatch(/\bdocument\b|\bwindow\b/);
  });
});
