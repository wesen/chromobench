// CHB-010 stages 3–4: multi-exposure printing (print.combine), mask rasterisation (mask.*) and density
// masks (print.densityMask) in the f64 reference, with the guide's golden numbers
// (fixtures/golden/chb010-exposures.json) and the recipe path through contract compile().
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyMutation, compile, defaultRecipe, Graph, sha256Hex, type FrameRecipe, type Node } from '@chromobench/contract';
import { M1, makeM1Tiff } from '@chromobench/engine-mock';
import {
  applyDensityMask, brushCoverage, combinePixel, combineRatio, compileExposures, ellipseAt, exposureSeconds, fullGrid, gaussianBlur1, gradientAt,
  gridCentres, interimData, luminanceAt, makePrintChain, maskDensity, midgrayDensity, paintMask, parseStrokes, RefEngine, SPEKTRAFILM,
  type PrintChainOptions,
} from '../src/index.ts';

const fx = JSON.parse(readFileSync(new URL('../../../fixtures/golden/chb010-exposures.json', import.meta.url), 'utf8')) as { entries: { id: string; [k: string]: any }[] };
const entry = (id: string) => fx.entries.find((e) => e.id === id)!;
const data = interimData();
const BASE: PrintChainOptions = { data, film: 'kodak_portra_400', paper: 'kodak_portra_endura', conv: SPEKTRAFILM, view: 'D50', aim: 'midgray-normalised', mode: 'real' };
const LOG2 = Math.log10(2);

describe('CHB-010 stage 3–4 goldens', () => {
  it('a one-stop burn at mask 0.5 adds log10 1.5 = 0.17609, not 0.15051 (guide §6.5 finding 1)', () => {
    const e = entry('chb010.burn.feather');
    const x = [-0.3, 0.1, 0.42];
    const out = [0, 0, 0];
    combinePixel(x, [{ x, m: e.mask, sign: 1, ratio: 2 ** e.stops - 1 }], out);
    for (let k = 0; k < 3; k++) expect(out[k]! - x[k]!).toBeCloseTo(e.expect.dx, 5);
    expect(e.mask * e.stops * LOG2).toBeCloseTo(e.expect.dxLogDomain, 5);
  });

  it('the feathered burn at the grey card: visual density 1.247 linear against 1.170 log-domain', () => {
    const e = entry('chb010.burn.featherDvis');
    const ch = makePrintChain(BASE);
    const x = ch.xOfDyes(ch.grey);
    const lin = [0, 0, 0];
    combinePixel(x, [{ x, m: 0.5, sign: 1, ratio: 1 }], lin);
    const D = (xx: ArrayLike<number>) => -Math.log10(ch.xyzOfX(xx)[1]);
    expect(Math.abs(D(lin) - e.expect.linear)).toBeLessThan(e.tol);
    expect(Math.abs(D(x.map((v) => v + 0.5 * LOG2)) - e.expect.logDomain)).toBeLessThan(e.tol);
  });

  it('split filtration on colour paper is almost one filtration: lights (−0.32, −4.26, −0.01) pt, deviation ≤ 0.48 pt (finding 2)', () => {
    const e = entry('chb010.split.lights');
    const one = makePrintChain({ ...BASE, optics: { time_s: 10 } });
    const a = makePrintChain({ ...BASE, optics: { time_s: 5 } });
    const b = makePrintChain({ ...BASE, optics: { time_s: 5 }, filtrationShift: e.half });
    const sum = (D: ArrayLike<number>): number[] => {
      const out = [0, 0, 0];
      combinePixel(a.enlarger.exposureOfDensity(D), [{ x: b.enlarger.exposureOfDensity(D), m: 1, sign: 1, ratio: 1 }], out);
      return out;
    };
    const Dg = one.film.spectral(one.grey);
    const xo = one.enlarger.exposureOfDensity(Dg);
    const l = sum(Dg).map((v, k) => v - xo[k]!);
    l.forEach((v, k) => expect(Math.abs(v / 0.025 - e.expect.lights_pt[k])).toBeLessThan(e.tol));
    let worst = 0;
    for (let le = -1.5; le <= 2.0001; le += 0.05) {
      const D = midgrayDensity(one.film, le);
      const xs = sum(D), x1 = one.enlarger.exposureOfDensity(D);
      for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(xs[k]! - x1[k]! - l[k]!) / 0.025);
    }
    expect(worst).toBeGreaterThan(0.1); // not exactly one filtration: real dichroics are not pure shifts
    expect(worst).toBeLessThanOrEqual(e.expect.maxDeviation_pt);
  });

  it('a contrast mask of strength γ leaves (1 − γ) of the large-area density difference (guide §6.6)', () => {
    const e = entry('chb010.densityMask.contrast');
    const w = 60, h = 6;
    const pd = new Float64Array(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) pd[(y * w + x) * 3 + k] = (x < w / 2 ? 0.5 : 1.5) + 0.1 * k;
    // equal steps in every layer: T_m = mean 10^−PD is proportional to 10^−step, so far from the edge d_m = γ·(PD_max − PD)
    const out = applyDensityMask(pd, w, h, 3, e.amount, 2);
    const at = (x: number, k: number) => out[(3 * w + x) * 3 + k]!;
    for (let k = 0; k < 3; k++) expect((at(w - 2, k) - at(1, k)) / 1.0).toBeCloseTo(e.expect.largeAreaContrast, 9);
    // the densest area gets no mask: the print's highlights keep their density
    expect(at(w - 2, 0)).toBeCloseTo(1.5, 12);
  });
});

