// Core machinery: generated controls, the darkroom arrangement audit, gestures (one mutation per
// drag, none on Esc, one per keyboard burst), history and approvals, snapshots, the scheduler.
import {
  allOps, ChromobenchError, EditLog, Graph, sha256Hex, type Engine, type EvalTarget, type ImageResult, type NodeRef,
} from '@chromobench/contract';
import { makeM1Tiff, MockEngine } from '@chromobench/engine-mock';
import { describe, expect, it } from 'vitest';
import { auditArrangement, DARKROOM, allParameters } from '../src/core/arrangement.ts';
import { generateControls } from '../src/core/controls.ts';
import { defaultFor, diffRecipes, FrameSession, PRINT_SETTINGS } from '../src/core/frame-session.ts';
import { GestureController } from '../src/core/gesture.ts';
import { historyGroups, lookupFor, moveCursor, pendingGroups, whyRows } from '../src/core/history.ts';
import { actionFor, isTyping } from '../src/core/keyboard.ts';
import { chooseEvictions } from '../src/storage/opfs.ts';
import { RenderScheduler, type PresentFrame } from '../src/core/scheduler.ts';
import { fromHalf, toHalf } from '../src/present/presenter.ts';

const models = generateControls(allOps());
const model = (p: string) => models.find((m) => m.path === p)!;

describe('generated controls', () => {
  it('one control per recipe path with ui metadata', () => {
    const paths = models.map((m) => m.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const p of ['print.enlarger.time_s', 'print.enlarger.fstop', 'print.enlarger.filtration', 'print.lights.logH', 'print.paper', 'print.grade', 'print.preflash']) expect(paths).toContain(p);
    expect(paths).not.toContain('scan.rebate'); // box arguments are tool-edited
    expect(models.map((m) => [m.path, m.widget, m.displayUnit, m.scale])).toMatchSnapshot();
  });
  it('lights: points with detent 0 and a log H aside', () => {
    const m = model('print.lights.logH');
    expect(m.displayUnit).toBe('point');
    expect(m.toDisplay(m.min!)).toBe(-60);
    expect(m.step).toBe(1);
    expect(m.detents).toEqual([0]);
    expect(m.format([0.05, -0.1, 0.05])).toBe('(+2, −4, +2) pt');
    expect(m.valueText([0.1, 0, 0], 0)).toBe('Printer lights R 4 points');
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
    expect(m.format({ c: 0, m: -5, y: 10 })).toBe('(0, −5, +10) CC');
    expect(m.aside!({ c: 0, m: 0, y: 10 }, { c: 0, m: 0, y: 0 }, 2)).toBe('≈ −4.0 pt B');
  });
  it('aperture: third-stop series and stops aside', () => {
    const m = model('print.enlarger.fstop');
    expect(m.values).toContain('11');
    expect(m.format(8)).toBe('f/8');
    expect(m.aside!(11, 8)).toBe('−0.92 st');
  });
  it('format(fromDisplay(toDisplay(v))) round-trips within a step', () => {
    for (const m of models.filter((x) => x.type === 'number' && x.scale === 'linear')) {
      for (const v of [m.min ?? 0, m.max ?? 1, ((m.min ?? 0) + (m.max ?? 1)) / 2]) expect(Math.abs(m.fromDisplay(m.toDisplay(v)) - v)).toBeLessThan(m.fromDisplay(m.step) + 1e-9);
    }
  });
  it('the darkroom arrangement audit passes; all-parameters covers every control', () => {
    expect(auditArrangement(DARKROOM, models)).toEqual([]);
    expect(auditArrangement({ name: 'x', groups: [{ title: 'x', paths: ['print.nope'] }] }, models)).toEqual(['print.nope']);
    expect(allParameters(models).groups.flatMap((g) => g.paths).sort()).toEqual(models.map((m) => m.path).sort());
  });
});

function newLog(): EditLog {
  return EditLog.create(defaultFor('ab'.repeat(32), 'x.tif'), { by: 'auto', mode: 'ask' });
}

function fakeTimers(): { set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void; fire: () => void } {
  let pending: (() => void) | null = null;
  return { set: (fn) => { pending = fn; return 1; }, clear: () => { pending = null; }, fire: () => { const f = pending; pending = null; f?.(); } };
}

