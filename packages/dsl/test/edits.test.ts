// Guide §5.8 / §9 edit tests on contract 1.0: DR-3 (an eval's edits are one submission, at its end), the modes at
// the log's door (ask → propose, auto → commit, read-only → refused), stale proposals, the photographer changing the
// document while an eval runs, batches over frames (plan), and the cache identity of cuts with the one compiler.
import { describe, expect, it, vi } from 'vitest';
import { compile, edit, Graph, type Document } from '@chromobench/contract';
import { set, transaction, type Mutation } from '@chromobench/values';
import { DslSession, memoryHistory } from '../src/index.ts';
import { FRAME, frameLog, m1Doc, setup, type Setup } from './helpers.ts';

const first = (yaml: string): string => yaml.split('\n')[0]!.replace(/^'|'$/g, '');
const userEdit = (s: Setup, ...ms: Mutation[]): void =>
  s.history.change((l) => l.commit({ doc: FRAME, tx: transaction({ id: `u${l.entries.length + 1}`, label: 'photographer', by: 'user', mutations: ms }) }));

describe('ask mode', () => {
  it('an eval with two proposals submits one pending transaction by the agent; documents unchanged until approval', async () => {
    const s = await setup({ mode: 'ask' });
    const d0 = s.history.log().doc(FRAME);
    const r = await s.run(`frame.propose(set('lights.params.logH', [0.1, 0, 0]), { why: 'warmer' })
frame.propose(set('main.params.time_s', 12.6), { why: 'darker' })
return frame.get('main.params.time_s')`);
    expect(r.error, r.yaml).toBeUndefined();
    expect(first(r.yaml)).toBe('10'); // the eval reads the document as it started
    expect(r.transactions).toHaveLength(1);
    const e = r.transactions[0]!;
    expect(e).toMatchObject({ doc: FRAME, why: 'warmer; darker', tx: { id: 'eval-1', by: 'agent', status: 'pending', label: 'agent eval-1', source: { kind: 'agent', eval: 'eval-1', why: 'warmer; darker' } } });
    expect(e.tx.mutations).toEqual([set('lights.params.logH', [0.1, 0, 0]), set('main.params.time_s', 12.6)]);
    expect(s.history.log().doc(FRAME)).toBe(d0);
    expect(r.yaml).toContain("edits:\n  - 'e1 pending: set lights.params.logH = [0.1, 0, 0] (was [0, 0, 0]); why: warmer'\n  - 'e2 pending: set main.params.time_s = 12.6 (was 10); why: darker'");
    expect(r.context.changed).toEqual(['lights.params.logH', 'main.params.time_s']);
    expect(r.context.proposals).toEqual(['eval-1 pending']);
    s.history.change((l) => l.approve(e.seq));
    const next = await s.run("return frame.get('main.params.time_s')");
    expect(first(next.yaml)).toBe('12.6');
    expect(next.context.proposals).toEqual(['eval-1 approved']);
    expect(s.history.log().why(FRAME, 'lights.params.logH')).toMatchObject({ by: 'agent', approvedBy: 'user', label: 'agent eval-1' });
    // one undo removes the whole eval
    s.history.change((l) => l.undo());
    expect(s.history.log().doc(FRAME)).toEqual(d0);
    expect((await s.run('return 1')).context.proposals).toEqual(['eval-1 undone']);
    s.session.dispose();
  });

  it('a proposal the photographer overtakes is stale: approval refused (E_STALE), the context says what changed', async () => {
    const s = await setup({ mode: 'ask' });
    const r = await s.run("frame.propose(set('lights.params.logH', [0.1, 0, 0]))");
    userEdit(s, set('lights.params.logH', [0, 0.05, 0]));
    expect(() => s.history.change((l) => l.approve(r.transactions[0]!.seq))).toThrow(/stale/);
    const next = await s.run('return 1');
    expect(next.context.proposals).toEqual(['eval-1 stale, not applied (the photographer changed lights.params.logH)']);
    s.history.change((l) => l.reject(r.transactions[0]!.seq));
    expect((await s.run('return 1')).context.proposals).toEqual(['eval-1 rejected']);
    s.session.dispose();
  });

  it('the receipt previews the edit; frame keeps the state the eval started with; pending() lists the proposal', async () => {
    const s = await setup({ mode: 'ask' });
    const r = await s.run(`const before = await frame.print().measure.densitometer({ at: [48, 32] })
const e = frame.propose(set('main.params.time_s', 20))
const now = await frame.print().measure.densitometer({ at: [48, 32] })
const prev = await e.preview.print().measure.densitometer({ at: [48, 32] })
return { same: now.D.join() === before.D.join(), darker: prev.D.every((d, k) => d > now.D[k]), status: e.status, id: e.id, changes: e.changes }`);
    expect(r.yaml).toMatch(/^same: true\ndarker: true\nstatus: queued\nid: e1\nchanges: \[set main\.params\.time_s = 20 \(was 10\)\]/);
    const p = await s.run('return frame.pending()');
    expect(p.yaml).toMatch(/^- seq: 1\n {2}tx: eval-1\n {2}label: agent eval-1\n {2}by: agent\n {2}changes: \[set main\.params\.time_s = 20 \(was 10\)\]/);
    s.session.dispose();
  });

  it('a mask and a dodge through it: values built with the contract builders, the agent as their source', async () => {
    const s = await setup({ mode: 'ask' });
    const r = await s.run(`const sky = mask('Sky').add('c1', 'linear', { from: [48, 0], to: [48, 40] }).feather(0.4)
const dodge = layer('dodge', { stops: 0.5 }).mask('sky').name('Hold the sky')
const e = frame.propose([insert('masks', 'sky', sky), insert('stages.darkroom.stack', 'd1', dodge)], { why: 'the sky prints 0.4 D denser than the foreground' })
const top = [48, 5]
const a = await frame.print().measure.densitometer({ at: top })
const b = await e.preview.print().measure.densitometer({ at: top })
return { lighter: b.D.every((d, k) => d < a.D[k]), dodge: dodge.data }`);
    expect(r.error, r.yaml).toBeUndefined();
    expect(r.yaml).toMatch(/^lighter: true/);
    const tx = r.transactions[0]!.tx;
    expect(tx.mutations.map((m) => m.op)).toEqual(['insert', 'insert']);
    expect(tx.mutations[1]).toMatchObject({ op: 'insert', coll: 'stages.darkroom.stack', id: 'd1', item: { kind: 'layer', op: 'dodge', params: { stops: 0.5 }, mask: 'sky', name: 'Hold the sky', source: { kind: 'agent', eval: 'eval-1' } } });
    s.session.dispose();
  });
});

