import { describe, expect, it } from 'vitest';
import {
  applyTransaction, canonicalJSON, Coll, document, equal, getPath, insert, invertTransaction, move, remove, revertTransaction, set,
  transaction, tryTransaction, ValueError,
} from '../src/index.ts';

const doc = () =>
  document({
    stack: Coll.of<unknown>([['main', { kind: 'main', amount: 1 }], ['G1', { kind: 'group', stack: Coll.of([['L1', { kind: 'layer', amount: 0.5 }]]) }]]),
  });

describe('transactions', () => {
  it('apply in order, fill the inverses in normal form, and revert exactly', () => {
    const d = doc();
    const tx = transaction({
      id: 't1', label: 'Sky burn', by: 'agent', source: { kind: 'agent', turn: 3 }, batch: 'b1',
      mutations: [insert('G1.stack', 'L2', { kind: 'layer', amount: 0.2 }), set('L2.amount', 0.4), move('L1', { into: 'stack' }), remove('G1')],
    });
    expect(tx).toMatchObject({ status: 'pending', inverses: [] });
    const a = applyTransaction(d, tx);
    expect(a.tx.status).toBe('applied');
    expect(a.tx.mutations[0]).toEqual({ op: 'insert', coll: 'G1.stack', id: 'L2', item: { kind: 'layer', amount: 0.2 }, at: 1 });
    expect(a.tx.mutations[2]).toEqual({ op: 'move', id: 'L1', into: 'stack', at: 2 });
    expect(a.tx.inverses).toHaveLength(4);
    expect(Coll.ids((a.doc as ReturnType<typeof doc>).stack)).toEqual(['main', 'L1']);
    expect(getPath(a.doc, 'L2.amount')).toBeUndefined();
    const back = revertTransaction(a.doc, a.tx);
    expect(canonicalJSON(back.doc)).toBe(canonicalJSON(d));
    const inv = invertTransaction(a.tx);
    expect(inv).toMatchObject({ id: 'undo:t1', label: 'Sky burn', by: 'agent', batch: 'b1', status: 'pending' });
    expect(inv.inverses).toEqual([...a.tx.mutations].reverse());
    const redo = applyTransaction(back.doc, invertTransaction(back.tx, { id: 'redo:t1' }));
    expect(equal(redo.doc, a.doc)).toBe(true);
    expect(JSON.parse(JSON.stringify(a.tx))).toEqual(a.tx);
  });
  it('are atomic: a failing mutation applies nothing and is reported by index', () => {
    const d = doc();
    const before = canonicalJSON(d);
    const tx = transaction({ id: 't2', label: 'x', by: 'user', mutations: [set('L1.amount', 0.1), remove('nope'), set('main.amount', 0.3)] });
    const r = tryTransaction(d, tx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.index).toBe(1);
      expect((r.error as ValueError).code).toBe('E_MUTATION');
    }
    expect(() => applyTransaction(d, tx)).toThrow(ValueError);
    expect(canonicalJSON(d)).toBe(before);
  });
  it('check transaction-wide rules once, on the final document', () => {
    const d = doc();
    const oneMain = ({ after }: { after: object }) => {
      const mains = Coll.values((after as ReturnType<typeof doc>).stack).filter((e) => (e as { kind: string }).kind === 'main');
      if (mains.length !== 1) throw new Error(`${mains.length} main entries`);
    };
    // replacing main passes through a state with none
    const swap = transaction({ id: 't3', label: 'swap main', by: 'user', mutations: [remove('main'), insert('stack', 'main2', { kind: 'main', amount: 1 }, 0)] });
    expect(applyTransaction(d, swap, { validateTransaction: oneMain }).tx.status).toBe('applied');
    const drop = transaction({ id: 't4', label: 'drop main', by: 'user', mutations: [remove('main')] });
    const r = tryTransaction(d, drop, { validateTransaction: oneMain });
    expect(r.ok === false && r.index).toBe(1);
  });
  it('collect warnings from every mutation', () => {
    const d = doc();
    const tx = transaction({ id: 't5', label: 'x', by: 'auto', mutations: [set('L1.amount', 0), set('main.amount', 0)] });
    const a = applyTransaction(d, tx, { validate: ({ mutation }) => (mutation.op === 'set' ? [`zero ${mutation.path}`] : []) });
    expect(a.warnings).toEqual(['zero L1.amount', 'zero main.amount']);
  });
  it('cannot invert a transaction that was never applied', () => {
    const tx = transaction({ id: 't6', label: 'x', by: 'user', mutations: [set('L1.amount', 0)] });
    expect(() => invertTransaction(tx)).toThrow(/apply it first/);
  });
});
