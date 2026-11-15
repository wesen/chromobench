// CHB-010 stages 3–4 on contract 1.0: the darkroom's light law (print.combine with structured terms, the contract's
// lightH), mask rasterisation and the one mask algebra (mask.*), and density masks (print.densityMask) in the f64
// reference, with the guide's golden numbers (fixtures/golden/chb010-exposures.json) and the document path through
// contract compile().
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Graph, lightH, maskCombine, sha256Hex, type LightTermSample, type Node } from '@chromobench/contract';
import { M1, makeM1Tiff } from '@chromobench/engine-mock';
import {
  applyDensityMask, brushCoverage, clearExposure, combineRatio, DEFAULT_CONVENTIONS, ellipseAt, fullGrid, gaussianBlur1, gridCentres, linearAt, nodePacksData,
  luminanceAt, makePrintChain, maskDensity, midgrayDensity, paintMask, PhysicsEnv, RefEngine, SPEKTRAFILM, type PrintChainOptions, type Stroke,
} from '../src/index.ts';
import { compiled, L, m1Engine, maskOf, component, opsOf, pixels, push, withEdits, insert } from './doc-helpers.ts';

/** The light law for a main exposure with burns (+1) and dodges (−1) of mask m and seconds ratio r. */
function combinePixel(xMain: ArrayLike<number>, terms: { x: ArrayLike<number>; m: number; sign: 1 | -1; ratio: number }[], out: number[]): boolean {
  return lightH({ xMain, wMain: 1, densities: [], filters: [], preflash: [], terms: terms.map((t): LightTermSample => ({ role: t.sign < 0 ? 'dodge' : 'burn', x: t.x, w: t.m * t.ratio })) }, out);
}

