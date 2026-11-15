// The document log: one history (design §26). Unit tests for each operation, then properties over random sequences
// of edit, undo, redo, propose, approve, reject and merge on several documents.
import { describe, expect, it } from 'vitest';
import {
  applyMutation, applyTransaction, canonicalJSON, Coll, document, equal, insert, Log, move, plan, remove, set, transaction,
  tryTransaction, ValueError, type Change, type Edit, type LogEntry, type Mutation, type TxOptions,
} from '../src/index.ts';
import { randomDoc, randomMutation, type Gen } from './gen.ts';
import { rng } from './rng.ts';

let clock = 0;
const now = (): number => ++clock;

const frame = (time = 10) => document({
  title: 'frame',
  main: { time, grade: 2 },
  stack: Coll.of([['burn', { amount: 0.5, mask: null }]]),
});

type Frame = ReturnType<typeof frame>;

/** "time is positive", per mutation; "grade ≤ 5" on the whole document */
const RULES: TxOptions = {
  validate: (c: Change) => {
    const t = (c.after as { main?: { time?: number } }).main?.time;
    if (typeof t === 'number' && t <= 0) throw new ValueError({ code: 'E_ARG_RANGE', message: 'time must be positive', path: 'main.time' });
  },
  validateTransaction: ({ after }) => {
    if ((after as { main: { grade: number } }).main.grade > 5) throw new ValueError({ code: 'E_ARG_RANGE', message: 'grade ≤ 5' });
  },
};

const tx = (id: string, mutations: Mutation[], by: 'user' | 'agent' | 'auto' = 'user', label = id) => transaction({ id, label, by, mutations });
const edit = (doc: string, t: ReturnType<typeof tx>): Edit => ({ doc, tx: t });
const code = (f: () => unknown): string | undefined => {
  try {
    f();
  } catch (e) {
    return (e as ValueError).code;
  }
  return undefined;
};
const base = () => Log.create({ rules: { frame: RULES }, now }).open('f1', frame(), { kind: 'frame' }).open('f2', frame(12), { kind: 'frame' });

