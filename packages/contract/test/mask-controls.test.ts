// Contract 1.6 (CHB-049): a mask's density and grow, a component's invert, and the selections' component kinds
// compile into the one algebra (mask.invert, mask.grow, mask.combine with a full mask), absent fields are their
// defaults, and the validator holds the new fields to their ranges.
import { describe, expect, it } from 'vitest';
import { insert } from '@chromobench/values';
import { compile, edit, validateDocument } from '@chromobench/contract';
import { L, component, diagOf, graph, linear, maskOf, push, scanDoc } from './helpers.ts';

const chainOf = (d: ReturnType<typeof scanDoc>) => {
  const g = graph();
  const c = compile(d, g);
  const mid = (c.cuts['darkroom.H']!.args['terms'] as { mask: string }[])[0]!.mask;
  return { g, mid, ops: g.closure(mid).filter((n) => n.op.startsWith('mask.')).map((n) => n.op) };
};
const withMask = (m: ReturnType<typeof maskOf>) => edit(scanDoc(), [insert('masks', 'm1', m), push('darkroom', 'b1', L('burn', { stops: 1 }, { mask: 'm1' }))]).doc;

describe('mask controls (contract 1.6)', () => {
  it('absent density, grow and component invert compile to nothing new (the defaults)', () => {
    expect(chainOf(withMask(maskOf([['c1', linear()]]))).ops).toEqual(['mask.linear']);
    expect(chainOf(withMask(maskOf([['c1', linear()]], { density: 1, grow_mm: 0 }))).ops).toEqual(['mask.linear']);
  });

  it('a component inverted is mask.invert before it is combined', () => {
    const c = { ...component('ellipse', { box: { x: 1, y: 1, w: 6, h: 4 } }, 'intersect'), invert: true };
    const { ops } = chainOf(withMask(maskOf([['c1', linear()], ['c2', c]])));
    expect(ops).toEqual(['mask.linear', 'mask.ellipse', 'mask.invert', 'mask.combine']);
  });

  it('grow, feather, invert, density in that order; grow in mm on the print; density is add of a full mask at 1 − density', () => {
    const { g, mid, ops } = chainOf(withMask(maskOf([['c1', linear()]], { grow_mm: -0.24, feather_mm: 0.48, invert: true, density: 0.7 })));
    expect(ops).toEqual(['mask.linear', 'mask.grow', 'mask.feather', 'mask.invert', 'mask.constant', 'mask.combine']);
    const grow = g.closure(mid).find((n) => n.op === 'mask.grow')!;
    expect(grow.args['radius_px']).toBeCloseTo(-5, 12); // −0.24 mm / (6 µm × 8) per px
    const top = g.get(mid)!;
    expect(top.op).toBe('mask.combine');
    expect(top.args).toMatchObject({ mode: 'add', amount: expect.closeTo(0.3, 12) });
    expect(g.get(top.args['other'] as string)!.args['value']).toBe(1);
  });

  it('the selections compile as components: rect and polygon off the source, the wand off the cut the mask reads', () => {
    const d = withMask(maskOf([
      ['r', component('rect', { box: { x: 1, y: 1, w: 4, h: 3 }, angle_deg: 10 })],
      ['p', component('polygon', { points: [[0, 0], [6, 1], [2, 5]] }, 'subtract')],
      ['w', component('wand', { seed: { x: 3, y: 2 }, tolerance: 0.1, contiguous: false }, 'intersect')],
    ], { reads: 'darkroom.main' }));
    const g = graph();
    const c = compile(d, g);
    const nodes = g.closure((c.cuts['darkroom.H']!.args['terms'] as { mask: string }[])[0]!.mask);
    const rect = nodes.find((n) => n.op === 'mask.rect')!, poly = nodes.find((n) => n.op === 'mask.polygon')!, wand = nodes.find((n) => n.op === 'mask.wand')!;
    expect(rect.inputs[0]).toBe(c.cuts.source!.id);
    expect(poly.inputs[0]).toBe(c.cuts.source!.id);
    expect(poly.args['points']).toEqual([[0, 0, 1], [6, 1, 1], [2, 5, 1]]);
    expect(wand.inputs[0]).toBe(c.cuts['darkroom.main']!.id);
    expect(wand.args).toMatchObject({ softness: 0.02, contiguous: false });
  });

  it('the validator holds density, grow and invert to their ranges and refuses a two-point lasso', () => {
    const bad = (m: ReturnType<typeof maskOf>) => diagOf(() => withMask(m))?.path;
    expect(bad(maskOf([['c1', linear()]], { density: 1.2 }))).toBe('m1.density');
    expect(bad(maskOf([['c1', linear()]], { grow_mm: 5000 }))).toBe('m1.grow_mm');
    expect(bad(maskOf([['c1', { ...linear(), invert: 'yes' as never }]]))).toBe('c1.invert');
    expect(diagOf(() => withMask(maskOf([['c1', component('polygon', { points: [[0, 0], [5, 5]] })]])))).toBeTruthy();
    expect(validateDocument(withMask(maskOf([['c1', { ...linear(), invert: true }]], { density: 0.5, grow_mm: 2 })))).toEqual([]);
  });
});