describe('mask rasterisation (mask.* at the evaluation grid)', () => {
  it('grid centres follow the engines’ nearest-sample rule', () => {
    const g = gridCentres({ w: 4, h: 2, region: { x: 10, y: 4, w: 8, h: 4 } });
    expect([...g.xs]).toEqual([11.5, 13.5, 15.5, 17.5]);
    expect([...g.ys]).toEqual([5.5, 7.5]);
    expect([...gridCentres(fullGrid(3, 1)).xs]).toEqual([0.5, 1.5, 2.5]);
  });

  it('gradient: 1 at from, 0 at to, 0.5 half way, clamped beyond', () => {
    const f = { x: 0, y: 0 }, t = { x: 10, y: 0 };
    expect(gradientAt(0, 3, f, t)).toBe(1);
    expect(gradientAt(5, -2, f, t)).toBe(0.5);
    expect(gradientAt(10, 0, f, t)).toBe(0);
    expect(gradientAt(-4, 0, f, t)).toBe(1);
    expect(gradientAt(14, 0, f, t)).toBe(0);
  });

  it('ellipse: 1 inside, 0 outside, a one-pixel antialiased edge; the angle rotates it about the box centre', () => {
    const box = { x: 0, y: 0, w: 40, h: 10 };
    expect(ellipseAt(20, 5, box, 0)).toBe(1);
    expect(ellipseAt(38, 5, box, 0)).toBe(1);
    expect(ellipseAt(20, 12, box, 0)).toBe(0);
    expect(ellipseAt(40, 5, box, 0)).toBeCloseTo(0.5, 9); // on the edge
    expect(ellipseAt(40.5, 5, box, 0)).toBeCloseTo(0, 9);
    // tilted 90°: the long axis is vertical
    expect(ellipseAt(20, 5 + 18, box, 90)).toBe(1);
    expect(ellipseAt(38, 5, box, 90)).toBe(0);
  });

  it('luminance: a soft band; above ≤ 0 and below ≥ 1 leave that side open (compile’s whole-frame mask)', () => {
    expect(luminanceAt(0.5, 0.2, 0.8, 0.1)).toBe(1);
    expect(luminanceAt(0.2, 0.2, 0.8, 0.1)).toBeCloseTo(0.5, 12);
    expect(luminanceAt(0.05, 0.2, 0.8, 0.1)).toBe(0);
    expect(luminanceAt(-0.7, 0, 1, 0)).toBe(1);
    expect(luminanceAt(1.9, 0, 1, 0)).toBe(1);
  });

  it('paint: strokes cover their path, the hardness sets the soft edge, erase subtracts, order matters', () => {
    const strokes = parseStrokes(JSON.stringify([
      { kind: 'stroke', points: [[5, 10, 0.5], [35, 10, 0.5]], radius: 4, hardness: 0.5, mode: 'add' },
      { kind: 'stroke', points: [[20, 0, 0.5], [20, 20, 0.5]], radius: 2, hardness: 1, mode: 'erase' },
    ]));
    const g = fullGrid(40, 20);
    const m = paintMask(strokes, g);
    const at = (x: number, y: number) => m[y * 40 + x]!;
    expect(at(10, 9)).toBe(1); // on the path (centre 10.5, 9.5: 0.5 px off, inside hardness·radius = 2)
    expect(at(10, 15)).toBe(0); // 5.5 px away, outside the radius
    expect(at(10, 12)).toBeCloseTo(brushCoverage(2.5, 4, 0.5), 12);
    expect(at(19, 9)).toBe(0); // erased
    expect(at(30, 9)).toBe(1);
    expect(paintMask(parseStrokes('[]'), g).every((v) => v === 0)).toBe(true);
    // a single dab
    const dot = paintMask(parseStrokes('[{"kind":"stroke","points":[[3.5,3.5,1]],"radius":2,"hardness":1,"mode":"add"}]'), fullGrid(8, 8));
    expect(dot[3 * 8 + 3]).toBe(1);
    expect(dot[0]).toBe(0);
  });

  it('paint refuses malformed strokes with a typed error', () => {
    expect(() => parseStrokes('nope')).toThrow(/E_ARG_TYPE/);
    expect(() => parseStrokes('[{"points":[[1]],"radius":2}]')).toThrow(/points/);
    expect(() => parseStrokes('[{"points":[[1,2,1]],"radius":-2}]')).toThrow(/radius/);
  });

  it('feather: a normalised Gaussian keeps a flat mask flat and the mean of a step', () => {
    const w = 30, h = 5;
    const flat = new Float64Array(w * h).fill(0.7);
    expect(gaussianBlur1(flat, w, h, 3).every((v) => Math.abs(v - 0.7) < 1e-15)).toBe(true);
    const step = new Float64Array(w * h).map((_, i) => (i % w < w / 2 ? 1 : 0));
    const b = gaussianBlur1(step, w, h, 3);
    expect(b[2 * w + 14]! + b[2 * w + 15]!).toBeCloseTo(1, 12); // antisymmetric about the edge
    expect(b[2 * w + 14]!).toBeLessThan(1);
  });
});

