// *.cblook.js (design §31; CHB-037 P7): a look function written as code, evaluated in its own QuickJS sandbox and
// registered by name and version; its link expands at compile like a built-in look's. The sandbox is pure (no clock,
// no randomness) and its output is checked.
import { describe, expect, it } from 'vitest';
import { compile, edit, Graph, insertLink, linksOf, newDocument, resolveLinks, type Group } from '@chromobench/contract';
import { defineLookSource } from '../src/index.ts';

const SRC = `
defineLook({
  name: 'test-sandbox-warm', version: 1, label: 'Sandbox warm', group: 'Mine', doc: 'warmer light, from a file',
  params: { warmth: { type: 'number', unit: 'point', min: 0, max: 10, default: 4, doc: 'points between red and blue' } },
  stages: ['darkroom'],
  fn: (p, input) => ({
    stacks: { darkroom: { order: ['f'], items: { f: {
      kind: 'layer', op: 'filter', params: { logH: [-p.warmth * 0.0125, 0, p.warmth * 0.0125] },
      name: 'Warmth (' + input.kind + ')', enabled: true, amount: 1, mask: null, blend: 'normal', source: { kind: 'look' },
    } } } },
  }),
});`;

const doc = () => newDocument('negative-scan', { sha256: 'c'.repeat(64) }, { frame: 'f', umPerPx: 6 });

describe('*.cblook.js in the sandbox', () => {
  it('registers the look; its link expands at compile with the params and the frame kind', async () => {
    const def = await defineLookSource(SRC, { file: 'warm.cblook.js' });
    expect(def).toMatchObject({ name: 'test-sandbox-warm', version: 1, label: 'Sandbox warm', stages: ['darkroom'] });
    const d = doc();
    const linked = edit(d, insertLink(d, { look: 'test-sandbox-warm', version: 1 }, { key: 'w', params: { warmth: 8 }, amount: 0.5 })).doc;
    expect(linksOf(linked)).toHaveLength(1);
    const g = resolveLinks(linked).stages.darkroom.stack.items['w-darkroom'] as Group;
    expect(g.stack.items['w-darkroom--f']).toMatchObject({ op: 'filter', params: { logH: [-0.1, 0, 0.1] }, name: 'Warmth (negative-scan)' });
    const gr = new Graph();
    gr.registerSource({ sha256: 'c'.repeat(64), format: 'tiff', width: 8, height: 6, channels: 3, bits: 16, sample: 'uint', encoding: { value: 'linear', evidence: 'format' }, levels: { black: [0], white: [65535], from: 'default' }, clippedFraction: 0, notes: [] });
    expect(compile(linked, gr).display.id).not.toBe(compile(d, gr).display.id);
  });

  it('is pure: no clock, no randomness; a bad result or a second look is refused', async () => {
    await defineLookSource(SRC.replace("'test-sandbox-warm'", "'test-sandbox-random'").replace('p.warmth * 0.0125, 0', 'Math.random(), 0'));
    const d = doc();
    const linked = edit(d, insertLink(d, { look: 'test-sandbox-random', version: 1 }, { key: 'r' })).doc;
    expect(() => resolveLinks(linked)).toThrow(/Math.random is not available/);
    await expect(defineLookSource(`defineLook({ name: 'test-sandbox-date', version: 1, stages: ['darkroom'], fn: () => ({ stacks: { darkroom: { order: [], items: {} } } }) }); Date.now()`)).rejects.toThrow(/Date/);
    await defineLookSource(`defineLook({ name: 'test-sandbox-bad', version: 1, stages: ['darkroom'], fn: () => ({ stacks: { print: { order: [], items: {} } } }) })`);
    const bad = edit(d, insertLink(d, { look: 'test-sandbox-bad', version: 1 }, { key: 'b' })).doc;
    expect(() => resolveLinks(bad)).toThrow(/does not declare in stages/);
    await expect(defineLookSource(`defineLook({ name: 'a', version: 1, stages: ['darkroom'], fn() {} }); defineLook({ name: 'b', version: 1, stages: ['darkroom'], fn() {} })`)).rejects.toThrow(/one look/);
    await expect(defineLookSource(`while (true) {}`, { timeoutMs: 20 })).rejects.toThrow(/interrupted/i);
  });
});
