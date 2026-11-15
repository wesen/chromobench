// Contract 1.0's print-stage layers and document geometry in the reference engine: clarity (radius in mm on the
// print), composite.mix (a layer's amount and mask), output.frame (crop, straighten, orientation), the explicit
// pitches, and sampled previews of documents with masks (design §25, §37: a mask in document pixels at scale s is the
// full-scale mask resampled).
import { describe, expect, it } from 'vitest';
import { mixPixel, straighten, type Node } from '@chromobench/contract';
import { clarity, clarityGain, claritySigma, cropPixels, frameImage, gaussianBlur1, orientPixels } from '../src/index.ts';
import { component, compiled, insert, L, m1Engine, maskOf, pixels, push, set, withEdits } from './doc-helpers.ts';

const W = 40, H = 30;
/** A print-xyz-like image: a soft gradient with a fine texture (Y in 0.05…0.6), slightly coloured. */
function print(): Float64Array {
  const d = new Float64Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const Y = 0.05 + 0.5 * (x / W) + 0.05 * Math.sin(x) * Math.cos(y / 2);
    d.set([Y * 0.95, Y, Y * 1.08], (y * W + x) * 3);
  }
  return d;
}

describe('clarity: the reference (core print/clarity.ts)', () => {
  it('a flat image is unchanged; black and white get no detail; strength 0 is the identity', () => {
    const flat = new Float64Array(W * H * 3).fill(0.18);
    expect(clarity(flat, W, H, 3, 0.8, 4, 1).every((v) => Math.abs(v - 0.18) < 1e-14)).toBe(true); // the low-pass of a flat image, to rounding
    expect(clarityGain(0.18, 0.18, 1, 0.8)).toBe(1);
    expect(clarityGain(1, 0.5, 1, 0.8)).toBe(1); // L = 1: midtone weight 0
    expect(clarityGain(0, 0.5, 1, 0.8)).toBe(1);
    const p = print();
    expect(Array.from(clarity(p, W, H, 3, 0, 4, 1))).toEqual(Array.from(p));
  });

  it('it is an unsharp mask of the lightness L = Y^⅓, weighted to the midtones, that keeps chromaticity', () => {
    const p = print();
    const out = clarity(p, W, H, 3, 0.5, 3, 1);
    const Y = new Float64Array(W * H).map((_, i) => p[i * 3 + 1]!);
    const Yb = gaussianBlur1(Y, W, H, 3);
    for (const i of [0, 77, 433, W * H - 1]) {
      const L = Math.cbrt(Y[i]!), Lb = Math.cbrt(Yb[i]!);
      const want = ((L + 0.5 * (1 - (2 * L - 1) ** 2) * (L - Lb)) / L) ** 3;
      for (let k = 0; k < 3; k++) expect(out[i * 3 + k]! / p[i * 3 + k]!).toBeCloseTo(want, 12);
    }
    // more local contrast: the texture's spread around its low-pass grows; a negative strength softens it
    const spread = (a: Float64Array): number => {
      let s = 0;
      for (let i = 0; i < W * H; i++) s += Math.abs(a[i * 3 + 1]! - Yb[i]!);
      return s;
    };
    expect(spread(out)).toBeGreaterThan(spread(p));
    expect(spread(clarity(p, W, H, 3, -0.5, 3, 1))).toBeLessThan(spread(p));
  });

  it('σ in print pixels is radius_mm · 1000 / µm per print pixel; an image without the print pitch is refused', () => {
    expect(claritySigma(0.576, 48)).toBeCloseTo(12, 12);
    expect(() => claritySigma(1, undefined)).toThrow(/print pitch/);
  });
});

describe('output.frame: the reference (core print/geometry.ts)', () => {
  const src = new Float64Array(6 * 4).map((_, i) => i); // 6 × 4, one channel
  it('crop copies the box; orientations map pixels as the display shows them', () => {
    expect(Array.from(cropPixels(src, 6, 1, { x: 1, y: 1, w: 3, h: 2 }))).toEqual([7, 8, 9, 13, 14, 15]);
    const cw = orientPixels('cw90', src, 6, 4, 1);
    expect([cw.width, cw.height]).toEqual([4, 6]);
    expect(Array.from(cw.data.slice(0, 4))).toEqual([18, 12, 6, 0]); // the left column, bottom up, is the top row
    expect(Array.from(orientPixels('flipH', src, 6, 4, 1).data.slice(0, 6))).toEqual([5, 4, 3, 2, 1, 0]);
    expect(Array.from(orientPixels('rot180', src, 6, 4, 1).data)).toEqual(Array.from(src).reverse());
    const t = orientPixels('transpose', src, 6, 4, 1);
    expect(Array.from(orientPixels('transpose', t.data, t.width, t.height, 1).data)).toEqual(Array.from(src));
  });

  it('an angle straightens the crop with the contract reference sampling, then orients', () => {
    const img = new Float64Array(20 * 16 * 3).map((_, i) => Math.sin(i / 7));
    const crop = { x: 3, y: 2, w: 12, h: 10 };
    const got = frameImage(img, 20, 16, 3, { orientation: 'ccw90', angle_deg: 4, crop });
    const want = orientPixels('ccw90', straighten(img, 20, 16, 3, { x: 0, y: 0 }, 20, 16, crop, 4, 'ccw90'), 12, 10, 3);
    expect([got.width, got.height]).toEqual([10, 12]);
    expect(Array.from(got.data)).toEqual(Array.from(want.data));
  });

  it('the display cut of a document is its geometry applied to output.display', async () => {
    const { e, doc } = await m1Engine();
    const d = withEdits(doc, set('geometry.crop', { x: 10, y: 4, w: 50, h: 40 }), set('geometry.orientation', 'cw90'));
    const c = compiled(e, d);
    expect(c.display.op).toBe('output.frame');
    const inner = e.graph.get(c.display.inputs[0]!)!;
    const [a, b] = [await pixels(e, inner), await pixels(e, c.display)];
    expect(Array.from(b)).toEqual(Array.from(orientPixels('cw90', cropPixels(a, 96, 3, { x: 10, y: 4, w: 50, h: 40 }), 50, 40, 3).data));
  });
});

