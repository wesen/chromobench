// Controls generated from the catalogue on document paths (CHB-037): one control per document path whose ArgSpec has
// ui hints — the main exposure's and the printer lights' params, the media; a layer's argument by its op (main:
// expose, lights: filter, any other id: the document's entry). The darkroom arrangement names only such paths.
import { edit, layerEntry, type Document } from '@chromobench/contract';
import { insert, set } from '@chromobench/values';
import { describe, expect, it } from 'vitest';
import { allParameters, auditArrangement, DARKROOM } from '../src/model/arrangement.ts';
import { argModel, argProblem, controlModels, modelAt } from '../src/kit/args.ts';
import { defaultDocument } from '../src/model/doc.ts';
import { copySettings, PRINT_SETTINGS } from '../src/model/settings.ts';
import type { ControlModel } from '../src/model/controls.ts';

const models = controlModels();
const model = (p: string): ControlModel => modelAt(p) ?? (() => { throw new Error(`no control ${p}`); })();
const d0 = (sha = 'ab'): Document => defaultDocument('negative-scan', { sha256: sha.repeat(32), name: 'x.tif', width: 3000, height: 2000 });

describe('generated controls', () => {
  it('one control per document path with ui metadata', () => {
    const paths = models.map(m => m.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const p of ['main.params.time_s', 'main.params.fstop', 'main.params.filtration', 'lights.params.logH', 'stages.darkroom.medium.paper', 'stages.darkroom.medium.grade', 'stages.darkroom.medium.mode', 'stages.scan.medium.stock', 'stages.film.medium.stock', 'stages.print.medium.illuminant']) expect(paths).toContain(p);
    // boxes are edited with tools, not generated controls; fields without ui have none
    expect(paths).not.toContain('stages.scan.medium.rebate');
    expect(paths).not.toContain('geometry.crop');
    expect(paths).not.toContain('stages.scan.medium.umPerPx');
  });
  it('lights: points with detent 0 and a log H aside', () => {
    const m = model('lights.params.logH');
    expect(m.displayUnit).toBe('point');
    expect(m.step).toBe(1);
    expect(m.detents).toEqual([0]);
    expect(m.format([0.05, -0.1, 0.05])).toBe('(+2, −4, +2) pt');
    expect(m.valueText([-0.1, 0, 0], 0)).toBe('Printer lights R minus 4 points');
  });
  it('time: seconds in stop steps, aside in stops', () => {
    const m = model('main.params.time_s');
    expect(m.step).toBeCloseTo(1 / 6, 12);
    expect(m.format(15.119)).toBe('15.12 s');
    expect(m.aside!(15.119, 12)).toBe('+1/3 st');
  });
  it('filtration: a signed CC shift on the neutral pack, with the isolated-band aside', () => {
    const m = model('main.params.filtration');
    expect(m.min).toBe(-100);
    expect(m.detents).toEqual([0]);
    expect(m.format({ c: 0, m: -5, y: 10 }, 2)).toBe('+10 CC');
    expect(m.format({ c: 0, m: -5, y: 10 }, 1)).toBe('−5 CC');
    expect(m.aside!({ c: 0, m: 0, y: 10 }, { c: 0, m: 0, y: 0 }, 2)).toBe('≈ −4.0 pt B');
  });
  it('aperture: third-stop series and stops aside', () => {
    const m = model('main.params.fstop');
    expect(m.values).toContain('11');
    expect(m.format(8)).toBe('f/8');
    expect(m.aside!(11, 8)).toBe('−0.92 st');
  });
  it('media: the paper by name, the enlarger mode in words', () => {
    expect(model('stages.darkroom.medium.paper').valuesFrom).toBe('stocks:print');
    expect(model('stages.darkroom.medium.mode').valueLabel('normalised')).toBe('Normalised (grey card at the aim)');
  });
  it('components and layer arguments: argModel resolves a component, and a burn by the document\'s entry', () => {
    expect(argModel('lights.params.logH.g')).toMatchObject({ path: 'lights.params.logH', component: 1 });
    expect(argModel('main.params.filtration.y')).toMatchObject({ path: 'main.params.filtration', component: 2 });
    const d = edit(d0(), [insert('stages.darkroom.stack', 'b1', layerEntry('burn', { stops: 0.5 }))]).doc;
    const b = argModel('b1.params.stops', d)!;
    expect(b.model.op).toBe('burn');
    expect(b.model.path).toBe('b1.params.stops');
    expect(argModel('b1.params.stops')!.model.label).toBe('Stops'); // at build time: the first layer op with the argument
    expect(argModel('print.enlarger.time_s')).toBeNull();
  });
  it('CB-A101: an unknown path names the valid ones and a fix', () => {
    const p = argProblem('main.params.time');
    expect(p?.code).toBe('CB-A101');
    expect(p && 'fix' in p ? p.fix : null).toBe("cb.arg('main.params.time_s')");
    expect(argProblem('main.params.time_s')).toBeNull();
    expect(argProblem('dodge1.params.through')?.code).toBe('CB-A102');
  });
  it('the darkroom arrangement audit passes; all-parameters covers every control', () => {
    expect(auditArrangement(DARKROOM, models)).toEqual([]);
    expect(auditArrangement({ name: 'x', groups: [{ title: 'x', paths: ['print.nope'] }] }, models)).toEqual(['print.nope']);
    expect(allParameters(models).groups.flatMap(g => g.paths).sort()).toEqual(models.map(m => m.path).sort());
  });
});

describe('Apply Print Settings', () => {
  it('copySettings copies the print settings only, and only what differs', () => {
    const a = edit(d0(), [set('main.params.time_s', 14), set('geometry.angle_deg', 2)]).doc;
    expect(copySettings(a, d0('cd'))).toEqual([{ op: 'set', path: 'main.params.time_s', value: 14 }]);
    expect(PRINT_SETTINGS).toContain('lights.params.logH');
  });
  it('a time copied onto a normalised frame becomes the same exposure on its printer lights', () => {
    const a = edit(d0(), [set('main.params.time_s', 20)]).doc;
    const n = edit(d0('cd'), [set('stages.darkroom.medium.mode', 'normalised')]).doc;
    // the whole print settings carry the real mode along, so the time stays a time
    expect(copySettings(a, n).map(m => (m.op === 'set' ? m.path : m.op))).toEqual(['stages.darkroom.medium.mode', 'main.params.time_s']);
    // the time alone on a normalised frame: one stop more light on the three printer lights
    const ms = copySettings(a, n, ['main.params.time_s']);
    expect(ms.map(m => (m.op === 'set' ? m.path : m.op))).toEqual(['lights.params.logH']);
    for (const v of (ms[0] as { value: number[] }).value) expect(v).toBeCloseTo(Math.log10(2), 6);
  });
});
