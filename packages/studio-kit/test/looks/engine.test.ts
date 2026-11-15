// CHB-021 stages 1–3 as pure functions (CHB-037: on format-3 documents): the look builder and resolve, the Amount
// pass (per-unit rules, from, range), the diff pass (golden strings in darkroom units), sync groups, preset files,
// sweeps.
import { describe, expect, it } from 'vitest';
import { set } from '@chromobench/values';
import { ChromobenchError, edit, layerEntry, newDocument, type Document } from '@chromobench/contract';
import {
  add, amountPass, applyDelta, axis, bake, BUILTIN_LOOKS, defaultGroups, diffDocs, fromPreset, groupOf, look, lookFrame, matchPath, mul, planLook, planFrame,
  portraEndura, previewDoc, pt, readPresetFile, presetToFile, resolveLook, ring, ruleFor, scale, slider, summary, validatePreset, warmPrint, aggregate, type PresetEntry,
} from '../../kits/looks/src/index.ts';
// CraftKit's own scalePreset and defaults (read-only CHB-016 sources) for the parity test
// @ts-expect-error plain JS module without types
import { DEFAULTS, scalePreset } from '../../../../ttmp/2026/11/11/CHB-016--craftkit-studio-study-ui-toolkit-and-js-dsl-for-a-lightroom-class-studio/sources/craftkit-studio/src/app/develop-model.js';

const neg = (): Document => newDocument('negative-scan', { sha256: 'a'.repeat(64) }, { frame: 'f1', umPerPx: 6 });
const raw = (): Document => newDocument('digital-raw', { sha256: 'b'.repeat(64) }, { frame: 'r1' });
const setPath = (d: Document, path: string, v: unknown): Document => edit(d, [set(path, v)]).doc;
const code = (f: () => unknown): string => {
  try {
    f();
  } catch (e) {
    return e instanceof ChromobenchError ? `${e.diag.code}${e.diag.hint ? ` ${e.diag.hint}` : ''}` : String(e);
  }
  return 'no error';
};
const resolved = (entries: PresetEntry[]) => resolveLook(fromPreset({ format: 'chromobench.preset', version: 2, id: 'p', name: 'p', entries, contract: '1.0.0' }), lookFrame('f1', neg()));

describe('stage 1: looks and presets', () => {
  it('resolves "warm print" at two parameter sets', () => {
    const f = lookFrame('f1', neg());
    expect(resolveLook(warmPrint, f).entries).toEqual([{ path: 'lights.params.logH', add: pt([-2, 0, 2]) }]);
    const r = resolveLook(warmPrint, f, { warmth: 6, density: 1 / 3 });
    expect(r.params).toEqual({ warmth: 6, density: 1 / 3 });
    expect(r.entries).toEqual([
      { path: 'lights.params.logH', add: pt([-3, 0, 3]) },
      { path: 'main.params.time_s', add: 1 / 3 },
    ]);
  });
  it('a bad parameter is E_ARG_RANGE (the registry check); an unknown one E_UNKNOWN_OPTION with did-you-mean', () => {
    const f = lookFrame('f1', neg());
    expect(code(() => resolveLook(warmPrint, f, { warmth: 12 }))).toBe('E_ARG_RANGE');
    expect(code(() => resolveLook(warmPrint, f, { warmt: 2 }))).toBe('E_UNKNOWN_OPTION did you mean warmth?');
  });
  it('a bad path is E_PATH with a suggestion', () => {
    const bad = look('bad').edits(() => ({ 'stages.darkroom.medium.grades': 3 }));
    expect(code(() => resolveLook(bad, lookFrame('f1', neg())))).toBe('E_PATH did you mean stages.darkroom.medium.grade?');
  });
  it('requires: a film look on a scanned negative is skipped with the reason', () => {
    const r = resolveLook(portraEndura, lookFrame('f1', neg()));
    expect(r.skip?.code).toBe('E_KIND');
    expect(r.skip?.hint).toBe('This look needs a digital RAW');
    expect(resolveLook(portraEndura, lookFrame('r1', raw())).entries.map((e) => e.path)).toContain('stages.film.medium.stock');
  });
  it('bake → preset → fromPreset resolves to the same entries; the preset validates', () => {
    const f = lookFrame('f1', neg());
    const p = bake(warmPrint, f, { warmth: 6 });
    expect(validatePreset(p)).toEqual([]);
    expect(p.name).toBe('warm print (warmth 6, density 0)');
    expect(resolveLook(fromPreset(p), f).entries).toEqual(resolveLook(warmPrint, f, { warmth: 6 }).entries);
  });
  it('built-ins all resolve on the frame kind they need', () => {
    for (const l of BUILTIN_LOOKS) {
      const r = resolveLook(l, lookFrame('x', l.requires === 'digital-raw' ? raw() : neg()));
      expect(r.skip, l.name).toBeUndefined();
    }
  });
});

