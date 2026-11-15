// diff(before, after): the net change as mutations. Properties over random documents and mutation sequences, plus
// the cases a gesture or a store transaction produces.
import { describe, expect, it } from 'vitest';
import { applyMutation, canonicalJSON, Coll, diff, document, equal, getPath, indexOf, insert, move, set, ValueError, type Mutation } from '../src/index.ts';
import { randomDoc, randomMutation, type Gen } from './gen.ts';
import { rng } from './rng.ts';

const applyAll = (d: object, ms: readonly Mutation[]): object => ms.reduce((x, m) => applyMutation(x, m).doc, d);

/** A random walk of n applied mutations from d. */
function walk(g: Gen, d: object, n: number): object {
  let cur = d;
  for (let i = 0; i < n; i++) {
    try {
      cur = applyMutation(cur, randomMutation(g, cur)).doc;
    } catch (e) {
      if (!(e instanceof ValueError)) throw e;
    }
  }
  return cur;
}

describe('diff, over random documents', () => {
  it('applying diff(a, b) to a gives b; diff(b, b) is empty; ids that survive are never removed', () => {
    let mutations = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const g: Gen = { r: rng(seed), next: 0 };
      const a = randomDoc(g);
      const b = walk(g, a, 1 + g.r.int(40));
      const ms = diff(a, b);
      mutations += ms.length;
      expect(canonicalJSON(applyAll(a, ms))).toBe(canonicalJSON(b));
      expect(diff(b, b)).toEqual([]);
      // the same against a copy that shares nothing with a (a store's setIn result, a parsed file)
      const copy = JSON.parse(JSON.stringify(b)) as object;
      expect(canonicalJSON(applyAll(a, diff(a, copy)))).toBe(canonicalJSON(b));
      expect(diff(b, copy)).toEqual([]);
      const survivors = new Set(indexOf(b).ids());
      for (const m of ms) if (m.op === 'remove') expect(survivors.has(m.id)).toBe(false);
      // and backwards
      expect(canonicalJSON(applyAll(b, diff(b, a)))).toBe(canonicalJSON(a));
    }
    expect(mutations).toBeGreaterThan(200);
  });
});

describe('diff, focused', () => {
  const doc = () => document({
    title: 'x',
    rgb: [0.1, 0.2, 0.3],
    stack: Coll.of([
      ['a', { amount: 1 }],
      ['b', { amount: 1 }],
      ['c', { amount: 1 }],
      ['d', { amount: 1 }],
      ['G', { amount: 1, stack: Coll.empty() }],
    ]),
  });

  it('a slider drag is one set; an array element is set by index', () => {
    const d = doc();
    let cur: object = d;
    for (const v of [0.9, 0.7, 0.4]) cur = applyMutation(cur, set('b.amount', v)).doc;
    expect(diff(d, cur)).toEqual([{ op: 'set', path: 'b.amount', value: 0.4 }]);
    expect(diff(d, applyMutation(d, set('rgb.1', 0.5)).doc)).toEqual([{ op: 'set', path: 'rgb.1', value: 0.5 }]);
    // set back: nothing
    expect(diff(d, applyMutation(cur, set('b.amount', 1)).doc)).toEqual([]);
  });

  it('a reorder moves only what left the longest run in order', () => {
    const d = doc();
    const b = applyMutation(d, move('a', { at: 3 })).doc; // b c d a G
    expect(diff(d, b)).toEqual([{ op: 'move', id: 'a', into: 'stack', at: 3 }]);
  });

  it('moving into a group is a move; into a new group, the group is inserted without it and it moves in', () => {
    const d = doc();
    const b = applyMutation(d, move('c', { into: 'G.stack' })).doc;
    expect(diff(d, b)).toEqual([{ op: 'move', id: 'c', into: 'G.stack', at: 0 }]);
    let n = applyMutation(d, insert('stack', 'H', { amount: 1, stack: Coll.empty() })).doc;
    n = applyMutation(n, move('a', { into: 'H.stack' })).doc;
    const ms = diff(d, n);
    expect(ms.map((m) => m.op)).toEqual(['insert', 'move']);
    expect(canonicalJSON(applyAll(d, ms))).toBe(canonicalJSON(n));
    expect(getPath(applyAll(d, ms), 'a')).toBe(getPath(d, 'a'));
  });

  it('a key with a dot cannot be addressed', () => {
    expect(() => diff({ a: 1 }, { a: 1, 'x.y': 2 })).toThrow(/cannot be addressed/);
    expect(equal(applyAll({ a: 1 }, diff({ a: 1 }, { a: 2, b: { c: [1] } })), { a: 2, b: { c: [1] } })).toBe(true);
  });
});
