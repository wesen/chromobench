// CHB-031 WS-A (F17): the enlarger mode in the studio. Real mode is the contract's default; a layout may make new
// recipes normalised (simple, tiny); a saved recipe keeps its mode; in normalised mode Lighter / Darker and the
// test strip in seconds move the printer lights, since the time does nothing there.
import { makeM1Tiff, MockEngine } from '@chromobench/engine-mock';
import { defaultRecipe, EditLog, sha256Hex, type FrameRecipe } from '@chromobench/contract';
import { describe, expect, it } from 'vitest';
import {
  createStudio, defaultFor, DARKROOM, ENLARGER_MODES, exposureStep, initialInMode, isInert, isNormalised, logKey, memoryKV, NORMALISED_NOTE,
  stripLabel, stripMutation, stripRecipe, stripValues, StudioLog, withEnlargerMode, withoutInert,
} from '../src/index.ts';
import { LAYOUTS } from '../layouts/index.js';
import { planFrame, printDensity } from '../kits/looks/src/index.ts';

const r0 = (): FrameRecipe => defaultRecipe('negative-scan', { sha256: '0'.repeat(64), name: 'x' });
const norm = (): FrameRecipe => withEnlargerMode(r0(), 'normalised');
const LOG2 = Math.log10(2);

describe('enlarger mode model (CHB-031)', () => {
  it('real is the default; time, aperture and magnification are inert only in normalised mode', () => {
    expect(r0().print.enlarger.mode).toBe('real');
    expect(ENLARGER_MODES).toEqual(['real', 'normalised']);
    for (const p of ['print.enlarger.time_s', 'print.enlarger.fstop', 'print.enlarger.magnification']) {
      expect(isInert(r0(), p)).toBe(false);
      expect(isInert(norm(), p)).toBe(true);
    }
    for (const p of ['print.lights.logH', 'print.enlarger.filtration', 'print.enlarger.mode', 'print.grade']) expect(isInert(norm(), p)).toBe(false);
    expect(isNormalised(undefined)).toBe(false);
  });

  it('withEnlargerMode returns the same recipe when nothing changes, else a copy', () => {
    const r = r0();
    expect(withEnlargerMode(r, 'real')).toBe(r);
    const n = withEnlargerMode(r, 'normalised');
    expect(n).not.toBe(r);
    expect(n.print.enlarger.mode).toBe('normalised');
    expect(r.print.enlarger.mode).toBe('real');
  });

  it('Lighter / Darker: 1/3 stop of time in real mode; the same in log H on all three lights in normalised mode', () => {
    expect(exposureStep(r0(), -1 / 3)).toEqual({ op: 'set', path: 'print.enlarger.time_s', value: Number((10 * 2 ** (-1 / 3)).toFixed(6)) });
    expect(exposureStep(r0(), 1 / 3).value).toBeCloseTo(12.599, 3);
    const n = exposureStep(norm(), 1 / 3);
    expect(n.path).toBe('print.lights.logH');
    for (const v of n.value as number[]) expect(v).toBeCloseTo(LOG2 / 3, 6);
    // the pad's own step in points
    expect(exposureStep(norm(), -1 / 3, { lightsPoints: 1 }).value).toEqual([-0.025, -0.025, -0.025]);
    // held to the contract's ranges
    const long = withEnlargerMode(r0(), 'real');
    long.print.enlarger.time_s = 590;
    expect(exposureStep(long, 1).value).toBe(600);
  });

  it('the test strip in seconds: real mode sets the time; normalised mode moves the lights by the band and labels it in stops', () => {
    const vals = stripValues('time', 10, 1 / 3, 5);
    expect(stripMutation('time', r0(), vals[4]!)).toEqual({ op: 'set', path: 'print.enlarger.time_s', value: Number(vals[4]!.toFixed(4)) });
    expect(stripRecipe('time', r0(), vals[4]!).print.enlarger.time_s).toBe(Number(vals[4]!.toFixed(4)));
    const m = stripMutation('time', norm(), vals[4]!);
    expect(m.op === 'set' && m.path).toBe('print.lights.logH');
    for (const v of (m as { value: number[] }).value) expect(v).toBeCloseTo((2 / 3) * LOG2, 6);
    const b = stripRecipe('time', norm(), vals[0]!);
    expect(b.print.enlarger.time_s).toBe(10);
    for (const v of b.print.lights.logH) expect(v).toBeCloseTo((-2 / 3) * LOG2, 6);
    expect(vals.map((v) => stripLabel('time', v, norm()))).toEqual(['−2/3 st', '−1/3 st', '0 st', '+1/3 st', '+2/3 st']);
    expect(stripLabel('time', 10, r0())).toBe('10.0 s');
  });

  it('the Darkroom arrangement says why Time and Aperture are missing in normalised mode', () => {
    const g = DARKROOM.groups.find((x) => x.title === 'Exposure')!;
    expect(g.paths[0]).toBe('print.enlarger.mode');
    expect(g.note!(norm())).toBe(NORMALISED_NOTE);
    expect(g.note!(r0())).toBe('');
  });
});

