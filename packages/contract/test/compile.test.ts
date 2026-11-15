// The one compiler (design §29, §37): cuts, structural identities, the composite law, coalescing, masks.
import { describe, expect, it } from 'vitest';
import { Coll, insert, move, remove, set } from '@chromobench/values';
import {
  CUT_NAMES, compile, cut, cutNode, edit, getLaw, maskCombine, mixPixel, nodeId, type Compiled, type Document, type Graph,
} from '@chromobench/contract';
import { G, L, camDoc, component, diagOf, graph, linear, maskOf, push, scanDoc, spot, spots } from './helpers.ts';

const ops = (g: Graph, c: Compiled): string[] => g.closure(c.display.id).map((d) => d.op);
const ids = (g: Graph, c: Compiled): string[] => g.closure(c.display.id).map((d) => nodeId(d));

describe('cuts', () => {
  it('a negative scan names source, scan, negative, darkroom.main, darkroom.H, print, finished, display', () => {
    const g = graph();
    const c = compile(scanDoc(), g);
    expect(ops(g, c)).toEqual(['source.open', 'scan.density', 'invert.dyes', 'print.expose', 'print.develop', 'view.reflect', 'view.flare', 'view.adapt', 'output.display', 'output.frame']);
    expect(Object.fromEntries(Object.entries(c.cuts).map(([k, n]) => [k, n!.op]))).toEqual({
      source: 'source.open', scan: 'scan.density', negative: 'invert.dyes', 'darkroom.main': 'print.expose', 'darkroom.H': 'print.expose',
      print: 'view.adapt', finished: 'view.adapt', display: 'output.frame',
    });
    expect(c.cuts.source!.info).toMatchObject({ umPerPx: { film: 6 } });
    expect(c.cuts['darkroom.main']!.info).toMatchObject({ umPerPx: { film: 6, paper: 48 } });
    expect(c.cuts.print!.info).toMatchObject({ umPerPx: { paper: 48 } });
    expect(diagOf(() => cutNode(c, 'scene'))).toMatchObject({ code: 'E_CUT' });
    expect(diagOf(() => cutNode(c, 'nope'))).toMatchObject({ code: 'E_CUT' });
    expect(cutNode(c, 'print').op).toBe('view.adapt');
    expect(cut(scanDoc(), g, 'negative').id).toBe(c.cuts.negative!.id);
  });

  it('a camera file names source, scene, film (= negative), and its film pitch is the format over the long side', () => {
    const g = graph();
    const c = compile(camDoc(), g);
    expect(ops(g, c).slice(0, 7)).toEqual(['source.open', 'source.xyz', 'capture.expose', 'film.couple', 'film.halation', 'film.develop', 'film.grain']);
    expect(c.cuts.scene!.op).toBe('source.xyz');
    expect(c.cuts.film!.id).toBe(c.cuts.negative!.id);
    expect(c.cuts.scan).toBeUndefined();
    expect(c.cuts.source!.info).toMatchObject({ umPerPx: { film: 3000 } }); // 36 mm / 12 px
    expect(Object.keys(c.cuts).every((k) => CUT_NAMES.includes(k as never))).toBe(true);
  });

  it('an edit reuses every node upstream of it (unchanged prefixes are the same nodes)', () => {
    const g = graph();
    const a = compile(scanDoc(), g);
    const b = compile(edit(scanDoc(), [set('lights.params.logH', [0.1, 0, 0])]).doc, g);
    expect(ids(g, b).slice(0, 4)).toEqual(ids(g, a).slice(0, 4));
    expect(b.cuts['darkroom.H']!.op).toBe('print.combine');
    const p = compile(edit(scanDoc(), [push('print', 'cl', L('clarity', { strength: 0.3, radius_mm: 5 }))]).doc, g);
    expect(p.cuts.print!.id).toBe(a.cuts.print!.id);
    expect(p.cuts.finished!.op).toBe('clarity');
  });

  it('the what-if is the commit: compile(doc with tx) has the ids of compiling the committed document', () => {
    const g = graph();
    const tx = [push('print', 'cl', L('clarity', { strength: 0.3, radius_mm: 5 }, { amount: 0.6 })), set('main.params.time_s', 12)];
    const draft = edit(scanDoc(), tx).doc;
    const committed = edit(edit(scanDoc(), tx.slice(0, 1)).doc, tx.slice(1)).doc;
    expect(compile(draft, g).display.id).toBe(compile(committed, g).display.id);
  });
});