describe('the log', () => {
  it('commit, undo, redo; a new edit after undo drops the redo tail from the journal', () => {
    let log = base();
    log = log.commit(edit('f1', tx('t1', [set('main.time', 11)])));
    log = log.commit(edit('f1', tx('t2', [set('main.time', 12)])));
    expect(log.doc<{ main: { time: number } }>('f1').main.time).toBe(12);
    log = log.undo();
    expect(log.doc<{ main: { time: number } }>('f1').main.time).toBe(11);
    expect(log.canRedo).toBe(true);
    expect(log.redo().doc<{ main: { time: number } }>('f1').main.time).toBe(12);
    log = log.commit(edit('f1', tx('t3', [set('main.grade', 3)])));
    expect(log.canRedo).toBe(false);
    expect(log.entries.map((e) => e.tx.id)).toEqual(['t1', 't3']);
    expect(log.undo().undo().doc('f1')).toEqual(log.initial('f1'));
    expect(log.undo().undo().undo().cursor).toBe(0); // nothing more to undo: the same log
  });

  it('rules: a refused edit leaves the log as it was; unknown kinds and documents are refused', () => {
    const log = base();
    expect(code(() => log.commit(edit('f1', tx('bad', [set('main.time', -1)]))))).toBe('E_ARG_RANGE');
    expect(code(() => log.commit(edit('f1', tx('bad', [set('main.grade', 9)]))))).toBe('E_ARG_RANGE');
    // a transaction may break a whole-document rule midway
    expect(log.commit(edit('f1', tx('ok', [set('main.grade', 9), set('main.grade', 4)]))).doc<{ main: { grade: number } }>('f1').main.grade).toBe(4);
    expect(log.entries).toHaveLength(0);
    expect(code(() => log.commit(edit('nope', tx('x', [set('title', 'y')]))))).toBe('E_DOCUMENT');
    expect(code(() => log.open('f3', frame(), { kind: 'scan' }))).toBe('E_DOCUMENT');
    expect(code(() => log.open('f1', frame()))).toBe('E_DOCUMENT');
  });

  it('proposals: pending until approved (one step) or rejected; a stale proposal is refused unless forced', () => {
    let log = base().propose(edit('f1', tx('a1', [set('main.time', 14)], 'agent')), { why: 'brighter' });
    const p = log.last!;
    expect(p.tx.status).toBe('pending');
    expect(p.why).toBe('brighter');
    expect(log.doc<{ main: { time: number } }>('f1').main.time).toBe(10);
    expect(code(() => log.propose(edit('f1', tx('a0', [set('main.time', 0)], 'agent'))))).toBe('E_ARG_RANGE');
    // the photographer changes the same field meanwhile: the proposal would undo to 11, not 10
    const meanwhile = log.commit(edit('f1', tx('u1', [set('main.time', 11)])));
    expect(code(() => meanwhile.approve(p.seq))).toBe('E_STALE');
    const forced = meanwhile.approve(p.seq, { force: true });
    expect(forced.entry(p.seq)).toMatchObject({ approvedBy: 'user', tx: { status: 'applied', inverses: [{ op: 'set', path: 'main.time', value: 11 }] } });
    // an unrelated change does not make it stale
    log = log.commit(edit('f1', tx('u2', [set('main.grade', 3)]))).approve(p.seq);
    expect(log.doc<{ main: { time: number; grade: number } }>('f1').main).toEqual({ time: 14, grade: 3 });
    expect(log.steps.at(-1)).toEqual({ seqs: [p.seq], label: 'a1' });
    expect(log.undo().doc<{ main: { time: number } }>('f1').main.time).toBe(10);
    expect(code(() => log.approve(p.seq))).toBe('E_MUTATION'); // not pending any more
    const r = base().propose(edit('f2', tx('a2', [set('title', 'x')], 'agent')));
    expect(r.reject(r.last!.seq).last!.tx.status).toBe('rejected');
  });

  it('a batch across documents: one step, undone as one; proposed, it is approved or rejected as one', () => {
    const log = base();
    const b = plan(log.targets<Frame>(), (d) => [set('main.time', d.main.time + 1)], { id: 'look-1', label: 'Look: warm', by: 'user', source: { kind: 'look', name: 'warm', version: 1 } });
    expect(b.edits.map((e) => [e.doc, e.tx.id, e.tx.batch, e.tx.label])).toEqual([['f1', 'look-1:f1', 'look-1', 'Look: warm'], ['f2', 'look-1:f2', 'look-1', 'Look: warm']]);
    const c = log.commit(b);
    expect(c.steps).toEqual([{ seqs: [1, 2], label: 'Look: warm', batch: 'look-1' }]);
    expect(c.docsOf(c.steps[0]!)).toEqual(['f1', 'f2']);
    const u = c.undo();
    expect([u.doc('f1'), u.doc('f2')]).toEqual([log.doc('f1'), log.doc('f2')]);
    // proposed by the agent: approving one entry approves the batch
    const a = plan(log.targets(), () => [set('main.grade', 4)], { id: 'agent-7', label: 'Harder', by: 'agent' });
    const p = log.propose(a, { why: 'flat prints' });
    expect(p.pending().map((e) => e.doc)).toEqual(['f1', 'f2']);
    const ok = p.approve(p.pending()[0]!.seq);
    expect(ok.pending()).toEqual([]);
    expect(ok.steps).toHaveLength(1);
    expect(ok.doc<{ main: { grade: number } }>('f2').main.grade).toBe(4);
    expect(p.reject({ batch: 'agent-7' }).entries.map((e) => e.tx.status)).toEqual(['rejected', 'rejected']);
    // a batch whose transaction is not in it is refused
    expect(code(() => log.commit({ ...b, id: 'other' }))).toBe('E_MUTATION');
  });

  it('plan: the rules refuse a document → skipped; a builder that throws → skipped; nothing to do → left alone', () => {
    const log = base().open('f3', frame(1), { kind: 'frame' }).open('f4', frame(), { kind: 'frame' });
    const b = plan(log.targets<Frame>(), (d, id) => {
      if (id === 'f4') throw new Error('no scan');
      if (id === 'f2') return null;
      return [set('main.time', d.main.time - 5)];
    }, { id: 'b', label: 'Shorter', by: 'user' });
    expect(b.edits.map((e) => e.doc)).toEqual(['f1']);
    expect(b.skipped.map((s) => [s.doc, (s.error as Error).message])).toEqual([['f3', 'E_ARG_RANGE: time must be positive'], ['f4', 'no scan']]);
    // without rules (plain targets) nothing is checked
    expect(plan([{ doc: 'x', value: { main: { time: 1 } } }], () => [set('main.time', -4)], { id: 'p', label: 'p', by: 'auto' }).edits).toHaveLength(1);
    expect(code(() => plan(log.targets(['f1']), () => tx('t', [set('title', 'y')], 'agent'), { id: 'p', label: 'p', by: 'user' }))).toBe('E_MUTATION');
  });

  it('why: who last changed a value, and from where; the trail starts at the opening', () => {
    let log = Log.create({ now }).open('f1', frame(), { by: 'auto', source: { kind: 'ingest' } });
    log = log.commit(edit('f1', transaction({ id: 'u', label: 'Time', by: 'user', source: { kind: 'gesture', control: 'time' }, mutations: [set('main.time', 11)] })));
    log = log.commit(edit('f1', tx('g', [set('main.grade', 3)])));
    log = log.propose(edit('f1', tx('a', [set('main.time', 12)], 'agent')));
    log = log.approve(log.last!.seq);
    expect(log.trail('f1', 'main.time').map((w) => [w.seq, w.by, w.value])).toEqual([[0, 'auto', 10], [1, 'user', 11], [3, 'agent', 12]]);
    expect(log.why('f1', 'main.time')).toMatchObject({ by: 'agent', approvedBy: 'user', tx: 'a' });
    expect(log.why('f1', 'main.grade')).toMatchObject({ by: 'user', label: 'g' });
    expect(log.why('f1', 'title')).toMatchObject({ seq: 0, source: { kind: 'ingest' }, value: 'frame' });
    // ids anchor paths: the burn's amount keeps its history through a move
    log = log.commit(edit('f1', tx('m', [set('burn.amount', 0.7)]))).commit(edit('f1', tx('mv', [insert('stack', 'dodge', { amount: 1 }), move('burn', { at: 1 })])));
    expect(log.why('f1', 'burn.amount')).toMatchObject({ tx: 'm', value: 0.7 });
    expect(log.why('f1', 'dodge')).toMatchObject({ tx: 'mv' });
    expect(log.undo().why('f1', 'dodge')).toMatchObject({ seq: 0, value: undefined });
  });

  it('drafts: a gesture previews without logging and commits its net change as one transaction', () => {
    const log = base();
    let d = log.draft('f1');
    for (const v of [10.5, 11, 12.5, 13]) d = d.set('main.time', v);
    expect(d.value).toMatchObject({ main: { time: 13 } });
    expect(log.doc('f1')).toBe(d.base);
    expect(d.mutations()).toEqual([{ op: 'set', path: 'main.time', value: 13 }]);
    const c = log.commit(d.edit({ id: 'g1', label: 'Time', source: { kind: 'gesture' } }));
    expect(c.entries).toHaveLength(1);
    expect(c.last!.tx).toMatchObject({ by: 'user', mutations: [{ op: 'set', path: 'main.time', value: 13 }], inverses: [{ op: 'set', path: 'main.time', value: 10 }] });
    // dragged back where it started: no change
    expect(d.set('main.time', 10).changed).toBe(false);
    expect(d.reset().value).toBe(d.base);
    // a draft checks each change with the document's per-mutation rule
    expect(code(() => d.set('main.time', -2))).toBe('E_ARG_RANGE');
    // any function of the document (a store's writes), its net change computed
    const u = log.draft<ReturnType<typeof frame>>('f1').update((x) => ({ ...x, stack: Coll.insert(x.stack, 'dodge', { amount: 1, mask: null }) }));
    expect(u.mutations()).toEqual([{ op: 'insert', coll: 'stack', id: 'dodge', item: { amount: 1, mask: null }, at: 1 }]);
  });

  it('merge: nudges fold into one step as the net change; nudged back to the start, the step goes', () => {
    let log = base().commit(edit('f1', tx('t0', [set('main.grade', 3)])));
    log = log.commit(edit('f1', tx('n1', [set('main.time', 10.1)], 'user', 'Time')));
    log = log.commit(edit('f1', tx('n2', [set('main.time', 10.2)], 'user', 'Time')), { merge: true });
    log = log.commit(edit('f1', tx('n3', [set('main.time', 10.3)], 'user', 'Time')), { merge: true });
    expect(log.steps).toHaveLength(2);
    expect(log.last!.tx).toMatchObject({ id: 'n1', mutations: [{ op: 'set', path: 'main.time', value: 10.3 }], inverses: [{ op: 'set', path: 'main.time', value: 10 }] });
    expect(log.undo().doc<{ main: { time: number } }>('f1').main.time).toBe(10);
    const back = log.commit(edit('f1', tx('n4', [set('main.time', 10)], 'user', 'Time')), { merge: true });
    expect(back.steps).toHaveLength(1);
    expect(back.entries.map((e) => e.tx.id)).toEqual(['t0']);
    // another document, or after an undo: a new step
    expect(log.commit(edit('f2', tx('o', [set('main.time', 1)])), { merge: true }).steps).toHaveLength(3);
    expect(log.undo().commit(edit('f1', tx('o', [set('main.time', 1)])), { merge: true }).steps).toHaveLength(2);
  });

  it('close: a document and its entries leave; the other documents keep their history', () => {
    let log = base().commit(edit('f1', tx('a', [set('main.time', 11)])));
    log = log.commit(plan(log.targets(), () => [set('main.grade', 1)], { id: 'b', label: 'b', by: 'user' }));
    log = log.commit(edit('f1', tx('c', [set('main.time', 13)]))).undo();
    const c = log.close('f1');
    expect(c.ids()).toEqual(['f2']);
    expect(c.steps).toEqual([{ seqs: [3], label: 'b', batch: 'b' }]);
    expect(c.cursor).toBe(1);
    expect(c.undo().doc('f2')).toEqual(log.initial('f2'));
  });

  it('serialises and loads to the same log; a tampered or foreign log is refused', () => {
    let log = base().commit(edit('f1', tx('a', [set('main.time', 11), insert('stack', 'd', { amount: 1 })])));
    log = log.propose(edit('f2', tx('p', [set('main.grade', 5)], 'agent')), { why: 'w' }).commit(edit('f2', tx('b', [remove('burn')]))).undo();
    const data = JSON.parse(JSON.stringify(log)) as ReturnType<Log['toJSON']>;
    const back = Log.load(data, { rules: { frame: RULES }, now });
    expect(canonicalJSON(back.toJSON())).toBe(canonicalJSON(log.toJSON()));
    expect(equal(back.doc('f1'), log.doc('f1'))).toBe(true);
    expect(back.redo().doc('f2')).toEqual(log.redo().doc('f2'));
    expect(back.approve(back.pending()[0]!.seq).doc<{ main: { grade: number } }>('f2').main.grade).toBe(5);
    expect(code(() => Log.load({ ...data, version: 2 } as never))).toBe('E_DOCUMENT');
    const tampered = structuredClone(data) as unknown as { entries: { tx: { inverses: { value: number }[] } }[] };
    tampered.entries[0]!.tx.inverses[0]!.value = 99;
    expect(code(() => Log.load(tampered as never))).toBe('E_DOCUMENT');
  });
});

