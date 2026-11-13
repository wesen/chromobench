// CHB-009's model tests (apps/studio/test/core.test.ts) for the modules moved into studio-kit/src/model: generated
// controls, the darkroom arrangement audit, history labels, approvals and diffRecipes. The gesture tests moved
// into bridge.test.ts (the route owns drags and bursts now).
import { allOps, EditLog, type Mutation } from '@chromobench/contract';
import { describe, expect, it } from 'vitest';
import { allParameters, auditArrangement, DARKROOM, defaultFor, diffRecipes, generateControls, historyGroups, lookupFor, moveCursor, pendingGroups, PRINT_SETTINGS, whyRows } from '../src/index.ts';

const models = generateControls(allOps());
const model = (p: string) => models.find(m => m.path === p)!;
const newLog = (): EditLog => EditLog.create(defaultFor('ab'.repeat(32), 'x.tif'), { by: 'auto', mode: 'ask' });
const set = (log: EditLog, path: string, value: unknown, label: string, tx?: string) => log.apply([{ op: 'set', path, value } as Mutation], 'user', label, tx ? { tx } : {});

describe('generated controls', () => {
  it('one control per recipe path with ui metadata', () => {
    const paths = models.map(m => m.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const p of ['print.enlarger.time_s', 'print.enlarger.fstop', 'print.enlarger.filtration', 'print.lights.logH', 'print.paper', 'print.grade', 'print.preflash']) expect(paths).toContain(p);
    expect(paths).not.toContain('scan.rebate');
  });
  it('lights: points with detent 0 and a log H aside', () => {
    const m = model('print.lights.logH');
    expect(m.displayUnit).toBe('point');
    expect(m.step).toBe(1);
    expect(m.detents).toEqual([0]);
    expect(m.format([0.05, -0.1, 0.05])).toBe('(+2, −4, +2) pt');
    expect(m.valueText([-0.1, 0, 0], 0)).toBe('Printer lights R minus 4 points');
  });
  it('time: seconds in stop steps, aside in stops', () => {
    const m = model('print.enlarger.time_s');
    expect(m.step).toBeCloseTo(1 / 6, 12);
    expect(m.format(15.119)).toBe('15.12 s');
    expect(m.aside!(15.119, 12)).toBe('+1/3 st');
  });
  it('filtration: a signed CC shift on the neutral pack, with the isolated-band aside (contract 0.2)', () => {
    const m = model('print.enlarger.filtration');
    expect(m.min).toBe(-100);
    expect(m.detents).toEqual([0]);
    expect(m.format({ c: 0, m: -5, y: 10 }, 2)).toBe('+10 CC');
    expect(m.format({ c: 0, m: -5, y: 10 }, 1)).toBe('−5 CC');
    expect(m.aside!({ c: 0, m: 0, y: 10 }, { c: 0, m: 0, y: 0 }, 2)).toBe('≈ −4.0 pt B');
  });
  it('aperture: third-stop series and stops aside', () => {
    const m = model('print.enlarger.fstop');
    expect(m.values).toContain('11');
    expect(m.format(8)).toBe('f/8');
    expect(m.aside!(11, 8)).toBe('−0.92 st');
  });
  it('the darkroom arrangement audit passes; all-parameters covers every control', () => {
    expect(auditArrangement(DARKROOM, models)).toEqual([]);
    expect(auditArrangement({ name: 'x', groups: [{ title: 'x', paths: ['print.nope'] }] }, models)).toEqual(['print.nope']);
    expect(allParameters(models).groups.flatMap(g => g.paths).sort()).toEqual(models.map(m => m.path).sort());
  });
});

describe('history and approvals', () => {
  it('labels, cursor moves and the state hash', () => {
    const log = newLog();
    const h0 = log.stateHash;
    set(log, 'print.enlarger.time_s', 15.12, 'Time');
    set(log, 'print.lights.logH', [0.05, -0.1, 0.05], 'ring-around +G (−M)', 'ring-1');
    const lookup = lookupFor(models);
    const groups = historyGroups(log, lookup);
    expect(groups.map(x => x.changes[0]!.text)).toEqual(['Time 10.0 → 15.12 s (+0.6 stop)', 'Printer lights R 0 → +2, G 0 → −4, B 0 → +2 pt']);
    expect(groups[1]!.tx).toBe('ring-1');
    moveCursor(log, 0);
    expect(log.stateHash).toBe(h0);
    moveCursor(log, 2);
    expect(log.cursor).toBe(2);
  });
  it('pending entries are not folded until approved; E_STALE refuses; force applies; why says approved', () => {
    const log = newLog();
    const h0 = log.stateHash;
    const [e] = log.propose([{ op: 'set', path: 'print.enlarger.time_s', value: 15.12 }], { tx: 'eval-1', why: 'a third of a stop more' });
    expect(log.stateHash).toBe(h0);
    expect(pendingGroups(log, lookupFor(models))[0]!.changes[0]!.text).toBe('Time 10.0 → 15.12 s (+0.6 stop)');
    set(log, 'print.enlarger.time_s', 11, 'Time');
    const r = log.approve([e!.seq]);
    expect(Array.isArray(r) && r[0]!.code).toBe('E_STALE');
    expect(Array.isArray(log.approve([e!.seq], { force: true }))).toBe(false);
    const w = whyRows(log, 'print.enlarger.time_s', lookupFor(models));
    expect(w.title).toBe('Why is Time 15.12 s?');
    expect(w.rows.at(-1)!.note).toContain('approved');
  });
  it('diffRecipes copies print settings only', () => {
    const a = defaultFor('ab'.repeat(32), 'x.tif');
    const other = defaultFor('cd'.repeat(32), 'y.tif');
    const ms = diffRecipes(other, { ...a, print: { ...a.print, enlarger: { ...a.print.enlarger, time_s: 14 } } }, PRINT_SETTINGS);
    expect(ms).toEqual([{ op: 'set', path: 'print.enlarger.time_s', value: 14 }]);
  });
});
