// The digital ops of the composite stages in the reference engine (contract 1.1): the working encodings, the tone
// functions, the colour tools, the blend modes and their laws (design §37: identity at amount 0 and at identity params,
// blend identities, curve monotonicity), and documents through compile on the M1 negative and a camera file.
import { describe, expect, it } from 'vitest';
import { BLEND_MODES, compile, edit, mixPixel, newDocument, type BlendMode, type Document } from '@chromobench/contract';
import { Coll, insert, type Json } from '@chromobench/values';
import {
  applyEncode, blendChannel, blendPixel, colourAt, D50, D65, encodeTransform, evalCurve, evalLevels, gradeAt, gradeWheels, hslAt, hslBands,
  mixerMatrix, oklabToRgb, radialAt, rgbToOklab, toneCurve, vibranceAt, vibranceGain, vignetteGain, xyzToWorking, mulMV, RefEngine, nodePacksData,
} from '../src/index.ts';
import { component, compiled, G, L, m1Engine, maskOf, pixels, push, withEdits } from './doc-helpers.ts';

const C = (items: [string, Record<string, unknown>][]): Json => Coll.of(items) as unknown as Json;
const close = (a: ArrayLike<number>, b: ArrayLike<number>, eps: number): boolean => Array.from(a).every((v, i) => Math.abs(v - b[i]!) <= eps);
const rng = (seed: number): (() => number) => { let a = seed >>> 0; return () => ((a = (Math.imul(a ^ (a >>> 15), 2246822519) + 0x9e3779b9) >>> 0) / 4294967296); };

describe('working encodings', () => {
  it('the stage white is RGB (1, 1, 1) and OkLab (1, 0, 0); a neutral has L = ∛Y', () => {
    // OkLab to the 10 digits of Ottosson's published M2, whose rows sum to 1, 0, 0 within 4e-8
    for (const [w, W] of [['D65', D65], ['D50', D50]] as const) {
      expect(close(mulMV(xyzToWorking(w), W), [1, 1, 1], 1e-12)).toBe(true);
      expect(close(applyEncode(encodeTransform('stage', 'oklab', w), W), [1, 0, 0], 5e-8)).toBe(true);
      const g = applyEncode(encodeTransform('stage', 'oklab', w), W.map((v) => v * 0.18));
      expect(close(g, [Math.cbrt(0.18), 0, 0], 5e-8)).toBe(true);
    }
  });

  it('every conversion inverts its reverse; xyz → oklab equals xyz → rgb → oklab', () => {
    const r = rng(3);
    const encs = ['stage', 'linear', 'oklab'] as const;
    for (let n = 0; n < 50; n++) {
      const v = [r() * 0.9, r() * 0.9, r() * 0.9];
      for (const a of encs) for (const b of encs) {
        const start = applyEncode(encodeTransform('stage', a, 'D50'), v); // a print colour, in encoding a
        const there = applyEncode(encodeTransform(a, b, 'D50'), start);
        expect(close(applyEncode(encodeTransform(b, a, 'D50'), there), start, 1e-12), `${a} → ${b} → ${a}`).toBe(true);
      }
      const direct = applyEncode(encodeTransform('stage', 'oklab', 'D65'), v);
      const two = applyEncode(encodeTransform('linear', 'oklab', 'D65'), applyEncode(encodeTransform('stage', 'linear', 'D65'), v));
      expect(close(direct, two, 1e-12)).toBe(true);
    }
  });
});