describe('gestures', () => {
  it('a 120-event drag logs exactly one mutation; Esc logs none', () => {
    const log = newLog();
    const g = new GestureController(() => log);
    for (let i = 1; i <= 120; i++) g.drag('print.lights.logH', [0.001 * i, 0, 0], 'Printer lights R');
    expect(log.entries).toHaveLength(0);
    expect(log.state.print.lights.logH[0]).toBeCloseTo(0.12, 12);
    g.commit();
    expect(log.entries).toHaveLength(1);
    expect(log.units).toHaveLength(1);
    for (let i = 1; i <= 10; i++) g.drag('print.enlarger.time_s', 10 + i, 'Time');
    g.cancel();
    expect(log.entries).toHaveLength(1);
    expect(log.state.print.enlarger.time_s).toBe(10);
  });
  it('a keyboard burst is one undo step; a pause starts a new one', () => {
    const log = newLog();
    const t = fakeTimers();
    const g = new GestureController(() => log, { setTimer: t.set, clearTimer: t.clear });
    const h0 = log.stateHash;
    for (let i = 1; i <= 5; i++) g.step('print.enlarger.filtration', { c: 0, m: 0, y: i }, 'Filtration Y');
    expect(log.entries).toHaveLength(0);
    t.fire();
    expect(log.units).toHaveLength(1);
    g.step('print.enlarger.filtration', { c: 0, m: 0, y: 6 }, 'Filtration Y');
    t.fire();
    expect(log.units).toHaveLength(2);
    log.undo();
    log.undo();
    expect(log.stateHash).toBe(h0);
  });
  it('touching another control commits the burst first; no-op commits log nothing', () => {
    const log = newLog();
    const g = new GestureController(() => log, { setTimer: () => 1, clearTimer: () => {} });
    g.step('print.grade', 2.5, 'Grade');
    g.drag('print.preflash', 0.01, 'Preflash');
    expect(log.units).toHaveLength(1);
    g.drag('print.preflash', 0, 'Preflash');
    g.commit();
    expect(log.units).toHaveLength(1);
  });
});

describe('history and approvals', () => {
  it('labels, cursor moves and the state hash', () => {
    const log = newLog();
    const g = new GestureController(() => log);
    const h0 = log.stateHash;
    g.set('print.enlarger.time_s', 15.12, 'Time');
    g.set('print.lights.logH', [0.05, -0.1, 0.05], 'ring-around +G (−M)', 'ring-1');
    const lookup = lookupFor(models);
    const groups = historyGroups(log, lookup);
    expect(groups.map((x) => x.changes[0]!.text)).toEqual(['Time 10.0 → 15.12 s (+0.60 st)', 'Printer lights (0, 0, 0) → (+2, −4, +2) pt']);
    expect(groups[1]!.tx).toBe('ring-1');
    moveCursor(log, 0);
    expect(log.stateHash).toBe(h0);
    expect(historyGroups(log, lookup).every((x) => !x.inEffect)).toBe(true);
    moveCursor(log, 2);
    expect(log.cursor).toBe(2);
  });
  it('pending agent entries are not folded until approved; E_STALE refuses; force applies', () => {
    const log = newLog();
    const g = new GestureController(() => log);
    const h0 = log.stateHash;
    const [e] = log.propose([{ op: 'set', path: 'print.enlarger.time_s', value: 15.12 }], { tx: 'eval-1', why: 'a third of a stop more' });
    expect(log.stateHash).toBe(h0);
    const pend = pendingGroups(log, lookupFor(models));
    expect(pend).toHaveLength(1);
    expect(pend[0]!.changes[0]!.text).toBe('Time 10.0 → 15.12 s (+0.60 st)');
    g.set('print.enlarger.time_s', 11, 'Time');
    const r = log.approve([e!.seq]);
    expect(Array.isArray(r) && r[0]!.code).toBe('E_STALE');
    const ok = log.approve([e!.seq], { force: true });
    expect(Array.isArray(ok)).toBe(false);
    expect(log.committed.print.enlarger.time_s).toBe(15.12);
    const w = whyRows(log, 'print.enlarger.time_s', lookupFor(models));
    expect(w.title).toBe('Why is Time 15.12 s?');
    expect(w.rows.at(-1)!.note).toContain('approved');
  });
});

