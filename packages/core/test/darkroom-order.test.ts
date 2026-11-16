// D5 (CHB-046): the darkroom stack is listed in the photographer's order, not by kind. That is only a view because the
// light law is order-free: every entry adds light on the paper or filters it, and the sum and the product do not depend
// on the order. Here the reference engine prints the same darkroom in several orders (and with entries moved into and
// out of a group) and the prints agree to the last bits of f64.
import { describe, expect, it } from 'vitest';
import { Coll, move, type Id } from '@chromobench/values';
import { type Document, type Entry } from '@chromobench/contract';
import { component, compiled, G, insert, L, m1Engine, maskOf, pixels, push, withEdits } from './doc-helpers.ts';

const maxDiff = (a: Float64Array, b: Float64Array): number => {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!));
  return m;
};
/** the darkroom stack in another order (ids of the top level) */
const reorder = (d: Document, order: Id[]): Document => {
  const st = d.stages.darkroom.stack;
  const stack = Coll.of(order.map((id) => [id, Coll.get(st, id)!] as [Id, Entry]));
  return { ...d, stages: { ...d.stages, darkroom: { ...d.stages.darkroom, stack } } };
};

describe('the darkroom in his order prints the same as by kind (the light law is order-free)', () => {
  it('reversed, rotated, by kind and moved within: the print and the paper exposure agree to 1e-12', async () => {
    const { e, doc } = await m1Engine();
    const d = withEdits(doc,
      insert('masks', 'sky', maskOf([['sky1', component('linear', { from: { x: 0, y: 0 }, to: { x: 0, y: 30 } })]])),
      insert('masks', 'face', maskOf([['face1', component('ellipse', { box: { x: 30, y: 20, w: 30, h: 25 } })]], { feather_mm: 0.05 })),
      push('darkroom', 'b1', L('burn', { stops: 0.5 }, { mask: 'sky' })),
      push('darkroom', 'd1', L('dodge', { stops: 0.7 }, { mask: 'face', amount: 0.8 })),
      push('darkroom', 'f1', L('flash', { time_s: 1.5 })),
      push('darkroom', 'cm', L('densityMask', { gamma: 0.4, radius_um: 300, polarity: 'positive' })),
      push('darkroom', 'b2', L('burn', { time_s: 3, filtration: { c: 0, m: 10, y: 0 } })),
    );
    const ids = Coll.ids(d.stages.darkroom.stack);
    expect(ids).toEqual(['main', 'lights', 'b1', 'd1', 'f1', 'cm', 'b2']);
    const print = async (x: Document) => pixels(e, compiled(e, x).display);
    const paper = async (x: Document) => pixels(e, compiled(e, x).cuts['darkroom.H']!);
    const p0 = await print(d);
    const h0 = await paper(d);
    const orders: Id[][] = [
      [...ids].reverse(),
      [...ids.slice(3), ...ids.slice(0, 3)],
      // the Enlarger's old by-kind order: main, light added and held back, then the modulators
      ['main', 'b1', 'd1', 'f1', 'b2', 'lights', 'cm'],
    ];
    for (const o of orders) {
      const x = reorder(d, o);
      expect(maxDiff(await paper(x), h0)).toBeLessThan(1e-12);
      expect(maxDiff(await print(x), p0)).toBeLessThan(1e-12);
    }
    // a move as the stack panel's drag makes it (the document log's move mutation), and a group of two burns
    const moved = withEdits(d, move('b2', { at: 0 }));
    expect(Coll.ids(moved.stages.darkroom.stack)[0]).toBe('b2');
    expect(maxDiff(await print(moved), p0)).toBeLessThan(1e-12);
    const grouped = withEdits(reorder(d, ['main', 'lights', 'd1', 'f1', 'cm']),
      push('darkroom', 'g', G('Burns', [['b2', Coll.get(d.stages.darkroom.stack, 'b2')!], ['b1', Coll.get(d.stages.darkroom.stack, 'b1')!]]), 0));
    expect(maxDiff(await print(grouped), p0)).toBeLessThan(1e-12);
  });
});
