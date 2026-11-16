// CHB-046, headless (MockEngine, the classic layout): Apply Print Settings asks first and says what it copies (P9-9),
// the enlarger mode keeps the print (F44, the optics fallback without the host's physics), the darkroom in his order
// with a by-kind view (D5), and the first print's Neutralise amount (D8).
import { describe, expect, it } from 'vitest';
import { set } from '@chromobench/values';
import { manualClock } from '@chromobench/shell/testing';
import { MockEngine } from '@chromobench/engine-mock';
import {
  buildLayout, createStudio, LIGHTS_PATH, lightsOf, mainExposure, memoryKV, MODE_PATH, NEUTRALISE, neutraliseOf, read, settingsPlan, TIME_PATH, modelAt,
} from '../src/index.ts';
import { kindSummary, rowsOf } from '../kits/stack/src/model.ts';
import { LAYOUTS } from '../layouts/index.js';
import { otherTiff } from './helpers.ts';
import { makeM1Tiff } from '@chromobench/engine-mock';

async function classic(n = 3) {
  const studio = createStudio({ engine: new MockEngine(), kv: memoryKV() });
  const { app } = buildLayout((await LAYOUTS.classic()).default);
  const rt = await app.boot(studio.services({ clock: manualClock(1_000) }));
  studio.attach(rt);
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push((await studio.open(i ? otherTiff(i) : makeM1Tiff(), `frame-${i + 1}.tif`)).id);
  await studio.flush();
  const select = (sel: string[], primary = sel[0]!) => rt.store.writeView([{ path: ['ui', 'selection'], value: { ids: sel, primary, anchor: primary } }]);
  const chrome = rt.chrome as unknown as { dialogs: { spec: { title: string; buttons: { label: string }[] }; close(r?: unknown): void }[]; toasts: { text: string }[] };
  return { rt, studio, ids, select, chrome, time: (f: string) => mainExposure(studio.doc(f)!).time_s, cursor: () => rt.store.log.cursor };
}

describe('Apply Print Settings to Selection (CHB-037 P9-9)', () => {
  it('asks in the page: from the frame shown, what it copies in his units, onto which frames; Cancel changes nothing', async () => {
    const s = await classic(3);
    const [a, b, c] = s.ids as [string, string, string];
    s.studio.commit(a, [set(TIME_PATH, 31.75), set(LIGHTS_PATH, [0.05, 0, -0.05])], 'Corrected');
    s.select([a, b, c], a);
    const c0 = s.cursor();
    const p = s.rt.runCommand('print.applyToSelection', null) as Promise<unknown>;
    const d = s.chrome.dialogs.at(-1)!;
    expect(d.spec.title).toBe('Apply the print settings of frame-1.tif?');
    expect(d.spec.buttons.map((x) => x.label)).toEqual(['Cancel', 'Apply to 2 frames']);
    // nothing is copied while the dialog is open
    expect(s.time(b)).not.toBe(31.75);
    d.close('cancel');
    expect(await p).toBeNull();
    expect(s.time(b)).not.toBe(31.75);
    expect(s.cursor()).toBe(c0);
  });

  it('Apply copies from the primary onto the others as one undo step; the plan says Time and Printer lights in his units', async () => {
    const s = await classic(3);
    const [a, b, c] = s.ids as [string, string, string];
    s.studio.commit(a, [set(TIME_PATH, 31.75), set(LIGHTS_PATH, [0.05, 0, -0.05])], 'Corrected');
    const plan = settingsPlan(s.studio.doc(a)!, [b, c].map((f) => ({ name: f, doc: s.studio.doc(f)! })), (p) => modelAt(p, s.studio.doc(a)!));
    expect(plan.map((x) => x.label)).toEqual(['Time', 'Printer lights']);
    expect(plan[0]!.value).toBe('31.75 s');
    expect(plan[1]!.value).toMatch(/^\(\+2, 0, −2\) pt$/);
    expect(plan.every((x) => x.changes.length === 2)).toBe(true);
    s.select([b, c, a], a);
    const t0 = s.time(b);
    const p = s.rt.runCommand('print.applyToSelection', null) as Promise<unknown>;
    s.chrome.dialogs.at(-1)!.close('apply');
    expect(await p).toMatchObject({ from: a, to: [b, c], copied: ['Time', 'Printer lights'] });
    expect([s.time(b), s.time(c)]).toEqual([31.75, 31.75]);
    expect(lightsOf(s.studio.doc(c)!)).toEqual([0.05, 0, -0.05]);
    // one step: one undo takes it off both frames, the source untouched
    s.rt.run('edit.undo');
    expect(s.time(b)).toBe(t0);
    expect(s.time(c)).toBe(t0);
    expect(s.time(a)).toBe(31.75);
  });

  it('nothing to copy: it says so and asks nothing; { ask: false } copies at once (an agent)', async () => {
    const s = await classic(2);
    const [a, b] = s.ids as [string, string];
    s.select([a, b], a);
    const n = s.chrome.dialogs.length;
    expect(await (s.rt.runCommand('print.applyToSelection', null) as Promise<unknown>)).toBeNull();
    expect(s.chrome.dialogs.length).toBe(n);
    expect(s.chrome.toasts.at(-1)!.text).toMatch(/already print like frame-1\.tif/);
    s.studio.commit(a, [set(TIME_PATH, 20)], 'Time');
    await s.rt.runCommand('print.applyToSelection', null, { ask: false });
    expect(s.time(b)).toBe(20);
  });
});

