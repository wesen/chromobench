// CHB-031 F32: History in the photographer's words and units (now from the document log). Session 03 read "+0.33
// st" for a typed time but "+1/3 st" for a button step, "Orientation transpose → flipH" for Rotate, and a crop box in
// JSON. These pin the words: stops as fractions with glyphs, the Frame menu's verbs, no paths, ids or JSON.
import { edit, layerEntry, LOG_RULES, type Document } from '@chromobench/contract';
import { Coll, insert, Log, remove, set, transaction, type Json, type Mutation } from '@chromobench/values';
import { describe as group, expect, it } from 'vitest';
import { describe, historyRows, orientationWords, pathName, whyRows, type ModelLookup } from '../src/model/history.ts';
import { defaultDocument, newDarkroomLayer } from '../src/model/doc.ts';
import { modelAt } from '../src/kit/args.ts';
import * as units from '../src/model/units.ts';

const { stopWords } = units;

const lookup: ModelLookup = (p, d) => modelAt(p, d) ?? undefined;
const d0 = (): Document => defaultDocument('negative-scan', { sha256: 'ab'.repeat(32), name: 'x.tif', width: 3000, height: 2000 });
const with_ = (ms: Mutation[], d = d0()): Document => edit(d, ms).doc;
const say = (m: Mutation, before: Document = d0()): string => describe(m, before, lookup);

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
    expect(say(set('main.params.time_s', 10), with_([set('main.params.time_s', 7.94)]))).toBe('Time 7.94 → 10.0 s (+⅓ stop)');
    expect(say(set('main.params.time_s', 12.6))).toBe('Time 10.0 → 12.6 s (+⅓ stop)');
    expect(say(set('main.params.time_s', 5))).toBe('Time 10.0 → 5.0 s (−1 stop)');
  });
  it('aperture: the change of light in stops (a larger f-number is less light)', () => {
    expect(say(set('main.params.fstop', 9))).toBe('Aperture f/8 → f/9 (−⅓ stop)');
    expect(say(set('main.params.fstop', 5.6))).toBe('Aperture f/8 → f/5.6 (+1 stop)');
    expect(say(set('main.params.fstop', 11))).toBe('Aperture f/8 → f/11 (−1 stop)');
  });
  it('filtration and printer lights: the components that changed, by their letters', () => {
    expect(say(set('main.params.filtration', { c: 0, m: 0, y: 20 }))).toBe('Filtration Y 0 → +20 CC');
    expect(say(set('main.params.filtration', { c: 0, m: 10, y: 20 }))).toBe('Filtration M 0 → +10, Y 0 → +20 CC');
    expect(say(set('lights.params.logH', [0.05, 0, -0.05]))).toBe('Printer lights R 0 → +2, B 0 → −2 pt');
    expect(say(set('lights.params.logH', [-0.1, -0.1, -0.1]))).toBe('Printer lights −4 pt (all three)');
  });
  it('media read by their control names', () => {
    expect(say(set('stages.darkroom.medium.grade', 3))).toBe('Grade 2.0 → 3.0');
    expect(say(set('stages.darkroom.medium.paper', 'kodak_supra_endura'))).toBe('Paper Kodak Portra Endura → Kodak Supra Endura');
  });
  it('the Frame menu: rotate and flip in its own words, not the orientation tokens', () => {
    expect(say(set('geometry.orientation', 'cw90'))).toBe('Rotated right');
    expect(say(set('geometry.orientation', 'ccw90'))).toBe('Rotated left');
    expect(orientationWords('transpose', 'flipH')).toBe('Rotated right');
    expect(orientationWords('transpose', 'flipV')).toBe('Rotated left');
    expect(orientationWords('none', 'rot180')).toBe('Rotated 180°');
    expect(orientationWords('none', 'flipH')).toBe('Flipped left to right');
    expect(orientationWords('none', 'transpose')).toBe('Rotated and flipped');
  });
  it('a crop is set, changed or removed: no box in JSON', () => {
    const box = { x: 10, y: 20, w: 143, h: 200 };
    const cropped = with_([set('geometry.crop', box)]);
    expect(say(set('geometry.crop', box))).toBe('Crop set');
    expect(say(set('geometry.crop', { ...box, w: 150 }), cropped)).toBe('Crop changed');
    expect(say(set('geometry.crop', null), cropped)).toBe('Crop removed');
  });
  it('a path without a control: a name, and values only when they are plain', () => {
    expect(pathName('output.export.dpi')).toBe('Export dpi');
    expect(pathName('stages.scan.medium.baseT')).toBe('Film base');
    expect(say(set('output.export.dpi', 600))).toBe('Export dpi 300 → 600');
  });
  it('layers, masks and probes without ids or JSON', () => {
    expect(say(insert('stages.darkroom.stack', 'dodge1', newDarkroomLayer('dodge')))).toBe('Added a dodge (−½ stop)');
    expect(say(insert('stages.darkroom.stack', 'burn1', newDarkroomLayer('burn')))).toBe('Added a burn (+½ stop)');
    expect(say(insert('stages.darkroom.stack', 'contrast1', newDarkroomLayer('densityMask')))).toBe('Added a contrast mask');
    const withBurn = with_([insert('stages.darkroom.stack', 'burn1', newDarkroomLayer('burn'))]);
    expect(say(remove('burn1'), withBurn)).toBe('Removed the burn');
    expect(say(set('burn1.enabled', false), withBurn)).toBe('Burn off');
    expect(say(set('burn1.params.stops', 1), withBurn)).toBe('Burn: Stops 0.5 → 1.0 st');
    expect(say(insert('probes', 'p1', { x: 10, y: 10, r: 3 }))).toBe('Probe p1 placed');
    expect(say(insert('masks', 'm1', {}))).toBe('Mask drawn');
  });
});