// ── properties ───────────────────────────────────────────────────────────

/** A random transaction that applies to d (1–3 mutations). */
function randomTx(g: Gen, d: object, id: string, by: 'user' | 'agent'): ReturnType<typeof tx> | null {
  const ms: Mutation[] = [];
  let cur = d;
  for (let tries = 0; tries < 10 && ms.length < 1 + g.r.int(3); tries++) {
    const m = randomMutation(g, cur);
    try {
      cur = applyMutation(cur, m).doc;
      ms.push(m);
    } catch (e) {
      if (!(e instanceof ValueError)) throw e;
    }
  }
  return ms.length ? tx(id, ms, by) : null;
}

/** state = the fold of the applied entries in effect, per document */
function expectFold(log: Log): void {
  for (const id of log.ids()) {
    let d = log.initial(id);
    for (const e of log.inEffect(id)) d = applyTransaction(d, e.tx).doc;
    expect(canonicalJSON(log.doc(id))).toBe(canonicalJSON(d));
  }
}

describe('the log, over random sequences', () => {
  it('state is the fold up to the cursor; undo everything gives the initial documents; save → load is the same log; stale is refused', () => {
    const counts: Record<string, number> = {};
    for (let seed = 1; seed <= 40; seed++) {
      const g: Gen = { r: rng(seed), next: 0 };
      const docs = ['a', 'b', 'c'];
      let log = docs.reduce((l, id) => l.open(id, randomDoc(g)), Log.create({ now }));
      let n = 0;
      for (let i = 0; i < 60; i++) {
        const k = g.r.int(10);
        const id = g.r.pick(docs);
        let op = '';
        if (k <= 2) {
          const t = randomTx(g, log.doc(id), `t${++n}`, 'user');
          if (t) {
            const merge = g.r.chance(0.2);
            const before = log;
            log = log.commit(edit(id, t), { merge });
            op = merge ? 'merge' : 'commit';
            if (!merge) expect(log.canRedo).toBe(false);
            if (!merge) expect(log.entries.length).toBe(before.entries.length - before.steps.slice(before.cursor).flatMap((s) => s.seqs).length + 1);
          }
        } else if (k === 3) {
          const b = plan(log.targets(docs.filter(() => g.r.chance(0.7))), (d, doc) => randomTx(g, d, `b${n}-${doc}`, 'user'), { id: `batch${++n}`, label: 'batch', by: 'user' });
          const before = log.cursor;
          log = log.commit(b);
          if (b.edits.length) expect(log.cursor).toBe(before + 1);
          op = 'batch';
        } else if (k === 4) {
          log = log.undo();
          op = 'undo';
        } else if (k === 5) {
          log = log.redo();
          op = 'redo';
        } else if (k === 6) {
          const t = randomTx(g, log.doc(id), `p${++n}`, 'agent');
          if (t) log = log.propose(edit(id, t));
          if (g.r.chance(0.3)) {
            const b = plan(log.targets(docs), (d, doc) => randomTx(g, d, `pb${n}-${doc}`, 'agent'), { id: `pbatch${++n}`, label: 'agent batch', by: 'agent' });
            log = log.propose(b);
          }
          op = 'propose';
        } else if (k <= 8) {
          const p = log.pending();
          if (p.length) {
            const e: LogEntry = g.r.pick(p);
            try {
              log = log.approve(e.seq);
              op = 'approve';
              expect(log.entry(e.seq)!.tx.status).toBe('applied');
            } catch (err) {
              if (!(err instanceof ValueError)) throw err;
              // refused: either stale (the recomputed inverses differ) or no longer applicable
              if (err.code === 'E_STALE') {
                const group = e.tx.batch === undefined ? [e] : log.pending().filter((x) => x.tx.batch === e.tx.batch);
                const values = new Map(log.ids().map((x) => [x, log.doc(x)]));
                const stale = group.some((x) => {
                  const r = applyTransaction(values.get(x.doc)!, { ...x.tx, inverses: [] });
                  values.set(x.doc, r.doc);
                  return !equal(r.tx.inverses, x.tx.inverses);
                });
                expect(stale).toBe(true);
                op = 'stale';
              } else op = 'refused';
              log = log.reject(e.seq);
            }
          }
        } else {
          const p = log.pending();
          if (p.length) {
            log = log.reject(g.r.pick(p).seq);
            op = 'reject';
          }
        }
        if (op) counts[op] = (counts[op] ?? 0) + 1;
        expectFold(log);
      }
      // save → load → the same log
      const back = Log.load(JSON.parse(JSON.stringify(log)), { now });
      expect(canonicalJSON(back.toJSON())).toBe(canonicalJSON(log.toJSON()));
      for (const id of docs) expect(canonicalJSON(back.doc(id))).toBe(canonicalJSON(log.doc(id)));
      // undo everything → the initial documents, exactly
      let u = log;
      while (u.canUndo) u = u.undo();
      for (const id of docs) expect(canonicalJSON(u.doc(id))).toBe(canonicalJSON(log.initial(id)));
      // and redo everything → every step applied
      let end = log;
      while (end.canRedo) end = end.redo();
      while (u.canRedo) u = u.redo();
      for (const id of docs) expect(canonicalJSON(u.doc(id))).toBe(canonicalJSON(end.doc(id)));
    }
    for (const op of ['commit', 'merge', 'batch', 'undo', 'redo', 'propose', 'approve', 'stale', 'reject']) expect(counts[op] ?? 0, op).toBeGreaterThan(5);
  });

  it('a proposal made stale by a change to what it would undo is always refused', () => {
    let stale = 0;
    for (let seed = 500; seed < 560; seed++) {
      const g: Gen = { r: rng(seed), next: 0 };
      let log = Log.create({ now }).open('a', randomDoc(g));
      const t = randomTx(g, log.doc('a'), 'p', 'agent');
      if (!t) continue;
      log = log.propose(edit('a', t));
      const p = log.last!;
      // change exactly what the first set of the proposal would restore
      const s = p.tx.mutations.find((m) => m.op === 'set');
      if (!s || s.op !== 'set') continue;
      const touched = log.commit(edit('a', tx('u', [set(s.path, 'changed meanwhile')])));
      // unless an earlier mutation of the proposal makes the path's old value irrelevant, it is stale
      const r = tryTransaction(touched.doc('a'), { ...p.tx, inverses: [] });
      if (!r.ok) {
        expect(code(() => touched.approve(p.seq))).toBeDefined(); // it no longer applies at all
        continue;
      }
      if (equal(r.tx.inverses, p.tx.inverses)) continue;
      expect(code(() => touched.approve(p.seq))).toBe('E_STALE');
      stale++;
    }
    expect(stale).toBeGreaterThan(10);
  });
});