const fx = JSON.parse(readFileSync(new URL('../../../fixtures/golden/chb010-exposures.json', import.meta.url), 'utf8')) as { entries: { id: string; [k: string]: any }[] };
const entry = (id: string) => fx.entries.find((e) => e.id === id)!;
const data = nodePacksData();
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

  it('linear: 1 at from, 0 at to, 0.5 half way, clamped beyond', () => {
    const f = { x: 0, y: 0 }, t = { x: 10, y: 0 };
    expect(linearAt(0, 3, f, t)).toBe(1);
    expect(linearAt(5, -2, f, t)).toBe(0.5);
    expect(linearAt(10, 0, f, t)).toBe(0);
    expect(linearAt(-4, 0, f, t)).toBe(1);
    expect(linearAt(14, 0, f, t)).toBe(0);
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
    const strokes: Stroke[] = [
      { points: [[5, 10, 0.5], [35, 10, 0.5]], radius: 4, hardness: 0.5, mode: 'add' },
      { points: [[20, 0, 0.5], [20, 20, 0.5]], radius: 2, hardness: 1, mode: 'erase' },
    ];
    const g = fullGrid(40, 20);
    const m = paintMask(strokes, g);
    const at = (x: number, y: number) => m[y * 40 + x]!;
    expect(at(10, 9)).toBe(1); // on the path (centre 10.5, 9.5: 0.5 px off, inside hardness·radius = 2)
    expect(at(10, 15)).toBe(0); // 5.5 px away, outside the radius
    expect(at(10, 12)).toBeCloseTo(brushCoverage(2.5, 4, 0.5), 12);
    expect(at(19, 9)).toBe(0); // erased
    expect(at(30, 9)).toBe(1);
    expect(paintMask([], g).every((v) => v === 0)).toBe(true);
    // a single dab
    const dot = paintMask([{ points: [[3.5, 3.5, 1]], radius: 2, hardness: 1, mode: 'add' }], fullGrid(8, 8));
    expect(dot[3 * 8 + 3]).toBe(1);
    expect(dot[0]).toBe(0);
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

describe('exposure semantics (the light law in compile)', () => {
  it('stops are printer’s stops relative to the main time: each term is a print.expose of its own seconds', async () => {
    const { e, doc } = await m1Engine();
    const d = withEdits(doc, push('darkroom', 'sky', L('burn', { stops: 0.5 })), push('darkroom', 'face', L('dodge', { stops: 1 })), push('darkroom', 'b3', L('burn', { time_s: 3, filtration: { c: 0, m: 10, y: 0 } })));
    const c = compiled(e, d);
    const seconds = (id: string): unknown => e.graph.get(c.entries[id]![0]!)!.args['time_s'];
    expect(seconds('sky')).toBeCloseTo(4.142, 3);
    expect(seconds('face')).toBe(5);
    expect(seconds('b3')).toBe(3);
    const comb = c.cuts['darkroom.H']!;
    expect(comb.op).toBe('print.combine');
    expect((comb.args['terms'] as { role: string }[]).map((t) => t.role)).toEqual(['burn', 'dodge', 'burn']);
  });

  it('combineRatio: real mode carries time in x; normalised mode weights by seconds', () => {
    expect(combineRatio({ mode: 'real', time_s: 10 }, { mode: 'real', time_s: 4 })).toBe(1);
    expect(combineRatio({ mode: 'normalised', time_s: 10 }, { mode: 'normalised', time_s: 4 })).toBe(0.4);
    expect(combineRatio(undefined, { mode: 'normalised', time_s: 4 })).toBe(1);
  });
});

// ---- the reference engine on the M1 negative ----------------------------------------------------

async function setup() {
  const e = new RefEngine({ data: nodePacksData() });
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
  const src = I('source.open', [], { source: info.sha256, encoding: 'linear', umPerPx: 6 });
  const dyes = I('invert.dyes', [I('scan.density', [src.id], { rebate: M1.rebate }).id], { stock: 'kodak_portra_400', scanner: 'xt5-rgb-led' });
  return { e, g, I, read, src, dyes, sha: info.sha256 };
}

const burnOf = (image: Node, mask?: Node, amount = 1) => ({ role: 'burn', image: image.id, amount, ...(mask ? { mask: mask.id } : {}) });
const dodgeOf = (image: Node, mask?: Node, amount = 1) => ({ ...burnOf(image, mask, amount), role: 'dodge' });

describe('print.combine and mask.* in the reference engine', () => {
  it('normalised and real mode: a one-stop burn through a linear mask adds log10(1 + m) per pixel', async () => {
    const { I, read, src, dyes } = await setup();
    const mask = I('mask.linear', [src.id], { from: { x: 8, y: 0 }, to: { x: 88, y: 0 } });
    const m = await read(mask);
    for (const mode of ['normalised', 'real'] as const) {
      const main = I('print.expose', [dyes.id], { mode, time_s: 10 });
      const burn = I('print.expose', [dyes.id], { mode, time_s: 10 });
      const comb = I('print.combine', [main.id], { terms: [burnOf(burn, mask)] });
      const [x0, x1] = [await read(main), await read(comb)];
      let worst = 0;
      for (let i = 0; i < M1.width * M1.height; i++) for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(x1[3 * i + k]! - x0[3 * i + k]! - Math.log10(1 + m[i]!)));
      expect(worst, mode).toBeLessThan(1e-12);
    }
  });

  it('normalised mode weights a 2.5 s burn on a 10 s main by its seconds', async () => {
    const { I, read, src, dyes } = await setup();
    const main = I('print.expose', [dyes.id], { time_s: 10, mode: 'normalised' });
    const comb = I('print.combine', [main.id], { terms: [burnOf(I('print.expose', [dyes.id], { time_s: 2.5, mode: 'normalised' }))] });
    const [x0, x1] = [await read(main), await read(comb)];
    expect(x1[100]! - x0[100]!).toBeCloseTo(Math.log10(1.25), 12);
  });

  it('dodge and burn of the same time and mask cancel; a dodge beyond the main exposure clamps and warns', async () => {
    const { e, I, read, src, dyes } = await setup();
    const mask = I('mask.ellipse', [src.id], { box: { x: 30, y: 10, w: 40, h: 40 }, angle_deg: 20 });
    const main = I('print.expose', [dyes.id], { mode: 'real', time_s: 10 });
    const t4 = I('print.expose', [dyes.id], { mode: 'real', time_s: 4 });
    const both = I('print.combine', [main.id], { terms: [dodgeOf(t4, mask), burnOf(t4, mask)] });
    const [x0, xb] = [await read(main), await read(both)];
    let worst = 0;
    for (let i = 0; i < x0.length; i++) worst = Math.max(worst, Math.abs(xb[i]! - x0[i]!));
    expect(worst).toBeLessThan(1e-12);
    const over = I('print.combine', [main.id], { terms: [dodgeOf(I('print.expose', [dyes.id], { mode: 'real', time_s: 15 }), mask)] });
    const r = await e.evaluate(over, { scale: 'full', precision: 'export' });
    expect(r.warnings.map((w) => w.code)).toContain('W_DODGE_EXCEEDS_MAIN');
    const xo = await r.read();
    const centre = (30 * M1.width + 50) * 3;
    expect(xo[centre]).toBeCloseTo(-8, 12); // no light where the dodge holds back everything
    expect(xo[0]).toBeCloseTo(x0[0]!, 13); // outside the mask the print is untouched
  });

  it('filters, preflash, amounts and the main mask: the light law of lightH per pixel', async () => {
    const { I, read, src, dyes } = await setup();
    const mask = I('mask.ellipse', [src.id], { box: { x: 20, y: 8, w: 50, h: 40 } });
    const main = I('print.expose', [dyes.id], { time_s: 10 });
    const t2 = I('print.expose', [dyes.id], { time_s: 2 });
    const comb = I('print.combine', [main.id], {
      mainAmount: 0.8, mainMask: mask.id, terms: [burnOf(t2, mask, 1.5)],
      filters: [{ logH: [0.1, -0.05, 0.02], amount: 0.5 }, { logH: [0, 0.2, 0], amount: 1, mask: mask.id }], preflash: [{ fraction: 0.03, amount: 2 }],
    });
    const [x0, x2, m, out] = [await read(main), await read(t2), await read(mask), await read(comb)];
    for (const i of [0, 33 * 96 + 45, 20 * 96 + 22, 6143]) {
      const want = [0, 0, 0];
      lightH({ xMain: x0.slice(3 * i, 3 * i + 3), wMain: 0.8 * m[i]!, terms: [{ role: 'burn', x: x2.slice(3 * i, 3 * i + 3), w: 1.5 * m[i]! }], densities: [], filters: [{ logH: [0.1, -0.05, 0.02], w: 0.5 }, { logH: [0, 0.2, 0], w: m[i]! }], preflash: [{ fraction: 0.03, w: 2 }] }, want);
      for (let k = 0; k < 3; k++) expect(out[3 * i + k]).toBe(want[k]);
    }
  });

  it('flashes: uniform through the base (dye amounts 0) or an open gate, not held back by density masks', async () => {
    const { I, read, dyes } = await setup();
    const main = I('print.expose', [dyes.id], { time_s: 10 });
    const f = I('print.expose', [dyes.id], { time_s: 1 });
    const dm = I('print.densityMask', [main.id], { gamma: 0.5, radius_um: 12 });
    for (const role of ['flash-base', 'flash-open']) {
      const a = await read(I('print.combine', [main.id], { terms: [{ role, image: f.id, amount: 1 }] }));
      const b = await read(I('print.combine', [main.id], { terms: [{ role, image: f.id, amount: 1 }], densities: [{ image: dm.id, amount: 1 }] }));
      const [x0, d] = [await read(main), await read(dm)];
      const added = (o: ArrayLike<number>, i: number, k: number, through = 1): number => 10 ** o[3 * i + k]! - through * 10 ** x0[3 * i + k]!;
      const ref = added(a, 0, 1);
      expect(ref).toBeGreaterThan(0);
      for (const i of [0, 1000, 5000]) {
        expect(added(a, i, 1) / ref).toBeCloseTo(1, 9);
        expect(added(b, i, 1, 10 ** -d[i]!) / ref).toBeCloseTo(1, 9);
      }
    }
  });

  it('the mask algebra: combine add/subtract/intersect with an amount, invert, constant, feather', async () => {
    const { I, read, src } = await setup();
    const a = I('mask.linear', [src.id], { from: { x: 0, y: 0 }, to: { x: 96, y: 0 } });
    const b = I('mask.linear', [src.id], { from: { x: 0, y: 64 }, to: { x: 0, y: 0 } });
    const [ma, mb] = [await read(a), await read(b)];
    for (const mode of ['add', 'subtract', 'intersect'] as const) {
      for (const amount of [1, 0.4]) {
        const mc = await read(I('mask.combine', [a.id], { other: b.id, mode, amount }));
        for (const i of [0, 100, 3000, 6143]) expect(mc[i]).toBe(maskCombine(mode, ma[i]!, mb[i]!, amount));
      }
    }
    const inv = await read(I('mask.invert', [a.id], {}));
    for (const i of [0, 100, 3000]) expect(inv[i]).toBe(1 - ma[i]!);
    expect([...(await read(I('mask.constant', [src.id], { value: 0.25 })))].every((v) => v === 0.25)).toBe(true);
    const fe = await read(I('mask.feather', [a.id], { radius_px: 6 }));
    expect(fe[32 * 96 + 48]).toBeCloseTo(ma[32 * 96 + 48]!, 12); // a linear ramp is unchanged by a symmetric blur away from the edges
    const paint = I('mask.paint', [src.id], { strokes: [{ points: [[10, 10, 0.5], [80, 50, 0.5]], radius: 5, hardness: 0.8, mode: 'add' }] });
    const mp = await read(paint);
    expect(mp[10 * 96 + 10]).toBe(1);
    expect(mp[60 * 96 + 5]).toBe(0);
  });

  it('a document with a masked burn compiles to print.combine and prints through it', async () => {
    const { e, doc } = await m1Engine();
    const d = withEdits(doc,
      insert('masks', 'sky', maskOf([['sky1', component('linear', { from: { x: 0, y: 0 }, to: { x: 0, y: 40 } })]])),
      push('darkroom', 'burn', L('burn', { stops: 1 }, { mask: 'sky' })));
    const c = compiled(e, d);
    const comb = c.cuts['darkroom.H']!;
    expect(comb.op).toBe('print.combine');
    const sky = e.graph.get((comb.args['terms'] as { mask: string }[])[0]!.mask)!;
    const [x0, x1, m] = [await pixels(e, c.cuts['darkroom.main']!), await pixels(e, comb), await pixels(e, sky)];
    // the top row is burned a full stop, below the mask's end nothing changes
    expect(x1[3 * 50]! - x0[3 * 50]!).toBeCloseTo(Math.log10(1 + m[50]!), 12);
    expect(m[50]).toBeGreaterThan(0.98);
    expect(x1[3 * (50 * 96 + 50)]).toBeCloseTo(x0[3 * (50 * 96 + 50)]!, 13);
    expect(opsOf(e, c)).toContain('mask.linear');
    const shown = await e.evaluate(c.display, { scale: 0.5, precision: 'preview' });
    expect(shown.width).toBe(48);
  });

  it('print.densityMask: d_m from PD = x_clear − x of the main print.expose, ≥ 0 and 0 at the densest area; print.combine applies it', async () => {
    const { I, read, dyes } = await setup();
    const x = I('print.expose', [dyes.id], { time_s: 10 });
    const x0 = await read(x);
    expect([...(await read(I('print.densityMask', [x.id], { gamma: 0 })))].every((v) => v === 0)).toBe(true);
    const dm = I('print.densityMask', [x.id], { gamma: 0.5, radius_um: 12 }); // σ = 12 µm / 6 µm/px = 2 px
    const d1 = await read(dm);
    const env = new PhysicsEnv(nodePacksData(), DEFAULT_CONVENTIONS);
    const clear = clearExposure({ up: (op) => (op === 'print.expose' ? { op, args: x.args, id: x.id, inputs: x.inputs } : op === 'invert.dyes' ? { op, args: dyes.args, id: dyes.id, inputs: dyes.inputs } : undefined), env });
    const pd = Float64Array.from(x0, (v, i) => clear[i % 3]! - v);
    const d = maskDensity(pd, 96, 64, 3, 0.5, 2);
    let min = Infinity;
    for (let i = 0; i < 96 * 64; i++) {
      expect(d1[i]!).toBeCloseTo(d[i]!, 12);
      min = Math.min(min, d[i]!);
    }
    expect(min).toBe(0);
    // same polarity: 0 at the thinnest area, ≥ 0
    const ds = await read(I('print.densityMask', [x.id], { gamma: 0.5, radius_um: 12, polarity: 'same' }));
    expect(Math.min(...ds)).toBe(0);
    // the combine with only a density mask: x − d_m in every layer (neutral)
    const c = await read(I('print.combine', [x.id], { densities: [{ image: dm.id, amount: 1 }] }));
    for (let i = 0; i < 96 * 64; i++) for (let k = 0; k < 3; k++) expect(c[3 * i + k]!).toBeCloseTo(x0[3 * i + k]! - d1[i]!, 11);
    // no pitch, no density mask: an image without umPerPx.film is refused (contract 1.0 has no default pitch)
    const pattern = I('source.pattern', [], { domain: 'paper-logH', width: 24, height: 16, seed: 3 });
    await expect(read(I('print.densityMask', [pattern.id], { gamma: 0.5, radius_um: 12 }))).rejects.toThrow(/film pitch/);
  });
});
