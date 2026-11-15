// The store's tiers: prefix tiers, named drafts over the gesture, and the document tier as the values document log
// with mounted documents (a frame per document, under rules), batches across documents, proposals.
import { describe, expect, it } from 'vitest';
import { plan, set, transaction, ValueError, type Change, type TxOptions } from '@chromobench/values';
import { MAIN, Store, TxRefused } from '../../src/core/store.ts';
import { Cell, Scheduler } from '../../src/core/cells.ts';
import { manualClock } from '../../src/testing/index.ts';

describe('tiers by path prefix', () => {
  it('the longest listed prefix wins', () => {
    const s = new Store({ roll: { frames: [1, 2], contact: { cols: 6 } }, ui: {} }, { view: ['ui', 'roll.contact'] });
    expect(s.tierOf(['roll', 'frames'])).toBe('document');
    expect(s.tierOf(['roll', 'contact', 'cols'])).toBe('view');
    s.set('roll.contact.cols', 8);
    expect(s.log.steps.length).toBe(0);
    s.tx('Frames', t => void t.roll.frames.push(3));
    expect(s.log.steps.length).toBe(1);
    expect(s.snapshot('document')).toEqual({ roll: { frames: [1, 2, 3] } });
    expect(s.snapshot('view')).toEqual({ ui: {}, roll: { contact: { cols: 8 } } });
    // a document write of the whole slice keeps the view tier inside it
    s.tx('Roll', t => void (t.roll = { frames: [9], contact: { cols: 1 } }));
    expect(s.committed.roll).toEqual({ frames: [9], contact: { cols: 1 } });
    expect(s.log.doc(MAIN)).toEqual({ roll: { frames: [9] } });
    s.undo();
    expect(s.committed.roll).toEqual({ frames: [1, 2, 3], contact: { cols: 1 } });
    expect(() => s.writeView([{ path: ['roll', 'frames'], value: [] }])).toThrow(/document tier/);
  });
});

describe('drafts', () => {
  it('current = committed ⊕ named drafts ⊕ gesture; a tx overlapping the gesture cancels it, drafts stay', () => {
    const s = new Store({ dev: { a: 1, b: 2 } });
    const prop = s.draft('proposal:tx42').set('dev.a', 10);
    expect(s.current.dev.a).toBe(10);
    expect(s.committed.dev.a).toBe(1);
    s.preview('dev.a', 20); // the gesture is on top
    expect(s.current.dev.a).toBe(20);
    s.tx('B', t => void (t.dev.b = 3)); // no overlap: the gesture survives
    expect(s.previewing).toBe(true);
    s.tx('A', t => void (t.dev.a = 5)); // overlap: cancelled
    expect(s.previewing).toBe(false);
    expect(s.current.dev.a).toBe(10); // the draft still shows
    expect(prop.size).toBe(1);
    prop.commit('Approve');
    expect(s.committed.dev.a).toBe(10);
    expect(s.log.steps.map(st => st.label)).toEqual(['B', 'A', 'Approve']);
    expect(s.log.last!.tx.source).toEqual({ kind: 'draft', draft: 'proposal:tx42' });
    expect(s.drafts.size).toBe(0);
    s.draft('p2').set('dev.b', 99);
    s.draft('p2').drop();
    expect(s.current.dev.b).toBe(3);
    expect(s.draft('gesture')).toBe(s.gesture);
  });
});

/** a frame document's rules: time in (0, 100] per mutation; grade ≤ 5 on the whole document */
const FRAME_RULES: TxOptions = {
  validate: (c: Change) => {
    const t = (c.after as { time?: number }).time;
    if (typeof t === 'number' && (t <= 0 || t > 100)) throw new ValueError({ code: 'E_ARG_RANGE', message: `time ${t} is out of range`, path: 'time' });
  },
  validateTransaction: ({ after }) => {
    if ((after as { grade: number }).grade > 5) throw new ValueError({ code: 'E_ARG_RANGE', message: 'grade ≤ 5' });
  },
};