describe('stage 2: Amount', () => {
  it('rules from the ArgSpec: time and f-number in stops, K in mired, enums step, the rest linear', () => {
    expect(ruleFor('main.params.time_s')).toBe('stops');
    expect(ruleFor('main.params.fstop')).toBe('stops');
    expect(ruleFor('stages.scene.medium.whiteBalance.temperature_K')).toBe('mired');
    expect(ruleFor('stages.darkroom.medium.paper')).toBe('step');
    expect(ruleFor('stages.darkroom.medium.mode')).toBe('step');
    expect(ruleFor('lights.params.logH')).toBe('linear');
    expect(ruleFor('main.params.filtration')).toBe('linear');
    expect(ruleFor('stages.darkroom.medium.grade')).toBe('linear');
    expect(ruleFor('lights.source')).toBe('keep');
    expect(ruleFor('stages.darkroom.medium.grade', { 'stages.darkroom.medium.grade': 'step' })).toBe('step');
  });
  it('time +1/3 st at 50 % is +1/6 st; a set 12 → 48 s at 50 % is 24 s (the stop midpoint, not 30)', () => {
    expect(scale('stops', 12, { path: 'main.params.time_s', add: 1 / 3 }, 0.5)).toBeCloseTo(12 * 2 ** (1 / 6), 9);
    expect(scale('stops', 12, { path: 'main.params.time_s', set: 48 }, 0.5)).toBeCloseTo(24, 9);
    expect(scale('stops', 12, { path: 'main.params.time_s', add: 1 / 6 }, 0.6)).toBeCloseTo(12 * 2 ** (0.1), 9);
    // f-numbers: one stop is √2 on N
    expect(scale('stops', 8, { path: 'main.params.fstop', add: 1 }, 1)).toBeCloseTo(8 * Math.SQRT2, 9);
  });
  it('colour temperature in mired; enums step at 0.5; vec3 componentwise; k = 0, 1, 2', () => {
    const k = scale('mired', 5500, { path: 'stages.scene.medium.whiteBalance.temperature_K', set: 3200 }, 0.5) as number;
    expect(k).toBeCloseTo(1e6 / ((1e6 / 5500 + 1e6 / 3200) / 2), 6);
    expect(scale('step', 'a', { path: 'stages.darkroom.medium.paper', set: 'b' }, 0.49)).toBe('a');
    expect(scale('step', 'a', { path: 'stages.darkroom.medium.paper', set: 'b' }, 0.5)).toBe('b');
    expect(scale({ step: 0.8 }, 'a', { path: 'stages.darkroom.medium.paper', set: 'b' }, 0.7)).toBe('a');
    const e: PresetEntry = { path: 'lights.params.logH', add: [0.05, 0, -0.05] };
    expect(scale('linear', [0.1, 0, -0.1], e, 0.6)).toEqual([0.13, 0, -0.13]);
    expect(scale('linear', [0.1, 0, -0.1], e, 0)).toEqual([0.1, 0, -0.1]);
    expect(scale('linear', [0.1, 0, -0.1], e, 1)).toEqual(applyDelta('linear', [0.1, 0, -0.1], [0.05, 0, -0.05]));
    expect(scale('linear', [0.1, 0, -0.1], e, 2)).toEqual([0.2, 0, -0.2]);
    expect(scale('linear', { c: 0, m: 10, y: 50 }, { path: 'main.params.filtration', add: { y: 10 } }, 0.5)).toEqual({ c: 0, m: 10, y: 55 });
    expect(scale('linear', 1, { path: 'stages.film.medium.grain.amount', mul: 1.5 }, 0.5)).toBe(1.25);
  });
  it('the pass: sets with the values they replace; k = 1 gives the entries exactly; k = 0 changes nothing', () => {
    const r = resolved([{ path: 'stages.darkroom.medium.grade', set: 3 }, { path: 'main.params.time_s', add: 1 / 3 }]);
    const one = amountPass(r, neg(), { amount: 1 });
    expect(one.mutations).toEqual([
      { op: 'set', path: 'stages.darkroom.medium.grade', value: 3 },
      { op: 'set', path: 'main.params.time_s', value: Number((10 * 2 ** (1 / 3)).toPrecision(12)) },
    ]);
    expect(one.expect).toEqual({ 'stages.darkroom.medium.grade': 2, 'main.params.time_s': 10 });
    expect(amountPass(r, neg(), { amount: 0 }).mutations).toEqual([]);
    // the guide's §9 numbers: lights ±0.05 log H at 60 % is ±0.030; +1/6 st on 12 s at 60 % is 12.86 s
    const r2 = resolved([{ path: 'lights.params.logH', add: [0.05, 0, -0.05] }, { path: 'main.params.time_s', add: 1 / 6 }]);
    const at60 = amountPass(r2, setPath(neg(), 'main.params.time_s', 12), { amount: 0.6 }).mutations;
    expect(at60[0]).toMatchObject({ value: [0.03, 0, -0.03] });
    expect((at60[1] as { value: number }).value).toBeCloseTo(12.86, 2);
  });
  it('from defaults: Amount 0 is the default pack; from current: the frame', () => {
    const r = resolved([{ path: 'stages.darkroom.medium.grade', set: 4 }]);
    const g = setPath(neg(), 'stages.darkroom.medium.grade', 3.5);
    expect(amountPass(r, g, { amount: 0.5, from: 'defaults' }).mutations[0]).toMatchObject({ value: 3 });
    expect(amountPass(r, g, { amount: 0.5 }).mutations[0]).toMatchObject({ value: 3.75 });
  });
  it('out of range: a diagnostic with the clamped value as fix; over: clamp clamps with a note', () => {
    const r = resolved([{ path: 'stages.darkroom.medium.grade', set: 4 }]);
    const res = amountPass(r, neg(), { amount: 2 });
    expect(res.mutations).toEqual([]);
    expect(res.diags[0]).toMatchObject({ code: 'CB-L110', message: 'Amount 200 %: stages.darkroom.medium.grade would be 6, maximum 5; apply clamped?', fix: '5' });
    const c = amountPass(r, neg(), { amount: 2, over: 'clamp' });
    expect(c.mutations[0]).toMatchObject({ value: 5 });
    expect(c.notes).toEqual(['Amount 200 %: stages.darkroom.medium.grade would be 6, clamped to 5']);
  });
  it('CraftKit parity: the linear rule reproduces scalePreset on its own defaults', () => {
    const light = DEFAULTS.light as Record<string, unknown>;
    const nums = Object.entries(light).filter(([, v]) => typeof v === 'number') as [string, number][];
    expect(nums.length).toBeGreaterThan(3);
    const partial = { light: Object.fromEntries(nums.map(([k, v], i) => [k, v + (i % 2 ? 23 : -17)])) };
    for (const k of [0, 0.25, 0.6, 1, 1.5, 2]) {
      const theirs = scalePreset(partial, DEFAULTS, k).light as Record<string, number>;
      for (const [key, d] of nums) {
        const ours = scale('linear', d, { path: key, set: (partial.light as Record<string, number>)[key]! }, k) as number;
        expect(+ours.toFixed(3), `${key} at ${k}`).toBe(theirs[key]);
      }
    }
  });
});

