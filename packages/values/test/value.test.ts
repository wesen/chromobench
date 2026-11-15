import { describe, expect, it } from 'vitest';
import { captureSites, dataOf, defineValue, EXPLAIN, explain, field, isValue, modifier, site, where } from '../src/index.ts';

interface LayerData {
  op: string;
  amount: number;
  mask: string | null;
  params: { ev?: number };
}

const amount = field('amount');
const mask = (id: string | null) => field('mask')(id);
const ev = (stops: number) => modifier<{ params: { ev?: number } }>('ev', (d) => ({ ...d, params: { ...d.params, ev: stops } }), [stops]);

const Layer = defineValue<LayerData>()('layer', { amount: (k: number) => amount(k), mask, ev }, {
  normalize: (d) => {
    if (d.amount < 0 || d.amount > 1) throw new RangeError(`amount ${d.amount} outside 0…1`);
    return d;
  },
  explain: (d) => ({ op: d.op }),
});
const base = (): LayerData => ({ op: 'curve', amount: 1, mask: null, params: {} });

describe('defineValue', () => {
  it('chain methods are modifiers: x.amount(0.8) ≡ x.with(amount(0.8))', () => {
    const l = Layer(base());
    expect(l.amount(0.8).data).toEqual(l.with(amount(0.8)).data);
    expect(l.amount(0.8).mask('sky').ev(0.5).data).toEqual({ op: 'curve', amount: 0.8, mask: 'sky', params: { ev: 0.5 } });
  });
  it('never mutates: every with returns a new frozen value', () => {
    const l = Layer(base());
    const m = l.amount(0.3);
    expect(m).not.toBe(l);
    expect(l.data.amount).toBe(1);
    expect(Object.isFrozen(m)).toBe(true);
    expect(Object.isFrozen(m.data.params)).toBe(true);
    expect(() => {
      (m as unknown as { data: unknown }).data = {};
    }).toThrow(TypeError);
  });
  it('with takes a modifier, a function or a shallow patch; normalize runs every time', () => {
    const l = Layer(base());
    expect(l.with({ op: 'grade' }).data.op).toBe('grade');
    expect(l.with((d) => ({ ...d, amount: d.amount / 2 })).data.amount).toBe(0.5);
    const soft = amount(0.6).then(mask('sky'));
    expect(l.with(soft).data).toMatchObject({ amount: 0.6, mask: 'sky' });
    expect(() => l.amount(2)).toThrow(RangeError);
    expect(() => Layer({ ...base(), amount: -1 })).toThrow(RangeError);
  });
  it('records where it was built and every with, and explains itself', () => {
    const line = site()!.line;
    const l = Layer(base()).amount(0.5);
    expect(l.at!.line).toBe(line + 1);
    expect(l.at!.file).toBe('test/value.test.ts');
    expect(l.trail).toHaveLength(1);
    expect(l.trail[0]!.at!.line).toBe(line + 1);
    const e = explain(l) as Record<string, unknown>;
    expect(e).toMatchObject({ kind: 'layer', op: 'curve', data: { amount: 0.5 }, built: [{ modifier: { name: 'amount', args: [0.5] } }] });
    expect(e['at']).toBe(where(l.at));
    expect(JSON.parse(JSON.stringify(e))).toEqual(e);
    expect(l[EXPLAIN]()).toEqual(e);
  });
  it('serialises as its data; dataOf unwraps; is() knows its kind', () => {
    const l = Layer(base()).amount(0.4);
    expect(JSON.parse(JSON.stringify(l))).toEqual(l.data);
    expect(dataOf(l)).toBe(l.data);
    expect(dataOf(3)).toBe(3);
    expect(Layer.is(l)).toBe(true);
    expect(isValue(l)).toBe(true);
    const Other = defineValue<{ a: number }>()('other', {});
    expect(Layer.is(Other({ a: 1 }))).toBe(false);
    expect(isValue({ data: 1 })).toBe(false);
  });
  it('refuses reserved method names', () => {
    expect(() => defineValue<{ a: number }>()('bad', { with: () => amount(1) as never })).toThrow(/reserved/);
  });
  it('call-site capture can be switched off', () => {
    const was = captureSites(false);
    try {
      expect(Layer(base()).at).toBeNull();
      expect(site()).toBeNull();
    } finally {
      captureSites(was);
    }
    expect(Layer(base()).at).not.toBeNull();
  });
});

describe('a UI-node-like value built with the same core', () => {
  // how a shell/kit node builder can use values: props are data, kids are values, `with` patches props
  interface NodeData {
    form: string;
    props: Record<string, unknown>;
  }
  const tip = (t: string) => modifier<NodeData>('tip', (n) => ({ ...n, props: { ...n.props, tip: t } }), [t]);
  const Node = defineValue<NodeData>()('node', { tip }, { patch: (n, p) => ({ ...n, props: { ...n.props, ...(p as { props?: object }).props } }) });
  it('patch merges into props; modifiers are reusable across nodes', () => {
    const compact = modifier<NodeData>('compact', (n) => ({ ...n, props: { ...n.props, density: 'compact' } }));
    const a = Node({ form: 'panel', props: { title: 'A' } }).with(compact).tip('hello');
    const b = Node({ form: 'row', props: {} }).with(compact);
    expect(a.data.props).toEqual({ title: 'A', density: 'compact', tip: 'hello' });
    expect(b.data.props).toEqual({ density: 'compact' });
    expect(a.with({ props: { title: 'B' } }).data.props).toEqual({ title: 'B', density: 'compact', tip: 'hello' });
  });
});