describe('frame session', () => {
  it('snapshot restore is one transaction; contact-sheet diff copies print settings only', async () => {
    const engine = new MockEngine();
    const s = await FrameSession.open(engine, makeM1Tiff(), 'm1.tif', { mode: 'ask' });
    const g = new GestureController(() => s.log);
    const snap = s.snapshot('A');
    g.set('print.enlarger.time_s', 20, 'Time');
    g.set('print.grade', 3, 'Grade');
    g.set('probes.grey', { x: 48, y: 32, r: 3 }, 'probe');
    const before = s.log.units.length;
    g.apply(diffRecipes(s.log.committed, snap.recipe), 'Restore A');
    expect(s.log.units.length).toBe(before + 1);
    expect(s.log.committed.print.enlarger.time_s).toBe(10);
    expect(s.log.committed.print.grade).toBe(2);
    const other = defaultFor('cd'.repeat(32), 'y.tif');
    const ms = diffRecipes(other, { ...s.log.committed, print: { ...s.log.committed.print, enlarger: { ...s.log.committed.print.enlarger, time_s: 14 } } }, PRINT_SETTINGS);
    expect(ms).toEqual([{ op: 'set', path: 'print.enlarger.time_s', value: 14 }]);
  });
  it('inspection views and the ring-around centre tile share the main node', async () => {
    const engine = new MockEngine();
    const s = await FrameSession.open(engine, makeM1Tiff(), 'm1.tif', { mode: 'ask' });
    const main = s.displayNode();
    const r = s.log.state;
    expect(s.displayNode({ ...r, print: { ...r.print, lights: { ...r.print.lights, logH: [0, 0, 0] } } }).id).toBe(main.id);
    for (const v of ['negative', 'dyes', 'classes'] as const) {
      const n = s.viewNode(v);
      const res = await engine.evaluate(n, { scale: 'full', precision: 'preview' });
      expect(res.info.domain).toBe('display-rgb');
    }
  });
});

// ---- scheduler ----------------------------------------------------------------------------

class FakeEngine {
  calls: { id: string; target: EvalTarget; resolve: () => void; reject: (e: unknown) => void }[] = [];
  evaluate(node: NodeRef, target: EvalTarget): Promise<ImageResult> {
    return new Promise((resolve, reject) => {
      const result: ImageResult = {
        node: node.id, info: node.info as ImageResult['info'], scale: 1, region: { x: 0, y: 0, w: 1, h: 1 }, width: 1, height: 1, format: 'f32',
        read: async () => new Float32Array(3), warnings: [],
      };
      target.signal?.addEventListener('abort', () => reject(new ChromobenchError({ code: 'E_CANCELLED', message: 'cancelled' })));
      this.calls.push({ id: node.id, target, resolve: () => resolve(result), reject });
    });
  }
}
const ref = (id: string): NodeRef => ({ id, info: { kind: 'Image', domain: 'display-rgb', width: 1, height: 1, channels: 3 } as unknown as NodeRef['info'] });
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('render scheduler', () => {
  it('three requests while one is in flight → two evaluations, the second for the newest', async () => {
    const fe = new FakeEngine();
    const shown: PresentFrame[] = [];
    const s = new RenderScheduler(() => fe as unknown as Engine, (f) => shown.push(f));
    s.request({ node: ref('a'), pass: 'screen', scale: 'full' });
    await tick();
    for (const id of ['b', 'c', 'd']) s.request({ node: ref(id), pass: 'screen', scale: 'full' });
    await tick();
    // the in-flight 'a' was aborted as superseded
    expect(s.stats.aborted).toBeGreaterThan(0);
    await tick();
    expect(fe.calls.map((c) => c.id)).toEqual(['a', 'd']);
    fe.calls[1]!.resolve();
    await s.idle();
    expect(shown.map((f) => f.main.result.node)).toEqual(['d']);
  });
  it('a superseded result that arrives anyway (engine ignored the abort) is never shown', async () => {
    const fe = new FakeEngine();
    fe.evaluate = function (node, target) {
      return new Promise((resolve) => {
        this.calls.push({ id: node.id, target, resolve: () => resolve({ node: node.id, info: node.info, scale: 1, region: { x: 0, y: 0, w: 1, h: 1 }, width: 1, height: 1, format: 'f32', read: async () => new Float32Array(3), warnings: [] } as ImageResult), reject: () => {} });
      });
    };
    const shown: string[] = [];
    const s = new RenderScheduler(() => fe as unknown as Engine, (f) => shown.push(f.main.result.node));
    s.request({ node: ref('old'), pass: 'draft', scale: 0.25 });
    await tick();
    s.request({ node: ref('new'), pass: 'screen', scale: 'full' });
    fe.calls[0]!.resolve(); // late result of the superseded request
    await tick();
    await tick();
    fe.calls[1]!.resolve();
    await s.idle();
    expect(shown).toEqual(['new']);
  });
  it('the same request again keeps the in-flight evaluation', async () => {
    const fe = new FakeEngine();
    const s = new RenderScheduler(() => fe as unknown as Engine, () => {});
    s.request({ node: ref('a'), pass: 'screen', scale: 'full' });
    await tick();
    s.request({ node: ref('a'), pass: 'screen', scale: 'full' });
    expect(s.stats.aborted).toBe(0);
    fe.calls[0]!.resolve();
    await tick();
    await tick();
    fe.calls[1]?.resolve();
    await s.idle();
    expect(s.stats.presented).toBeGreaterThanOrEqual(1);
  });
  it('on the mock engine: draft passes during a drag, then one screen pass', async () => {
    const engine = new MockEngine();
    const s = await FrameSession.open(engine, makeM1Tiff(), 'm1.tif', { mode: 'ask' });
    const passes: string[] = [];
    const sch = new RenderScheduler(() => engine, (f) => passes.push(f.req.pass));
    const g = new GestureController(() => s.log);
    for (let i = 1; i <= 3; i++) {
      g.drag('print.lights.logH', [0.025 * i, 0, 0], 'R');
      sch.request({ node: s.displayNode(), pass: 'draft', scale: 0.5 });
      await sch.idle();
    }
    g.commit();
    sch.request({ node: s.displayNode(), pass: 'screen', scale: 'full' });
    await sch.idle();
    expect(passes).toEqual(['draft', 'draft', 'draft', 'screen']);
    expect(s.log.entries).toHaveLength(1);
  });
});

