// The stack kit is generic over the catalogue. P8a's ops (curve, levels, exposure, hsl, …) reach "+ Layer" of the
// scene and print stages by their catalogue `stages` and `ui` (label, menu, order), the classic layout places its
// Scene module because the scene stage has ops, and an op registered here (print only, an argument marked
// `ui.advanced`) appears in the print stage's menu and adds with its defaults — no change in the kit. The test op is
// registered in this file only (vitest isolates the registry per file).
import { describe, expect, it } from 'vitest';
import { edit, newDocument, registerOp, type Document } from '@chromobench/contract';
import { buildLayout } from '../../src/index.ts';
import { LAYOUTS } from '../../layouts/index.js';
import { addableOps, addLayer, addMenu, hasAddableOps } from '../../kits/stack/src/model.ts';

registerOp({
  name: 'tone', area: 'composite', owner: 'test', on: 'Image', returns: 'Image', domainIn: ['print-rgb'], domainOut: 'same',
  class: 'pointwise', binding: 'setting', stages: ['print'], encoding: 'linear', ui: { label: 'Test tone', menu: 'tone', order: 99 },
  identity: (p: Record<string, unknown>) => p['lift'] === 0,
  args: {
    lift: { type: 'number', unit: 'fraction', min: -1, max: 1, default: 0, doc: 'Lift.', ui: { widget: 'slider', step: 0.01, label: 'Lift' } },
    knee: { type: 'number', unit: 'fraction', min: 0, max: 1, default: 0.5, doc: 'Knee.', ui: { widget: 'slider', step: 0.01, label: 'Knee', advanced: true } },
  },
  doc: 'A test tone op.',
} as never);

describe('the catalogue reaches the panels unchanged', () => {
  it('P8a\'s ops are in + Layer of the scene and print stages, in their menus and order', () => {
    expect(hasAddableOps('scene')).toBe(true);
    const scene = addableOps('scene').map((o) => o.name);
    expect(scene).toEqual(expect.arrayContaining(['curve', 'levels', 'exposure', 'hsl', 'grade']));
    // print: the spot ops (heal, clone) come from the spot tool, not the menu
    expect(addableOps('print').map((o) => o.name)).not.toContain('heal');
    // a flat list with a separator between the catalogue's menus (tone, colour, detail, effect), submenus past 14
    const menu = addMenu('print').map((x) => (typeof x === 'object' ? x.label : x));
    expect(menu.slice(0, 3)).toEqual(['Exposure', 'Curve', 'Levels']);
    expect(menu.filter((x) => x === '-')).toHaveLength(3);
    expect(menu).toContain('Clarity');
    expect(addMenu('print', undefined, 4).map((x) => (typeof x === 'object' && 'items' in x ? x.label : null))).toEqual(['Tone', 'Colour', 'Detail', 'Effect']);
    // the darkroom: one menu (light), flat
    expect(addMenu('darkroom').map((x) => (typeof x === 'object' ? x.label : x))).toEqual(['Burn', 'Dodge', 'Flash', 'Preflash', 'Density mask', 'Filter']);
  });
  it('a newly registered op adds with its defaults', () => {
    expect(addableOps('print').map((o) => o.name)).toContain('tone');
    const d0: Document = newDocument('negative-scan', { sha256: 'ab'.repeat(32), width: 96, height: 64 });
    const d = edit(d0, addLayer(d0, 'print', 'tone').mutations).doc;
    expect(d.stages.print.stack.items['tone1']).toMatchObject({ op: 'tone', name: 'Test tone', params: { lift: 0, knee: 0.5 }, amount: 1, blend: 'normal' });
  });
  it('the classic layout places the Scene module once the catalogue has scene ops', async () => {
    const { app } = buildLayout((await LAYOUTS.classic()).default);
    expect(app.diagnostics.list.filter((d) => d.level === 'error')).toEqual([]);
    expect(app.explain()).toMatch(/module scene "Scene" key Mod\+Alt\+S stages scene/);
  });
});
