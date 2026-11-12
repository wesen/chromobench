/* eslint-disable @typescript-eslint/no-explicit-any */
// cb.looks (CHB-021 guide §8.5): the agent's looks — apply as one proposal batch per eval (LoggedMutation.batch on
// every frame), what-if handles that measure, diff, the read-only refusal, no provider.
import { describe, expect, it } from 'vitest';
import { EditLog, defaultRecipe, sha256Hex } from '@chromobench/contract';
import { makeM1Tiff, MockEngine } from '@chromobench/engine-mock';
import { DslSession } from '../src/index.ts';
import { setup, FRAME } from './helpers.ts';
import { testLooks } from './looks-provider.ts';

/** the eval's return value: the code returns JSON.stringify(x); the YAML result is that one string */
const val = (r: { yaml: string; error?: unknown }): any => {
  const line = r.yaml.split('\n')[0]!;
  const s = line.startsWith("'") ? line.slice(1, -1).replace(/''/g, "'") : line.startsWith('"') ? JSON.parse(line) : line;
  return JSON.parse(s);
};

async function twoFrames(o: { looks?: boolean } = {}) {
  const engine = new MockEngine();
  const bytes = makeM1Tiff();
  const source = await engine.open({ kind: 'file', sha256: sha256Hex(bytes), bytes });
  let t = 1000;
  const logs = ['a', 'b'].map((id) => EditLog.create(defaultRecipe('negative-scan', { sha256: source.sha256 }, { frame: id }), { mode: 'ask', now: () => t++ }));
  // frame b has been worked on by the photographer
  logs[1]!.apply([{ op: 'set', path: 'print.grade', value: 2.5 }], 'user', 'Grade');
  const session = await DslSession.create({ engine, frames: { a: { log: logs[0]!, source }, b: { log: logs[1]!, source } }, ...(o.looks === false ? {} : { looks: testLooks() }) });
  return { session, logs, run: (code: string) => session.eval({ code, frame: 'a' }) };
}

describe('cb.looks in the DSL', () => {
  it('apply: one batch over the frames; proposed with the batch id; the receipt has the diff', async () => {
    const { run, logs } = await twoFrames();
    const r = await run(`return JSON.stringify(cb.looks.apply('warm print', { warmth: 4 }, { amount: 0.5, to: 'all', why: 'warmer' }))`);
    expect(r.error).toBeUndefined();
    const v = val(r) as { id: string; frames: number; diff: string[]; status: string };
    expect(v.status).toBe('queued');
    expect(v.frames).toBe(2);
    for (const log of logs) {
      const p = log.pending();
      expect(p.length).toBe(1);
      expect(p[0]!.batch).toBe(v.id);
      expect(p[0]!.why).toBe('warmer');
      expect((p[0]!.m as { value: number[] }).value[2]).toBeCloseTo(0.025, 9); // +2 pt B at 50 %
    }
    // approve the whole batch on one frame (contract 0.3 selector)
    expect(Array.isArray(logs[0]!.approve({ batch: v.id }))).toBe(false);
  });
  it('where: a predicate on the frame (x => x.unedited) keeps the untouched frames', async () => {
    const { run, logs } = await twoFrames();
    const r = await run(`return JSON.stringify(cb.looks.apply('grade 3', {}, { to: 'all', where: (x) => x.unedited }))`);
    expect(val(r).frames).toBe(1);
    expect(logs[0]!.pending().length).toBe(1);
    expect(logs[1]!.pending().length).toBe(0);
  });
  it('requires: a film look on a scan is skipped with the reason; unknown looks and bad params are errors', async () => {
    const { run } = await twoFrames();
    const r = await run(`return JSON.stringify(cb.looks.apply('Portra 400 on Endura'))`);
    expect(val(r)).toMatchObject({ frames: 0, skipped: [{ frame: 'a', why: 'This look needs a digital RAW' }] });
    expect((await run(`cb.looks.apply('warm', {})`)).error?.code).toBe('E_UNKNOWN_OPTION');
    expect((await run(`cb.looks.apply('warm print', { warmth: 12 })`)).error?.code).toBe('E_ARG_RANGE');
    expect((await run(`cb.looks.apply('warm print', {}, { amount: 3 })`)).error?.code).toBe('E_ARG_RANGE');
  });
  it('whatIf: a print handle to measure, and its diff; cb.looks.diff of frame vs what-if', async () => {
    const s = await setup();
    const r = await s.run(`const v = cb.looks.whatIf(frame, 'warm print', { warmth: 8 })
const [a, b] = await Promise.all([frame.print().measure.densitometer({ at: [48, 32] }), v.print().measure.densitometer({ at: [48, 32] })])
return JSON.stringify({ diff: v.diff, same: cb.looks.diff(frame, v), bluer: b.D[2] - a.D[2] })`);
    expect(r.error).toBeUndefined();
    const v = val(r) as { diff: string[]; same: string[]; bluer: number };
    expect(v.diff).toEqual(v.same);
    expect(v.diff[0]).toMatch(/^print\.lights\.logH/);
    expect(v.bluer).toBeGreaterThan(0); // more blue light: more yellow dye, higher blue density
    expect(s.log.pending()).toEqual([]);
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
