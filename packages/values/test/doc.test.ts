import { describe, expect, it } from 'vitest';
import {
  applyMutation, canonicalJSON, canonicalPath, Coll, defineValue, document, equal, field, freshId, getPath, indexOf, insert,
  isDeepFrozen, move, remove, resolvePath, set, unset, ValueError, type Mutation,
} from '../src/index.ts';

const layer = (amount: number, extra: object = {}) => ({ kind: 'layer', amount, params: { ev: 0, rgb: [1, 1, 1] }, ...extra });
const group = (entries: [string, unknown][]) => ({ kind: 'group', amount: 1, stack: Coll.of(entries) });

const sample = () =>
  document({
    format: 3,
    stages: {
      darkroom: { medium: { paper: 'mg-fb' }, stack: Coll.of<unknown>([['L1', layer(1)], ['G1', group([['L2', layer(0.5)], ['G2', group([['L3', layer(0.2)]])]])]]) },
      print: { medium: { lamp: 'd50' }, stack: Coll.of<unknown>([['P1', layer(0.7)]]) },
    },
    masks: Coll.of<unknown>([['sky', { feather: 4, components: Coll.of([['c1', { op: 'linear' }]]) }]]),
  });

const code = (f: () => unknown): string => {
  try { f(); } catch (e) { return e instanceof ValueError ? e.code : `foreign: ${String(e)}`; }
  return 'none';
};

describe('the index', () => {
  it('finds every item at every depth', () => {
    const d = sample();
    const idx = indexOf(d);
    expect(idx.ids().sort()).toEqual(['G1', 'G2', 'L1', 'L2', 'L3', 'P1', 'c1', 'sky']);
    expect(idx.locate('L3')).toEqual({
      id: 'L3', parent: 'G2', coll: 'G2.stack', at: 0,
      path: ['stages', 'darkroom', 'stack', 'items', 'G1', 'stack', 'items', 'G2', 'stack', 'items', 'L3'],
    });
    expect(idx.locate('L1')).toMatchObject({ parent: null, coll: 'stages.darkroom.stack', at: 0 });
    expect(idx.locate('c1')).toMatchObject({ parent: 'sky', coll: 'sky.components' });
    expect(idx.ancestors('L3')).toEqual(['G2', 'G1']);
    expect(indexOf(d)).toBe(idx);
  });
  it('refuses malformed documents', () => {
    expect(code(() => document({ a: Coll.of([['x', 1]]), b: Coll.of([['x', 2]]) }))).toBe('E_DOCUMENT');
    expect(code(() => document({ a: { order: ['x'], items: {} } }))).toBe('E_DOCUMENT');
    expect(code(() => document({ a: Coll.of([['a', 1]]) }))).toBe('E_DOCUMENT');
    expect(code(() => document(Coll.empty()))).toBe('E_DOCUMENT');
    expect(isDeepFrozen(sample())).toBe(true);
  });
  it('freshId picks an unused id', () => {
    const d = document({ s: Coll.of([['e1', 1], ['e2', 2]]) });
    expect(freshId(d)).toBe('e3');
    expect(freshId(d, 'L')).toBe('L1');
  });
});

describe('paths', () => {
  it('start at an id or at the root, cross collections by id, arrays by index', () => {
    const d = sample();
    expect(getPath(d, 'L3.amount')).toBe(0.2);
    expect(getPath(d, 'stages.darkroom.stack.G1.stack.G2.stack.L3.amount')).toBe(0.2);
    expect(getPath(d, 'G1.stack.L2.params.rgb.2')).toBe(1);
    expect(getPath(d, 'stages.darkroom.medium.paper')).toBe('mg-fb');
    expect(getPath(d, 'sky.components.c1.op')).toBe('linear');
    expect(getPath(d, 'L3.nope')).toBeUndefined();
    expect(getPath(d, 'stages.darkroom.stack.order')).toBeUndefined();
    expect(canonicalPath(d, 'stages.darkroom.stack.G1.stack.L2.params.ev')).toBe('L2.params.ev');
    expect(canonicalPath(d, 'stages.print.medium.lamp')).toBe('stages.print.medium.lamp');
    expect(resolvePath(d, 'L1')).toMatchObject({ holder: 'coll', owner: 'L1', canonical: 'L1', exists: true });
  });
  it('report what is there when they do not resolve', () => {
    const d = sample();
    try {
      resolvePath(d, 'G1.stack.LX.amount');
      expect.unreachable();
    } catch (e) {
      expect((e as ValueError).diag).toMatchObject({ code: 'E_PATH', valid: ['L2', 'G2'] });
    }
    expect(code(() => resolvePath(d, 'L1.params.rgb.3'))).toBe('E_PATH');
    expect(code(() => resolvePath(d, 'L1.amount.x'))).toBe('E_PATH');
    expect(code(() => resolvePath(d, 'L1..amount'))).toBe('E_PATH');
    expect(code(() => resolvePath(d, 'nope.x'))).toBe('E_PATH');
  });
});