describe('exposure semantics (compileExposures)', () => {
  const r = defaultRecipe('negative-scan', { sha256: 'a'.repeat(64) });
  const withEx = (ex: object[], filtration = r.print.enlarger.filtration): FrameRecipe['print'] => ({ ...r.print, enlarger: { ...r.print.enlarger, filtration }, exposures: ex.map((e) => ({ enabled: true, mask: null, time_s: null, stops: null, filtration: null, through: null, ...e })) as FrameRecipe['print']['exposures'] });

  it('stops are f-stop printer’s stops relative to the main time', () => {
    expect(exposureSeconds({ kind: 'burn', time_s: null, stops: 0.5 }, 10)).toBeCloseTo(4.142, 3);
    expect(exposureSeconds({ kind: 'dodge', time_s: null, stops: 1 }, 10)).toBe(5);
    expect(exposureSeconds({ kind: 'burn', time_s: 3, stops: 1 }, 10)).toBe(3);
    const c = compileExposures(withEx([{ id: 'sky', kind: 'burn', stops: 0.5 }, { id: 'face', kind: 'dodge', time_s: 2 }]));
    expect(c.exposures.map((e) => [e.id, e.sign])).toEqual([['sky', 1], ['face', -1]]);
  });

  it('a dodge cannot carry a filtration; more than four packs is E_TOO_MANY_PACKS', () => {
    expect(() => compileExposures(withEx([{ id: 'd', kind: 'dodge', time_s: 1, filtration: { c: 0, m: 10, y: 0 } }]))).toThrow(/E_RECIPE/);
    const packs = [1, 2, 3, 4].map((i) => ({ id: `b${i}`, kind: 'burn', time_s: 1, filtration: { c: 0, m: 10 * i, y: 0 } }));
    expect(() => compileExposures(withEx(packs))).toThrow(/E_TOO_MANY_PACKS/);
    expect(compileExposures(withEx(packs.slice(0, 3))).exposures).toHaveLength(3);
  });

  it('unmasked dodges longer than the main exposure and base flashes are reported', () => {
    const d = compileExposures(withEx([{ id: 'd', kind: 'dodge', time_s: 12 }, { id: 'f', kind: 'flash', time_s: 1, through: 'base' }])).diagnostics.map((x) => x.code);
    expect(d).toEqual(['W_PREVIEW_APPROX', 'W_DODGE_EXCEEDS_MAIN']);
  });

  it('combineRatio: real mode carries time in x; normalised mode weights by seconds', () => {
    expect(combineRatio({ mode: 'real', time_s: 10 }, { mode: 'real', time_s: 4 })).toBe(1);
    expect(combineRatio({ mode: 'normalised', time_s: 10 }, { mode: 'normalised', time_s: 4 })).toBe(0.4);
    expect(combineRatio(undefined, { mode: 'normalised', time_s: 4 })).toBe(1);
  });
});

