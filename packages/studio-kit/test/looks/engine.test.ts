// The looks kit's engine as pure functions (CHB-037 P7: looks are links): the library over the contract's registered
// looks and presets, the plan of link inserts (a fresh link, or the frame's link adjusted), what a look does in
// darkroom words at an Amount, sweeps as looks at fixed params, sync groups, preset files, the diff of links.
import { describe, expect, it } from 'vitest';
import { Coll, set } from '@chromobench/values';
import { ChromobenchError, compile, edit, Graph, layerEntry, linksOf, makePreset, newDocument, type Document, type Entry } from '@chromobench/contract';
import {
  along, appliedKey, appliedLooks, applyMutations, defaultGroups, diffDocs, freshKey, groupOf, itemParams, lookItem, lookItems, lookLines, matchPath, planFrame, planLook,
  presetItem, presetToFile, readPresetFile, ring, summary, withLook,
} from '../../kits/looks/src/index.ts';

const neg = (): Document => newDocument('negative-scan', { sha256: 'a'.repeat(64) }, { frame: 'f1', umPerPx: 6 });
const raw = (): Document => newDocument('digital-raw', { sha256: 'b'.repeat(64) }, { frame: 'r1' });
const code = (f: () => unknown): string => {
  try {
    f();
  } catch (e) {
    return e instanceof ChromobenchError ? `${e.diag.code}${e.diag.hint ? ` ${e.diag.hint}` : ''}` : String(e);
  }
  return 'no error';
};
const warm = lookItem('warm-print');

describe('the library', () => {
  it('the registered looks and the presets; the sweep-only balance look is not in it', () => {
    const p = makePreset('p-1', 'Mine', { darkroom: Coll.of<Entry>([['b', layerEntry('burn', { stops: 1 })]]) });
    const ids = lookItems({ 'p-1': p }).map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(['neutral', 'warm-print', 'cool-print', 'soft-contrast', 'more-contrast', 'edge-burn', 'crisp-print', 'crisp-warm', 'preset:p-1']));
    expect(ids).not.toContain('balance');
    expect(presetItem(p)).toMatchObject({ name: 'Mine', ref: { preset: 'p-1' }, params: {}, origin: 'preset' });
  });
  it('params: defaults, checks (E_ARG_RANGE, E_UNKNOWN_OPTION with did-you-mean); a preset has none', () => {
    expect(itemParams(warm, { warmth: 6 })).toEqual({ warmth: 6, density: 0 });
    expect(code(() => itemParams(warm, { warmth: 12 }))).toBe('E_ARG_RANGE');
    expect(code(() => itemParams(warm, { warmt: 2 }))).toBe('E_UNKNOWN_OPTION did you mean warmth?');
    expect(itemParams(presetItem(makePreset('p', 'p', {})), { x: 1 })).toEqual({});
  });
});

describe('applying a look is a link', () => {
  it('a fresh link on top of the stack; applying it again adjusts it (params, Amount), never a second copy', () => {
    const d = neg();
    const ms = applyMutations(d, warm, { warmth: 6 }, 0.6);
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ op: 'insert', coll: 'stages.darkroom.stack', id: 'warm-print1-darkroom', item: { kind: 'link', ref: { look: 'warm-print', version: 1 }, params: { warmth: 6, density: 0 }, amount: 0.6 } });
    const a = edit(d, ms).doc;
    expect(appliedKey(a, warm)).toBe('warm-print1');
    expect(freshKey(a, warm)).toBe('warm-print2');
    const again = applyMutations(a, warm, { warmth: 8 }, 0.6);
    expect(again.map((m) => (m.op === 'set' ? m.path : m.op))).toEqual(['warm-print1-darkroom.params']);
    expect(applyMutations(a, warm, { warmth: 6 }, 0.6)).toEqual([]);
    expect(linksOf(edit(a, again).doc)).toHaveLength(1);
  });
  it('a look over two stages: one key, the print stage clamped to 100 %', () => {
    const d = edit(neg(), applyMutations(neg(), lookItem('crisp-warm'), {}, 1.5)).doc;
    expect(appliedLooks(d)).toEqual([{ key: 'crisp-warm1', name: 'Crisp and warm', amount: 1.5, stages: ['darkroom', 'print'], ref: { look: 'crisp-warm', version: 1 } }]);
    expect(linksOf(d).map((l) => l.entry.amount)).toEqual([1.5, 1]);
  });
  it('what a look does, in darkroom words at the Amount (the light law scales the filter; print layers mix)', () => {
    const plan = (item = warm, params = {}, k = 1) => planFrame(item, params, 'f1', neg(), { amount: k }).diff;
    expect(plan()).toEqual(['Warmth R −2.0 pt, B +2.0 pt']);
    expect(plan(warm, {}, 0.6)).toEqual(['Warmth R −1.2 pt, B +1.2 pt']);
    expect(plan(warm, { density: 1 / 3 })).toEqual(['Warmth R −2.0 pt, B +2.0 pt, +1/3 st']);
    expect(plan(lookItem('soft-contrast'), {}, 0.5)).toEqual(['Contrast mask γ 0.15 (300 µm, softer)', 'Preflash 1 %']);
    expect(plan(lookItem('crisp-warm'), {}, 0.5)).toEqual(['Warmth R −0.7 pt, B +0.7 pt', 'Clarity 0.2 at 50 %']);
    // a mask needs the image size; without it the line is the look's name
    expect(plan(lookItem('edge-burn'))).toEqual(['Edge burn']);
    expect(planFrame(lookItem('edge-burn'), {}, 'f1', neg(), { links: { size: [96, 64] } }).diff).toEqual(['Edge burn +1/2 st under Edges']);
  });
  it('a plan over frames: one batch id and label; the lines merged; a bad parameter throws', () => {
    const p = planLook(warm, { warmth: 8 }, [{ frame: 'a', doc: neg() }, { frame: 'b', doc: raw() }], { amount: 0.5 });
    expect(p.label).toBe('Look: Warm print at 50 %');
    expect(p.frames.every((f) => f.mutations.length === 1)).toBe(true);
    expect(p.aggregate).toEqual([{ text: 'Warmth R −2.0 pt, B +2.0 pt', frames: 2 }]);
    expect(code(() => planLook(warm, { warmth: 40 }, [{ frame: 'a', doc: neg() }]))).toBe('E_ARG_RANGE');
  });
  it('a preview is the document with the link: it compiles; amount 0 is the print without the look', () => {
    const g = new Graph();
    g.registerSource({ sha256: 'a'.repeat(64), format: 'tiff', width: 12, height: 10, channels: 3, bits: 16, sample: 'uint', encoding: { value: 'linear', evidence: 'format' }, levels: { black: [0], white: [65535], from: 'default' }, clippedFraction: 0, notes: [] });
    const d = neg();
    const w = withLook(d, warm, {}, 1)!;
    expect(compile(w, g).display.id).not.toBe(compile(d, g).display.id);
    expect(compile(withLook(d, warm, {}, 0)!, g).display.id).toBe(compile(d, g).display.id);
  });
});

