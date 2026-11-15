// CHB-010 stages 1–2 behaviour: the calibration (aim fixed there), real vs normalised, optics, grade,
// printer lights, warmth/tint, integrate-to-grey, roll tools, grey pick, lights → filtration and Bake.
import { describe, expect, it } from 'vitest';
import { ChromobenchError, edit, Graph, LOG_RULES, newDocument, sha256Hex, type Document, type Layer } from '@chromobench/contract';
import { Log, set, transaction } from '@chromobench/values';
import { makeM1Tiff } from '@chromobench/engine-mock';
import {
  aimOf, autoLights, bakeLights, chainOptionsOf, colourOffset, filtrationForLights, frameStats, gradeToGamma, greyPickSliders, nodePacksData,
  latdFromPD, Lights, lightsToFiltration, makePrintChain, matchFrame, meanX, points, q, REFERENCE_OPTICS, RefEngine, rollConsistency, rollMean,
  SPEKTRAFILM, warmthVector, type PrintChainOptions,
} from '../src/index.ts';

const data = nodePacksData();
const O: PrintChainOptions = { data, film: 'kodak_portra_400', paper: 'kodak_portra_endura', conv: SPEKTRAFILM, view: 'D50' };
const PT = 0.025;

describe('the calibration: aim lights are fitted once, so filters and time change the print', () => {
  it('at the calibration both modes print the grey card at the aim; away from it a shift moves the grey in both modes', () => {
    const n0 = makePrintChain(O);
    const r0 = makePrintChain({ ...O, mode: 'real' });
    const p = n0.print(n0.grey);
    expect(p.XYZ[1]).toBeCloseTo(0.184, 9);
    expect(Math.hypot(p.lab[1], p.lab[2])).toBeLessThan(1e-6);
    r0.print(r0.grey).x.forEach((v, k) => expect(v).toBeCloseTo(p.x[k]!, 12));
    for (const mode of ['normalised', 'real'] as const) {
      const ch = makePrintChain({ ...O, mode, filtrationShift: { c: 0, m: 10, y: 0 } });
      const lab = ch.print(ch.grey).lab;
      expect(lab[1], `${mode}: +10 M makes the grey greener`).toBeLessThan(-5);
      expect(ch.aimLights.logH).toEqual(n0.aimLights.logH);
    }
  });

  it('real − normalised is one scalar per setting (κ + optics), the same for every density and layer', () => {
    for (const sh of [{ c: 0, m: 0, y: 0 }, { c: 5, m: -20, y: 30 }]) {
      const r = makePrintChain({ ...O, mode: 'real', filtrationShift: sh, optics: { time_s: 13, fstop: 5.6, magnification: 3 } });
      const n = makePrintChain({ ...O, mode: 'normalised', filtrationShift: sh, optics: { time_s: 13, fstop: 5.6, magnification: 3 } });
      const d0 = r.xOfDyes(r.grey)[0] - n.xOfDyes(n.grey)[0];
      for (const c of [[0, 0, 0], [0.3, 1.2, 0.8], [1.5, 0.2, 2.1]]) {
        const xr = r.xOfDyes(c);
        const xn = n.xOfDyes(c);
        for (let k = 0; k < 3; k++) expect(xr[k]! - xn[k]!).toBeCloseTo(d0, 12);
      }
    }
  });

  it('real mode: time, aperture and magnification are exact log-exposure offsets; normalised mode ignores them', () => {
    const r = makePrintChain({ ...O, mode: 'real' });
    const x0 = r.xOfDyes(r.grey);
    const at = (optics: object) => makePrintChain({ ...O, mode: 'real', optics }).xOfDyes(r.grey);
    at({ time_s: 20 }).forEach((v, k) => expect(v - x0[k]!).toBeCloseTo(Math.log10(2), 12));
    at({ fstop: 16 }).forEach((v, k) => expect(v - x0[k]!).toBeCloseTo(-2 * Math.log10(2), 12));
    at({ magnification: 17 }).forEach((v, k) => expect(v - x0[k]!).toBeCloseTo(-2 * Math.log10(18 / 9), 12));
    makePrintChain({ ...O, optics: { time_s: 20, fstop: 16 } }).xOfDyes(r.grey).forEach((v, k) => expect(v).toBeCloseTo(x0[k]!, 12));
    expect(REFERENCE_OPTICS).toEqual({ time_s: 10, fstop: 8, magnification: 8 });
  });

  it('grade is a gamma about the aim grey (Filmbench GRADE): the grey card stays, contrast moves', () => {
    expect([0, 1, 2, 3, 4, 5, 2.5, -1, 9].map(gradeToGamma)).toEqual([0.7, 0.82, 1, 1.2, 1.45, 1.8, 1.1, 0.7, 1.8]);
  });
});