describe('stage 3: diff', () => {
  const r0 = (): Document => setPath(neg(), 'main.params.time_s', 12);
  it('a document diffed with itself is empty', () => {
    expect(diffDocs(neg(), neg())).toEqual([]);
    expect(summary([])).toBe('no change');
  });
  it('golden strings per unit', () => {
    let b = setPath(r0(), 'main.params.time_s', 12 * 2 ** (1 / 3));
    b = setPath(b, 'lights.params.logH', [0.1, 0, -0.05]);
    b = setPath(b, 'main.params.filtration', { c: 0, m: 0, y: 10 });
    b = setPath(b, 'stages.darkroom.medium.grade', 3);
    b = setPath(b, 'stages.darkroom.medium.paper', 'fujicolor_crystal_archive_typeII');
    b = setPath(b, 'main.params.fstop', 8 * Math.SQRT2);
    const a = setPath(r0(), 'main.params.filtration', { c: 0, m: 0, y: 0 });
    const shown = Object.fromEntries(diffDocs(a, b).map((d) => [d.path, d.shown]));
    expect(shown).toEqual({
      'main.params.time_s': 'time 12.0 → 15.1 s (+1/3 st)',
      'lights.params.logH': 'lights R +4.0 pt, B −2.0 pt',
      'main.params.filtration': 'filtration Y 0 → 10 CC',
      'stages.darkroom.medium.grade': 'grade 2 → 3',
      'stages.darkroom.medium.paper': 'paper kodak_portra_endura → fujicolor_crystal_archive_typeII',
      'main.params.fstop': 'aperture f/8 → f/11.3 (−1 st)',
    });
    expect(groupOf('lights.params.logH')).toBe('Colour balance');
    expect(diffDocs(a, b).find((d) => d.path === 'stages.darkroom.medium.grade')!.group).toBe('Contrast');
    // not on a sixth: two decimals
    expect(diffDocs(r0(), setPath(r0(), 'main.params.time_s', 12 * 2 ** 0.1))[0]!.shown).toBe('time 12.0 → 12.9 s (+0.10 st)');
  });
  it('float noise below the unit tolerance is no change', () => {
    expect(diffDocs(r0(), setPath(r0(), 'main.params.time_s', 12.000001))).toEqual([]);
    expect(diffDocs(neg(), setPath(neg(), 'lights.params.logH', [1e-6, 0, 0]))).toEqual([]);
  });
  it('a look applied at k shows k times its delta in stops; at k = 1 the diff names exactly the look’s paths', () => {
    const l = look('t').edits(() => ({ 'main.params.time_s': add(1), 'stages.darkroom.medium.grade': 3 }));
    const half = planFrame(l, {}, 'f1', r0(), { amount: 0.5 });
    expect(half.diff.find((d) => d.path === 'main.params.time_s')!.delta).toBeCloseTo(0.5, 9);
    const one = planFrame(l, {}, 'f1', r0(), { amount: 1 });
    expect(one.diff.map((d) => d.path).sort()).toEqual(['main.params.time_s', 'stages.darkroom.medium.grade']);
    // property: for every built-in on its frame kind, applying at k = 1 and diffing yields only the look's own paths
    for (const b of BUILTIN_LOOKS) {
      const base = b.requires === 'digital-raw' ? raw() : setPath(neg(), 'lights.params.logH', [0.1, 0.02, -0.03]);
      const pf = planFrame(b, {}, 'x', base, { amount: 1 });
      const rl = resolveLook(b, lookFrame('x', base));
      // its entries' paths, and the layers it adds (one change each)
      const paths = new Set([...rl.entries.map((e) => e.path), ...rl.layers.map((x) => x.id)]);
      for (const d of pf.diff) expect(paths.has(d.path), `${b.name}: ${d.path}`).toBe(true);
      expect(diffDocs(previewDoc(base, pf.mutations), previewDoc(base, pf.mutations))).toEqual([]);
    }
  });
  it('a layer added on one side is one change; aggregate merges by path', () => {
    const b = previewDoc(neg(), [{ op: 'insert', coll: 'stages.darkroom.stack', id: 'b1', item: layerEntry('burn', { stops: 0.5 }) }]);
    expect(diffDocs(neg(), b).map((d) => d.shown)).toEqual(['burn b1 added']);
    const b2 = setPath(b, 'b1.params.stops', 1);
    expect(diffDocs(b, b2).map((d) => d.shown)).toEqual(['burn b1 stops +1/2 → +1 st']);
    expect(groupOf('b1.params.stops', undefined, b)).toBe('Dodge and burn');
    const a1 = diffDocs(neg(), setPath(neg(), 'stages.darkroom.medium.grade', 3));
    const a2 = diffDocs(neg(), setPath(neg(), 'stages.darkroom.medium.grade', 4));
    expect(aggregate([a1, a1])).toEqual([{ path: 'stages.darkroom.medium.grade', label: 'grade', frames: 2, short: '2 → 3' }]);
    expect(aggregate([a1, a2])[0]!.short).toBe('1 … 2');
  });
});