describe('curve and levels', () => {
  const S = [{ x: 0, y: 0 }, { x: 0.25, y: 0.18 }, { x: 0.75, y: 0.85 }, { x: 1, y: 1 }];

  it('passes through its points; the identity points give the identity', () => {
    const c = toneCurve(S);
    for (const p of S) expect(evalCurve(c, p.x)).toBeCloseTo(p.y, 14);
    const id = toneCurve([{ x: 0, y: 0 }, { x: 0.4, y: 0.4 }, { x: 1, y: 1 }]);
    for (let v = -0.2; v <= 1.2; v += 0.05) expect(evalCurve(id, v)).toBeCloseTo(v, 14);
  });

  it('monotone points give a monotone curve that never overshoots (random point sets)', () => {
    const r = rng(11);
    for (let n = 0; n < 200; n++) {
      const k = 2 + Math.floor(r() * 7);
      const xs = Array.from({ length: k }, () => r()).sort((a, b) => a - b);
      const ys = Array.from({ length: k }, () => r()).sort((a, b) => a - b);
      if (new Set(xs).size < k) continue;
      const pts = xs.map((x, i) => ({ x, y: ys[i]! }));
      const c = toneCurve(pts);
      let prev = -Infinity;
      for (let v = xs[0]!; v <= xs[k - 1]!; v += 1 / 512) {
        const y = evalCurve(c, v);
        expect(y).toBeGreaterThanOrEqual(prev - 1e-12);
        expect(y).toBeGreaterThanOrEqual(ys[0]! - 1e-12);
        expect(y).toBeLessThanOrEqual(ys[k - 1]! + 1e-12);
        prev = y;
      }
    }
  });

  it('a flattening curve lowers contrast and a steepening one raises it (Editor lab\'s defect, design §13)', () => {
    const flat = toneCurve([{ x: 0, y: 0.05 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0.95 }]);
    const steep = toneCurve([{ x: 0, y: 0 }, { x: 0.25, y: 0.18 }, { x: 0.5, y: 0.5 }, { x: 0.75, y: 0.82 }, { x: 1, y: 1 }]);
    const slope = (c: ReturnType<typeof toneCurve>): number => (evalCurve(c, 0.75) - evalCurve(c, 0.25)) / 0.5;
    expect(slope(flat)).toBeLessThan(1);
    expect(slope(steep)).toBeGreaterThan(1);
  });

  it('levels maps black → outBlack and white → outWhite, brightens with gamma > 1, and continues beyond', () => {
    const l = { black: 0.1, white: 0.9, gamma: 2, outBlack: 0.05, outWhite: 0.95 };
    expect(evalLevels(l, 0.1)).toBeCloseTo(0.05, 14);
    expect(evalLevels(l, 0.9)).toBeCloseTo(0.95, 14);
    expect(evalLevels(l, 0.5)).toBeGreaterThan(0.5);
    expect(evalLevels(l, 1)).toBeCloseTo(0.95 + 0.9 * 0.125, 12);
    const id = { black: 0, white: 1, gamma: 1, outBlack: 0, outWhite: 1 };
    for (const v of [-0.3, 0, 0.42, 1, 1.4]) expect(evalLevels(id, v)).toBe(v);
  });
});

