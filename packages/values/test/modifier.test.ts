import { describe, expect, it } from 'vitest';
import { apply, assign, compose, deepFreeze, explain, field, identity, isModifier, modifier, toModifier, type Modifier } from '../src/index.ts';
import { rng, type Rng } from './rng.ts';

interface R {
  x: number;
  s: string;
  tags: readonly string[];
}

const add = (k: number) => modifier<R>('add', (r) => ({ ...r, x: r.x + k }), [k]);
const mul = (k: number) => modifier<R>('mul', (r) => ({ ...r, x: r.x * k }), [k]);
const suffix = (t: string) => modifier<R>('suffix', (r) => ({ ...r, s: r.s + t }), [t]);
const tag = (t: string) => modifier<R>('tag', (r) => ({ ...r, tags: [...r.tags, t] }), [t]);

function randomModifier(r: Rng, depth = 0): Modifier<R> {
  const k = r.int(depth > 2 ? 4 : 7);
  switch (k) {
    case 0: return add(r.int(10) - 5);
    case 1: return mul(r.int(5) - 2);
    case 2: return suffix(r.pick(['a', 'b', 'c']));
    case 3: return tag(r.pick(['p', 'q']));
    case 4: return identity<R>();
    case 5: return randomModifier(r, depth + 1).then(randomModifier(r, depth + 1));
    default: return randomModifier(r, depth + 1).then(randomModifier(r, depth + 1)).named(r.pick(['soft', 'warm']));
  }
}
const randomR = (r: Rng): R => deepFreeze({ x: r.int(20) - 10, s: r.pick(['', 'z']), tags: r.chance(0.5) ? ['t'] : [] });

describe('then', () => {
  it('is associative, by result and by structure (600 random triples, frozen inputs)', () => {
    const r = rng(42);
    for (let i = 0; i < 600; i++) {
      const [a, b, c] = [randomModifier(r), randomModifier(r), randomModifier(r)];
      const left = a.then(b).then(c);
      const right = a.then(b.then(c));
      const v = randomR(r);
      expect(left.run(v)).toEqual(right.run(v));
      expect(left.run(v)).toEqual(c.run(b.run(a.run(v))));
      expect(left.steps).toEqual(right.steps);
      left.steps.forEach((s, j) => expect(s).toBe(right.steps[j]));
      expect(explain(left)).toEqual(explain(right));
    }
  });
  it('has identity as its unit, by reference', () => {
    const a = add(1);
    expect(a.then(identity())).toBe(a);
    expect(identity<R>().then(a)).toBe(a);
    expect(identity().steps).toEqual([]);
    expect(identity<R>().run(deepFreeze({ x: 1, s: '', tags: [] }))).toEqual({ x: 1, s: '', tags: [] });
  });
  it('composes in order; compose and apply agree', () => {
    const v = deepFreeze({ x: 2, s: '', tags: [] as string[] });
    expect(add(1).then(mul(3)).run(v).x).toBe(9);
    expect(mul(3).then(add(1)).run(v).x).toBe(7);
    expect(compose(add(1), mul(3)).run(v)).toEqual(apply(v, add(1), mul(3)));
    expect(compose<R>()).toBe(identity());
  });
});

describe('modifiers are named, explainable values', () => {
  it('explains atoms, composites and named composites', () => {
    const soft = add(1).then(suffix('!'));
    expect(soft.name).toBe('add · suffix');
    expect(explain(soft)).toMatchObject({ kind: 'modifier', name: 'add · suffix', steps: [{ name: 'add', args: [1] }, { name: 'suffix', args: ['!'] }] });
    const named = soft.named('soft');
    expect(named.steps).toEqual([named]);
    expect(explain(named)).toMatchObject({ kind: 'modifier', name: 'soft', of: [{ name: 'add' }, { name: 'suffix' }] });
    expect(named.then(mul(2)).name).toBe('soft · mul');
    const at = (explain(add(1)) as { at: string }).at;
    expect(at).toMatch(/test\/modifier\.test\.ts:\d+:\d+/);
  });
  it('are frozen and recognisable', () => {
    const m = add(1);
    expect(Object.isFrozen(m)).toBe(true);
    expect(isModifier(m)).toBe(true);
    expect(isModifier({ run: () => 1 })).toBe(false);
  });
  it('field and assign apply to anything with the field, keeping the rest', () => {
    const amount = field('amount');
    const layer = deepFreeze({ kind: 'layer', amount: 1, mask: null as string | null });
    const out = amount(0.8).then(field('mask')<string | null>('sky')).run(layer);
    expect(out).toEqual({ kind: 'layer', amount: 0.8, mask: 'sky' });
    expect(layer.amount).toBe(1);
    expect(assign({ amount: 0.5 }).run(layer)).toEqual({ ...layer, amount: 0.5 });
    expect(explain(amount(0.8))).toMatchObject({ name: 'amount', args: [0.8] });
  });
  it('toModifier takes a modifier, a function or a patch', () => {
    const m = add(2);
    expect(toModifier<R>(m)).toBe(m);
    const fn = toModifier<R>(function double(r) { return { ...r, x: r.x * 2 }; });
    expect(fn.name).toBe('double');
    expect(fn.run(deepFreeze({ x: 3, s: '', tags: [] })).x).toBe(6);
    expect(toModifier<R>({ s: 'p' }).run(deepFreeze({ x: 0, s: '', tags: [] })).s).toBe('p');
    const custom = toModifier<{ props: Record<string, unknown> }>({ props: { a: 1 } }, (v, p) => ({ props: { ...v.props, ...p.props } }));
    expect(custom.run({ props: { b: 2 } })).toEqual({ props: { b: 2, a: 1 } });
    expect(() => toModifier<R>(3 as never)).toThrow(TypeError);
  });
});
