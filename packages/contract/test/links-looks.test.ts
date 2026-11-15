// Look functions, presets, bake and linked media (design §27, §31, D2, D5): links expand at compile with the law's
// amount; a baked link compiles to the same graph; a look over two stages shares one key and one Amount; presets are
// looks without parameters; a linked medium's per-frame changes are overrides (divergence), and reads and writes
// go through the link.
import { describe, expect, it } from 'vitest';
import { Coll, set } from '@chromobench/values';
import {
  allLooks, bakeLink, BUILTIN_LOOKS, compile, defineLook, divergence, edit, followLink, getLook, insertLink, layerEntry, linkMedium, linkSiblings, linksOf,
  lookAsPreset, lookParams, makePreset, readField, removeLink, resolveLinks, setLinkAmount, setLinkParams, storedMutations, storedPath, unlinkMedium,
  validateDocument, validatePreset,
  type Document, type Entry, type Group, type LinkContext, type Preset, type Roll,
} from '@chromobench/contract';
import { camDoc, diagOf, graph, maskOf, scanDoc } from './helpers.ts';

const warm = { look: 'warm-print', version: 1 } as const;
const terms = (d: Document, ctx: LinkContext = {}) => compile(d, graph(), { links: ctx }).cuts['darkroom.H']!.args as { filters: { logH: number[]; amount: number }[]; terms: unknown[] };

describe('look functions', () => {
  it('the built-ins are registered, versioned and give valid groups on both kinds of frame', () => {
    expect(allLooks().map((l) => l.name)).toEqual(expect.arrayContaining(BUILTIN_LOOKS.map((l) => l.name)));
    for (const def of BUILTIN_LOOKS) {
      for (const d of [scanDoc(), camDoc()]) {
        const doc = edit(d, insertLink(d, { look: def.name, version: def.version }, { key: 'k' }, { size: [12, 10] })).doc;
        expect(validateDocument(doc)).toEqual([]);
        const r = resolveLinks(doc, { size: [12, 10] });
        expect(validateDocument(r)).toEqual([]);
        expect(() => compile(doc, graph())).not.toThrow();
      }
    }
    expect(diagOf(() => getLook('warm-prnt')).hint).toMatch(/warm-print/);
    expect(diagOf(() => defineLook({ ...getLook('warm-print'), fn: () => ({ stacks: {} }) })).code).toBe('E_LINK');
  });

  it('a link entry expands to the group the look returns, at the link\'s amount (the light law scales the filter)', () => {
    const d = scanDoc();
    const doc = edit(d, insertLink(d, warm, { key: 'w1', params: { warmth: 6 }, amount: 0.5 })).doc;
    expect(Coll.ids(doc.stages.darkroom.stack)).toEqual(['main', 'lights', 'w1-darkroom']);
    const g = resolveLinks(doc).stages.darkroom.stack.items['w1-darkroom'] as Group;
    expect(g).toMatchObject({ kind: 'group', amount: 0.5, source: { kind: 'look', link: 'w1', ref: warm } });
    expect(Coll.ids(g.stack)).toEqual(['w1-darkroom--warmth']);
    const f = terms(doc).filters.find((x) => x.amount === 0.5)!;
    expect(f.logH[0]).toBeCloseTo(-3 * 0.025, 9);
    expect(f.logH[2]).toBeCloseTo(3 * 0.025, 9);
    // amount 2 is twice the density of the filter, amount 0 no light at all: the print of the frame without the look
    const g0 = graph();
    const zero = edit(doc, setLinkAmount(doc, 'w1', 0)).doc;
    expect(compile(zero, g0).display.id).toBe(compile(d, g0).display.id);
  });

  it('params are checked and filled with their defaults; a changed param re-expands', () => {
    expect(lookParams(getLook('warm-print'), {})).toEqual({ warmth: 4, density: 0 });
    expect(diagOf(() => lookParams(getLook('warm-print'), { warmht: 2 }))).toMatchObject({ code: 'E_UNKNOWN_OPTION', fix: 'warmth' });
    expect(diagOf(() => lookParams(getLook('warm-print'), { warmth: 40 })).code).toBe('E_ARG_RANGE');
    const d = scanDoc();
    const doc = edit(d, insertLink(d, warm, { key: 'w1' })).doc;
    const more = edit(doc, setLinkParams(doc, 'w1', { warmth: 8 })).doc;
    expect(terms(more).filters.at(-1)!.logH[2]).toBeCloseTo(4 * 0.025, 9);
  });

  it('a look over two stages: one link per stage, one key, one Amount clamped to each law', () => {
    const d = scanDoc();
    const doc = edit(d, insertLink(d, { look: 'crisp-warm', version: 1 }, { key: 'cw', amount: 1.5 })).doc;
    const sib = linkSiblings(doc, 'cw');
    expect(sib.map((l) => [l.id, l.stage, l.entry.amount])).toEqual([['cw-darkroom', 'darkroom', 1.5], ['cw-print', 'print', 1]]);
    const half = edit(doc, setLinkAmount(doc, 'cw', 0.4)).doc;
    expect(linkSiblings(half, 'cw').map((l) => l.entry.amount)).toEqual([0.4, 0.4]);
    expect(Coll.ids(edit(doc, removeLink(doc, 'cw')).doc.stages.print.stack)).toEqual([]);
    const c = compile(doc, graph());
    expect(c.entries['cw-print--clarity']).toBeDefined();
  });

  it('a look may read the document: the neutral filter follows the printer lights', () => {
    const d = edit(scanDoc(), [set('lights.params.logH', [0.1, 0, -0.1])]).doc;
    const doc = edit(d, insertLink(d, { look: 'neutral', version: 1 }, { key: 'n' })).doc;
    expect(terms(doc).filters.at(-1)!.logH).toEqual([-0.1, 0, 0.1]);
  });

  it('a look with a mask brings it with prefixed ids; the image size comes from the graph', () => {
    const d = scanDoc();
    const doc = edit(d, insertLink(d, { look: 'edge-burn', version: 1 }, { key: 'e' })).doc;
    const r = resolveLinks(doc, { size: [12, 10] });
    expect(r.masks.order).toEqual(['e-darkroom--edges']);
    expect((r.stages.darkroom.stack.items['e-darkroom'] as Group).stack.items['e-darkroom--burn']!.mask).toBe('e-darkroom--edges');
    expect(compile(doc, graph()).entries['e-darkroom--burn']).toBeDefined();
    expect(diagOf(() => resolveLinks(doc)).message).toMatch(/image size/);
  });

  it('a look that needs a kind of frame refuses the other kind (E_KIND at insert, E_LINK at compile)', () => {
    defineLook({ name: 'test-scans-only', version: 1, label: 'Scans only', group: 'Test', doc: '', params: {}, stages: ['darkroom'], kinds: ['negative-scan'], fn: () => ({ stacks: { darkroom: Coll.empty() } }) });
    const c = camDoc();
    expect(diagOf(() => insertLink(c, { look: 'test-scans-only', version: 1 }, { key: 'x' })).code).toBe('E_KIND');
  });
});