describe('colour tools', () => {
  it('hsl: neutrals and the identity bands are unchanged; a red hue shift leaves blue alone', () => {
    const grey = [0.6, 0, 0];
    hslAt(grey, hslBands([{ centre_deg: 25, width_deg: 45, hue_deg: 30, saturation: 0.5, lightness: 0.5 }]));
    expect(grey).toEqual([0.6, 0, 0]);
    const red = rgbToOklab([0.8, 0.1, 0.1]), blue = rgbToOklab([0.1, 0.2, 0.8]);
    const hr = (Math.atan2(red[2], red[1]) * 180) / Math.PI;
    const bands = hslBands([{ centre_deg: (hr + 360) % 360, width_deg: 45, hue_deg: 20, saturation: 0, lightness: 0 }]);
    const r2 = [...red], b2 = [...blue];
    hslAt(r2, bands);
    hslAt(b2, bands);
    expect((Math.atan2(r2[2]!, r2[1]!) * 180) / Math.PI - hr).toBeCloseTo(20, 6);
    expect(Math.hypot(r2[1]!, r2[2]!)).toBeCloseTo(Math.hypot(red[1], red[2]), 12);
    expect(close(b2, blue, 1e-15)).toBe(true);
  });

  it('vibrance: monotone in chroma for |v| ≤ 1, more for muted colours, neutral unchanged', () => {
    for (const v of [-1, -0.5, 0.5, 1]) {
      let prev = 0;
      for (let C = 0; C <= 0.4; C += 0.002) {
        const out = C * vibranceGain(C, v, 0);
        expect(out).toBeGreaterThanOrEqual(prev - 1e-15);
        prev = out;
      }
    }
    expect(vibranceGain(0.02, 0.5, 0)).toBeGreaterThan(vibranceGain(0.2, 0.5, 0));
    const g = [0.5, 0, 0];
    vibranceAt(g, 1, 0.5);
    expect(g).toEqual([0.5, 0, 0]);
  });

  it('grade: black stays black; the shadow tint shows in the shadows, the highlight tint in the highlights', () => {
    const p = { shadowsHue_deg: 230, shadowsChroma: 0.1, shadowsLightness: 0, midtonesHue_deg: 0, midtonesChroma: 0, midtonesLightness: 0, highlightsHue_deg: 60, highlightsChroma: 0.1, highlightsLightness: 0, balance: 0 };
    const g = gradeWheels(p);
    const black = [0, 0, 0];
    gradeAt(black, g);
    expect(black).toEqual([0, 0, 0]);
    const dark = [0.15, 0, 0], light = [0.9, 0, 0];
    gradeAt(dark, g);
    gradeAt(light, g);
    // a dark grey is tinted mostly by the shadow wheel ((1 − t)² = 0.72 against t² = 0.02), a light one by the highlights
    const hue = (q: number[]): number => ((Math.atan2(q[2]!, q[1]!) * 180) / Math.PI + 360) % 360;
    expect(Math.abs(hue(dark) - 230)).toBeLessThan(1);
    expect(Math.abs(hue(light) - 60)).toBeLessThan(1);
    const only = [0.15, 0, 0];
    gradeAt(only, gradeWheels({ ...p, highlightsChroma: 0 }));
    expect(hue(only)).toBeCloseTo(230, 9);
    expect(Math.hypot(only[1]!, only[2]!)).toBeCloseTo(0.15 * 0.1 * 0.85 ** 2, 12);
  });

  it('mixer: monochrome gives a neutral; the default grey of a neutral is itself', () => {
    const M = mixerMatrix({ monochrome: true, grey: [0.2627, 0.678, 0.0593], red: [1, 0, 0], green: [0, 1, 0], blue: [0, 0, 1] });
    const out = mulMV(M as never, [0.7, 0.2, 0.1]);
    expect(out[0]).toBe(out[1]);
    expect(out[1]).toBe(out[2]);
    expect(mulMV(M as never, [0.4, 0.4, 0.4])[0]).toBeCloseTo(0.4, 12);
  });

  it('vignette: 1 at the centre, 2^stops at the corners', () => {
    expect(vignetteGain(50, 40, 100, 80, -1, 0.5, 0.5)).toBe(1);
    expect(vignetteGain(0, 0, 100, 80, -1, 0.5, 0.5)).toBeCloseTo(0.5, 12);
    expect(vignetteGain(0, 0, 100, 80, -1, 0.5, 0)).toBe(0.5);
  });

  it('mask components: radial is 1 inside and 0 outside; colour is 1 at the sample, 0 far from it', () => {
    const box = { x: 10, y: 10, w: 40, h: 20 };
    expect(radialAt(30, 20, box, 0, 0.5)).toBe(1);
    expect(radialAt(5, 20, box, 0, 0.5)).toBe(0);
    const mid = radialAt(30 + 20 * 0.75, 20, box, 0, 0.5);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(colourAt([0.6, 0.1, 0], [0.6, 0.1, 0], 0.05, 0.05)).toBe(1);
    expect(colourAt([0.3, -0.1, 0], [0.6, 0.1, 0], 0.05, 0.05)).toBe(0);
  });
});

