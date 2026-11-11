// The reference engine: CHB-002's generated conformance suite, plus cross-checks of the op adapters
// against core's functions on the same pixels.
import { describe, expect, it } from 'vitest';
import { allOps, Graph, sha256Hex } from '@chromobench/contract';
import { runConformance } from '@chromobench/conformance';
import { makeM1Tiff } from '@chromobench/engine-mock';
import {
  adaptBradford, D65, displayPixel, displaySetup, interimData, makeForward, makePrintChain, makeScanner, REFERENCE_OPS, RefEngine, resolveStock, solveDyes, SPEKTRAFILM,
} from '../src/index.ts';

runConformance('reference', () => new RefEngine());

async function setup() {
  const e = new RefEngine();
  const g = new Graph();
  const bytes = makeM1Tiff();
  g.registerSource(await e.open({ kind: 'file', sha256: sha256Hex(bytes), bytes }));
  const I = (op: string, inputs: string[], args: Record<string, unknown> = {}): string => {
    const { node } = g.intern(op, inputs, args);
    e.adopt(g.closure(node.id));
    return node.id;
  };
  const read = async (id: string): Promise<Float64Array> => (await e.evaluate({ id, info: g.get(id)!.info }, { scale: 'full', precision: 'export' }).then((r) => r.read())) as Float64Array;
  return { e, g, I, read };
}

