/* eslint-disable @typescript-eslint/no-explicit-any */
// cb.looks (CHB-021 guide §8.5; CHB-037 P7: looks are links): apply inserts the look's link entries as one batch per
// eval (plan, by the agent) and re-applying adjusts; what-ifs are views of the document with the link (their cuts
// compile with the session's links); diff; bake; presets and rolls from the host's link data; the read-only refusal.
import { describe, expect, it } from 'vitest';
import { defineLook, linkMedium, linksOf, makePreset, type Document, type Roll } from '@chromobench/contract';
import { Coll, set, transaction } from '@chromobench/values';
import { DslSession, memoryHistory, type DslLinks } from '../src/index.ts';
import { frameLog, m1Doc, setup, FRAME } from './helpers.ts';

/** the eval's return value: the code returns JSON.stringify(x); the YAML result is that one string */
const val = (r: { yaml: string; error?: unknown }): any => {
  const line = r.yaml.split('\n')[0]!;
  const s = line.startsWith("'") ? line.slice(1, -1).replace(/''/g, "'") : line.startsWith('"') ? JSON.parse(line) : line;
  return JSON.parse(s);
};

defineLook({ name: 'test-camera-only', version: 1, label: 'Camera only', group: 'Test', doc: '', params: {}, stages: ['darkroom'], kinds: ['digital-raw'], fn: () => ({ stacks: { darkroom: Coll.empty() } }) });

async function twoFrames(links?: () => DslLinks) {
  const s0 = await setup();
  let log = frameLog({ a: m1Doc(s0.source, 'a'), b: m1Doc(s0.source, 'b') });
  // frame b has been worked on by the photographer
  log = log.commit({ doc: 'b', tx: transaction({ id: 'u1', label: 'Grade', by: 'user', mutations: [set('stages.darkroom.medium.grade', 2.5)] }) });
  const history = memoryHistory(log, 'ask');
  const session = await DslSession.create({ engine: s0.engine, history, frames: { a: { source: s0.source }, b: { source: s0.source } }, ...(links ? { links } : {}) });
  return { session, history, run: (code: string) => session.eval({ code, frame: 'a' }) };
}

