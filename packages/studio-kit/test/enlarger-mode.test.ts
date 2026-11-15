// The enlarger's two modes (CHB-031) on documents (CHB-037): stages.darkroom.medium.mode; in normalised mode the
// optics (main.params.time_s, main.params.fstop, the magnification) are inert, Lighter / Darker and a time band move
// the printer lights, and the studio's own copy edits pass through withoutInert (the log no longer rewrites writes).
import { makeM1Tiff, MockEngine } from '@chromobench/engine-mock';
import { edit, sha256Hex, type Document } from '@chromobench/contract';
import { set, transaction } from '@chromobench/values';
import { describe, expect, it } from 'vitest';
import {
  darkroomMedium, defaultDocument, exposureStep, isInert, isNormalised, LIGHTS_PATH, lightsOf, OPTICS_PATHS, TIME_PATH, withEnlargerMode, withoutInert,
} from '../src/model/doc.ts';
import { DARKROOM, NORMALISED_NOTE } from '../src/model/arrangement.ts';
import { initialInMode } from '../src/studio.ts';
import { logKey, memoryKV, FRAME_SAVE_FORMAT, type FrameSave } from '../src/index.ts';
import { LAYOUTS } from '../layouts/index.js';
import { docOf, studioOnly } from './helpers.ts';

const d0 = (): Document => defaultDocument('negative-scan', { sha256: 'ab'.repeat(32), name: 'x.tif', width: 3000, height: 2000 });
const normal = (): Document => withEnlargerMode(d0(), 'normalised');

describe('enlarger mode model (CHB-031)', () => {
  it('real is the default; time, aperture and magnification are inert only in normalised mode', () => {
    expect(darkroomMedium(d0()).mode).toBe('real');
    expect(isNormalised(d0())).toBe(false);
    expect(isNormalised(normal())).toBe(true);
    for (const p of OPTICS_PATHS) {
      expect(isInert(d0(), p)).toBe(false);
      expect(isInert(normal(), p)).toBe(true);
    }
    expect(isInert(normal(), LIGHTS_PATH)).toBe(false);
    expect(isInert(null, TIME_PATH)).toBe(false);
  });
  it('withEnlargerMode returns the same document when nothing changes, else a valid copy', () => {
    const d = d0();
    expect(withEnlargerMode(d, 'real')).toBe(d);
    const n = withEnlargerMode(d, 'normalised');
    expect(n).not.toBe(d);
    expect(darkroomMedium(d).mode).toBe('real');
    expect(() => edit(n, [])).not.toThrow();
  });
  it('Lighter / Darker: 1/3 stop of time in real mode; the same in log H on all three lights in normalised mode', () => {
    expect(exposureStep(d0(), -1 / 3)).toEqual({ path: TIME_PATH, value: Number((10 * 2 ** (-1 / 3)).toFixed(6)) });
    const n = exposureStep(normal(), 1 / 3);
    expect(n.path).toBe(LIGHTS_PATH);
    for (const v of n.value as number[]) expect(v).toBeCloseTo(Math.log10(2) / 3, 6);
    // the pad's own step in points
    expect(exposureStep(normal(), -1 / 3, { lightsPoints: 2 }).value).toEqual([-0.05, -0.05, -0.05]);
  });
  it('the Darkroom arrangement says why Time and Aperture are missing in normalised mode', () => {
    const g = DARKROOM.groups.find(x => x.title === 'Exposure')!;
    expect(g.note!(normal())).toBe(NORMALISED_NOTE);
    expect(g.note!(d0())).toBe('');
  });
});

