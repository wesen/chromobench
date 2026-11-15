// Property tests over seeded random documents and mutation sequences. Every document is deep-frozen, so a function
// that wrote to its input would throw (ES modules are strict); the tests also compare canonical JSON before/after.
import { describe, expect, it } from 'vitest';
import {
  applyMutation, applyTransaction, canonicalJSON, Coll, document, equal, getPath, indexOf, insert, isDeepFrozen, move, remove,
  revertTransaction, set, transaction, tryTransaction, unset, ValueError, type Mutation,
} from '../src/index.ts';
import { rng, type Rng } from './rng.ts';

interface Gen {
  r: Rng;
  next: number;
}
const fresh = (g: Gen): string => `n${g.next++}`;

function entry(g: Gen, depth: number): unknown {
  if (depth < 3 && g.r.chance(0.3)) {
    const kids: [string, unknown][] = [];
    for (let i = g.r.int(4); i > 0; i--) kids.push([fresh(g), entry(g, depth + 1)]);
    return { kind: 'group', amount: g.r.int(10) / 10, stack: Coll.of(kids) };
  }
  return { kind: 'layer', amount: g.r.int(10) / 10, params: { ev: g.r.int(7) - 3, rgb: [g.r(), g.r(), g.r()] }, ...(g.r.chance(0.3) ? { note: 'n' } : {}) };
}
const coll = (g: Gen, n: number, depth = 0): Coll<unknown> => Coll.of(Array.from({ length: g.r.int(n + 1) }, () => [fresh(g), entry(g, depth)] as const));

function randomDoc(g: Gen): object {
  return document({
    title: 'frame',
    settings: { a: g.r.int(5), b: [1, 2, 3] },
    stages: { one: { stack: coll(g, 4) }, two: { stack: coll(g, 3) } },
    lib: Coll.of(Array.from({ length: g.r.int(3) }, () => [fresh(g), { v: g.r.int(9) }] as const)),
  });
}

/** Every collection path of a document (roots and groups' stacks). */
function colls(d: object): string[] {
  const out = ['stages.one.stack', 'stages.two.stack', 'lib'];
  for (const id of indexOf(d).ids()) if (Coll.is(getPath(d, `${id}.stack`))) out.push(`${id}.stack`);
  return out;
}

function randomMutation(g: Gen, d: object): Mutation {
  const { r } = g;
  const ids = indexOf(d).ids().sort();
  const id = ids.length ? r.pick(ids) : 'none';
  const k = r.int(ids.length ? 12 : 3);
  switch (k) {
    case 0: return set('settings.a', r.int(100));
    case 1: return set('title', r.pick(['a', 'b']));
    case 2: return insert(r.pick(colls(d)), fresh(g), entry(g, 1), r.chance(0.5) ? undefined : r.int(4));
    case 3: return set(`${id}.amount`, r.int(10) / 10);
    case 4: return set(`${id}.params.rgb.${r.int(3)}`, r());
    case 5: return r.chance(0.5) ? set(`${id}.note`, 'x') : unset(`${id}.note`);
    case 6: return set(id, entry(g, 2));
    case 7: return set('stages.two.stack', coll(g, 2, 1));
    case 8: return remove(id);
    case 9: return move(id, { at: r.int(3) });
    default: return move(id, { into: r.pick(colls(d)), ...(r.chance(0.5) ? { at: r.int(3) } : {}) });
  }
}

/** The index of d as a fresh build would make it, against the index the mutations derived. */
function expectIndexFresh(d: object): void {
  const derived = indexOf(d);
  const rebuilt = indexOf(JSON.parse(JSON.stringify(d)));
  expect(derived.ids().sort()).toEqual(rebuilt.ids().sort());
  for (const id of rebuilt.ids()) expect(derived.locate(id)).toEqual(rebuilt.locate(id));
}

