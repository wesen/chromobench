// The light law (design §22, §37): for random darkroom stacks of today's kinds, compiling the document and
// evaluating its print.combine node per pixel with lightH equals today's combinePixel, followed by today's
// print.lights and print.preflash, computed here by a small independent implementation from the entries themselves.
import { describe, expect, it } from 'vitest';
import { Coll, type Id } from '@chromobench/values';
import {
  check, compile, edit, getLaw, law, lightH, mulberry32, termSeconds, type Compiled, type Entry, type Graph, type Rng,
} from '@chromobench/contract';
import { G, L, graph, linear, maskOf, push, scanDoc } from './helpers.ts';
import { insert, set } from '@chromobench/values';

/** Today's darkroom for one pixel, written from the CHB-010 formulas (core/src/print/exposures.ts and ops.ts). */
function today(xMain: number[], extra: { kind: 'dodge' | 'burn' | 'flash'; x: number[]; m: number }[], dms: number[], lights: number[], preflash: number): number[] {
  const dm = dms.reduce((a, b) => a + b, 0);
  return [0, 1, 2].map((k) => {
    let H = 10 ** xMain[k]!;
    for (const e of extra) if (e.kind === 'dodge') H -= e.m * 10 ** e.x[k]!;
    H = Math.max(H, 0);
    for (const e of extra) if (e.kind === 'burn') H += e.m * 10 ** e.x[k]!;
    H *= 10 ** -dm;
    for (const e of extra) if (e.kind === 'flash') H += e.m * 10 ** e.x[k]!;
    const x = Math.log10(Math.max(H, 1e-8)) + lights[k]!; // print.combine, then print.lights
    return preflash > 0 ? Math.log10(10 ** x + preflash) : x; // print.preflash
  });
}

interface Pixel { x: Map<string, number[]>; m: Map<string, number>; d: Map<string, number> }

/** Evaluates a compiled darkroom at one pixel: every node of the graph gets a sample, then lightH reads the combine node. */
function evalDarkroom(g: Graph, c: Compiled, px: Pixel): number[] {
  const h = c.cuts['darkroom.H']!;
  if (h.op === 'print.expose') return px.x.get(h.id)!;
  const a = h.args as Record<string, any>;
  const M = (id?: string): number => (id === undefined ? 1 : px.m.get(id)!);
  const out = [0, 0, 0];
  lightH({
    xMain: px.x.get(h.inputs[0]!)!, wMain: a['mainAmount'] * M(a['mainMask']),
    terms: a['terms'].map((t: any) => ({ role: t.role, x: px.x.get(t.image)!, w: t.amount * M(t.mask) })),
    densities: a['densities'].map((t: any) => ({ d: px.d.get(t.image)!, w: t.amount * M(t.mask) })),
    filters: a['filters'].map((t: any) => ({ logH: t.logH, w: t.amount * M(t.mask) })),
    preflash: a['preflash'].map((t: any) => ({ fraction: t.fraction, w: t.amount * M(t.mask) })),
  }, out);
  void g;
  return out;
}

interface Case {
  entries: { id: Id; kind: 'dodge' | 'burn' | 'flash'; stops: number; mask: boolean; through: 'base' | 'open' }[];
  dms: { id: Id; gamma: number }[];
  lights: number[];
  preflash: number;
  /** per-pixel samples, keyed later by node */
  xMain: number[];
  xs: number[][];
  ms: number[];
  ds: number[];
}

const gen = (r: Rng): Case => {
  const n = r.int(0, 4);
  const kinds = ['dodge', 'burn', 'flash'] as const;
  const xMain = [r.range(-1.5, 1), r.range(-1.5, 1), r.range(-1.5, 1)];
  return {
    entries: Array.from({ length: n }, (_, i) => ({ id: `e${i}`, kind: kinds[r.int(0, 2)]!, stops: Math.round(r.range(0.1, 2) * 100) / 100, mask: r.next() < 0.6, through: r.next() < 0.5 ? 'base' as const : 'open' as const })),
    dms: Array.from({ length: r.int(0, 2) }, (_, i) => ({ id: `d${i}`, gamma: Math.round(r.range(0.1, 0.9) * 100) / 100 })),
    lights: [r.range(-0.3, 0.3), r.range(-0.3, 0.3), r.range(-0.3, 0.3)],
    preflash: r.next() < 0.5 ? 0 : Math.round(r.range(0.005, 0.1) * 1000) / 1000,
    xMain,
    // a term's exposure is below the main's (a dodge holds back part of it); a few dodges can still exceed it
    xs: Array.from({ length: n }, () => xMain.map((x) => x + r.range(-2.5, -0.4))),
    ms: Array.from({ length: n }, () => r.next()),
    ds: [r.range(0, 0.6), r.range(0, 0.6)],
  };
};