describe('withoutInert: the studio\'s copy edits on a normalised document (CHB-031 srvr)', () => {
  it('real mode passes everything; normalised moves time, aperture and magnification onto the three lights', () => {
    const ms = [set(TIME_PATH, 20), set('main.params.fstop', 11), set('stages.darkroom.medium.grade', 3)];
    expect(withoutInert(d0(), ms)).toEqual(ms);
    const out = withoutInert(normal(), ms);
    expect(out.map(m => (m.op === 'set' ? m.path : m.op))).toEqual([LIGHTS_PATH, LIGHTS_PATH, 'stages.darkroom.medium.grade']);
    // twice the time (+0.301) then f/8 → f/11 (−0.277): the lights add up
    const l = (out[1] as { value: number[] }).value;
    expect(l[0]).toBeCloseTo(Math.log10(2) - 2 * Math.log10(11 / 8), 5);
    // the same time changes nothing
    expect(withoutInert(normal(), [set(TIME_PATH, 10)])).toEqual([]);
    // a mode change earlier in the list counts for the sets after it
    expect(withoutInert(normal(), [set('stages.darkroom.medium.mode', 'real'), set(TIME_PATH, 20)])).toEqual([set('stages.darkroom.medium.mode', 'real'), set(TIME_PATH, 20)]);
    expect(withoutInert(d0(), [set('stages.darkroom.medium.mode', 'normalised'), set(TIME_PATH, 20)]).map(m => (m.op === 'set' ? m.path : m.op))).toEqual(['stages.darkroom.medium.mode', LIGHTS_PATH]);
    expect(lightsOf(edit(normal(), out).doc)[0]).toBeCloseTo(l[0]!, 6);
  });
});

describe("a layout's enlarger mode for new documents (CHB-031)", () => {
  it('initialInMode: the host first document sees the mode, and the result is held to it', async () => {
    const seen: string[] = [];
    const host = async (d: Document) => {
      seen.push(darkroomMedium(d).mode);
      return withEnlargerMode(d, 'real'); // a host that rebuilds the document loses nothing
    };
    const out = await initialInMode(host, 'normalised')(d0(), {} as never);
    expect(seen).toEqual(['normalised']);
    expect(darkroomMedium(out).mode).toBe('normalised');
    expect(darkroomMedium(await initialInMode(undefined, 'normalised')(d0(), {} as never)).mode).toBe('normalised');
  });

  it('a studio opens new frames in its mode (default real) and resumes a saved document in the mode it stores', async () => {
    const bytes = makeM1Tiff();
    const a = await studioOnly();
    const fa = (await a.studio.open(bytes, 'a.tif')).id;
    expect(darkroomMedium(docOf(a.rt, fa)).mode).toBe('real');
    const b = await studioOnly({ enlarger: 'normalised' });
    const fb = (await b.studio.open(bytes, 'a.tif')).id;
    expect(darkroomMedium(docOf(b.rt, fb)).mode).toBe('normalised');
    const sha = sha256Hex(bytes);
    const engine = new MockEngine();
    const info = await engine.open({ kind: 'file', sha256: sha, bytes });
    for (const [saved, layout] of [['normalised', 'real'], ['real', 'normalised']] as const) {
      const kv = memoryKV();
      const initial = withEnlargerMode(defaultDocument('negative-scan', { sha256: sha, name: 'a.tif', width: info.width, height: info.height }), saved);
      const rec: FrameSave = { format: FRAME_SAVE_FORMAT, version: 3, initial, applied: [{ ...transaction({ id: 't', label: 'Grade', by: 'user', mutations: [set('stages.darkroom.medium.grade', 3)] }) }], pending: [] };
      await kv.put('logs', logKey(sha, 'negative-scan'), rec);
      const s = await studioOnly({ kv, enlarger: layout });
      const f = (await s.studio.open(bytes, 'a.tif')).id;
      expect(darkroomMedium(docOf(s.rt, f)).mode).toBe(saved);
      expect(darkroomMedium(docOf(s.rt, f)).grade).toBe(3);
    }
  });

  it('simple and tiny make normalised documents; the darkroom-style layouts leave the default (real)', async () => {
    const modes: Record<string, string | undefined> = {};
    for (const [id, load] of Object.entries(LAYOUTS)) modes[id] = (await load()).default.enlarger;
    expect(modes).toEqual({ classic: undefined, darkroom: undefined, simple: 'normalised', lab: undefined, tiny: 'normalised', roll: undefined, finish: undefined, looks: undefined });
  });
});