describe('printer lights', () => {
  it('Lights.shift refuses a density and a CC value with E_UNIT (Hunt 14.17), accepts points and stops', () => {
    const L = Lights.zero();
    for (const bad of [q(0.1, 'D'), q(10, 'CC')]) {
      try {
        L.shift({ G: bad });
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(ChromobenchError);
        expect((e as ChromobenchError).diag.code).toBe('E_UNIT');
        expect((e as ChromobenchError).diag.message).toMatch(/Hunt 14\.17/);
      }
    }
    expect(L.shift({ R: points(4), B: q(1, 'stop') }).logH).toEqual([0.1, 0, Math.log10(2)]);
  });

  it('a curve does not commute with a shift: +0.1 log H moves the green dye near paper white by less than a fifth of its move at the grey card', () => {
    const ch = makePrintChain({ ...O, aim: 'midgray-normalised' });
    const dG = (c: number[]) => ch.develop(ch.xOfDyes(c).map((v) => v + 0.1))[1] - ch.develop(ch.xOfDyes(c))[1];
    const atGrey = dG(ch.grey);
    const atWhite = dG(ch.film.develop([1.8, 1.8, 1.8]));
    expect(atGrey).toBeGreaterThan(0.18);
    expect(atWhite / atGrey).toBeLessThan(0.2);
  });

  it('tint ±100 moves green by ±6.7 points and red and blue by ∓3.3 (guide errata); warmth +100 is 130 mired along the film vector', () => {
    const w = [-0.001, 0, 0.001];
    expect(colourOffset(0, 100, w).map((v) => v / PT)).toEqual([-10 / 3, 20 / 3, -10 / 3].map((v) => expect.closeTo(v, 12)));
    expect(colourOffset(100, 0, w).map((v) => v / PT)).toEqual([-5.2, 0, 5.2].map((v) => expect.closeTo(v, 12)));
  });
});

describe('integrate-to-grey, roll consistency and match frame', () => {
  const ch = makePrintChain({ ...O, mode: 'real' });
  const aim = aimOf(ch);

  it('the aim bundle: A is the grey card through the current pack, g prints the aim, the warmth vector has no mean', () => {
    const pd = ch.enlarger.printingDensity(ch.film.spectral(ch.grey));
    expect(aim.A).toEqual(pd);
    expect(aim.g).toEqual(ch.aimX);
    expect(aim.warmPerMired.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 15);
    expect(aim.warmPerMired[0]).toBeLessThan(0);
    expect(aim.warmPerMired[2]).toBeGreaterThan(0);
    for (const [lo, hi] of aim.window) expect(hi - lo).toBeGreaterThan(0.8);
  });

  it('a frame that is all grey card needs no auto lights; a cast frame is corrected in density fully and in colour by α', () => {
    const grey = Array.from({ length: 4 }, () => [...aim.A]).flat();
    expect(autoLights(latdFromPD(grey, 4), aim)).toEqual([0, 0, 0].map(() => expect.closeTo(0, 12)));
    const cast = [aim.A[0] + 0.2, aim.A[1] + 0.1, aim.A[2]];
    const L = autoLights(cast, aim, 0.75);
    const m = 0.1;
    [0.2, 0.1, 0].forEach((d, k) => expect(L[k]).toBeCloseTo(m + 0.75 * (d - m), 12));
    const st = frameStats([0.1, 0.2, 0.3, 0.3, 0.4, 0.5], 2);
    expect(st.meanPD).toEqual([0.2, 0.30000000000000004, 0.4]);
  });

  it('roll consistency blends towards the roll mean; match frame moves by m·(x̄_ref − x̄_this)', () => {
    expect(rollMean([[0.1, 0, 0]])).toBeNull();
    const mean = rollMean([[0.1, 0, 0], [0.3, 0.2, -0.2]])!;
    expect(mean).toEqual([0.2, 0.1, -0.1]);
    expect(rollConsistency([0, 0, 0], mean, 0.5)).toEqual([0.1, 0.05, -0.05]);
    const xThis = meanX(aim.clear, [1.1, 1.5, 1.7], [0, 0, 0]);
    const xRef = meanX(aim.clear, [1.0, 1.5, 1.8], [0, 0, 0]);
    matchFrame(xRef, xThis, 0.5).forEach((v, k) => expect(v).toBeCloseTo([0.05, 0, -0.05][k]!, 12));
  });
});

