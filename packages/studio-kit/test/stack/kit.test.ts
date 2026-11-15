// cb.kits.stack through the log (headless, MockEngine): every command is one step of the frame's document and one
// undo; the commands act on the selected entry; a refusal is a toast and changes nothing; provenance says who
// changed an entry (an approved agent proposal); the stage policy pass (CB-S101, CB-S102); every layout has the kit.
import { describe, expect, it } from 'vitest';
import { Coll } from '@chromobench/values';
import type { Document, Group } from '@chromobench/contract';
import { buildLayout, defineLayout } from '../../src/index.ts';
import { provenance } from '../../kits/stack/src/model.ts';
import { started, docOf } from '../helpers.ts';

const steps = (rt: any, f: string) => rt.store.log.inEffect(f).length;
const darkroom = (d: Document) => d.stages.darkroom.stack;

describe('the stack commands are steps of the log', () => {
  it('add, select, amount, toggle, duplicate, group, ungroup, move, delete: one step each, each undone by one undo', async () => {
    const { rt, f } = await started();
    expect(await rt.runCommand('layer.add', null, 'burn', 'darkroom')).toBe('burn1');
    expect((rt.state as any).stack.selected[f]).toBe('burn1');
    expect(steps(rt, f)).toBe(1);
    await rt.runCommand('layer.amount', null, 'burn1', 0.5);
    expect((darkroom(docOf(rt, f)).items['burn1'] as any).amount).toBe(0.5);
    // the commands act on the selected entry without an id
    await rt.runCommand('layer.toggle', null);
    expect((darkroom(docOf(rt, f)).items['burn1'] as any).enabled).toBe(false);
    expect(await rt.runCommand('layer.duplicate', null)).toBe('burn2');
    expect(darkroom(docOf(rt, f)).order).toEqual(['main', 'lights', 'burn1', 'burn2']);
    const g = await rt.runCommand('layer.group', null, ['burn1', 'burn2']);
    expect(g).toBe('g1');
    expect((darkroom(docOf(rt, f)).items['g1'] as Group).stack.order).toEqual(['burn1', 'burn2']);
    await rt.runCommand('layer.move', null, 'burn2', 'main', 'before');
    expect(darkroom(docOf(rt, f)).order).toEqual(['burn2', 'main', 'lights', 'g1']);
    await rt.runCommand('layer.ungroup', null, 'g1');
    expect(darkroom(docOf(rt, f)).order).toEqual(['burn2', 'main', 'lights', 'burn1']);
    await rt.runCommand('layer.rename', null, 'burn1', 'Sky');
    expect((darkroom(docOf(rt, f)).items['burn1'] as any).name).toBe('Sky');
    await rt.runCommand('layer.delete', null, 'burn2');
    expect(steps(rt, f)).toBe(9);
    expect(rt.store.log.undoStep?.label).toMatch(/^Delete/);
    for (let i = 0; i < 9; i++) rt.undo();
    expect(darkroom(docOf(rt, f)).order).toEqual(['main', 'lights']);
  });

  it('masks: a new mask, a second component, invert, detach; each one step', async () => {
    const { rt, f } = await started();
    await rt.runCommand('layer.add', null, 'dodge', 'darkroom');
    expect(await rt.runCommand('mask.new', null, 'luminance')).toBe('m1');
    await rt.runCommand('mask.addComponent', null, 'linear', 'intersect');
    await rt.runCommand('mask.set', null, 'm1.invert', true, 'Invert');
    const d = docOf(rt, f);
    expect((darkroom(d).items['dodge1'] as any).mask).toBe('m1');
    const m = Coll.get(d.masks, 'm1')!;
    expect(m.invert).toBe(true);
    expect(Coll.values(m.components).map((c) => `${c.kind}:${c.combine}`)).toEqual(['luminance:add', 'linear:intersect']);
    await rt.runCommand('mask.detach', null);
    expect(Coll.has(docOf(rt, f).masks, 'm1')).toBe(false);
    expect(steps(rt, f)).toBe(5);
  });

  it('a refusal by the document rules is a toast; the document and the log are unchanged', async () => {
    const { rt, f } = await started();
    const toasts: string[] = [];
    const t0 = rt.chrome.toast.bind(rt.chrome);
    (rt.chrome as any).toast = (m: string, o?: unknown) => {
      toasts.push(m);
      return t0(m, o as never);
    };
    // the light law has no isolated groups and no blend modes
    await rt.runCommand('layer.add', null, 'burn', 'darkroom');
    await rt.runCommand('layer.blend', null, 'burn1', 'multiply');
    expect(toasts.at(-1)).toMatch(/light law/);
    // a layer op in a stage it does not live in
    await rt.runCommand('layer.add', null, 'clarity', 'darkroom');
    expect(toasts.at(-1)).toMatch(/does not live in the darkroom/);
    expect(steps(rt, f)).toBe(1);
  });

  it('provenance: an entry an agent proposal changed, once approved, says Agent; untouched ones the opening', async () => {
    const { rt, f, studio } = await started();
    await rt.runCommand('layer.add', null, 'burn', 'darkroom');
    const seq = studio.propose([{ op: 'set', path: 'burn1.amount', value: 0.7 }], { why: 'softer' });
    expect(studio.approve(seq)).toEqual({ ok: true });
    const p = provenance(rt.store.log, f);
    expect(p.get('burn1')).toMatchObject({ by: 'agent', approvedBy: 'user' });
    expect(p.get('main')!.seq).toBe(0);
    expect(rt.store.log.why(f, 'burn1').by).toBe('agent');
  });
});

describe('the stage policy pass (replaces CB-F101)', () => {
  const diags = (def: unknown, code: string) => buildLayout(def).app.diagnostics.list.filter((d) => d.code === code).map((d) => `${d.level}: ${d.message}`);
  it('CB-S101: a stack of a stage the module does not declare; declaring it documents the mix', () => {
    const mixed = (stages?: string[]) => defineLayout({ id: 'x', label: 'x', build: (ck, cb) => cb.studio('X').module(ck.module('dr', { label: 'Darkroom', ...(stages ? { stages } : {}) }).right(ck.dock.column({}, cb.kits['stack'].panels.enlarger(), cb.kits['stack'].panels.layers('print')))) });
    expect(diags(mixed(['darkroom']), 'CB-S101')).toEqual([`warning: stack.layers('print') shows the print stage in the module 'Darkroom', which declares darkroom`]);
    // the Enlarger's own controls sit in its θ row lambda (made at interaction time), so the pass sees its two stacks
    expect(diags(mixed(), 'CB-S101')).toHaveLength(2);
    expect(diags(mixed(['darkroom', 'print']), 'CB-S101')).toEqual([]);
  });
  it('CB-S102: an unknown stage, with a did-you-mean', () => {
    const typo = defineLayout({ id: 'x', label: 'x', build: (ck, cb) => cb.studio('X').module(ck.module('m', { stages: ['prnt'] })) });
    const d = buildLayout(typo).app.diagnostics.list.find((x) => x.code === 'CB-S102')!;
    expect(d.level).toBe('error');
    expect(d.fix).toBe(`'print'`);
  });
  it('a module states its stages with the modifier too, and explain shows them', () => {
    const def = defineLayout({ id: 'x', label: 'x', build: (ck, cb) => cb.studio('X').module(ck.module('m', { label: 'M' }).stages('print').right(cb.kits['stack'].panels.layers('print'))) });
    const { app } = buildLayout(def);
    expect(app.diagnostics.list.filter((x) => x.code === 'CB-S101')).toEqual([]);
    expect(app.explain()).toMatch(/module m "M" stages print/);
  });
});