describe('mutations, over random documents', () => {
  it('each inverse restores the document exactly; indexes stay right; inputs are never touched', () => {
    let applied = 0;
    let refused = 0;
    const ops = new Map<string, number>();
    for (let seed = 1; seed <= 60; seed++) {
      const g: Gen = { r: rng(seed), next: 0 };
      let d = randomDoc(g);
      const history: { before: object; after: object; inverse: Mutation; mutation: Mutation }[] = [];
      for (let i = 0; i < 40; i++) {
        const m = randomMutation(g, d);
        const before = canonicalJSON(d);
        let a;
        try {
          a = applyMutation(d, m);
        } catch (e) {
          if (!(e instanceof ValueError)) throw e;
          refused++;
          expect(canonicalJSON(d)).toBe(before);
          continue;
        }
        applied++;
        ops.set(m.op, (ops.get(m.op) ?? 0) + 1);
        expect(canonicalJSON(d)).toBe(before);
        expect(isDeepFrozen(a.doc)).toBe(true);
        expectIndexFresh(a.doc);
        // one step back gives the old document; the inverse's inverse is the mutation in normal form
        const back = applyMutation(a.doc, a.inverse);
        expect(canonicalJSON(back.doc)).toBe(before);
        expect(equal(back.doc, d)).toBe(true);
        expect(back.inverse).toEqual(a.mutation);
        // ids survive a move: same item, same id-anchored paths
        if (m.op === 'move') {
          expect(getPath(a.doc, m.id)).toBe(getPath(d, m.id));
          expect(getPath(a.doc, `${m.id}.amount`)).toBe(getPath(d, `${m.id}.amount`));
          for (const nested of indexOf(d).ids().filter((x) => indexOf(d).ancestors(x).includes(m.id))) {
            expect(indexOf(a.doc).ancestors(nested)).toContain(m.id);
          }
        }
        history.push({ before: d, after: a.doc, inverse: a.inverse, mutation: a.mutation });
        d = a.doc;
      }
      // the whole sequence undone, last first
      let u = d;
      for (const h of [...history].reverse()) {
        u = applyMutation(u, h.inverse).doc;
        expect(canonicalJSON(u)).toBe(canonicalJSON(h.before));
      }
    }
    expect(applied).toBeGreaterThan(1500);
    expect(refused).toBeLessThan(applied);
    for (const op of ['set', 'insert', 'remove', 'move']) expect(ops.get(op) ?? 0).toBeGreaterThan(100);
  });

  it('ids survive moves into and out of nested collections, many times over', () => {
    for (let seed = 100; seed < 130; seed++) {
      const g: Gen = { r: rng(seed), next: 0 };
      let d = randomDoc(g);
      const items = new Map(indexOf(d).ids().map((id) => [id, getPath(d, id)]));
      let moves = 0;
      for (let i = 0; i < 60; i++) {
        const ids = indexOf(d).ids().sort();
        if (!ids.length) break;
        const id = g.r.pick(ids);
        try {
          d = applyMutation(d, move(id, { into: g.r.pick(colls(d)) })).doc;
          moves++;
        } catch (e) {
          if (!(e instanceof ValueError) || e.code !== 'E_MUTATION') throw e;
        }
      }
      expect(moves).toBeGreaterThan(20);
      // a move never changes an item, only where it sits; items with nested moves differ only in their stacks
      for (const [id, item] of items) {
        const now = getPath(d, id) as Record<string, unknown>;
        expect(now).toBeDefined();
        const { stack: _a, ...restNow } = now;
        const { stack: _b, ...restThen } = item as Record<string, unknown>;
        expect(restNow).toEqual(restThen);
      }
      expect(indexOf(d).size).toBe(items.size);
      expectIndexFresh(d);
    }
  });
});

describe('transactions, over random documents', () => {
  it('apply like the sequence, revert exactly, and stay atomic when one mutation fails', () => {
    for (let seed = 200; seed < 240; seed++) {
      const g: Gen = { r: rng(seed), next: 0 };
      const d = randomDoc(g);
      // a valid sequence, found by applying candidates
      const ms: Mutation[] = [];
      let cur = d;
      while (ms.length < 15) {
        const m = randomMutation(g, cur);
        try {
          cur = applyMutation(cur, m).doc;
          ms.push(m);
        } catch (e) {
          if (!(e instanceof ValueError)) throw e;
        }
      }
      const tx = transaction({ id: `t${seed}`, label: 'random', by: 'agent', source: { seed }, mutations: ms });
      const a = applyTransaction(d, tx);
      expect(canonicalJSON(a.doc)).toBe(canonicalJSON(cur));
      expect(canonicalJSON(revertTransaction(a.doc, a.tx).doc)).toBe(canonicalJSON(d));
      // the same, with a failing mutation at a random place: nothing applies
      const at = g.r.int(ms.length + 1);
      const bad = [...ms.slice(0, at), remove('no-such-id'), ...ms.slice(at)];
      const r = tryTransaction(d, transaction({ id: 'bad', label: 'bad', by: 'agent', mutations: bad }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.index).toBe(at);
      // and with a hook that refuses the k-th change
      const k = g.r.int(ms.length);
      let n = 0;
      const refuse = () => {
        if (n++ === k) throw new Error('refused');
      };
      const r2 = tryTransaction(d, tx, { validate: refuse });
      expect(r2.ok === false && r2.index).toBe(k);
    }
  });
});