describe('reference engine', () => {
  it('claims only catalog ops, including every CHB-003 op', () => {
    const all = new Set(allOps({ includeInternal: true }).map((o) => o.name));
    for (const op of REFERENCE_OPS) expect(all.has(op), op).toBe(true);
    for (const op of ['invert.dyes', 'invert.classify', 'invert.classes', 'print.expose', 'print.lights', 'print.preflash', 'print.develop', 'view.reflect', 'view.flare', 'view.adapt', 'output.display', 'measure.stats', 'measure.densitometer']) {
      expect(REFERENCE_OPS).toContain(op);
    }
    expect(new RefEngine().capabilities().conventions).toMatch(/^core-v1:opaque/);
  });

  it('invert.dyes: reachable pixels re-read to their input density; channel 4 is the residual', async () => {
    const { I, read } = await setup();
    const pat = I('source.pattern', [], { domain: 'scanner-density', width: 6, height: 5, seed: 11 });
    const dy = I('invert.dyes', [pat], { stock: 'kodak_portra_400', scanner: 'xt5-rgb-led' });
    const [d, c] = [await read(pat), await read(dy)];
    const f = makeForward(makeScanner(interimData(), 'xt5-rgb-led'), resolveStock(interimData().stock('kodak_portra_400'), SPEKTRAFILM));
    for (let i = 0; i < 30; i++) {
      const dd = [0, 1, 2].map((k) => d[3 * i + k]! + f.Dbase[k]!);
      const s = solveDyes(f, dd);
      for (let k = 0; k < 3; k++) expect(c[4 * i + k]).toBe(s.c[k]);
      const D = f.D([c[4 * i]!, c[4 * i + 1]!, c[4 * i + 2]!]);
      expect(c[4 * i + 3]!).toBeCloseTo(Math.hypot(D[0] - dd[0]!, D[1] - dd[1]!, D[2] - dd[2]!), 12);
    }
  });

  it('the print chain ops reproduce makePrintChain + display on the same dye pixels', async () => {
    const { I, read } = await setup();
    const pat = I('source.pattern', [], { domain: 'film-dyes', width: 4, height: 3, seed: 5 });
    const x = I('print.lights', [I('print.expose', [pat])], { logH: [0.05, 0, -0.025] });
    const xyz = I('view.reflect', [I('print.develop', [x], { grade: 2 })], { illuminant: 'D50' });
    const out = I('output.display', [I('view.adapt', [I('view.flare', [xyz], { flare: 0 })])], { rendering: 'print-as-seen', knee: 'oklch' });
    const [dyes, rgb] = [await read(pat), await read(out)];
    const ch = makePrintChain({ data: interimData(), film: 'kodak_portra_400', paper: 'kodak_portra_endura', conv: SPEKTRAFILM, view: 'D50' });
    // CHB-011: print-as-seen adapts from print-xyz's white (D65 after view.adapt); its lightness knee starts at the paper white
    const ds = displaySetup({ rendering: 'print-as-seen', white: D65, paperWhite: adaptBradford(ch.paperWhite, ch.white, D65), space: 'srgb', knee: 'oklch' });
    for (let i = 0; i < 12; i++) {
      const c = [dyes[3 * i]!, dyes[3 * i + 1]!, dyes[3 * i + 2]!];
      const xx = ch.xOfDyes(c).map((v, k) => v + [0.05, 0, -0.025][k]!);
      const X = ch.xyzOfX(xx);
      const want = displayPixel(adaptBradford(X, ch.white, D65), ds);
      for (let k = 0; k < 3; k++) {
        expect(Math.abs(rgb[3 * i + k]! - want[k]!)).toBeLessThan(1e-12);
        expect(rgb[3 * i + k]!).toBeGreaterThanOrEqual(0);
        expect(rgb[3 * i + k]!).toBeLessThanOrEqual(1);
      }
    }
  });

  it('contract 0.2: print.expose reads filtration as a shift on the neutral pack, and its aim and aimView args', async () => {
    const { I, read } = await setup();
    const pat = I('source.pattern', [], { domain: 'film-dyes', width: 3, height: 2, seed: 9 });
    const dyes = await read(pat);
    const data = interimData();
    const cases: [Record<string, unknown>, Parameters<typeof makePrintChain>[0]][] = [
      [{}, { data, film: 'kodak_portra_400', paper: 'kodak_portra_endura', conv: SPEKTRAFILM, view: 'D50' }],
      [{ filtration: { c: 0, m: -10, y: 5 } }, { data, film: 'kodak_portra_400', paper: 'kodak_portra_endura', conv: SPEKTRAFILM, view: 'D50', filtrationShift: { c: 0, m: -10, y: 5 } }],
      [{ aim: 'midgray-normalised' }, { data, film: 'kodak_portra_400', paper: 'kodak_portra_endura', conv: SPEKTRAFILM, aim: 'midgray-normalised' }],
      [{ aimView: 'D65' }, { data, film: 'kodak_portra_400', paper: 'kodak_portra_endura', conv: SPEKTRAFILM, view: 'D65' }],
    ];
    const outs: Float64Array[] = [];
    for (const [args, chain] of cases) {
      const x = await read(I('print.expose', [pat], args));
      const ch = makePrintChain(chain);
      for (let i = 0; i < 6; i++) {
        const want = ch.xOfDyes([dyes[3 * i]!, dyes[3 * i + 1]!, dyes[3 * i + 2]!]);
        for (let k = 0; k < 3; k++) expect(Math.abs(x[3 * i + k]! - want[k]!)).toBeLessThan(1e-12);
      }
      outs.push(x);
    }
    // the database neutral pack for (Portra Endura, Portra 400) is not 0/0/0, and shift 0 means it
    expect(data.neutralFilter('kodak_portra_endura', 'kodak_portra_400')).toBeDefined();
    for (const o of outs.slice(1)) expect(Math.max(...o.map((v, i) => Math.abs(v - outs[0]![i]!)))).toBeGreaterThan(1e-4);
  });

  it('contract 0.2: invert.classes takes σ from its sigma argument', async () => {
    const { I, read } = await setup();
    const pat = I('source.pattern', [], { domain: 'scanner-density', width: 8, height: 8, seed: 3 });
    const dy = I('invert.dyes', [pat], { stock: 'kodak_portra_400', scanner: 'xt5-rgb-led' });
    const blank = async (sigma: number[]) => (await read(I('invert.classes', [dy], { sigma }))).filter((c) => c === 1).length;
    const [small, big] = [await blank([0.0043, 0.0033, 0.0057]), await blank([0.2, 0.2, 0.2])];
    expect(big).toBeGreaterThan(small);
  });

  it('measure.densitometer on print-xyz reports visual density −log10 Y', async () => {
    const { e, g, I } = await setup();
    const pat = I('source.pattern', [], { domain: 'paper-dyes', width: 3, height: 3, seed: 2 });
    const xyz = I('view.reflect', [pat], { illuminant: 'D50' });
    const m = I('measure.densitometer', [xyz], { at: { x: 1, y: 1 }, aperture_px: 1 });
    const v = await e.measure({ id: m, info: g.get(m)!.info });
    const px = (await e.evaluate({ id: xyz, info: g.get(xyz)!.info }, { scale: 'full', precision: 'export' }).then((r) => r.read()))!;
    expect(v.value['visual']).toBeCloseTo(-Math.log10(px[3 * 4 + 1]!), 12);
  });
});
