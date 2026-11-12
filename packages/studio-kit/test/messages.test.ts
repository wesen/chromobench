// CHB-027 WS-C: the photographer's words for errors and typed values (F7, F8), names for stock ids (F9), printer
// seconds and the slider range (F13), undo naming the frame (F12).
import { checkSet, defaultRecipe, isChromobenchError } from '@chromobench/contract';
import type { RecordingChrome } from '@chromobench/shell';
import { describe, expect, it } from 'vitest';
import {
  argModel, badEntryText, clampedText, clampEntry, entryHint, explainError, isRelativeEntry, parseEntry, rangeText, relativeText, stockName,
  units, valueName,
} from '../src/index.ts';
import { trackRange } from '../src/kit/args.ts';
import { makeM1Tiff } from '@chromobench/engine-mock';
import { recipePath, started } from './helpers.ts';

const TIME = 'print.enlarger.time_s';

function thrown(f: () => unknown): unknown {
  try {
    f();
  } catch (e) {
    return e;
  }
  throw new Error('did not throw');
}

describe('explainError (F7)', () => {
  it('E_ARG_RANGE on the time reads as a sentence, the original stays as the detail', () => {
    const r = defaultRecipe('negative-scan', { sha256: 'a'.repeat(64) });
    const err = thrown(() => checkSet(r, TIME, 0));
    expect(isChromobenchError(err)).toBe(true);
    const x = explainError(err, { label: 'Time' })!;
    expect(x.text).toBe('Time must be between 0.1 s and 600 s');
    expect(x.title).toBeUndefined(); // the text already starts with the label
    expect(x.detail).toBe('E_ARG_RANGE: print.enlarger.time_s = 0 is outside the allowed range [0.1, 600] (s).');
  });
  it('a component, an f-number, a stock off the list, a plain error', () => {
    expect(rangeText('print.enlarger.fstop')).toBe('Aperture must be between f/2.8 and f/45');
    expect(rangeText('print.enlarger.filtration.m')).toMatch(/^Filtration M must be between /);
    const r = defaultRecipe('negative-scan', { sha256: 'a'.repeat(64) });
    const err = thrown(() => checkSet(r, 'print.paper', 42));
    expect(explainError(err)!.text).toMatch(/^Paper needs a /);
    expect(explainError(new Error('boom'))).toBeNull();
    expect(explainError(Object.assign(new Error('E_STALE: expect failed'), { code: 'E_STALE' }))!.text).toMatch(/not applied/);
  });
});

describe('typed values (F8)', () => {
  const a = argModel(TIME)!;
  it('hints say what a field takes, and that a sign changes the value', () => {
    expect(entryHint(a.model)).toMatch(/7,5/);
    expect(entryHint(a.model)).toMatch(/\+1\/3 st/);
    expect(badEntryText(a.model, 'abc')).toMatch(/^Time: “abc” is not a value\. Type a time/);
    expect(badEntryText(a.model, '  ')).toMatch(/^Time: the box is empty/);
  });
  it('a German decimal comma reads as a point, also in a relative entry', () => {
    expect(parseEntry(a, '7,5', 15)).toBe(7.5);
    expect(parseEntry(a, '-2,5', 15)).toBe(12.5);
  });
  it('a relative entry says what it did', () => {
    expect(isRelativeEntry('-5')).toBe(true);
    expect(isRelativeEntry('5')).toBe(false);
    expect(relativeText(a.model, '-5', 10, null)).toBe('Time −5 s → 10.0 s');
    expect(relativeText(a.model, '+1/3 st', 12.6, null)).toBe('Time +1/3 st → 12.6 s');
  });
  it('out of range is held to the limit, and said', () => {
    expect(clampEntry(a, 0, null)).toEqual({ value: 0.1, hit: 'min' });
    expect(clampEntry(a, 1000, null)).toEqual({ value: 600, hit: 'max' });
    expect(clampEntry(a, 12, null)).toEqual({ value: 12, hit: null });
    expect(clampedText(a.model, 'max', null)).toBe('Time can be at most 600 s: set to 600 s');
    expect(clampedText(a.model, 'min', null)).toBe("Time can't go below 0.1 s: set to 0.1 s");
    const y = argModel('print.enlarger.filtration.y')!;
    const c = clampEntry(y, { c: 0, m: 0, y: 1e6 }, 2);
    expect(c.hit).toBe('max');
    expect((c.value as { y: number }).y).toBe(y.model.max);
  });
});