describe('auto mode and failures', () => {
  it('auto mode commits the eval as one step; one undo removes it', async () => {
    const s = await setup({ mode: 'auto' });
    const d0 = s.history.log().doc(FRAME);
    const r = await s.run("frame.propose(set('stages.darkroom.medium.grade', 3))\nframe.propose(insert('stages.darkroom.stack', 'f1', layer('flash', { time_s: 0.5, through: 'open' })))");
    expect(r.transactions.map((e) => e.tx.status)).toEqual(['applied']);
    expect(s.history.log().steps).toHaveLength(1);
    expect(r.yaml).toContain("'e1 applied: set stages.darkroom.medium.grade = 3 (was 2)'");
    expect(s.history.log().doc<Document>(FRAME).stages.darkroom.medium).toMatchObject({ grade: 3 });
    s.history.change((l) => l.undo());
    expect(s.history.log().doc(FRAME)).toEqual(d0);
    s.session.dispose();
  });

  it('a failing eval submits nothing and warns EDITS_DROPPED', async () => {
    const s = await setup({ mode: 'auto' });
    const r = await s.run("frame.propose(set('stages.darkroom.medium.grade', 3))\nthrow new Error('oops')");
    expect(r.error?.code).toBe('Error');
    expect(r.transactions).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toContain('EDITS_DROPPED');
    expect(s.history.log().entries).toHaveLength(0);
    s.session.dispose();
  });

  it('an invalid change throws at once (E_ARG_RANGE) and is not queued', async () => {
    const s = await setup();
    const r = await s.run("frame.propose(set('lights.params.logH', [4, 0, 0]))");
    expect(r.error?.code).toBe('E_ARG_RANGE');
    expect(s.history.log().entries).toHaveLength(0);
    s.session.dispose();
  });

  it('guest code cannot choose the author', async () => {
    const s = await setup({ mode: 'auto' });
    const r = await s.run("frame.propose(set('stages.darkroom.medium.grade', 3), { why: 'by: user', by: 'user' })");
    expect(r.transactions.every((e) => e.tx.by === 'agent')).toBe(true);
    s.session.dispose();
  });

  it('auto mode: a document the photographer changed while the eval ran gets a proposal, not a commit', async () => {
    const s = await setup({ mode: 'auto' });
    const measure = s.engine.measure.bind(s.engine);
    vi.spyOn(s.engine, 'measure').mockImplementationOnce(async (n, o) => {
      userEdit(s, set('main.params.time_s', 11)); // the photographer moves the slider while the agent measures
      return measure(n, o);
    });
    const r = await s.run("const d = await frame.print().measure.densitometer({ at: [48, 32] })\nframe.propose(set('main.params.time_s', 12.6))\nreturn d.D");
    expect(r.transactions.map((e) => e.tx.status)).toEqual(['pending']);
    expect(r.warnings.find((w) => w.code === 'CONFLICT')?.message).toMatch(/frame_m1 changed while the eval ran/);
    expect(s.history.log().doc<Document>(FRAME).stages.darkroom.stack.items['main']).toMatchObject({ params: { time_s: 11 } });
    s.session.dispose();
  });

  it('an untouched path is not stale: auto mode still commits when the photographer changed something else', async () => {
    const s = await setup({ mode: 'auto' });
    const measure = s.engine.measure.bind(s.engine);
    vi.spyOn(s.engine, 'measure').mockImplementationOnce(async (n, o) => {
      userEdit(s, set('stages.darkroom.medium.grade', 2.5));
      return measure(n, o);
    });
    const r = await s.run("await frame.print().measure.stats()\nframe.propose(set('main.params.time_s', 12.6))");
    expect(r.transactions.map((e) => e.tx.status)).toEqual(['applied']);
    s.session.dispose();
  });

  it('read-only while the eval ran: the door refuses, the result says so, the log is untouched', async () => {
    const s = await setup({ mode: 'ask' });
    const measure = s.engine.measure.bind(s.engine);
    vi.spyOn(s.engine, 'measure').mockImplementationOnce(async (n, o) => {
      s.history.setMode('read-only');
      return measure(n, o);
    });
    const r = await s.run("frame.propose(set('main.params.time_s', 12.6))\nawait frame.print().measure.stats()");
    expect(r.transactions).toEqual([]);
    expect(r.warnings.find((w) => w.code === 'CONFLICT')?.message).toMatch(/E_READONLY/);
    expect(r.yaml).toContain("'e1 not submitted: set main.params.time_s = 12.6 (was 10)'");
    expect(s.history.log().entries).toHaveLength(0);
    s.session.dispose();
  });
});