describe('the composite law', () => {
  const base = (): Document => scanDoc();
  const finished = (d: Document, g: Graph): string => compile(d, g).cuts.finished!.id;

  it('amount 0, disabled and identity layers produce no node: toggling returns to the cached graph', () => {
    const g = graph();
    const none = finished(base(), g);
    for (const e of [L('clarity', { strength: 0.3, radius_mm: 5 }, { amount: 0 }), L('clarity', { strength: 0.3, radius_mm: 5 }, { enabled: false }), L('clarity', { strength: 0, radius_mm: 5 })]) {
      expect(finished(edit(base(), [push('print', 'x', e)]).doc, g)).toBe(none);
    }
  });

  it('a layer at amount 1 without a mask is its op node; otherwise composite.mix(back, top, amount, mask)', () => {
    const g = graph();
    const d1 = edit(base(), [push('print', 'x', L('clarity', { strength: 0.3, radius_mm: 5 }))]).doc;
    const c1 = compile(d1, g);
    expect(c1.cuts.finished!.op).toBe('clarity');
    const d2 = edit(base(), [insert('masks', 'm1', maskOf([['c1', linear()]])), push('print', 'x', L('clarity', { strength: 0.3, radius_mm: 5 }, { amount: 0.4, mask: 'm1' }))]).doc;
    const f = compile(d2, g).cuts.finished!;
    expect(f.op).toBe('composite.mix');
    expect(f.args).toMatchObject({ amount: 0.4, blend: 'normal', top: c1.cuts.finished!.id });
    expect(f.inputs[0]).toBe(c1.cuts.print!.id);
    expect(mixPixel(0.2, 0.8, 0.25)).toBeCloseTo(0.35, 15);
  });

  it('a pass group at amount 1 without a mask is free; an isolated normal group equals a pass group', () => {
    const g = graph();
    const cl = L('clarity', { strength: 0.3, radius_mm: 5 }, { amount: 0.5 });
    const flat = finished(edit(base(), [push('print', 'x', cl)]).doc, g);
    const grouped = finished(edit(base(), [push('print', 'g1', G('sky', [['x', cl]]))]).doc, g);
    expect(grouped).toBe(flat);
    const faded = edit(base(), [push('print', 'g1', G('sky', [['x', cl]], { amount: 0.6 }))]).doc;
    const isolated = edit(base(), [push('print', 'g1', G('sky', [['x', cl]], { amount: 0.6, blend: 'normal' }))]).doc;
    expect(finished(isolated, g)).toBe(finished(faded, g));
    expect(compile(faded, g).cuts.finished!.op).toBe('composite.mix');
    expect(getLaw('composite').groups).toEqual(['pass', 'isolated']);
  });

  it('entries apply bottom to top: the order matters in the composite law', () => {
    const g = graph();
    const a = L('clarity', { strength: 0.3, radius_mm: 5 });
    const b = L('clarity', { strength: -0.2, radius_mm: 20 });
    const d = edit(base(), [push('print', 'a', a), push('print', 'b', b)]).doc;
    const r = edit(d, [move('b', { at: 0 })]).doc;
    expect(finished(d, g)).not.toBe(finished(r, g));
    expect(compile(d, g).cuts.finished!.args).toMatchObject({ strength: -0.2 });
  });
});