describe('mounted documents', () => {
  const setup = () => {
    const clock = manualClock();
    const s = new Store({ catalog: { f1: { flag: null as string | null } }, ui: {} }, { rules: { frame: FRAME_RULES }, mounts: [{ prefix: 'recipes', keyDepth: 1, kind: 'frame' }], now: () => clock.now() });
    s.open('f1', { time: 10, grade: 2 }, { at: 'recipes.f1', kind: 'frame' });
    s.open('f2', { time: 12, grade: 2 }, { at: ['recipes', 'f2'], kind: 'frame' });
    const sch = new Scheduler(s, clock);
    return { s, sch, clock };
  };

  it('a transaction over the main document and a frame: one notify, one step (a batch), one undo', () => {
    const { s, sch } = setup();
    expect(s.committed.recipes).toEqual({ f1: { time: 10, grade: 2 }, f2: { time: 12, grade: 2 } });
    expect(s.tierOf(['recipes', 'f1', 'time'])).toBe('document');
    let runs = 0;
    new Cell(s, (st: any) => `${st.catalog.f1.flag}/${st.recipes.f1.time}`, () => void runs++);
    let notifies = 0;
    s.on(() => void notifies++);
    s.tx('Pick and time', (t: any) => {
      t.catalog.f1.flag = 'pick';
      t.recipes.f1.time = 14;
    });
    expect(notifies).toBe(1);
    sch.flushSync();
    expect(runs).toBe(2);
    expect(s.committed.recipes.f1.time).toBe(14);
    expect(s.log.doc('f1')).toEqual({ time: 14, grade: 2 });
    const st = s.log.undoStep!;
    expect(s.log.docsOf(st)).toEqual([MAIN, 'f1']);
    expect(st.batch).toBeDefined();
    s.undo();
    expect(s.committed.catalog.f1.flag).toBe(null);
    expect(s.committed.recipes.f1.time).toBe(10);
    s.redo();
    expect(s.committed.recipes.f1.time).toBe(14);
    expect(s.snapshot('document')).toEqual({ catalog: { f1: { flag: 'pick' } }, recipes: { f1: { time: 14, grade: 2 }, f2: { time: 12, grade: 2 } } });
  });

  it("a refusal by a document's rules aborts the whole transaction and drops the preview", () => {
    const { s } = setup();
    const refused: TxRefused[] = [];
    s.onRefused(e => void refused.push(e));
    s.preview('recipes.f1.time', 50);
    s.tx('Bad', (t: any) => {
      t.catalog.f1.flag = 'pick';
      t.recipes.f1.time = 500;
    });
    expect(s.committed.catalog.f1.flag).toBe(null);
    expect(s.committed.recipes.f1.time).toBe(10);
    expect(s.previewing).toBe(false);
    expect(s.log.steps.length).toBe(0);
    expect(refused[0]!.message).toMatch(/out of range/);
    expect(refused[0]!.docs).toEqual([MAIN, 'f1']);
    // without a listener the refusal throws
    const bare = new Store({}, { rules: { frame: FRAME_RULES } });
    bare.open('f', { time: 1, grade: 1 }, { at: 'r.f', kind: 'frame' });
    expect(() => bare.set('r.f.grade', 9)).toThrow(TxRefused);
  });

  it('a gesture under a mount previews for readers and commits its net change as one entry of that document', () => {
    const { s } = setup();
    for (const v of [13, 15, 17]) s.preview('recipes.f2.time', v);
    expect(s.current.recipes.f2.time).toBe(17);
    expect(s.log.doc<{ time: number }>('f2').time).toBe(12);
    s.commit('Time', { detail: '17 s' });
    expect(s.log.entries).toHaveLength(1);
    expect(s.log.last).toMatchObject({ doc: 'f2', tx: { label: 'Time', source: { kind: 'gesture', detail: '17 s' }, mutations: [{ op: 'set', path: 'time', value: 17 }] } });
  });

  it('a roll balance: one batch over several frames, one undo; nudges coalesce into one step', () => {
    const { s, clock } = setup();
    s.tx('Roll balance', (t: any) => {
      t.recipes.f1.grade = 3;
      t.recipes.f2.grade = 3;
    });
    expect(s.log.steps.length).toBe(1);
    expect(s.log.undoStep!.seqs.length).toBe(2);
    s.undo();
    expect([s.committed.recipes.f1.grade, s.committed.recipes.f2.grade]).toEqual([2, 2]);
    for (const v of [11, 12, 13]) {
      s.set('recipes.f1.time', v, { label: 'Time', coalesce: 'nudge:time' });
      clock.advance(100);
    }
    expect(s.log.steps.length).toBe(1);
    expect(s.log.last!.tx.mutations).toEqual([{ op: 'set', path: 'time', value: 13 }]);
  });

  it('the host changes the log: a proposal approved shows; why says who; close takes a frame away', () => {
    const { s } = setup();
    s.change(log => log.propose({ doc: 'f1', tx: transaction({ id: 'a1', label: 'Agent: time', by: 'agent', mutations: [set('time', 20)] }) }, { why: 'brighter' }));
    expect(s.committed.recipes.f1.time).toBe(10);
    const seq = s.log.pending()[0]!.seq;
    s.change(log => log.approve(seq));
    expect(s.committed.recipes.f1.time).toBe(20);
    expect(s.log.why('f1', 'time')).toMatchObject({ by: 'agent', approvedBy: 'user', value: 20 });
    // a batch from the one batch builder, over the mounted frames
    s.change(log => log.commit(plan(log.targets(['f1', 'f2']), () => [set('grade', 4)], { id: 'look-1', label: 'Look: hard', by: 'user' })));
    expect([s.committed.recipes.f1.grade, s.committed.recipes.f2.grade]).toEqual([4, 4]);
    s.undo();
    expect([s.committed.recipes.f1.grade, s.committed.recipes.f2.grade]).toEqual([2, 2]);
    s.close('f2');
    expect(s.committed.recipes).toEqual({ f1: { time: 20, grade: 2 } });
    expect(s.log.ids()).toEqual([MAIN, 'f1']);
    expect(() => s.open('x', {}, { at: 'catalog.f1' })).toThrow(/main document holds/);
    expect(() => s.open('y', {}, { at: 'ui.y' })).toThrow(/view tier/);
  });
});