describe('a layout\'s enlarger mode for new recipes (CHB-031)', () => {
  it('initialInMode: the host first recipe sees the mode, and the result is held to it', async () => {
    const seen: string[] = [];
    const host = async (d: FrameRecipe) => {
      seen.push(d.print.enlarger.mode);
      return withEnlargerMode(d, 'real'); // a host that rebuilds the recipe (the photo path) loses nothing
    };
    const out = await initialInMode(host, 'normalised')(r0(), {} as never);
    expect(seen).toEqual(['normalised']);
    expect(out.print.enlarger.mode).toBe('normalised');
    expect((await initialInMode(undefined, 'normalised')(r0(), {} as never)).print.enlarger.mode).toBe('normalised');
  });

  it('a studio opens new frames in its mode (default real) and resumes a saved recipe in the mode it stores', async () => {
    const bytes = makeM1Tiff();
    const plain = await createStudio({ engine: new MockEngine(), kv: memoryKV() }).open(bytes, 'a.tif');
    expect(plain.log.committed.print.enlarger.mode).toBe('real');
    const simple = await createStudio({ engine: new MockEngine(), kv: memoryKV(), enlarger: 'normalised' }).open(bytes, 'a.tif');
    expect(simple.log.committed.print.enlarger.mode).toBe('normalised');
    // a recipe saved in normalised mode (before CHB-031) opens normalised in a real-mode layout, and vice versa
    const sha = sha256Hex(bytes);
    for (const [saved, layout] of [['normalised', 'real'], ['real', 'normalised']] as const) {
      const kv = memoryKV();
      const old = EditLog.create(withEnlargerMode(defaultFor(sha, 'a.tif', 'negative-scan'), saved), { by: 'auto' });
      await kv.put('logs', logKey(sha, 'negative-scan'), old.toJSON());
      const e = await createStudio({ engine: new MockEngine(), kv, enlarger: layout }).open(bytes, 'a.tif');
      expect(e.log.committed.print.enlarger.mode).toBe(saved);
    }
  });

  it('simple and tiny make normalised recipes; the darkroom-style layouts leave the default (real)', async () => {
    const modes: Record<string, string | undefined> = {};
    for (const [id, load] of Object.entries(LAYOUTS)) modes[id] = (await load()).default.enlarger;
    expect(modes).toEqual({ classic: undefined, darkroom: undefined, simple: 'normalised', lab: undefined, tiny: 'normalised', roll: undefined, finish: undefined, looks: undefined });
  });
});