describe('sweeps are looks at fixed params', () => {
  it('the ring: nine tiles of the balance look, the centre without change', () => {
    const r = ring();
    expect(r).toHaveLength(9);
    expect(r.every((t) => 'look' in t.ref && t.ref.look === 'balance')).toBe(true);
    expect(r.find((t) => t.id === 'ring-current')!.fixed).toEqual({});
    const d = neg();
    expect(withLook(d, r.find((t) => t.id === 'ring-current')!, {}, 1)).not.toBe(d); // a neutral filter, the same print
    expect(planFrame(r.find((t) => t.id === 'ring-D+1')!, {}, 'f1', d).diff).toEqual(['Balance +1/3 st']);
  });
  it('along a parameter of a look', () => {
    const a = along('print-density', 'stops', [-1, 0, 1]);
    expect(a.map((t) => t.fixed)).toEqual([{ stops: -1 }, { stops: 0 }, { stops: 1 }]);
  });
});

describe('sync groups, files, diffs', () => {
  it('default groups; a look\'s link is in Looks; a layer by its op', () => {
    expect(defaultGroups()).toEqual(['Film simulation', 'Paper', 'Exposure', 'Colour balance', 'Contrast', 'Dodge and burn', 'Looks', 'Finishing']);
    const d = edit(neg(), applyMutations(neg(), warm, {}, 1)).doc;
    expect(groupOf('warm-print1-darkroom', undefined, d)).toBe('Looks');
    expect(groupOf('main.params.time_s', undefined, d)).toBe('Exposure');
    expect(matchPath('stages.film.medium.*', 'stages.film.medium.grain.amount')).toBe(true);
  });
  it('preset files round-trip; an old version or a stranger is refused; an unknown op needs review', () => {
    const p = makePreset('p-1', 'Mine', { darkroom: Coll.of<Entry>([['b', layerEntry('burn', { stops: 1 })]]) });
    expect(readPresetFile(presetToFile(p))).toEqual({ preset: p, status: 'ok', diags: [] });
    expect(code(() => readPresetFile(JSON.stringify({ ...p, version: 2 })))).toMatch(/^E_FORMAT make the preset again/);
    expect(code(() => readPresetFile('{'))).toBe('E_FORMAT');
    const odd = { ...p, stacks: { darkroom: { order: ['x'], items: { x: layerEntry('curve', {}) } } } };
    expect(readPresetFile(JSON.stringify(odd)).status).toBe('needs-review');
  });
  it('a look in the diff is one unit: added, its Amount, its params', () => {
    const d = neg();
    const a = edit(d, applyMutations(d, warm, {}, 1)).doc;
    expect(diffDocs(d, a).map((e) => e.shown)).toEqual(['look Warm print added']);
    const b = edit(a, [set('warm-print1-darkroom.amount', 0.6), set('warm-print1-darkroom.params', { warmth: 6, density: 0 })]).doc;
    expect(summary(diffDocs(a, b), 5)).toBe('look Warm print 100 → 60 %, look Warm print warmth 4 → 6');
    expect(lookLines(b, 'warm-print1')).toEqual(['Warmth R −1.8 pt, B +1.8 pt']);
  });
});