// ---- the reference engine on the M1 negative ----------------------------------------------------

async function setup() {
  const e = new RefEngine();
  const g = new Graph();
  const bytes = makeM1Tiff();
  const info = await e.open({ kind: 'file', sha256: sha256Hex(bytes), bytes });
  g.registerSource(info);
  const I = (op: string, inputs: string[], args: Record<string, unknown> = {}): Node => {
    const { node } = g.intern(op, inputs, args);
    e.adopt(g.closure(node.id));
    return node;
  };
  const read = async (n: Node) => (await e.evaluate(n, { scale: 'full', precision: 'export' })).read();
  const src = I('source.open', [], { source: info.sha256, encoding: 'linear' });
  const dyes = I('invert.dyes', [I('scan.density', [src.id], { rebate: M1.rebate }).id], { stock: 'kodak_portra_400', scanner: 'xt5-rgb-led' });
  return { e, g, I, read, src, dyes, sha: info.sha256 };
}

describe('print.combine and mask.* in the reference engine', () => {
  it('normalised and real mode: a one-stop burn through a gradient adds log10(1 + m) per pixel', async () => {
    const { I, read, src, dyes } = await setup();
    const mask = I('mask.gradient', [src.id], { from: { x: 8, y: 0 }, to: { x: 88, y: 0 } });
    const m = await read(mask);
    for (const mode of ['normalised', 'real'] as const) {
      const main = I('print.expose', [dyes.id], { mode, time_s: 10 });
      const burn = I('print.expose', [dyes.id], { mode, time_s: 10 });
      const comb = I('print.combine', [main.id], { exposures: [burn.id], masks: [mask.id], modes: ['add'] });
      const [x0, x1] = [await read(main), await read(comb)];
      let worst = 0;
      for (let i = 0; i < M1.width * M1.height; i++) for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(x1[3 * i + k]! - x0[3 * i + k]! - Math.log10(1 + m[i]!)));
      expect(worst, mode).toBeLessThan(1e-12);
    }
  });

  it('normalised mode weights a 2.5 s burn on a 10 s main by its seconds', async () => {
    const { I, read, src, dyes } = await setup();
    const all = I('mask.luminance', [src.id], { above: 0, below: 1, softness: 0 });
    const main = I('print.expose', [dyes.id], { time_s: 10 });
    const comb = I('print.combine', [main.id], { exposures: [I('print.expose', [dyes.id], { time_s: 2.5 }).id], masks: [all.id], modes: ['add'] });
    const [x0, x1] = [await read(main), await read(comb)];
    expect(x1[100]! - x0[100]!).toBeCloseTo(Math.log10(1.25), 12);
  });

  it('dodge and burn of the same time and mask cancel; a dodge beyond the main exposure clamps and warns', async () => {
    const { e, I, read, src, dyes } = await setup();
    const mask = I('mask.ellipse', [src.id], { box: { x: 30, y: 10, w: 40, h: 40 }, angle_deg: 20 });
    const main = I('print.expose', [dyes.id], { mode: 'real', time_s: 10 });
    const t4 = I('print.expose', [dyes.id], { mode: 'real', time_s: 4 });
    const both = I('print.combine', [main.id], { exposures: [t4.id, t4.id], masks: [mask.id, mask.id], modes: ['subtract', 'add'] });
    const [x0, xb] = [await read(main), await read(both)];
    let worst = 0;
    for (let i = 0; i < x0.length; i++) worst = Math.max(worst, Math.abs(xb[i]! - x0[i]!));
    expect(worst).toBeLessThan(1e-12);
    const over = I('print.combine', [main.id], { exposures: [I('print.expose', [dyes.id], { mode: 'real', time_s: 15 }).id], masks: [mask.id], modes: ['subtract'] });
    const r = await e.evaluate(over, { scale: 'full', precision: 'export' });
    expect(r.warnings.map((w) => w.code)).toContain('W_DODGE_EXCEEDS_MAIN');
    const xo = await r.read();
    const centre = (30 * M1.width + 50) * 3;
    expect(xo[centre]).toBeCloseTo(-8, 12); // no light where the dodge holds back everything
    expect(xo[0]).toBeCloseTo(x0[0]!, 13); // outside the mask the print is untouched
  });

  it('mask algebra: and/or/not/feather', async () => {
    const { I, read, src } = await setup();
    const a = I('mask.gradient', [src.id], { from: { x: 0, y: 0 }, to: { x: 96, y: 0 } });
    const b = I('mask.gradient', [src.id], { from: { x: 0, y: 64 }, to: { x: 0, y: 0 } });
    const [ma, mb] = [await read(a), await read(b)];
    const [mand, mor, mnot] = [await read(I('mask.and', [a.id], { other: b.id })), await read(I('mask.or', [a.id], { other: b.id })), await read(I('mask.not', [a.id], {}))];
    for (const i of [0, 100, 3000, 6143]) {
      expect(mand[i]).toBe(Math.min(ma[i]!, mb[i]!));
      expect(mor[i]).toBe(Math.max(ma[i]!, mb[i]!));
      expect(mnot[i]).toBe(1 - ma[i]!);
    }
    const fe = await read(I('mask.feather', [a.id], { radius_px: 6 }));
    expect(fe[32 * 96 + 48]).toBeCloseTo(ma[32 * 96 + 48]!, 12); // a linear ramp is unchanged by a symmetric blur away from the edges
    const paint = I('mask.paint', [src.id], { strokes: JSON.stringify([{ kind: 'stroke', points: [[10, 10, 0.5], [80, 50, 0.5]], radius: 5, hardness: 0.8, mode: 'add' }]) });
    const mp = await read(paint);
    expect(mp[10 * 96 + 10]).toBe(1);
    expect(mp[60 * 96 + 5]).toBe(0);
  });

  it('a recipe with masked exposures compiles to print.combine and prints through it', async () => {
    const { e, g, read, sha } = await setup();
    let r = defaultRecipe('negative-scan', { sha256: sha });
    r = { ...r, scan: { ...r.scan!, rebate: M1.rebate } };
    const srcNode = g.intern('source.open', [], { source: sha, encoding: 'linear' }).node;
    const sky = g.intern('mask.gradient', [srcNode.id], { from: { x: 0, y: 0 }, to: { x: 0, y: 40 } }).node;
    r = applyMutation(r, { op: 'mask.set', id: 'sky', mask: { version: 1, nodes: g.closure(sky.id) } }).recipe;
    r = applyMutation(r, { op: 'exposure.add', exposure: { id: 'burn', kind: 'burn', mask: 'sky', stops: 1 } }).recipe;
    const display = compile(r, g);
    e.adopt(g.closure(display.id));
    const nodes = g.closure(display.id);
    const combDef = nodes.find((n) => n.op === 'print.combine')!;
    expect(combDef).toBeDefined();
    const comb = g.adopt([combDef])[0]!;
    const main = g.get(combDef.inputs[0]!)!;
    const [x0, x1, m] = [await read(main), await read(comb), await read(sky)];
    // the top row is burned a full stop, below the gradient's end nothing changes
    expect(x1[3 * 50]! - x0[3 * 50]!).toBeCloseTo(Math.log10(1 + m[50]!), 12);
    expect(m[50]).toBeGreaterThan(0.98);
    expect(x1[3 * (50 * 96 + 50)]).toBeCloseTo(x0[3 * (50 * 96 + 50)]!, 13);
    const shown = await e.evaluate(g.get(display.inputs[0]!)!, { scale: 0.5, precision: 'preview' }); // output.display (output.frame is CHB-011's)
    expect(shown.width).toBe(48);
  });

  it('print.densityMask: amount 0 is the identity; the mask is neutral, ≥ 0 and 0 at the densest area', async () => {
    const { I, read } = await setup();
    const pd = I('source.pattern', [], { domain: 'printing-density', width: 24, height: 16, seed: 3 });
    const [p0, p1] = [await read(pd), await read(I('print.densityMask', [pd.id], { amount: 0 }))];
    expect([...p1]).toEqual([...p0]);
    const p2 = await read(I('print.densityMask', [pd.id], { amount: 0.5, radius_um: 12 }));
    const d = maskDensity(p0, 24, 16, 3, 0.5, 2);
    let min = Infinity;
    for (let i = 0; i < 24 * 16; i++) {
      for (let k = 0; k < 3; k++) expect(p2[3 * i + k]! - p0[3 * i + k]!).toBeCloseTo(d[i]!, 12);
      min = Math.min(min, d[i]!);
    }
    expect(min).toBe(0);
  });
});