describe('no inert control in the edit log (CHB-031 srvr)', () => {
  const lights = (r: FrameRecipe) => r.print.lights.logH;
  const set = (path: string, value: unknown) => ({ op: 'set' as const, path, value });

  it('withoutInert: real mode passes everything; normalised moves time, aperture and magnification onto the three lights', () => {
    const ms = [set('print.enlarger.time_s', 20), set('print.enlarger.fstop', 11)];
    expect(withoutInert(r0(), ms)).toEqual(ms);
    const out = withoutInert(norm(), ms);
    expect(out.map((m) => (m as { path: string }).path)).toEqual(['print.lights.logH', 'print.lights.logH']);
    // one stop more time, then f/8 → f/11 (−2 log10 11/8): cumulative on each light, as at a real enlarger
    const want = LOG2 - 2 * Math.log10(11 / 8);
    for (const v of (out[1] as { value: number[] }).value) expect(v).toBeCloseTo(want, 5);
    const at8 = withEnlargerMode({ ...r0(), print: { ...r0().print, enlarger: { ...r0().print.enlarger, magnification: 8 } } }, 'normalised');
    for (const v of (withoutInert(at8, [set('print.enlarger.magnification', 17)])[0] as { value: number[] }).value) expect(v).toBeCloseTo(-2 * Math.log10(18 / 9), 5);
    // no change of exposure: nothing written; an optics value that is no exposure (null): nothing written
    expect(withoutInert(norm(), [set('print.enlarger.time_s', 10)])).toEqual([]);
    expect(withoutInert(norm(), [set('print.enlarger.magnification', null)])).toEqual([]);
    // a mode change earlier in the list counts for the writes after it
    const toReal = [set('print.enlarger.mode', 'real'), set('print.enlarger.time_s', 20)];
    expect(withoutInert(norm(), toReal)).toEqual(toReal);
    // an expect on the time becomes an expect on the lights
    expect(withoutInert(norm(), [{ ...set('print.enlarger.time_s', 20), expect: 10 }])[0]).toMatchObject({ path: 'print.lights.logH', expect: [0, 0, 0] });
  });

  it('StudioLog: apply, propose and preview record no time on a normalised recipe; a real recipe keeps its time', () => {
    const log = StudioLog.make(norm());
    log.apply([set('print.enlarger.time_s', 20)], 'user', 'Time');
    expect(log.committed.print.enlarger.time_s).toBe(10);
    lights(log.committed).forEach((v) => expect(v).toBeCloseTo(LOG2, 5));
    expect(log.entries.map((e) => (e.m as { path?: string }).path)).toEqual(['print.lights.logH']);
    log.propose([set('print.enlarger.fstop', 5.6)], { tx: 'agent-1', why: 'a stop more light' });
    expect(log.pending().map((e) => (e.m as { path?: string }).path)).toEqual(['print.lights.logH']);
    // 40 s against the time's 10 s: two stops more, on top of the stop already applied
    log.preview(set('print.enlarger.time_s', 40));
    expect(log.state.print.enlarger.time_s).toBe(10);
    lights(log.state).forEach((v) => expect(v).toBeCloseTo(3 * LOG2, 5));
    log.preview(null);
    const real = StudioLog.make(r0());
    real.apply([set('print.enlarger.time_s', 20)], 'user', 'Time');
    expect(real.committed.print.enlarger.time_s).toBe(20);
    expect(real).toBeInstanceOf(EditLog);
  });

  it('a studio frame\'s log is a StudioLog: the looks kit\'s "print density" on a normalised frame moves the lights, not the time', async () => {
    const studio = createStudio({ engine: new MockEngine(), kv: memoryKV(), enlarger: 'normalised' });
    const e = await studio.open(makeM1Tiff(), 'neg.tif');
    expect(e.log).toBeInstanceOf(StudioLog);
    const plan = planFrame(printDensity, { stops: 1 }, e.id, e.log.committed);
    expect(plan.mutations.map((m) => (m as { path?: string }).path)).toEqual(['print.lights.logH']);
    e.log.apply(plan.mutations, 'user', 'Look: print density');
    expect(e.log.committed.print.enlarger.time_s).toBe(10);
    lights(e.log.committed).forEach((v, k) => expect(v - lights(e.initial)[k]!).toBeCloseTo(LOG2, 4));
  });
});
