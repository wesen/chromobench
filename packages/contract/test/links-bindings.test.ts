// Links (design §27) and bindings (design §28, §37): resolution, bake, the upstream-only rule, determinism.
import { describe, expect, it } from 'vitest';
import { Coll, set } from '@chromobench/values';
import {
  bakeLink, compile, compileMeasured, defineBinding, edit, resolveLinks, validateDocument, validateRoll,
  type Document, type Entry, type LinkEntry, type Roll,
} from '@chromobench/contract';
import { L, diagOf, graph, push, scanDoc } from './helpers.ts';

const roll: Roll = {
  id: 'r1', label: 'Roll 1', frames: ['f1'],
  media: { scan: { scanner: 'xt5-rgb-led', stock: 'kodak_gold_200', format: '135', umPerPx: 6, rebate: null, baseT: [0.8, 0.6, 0.4], flat: null, openGate: null, flare: 0 } },
  stacks: { darkroom: Coll.of<Entry>([['b1', L('burn', { stops: 0.5 })], ['f1', L('flash', { time_s: 0.2 })]]) },
  analysis: null, reference: null, match: null, status: 'set-up',
};
const rolls = (id: string): Roll | undefined => (id === 'r1' ? roll : undefined);
const link = (over: Partial<LinkEntry> = {}): LinkEntry => ({ kind: 'link', ref: { roll: 'r1' }, params: {}, overrides: {}, name: 'roll', enabled: true, amount: 1, mask: null, blend: 'pass', source: { kind: 'roll' }, ...over });

function linked(): Document {
  const d = scanDoc();
  return edit({ ...d, stages: { ...d.stages, scan: { ...d.stages.scan!, medium: { link: { roll: 'r1' }, overrides: { stock: 'kodak_portra_400' } } } } }, [push('darkroom', 'shared', link({ overrides: { 'b1.amount': 0.5 } }))]).doc;
}

describe('links', () => {
  it('a roll link gives a medium (with the frame\'s overrides) and a stack (with its overrides)', () => {
    const d = linked();
    expect(validateDocument(d)).toEqual([]);
    const r = resolveLinks(d, { rolls });
    expect(r.stages.scan!.medium).toMatchObject({ stock: 'kodak_portra_400', baseT: [0.8, 0.6, 0.4] });
    const g = r.stages.darkroom.stack.items['shared']!;
    expect(g.kind).toBe('group');
    expect(Coll.ids((g as { stack: Coll<Entry> }).stack)).toEqual(['shared--b1', 'shared--f1']);
    expect((g as { stack: Coll<Entry> }).stack.items['shared--b1']).toMatchObject({ amount: 0.5 });
    const c = compile(d, graph(), { links: { rolls } });
    expect(c.cuts.scan!.args).toMatchObject({ baseT: [0.8, 0.6, 0.4] });
    expect((c.cuts['darkroom.H']!.args['terms'] as unknown[]).length).toBe(2);
  });

  it('resolving a baked link equals resolving the link', () => {
    const d = linked();
    const g = graph();
    const baked = edit(d, [bakeLink(d, 'shared', 'darkroom', { rolls })]).doc;
    expect(baked.stages.darkroom.stack.items['shared']!.kind).toBe('group');
    expect(compile(baked, g, { links: { rolls } }).display.id).toBe(compile(d, g, { links: { rolls } }).display.id);
  });

  it('an unknown roll, a look without a resolver, or a bad override is E_LINK', () => {
    const d = linked();
    expect(diagOf(() => compile(d, graph(), { links: { rolls: () => undefined } })).code).toBe('E_LINK');
    expect(diagOf(() => compile(d, graph())).code).toBe('E_LINK');
    const look = edit(scanDoc(), [push('darkroom', 'warm', link({ ref: { look: 'warm-print', version: 2 } }))]).doc;
    expect(diagOf(() => compile(look, graph())).message).toMatch(/no resolver for look links/);
    const bad = edit(scanDoc(), [push('darkroom', 'shared', link({ overrides: { 'zz.amount': 1 } }))]).doc;
    expect(diagOf(() => compile(bad, graph(), { links: { rolls } })).code).toBe('E_LINK');
    expect(validateRoll(roll)).toEqual([]);
    expect(validateRoll({ ...roll, media: { nowhere: {} } })[0]?.code).toBe('E_DOCUMENT');
  });
});

let calls = 0;
defineBinding({
  name: 'test.lightsFromMean', version: 1, doc: 'lights that pull the mean of a cut towards 1',
  measure: { op: 'measure.stats' },
  fn: (args, { measured }) => {
    calls++;
    const mean = ((measured as { mean: number[] }).mean);
    return mean.map((m) => Math.round(((args['k'] as number) * (1 - m)) * 1000) / 1000);
  },
});
defineBinding({ name: 'test.const', version: 1, doc: 'a fact', fn: (args) => args['v'] as number });

describe('bindings', () => {
  const bound = (reads: string): Document => edit(scanDoc(), [set('lights.params.logH', { bind: 'test.lightsFromMean', version: 1, args: { k: 0.1 }, reads })]).doc;

  it('a binding reads only a cut before its stage: its own stage or a later one is an error', () => {
    expect(validateDocument(bound('negative'))).toEqual([]);
    expect(diagOf(() => bound('darkroom.H'))).toMatchObject({ code: 'E_BINDING', path: 'lights.params.logH' });
    expect(diagOf(() => bound('print')).code).toBe('E_BINDING');
    expect(diagOf(() => bound('darkroom.main')).code).toBe('E_BINDING'); // the main exposure depends on the darkroom's entries
    expect(diagOf(() => edit(scanDoc(), [set('lights.params.logH', { bind: 'nope', version: 1 })])).code).toBe('E_BINDING');
    expect(diagOf(() => edit(scanDoc(), [set('stages.darkroom.medium.magnification', { bind: 'test.const', version: 1, args: { v: 4 } })])).message).toMatch(/pitch/);
    expect(edit(scanDoc(), [set('stages.darkroom.medium.grade', { bind: 'test.const', version: 1, args: { v: 3 } })]).doc).toBeTruthy();
  });

  it('compile asks for the measurement; with it the value is used; results are deterministic and cached', async () => {
    const g = graph();
    const d = bound('negative');
    const need = diagOf(() => compile(d, g));
    expect(need.code).toBe('E_BINDING');
    const node = need.valid![0]!;
    expect(g.get(node)).toMatchObject({ op: 'measure.stats' });
    const a = compile(d, g, { measurements: { [node]: { mean: [0.5, 0.4, 0.3] } } });
    expect((a.cuts['darkroom.H']!.args['filters'] as any[])[0].logH).toEqual([0.05, 0.06, 0.07]);
    const before = calls;
    const b = compile(d, g, { measurements: { [node]: { mean: [0.5, 0.4, 0.3] } } });
    expect(b.display.id).toBe(a.display.id);
    expect(calls).toBe(before); // cached by the hash of its inputs
    const engine = { adopt: () => {}, measure: async () => ({ node, value: { mean: [0.5, 0.4, 0.3] }, warnings: [] }) };
    expect((await compileMeasured(d, g, engine)).display.id).toBe(a.display.id);
    // a fact-only binding in a medium
    const m = compile(edit(scanDoc(), [set('stages.darkroom.medium.grade', { bind: 'test.const', version: 1, args: { v: 3 } })]).doc, g);
    expect(m.cuts.print!.inputs.length).toBe(1);
    expect(g.closure(m.cuts.print!.id).find((n) => n.op === 'print.develop')!.args).toMatchObject({ grade: 3 });
  });
});