describe('bake', () => {
  it('a baked look compiles to the same graph, keeps its masks and records the link', () => {
    const d = scanDoc();
    const doc = edit(d, [...insertLink(d, { look: 'edge-burn', version: 1 }, { key: 'e', amount: 0.7 }), ...insertLink(d, { look: 'crisp-warm', version: 1 }, { key: 'cw' })]).doc;
    const g = graph();
    for (const key of ['e', 'cw']) {
      const baked = edit(doc, bakeLink(doc, key, { size: [12, 10] })).doc;
      expect(validateDocument(baked)).toEqual([]);
      expect(compile(baked, g).display.id).toBe(compile(doc, g).display.id);
    }
    const baked = edit(doc, bakeLink(doc, 'e', { size: [12, 10] })).doc;
    expect(baked.stages.darkroom.stack.items['e-darkroom']).toMatchObject({ kind: 'group', amount: 0.7, source: { kind: 'baked', link: 'e', ref: { look: 'edge-burn', version: 1 } } });
    expect(baked.masks.order).toEqual(['e-darkroom--edges']);
    expect(linksOf(baked).map((l) => l.id)).toEqual(['cw-darkroom', 'cw-print']);
    expect(diagOf(() => bakeLink(doc, 'nope')).code).toBe('E_LINK');
  });
});