describe('the four mutations', () => {
  it('set a field and return its inverse; untouched parts are shared', () => {
    const d = sample();
    const a = applyMutation(d, set('stages.darkroom.stack.G1.stack.L2.amount', 0.25));
    expect(getPath(a.doc, 'L2.amount')).toBe(0.25);
    expect(a.mutation).toEqual({ op: 'set', path: 'L2.amount', value: 0.25 });
    expect(a.inverse).toEqual({ op: 'set', path: 'L2.amount', value: 0.5 });
    expect((a.doc as typeof d).stages.print).toBe(d.stages.print);
    expect((a.doc as typeof d).masks).toBe(d.masks);
    expect(isDeepFrozen(a.doc)).toBe(true);
    expect(equal(applyMutation(a.doc, a.inverse).doc, d)).toBe(true);
  });
  it('set creates a key, unset deletes it; each is the other\'s inverse', () => {
    const d = sample();
    const a = applyMutation(d, set('L1.note', 'hi'));
    expect(a.inverse).toEqual({ op: 'set', path: 'L1.note' });
    const b = applyMutation(a.doc, a.inverse);
    expect(canonicalJSON(b.doc)).toBe(canonicalJSON(d));
    const c = applyMutation(d, unset('L1.params'));
    expect(getPath(c.doc, 'L1.params')).toBeUndefined();
    expect(canonicalJSON(applyMutation(c.doc, c.inverse).doc)).toBe(canonicalJSON(d));
    expect(code(() => applyMutation(d, unset('L1')))).toBe('E_PATH');
    expect(code(() => applyMutation(d, unset('L1.params.rgb.0')))).toBe('E_PATH');
  });
  it('set of a whole item or collection re-indexes the ids inside', () => {
    const d = sample();
    const a = applyMutation(d, set('G1', group([['N1', layer(0.1)]])));
    const idx = indexOf(a.doc);
    expect(idx.has('L2')).toBe(false);
    expect(idx.has('L3')).toBe(false);
    expect(idx.locate('N1')).toMatchObject({ parent: 'G1', coll: 'G1.stack' });
    expect(equal(applyMutation(a.doc, a.inverse).doc, d)).toBe(true);
    expect(indexOf(applyMutation(a.doc, a.inverse).doc).has('L3')).toBe(true);
    expect(code(() => applyMutation(d, set('P1', group([['L1', layer(1)]]))))).toBe('E_MUTATION');
  });
  it('insert into any collection, at a position; the inverse is remove', () => {
    const d = sample();
    const a = applyMutation(d, insert('G2.stack', 'L4', layer(0.9), 0));
    expect(indexOf(a.doc).locate('L4')).toMatchObject({ parent: 'G2', coll: 'G2.stack', at: 0 });
    expect(getPath(a.doc, 'G2.stack.L3.amount')).toBe(0.2);
    expect(a.inverse).toEqual({ op: 'remove', id: 'L4' });
    expect(a.mutation).toEqual({ op: 'insert', coll: 'G2.stack', id: 'L4', item: layer(0.9), at: 0 });
    expect(equal(applyMutation(a.doc, a.inverse).doc, d)).toBe(true);
    const b = applyMutation(d, insert('stages.print.stack', 'G9', group([['L9', layer(1)]])));
    expect(indexOf(b.doc).locate('L9')).toMatchObject({ parent: 'G9', coll: 'G9.stack' });
    expect(indexOf(b.doc).locate('G9')).toMatchObject({ at: 1 });
  });
  it('insert refuses taken ids (also nested ones), root keys, bad positions and non-JSON items', () => {
    const d = sample();
    expect(code(() => applyMutation(d, insert('G1.stack', 'L1', layer(1))))).toBe('E_MUTATION');
    expect(code(() => applyMutation(d, insert('G1.stack', 'N', group([['P1', layer(1)]]))))).toBe('E_MUTATION');
    expect(code(() => applyMutation(d, insert('G1.stack', 'masks', layer(1))))).toBe('E_MUTATION');
    expect(code(() => applyMutation(d, insert('G1.stack', 'N', layer(1), 3)))).toBe('E_MUTATION');
    expect(code(() => applyMutation(d, insert('L1.params', 'N', layer(1))))).toBe('E_PATH');
    expect(code(() => applyMutation(d, insert('G1.stack', 'N', { f: () => 1 })))).toBe('E_ARG_TYPE');
    expect(code(() => applyMutation(d, insert('G1.stack', 'N', { a: NaN })))).toBe('E_ARG_RANGE');
  });
  it('remove an item wherever it is; the inverse inserts it back at its place', () => {
    const d = sample();
    const a = applyMutation(d, remove('G2'));
    expect(indexOf(a.doc).has('L3')).toBe(false);
    expect(a.inverse).toMatchObject({ op: 'insert', coll: 'G1.stack', id: 'G2', at: 1 });
    expect(equal(applyMutation(a.doc, a.inverse).doc, d)).toBe(true);
    expect(code(() => applyMutation(d, remove('nope')))).toBe('E_MUTATION');
  });
  it('move reorders, or moves into and out of nested collections; ids and id paths survive', () => {
    const d = sample();
    const a = applyMutation(d, move('L3', { into: 'stages.print.stack', at: 0 }));
    expect(getPath(a.doc, 'L3.amount')).toBe(0.2);
    expect(getPath(a.doc, 'L3')).toBe(getPath(d, 'L3'));
    expect(indexOf(a.doc).locate('L3')).toMatchObject({ parent: null, coll: 'stages.print.stack', at: 0 });
    expect(a.inverse).toEqual({ op: 'move', id: 'L3', into: 'G2.stack', at: 0 });
    expect(equal(applyMutation(a.doc, a.inverse).doc, d)).toBe(true);
    const b = applyMutation(d, move('G1', { at: 0 }));
    expect(Coll.ids((b.doc as typeof d).stages.darkroom.stack)).toEqual(['G1', 'L1']);
    expect(b.mutation).toEqual({ op: 'move', id: 'G1', into: 'stages.darkroom.stack', at: 0 });
    expect(indexOf(b.doc).locate('L3')!.path).toEqual(indexOf(d).locate('L3')!.path);
    const c = applyMutation(d, move('L1', { into: 'G2.stack' }));
    expect(indexOf(c.doc).ancestors('L1')).toEqual(['G2', 'G1']);
    expect(equal(applyMutation(c.doc, c.inverse).doc, d)).toBe(true);
  });
  it('move refuses cycles and positions out of range', () => {
    const d = sample();
    expect(code(() => applyMutation(d, move('G1', { into: 'G2.stack' })))).toBe('E_MUTATION');
    expect(code(() => applyMutation(d, move('G1', { into: 'G1.stack' })))).toBe('E_MUTATION');
    expect(code(() => applyMutation(d, move('L1', { at: 2 })))).toBe('E_MUTATION');
    expect(code(() => applyMutation(d, move('L1', { into: 'stages.print.stack', at: 2 })))).toBe('E_MUTATION');
    expect(code(() => applyMutation(d, { op: 'merge' } as unknown as Mutation))).toBe('E_MUTATION');
  });
  it('takes values where it takes data', () => {
    const Layer = defineValue<ReturnType<typeof layer>>()('layer', { amount: (k: number) => field('amount')(k) });
    const d = sample();
    const a = applyMutation(d, insert('G1.stack', 'V1', Layer(layer(1)).amount(0.3)));
    expect(getPath(a.doc, 'V1.amount')).toBe(0.3);
    const b = applyMutation(d, set('L1', Layer(layer(0.1))));
    expect(getPath(b.doc, 'L1.amount')).toBe(0.1);
  });
});