describe('cb.looks in the DSL: looks are links', () => {
  it('apply: the look\'s link on every frame, one batch by the agent; the receipt names its layers', async () => {
    const { run, history } = await twoFrames();
    const r = await run(`return JSON.stringify(cb.looks.apply('warm print', { warmth: 4 }, { amount: 0.5, to: 'all', why: 'warmer' }))`);
    expect(r.error, r.yaml).toBeUndefined();
    const v = val(r);
    expect(v).toMatchObject({ status: 'queued', frames: 2, label: 'Look: Warm print at 50 %', link: 'warm-print1' });
    expect(v.layers).toEqual(['darkroom: filter {"logH":[-0.05,0,0.05]} × 0.5 (light and density)']);
    const p = history.log().pending();
    expect(p.map((e) => [e.doc, e.tx.batch, e.tx.by, e.tx.label, e.why])).toEqual([['a', 'eval-1', 'agent', 'Look: Warm print at 50 %', 'warmer'], ['b', 'eval-1', 'agent', 'Look: Warm print at 50 %', 'warmer']]);
    expect(p[0]!.tx.source).toMatchObject({ kind: 'agent', eval: 'eval-1', looks: ['Warm print'] });
    expect(p[0]!.tx.mutations[0]).toMatchObject({ op: 'insert', coll: 'stages.darkroom.stack', id: 'warm-print1-darkroom', item: { kind: 'link', ref: { look: 'warm-print', version: 1 }, amount: 0.5 } });
    // approving one entry approves the batch; the frames' own lights are untouched
    history.change((l) => l.approve(p[0]!.seq));
    expect(history.log().pending()).toEqual([]);
    const b = history.log().doc<Document>('b');
    expect(linksOf(b).map((l) => [l.id, l.entry.amount])).toEqual([['warm-print1-darkroom', 0.5]]);
    expect(b.stages.darkroom.stack.items['lights']).toMatchObject({ params: { logH: [0, 0, 0] } });
    // applying again adjusts the frame's link (no second copy)
    const r2 = await run(`return JSON.stringify(cb.looks.apply('warm-print', { warmth: 6 }, { amount: 0.5 }))`);
    expect(val(r2).frames).toBe(1);
    expect(history.log().pending()[0]!.tx.mutations).toEqual([{ op: 'set', path: 'warm-print1-darkroom.params', value: { warmth: 6, density: 0 } }]);
  });

  it('where: a predicate on the frame (x => x.unedited) keeps the untouched frames', async () => {
    const { run, history } = await twoFrames();
    const r = await run(`return JSON.stringify(cb.looks.apply('more contrast', {}, { to: 'all', where: (x) => x.unedited }))`);
    expect(val(r).frames).toBe(1);
    expect(history.log().pending().map((e) => e.doc)).toEqual(['a']);
  });

  it('a look for another kind of frame skips it with the reason; unknown looks and bad params are errors', async () => {
    const { run } = await twoFrames();
    const r = await run(`return JSON.stringify(cb.looks.apply('test-camera-only'))`);
    expect(val(r)).toMatchObject({ frames: 0, skipped: [{ frame: 'a', why: 'Camera only is for a camera file' }] });
    const bad = await run(`cb.looks.apply('warm', {})`);
    expect(bad.error?.code).toBe('E_UNKNOWN_OPTION');
    expect((await run(`cb.looks.apply('warm print', { warmth: 12 })`)).error?.code).toBe('E_ARG_RANGE');
    expect((await run(`cb.looks.apply('warm print', {}, { amount: 3 })`)).error?.code).toBe('E_ARG_RANGE');
  });

  it('whatIf: a view of the document with the link; its cuts measure; cb.looks.diff of frame vs what-if', async () => {
    const s = await setup();
    const r = await s.run(`const v = cb.looks.whatIf(frame, 'warm print', { warmth: 8 })
const [a, b] = await Promise.all([frame.print().measure.densitometer({ at: [48, 32] }), v.print().measure.densitometer({ at: [48, 32] })])
return JSON.stringify({ diff: v.diff, same: cb.looks.diff(frame, v), bluer: b.D[2] - a.D[2], lights: v.get('lights.params.logH') })`);
    expect(r.error, r.yaml).toBeUndefined();
    const v = val(r);
    expect(v.diff).toEqual(['darkroom: filter {"logH":[-0.1,0,0.1]}']);
    expect(v.same).toEqual(['insert warm-print1-darkroom into stages.darkroom.stack (look Warm print)']);
    expect(v.lights).toEqual([0, 0, 0]);
    expect(v.bluer).toBeGreaterThan(0); // more blue light: more yellow dye, higher blue density
    expect(s.history.log().pending()).toEqual([]);
  });

  it('bake: the frame\'s link becomes its plain group (queued like an edit)', async () => {
    const s = await setup({ mode: 'auto' });
    expect((await s.run(`cb.looks.apply('crisp warm')`)).error).toBeUndefined();
    const r = await s.run(`return JSON.stringify(cb.looks.bake('crisp-warm1'))`);
    expect(r.error, r.yaml).toBeUndefined();
    const d = s.history.log().doc<Document>(FRAME);
    expect(linksOf(d)).toEqual([]);
    expect(d.stages.print.stack.items['crisp-warm1-print']).toMatchObject({ kind: 'group', source: { kind: 'baked', link: 'crisp-warm1' } });
  });

  it('presets and rolls come from the host\'s link data: list names them; a frame on a roll compiles', async () => {
    const preset = makePreset('p-sky', 'Sky burn', { darkroom: Coll.of([['b', { kind: 'layer', op: 'burn', params: { stops: 0.5 }, name: 'Burn', enabled: true, amount: 1, mask: null, blend: 'normal', source: { kind: 'user' } }]]) as any });
    let roll: Roll | null = null;
    const links = (): DslLinks => ({ presets: { 'p-sky': preset }, ...(roll ? { rolls: { r1: roll } } : {}) });
    const s = await setup({ links, doc: (d) => d });
    roll = { id: 'r1', label: 'Roll', frames: [FRAME], media: { scan: { scanner: 'xt5-rgb-led', stock: 'kodak_gold_200', format: '135', flat: null, openGate: null, flare: 0, baseT: null } }, stacks: {}, analysis: null, reference: null, match: null, status: 'set-up' };
    const listed = val(await s.run(`return JSON.stringify(cb.looks.list().map((l) => l.kind + ' ' + l.name))`));
    expect(listed).toEqual(expect.arrayContaining(['look warm-print', 'look crisp-warm', 'preset p-sky']));
    // link the frame's scan to the roll (the studio does this on New Roll), then read and print it through the link
    s.history.change((l) => l.commit({ doc: FRAME, tx: transaction({ id: 'r', label: 'Roll', by: 'auto', mutations: [linkMedium(l.doc<Document>(FRAME), 'scan', { roll: 'r1' }, roll!.media.scan!)] }) }));
    const r = await s.run(`const d = await frame.print().measure.densitometer({ at: [48, 32] }); return JSON.stringify({ stock: frame.get('stages.scan.medium.overrides.stock') ?? null, read: frame.get('stages.scan.medium.stock'), scanner: frame.get('stages.scan.medium.scanner'), D: d.D.length })`);
    expect(r.error, r.yaml).toBeUndefined();
    // the frame's own stock differs from the roll's: it is kept as its override (divergence), and it is what prints
    // frame.get of a linked medium field reads through the link: the override where there is one, else the roll's
    expect(val(r)).toEqual({ stock: 'kodak_portra_400', read: 'kodak_portra_400', scanner: 'xt5-rgb-led', D: 3 });
    expect(r.context?.frame).toContain('kodak_portra_400');
    const p = await s.run(`return JSON.stringify(cb.looks.apply('p-sky'))`);
    expect(val(p)).toMatchObject({ frames: 1, layers: ['darkroom: burn {"stops":0.5}'] });
  });

  it('read-only: cb.looks.apply is refused', async () => {
    const s = await setup({ mode: 'read-only' });
    expect((await s.run(`cb.looks.apply('warm print')`)).error?.code).toBe('E_READONLY');
  });
});