describe('presets', () => {
  const preset = (): Preset => makePreset('p-sky', 'Sky burn', {
    darkroom: Coll.of<Entry>([['burn', layerEntry('burn', { stops: 0.5 }, { mask: 'sky' })]]),
  }, Coll.of([['sky', maskOf([['c', { kind: 'linear', params: { from: { x: 0, y: 0 }, to: { x: 0, y: 5 } }, combine: 'add', amount: 1, enabled: true }]])], ['unused', maskOf([])]]));

  it('a preset is a look without parameters: stored entries and the masks they use', () => {
    const p = preset();
    expect(validatePreset(p)).toEqual([]);
    expect(p.masks.order).toEqual(['sky']);
    const presets = (id: string) => (id === 'p-sky' ? p : undefined);
    const d = scanDoc();
    const doc = edit(d, insertLink(d, { preset: 'p-sky' }, { key: 's' }, { presets })).doc;
    const c = compile(doc, graph(), { links: { presets } });
    expect(c.entries['s-darkroom--burn']).toBeDefined();
    expect(diagOf(() => compile(doc, graph())).code).toBe('E_LINK');
    const baked = edit(doc, bakeLink(doc, 's', { presets })).doc;
    expect(baked.masks.order).toEqual(['s-darkroom--sky']);
    expect(validatePreset({ ...p, version: 2 })[0]!.message).toMatch(/version 2/);
    expect(validatePreset({ ...p, stacks: { film: Coll.empty() } })[0]!.code).toBe('E_FORMAT');
  });

  it('a look at chosen parameters saved as a preset expands to the same entries', () => {
    const d = scanDoc();
    const p = lookAsPreset(d, warm, { warmth: 6 }, { id: 'p-w' });
    expect(p.name).toBe('Warm print (warmth 6, density 0)');
    const presets = () => p;
    const a = edit(d, insertLink(d, warm, { key: 'k', params: { warmth: 6 } })).doc;
    const b = edit(d, insertLink(d, { preset: 'p-w' }, { key: 'k' }, { presets })).doc;
    const g = graph();
    expect(compile(b, g, { links: { presets } }).display.id).toBe(compile(a, g).display.id);
  });
});

describe('linked media', () => {
  const roll = (): Roll => ({
    id: 'r1', label: 'Roll 1', frames: ['f1'], analysis: null, reference: null, match: null, status: 'set-up', stacks: {},
    media: { scan: { scanner: 'xt5-rgb-led', stock: 'kodak_gold_200', format: '135', flat: null, openGate: null, flare: 0, baseT: [0.8, 0.6, 0.4] } },
  });
  const linked = () => {
    const r = roll();
    const d = edit(scanDoc(), [set('stages.scan.medium.stock', 'kodak_portra_400')]).doc;
    return { r, rolls: (id: string) => (id === 'r1' ? r : undefined), doc: edit(d, [linkMedium(d, 'scan', { roll: 'r1' }, r.media.scan!)]).doc };
  };

  it('linking keeps the frame\'s own fields and its departures as overrides (divergence)', () => {
    const { doc, rolls, r } = linked();
    expect(doc.stages.scan!.medium).toEqual({ link: { roll: 'r1' }, overrides: { stock: 'kodak_portra_400', umPerPx: 6, rebate: null, baseT: null } });
    expect(divergence(doc, 'scan', r.media.scan!)).toEqual(['stock', 'baseT']);
    expect(resolveLinks(doc, { rolls }).stages.scan!.medium).toMatchObject({ scanner: 'xt5-rgb-led', stock: 'kodak_portra_400', umPerPx: 6 });
    // follow the roll again: the override goes, the roll's value shows
    const back = edit(doc, [followLink(doc, 'scan', 'stock')!]).doc;
    expect(readField(back, 'stages.scan.medium.stock', { rolls })).toBe('kodak_gold_200');
    expect(divergence(back, 'scan', r.media.scan!)).toEqual(['baseT']);
  });

  it('a set of a medium field on a linked medium is an override; reads go through the link', () => {
    const { doc, rolls } = linked();
    expect(storedPath(doc, 'stages.scan.medium.flare')).toBe('stages.scan.medium.overrides.flare');
    expect(storedPath(doc, 'stages.darkroom.medium.grade')).toBe('stages.darkroom.medium.grade');
    const d2 = edit(doc, storedMutations(doc, [set('stages.scan.medium.flare', 2)])).doc;
    expect(validateDocument(d2)).toEqual([]);
    expect(readField(d2, 'stages.scan.medium.flare', { rolls })).toBe(2);
    expect(readField(d2, 'stages.scan.medium.scanner', { rolls })).toBe('xt5-rgb-led');
    expect(readField(d2, 'stages.scan.medium.scanner')).toBeUndefined();
    expect(readField(d2, 'main.params.time_s')).toBe(10);
    expect(diagOf(() => edit(doc, [set('stages.scan.medium.overrides.nope', 1)])).code).toBe('E_PATH');
    // a roll change reaches the frame; unlinking gives the plain medium
    const g = graph();
    const c = compile(d2, g, { links: { rolls } });
    expect(g.closure(c.cuts.scan!.id).find((n) => n.op === 'scan.flare')!.args).toMatchObject({ flare: 2 });
    const plain = edit(d2, [unlinkMedium(d2, 'scan', { rolls })]).doc;
    expect(compile(plain, g).display.id).toBe(c.display.id);
  });
});
