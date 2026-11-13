// CHB-031 F32: History in the photographer's words and units. Session 03 read "+0.33 st" for a typed time but
// "+1/3 st" for a button step, "Orientation transpose → flipH" for Rotate, and "Auto view.frame.crop {"h":143,…"
// for an old strip frame. These pin the words: stops as fractions with glyphs, the Frame menu's verbs, no paths,
// ids or JSON.
import { allOps, EditLog, type FrameRecipe, type Mutation } from '@chromobench/contract';
import { describe as group, expect, it } from 'vitest';
import { defaultFor, describe, generateControls, historyGroups, lookupFor, orientationWords, pathName, units } from '../src/index.ts';

const { stopWords } = units;

const lookup = lookupFor(generateControls(allOps()));
const r0 = (): FrameRecipe => defaultFor('ab'.repeat(32), 'x.tif');
const say = (m: Mutation, before: FrameRecipe = r0()): string => describe(m, before, lookup);
const set = (path: string, value: unknown): Mutation => ({ op: 'set', path, value });

group('stopWords', () => {
  it('fractions as glyphs, with the word stop', () => {
    expect(stopWords(1 / 3)).toBe('+⅓ stop');
    expect(stopWords(-1 / 3)).toBe('−⅓ stop');
    expect(stopWords(2 / 3)).toBe('+⅔ stop');
    expect(stopWords(1)).toBe('+1 stop');
    expect(stopWords(-2)).toBe('−2 stops');
    expect(stopWords(4 / 3)).toBe('+1⅓ stops');
    expect(stopWords(0.5)).toBe('+½ stop');
    expect(stopWords(1 / 6)).toBe('+⅙ stop');
  });
  it("the timer's rounded seconds read as the third they are (7.94 → 10 s was +0.33 st)", () => {
    expect(stopWords(Math.log2(10 / 7.94))).toBe('+⅓ stop');
    expect(stopWords(Math.log2(12.6 / 10))).toBe('+⅓ stop');
    expect(stopWords(Math.log2(6.3 / 7.94))).toBe('−⅓ stop');
  });
  it('a change that is no fraction keeps one decimal', () => {
    expect(stopWords(Math.log2(15.12 / 10))).toBe('+0.6 stop');
    expect(stopWords(-1.4)).toBe('−1.4 stops');
    expect(stopWords(0.07)).toBe('+0.07 stop');
    expect(stopWords(0)).toBe('0 stops');
  });
});

group('describe: a set in words', () => {
  it('time: a typed time and a button step read alike', () => {
    const at = (t: number): FrameRecipe => { const r = r0(); r.print.enlarger.time_s = t; return r; };
    expect(say(set('print.enlarger.time_s', 10), at(7.94))).toBe('Time 7.94 → 10.0 s (+⅓ stop)');
    expect(say(set('print.enlarger.time_s', 12.6), at(10))).toBe('Time 10.0 → 12.6 s (+⅓ stop)');
    expect(say(set('print.enlarger.time_s', 5), at(10))).toBe('Time 10.0 → 5.0 s (−1 stop)');
  });
  it('aperture: the change of light in stops (a larger f-number is less light)', () => {
    expect(say(set('print.enlarger.fstop', 9))).toBe('Aperture f/8 → f/9 (−⅓ stop)');
    expect(say(set('print.enlarger.fstop', 5.6))).toBe('Aperture f/8 → f/5.6 (+1 stop)');
    expect(say(set('print.enlarger.fstop', 11))).toBe('Aperture f/8 → f/11 (−1 stop)');
    expect(say(set('print.enlarger.fstop', 7.1))).toBe('Aperture f/8 → f/7.1 (+⅓ stop)');
  });
  it('filtration and printer lights: the components that changed, by their letters', () => {
    expect(say(set('print.enlarger.filtration', { c: 0, m: 0, y: 20 }))).toBe('Filtration Y 0 → +20 CC');
    expect(say(set('print.enlarger.filtration', { c: 0, m: 10, y: 20 }))).toBe('Filtration M 0 → +10, Y 0 → +20 CC');
    expect(say(set('print.lights.logH', [0.05, 0, -0.05]))).toBe('Printer lights R 0 → +2, B 0 → −2 pt');
    // Lighter in normalised mode: the three lights together
    expect(say(set('print.lights.logH', [-0.1, -0.1, -0.1]))).toBe('Printer lights −4 pt (all three)');
  });
  it('the Frame menu: rotate and flip in its own words, not the orientation tokens', () => {
    expect(say(set('view.frame.orientation', 'cw90'))).toBe('Rotated right');
    expect(say(set('view.frame.orientation', 'ccw90'))).toBe('Rotated left');
    expect(orientationWords('transpose', 'flipH')).toBe('Rotated right'); // session 03: Rotate Right on a raw010 frame
    expect(orientationWords('transpose', 'flipV')).toBe('Rotated left');
    expect(orientationWords('none', 'rot180')).toBe('Rotated 180°');
    expect(orientationWords('none', 'flipH')).toBe('Flipped left to right');
    expect(orientationWords('none', 'transpose')).toBe('Rotated and flipped');
  });
  it('a crop is set, changed or removed: no box in JSON', () => {
    const box = { x: 10, y: 20, w: 143, h: 200 };
    const cropped = r0();
    cropped.view.frame.crop = box;
    expect(say(set('view.frame.crop', box))).toBe('Crop set');
    expect(say(set('view.frame.crop', { ...box, w: 150 }), cropped)).toBe('Crop changed');
    expect(say(set('view.frame.crop', null), cropped)).toBe('Crop removed');
  });
  it('a path without a control: a name, and values only when they are plain', () => {
    const text = say(set('print.lights.auto', { method: 'integrate', alpha: 1, analysisLongSide_px: 256, applied: true, logH: [0.1, 0, 0] }));
    expect(text).toMatch(/^Automatic balance (set|changed)$/);
    expect(text).not.toMatch(/[{}"]/);
    expect(pathName('view.output.export.dpi')).toBe('Export dpi');
    expect(pathName('retouch.spots.s3')).toBe('Retouch spot s3');
    expect(pathName('scan.baseT')).toBe('Film base');
  });
  it('probes, exposures and masks without ids or JSON', () => {
    expect(say(set('probes.P1', { x: 10, y: 10, r: 3 }))).toBe('Probe P1 placed');
    expect(say({ op: 'exposure.add', exposure: { id: 'e1', kind: 'dodge', stops: 1 / 3 } })).toBe('Added a dodge (−⅓ stop)');
    expect(say({ op: 'exposure.add', exposure: { id: 'e2', kind: 'burn', stops: 1 } })).toBe('Added a burn (+1 stop)');
  });
});

group('historyGroups', () => {
  it('the steps of a frame read in words (Rotate, a typed time, Lighter)', () => {
    const log = EditLog.create(r0(), { by: 'auto', mode: 'ask' });
    log.apply([set('view.frame.orientation', 'cw90')], 'user', 'Rotate Right');
    log.apply([set('print.enlarger.time_s', 12.6)], 'user', 'Time');
    log.apply([set('print.enlarger.time_s', 10)], 'user', 'Lighter');
    expect(historyGroups(log, lookup).map((g) => g.changes.map((c) => c.text).join('; '))).toEqual(['Rotated right', 'Time 10.0 → 12.6 s (+⅓ stop)', 'Time 12.6 → 10.0 s (−⅓ stop)']);
  });
});
