// Guide §5.8 / §9 mutation tests: DR-3 (an eval's edits are one unit, submitted at the end),
// modes, stale approvals, and the frame.print() ↔ compile() cache identity.
import { describe, expect, it } from 'vitest';
import { compile, Graph, type FrameRecipe } from '@chromobench/contract';
import { setup, type Setup } from './helpers.ts';

const printId = (s: Setup, r: FrameRecipe): string => {
  const g = new Graph();
  g.registerSource(s.session.graph.source(r.source.sha256)!);
  const top = compile(r, g);
  return g.closure(top.id).length ? idOfOp(g, top.id, 'view.adapt') : '';
};
function idOfOp(g: Graph, top: string, op: string): string {
  let found = '';
  const seen = new Set<string>();
  const visit = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const n = g.get(id)!;
    n.inputs.forEach(visit);
    if (n.op === op) found = id;
  };
  visit(top);
  return found;
}

describe('ask mode', () => {
  it('an eval with two edits proposes one pending unit by agent; state unchanged until approval', async () => {
    const s = await setup({ mode: 'ask' });
    const h0 = s.log.stateHash;
    const r = await s.run(`frame.edit({ 'print.lights.logH': [0.1, 0, 0] }, { why: 'warmer' })
frame.edit({ 'print.enlarger.time_s': 12.6 }, { why: 'darker' })
return frame.recipe.print.enlarger.time_s`);
    expect(r.error).toBeUndefined();
    expect(r.yaml.split('\n')[0]).toBe('10'); // the eval reads its eval-start snapshot
    expect(r.mutations).toHaveLength(2);
    expect(r.mutations.every((m) => m.by === 'agent' && m.status === 'pending' && m.tx === 'eval-1')).toBe(true);
    expect(r.mutations[0]!.m).toMatchObject({ op: 'set', path: 'print.lights.logH', expect: [0, 0, 0] });
    expect(r.mutations[0]!.why).toBe('warmer; darker');
    expect(s.log.stateHash).toBe(h0);
    expect(r.yaml).toContain("edits:\n  - 'e1 pending: set print.lights.logH = [0.1, 0, 0] (was [0, 0, 0]); why: warmer'\n  - 'e2 pending: set print.enlarger.time_s = 12.6 (was 10); why: darker'");
    expect(r.context.changed).toEqual(['print.lights.logH', 'print.enlarger.time_s']);
    expect(r.context.proposals).toEqual(['eval-1 pending']);
    const unit = s.log.approve(r.mutations.map((m) => m.seq));
    expect(Array.isArray(unit)).toBe(false);
    expect(s.log.stateHash).not.toBe(h0);
    const next = await s.run('return frame.recipe.print.enlarger.time_s');
    expect(next.yaml.split('\n')[0]).toBe('12.6');
    expect(next.context.proposals).toEqual(['eval-1 approved']);
    expect(s.log.why('print.lights.logH').at(-1)).toMatchObject({ by: 'agent', approvedBy: 'user' });
    // one undo removes both edits of the eval
    s.log.undo();
    expect(s.log.stateHash).toBe(h0);
    s.session.dispose();
  });

  it('a stale approval is refused (E_STALE) and the next context says so', async () => {
    const s = await setup({ mode: 'ask' });
    const r = await s.run("frame.edit({ 'print.lights.logH': [0.1, 0, 0] })");
    s.log.apply([{ op: 'set', path: 'print.lights.logH', value: [0, 0.05, 0] }], 'user', 'nudge green');
    const res = s.log.approve(r.mutations.map((m) => m.seq));
    expect(Array.isArray(res) && res[0]!.code).toBe('E_STALE');
    const next = await s.run('return 1');
    expect(next.context.proposals).toEqual(['eval-1 stale, not applied (the photographer changed print.lights.logH)']);
    s.session.dispose();
  });

  it('receipt.preview shows the edit; frame.print() keeps the eval-start state', async () => {
    const s = await setup({ mode: 'ask' });
    const r = await s.run(`const before = await frame.print().measure.densitometer({ at: [48, 32] })
const e = frame.edit({ 'print.enlarger.time_s': 20 })
const now = await frame.print().measure.densitometer({ at: [48, 32] })
const prev = await e.preview.measure.densitometer({ at: [48, 32] })
return { same: now.D.join() === before.D.join(), darker: prev.D.every((d, k) => d > now.D[k]), status: e.status, id: e.id }`);
    expect(r.yaml).toMatch(/^same: true\ndarker: true\nstatus: queued\nid: e1/);
    s.session.dispose();
  });
});