describe('names (F9)', () => {
  it('stock ids read as names', () => {
    expect(stockName('kodak_portra_endura')).toBe('Kodak Portra Endura');
    expect(stockName('fujifilm_c200')).toBe('Fujifilm C200');
    expect(stockName('kodak_vision3_250d')).toBe('Kodak Vision3 250D');
    expect(stockName('fujifilm_crystal_archive_typeii')).toBe('Fujifilm Crystal Archive Type II');
    expect(stockName('kodak_portra_800_push1')).toBe('Kodak Portra 800 (pushed 1 stop)');
    expect(valueName('illuminants', 'D50')).toBe('Daylight D50');
    expect(valueName(undefined, 'grey_0')).toBe('grey 0');
  });
  it('the paper control formats its value by name; history says the change in names', () => {
    const paper = argModel('print.paper')!.model;
    expect(paper.valuesFrom).toBe('stocks:print');
    expect(paper.format('kodak_portra_endura')).toBe('Kodak Portra Endura');
    expect(paper.valueText('kodak_portra_endura')).toBe('Paper Kodak Portra Endura');
  });
});

describe('round values and the slider range (F13)', () => {
  it('printer seconds: whole seconds from 10 s, tenths from 1 s', () => {
    expect(units.printerSeconds(2 ** (26 / 6))).toBe(20); // 20.16 s
    expect(units.printerSeconds(2.2449)).toBe(2.2);
    expect(units.printerSeconds(0.561)).toBe(0.56);
    // ⅙-stop steps never collapse onto one value
    const seen = new Set<number>();
    for (let k = -18; k <= 50; k++) seen.add(units.printerSeconds(2 ** (k / 6)));
    expect(seen.size).toBe(69);
  });
  it('the track widens to take in a value outside the usual range, on the step grid, inside the hard range', () => {
    const sc = { min: 1, max: Math.log2(60), step: 1 / 6, hard: { min: Math.log2(0.1), max: Math.log2(600) } };
    expect(trackRange(sc, Math.log2(10))).toEqual({ min: 1, max: Number(Math.log2(60).toFixed(6)) });
    const r = trackRange(sc, Math.log2(2.23));
    expect(r.min).toBeLessThan(Math.log2(2.23) - 0.4);
    expect(Math.abs(r.min * 6 - Math.round(r.min * 6))).toBeLessThan(1e-6);
    expect(trackRange(sc, Math.log2(0.1)).min).toBeCloseTo(Math.log2(0.1), 6);
  });
});

describe('in a started studio', () => {
  it('a refused edit toasts the sentence, with the code as the detail (F7)', async () => {
    const { rt, f } = await started();
    rt.ctx().tx('Time', (t: any) => t.$set(recipePath(f, TIME), 0));
    const toast = (rt.chrome as RecordingChrome).toasts.at(-1)!;
    expect(toast.text).toBe('Time must be between 0.1 s and 600 s');
    expect(toast.kind).toBe('error');
    expect(toast.detail).toMatch(/^E_ARG_RANGE: print\.enlarger\.time_s = 0/);
    // the diagnostics keep the code
    expect(rt.diagnostics.list.some((d: any) => d.code === 'CK-T430' && d.facts.some((x: string) => /E_ARG_RANGE/.test(x)))).toBe(true);
  });
  it('Edit ▸ Undo names the frame when it is not the one on screen (F12)', async () => {
    const { rt, studio, f } = await started({ name: 'first.tif' });
    const b = makeM1Tiff();
    b[b.length - 1] = b[b.length - 1]! ^ 1; // another file (another hash)
    const g = (await studio.open(b, 'second.tif')).id;
    rt.ctx().tx('Time', (t: any) => t.$set(recipePath(f, TIME), 12));
    rt.store.set(['ui', 'selection'], { ids: [f], primary: f, anchor: f });
    expect(rt.commands.label('edit.undo', rt.store.readonly())).toBe('Undo Time');
    rt.store.set(['ui', 'selection'], { ids: [g], primary: g, anchor: g });
    expect(rt.commands.label('edit.undo', rt.store.readonly())).toBe('Undo Time (on first.tif)');
    rt.undo();
    expect(rt.commands.label('edit.redo', rt.store.readonly())).toBe('Redo Time (on first.tif)');
  });
});
