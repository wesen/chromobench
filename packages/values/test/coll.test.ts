import { describe, expect, it } from 'vitest';
import { Coll, deepFreeze, isDeepFrozen, isId, ValueError } from '../src/index.ts';
import { rng } from './rng.ts';

const abc = () => deepFreeze(Coll.of([['a', 1], ['b', 2], ['c', 3]]));

describe('Coll', () => {
  it('builds, reads and iterates in order', () => {
    const c = abc();
    expect(Coll.ids(c)).toEqual(['a', 'b', 'c']);
    expect(Coll.values(c)).toEqual([1, 2, 3]);
    expect(Coll.entries(c)).toEqual([['a', 1], ['b', 2], ['c', 3]]);
    expect([...Coll.iter(c)]).toEqual(Coll.entries(c));
    expect(Coll.get(c, 'b')).toBe(2);
    expect(Coll.get(c, 'toString')).toBeUndefined();
    expect(Coll.has(c, 'constructor')).toBe(false);
    expect(Coll.indexOf(c, 'c')).toBe(2);
    expect(Coll.indexOf(c, 'zz')).toBe(-1);
    expect(Coll.size(c)).toBe(3);
    expect(Coll.from(['x', 'y'], (v) => `id-${v}`).order).toEqual(['id-x', 'id-y']);
  });
  it('insert, remove, move, replace, update, map, filter are pure', () => {
    const c = abc();
    expect(Coll.insert(c, 'd', 4, 1).order).toEqual(['a', 'd', 'b', 'c']);
    expect(Coll.insert(c, 'd', 4).order).toEqual(['a', 'b', 'c', 'd']);
    expect(Coll.remove(c, 'b')).toEqual({ order: ['a', 'c'], items: { a: 1, c: 3 } });
    expect(Coll.move(c, 'a', 2).order).toEqual(['b', 'c', 'a']);
    expect(Coll.move(c, 'c', 0).order).toEqual(['c', 'a', 'b']);
    expect(Coll.replace(c, 'b', 20).items.b).toBe(20);
    expect(Coll.update(c, 'c', (x) => x * 10).items.c).toBe(30);
    expect(Coll.map(c, (x, id, i) => `${id}${x}${i}`).items).toEqual({ a: 'a10', b: 'b21', c: 'c32' });
    expect(Coll.filter(c, (x) => x !== 2).order).toEqual(['a', 'c']);
    expect(c).toEqual({ order: ['a', 'b', 'c'], items: { a: 1, b: 2, c: 3 } });
    expect(isDeepFrozen(Coll.insert(c, 'd', 4))).toBe(true);
  });
  it('refuses duplicates, unknown ids, bad ids and positions out of range', () => {
    const c = abc();
    const code = (f: () => unknown): string => {
      try { f(); } catch (e) { return e instanceof ValueError ? e.code : String(e); }
      return 'none';
    };
    expect(code(() => Coll.insert(c, 'a', 9))).toBe('E_MUTATION');
    expect(code(() => Coll.insert(c, 'x.y', 9))).toBe('E_MUTATION');
    expect(code(() => Coll.insert(c, '__proto__', 9))).toBe('E_MUTATION');
    expect(code(() => Coll.insert(c, 'd', 9, 4))).toBe('E_MUTATION');
    expect(code(() => Coll.insert(c, 'd', 9, 1.5))).toBe('E_MUTATION');
    expect(code(() => Coll.remove(c, 'zz'))).toBe('E_MUTATION');
    expect(code(() => Coll.move(c, 'a', 3))).toBe('E_MUTATION');
    expect(isId('a-b_9')).toBe(true);
    expect(isId('')).toBe(false);
  });
  it('recognises its shape and explains malformed ones', () => {
    expect(Coll.is({ order: [], items: {} })).toBe(true);
    expect(Coll.is({ order: [], items: {}, extra: 1 })).toBe(false);
    expect(Coll.is({ order: [1], items: {} })).toBe(false);
    expect(Coll.problem({ order: ['a', 'a'], items: { a: 1 } })).toMatch(/twice/);
    expect(Coll.problem({ order: ['a'], items: {} })).toMatch(/not in items/);
    expect(Coll.problem({ order: [], items: { a: 1 } })).toMatch(/not in order/);
    expect(Coll.problem(abc())).toBeNull();
  });
  it('random operation sequences on frozen collections keep order and items consistent', () => {
    const r = rng(11);
    for (let run = 0; run < 50; run++) {
      let c = deepFreeze(Coll.empty<number>());
      const model: [string, number][] = [];
      for (let i = 0; i < 40; i++) {
        const op = r.int(3);
        if (op === 0 || model.length === 0) {
          const at = r.int(model.length + 1);
          const id = `i${run}-${i}`;
          c = Coll.insert(c, id, i, at);
          model.splice(at, 0, [id, i]);
        } else if (op === 1) {
          const k = r.int(model.length);
          c = Coll.remove(c, model[k]![0]);
          model.splice(k, 1);
        } else {
          const k = r.int(model.length);
          const at = r.int(model.length);
          const [e] = model.splice(k, 1);
          model.splice(at, 0, e!);
          c = Coll.move(c, e![0], at);
        }
        expect(Coll.entries(c)).toEqual(model);
        expect(Coll.problem(c)).toBeNull();
        expect(isDeepFrozen(c)).toBe(true);
      }
    }
  });
});