describe('grey pick, lights → filtration and Bake', () => {
  const ch = makePrintChain({ ...O, mode: 'real' });

  it('grey pick on warmth and tint neutralises a cast patch in ≤ 12 iterations (|a*, b*| < 0.05)', () => {
    const cast = ch.film.develop([0.05, 0, -0.06]);
    const r = greyPickSliders(ch, cast);
    expect(r.iterations).toBeLessThanOrEqual(12);
    expect(Math.hypot(...r.ab)).toBeLessThan(0.05);
    const w = warmthVector(ch);
    colourOffset(r.warmth, r.tint, w).forEach((v, k) => expect(r.lights[k]).toBeCloseTo(v, 15));
    const lab = ch.print(cast, Lights.fromLogH(r.lights)).lab;
    expect(Math.hypot(lab[1], lab[2])).toBeLessThan(0.05);
  });

  it('first order: J·Δv + u reproduces the lights; a dial that would go negative is held at 0 and cyan freed', () => {
    const J = ch.enlarger.dxdCC(ch.film.spectral(ch.grey));
    const pack = ch.filtration;
    const dL = [0.1, 0, -0.05];
    const r = lightsToFiltration(dL, J, pack);
    const dv = [r.filtration.c - pack.c, r.filtration.m - pack.m, r.filtration.y - pack.y];
    expect(dv[0]).toBe(0);
    for (let k = 0; k < 3; k++) expect(J[k]![0]! * dv[0]! + J[k]![1]! * dv[1]! + J[k]![2]! * dv[2]! + r.uniform).toBeCloseTo(dL[k]!, 12);
    // much less red light than the pack's magenta can give back: magenta pinned at 0, cyan added
    const big = lightsToFiltration([-0.6, 0.3, 0.3], J, { c: 0, m: 5, y: 50 });
    expect(big.filtration.m).toBe(0);
    expect(big.filtration.c).toBeGreaterThan(0);
  });

  it('filtration for lights: real mode carries colour and density in dials and time, residual < 0.5 points at the grey', () => {
    const o = { ...O, mode: 'real' as const, optics: { time_s: 10 } };
    const fit = filtrationForLights(o, [0.1, 0, -0.05]);
    expect(fit.filtration.c).toBe(0);
    expect(fit.shift.m).toBeGreaterThan(5);
    expect(fit.shift.y).toBeGreaterThan(10);
    expect(fit.time_s).toBeGreaterThan(11);
    expect(fit.lights).toEqual([0, 0, 0]);
    expect(Math.max(...fit.residual_pt.map(Math.abs))).toBeLessThan(0.5);
    // normalised mode: the same colour in the dials, the density stays as a uniform light
    const fn = filtrationForLights({ ...o, mode: 'normalised' }, [0.1, 0, -0.05]);
    expect(fn.time_s).toBe(10);
    expect(fn.lights[0]).toBeGreaterThan(0.005);
    expect(Math.max(...fn.residual_pt.map(Math.abs))).toBeLessThan(0.5);
  });

  it('Bake moves the printer lights into the main exposure’s filtration and time as one undo unit; the grey card prints the same', () => {
    const blank = newDocument('negative-scan', { sha256: 'a'.repeat(64) }, { umPerPx: 6 });
    const r0 = edit(blank, [set('lights.params.logH', [0.05, -0.025, 0.04])]).doc;
    let log = Log.create({ rules: LOG_RULES }).open('f', r0, { kind: 'frame', by: 'auto' });
    const { fit, mutations } = bakeLights(log.doc<Document>('f'), data, SPEKTRAFILM);
    log = log.commit({ doc: 'f', tx: transaction({ id: 'bake', label: 'Bake', by: 'user', mutations }) });
    expect(log.inEffect('f').length).toBe(1);
    const r1 = log.doc<Document>('f');
    const at = (d: typeof r0, id: string): Layer => d.stages.darkroom.stack.items[id] as Layer;
    expect(at(r1, 'lights').params['logH']).toEqual([0, 0, 0]);
    expect(at(r1, 'main').params['time_s']).toBe(fit.time_s);
    expect(chainOptionsOf(r0, data, SPEKTRAFILM).mode).toBe('real');
    const before = makePrintChain(chainOptionsOf(r0, data, SPEKTRAFILM));
    const after = makePrintChain(chainOptionsOf(r1, data, SPEKTRAFILM));
    const xb = before.xOfDyes(before.grey, Lights.fromLogH(at(r0, 'lights').params['logH'] as [number, number, number]));
    const xa = after.xOfDyes(after.grey);
    for (let k = 0; k < 3; k++) expect(Math.abs(xa[k]! - xb[k]!) / PT).toBeLessThan(0.5);
    log = log.undo();
    expect(log.doc<Document>('f')).toEqual(r0);
    expect(() => bakeLights(r0, data, SPEKTRAFILM, 'main')).toThrow(/printer-lights filter/);
  });
});

