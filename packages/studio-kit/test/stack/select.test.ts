// cb.kits.select (CHB-049, MASK-2, D3) through the log, headless on the MockEngine: a selection is the selected
// layer's mask — every selection command is one step on it and one undo; Shift/Alt choose how a part combines; Select
// All, Deselect, Inverse, Grow, Contract, Feather; Use Selection as Mask copies the last selection onto another layer;
// no layer selected is refused with a toast. And MASK-3's mask controls: brush options, the Edit Mask command.
import { describe, expect, it } from 'vitest';
import { Coll } from '@chromobench/values';
import type { Document } from '@chromobench/contract';
import { combineOf, outlineOf } from '../../kits/select/src/commands.ts';
import { started, docOf } from '../helpers.ts';

const steps = (rt: any, f: string) => rt.store.log.inEffect(f).length;
const maskOfEntry = (d: Document, id: string) => {
  const e = d.stages.darkroom.stack.items[id] as { mask: string | null };
  return e.mask ? Coll.get(d.masks, e.mask)! : null;
};
const kinds = (d: Document, id: string) => Coll.values(maskOfEntry(d, id)!.components).map((c) => `${c.kind}:${c.combine}`);

describe('selections are the selected layer\'s mask', () => {
  it('rectangle, ellipse, lasso and wand add parts, one step each; Shift adds, Alt subtracts, both intersect', async () => {
    const { rt, f } = await started();
    await rt.runCommand('layer.add', null, 'dodge', 'darkroom');
    expect(await rt.runCommand('select.rect', null, { x: 2, y: 2, w: 20, h: 10 })).toBe('m1');
    await rt.runCommand('select.ellipse', null, { x: 10, y: 4, w: 8, h: 8 }, { combine: 'subtract' });
    await rt.runCommand('select.lasso', null, [[0, 0], [30, 2], [12, 20]], { combine: 'intersect' });
    await rt.runCommand('select.wand', null, 5, 5, { tolerance: 0.2, contiguous: false });
    const d = docOf(rt, f);
    expect(kinds(d, 'dodge1')).toEqual(['rect:add', 'ellipse:subtract', 'polygon:intersect', 'wand:add']);
    const wand = Coll.values(maskOfEntry(d, 'dodge1')!.components)[3]!;
    expect(wand.params).toMatchObject({ seed: { x: 5, y: 5 }, tolerance: 0.2, contiguous: false });
    // a selection's edge is its own: no feather on a mask made by selecting
    expect(maskOfEntry(d, 'dodge1')!.feather_mm).toBe(0);
    expect(steps(rt, f)).toBe(5);
    for (let i = 0; i < 4; i++) rt.undo();
    expect(maskOfEntry(docOf(rt, f), 'dodge1')).toBeNull();
    expect(combineOf({ shift: true }, rt.state)).toBe('add');
    expect(combineOf({ alt: true }, rt.state)).toBe('subtract');
    expect(combineOf({ shift: true, alt: true }, rt.state)).toBe('intersect');
    expect(combineOf({}, rt.state)).toBe('add');
  });

  it('Select All, Inverse, Grow, Contract, Feather change the mask; Deselect removes it (the layer acts everywhere)', async () => {
    const { rt, f } = await started();
    await rt.runCommand('layer.add', null, 'burn', 'darkroom');
    await rt.runCommand('select.rect', null, { x: 2, y: 2, w: 20, h: 10 });
    await rt.runCommand('select.ellipse', null, { x: 10, y: 4, w: 8, h: 8 });
    await rt.runCommand('select.all', null);
    let m = maskOfEntry(docOf(rt, f), 'burn1')!;
    expect(Coll.values(m.components).map((c) => c.kind)).toEqual(['rect']);
    expect(Coll.values(m.components)[0]!.params['box']).toMatchObject({ x: 0, y: 0 });
    await rt.runCommand('select.invert', null);
    await rt.runCommand('select.grow', null);
    await rt.runCommand('select.grow', null, 1);
    await rt.runCommand('select.contract', null, 0.25);
    await rt.runCommand('select.feather', null, 2);
    m = maskOfEntry(docOf(rt, f), 'burn1')!;
    expect(m).toMatchObject({ invert: true, grow_mm: 1.25, feather_mm: 2 });
    await rt.runCommand('select.none', null);
    expect(maskOfEntry(docOf(rt, f), 'burn1')).toBeNull();
    expect(Coll.size(docOf(rt, f).masks)).toBe(0);
    rt.undo();
    expect(maskOfEntry(docOf(rt, f), 'burn1')).toMatchObject({ invert: true });
  });

  it('Use Selection as Mask: the last selection, copied with fresh ids, onto the selected layer', async () => {
    const { rt, f } = await started();
    await rt.runCommand('layer.add', null, 'burn', 'darkroom');
    await rt.runCommand('select.lasso', null, [[0, 0], [30, 2], [12, 20]]);
    await rt.runCommand('select.wand', null, 3, 3, { combine: 'subtract' });
    await rt.runCommand('layer.add', null, 'dodge', 'darkroom');
    expect(rt.commands.status('select.toLayer', rt.state).ok).toBe(true);
    const nm = await rt.runCommand('select.toLayer', null);
    const d = docOf(rt, f);
    expect(nm).toBe('m2');
    expect((d.stages.darkroom.stack.items['dodge1'] as any).mask).toBe('m2');
    expect(kinds(d, 'dodge1')).toEqual(['polygon:add', 'wand:subtract']);
    expect(Coll.ids(Coll.get(d.masks, 'm2')!.components)).toEqual(['m2c1', 'm2c2']);
    // the original stays with its layer
    expect(kinds(d, 'burn1')).toEqual(['polygon:add', 'wand:subtract']);
  });

  it('no layer selected (or the main exposure): refused with a toast, nothing changes', async () => {
    const { rt, f } = await started();
    const toasts: string[] = [];
    const t0 = rt.chrome.toast.bind(rt.chrome);
    (rt.chrome as any).toast = (m: string, o?: unknown) => {
      toasts.push(m);
      return t0(m, o as never);
    };
    expect(await rt.runCommand('select.rect', null, { x: 2, y: 2, w: 20, h: 10 })).toBeNull();
    await rt.runCommand('layer.select', null, 'main');
    expect(await rt.runCommand('select.rect', null, { x: 2, y: 2, w: 20, h: 10 })).toBeNull();
    expect(toasts.at(-1)).toMatch(/Select a layer first/);
    expect(steps(rt, f)).toBe(0);
  });

  it('a lasso\'s outline is simplified to half a pixel', () => {
    const pts = Array.from({ length: 50 }, (_, i) => [i, i * 0.5 + (i % 2 ? 0.1 : 0)]);
    expect(outlineOf([...pts, [0, 40]]).length).toBeLessThan(6);
  });
});