describe('auto and failures', () => {
  it('auto mode applies the eval as one unit; one undo removes it', async () => {
    const s = await setup({ mode: 'auto' });
    const h0 = s.log.stateHash;
    const r = await s.run("frame.edit({ 'print.grade': 3 })\nframe.edit({ 'print.preflash': 0.01 })");
    expect(r.mutations.map((m) => m.status)).toEqual(['applied', 'applied']);
    expect(s.log.units).toHaveLength(1);
    expect(s.log.stateHash).not.toBe(h0);
    expect(r.yaml).toContain("'e1 applied: set print.grade = 3 (was 2)'");
    s.log.undo();
    expect(s.log.stateHash).toBe(h0);
    s.session.dispose();
  });

  it('a failing eval submits nothing and warns EDITS_DROPPED', async () => {
    const s = await setup({ mode: 'auto' });
    const h0 = s.log.stateHash;
    const r = await s.run("frame.edit({ 'print.grade': 3 })\nthrow new Error('oops')");
    expect(r.error?.code).toBe('Error');
    expect(r.mutations).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toContain('EDITS_DROPPED');
    expect(s.log.stateHash).toBe(h0);
    expect(s.log.entries).toHaveLength(0);
    s.session.dispose();
  });

  it('an invalid edit throws at once (E_ARG_RANGE) and is not queued', async () => {
    const s = await setup();
    const r = await s.run("frame.edit({ 'print.lights.logH': [4, 0, 0] })");
    expect(r.error?.code).toBe('E_ARG_RANGE');
    expect(r.error?.fix).toBe('[0.1, 0, 0]');
    expect(s.log.entries).toHaveLength(0);
    s.session.dispose();
  });

  it('guest code cannot choose the author: every logged mutation is by agent', async () => {
    const s = await setup({ mode: 'auto' });
    const r = await s.run("frame.edit({ 'print.grade': 3 }, { why: 'by: user', by: 'user' })");
    expect(r.mutations.every((m) => m.by === 'agent')).toBe(true);
    s.session.dispose();
  });
});

const unq = (x: string): string => x.replace(/^'|'$/g, '');

describe('cache identity: frame.print() is the view.adapt node of compile(recipe)', () => {
  it('default recipe, with preflash, and with a dodge exposure through a mask', async () => {
    const s = await setup({ mode: 'auto' });
    const id0 = unq((await s.run('return frame.print().id')).yaml.split('\n')[0]!);
    expect(id0).toBe(printId(s, s.log.committed));
    await s.run("frame.edit({ 'print.preflash': 0.02 })");
    const id1 = unq((await s.run('return frame.print().id')).yaml.split('\n')[0]!);
    expect(id1).toBe(printId(s, s.log.committed));
    expect(id1).not.toBe(id0);
    const e6 = await s.run(`const sky = frame.source().mask.gradient({ from: [48, 0], to: [48, 40] }).mask.feather({ radius_px: 8 })
const e = frame.edit.exposure.add({ id: 'sky', kind: 'dodge', mask: sky, stops: 0.5 }, { why: 'hold the sky back' })
return e.mutations.map(m => m.op)`);
    expect(e6.error, e6.yaml).toBeUndefined();
    expect(e6.yaml.split('\n')[0]).toBe('[mask.set, exposure.add]');
    expect(s.log.committed.print.exposures.map((x) => x.id)).toEqual(['sky']);
    const id2 = unq((await s.run('return frame.print().id')).yaml.split('\n')[0]!);
    expect(id2).toBe(printId(s, s.log.committed));
    // neg.print() with no options builds the same chain as frame.print()
    const same = await s.run('return frame.negative().print() === frame.print()');
    expect(same.yaml.split('\n')[0]).toBe('true');
    s.session.dispose();
  });
});