describe('blend modes: the laws', () => {
  const r = rng(5);
  const px = (): number[] => [r() * 0.95 + 0.02, r() * 0.95 + 0.02, r() * 0.95 + 0.02];

  it('normal at full coverage is the source; multiply by white and screen by black are the backdrop', () => {
    for (let n = 0; n < 100; n++) {
      const b = px(), s = px();
      expect(blendPixel('normal', b, s, 'linear')).toEqual(s);
      expect(blendPixel('multiply', b, [1, 1, 1], 'linear')).toEqual(b);
      expect(blendPixel('screen', b, [0, 0, 0], 'linear')).toEqual(b);
      // in OkLab (the entry's encoding of a curve, say): the same, through the conversion
      const bo = rgbToOklab(b);
      expect(close(blendPixel('multiply', bo, rgbToOklab([1, 1, 1]), 'oklab'), bo, 1e-12)).toBe(true);
      expect(close(blendPixel('screen', bo, [0, 0, 0], 'oklab'), bo, 1e-12)).toBe(true);
      expect(blendPixel('difference', b, b, 'linear')).toEqual([0, 0, 0]);
      expect(close(blendPixel('exclusion', b, [0, 0, 0], 'linear'), b, 0)).toBe(true);
      // the mix: amount 0 is the backdrop, 1 the blend, exactly
      for (const m of BLEND_MODES) {
        const B = blendPixel(m as BlendMode, b, s, 'linear');
        expect(b.map((v, k) => mixPixel(v, B[k]!, 0))).toEqual(b);
        expect(b.map((v, k) => mixPixel(v, B[k]!, 1))).toEqual(B);
      }
    }
  });

  it('luminosity takes the lightness of the source and the colour of the backdrop; colour the opposite', () => {
    for (let n = 0; n < 50; n++) {
      const b = rgbToOklab(px()), s = rgbToOklab(px());
      expect(blendPixel('luminosity', b, s, 'oklab')).toEqual([s[0], b[1], b[2]]);
      expect(blendPixel('colour', b, s, 'oklab')).toEqual([b[0], s[1], s[2]]);
      const h = blendPixel('hue', b, s, 'oklab');
      expect(Math.hypot(h[1], h[2])).toBeCloseTo(Math.hypot(b[1], b[2]), 12);
      const sat = blendPixel('saturation', b, s, 'oklab');
      expect(Math.hypot(sat[1], sat[2])).toBeCloseTo(Math.hypot(s[1], s[2]), 12);
      // in linear RGB the same, through OkLab
      const lin = blendPixel('luminosity', oklabToRgb(b), oklabToRgb(s), 'linear');
      expect(close(rgbToOklab(lin), [s[0], b[1], b[2]], 1e-12)).toBe(true);
    }
  });

  it('the separable formulas are the W3C ones on [0, 1]', () => {
    expect(blendChannel('overlay', 0.25, 0.6)).toBeCloseTo(2 * 0.25 * 0.6, 15);
    expect(blendChannel('hard-light', 0.25, 0.6)).toBeCloseTo(1 - 2 * 0.75 * 0.4, 15);
    expect(blendChannel('soft-light', 0.64, 0.75)).toBeCloseTo(0.64 + 0.5 * (0.8 - 0.64), 15);
    expect(blendChannel('colour-dodge', 0.3, 0.5)).toBeCloseTo(0.6, 15);
    expect(blendChannel('colour-burn', 0.7, 0.5)).toBeCloseTo(0.4, 15);
    expect(blendChannel('colour-dodge', 0, 1)).toBe(0);
    expect(blendChannel('colour-burn', 1, 0)).toBe(1);
  });
});