describe('print-stage layers through compile', () => {
  it('a clarity layer at amount 0.6 under a mask is composite.mix of the print and the full clarity', async () => {
    const { e, doc } = await m1Engine();
    const full = compiled(e, withEdits(doc, push('print', 'cl', L('clarity', { strength: 0.5, radius_mm: 2 }))));
    expect(full.cuts.finished!.op).toBe('clarity');
    const d = withEdits(doc,
      insert('masks', 'left', maskOf([['left1', component('linear', { from: { x: 20, y: 0 }, to: { x: 70, y: 0 } })]])),
      push('print', 'cl', L('clarity', { strength: 0.5, radius_mm: 2 }, { amount: 0.6, mask: 'left' })));
    const c = compiled(e, d);
    const mix = c.cuts.finished!;
    expect(mix.op).toBe('composite.mix');
    const [back, top, m, out] = [await pixels(e, c.cuts.print!), await pixels(e, full.cuts.finished!), await pixels(e, e.graph.get(mix.args['mask'] as string) as Node), await pixels(e, mix)];
    for (let i = 0; i < 96 * 64; i++) for (let k = 0; k < 3; k++) expect(out[i * 3 + k]).toBe(mixPixel(back[i * 3 + k]!, top[i * 3 + k]!, 0.6 * m[i]!));
    // 2 mm on the print at 48 µm per print pixel: σ = 41.7 px, and the image changed
    expect(c.cuts.print!.info).toMatchObject({ umPerPx: { paper: 48 } });
    expect(top.some((v, i) => v !== back[i])).toBe(true);
  });

  it('physical sizes need the pitch: film ops, density masks and clarity refuse an image without it', async () => {
    const { e } = await m1Engine();
    const g = e.graph;
    const pat = (domain: string) => g.intern('source.pattern', [], { domain, width: 8, height: 6, seed: 2 }).node;
    for (const [op, recv, args] of [['film.grain', 'film-dyes', {}], ['film.halation', 'film-logH', {}], ['clarity', 'print-xyz', {}], ['print.densityMask', 'paper-logH', { gamma: 0.4 }]] as const) {
      const n = g.intern(op, [pat(recv).id], args).node;
      await expect(pixels(e, n), op).rejects.toThrow(/pitch/);
    }
  });
});

describe('sampled previews of documents with masks', () => {
  it('equal the full-resolution path bit for bit (a mask in document pixels at scale s is the full mask resampled)', async () => {
    const { e: plain, doc } = await m1Engine();
    const { e: fast } = await m1Engine({ sampled: true });
    const d = withEdits(doc,
      insert('masks', 'sky', maskOf([['s1', component('linear', { from: { x: 0, y: 0 }, to: { x: 0, y: 40 } })], ['s2', component('ellipse', { box: { x: 20, y: 5, w: 60, h: 40 } }, 'intersect', 0.7)]], { feather_mm: 0.1 })),
      push('darkroom', 'b1', L('burn', { stops: 1 }, { mask: 'sky' })),
      push('darkroom', 'f1', L('filter', { logH: [0.05, 0, -0.03] }, { mask: 'sky', amount: 0.5 })),
      push('darkroom', 'pf', L('preflash', { fraction: 0.02 })),
      push('print', 'cl', L('clarity', { strength: 0.3, radius_mm: 1 }, { amount: 0.5, mask: 'sky' })));
    const n = compiled(plain, d).display.inputs[0]!;
    compiled(fast, d);
    for (const t of [{ scale: 0.37, precision: 'preview' as const }, { scale: 0.5, precision: 'preview' as const, region: { x: 7, y: 3, w: 31, h: 22 } }]) {
      const ref = { id: n, info: plain.graph.get(n)!.info };
      const [a, b] = [await plain.evaluate(ref, t), await fast.evaluate(ref, t)];
      expect(Array.from(await b.read())).toEqual(Array.from(await a.read()));
    }
  });
});