describe('validation hook', () => {
  it('sees the change in normal form and can refuse it or add warnings', () => {
    const d = sample();
    const seen: string[] = [];
    const validate = ({ mutation, index, after }: { mutation: Mutation; index: ReturnType<typeof indexOf>; after: object }) => {
      seen.push(mutation.op);
      if (mutation.op === 'set' && mutation.path.endsWith('.amount')) {
        const v = mutation.value as number;
        if (v < 0 || v > 1) throw new RangeError('amount outside 0…1');
        if (v === 0) return ['W_ZERO'];
      }
      if (mutation.op === 'insert' && index.locate(mutation.id)!.path[1] === 'darkroom' && (getPath(after, `${mutation.id}.blend`) ?? null) !== null) {
        throw new Error('no blend in the darkroom');
      }
      return [];
    };
    expect(applyMutation(d, set('L1.amount', 0), { validate }).warnings).toEqual(['W_ZERO']);
    expect(() => applyMutation(d, set('L1.amount', 2), { validate })).toThrow(RangeError);
    expect(() => applyMutation(d, insert('G1.stack', 'B1', layer(1, { blend: 'screen' })), { validate })).toThrow(/blend/);
    expect(applyMutation(d, insert('stages.print.stack', 'B1', layer(1, { blend: 'screen' })), { validate }).warnings).toEqual([]);
    expect(seen).toEqual(['set', 'set', 'insert', 'insert']);
  });
});