describe('coalescing (design §23)', () => {
  it('adjacent heal layers are one heal node with their spots in order, amounts folded into the opacity', () => {
    const g = graph();
    const d = edit(scanDoc(), [
      push('print', 'h1', L('heal', spots(['s1', spot(2, 2)]))),
      push('print', 'h2', L('heal', spots(['s2', spot(5, 5)]), { amount: 0.5 })),
      push('print', 'off', L('heal', spots(['s9', spot(1, 1)]), { enabled: false })),
      push('print', 'h3', L('heal', spots(['s3', spot(8, 3)], ['s4', spot(9, 7)]))),
    ]).doc;
    const c = compile(d, g);
    const f = c.cuts.finished!;
    expect(f.op).toBe('heal');
    expect(f.inputs[0]).toBe(c.cuts.print!.id);
    expect((f.args['spots'] as any[]).map((s) => [s.x, s.opacity])).toEqual([[2, 1], [5, 0.5], [8, 1], [9, 1]]);
    expect(c.entries['h1']).toEqual([f.id]);
    expect(c.entries['h3']).toEqual([f.id]);
  });

  it('a masked heal, a clone or a multi-spot layer at amount < 1 ends the run', () => {
    const g = graph();
    const d = edit(scanDoc(), [
      insert('masks', 'm1', maskOf([['c1', linear()]])),
      push('print', 'h1', L('heal', spots(['s1', spot(2, 2)]))),
      push('print', 'cl1', L('clone', spots(['s2', spot(5, 5)]))),
      push('print', 'h2', L('heal', spots(['s3', spot(8, 3)]))),
      push('print', 'h3', L('heal', spots(['s4', spot(8, 8)]), { mask: 'm1' })),
      push('print', 'h4', L('heal', spots(['s5', spot(3, 8)], ['s6', spot(1, 9)]), { amount: 0.5 })),
    ]).doc;
    const c = compile(d, g);
    expect(ops(g, c).filter((o) => ['heal', 'clone', 'composite.mix'].includes(o))).toEqual(['heal', 'clone', 'heal', 'heal', 'composite.mix', 'heal', 'composite.mix']);
  });

  it('coalescing does not change a pixel: one sequential node equals the layers one by one (toy evaluator)', () => {
    // a 1-D image; a spot copies src → target with opacity, reading the image as the spots before it left it
    const heal = (img: number[], ss: any[]): number[] => {
      const out = [...img];
      for (const s of ss) out[s.x] = out[s.x]! + s.opacity * (out[s.src.x]! - out[s.x]!);
      return out;
    };
    const run = (g: Graph, id: string, memo = new Map<string, number[]>()): number[] => {
      const hit = memo.get(id);
      if (hit) return hit;
      const n = g.get(id)!;
      const v = n.op === 'view.adapt' ? [0.1, 0.9, 0.3, 0.7, 0.5, 0.2, 0.8, 0.4, 0.6, 0.05]
        : n.op === 'heal' ? heal(run(g, n.inputs[0]!, memo), n.args['spots'] as any[])
          : n.op === 'composite.mix' ? run(g, n.inputs[0]!, memo).map((b, i) => mixPixel(b, run(g, n.args['top'] as string, memo)[i]!, n.args['amount'] as number))
            : [];
      memo.set(id, v);
      return v;
    };
    const s = (x: number, srcx: number, o = 1): any => ({ ...spot(x, 0, 1, { x: srcx, y: 0 }, o) });
    const layers: [string, number, any][] = [['a', 1, s(1, 3)], ['b', 0.5, s(3, 1)], ['c', 1, s(5, 3, 0.7)], ['d', 0.25, s(6, 5)]];
    const g = graph();
    const d = edit(scanDoc(), layers.map(([id, a, sp]) => push('print', id, L('heal', spots([`s${id}`, sp]), { amount: a })))).doc;
    const c = compile(d, g);
    expect(c.cuts.finished!.op).toBe('heal');
    // the same layers kept apart (each through its own mix): a mask of full coverage stops the coalescing
    const full = maskOf([['full', component('linear', { from: { x: 0, y: 0 }, to: { x: 0, y: 1e6 } })]]);
    const apart = edit(scanDoc(), [insert('masks', 'all', full), ...layers.map(([id, a, sp]) => push('print', id, L('heal', spots([`s${id}`, { ...sp, opacity: sp.opacity }]), { amount: a, mask: 'all' })))]).doc;
    const ca = compile(apart, g);
    expect(ca.cuts.finished!.op).toBe('composite.mix');
    // evaluate the apart chain with the mask as 1 everywhere (its value does not enter the toy mix)
    expect(run(g, c.cuts.finished!.id)).toEqual(run(g, ca.cuts.finished!.id).map((v) => v));
  });

  it('the scan stage repairs in order (heal on scanner density, before the inversion)', () => {
    const g = graph();
    const d = edit(scanDoc(), [push('scan', 'dust', G('Dust', [['d1', L('heal', spots(['p1', spot(2, 2)]))], ['d2', L('heal', spots(['p2', spot(6, 6)]))]]))]).doc;
    const c = compile(d, g);
    expect(c.cuts.scan!.op).toBe('heal');
    expect((c.cuts.scan!.args['spots'] as unknown[]).length).toBe(2);
    expect(c.cuts.negative!.inputs[0]).toBe(c.cuts.scan!.id);
    expect(getLaw('repair')).toMatchObject({ blend: false, groups: ['pass'], amount: 'opacity' });
  });
});