describe('the reference engine in real mode', () => {
  it('print.expose: time and magnification move every pixel by the optics; grade 4 leaves the grey card where it is', async () => {
    const e = new RefEngine({ data: nodePacksData() });
    const g = new Graph();
    const bytes = makeM1Tiff();
    g.registerSource(await e.open({ kind: 'file', sha256: sha256Hex(bytes), bytes }));
    const I = (op: string, inputs: string[], args: Record<string, unknown> = {}): string => {
      const { node } = g.intern(op, inputs, args);
      e.adopt(g.closure(node.id));
      return node.id;
    };
    const read = async (id: string) => (await e.evaluate({ id, info: g.get(id)!.info }, { scale: 'full', precision: 'export' }).then((r) => r.read())) as Float64Array;
    const pat = I('source.pattern', [], { domain: 'film-dyes', width: 3, height: 2, seed: 4 });
    const x10 = await read(I('print.expose', [pat], { mode: 'real' }));
    const x20 = await read(I('print.expose', [pat], { mode: 'real', time_s: 20, magnification: 8 }));
    const xm = await read(I('print.expose', [pat], { mode: 'real', magnification: 17 }));
    for (let i = 0; i < x10.length; i++) {
      expect(x20[i]! - x10[i]!).toBeCloseTo(Math.log10(2), 12);
      expect(xm[i]! - x10[i]!).toBeCloseTo(-2 * Math.log10(2), 12);
    }
    // a grey-card pixel through print.develop at grade 2 and grade 4
    const ch = makePrintChain({ ...O, mode: 'real' });
    const ex = I('print.expose', [pat], { mode: 'real' });
    const d2 = await read(I('print.develop', [ex], { grade: 2 }));
    const d4 = await read(I('print.develop', [ex], { grade: 4 }));
    const dyes = await read(pat);
    for (let i = 0; i < 6; i++) {
      const x = ch.xOfDyes([dyes[3 * i]!, dyes[3 * i + 1]!, dyes[3 * i + 2]!]);
      const want4 = ch.develop(x.map((v, k) => ch.aimX[k]! + 1.45 * (v - ch.aimX[k]!)));
      for (let k = 0; k < 3; k++) {
        expect(d2[3 * i + k]).toBeCloseTo(ch.develop(x)[k]!, 12);
        expect(d4[3 * i + k]).toBeCloseTo(want4[k]!, 12);
      }
    }
    // the pivot: at the aim grey's x, grade does nothing
    const pivotDev = ch.develop(ch.aimX);
    const pivot4 = ch.develop(ch.aimX.map((v, k) => ch.aimX[k]! + 1.45 * (v - ch.aimX[k]!)));
    pivot4.forEach((v, k) => expect(v).toBeCloseTo(pivotDev[k]!, 15));
  });
});