describe('mask controls (MASK-3)', () => {
  it('brush options are view state through mask.brush, held to their ranges; Edit Mask arms its tool on a part', async () => {
    const { rt } = await started();
    expect(await rt.runCommand('mask.brush', null, { size: 30, hardness: 2, flow: 0.4 })).toEqual({ size: 30, hardness: 1, flow: 0.4 });
    await rt.runCommand('layer.add', null, 'dodge', 'darkroom');
    await rt.runCommand('select.rect', null, { x: 2, y: 2, w: 20, h: 10 });
    await rt.runCommand('mask.edit', null, 'm1c1');
    expect((rt.state as any).ui.tool).toBe('mask-edit');
    expect((rt.state as any).stack.mask.edit).toBe('m1c1');
  });

  it('density, expand and a part\'s invert are one step each through mask.set', async () => {
    const { rt, f } = await started();
    await rt.runCommand('layer.add', null, 'dodge', 'darkroom');
    await rt.runCommand('select.rect', null, { x: 2, y: 2, w: 20, h: 10 });
    await rt.runCommand('mask.set', null, 'm1.density', 0.6, 'Mask density 60 %');
    await rt.runCommand('mask.set', null, 'm1.grow_mm', -0.5, 'Mask expand −0.5 mm');
    await rt.runCommand('mask.set', null, 'm1c1.invert', true, 'Invert a mask part');
    const m = maskOfEntry(docOf(rt, f), 'dodge1')!;
    expect(m).toMatchObject({ density: 0.6, grow_mm: -0.5 });
    expect(Coll.get(m.components, 'm1c1')!.invert).toBe(true);
    expect(steps(rt, f)).toBe(5);
  });
});