describe('misc', () => {
  it('keyboard map: no approval shortcut; text fields are ignored', () => {
    const k = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => actionFor({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });
    expect(k('z', { ctrlKey: true })).toBe('undo');
    expect(k('Z', { metaKey: true, shiftKey: true })).toBe('redo');
    expect(k('\\')).toBe('beforeAfter');
    expect(k('a')).toBeNull();
    expect(k('Enter')).toBeNull();
    expect(isTyping({ tagName: 'INPUT', type: 'text' } as unknown as EventTarget)).toBe(true);
    expect(isTyping({ tagName: 'INPUT', type: 'range' } as unknown as EventTarget)).toBe(false);
  });
  it('OPFS eviction is LRU over caches only', () => {
    const e = [
      { path: 'cache/thumbs/a.png', size: 100, lastUsed: 1 },
      { path: 'imports/x.tif', size: 10_000, lastUsed: 0 },
      { path: 'cache/thumbs/b.png', size: 100, lastUsed: 3 },
      { path: 'cache/thumbs/c.png', size: 100, lastUsed: 2 },
    ];
    expect(chooseEvictions(e, 150)).toEqual(['cache/thumbs/a.png', 'cache/thumbs/c.png']);
    expect(chooseEvictions(e, 1000)).toEqual([]);
  });
  it('half floats round-trip display values to 8-bit codes', () => {
    for (let c = 0; c <= 255; c++) expect(Math.round(fromHalf(toHalf(c / 255)) * 255)).toBe(c);
    expect(fromHalf(toHalf(0.3703))).toBeCloseTo(0.3703, 3);
  });
  it('edit logs persist and resume by hash', async () => {
    const engine = new MockEngine();
    const bytes = makeM1Tiff();
    const s = await FrameSession.open(engine, bytes, 'm1.tif', { mode: 'ask' });
    new GestureController(() => s.log).set('print.grade', 3, 'Grade');
    const saved = s.log.toJSON();
    const s2 = await FrameSession.open(new MockEngine(), bytes, 'renamed.tif', { mode: 'ask', saved });
    expect(s2.sha).toBe(sha256Hex(bytes));
    expect(s2.log.stateHash).toBe(s.log.stateHash);
    expect(new Graph()).toBeTruthy();
  });
});