group('describe: digital layers by their catalogue words (CHB-037 P9)', () => {
  const curve = layerEntry('curve', { channel: 'L', points: Coll.of([['c1p1', { x: 0, y: 0 }], ['c1p2', { x: 1, y: 1 }]]) as unknown as Json });
  it('a layer added reads by its label, an acronym with its article', () => {
    expect(say(insert('stages.print.stack', 'c1', curve))).toBe('Added a curve');
    expect(say(insert('stages.print.stack', 'h1', layerEntry('hsl')))).toBe('Added an HSL');
    expect(say(insert('stages.print.stack', 'g1', layerEntry('grade')))).toBe('Added a colour grading');
  });
  it('a curve point added or removed names the layer, not the point id', () => {
    const d = with_([insert('stages.print.stack', 'c1', curve)]);
    expect(say(insert('c1.params.points', 'c1p3', { x: 0.5, y: 0.6 }), d)).toBe('Curve: point added');
    expect(say(remove('c1p2'), d)).toBe('Curve: point removed');
  });
  it('a layer built without a name (the agent, a look) is called by its label', () => {
    const d = with_([insert('stages.darkroom.stack', 'b1', layerEntry('burn', { stops: 0.5 }))]);
    expect(say(set('b1.enabled', false), d)).toBe('Burn off');
  });
});

group('historyRows and whyRows', () => {
  it("the steps of a frame read in words (Rotate, a typed time, Lighter); why reads the path's trail", () => {
    const tx = (label: string, ...mutations: Mutation[]) => ({ doc: 'f', tx: transaction({ id: label, label, by: 'user', mutations }) });
    let log = Log.create({ rules: LOG_RULES }).open('f', d0(), { kind: 'frame', by: 'auto', source: { kind: 'ingest' } });
    log = log.commit(tx('Rotate Right', set('geometry.orientation', 'cw90')));
    log = log.commit(tx('Time', set('main.params.time_s', 12.6)));
    log = log.commit(tx('Lighter', set('main.params.time_s', 10)));
    const rows = historyRows(log, 'f', lookup);
    expect(rows.map(g => g.changes.map(c => c.text).join('; '))).toEqual(['Rotated right', 'Time 10.0 → 12.6 s (+⅓ stop)', 'Time 12.6 → 10.0 s (−⅓ stop)']);
    expect(rows.map(r => [r.cursor, r.inEffect, r.by])).toEqual([[1, true, 'user'], [2, true, 'user'], [3, true, 'user']]);
    const undone = historyRows(log.undo(), 'f', lookup);
    expect(undone.map(r => r.inEffect)).toEqual([true, true, false]);
    const w = whyRows(log, 'f', 'main.params.time_s', lookup);
    expect(w.title).toBe('Why is Time 10.0 s?');
    expect(w.rows.map(r => [r.who, r.text])).toEqual([['Auto', '10.0 s'], ['You', '10.0 s → 12.6 s'], ['You', '12.6 s → 10.0 s']]);
  });
});