describe('several frames: one batch (plan)', () => {
  it('edits of two frames in one eval are one batch by the agent; approving one entry approves both', async () => {
    const s0 = await setup();
    const docs = { a: m1Doc(s0.source, 'a'), b: m1Doc(s0.source, 'b') };
    const history = memoryHistory(frameLog(docs), 'ask');
    const session = await DslSession.create({ engine: s0.engine, history, frames: { a: { source: s0.source }, b: { source: s0.source } }, txPrefix: 'chat' });
    const r = await session.eval({ code: "frame.propose(set('main.params.time_s', 12))\ncb.frame('b').propose(set('main.params.time_s', 14), { why: 'b is denser' })", frame: 'a' });
    expect(r.error, r.yaml).toBeUndefined();
    expect(r.transactions.map((e) => [e.doc, e.tx.id, e.tx.batch, e.tx.status])).toEqual([['a', 'chat-eval-1:a', 'chat-eval-1', 'pending'], ['b', 'chat-eval-1:b', 'chat-eval-1', 'pending']]);
    history.change((l) => l.approve(r.transactions[0]!.seq));
    expect(history.log().doc<Document>('b').stages.darkroom.stack.items['main']).toMatchObject({ params: { time_s: 14 } });
    expect(history.log().steps).toHaveLength(1);
    session.dispose();
    s0.session.dispose();
  });
});

describe('cache identity: a cut is the node of compile(doc)', () => {
  const cutId = (s: Setup, doc: Document, name: 'print' | 'finished' | 'display' | 'darkroom.H'): string => {
    const g = new Graph();
    g.registerSource(s.source);
    return compile(doc, g).cuts[name]!.id;
  };

  it('the frame, a what-if and an applied edit name the nodes the one compiler builds', async () => {
    const s = await setup({ mode: 'auto' });
    const doc = s.history.log().doc<Document>(FRAME);
    const now = await s.run("return [frame.print().id, frame.finished().id, frame.display().id, frame.cut('darkroom.H').id].join(' ')");
    expect(first(now.yaml).split(' ')).toEqual([cutId(s, doc, 'print'), cutId(s, doc, 'finished'), cutId(s, doc, 'display'), cutId(s, doc, 'darkroom.H')]);
    const what = await s.run("return frame.with(set('main.params.time_s', 14)).print().id");
    expect(first(what.yaml)).toBe(cutId(s, edit(doc, [set('main.params.time_s', 14)]).doc, 'print'));
    await s.run("frame.propose([insert('masks', 'sky', mask('Sky').add('c1', 'linear', { from: [48, 0], to: [48, 40] }).feather(0.4)), insert('stages.darkroom.stack', 'd1', layer('dodge', { stops: 0.5 }).mask('sky'))])");
    const after = s.history.log().doc<Document>(FRAME);
    expect(first((await s.run('return frame.print().id')).yaml)).toBe(cutId(s, after, 'print'));
    // the same what-if twice is the same handle; a disabled layer compiles to the graph without it
    expect(first((await s.run("return frame.with(set('main.params.time_s', 14)).print() === frame.with(set('main.params.time_s', 14)).print()")).yaml)).toBe('true');
    expect(first((await s.run("return frame.with(set('d1.enabled', false)).print().id")).yaml)).toBe(cutId(s, doc, 'print'));
    s.session.dispose();
  });
});