describe('Real ↔ Normalised keeps the print (CHB-028 F44): the command, one step', () => {
  it('without the host physics the optics carry the shift (exact at the neutral pack); there and back is no change', async () => {
    const s = await classic(1);
    const f = s.ids[0]!;
    s.studio.commit(f, [set(TIME_PATH, 20), set(LIGHTS_PATH, [0.01, 0.02, 0.03])], 'Set');
    const c0 = s.cursor();
    s.rt.runCommand('print.enlargerMode', null, 'normalised');
    const d = s.studio.doc(f)!;
    expect(read(d, MODE_PATH)).toBe('normalised');
    lightsOf(d).forEach((l, k) => expect(l).toBeCloseTo([0.01, 0.02, 0.03][k]! + Math.log10(2), 6));
    expect(s.cursor()).toBe(c0 + 1);
    s.rt.runCommand('print.enlargerMode', null, 'real');
    const back = s.studio.doc(f)!;
    expect(read(back, MODE_PATH)).toBe('real');
    lightsOf(back).forEach((l, k) => expect(l).toBeCloseTo([0.01, 0.02, 0.03][k]!, 6));
    expect(mainExposure(back).time_s).toBe(20);
  });
});

describe('the darkroom in his order, by kind as a view (D5)', () => {
  it('rows in the order he made them; the summary and the By kind view group them; the view does not touch the document', async () => {
    const s = await classic(1);
    const f = s.ids[0]!;
    const item = (op: string, params: Record<string, unknown>, name: string) => ({ kind: 'layer', op, params, name, enabled: true, amount: 1, mask: null, blend: 'normal', source: { kind: 'user' } });
    s.studio.commit(f, [
      { op: 'insert', coll: 'stages.darkroom.stack', id: 'cm', item: item('densityMask', { gamma: 0.5, radius_um: 300, polarity: 'positive' }, 'Contrast mask') },
      { op: 'insert', coll: 'stages.darkroom.stack', id: 'sky', item: item('burn', { stops: 0.5 }, 'Sky') },
      { op: 'insert', coll: 'stages.darkroom.stack', id: 'face', item: item('dodge', { stops: 0.3 }, 'Face') },
      { op: 'insert', coll: 'stages.darkroom.stack', id: 'b2', item: item('burn', { stops: 1 }, 'Corner') },
    ] as never, 'Layers');
    const d = s.studio.doc(f)!;
    expect(rowsOf(d, 'darkroom', { order: 'stack' }).map((r) => r.id)).toEqual(['main', 'lights', 'cm', 'sky', 'face', 'b2']);
    expect(rowsOf(d, 'darkroom', { order: 'kind' }).map((r) => r.id)).toEqual(['main', 'sky', 'face', 'b2', 'lights', 'cm']);
    expect(kindSummary(d)).toBe('Main exposure · Burn ×2 · Dodge · Printer lights · Density mask');
    const c0 = s.cursor();
    expect((s.rt.store.peek(['stack', 'darkroomOrder']))).toBe('stack');
    s.rt.runCommand('stack.byKind', null);
    expect(s.rt.store.peek(['stack', 'darkroomOrder'])).toBe('kind');
    s.rt.runCommand('stack.byKind', null);
    expect(s.rt.store.peek(['stack', 'darkroomOrder'])).toBe('stack');
    expect(s.cursor()).toBe(c0);
  });
});

describe('the first print\'s Neutralise amount (D8)', () => {
  it('75 % unless he chose another; kept in his preferences (percent)', async () => {
    const s = await classic(1);
    expect(neutraliseOf(s.rt.store.peek([]))).toBe(NEUTRALISE);
    expect(s.rt.store.peek(['prefs', 'neutralise'])).toBe(75);
    s.rt.ctx().set({ prefs: { neutralise: 100 } });
    expect(neutraliseOf(s.rt.store.peek([]))).toBe(1);
    expect(neutraliseOf({ prefs: { neutralise: 140 } })).toBe(1);
    expect(neutraliseOf(null)).toBe(0.75);
  });
});
