// cb.kits.stack, the model: generic over the catalogue and the laws. What "+ Layer" offers per stage, the law's
// words (amount hint, blend choices), and every structural edit as mutations the contract's rules accept: add,
// duplicate (fresh ids inside), delete (with an unused mask), group and ungroup, drops before / after / into a group,
// masks drawn onto the selected entry or as a darkroom burn, provenance by entry.
import { describe, expect, it } from 'vitest';
import { Coll, set, type Mutation } from '@chromobench/values';
import { edit, layerEntry, newDocument, type Document, type Group } from '@chromobench/contract';
import {
  addableOps, addLayer, amountHint, amountTrack, blendChoices, componentDefaults, deleteEntries, dropOn, duplicateEntry, groupEntries, hasAddableOps,
  maskGesture, maskOf, maskUsers, nudgeEntry, rowsOf, setBlend, ungroup, byOps, detachMask, newMaskOn,
} from '../../kits/stack/src/model.ts';

const neg = (): Document => newDocument('negative-scan', { sha256: 'ab'.repeat(32), width: 96, height: 64 });
const raw = (): Document => newDocument('digital-raw', { sha256: 'cd'.repeat(32), width: 96, height: 64 });
const apply = (d: Document, ms: readonly Mutation[]): Document => edit(d, ms).doc;
const order = (d: Document, stage: 'darkroom' | 'print' | 'scan' = 'darkroom') => d.stages[stage]!.stack.order;

describe('the catalogue: what a stage can add', () => {
  it('+ Layer lists the stage\'s ops: darkroom terms but not the main exposure, print clarity but not the spot ops', () => {
    expect(addableOps('darkroom').map((o) => o.name).sort()).toEqual(['burn', 'densityMask', 'dodge', 'filter', 'flash', 'preflash']);
    expect(addableOps('print').map((o) => o.name)).toContain('clarity');
    expect(addableOps('print').map((o) => o.name)).not.toContain('heal');
    expect(addableOps('scan').map((o) => o.name)).toEqual([]);
  });
  it('the law in words: amount scales time or density in the darkroom, opacity on the print; blend only where the law has modes', () => {
    expect(amountHint('darkroom', { kind: 'layer', op: 'burn' })).toBe('time');
    expect(amountHint('darkroom', { kind: 'layer', op: 'densityMask' })).toBe('density');
    expect(amountHint('darkroom', { kind: 'group' })).toBe('light');
    expect(amountHint('print', { kind: 'layer', op: 'clarity' })).toBe('opacity');
    expect(amountTrack('darkroom')).toMatchObject({ min: 0, max: 2, hard: [0, 16] });
    expect(amountTrack('print')).toMatchObject({ min: 0, max: 1, hard: [0, 1] });
    expect(blendChoices('darkroom', 'layer')).toEqual(['normal']);
    expect(blendChoices('darkroom', 'group')).toEqual(['pass']);
    expect(blendChoices('print', 'group')[0]).toBe('pass');
  });
});

