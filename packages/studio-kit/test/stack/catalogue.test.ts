// The stack kit is generic over the catalogue: an op registered with stages ['scene', 'print'] (the shape of P8a's
// curve, levels, …) appears in "+ Layer" for both stages, adds with its ArgSpec defaults, gets generated controls
// (an argument marked advanced goes under Advanced), and the classic layout grows its Scene module, without a change
// in the kit. The op is registered in this file only (vitest isolates the registry per file).
import { describe, expect, it } from 'vitest';
import { edit, newDocument, registerOp, type Document } from '@chromobench/contract';
import { buildLayout } from '../../src/index.ts';
import { LAYOUTS } from '../../layouts/index.js';
import { addableOps, addLayer, hasAddableOps } from '../../kits/stack/src/model.ts';

const scene0 = hasAddableOps('scene');
registerOp({
  name: 'tone', area: 'composite', owner: 'test', on: 'Image', returns: 'Image', domainIn: ['scene-xyz', 'print-xyz'], domainOut: 'same',
  class: 'pointwise', binding: 'setting', stages: ['scene', 'print'], encoding: 'linear',
  identity: (p: Record<string, unknown>) => p['lift'] === 0,
  args: {
    lift: { type: 'number', unit: 'fraction', min: -1, max: 1, default: 0, doc: 'Lift.', ui: { widget: 'slider', step: 0.01, label: 'Lift' } },
    knee: { type: 'number', unit: 'fraction', min: 0, max: 1, default: 0.5, doc: 'Knee.', ui: { widget: 'slider', step: 0.01, label: 'Knee', advanced: true } as never },
  },
  doc: 'A test tone op.',
} as never);

describe('a new op of the catalogue reaches the panels unchanged', () => {
  it('+ Layer offers it in both stages; it adds with its defaults', () => {
    expect(scene0).toBe(false);
    expect(addableOps('scene').map((o) => o.name)).toEqual(['tone']);
    expect(addableOps('print').map((o) => o.name)).toContain('tone');
    const d0: Document = newDocument('digital-raw', { sha256: 'ab'.repeat(32), width: 96, height: 64 });
    const r = addLayer(d0, 'scene', 'tone');
    const d = edit(d0, r.mutations).doc;
    expect(d.stages.scene!.stack.items['tone1']).toMatchObject({ op: 'tone', params: { lift: 0, knee: 0.5 }, amount: 1, blend: 'normal' });
  });
  it('the classic layout places the Scene module once the catalogue has scene ops', async () => {
    const { app } = buildLayout((await LAYOUTS.classic()).default);
    expect(app.diagnostics.list.filter((d) => d.level === 'error')).toEqual([]);
    expect(app.explain()).toMatch(/module scene "Scene" key Mod\+Alt\+S stages scene/);
  });
});