describe('stage 4 (pure): sync groups and plans', () => {
  it('path patterns and the default groups', () => {
    expect(matchPath('lights.params.*', 'lights.params.logH')).toBe(true);
    expect(matchPath('stages.scan.medium.*', 'stages.scan.medium.baseT')).toBe(true);
    expect(matchPath('stages.darkroom.medium.paper', 'stages.darkroom.medium.paperX')).toBe(false);
    expect(groupOf('geometry.crop')).toBe('Crop and dust');
    expect(defaultGroups()).not.toContain('Crop and dust');
    expect(defaultGroups()).toContain('Colour balance');
  });
  it('a group-excluded path is never in the plan', () => {
    const l = look('mixed').edits(() => ({ 'stages.darkroom.medium.grade': 3, 'lights.params.logH': add(pt([2, 0, -2])) }));
    const p = planLook(l, {}, [{ frame: 'f1', doc: neg() }], { groups: ['Contrast'] });
    expect(p.frames[0]!.mutations.map((m) => (m as { path: string }).path)).toEqual(['stages.darkroom.medium.grade']);
    expect(p.label).toBe('Look: mixed');
    expect(planLook(l, {}, [], { amount: 0.6 }).label).toBe('Look: mixed at 60 %');
  });
  it('CB-L120: an absolute set of the lights on a frame of a roll', () => {
    const l = look('abs').edits(() => ({ 'lights.params.logH': [0.1, 0, 0] }));
    expect(planFrame(l, {}, 'f1', neg(), { onRoll: (f) => f === 'f1' }).warnings.map((w) => w.code)).toEqual(['CB-L120']);
    expect(planFrame(l, {}, 'f1', neg()).warnings).toEqual([]);
  });
  it('flat grade 2 adds a preflash layer, scaled by Amount; normalised: a time offset goes on the lights', () => {
    const flat = BUILTIN_LOOKS.find((l) => l.id === 'flat-grade-2')!;
    const half = planFrame(flat, {}, 'f1', setPath(neg(), 'stages.darkroom.medium.grade', 3), { amount: 0.5 });
    expect(half.mutations).toEqual([
      { op: 'set', path: 'stages.darkroom.medium.grade', value: 2.5 },
      { op: 'insert', coll: 'stages.darkroom.stack', id: 'preflash', item: expect.objectContaining({ op: 'preflash', params: { fraction: 0.01 } }) },
    ]);
    const dens = BUILTIN_LOOKS.find((l) => l.id === 'print-density')!;
    const n = setPath(neg(), 'stages.darkroom.medium.mode', 'normalised');
    const pf = planFrame(dens, { stops: 1 }, 'f1', n);
    expect(pf.mutations.map((m) => (m as { path: string }).path)).toEqual(['lights.params.logH']);
    expect((pf.mutations[0] as { value: number[] }).value[0]).toBeCloseTo(Math.log10(2), 6);
  });
  it('film looks: requires skips scans; the stock steps and halation/grain scale with Amount', () => {
    const p = planLook(portraEndura, { halation: 2 }, [{ frame: 'f1', doc: neg() }, { frame: 'r1', doc: raw() }], { amount: 0.4 });
    expect(p.frames[0]!.skipped?.code).toBe('E_KIND');
    const ms = Object.fromEntries(p.frames[1]!.mutations.map((m) => [(m as { path: string }).path, (m as { value: unknown }).value]));
    expect(ms['stages.film.medium.stock']).toBeUndefined(); // already Portra 400; below the step threshold anyway
    expect(ms['stages.film.medium.halation.strength']).toBeCloseTo(1.4, 9);
    expect(ms['stages.darkroom.medium.paper']).toBeUndefined();
  });
});