describe('structural edits are mutations the document rules accept', () => {
  it('add after the selected entry, duplicate with fresh ids, delete', () => {
    let d = neg();
    d = apply(d, addLayer(d, 'darkroom', 'burn').mutations);
    d = apply(d, addLayer(d, 'darkroom', 'dodge', { after: 'main' }).mutations);
    expect(order(d)).toEqual(['main', 'dodge1', 'lights', 'burn1']);
    const dup = duplicateEntry(d, 'burn1');
    d = apply(d, dup.mutations);
    expect(dup.id).toBe('burn2');
    expect(order(d)).toEqual(['main', 'dodge1', 'lights', 'burn1', 'burn2']);
    expect(d.stages.darkroom.stack.items['burn2']).toMatchObject({ name: 'Burn copy', op: 'burn' });
    expect(() => duplicateEntry(d, 'main')).toThrow(/only one/);
    d = apply(d, deleteEntries(d, ['burn2', 'main']));
    expect(order(d)).toEqual(['main', 'dodge1', 'lights', 'burn1']);
  });
  it('a duplicate of a spot layer gets a fresh spot id too (ids are unique in the whole document)', () => {
    let d = neg();
    const spot = { x: 10, y: 10, r: 3, src: { x: 20, y: 10 }, feather: 0.3, opacity: 1 };
    d = apply(d, [{ op: 'insert', coll: 'stages.print.stack', id: 's1', item: layerEntry('heal', { spots: Coll.of([['s1-s', spot]]) as never }, { name: 'Heal 1' }) }]);
    const r = duplicateEntry(d, 's1');
    d = apply(d, r.mutations);
    const copy = d.stages.print.stack.items[r.id] as unknown as { params: { spots: Coll<unknown> } };
    expect(Coll.ids(copy.params.spots)).not.toContain('s1-s');
  });
  it('group and ungroup keep the order; a group fades and masks its children together', () => {
    let d = neg();
    for (const op of ['burn', 'dodge', 'flash'] as const) d = apply(d, addLayer(d, 'darkroom', op).mutations);
    const g = groupEntries(d, ['flash1', 'burn1'], 'Sky');
    d = apply(d, g.mutations);
    expect(order(d)).toEqual(['main', 'lights', g.id, 'dodge1']);
    expect((d.stages.darkroom.stack.items[g.id] as Group).stack.order).toEqual(['burn1', 'flash1']);
    expect(rowsOf(d, 'darkroom').map((r) => `${r.id}:${r.depth}`)).toEqual(['main:0', 'lights:0', 'g1:0', 'burn1:1', 'flash1:1', 'dodge1:0']);
    expect(rowsOf(d, 'darkroom', { collapsed: { g1: true } }).map((r) => r.id)).toEqual(['main', 'lights', 'g1', 'dodge1']);
    d = apply(d, [set('g1.amount', 0.5)]);
    d = apply(d, ungroup(d, 'g1'));
    expect(order(d)).toEqual(['main', 'lights', 'burn1', 'flash1', 'dodge1']);
  });
  it('drops: before, after, into a group, and nothing for a drop into itself', () => {
    let d = neg();
    for (const op of ['burn', 'dodge', 'flash'] as const) d = apply(d, addLayer(d, 'darkroom', op).mutations);
    d = apply(d, dropOn(d, 'flash1', 'main', 'before'));
    expect(order(d)).toEqual(['flash1', 'main', 'lights', 'burn1', 'dodge1']);
    d = apply(d, dropOn(d, 'flash1', 'dodge1', 'after'));
    expect(order(d)).toEqual(['main', 'lights', 'burn1', 'dodge1', 'flash1']);
    d = apply(d, groupEntries(d, ['burn1']).mutations);
    d = apply(d, dropOn(d, 'dodge1', 'g1', 'into'));
    expect((d.stages.darkroom.stack.items['g1'] as Group).stack.order).toEqual(['burn1', 'dodge1']);
    expect(dropOn(d, 'g1', 'burn1', 'before')).toEqual([]);
    expect(dropOn(d, 'g1', 'g1', 'into')).toEqual([]);
    d = apply(d, dropOn(d, 'dodge1', 'main', 'after'));
    expect(order(d)).toEqual(['main', 'dodge1', 'lights', 'g1', 'flash1']);
    d = apply(d, nudgeEntry(d, 'flash1', -1));
    expect(order(d)).toEqual(['main', 'dodge1', 'lights', 'flash1', 'g1']);
  });
  it('blend modes the law has not are refused before the log sees them', () => {
    let d = neg();
    d = apply(d, addLayer(d, 'darkroom', 'burn').mutations);
    expect(() => setBlend(d, 'burn1', 'pass')).toThrow(/light law/);
  });
  it('the finish view filter keeps the Retouch group because a child passes', () => {
    let d = neg();
    const spot = { x: 10, y: 10, r: 3, src: { x: 20, y: 10 }, feather: 0.3, opacity: 1 };
    d = apply(d, [{ op: 'insert', coll: 'stages.print.stack', id: 'retouch', item: { kind: 'group', name: 'Retouch', enabled: true, amount: 1, mask: null, blend: 'pass', source: { kind: 'user' }, stack: Coll.of([['s1', layerEntry('heal', { spots: Coll.of([['s1-s', spot]]) as never })]]) } }]);
    d = apply(d, addLayer(d, 'print', 'clarity').mutations);
    expect(rowsOf(d, 'print', { filter: byOps(['heal', 'clone', 'clarity']) }).map((r) => r.id)).toEqual(['retouch', 's1', 'clarity1']);
    expect(rowsOf(d, 'print', { filter: byOps(['clarity']) }).map((r) => r.id)).toEqual(['clarity1']);
  });
});

describe('masks', () => {
  it('a mask tool adds a component to the selected entry\'s mask (a new mask first), or makes a burn without a target', () => {
    let d = neg();
    d = apply(d, addLayer(d, 'print', 'clarity').mutations);
    const a = maskGesture(d, 'clarity1', 'linear', { from: { x: 0, y: 0 }, to: { x: 0, y: 30 } });
    d = apply(d, a.mutations);
    expect(a).toMatchObject({ layer: 'clarity1', mask: 'm1' });
    const b = maskGesture(d, 'clarity1', 'ellipse', { box: { x: 10, y: 10, w: 20, h: 10 } }, { combine: 'subtract' });
    d = apply(d, b.mutations);
    expect(maskOf(d, 'clarity1')!.components.map(([id, c]) => `${id}:${c.kind}:${c.combine}`)).toEqual(['m1c1:linear:add', 'm1c2:ellipse:subtract']);
    const c = maskGesture(d, null, 'ellipse', { box: { x: 1, y: 1, w: 5, h: 5 } }, { feather_mm: 0.4 });
    d = apply(d, c.mutations);
    expect(c).toMatchObject({ layer: 'burn1', mask: 'm2' });
    expect(d.stages.darkroom.stack.items['burn1']).toMatchObject({ op: 'burn', mask: 'm2' });
    // the main exposure never gets a mask from a tool: the gesture makes a burn instead
    expect(maskGesture(d, 'main', 'linear', componentDefaults('linear')).layer).toBe('burn2');
  });
  it('one mask, several users; deleting the last user or detaching takes the mask out of the library', () => {
    let d = neg();
    d = apply(d, addLayer(d, 'darkroom', 'burn').mutations);
    d = apply(d, addLayer(d, 'darkroom', 'dodge').mutations);
    d = apply(d, newMaskOn(d, 'burn1', 'luminance').mutations);
    d = apply(d, [set('dodge1.mask', 'm1')]);
    expect(maskUsers(d, 'm1')).toEqual(['burn1', 'dodge1']);
    d = apply(d, deleteEntries(d, ['burn1']));
    expect(Coll.has(d.masks, 'm1')).toBe(true);
    d = apply(d, detachMask(d, 'dodge1'));
    expect(Coll.has(d.masks, 'm1')).toBe(false);
  });
});

describe('the scene stage', () => {
  it('a camera file has a scene stage; until the catalogue has scene ops it offers nothing (the Scene module stays out)', () => {
    expect(raw().stages.scene).toBeDefined();
    expect(hasAddableOps('scene')).toBe(addableOps('scene').length > 0);
    expect(rowsOf(neg(), 'scene')).toEqual([]);
  });
});
