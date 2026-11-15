/* eslint-disable @typescript-eslint/no-explicit-any */
// cb.looks (CHB-021 guide §8.5; contract 1.0): the studio's named looks until links (P7) — apply as one batch per
// eval (plan, by the agent), what-ifs that are views of the document with the look, diff, the read-only refusal,
// no provider.
import { describe, expect, it } from 'vitest';
import { type Document } from '@chromobench/contract';
import { set, transaction } from '@chromobench/values';
import { DslSession, memoryHistory } from '../src/index.ts';
import { frameLog, m1Doc, setup, FRAME } from './helpers.ts';
import { testLooks } from './looks-provider.ts';

/** the eval's return value: the code returns JSON.stringify(x); the YAML result is that one string */
const val = (r: { yaml: string; error?: unknown }): any => {
  const line = r.yaml.split('\n')[0]!;
  const s = line.startsWith("'") ? line.slice(1, -1).replace(/''/g, "'") : line.startsWith('"') ? JSON.parse(line) : line;
  return JSON.parse(s);
};

async function twoFrames(o: { looks?: boolean } = {}) {
  const s0 = await setup();
  let log = frameLog({ a: m1Doc(s0.source, 'a'), b: m1Doc(s0.source, 'b') });
  // frame b has been worked on by the photographer
  log = log.commit({ doc: 'b', tx: transaction({ id: 'u1', label: 'Grade', by: 'user', mutations: [set('stages.darkroom.medium.grade', 2.5)] }) });
  const history = memoryHistory(log, 'ask');
  const session = await DslSession.create({ engine: s0.engine, history, frames: { a: { source: s0.source }, b: { source: s0.source } }, ...(o.looks === false ? {} : { looks: testLooks() }) });
  return { session, history, run: (code: string) => session.eval({ code, frame: 'a' }) };
}

describe('cb.looks in the DSL', () => {
  it('apply: one batch over the frames, by the agent; the receipt has the diff', async () => {
    const { run, history } = await twoFrames();
    const r = await run(`return JSON.stringify(cb.looks.apply('warm print', { warmth: 4 }, { amount: 0.5, to: 'all', why: 'warmer' }))`);
    expect(r.error, r.yaml).toBeUndefined();
    const v = val(r) as { frames: number; diff: string[]; status: string; label: string };
    expect(v).toMatchObject({ status: 'queued', frames: 2, label: 'Look: warm print at 50 %' });
    const p = history.log().pending();
    expect(p.map((e) => [e.doc, e.tx.batch, e.tx.by, e.tx.label, e.why])).toEqual([['a', 'eval-1', 'agent', 'Look: warm print at 50 %', 'warmer'], ['b', 'eval-1', 'agent', 'Look: warm print at 50 %', 'warmer']]);
    expect(p[0]!.tx.source).toMatchObject({ kind: 'agent', eval: 'eval-1', looks: ['warm print'] });
    expect((p[0]!.tx.mutations[0] as { value: number[] }).value[2]).toBeCloseTo(0.025, 9); // +2 pt B at 50 %
    // approving one entry approves the batch
    history.change((l) => l.approve(p[0]!.seq));
    expect(history.log().pending()).toEqual([]);
    expect(history.log().doc<Document>('b').stages.darkroom.stack.items['lights']).toMatchObject({ params: { logH: [-0.025, 0, 0.025] } });
  });

  it('where: a predicate on the frame (x => x.unedited) keeps the untouched frames', async () => {
    const { run, history } = await twoFrames();
    const r = await run(`return JSON.stringify(cb.looks.apply('grade 3', {}, { to: 'all', where: (x) => x.unedited }))`);
    expect(val(r).frames).toBe(1);
    expect(history.log().pending().map((e) => e.doc)).toEqual(['a']);
  });

  it('requires: a film look on a scan is skipped with the reason; unknown looks and bad params are errors', async () => {
    const { run } = await twoFrames();
    const r = await run(`return JSON.stringify(cb.looks.apply('Portra 400 on Endura'))`);
    expect(val(r)).toMatchObject({ frames: 0, skipped: [{ frame: 'a', why: 'This look needs a camera file' }] });
    expect((await run(`cb.looks.apply('warm', {})`)).error?.code).toBe('E_UNKNOWN_OPTION');
    expect((await run(`cb.looks.apply('warm print', { warmth: 12 })`)).error?.code).toBe('E_ARG_RANGE');
    expect((await run(`cb.looks.apply('warm print', {}, { amount: 3 })`)).error?.code).toBe('E_ARG_RANGE');
  });

  it('whatIf: a view of the document with the look; its cuts measure; cb.looks.diff of frame vs what-if', async () => {
    const s = await setup();
    const r = await s.run(`const v = cb.looks.whatIf(frame, 'warm print', { warmth: 8 })
const [a, b] = await Promise.all([frame.print().measure.densitometer({ at: [48, 32] }), v.print().measure.densitometer({ at: [48, 32] })])
return JSON.stringify({ diff: v.diff, same: cb.looks.diff(frame, v), bluer: b.D[2] - a.D[2], logH: v.get('lights.params.logH') })`);
    expect(r.error, r.yaml).toBeUndefined();
    const v = val(r) as { diff: string[]; same: string[]; bluer: number; logH: number[] };
    expect(v.diff).toEqual(v.same);
    expect(v.diff[0]).toMatch(/^lights\.params\.logH/);
    expect(v.logH).toEqual([-0.1, 0, 0.1]);
    expect(v.bluer).toBeGreaterThan(0); // more blue light: more yellow dye, higher blue density
    expect(s.history.log().pending()).toEqual([]);
  });

  it('read-only: cb.looks.apply is refused; no provider: E_NOT_IMPLEMENTED', async () => {
    const s = await setup({ mode: 'read-only' });
    expect((await s.run(`cb.looks.apply('warm print')`)).error?.code).toBe('E_READONLY');
    const { run } = await twoFrames({ looks: false });
    expect((await run(`cb.looks.list()`)).error?.code).toBe('E_NOT_IMPLEMENTED');
  });

  it('list names the looks with their parameters', async () => {
    const s = await setup();
    const r = await s.run(`return JSON.stringify(cb.looks.list().map((l) => l.name + ' ' + Object.keys(l.params).join(',')))`);
    expect(val(r)).toEqual(['warm print warmth', 'grade 3 ', 'Portra 400 on Endura ']);
    expect(FRAME).toBe('frame_m1');
  });
});