describe('documents through compile (RefEngine on the M1 negative)', () => {
  const pts = (k: string): Json => C([[`${k}0`, { x: 0, y: 0 }], [`${k}1`, { x: 0.3, y: 0.2 }], [`${k}2`, { x: 0.7, y: 0.82 }], [`${k}3`, { x: 1, y: 1 }]]);

  it('every op renders finite pixels; amount 0 is the stack without it; a pass group at amount 1 is its children', async () => {
    const { e, doc } = await m1Engine();
    const stack: [string, ReturnType<typeof L>][] = [
      ['x', L('exposure', { stops: 0.3, offset: -0.005 })], ['c', L('curve', { points: pts('c') })], ['r', L('curve', { channel: 'R', points: pts('r') })],
      ['l', L('levels', { black: 0.05, gamma: 1.2 })], ['h', L('hsl', { bands: C([['b1', { centre_deg: 260, hue_deg: -10, saturation: 0.3 }]]) })],
      ['v', L('vibrance', { vibrance: 0.4 })], ['g', L('grade', { shadowsChroma: 0.05, highlightsChroma: 0.03 })], ['m', L('mixer', { red: [0.9, 0.1, 0] })],
      ['n', L('vignette', { stops: -0.7 })], ['s', L('sharpen', { strength: 0.8, radius_mm: 0.2 })],
    ];
    const d = withEdits(doc, ...stack.map(([id, l]) => push('print', id, l)));
    const out = await pixels(e, compiled(e, d).cuts.finished!);
    expect(out.every(Number.isFinite)).toBe(true);
    const base = await pixels(e, compiled(e, doc).cuts.finished!);
    expect(out.some((v, i) => Math.abs(v - base[i]!) > 1e-3)).toBe(true);
    // amount 0 and disabled: no node at all (contract), so the pixels of the stack without them
    const off = withEdits(d, ...['c', 'n'].map((id) => ({ op: 'set' as const, path: `${id}.amount`, value: 0 })));
    const without = withEdits(doc, ...stack.filter(([id]) => id !== 'c' && id !== 'n').map(([id, l]) => push('print', id, l)));
    expect(compiled(e, off).cuts.finished!.id).toBe(compiled(e, without).cuts.finished!.id);
    // a pass group at amount 1 is its children
    const grouped = withEdits(doc, push('print', 'grp', G('look', stack.slice(0, 4))), ...stack.slice(4).map(([id, l]) => push('print', id, l)));
    expect(compiled(e, grouped).cuts.finished!.id).toBe(compiled(e, d).cuts.finished!.id);
  });

  it('a masked, faded layer is mixPixel of the backdrop and the layer in its encoding; blends and isolated groups render', async () => {
    const { e, doc } = await m1Engine();
    const m = maskOf([['rad', component('radial', { box: { x: 20, y: 10, w: 60, h: 50 }, feather: 0.6 })], ['col', component('colour', { colour: [0.6, 0, 0], tolerance: 0.3, softness: 0.2 }, 'intersect')]]);
    const d = withEdits(doc, insert('masks', 'm', m), push('print', 'c', L('curve', { points: pts('k') }, { mask: 'm', amount: 0.6 })));
    const c = compiled(e, d);
    const mix = e.graph.get(c.cuts.finished!.inputs[0]!)!;
    expect(mix.op).toBe('composite.mix');
    const back = await pixels(e, e.graph.get(mix.inputs[0]!)!), top = await pixels(e, e.graph.get(mix.args['top'] as string)!);
    const mk = await pixels(e, e.graph.get(mix.args['mask'] as string)!);
    const got = await pixels(e, mix);
    for (let i = 0; i < mk.length; i += 37) for (let k = 0; k < 3; k++) expect(got[i * 3 + k]).toBe(mixPixel(back[i * 3 + k]!, top[i * 3 + k]!, 0.6 * mk[i]!));
    expect(mk.some((v) => v > 0.5) && mk.some((v) => v < 0.01)).toBe(true);
    for (const blend of ['multiply', 'luminosity', 'soft-light'] as const) {
      const iso = withEdits(doc, push('print', 'grp', G('look', [['a', L('vibrance', { vibrance: 0.8 })], ['b', L('exposure', { stops: 0.5 })]], { blend, amount: 0.8 })));
      expect((await pixels(e, compiled(e, iso).cuts.finished!)).every(Number.isFinite), blend).toBe(true);
    }
  });

  it('the scene stage of a camera file: layers before the film, masks reading scene.input', async () => {
    const e = new RefEngine({ data: nodePacksData() });
    const { makeM1Tiff } = await import('@chromobench/engine-mock');
    const info = await e.open({ kind: 'file', sha256: '', bytes: makeM1Tiff() });
    let d: Document = newDocument('digital-raw', { sha256: info.sha256 }, { frame: 'cam' });
    d = edit(d, [
      insert('masks', 'hi', maskOf([['l', component('luminance', { above: 0.4, softness: 0.2 })]])),
      insert('stages.scene.stack', 'x', L('exposure', { stops: -0.7 }, { mask: 'hi' })),
      insert('stages.scene.stack', 'c', L('curve', { points: pts('s') })),
    ]).doc;
    const c = compile(d, e.graph);
    const scene = await pixels(e, c.cuts.scene!), input = await pixels(e, c.cuts['scene.input']!);
    expect(scene.some((v, i) => Math.abs(v - input[i]!) > 1e-3)).toBe(true);
    expect((await pixels(e, c.display)).every(Number.isFinite)).toBe(true);
  });
});