describe('masks', () => {
  it('one algebra: add is idempotent, intersect with 1 is the identity, subtract is a·(1 − b), invert is an involution, amount 0 is the identity', () => {
    for (let i = 0; i <= 20; i++) {
      const a = i / 20;
      for (let j = 0; j <= 20; j++) {
        const b = j / 20;
        expect(maskCombine('add', a, a)).toBe(a);
        expect(maskCombine('intersect', a, 1)).toBe(a);
        expect(maskCombine('subtract', a, b)).toBeCloseTo(a * (1 - b), 15);
        expect(maskCombine('intersect', a, b)).toBeCloseTo(a * b, 15);
        expect(maskCombine('add', a, b)).toBe(Math.max(a, b));
        expect(1 - (1 - a)).toBeCloseTo(a, 15);
        for (const m of ['add', 'subtract', 'intersect'] as const) expect(maskCombine(m, a, b, 0)).toBe(a);
        // product forms commute; add (max) commutes too
        expect(maskCombine('intersect', a, b)).toBe(maskCombine('intersect', b, a));
      }
    }
  });

  it('compiles components from the empty mask, then feather (mm on the print → document px), then invert', () => {
    const g = graph();
    const m = maskOf([
      ['c1', linear()],
      ['c2', component('ellipse', { box: { x: 1, y: 1, w: 6, h: 4 } }, 'intersect', 0.5)],
      ['c3', component('paint', { strokes: Coll.of([['k1', { points: [[1, 1, 0.5], [4, 4, 0.5]], radius: 2, hardness: 0.6, mode: 'add' }]]) as never }, 'subtract')],
    ], { feather_mm: 0.48, invert: true });
    const d = edit(scanDoc(), [insert('masks', 'm1', m), push('darkroom', 'b1', L('burn', { stops: 1 }, { mask: 'm1' }))]).doc;
    const c = compile(d, g);
    const mid = (c.cuts['darkroom.H']!.args['terms'] as any[])[0].mask;
    const chain = g.closure(mid).filter((n) => n.op.startsWith('mask.')).map((n) => n.op);
    expect(chain).toEqual(['mask.linear', 'mask.ellipse', 'mask.combine', 'mask.paint', 'mask.combine', 'mask.feather', 'mask.invert']);
    const feather = g.closure(mid).find((n) => n.op === 'mask.feather')!;
    expect(feather.args['radius_px']).toBeCloseTo(10, 12); // 0.48 mm / (6 µm × 8) per px
    const paint = g.closure(mid).find((n) => n.op === 'mask.paint')!;
    expect(paint.args['strokes']).toEqual([{ points: [[1, 1, 0.5], [4, 4, 0.5]], radius: 2, hardness: 0.6, mode: 'add' }]);
    // geometric components hang off the source (document pixels)
    expect(g.closure(mid).find((n) => n.op === 'mask.linear')!).toBeDefined();
    expect(g.get(g.closure(mid).map((n) => nodeId(n)).find((id) => g.get(id)!.op === 'mask.linear')!)!.inputs[0]).toBe(c.cuts.source!.id);
  });

  it('a luminance component reads its stage\'s input, or the cut it names', () => {
    const g = graph();
    const lum = component('luminance', { above: 0.5, below: 1, softness: 0.1 });
    const d = edit(scanDoc(), [
      insert('masks', 'neg', maskOf([['l1', lum]])),
      insert('masks', 'prt', maskOf([['l2', lum]], { reads: 'darkroom.main' })),
      insert('masks', 'src', maskOf([['l3', lum]], { reads: 'source' })),
      push('darkroom', 'b1', L('burn', { stops: 1 }, { mask: 'neg' })),
      push('darkroom', 'd1', L('dodge', { stops: 0.5 }, { mask: 'prt' })),
      push('print', 'h1', L('clarity', { strength: 0.2, radius_mm: 3 }, { mask: 'neg', amount: 0.5 })),
      push('darkroom', 'f1', L('flash', { time_s: 0.2 }, { mask: 'src' })),
    ]).doc;
    const c = compile(d, g);
    const recv = (maskNode: string): string => g.get(maskNode)!.inputs[0]!;
    const terms = c.cuts['darkroom.H']!.args['terms'] as any[];
    expect(recv(terms[0].mask)).toBe(c.cuts.negative!.id);
    expect(recv(terms[1].mask)).toBe(c.cuts['darkroom.main']!.id);
    expect(recv(terms[2].mask)).toBe(c.cuts.source!.id);
    // the same mask in the print stage reads the print stage's input
    expect(recv(c.cuts.finished!.args['mask'] as string)).toBe(c.cuts.print!.id);
  });

  it('an empty mask is the constant 0; a first component that is not an add folds from it', () => {
    const g = graph();
    const d = edit(scanDoc(), [
      insert('masks', 'e', maskOf([])),
      insert('masks', 's', maskOf([['c1', component('linear', { from: { x: 0, y: 0 }, to: { x: 0, y: 4 } }, 'subtract')]])),
      push('darkroom', 'b1', L('burn', { stops: 1 }, { mask: 'e' })),
      push('darkroom', 'b2', L('burn', { stops: 2 }, { mask: 's' })),
    ]).doc;
    const terms = compile(d, g).cuts['darkroom.H']!.args['terms'] as any[];
    expect(g.get(terms[0].mask)).toMatchObject({ op: 'mask.constant', args: { value: 0 } });
    expect(g.get(terms[1].mask)).toMatchObject({ op: 'mask.combine', args: { mode: 'subtract' } });
  });

  it('removing a mask in use is refused at the end of the transaction; removing both is fine', () => {
    const d = edit(scanDoc(), [insert('masks', 'm1', maskOf([['c1', linear()]])), push('darkroom', 'b1', L('burn', { stops: 1 }, { mask: 'm1' }))]).doc;
    expect(diagOf(() => edit(d, [remove('m1')]))).toMatchObject({ code: 'E_DOCUMENT', path: 'b1.mask' });
    expect(() => edit(d, [remove('m1'), remove('b1')])).not.toThrow();
  });
});