function build(c: Case) {
  let doc = scanDoc();
  const ms = c.entries.filter((e) => e.mask).map((e) => insert('masks', `m_${e.id}`, maskOf([[`c_${e.id}`, linear(0, 3 + Number(e.id.slice(1)))]])));
  const es = c.entries.map((e) => push('darkroom', e.id, L(e.kind, { stops: e.stops, ...(e.kind === 'flash' ? { through: e.through } : {}) }, { mask: e.mask ? `m_${e.id}` : null })));
  const ds = c.dms.map((d) => push('darkroom', d.id, L('densityMask', { gamma: d.gamma, radius_um: 300, polarity: 'positive' })));
  const extra = [set('lights.params.logH', c.lights), ...(c.preflash ? [push('darkroom', 'pf', L('preflash', { fraction: c.preflash }))] : [])];
  doc = edit(doc, [...ms, ...es, ...ds, ...extra]).doc;
  return doc;
}

describe('the light law', () => {
  it('equals today\'s combinePixel · print.lights · print.preflash for random stacks (n = 300)', () => {
    let compared = 0;
    const lawLight = law('light-law = combinePixel', gen, (c) => {
      const g = graph();
      const doc = build(c);
      const comp = compile(doc, g);
      // the same sample for the same node: entries → their print.expose nodes; masks → their mask nodes
      const px: Pixel = { x: new Map(), m: new Map(), d: new Map() };
      px.x.set(comp.cuts['darkroom.main']!.id, c.xMain);
      const extra = c.entries.map((e, i) => {
        const node = comp.entries[e.id]![0]!;
        if (!px.x.has(node)) px.x.set(node, c.xs[i]!);
        return { kind: e.kind, x: px.x.get(node)!, m: e.mask ? c.ms[i]! : 1, node };
      });
      const h = comp.cuts['darkroom.H']!;
      if (h.op === 'print.combine') {
        // the terms are the entries in stack order (all enabled, amount 1)
        const a = h.args as Record<string, any>;
        a['terms'].forEach((t: any, i: number) => { if (t.mask) px.m.set(t.mask, c.ms[i]!); });
        a['densities'].forEach((t: any, j: number) => px.d.set(t.image, c.ds[j]!));
      }
      const tMain = 10;
      // the seconds rule the law applies (relative to the main time) gives distinct nodes for distinct times
      for (const e of c.entries) if (termSeconds(e.kind, { stops: e.stops }, tMain) <= 0) return 'non-positive seconds';
      const want = today(c.xMain, extra.map((e) => ({ kind: e.kind, x: e.x, m: e.m })), c.dms.map((_, j) => c.ds[j]!), c.lights, c.preflash);
      // below the floor both print paper white; the floor sits before the lights today and last in the law
      const raw = [0, 1, 2].map((k) => {
        let H = 10 ** c.xMain[k]!;
        for (const e of extra) if (e.kind === 'dodge') H -= e.m * 10 ** e.x[k]!;
        return H;
      });
      if (raw.some((H) => H < 1e-6)) return true;
      const got = evalDarkroom(g, comp, px);
      compared++;
      for (let k = 0; k < 3; k++) if (Math.abs(got[k]! - want[k]!) > 1e-12) return `layer ${k}: law ${got[k]} vs today ${want[k]}`;
      return true;
    }, { justifies: 'the darkroom pictures do not change at the cut-off: the goldens are today\'s combinePixel', source: 'design §22, §37; core print/exposures.ts' });
    const [rep] = check([lawLight], { n: 300, seed: 7 });
    expect(rep, `${rep?.message} ${JSON.stringify(rep?.shrunk)}`).toMatchObject({ ok: true });
    expect(compared).toBeGreaterThan(250);
  });

  it('is order-free: permuting the darkroom stack gives the same combine node', () => {
    const r = mulberry32(3);
    for (let i = 0; i < 30; i++) {
      const c = gen(r);
      if (c.entries.length < 2) continue;
      const doc = build(c);
      const st = doc.stages.darkroom.stack;
      const perm = Coll.of([...Coll.entries(st)].reverse());
      const doc2 = { ...doc, stages: { ...doc.stages, darkroom: { ...doc.stages.darkroom, stack: perm } } };
      const g = graph();
      // the law's sum is order-free; the node lists terms in stack order, so compare the evaluated law instead
      const a = compile(doc, g).cuts['darkroom.H']!;
      const b = compile(doc2, g).cuts['darkroom.H']!;
      const sorted = (n: typeof a): string => JSON.stringify(Object.fromEntries(Object.entries(n.args).map(([k, v]) => [k, Array.isArray(v) ? [...v].map((x) => JSON.stringify(x)).sort() : v])));
      expect(sorted(b)).toBe(sorted(a));
    }
    expect(getLaw('light').order).toBe('free');
  });

  it('amount scales light and density; groups multiply amounts and masks; amount 0 and disabled give no term', () => {
    const g = graph();
    let doc = edit(scanDoc(), [
      insert('masks', 'sky', maskOf([['c1', linear()]])),
      insert('masks', 'card', maskOf([['c2', linear(1, 7)]])),
      push('darkroom', 'cardg', G('card', [['b1', L('burn', { stops: 1 }, { amount: 0.5, mask: 'sky' })], ['dm', L('densityMask', { gamma: 0.4, radius_um: 300, polarity: 'positive' }, { amount: 0.5 })]], { amount: 2, mask: 'card' })),
      push('darkroom', 'off', L('burn', { stops: 2 }, { enabled: false })),
      push('darkroom', 'zero', L('burn', { stops: 3 }, { amount: 0 })),
      push('darkroom', 'pf0', L('preflash', { fraction: 0 })),
    ]).doc;
    const c = compile(doc, g);
    const a = c.cuts['darkroom.H']!.args as Record<string, any>;
    expect(a['terms']).toHaveLength(1);
    expect(a['terms'][0]).toMatchObject({ role: 'burn', amount: 1 });
    expect(a['densities']).toEqual([expect.objectContaining({ amount: 1 })]);
    expect(a['filters']).toEqual([]); // the printer lights at 0 are the identity
    expect(a['preflash']).toEqual([]);
    // the burn's coverage is the product of the card's mask and its own (one mask.combine intersect node)
    const m = g.get(a['terms'][0].mask)!;
    expect(m.op).toBe('mask.combine');
    expect(m.args).toMatchObject({ mode: 'intersect', amount: 1 });
    // the main exposure alone: no combine node at all
    doc = edit(doc, [{ op: 'remove', id: 'cardg' }]).doc;
    expect(compile(doc, g).cuts['darkroom.H']!.op).toBe('print.expose');
    expect(compile(doc, g).cuts['darkroom.H']!.id).toBe(compile(doc, g).cuts['darkroom.main']!.id);
  });

  it('the main exposure\'s amount and mask enter the combine; a split is a burn with its own pack', () => {
    const g = graph();
    const doc = edit(scanDoc(), [
      set('main.amount', 0.5),
      push('darkroom', 'split', L('burn', { time_s: 5, filtration: { c: 0, m: 40, y: 0 } })),
    ]).doc;
    const c = compile(doc, g);
    const h = c.cuts['darkroom.H']!;
    expect(h.args).toMatchObject({ mainAmount: 0.5 });
    const burn = g.get((h.args['terms'] as any)[0].image)!;
    expect(burn.op).toBe('print.expose');
    expect(burn.args).toMatchObject({ time_s: 5, filtration: { c: 0, m: 40, y: 0 }, fstop: 8, magnification: 8, aimView: 'D50' });
  });
});