describe('files and sweeps', () => {
  it('a preset written and read back round-trips; unknown paths need review; newer and recipe-era versions refuse', () => {
    const p = bake(warmPrint, lookFrame('f1', neg()), { warmth: 6 });
    expect(readPresetFile(presetToFile(p))).toEqual({ preset: p, status: 'ok', diags: [] });
    const odd = { ...p, entries: [{ path: 'geometry.orientation', set: 'cw90' }, { path: 'stages.darkroom.medium.grades', set: 3 }] };
    const r = readPresetFile(JSON.stringify(odd));
    expect(r.status).toBe('needs-review');
    expect(r.diags.map((d) => d.code)).toEqual(['E_PATH']);
    expect(r.diags[0]!.hint).toBe('did you mean stages.darkroom.medium.grade?');
    expect(code(() => readPresetFile(JSON.stringify({ ...p, version: 3 })))).toBe('E_FORMAT update chromobench to read it');
    expect(code(() => readPresetFile(JSON.stringify({ ...p, version: 1 })))).toBe('E_FORMAT make the preset again from a frame (Save Frame as Preset)');
    expect(code(() => readPresetFile('{'))).toMatch(/^E_FORMAT/);
  });
  it('ring: nine looks with the current print in them; axis: a row on one path', () => {
    const rs = ring({ step: 4 });
    expect(rs.length).toBe(9);
    expect(rs.map((l) => l.id)).toContain('ring-current');
    const cur = rs.find((l) => l.id === 'ring-current')!;
    expect(planFrame(cur, {}, 'f1', neg()).mutations).toEqual([]);
    const y = rs.find((l) => l.id === 'ring-Y')!;
    expect(planFrame(y, {}, 'f1', neg()).diff[0]!.shown).toBe('lights R −2.0 pt, G −2.0 pt, B +4.0 pt');
    const row = axis('main.params.time_s', { steps: [-1, 0, 1] });
    expect(row.map((l) => l.name)).toEqual(['time_s −1 st', 'current', 'time_s +1 st']);
    expect((planFrame(row[2]!, {}, 'f1', neg()).mutations[0] as { value: number }).value).toBeCloseTo(20, 9);
  });
  it('slider params are ArgSpecs', () => {
    expect(slider(0, 10, { unit: 'pt', default: 4 })).toMatchObject({ type: 'number', unit: 'point', min: 0, max: 10, default: 4 });
    expect(mul(2)).toMatchObject({ kind: 'mul', value: 2 });
  });
});
