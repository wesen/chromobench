// The studio on the document log (CHB-037 P5b-1): a frame is a document at docs.<f> in the store's log; a drag is
// one step and Esc logs nothing; nudges on one control coalesce; two frames in one transaction are one batch step;
// the agent proposes into the log (ask), commits (auto) or is refused (read-only); proposals are published for the
// panels with the document Show renders, approved whole or in part, E_STALE and Apply anyway; saved edits round trip
// through the KV with their history; the hard cut-off on old storage.
import { makeM1Tiff } from '@chromobench/engine-mock';
import { sha256Hex, type Document } from '@chromobench/contract';
import { set } from '@chromobench/values';
import type { RecordingChrome } from '@chromobench/shell';
import { describe, expect, it } from 'vitest';
import {
  frameRef, frameSave, historyRows, isFrameSave, logKey, memoryKV, modelAt, resetStorage, sel, STORAGE_FORMAT, whyRows, type CbState,
  type FrameSave, type ModelLookup,
} from '../src/index.ts';
import { hashBytes } from '../src/bridge/frames.ts';
import { at, docOf, otherTiff, setDoc, shown, started, timeOf } from './helpers.ts';

const TIME = 'main.params.time_s';
const LIGHTS = 'lights.params.logH';
const lookup: ModelLookup = (p, d) => modelAt(p, d) ?? undefined;
const state = (rt: { state: unknown }) => rt.state as CbState;

describe('file identity (CHB-027)', () => {
  it("hashBytes: WebCrypto for big files gives the contract's sha256Hex", async () => {
    const big = new Uint8Array(3 << 20).map((_, i) => (i * 2654435761) >>> 24);
    expect(await hashBytes(big)).toBe(sha256Hex(big));
    const small = new Uint8Array([1, 2, 3]);
    expect(await hashBytes(small)).toBe(sha256Hex(small));
  });
});

describe('frames are documents in the log', () => {
  it('the frame opens at docs.<f> under the frame rules, and is catalogued in the view tier', async () => {
    const { rt, studio, f } = await started();
    const s = state(rt);
    expect(rt.store.log.kind(f)).toBe('frame');
    expect(rt.store.mounts.get(f)).toEqual(['docs', f]);
    expect(rt.store.peek(['docs', f])).toBe(rt.store.log.doc(f));
    expect(studio.doc(f)).toBe(rt.store.log.doc(f));
    expect(s.docs[f]!.format).toBe(3);
    expect(s.catalog.frames[f]!.name).toBe('m1.tif');
    expect(rt.store.tierOf(['catalog'])).toBe('view');
    expect(s.ui.selection.primary).toBe(f);
    // opening a file is no undo step
    expect(rt.store.log.canUndo).toBe(false);
  });

  it('a 120-move drag is one step; Esc logs nothing; undo and redo walk the log', async () => {
    const { rt, f } = await started();
    for (let i = 1; i <= 120; i++) rt.store.preview(at(rt, f, TIME), 10 + i * 0.02);
    expect(timeOf(rt, f)).toBe(10);
    expect((shown(rt, f).stages.darkroom.stack.items['main'] as any).params.time_s).toBeCloseTo(12.4);
    rt.store.commit('Time');
    expect(rt.store.log.steps.length).toBe(1);
    expect(rt.store.log.last!.tx.mutations).toEqual([set(TIME, 12.4)]);
    expect(timeOf(rt, f)).toBeCloseTo(12.4);
    // Esc
    rt.store.preview(at(rt, f, TIME), 20);
    rt.store.cancel();
    expect(rt.store.log.steps.length).toBe(1);
    expect(timeOf(rt, f)).toBeCloseTo(12.4);
    rt.run('edit.undo');
    expect(rt.store.log.cursor).toBe(0);
    expect(timeOf(rt, f)).toBe(10);
    rt.run('edit.redo');
    expect(timeOf(rt, f)).toBeCloseTo(12.4);
  });

  it('nudges on one control coalesce into one step; a pause or another control starts a new one', async () => {
    const { rt, f, clock } = await started();
    const nudge = (path: string, v: unknown) => setDoc(rt, f, path, v, path, { coalesce: `${f}:${path}` });
    nudge(TIME, 11);
    clock.advance(300);
    nudge(TIME, 12);
    clock.advance(300);
    nudge(TIME, 13);
    expect(rt.store.log.steps.length).toBe(1);
    expect(timeOf(rt, f)).toBe(13);
    clock.advance(2000); // a pause
    nudge(TIME, 14);
    expect(rt.store.log.steps.length).toBe(2);
    nudge('stages.darkroom.medium.grade', 3); // another control
    expect(rt.store.log.steps.length).toBe(3);
    rt.run('edit.undo');
    rt.run('edit.undo');
    expect(timeOf(rt, f)).toBe(13);
  });

  it('two frames in one transaction are one batch step; a refused value aborts all of it', async () => {
    const { rt, studio, f } = await started();
    const g = (await studio.open(otherTiff(), 'm2.tif')).id;
    rt.ctx().tx('Both', (t: any) => {
      t.$set(at(rt, f, TIME), 12);
      t.$set(at(rt, g, TIME), 14);
    });
    const step = rt.store.log.undoStep!;
    expect(rt.store.log.docsOf(step).sort()).toEqual([f, g].sort());
    expect(step.batch).toBeTruthy();
    // a value out of range on one frame: nothing changes on either
    rt.ctx().tx('Bad', (t: any) => {
      t.$set(at(rt, f, TIME), 13);
      t.$set(at(rt, g, TIME), 0);
    });
    expect(timeOf(rt, f)).toBe(12);
    expect(timeOf(rt, g)).toBe(14);
    expect((rt.chrome as RecordingChrome).toasts.at(-1)!.text).toBe('Time must be between 0.1 s and 600 s');
    rt.run('edit.undo');
    expect(timeOf(rt, f)).toBe(10);
    expect(timeOf(rt, g)).toBe(10);
  });

  it('Undo and Redo of a change on another frame select that frame, after the toast named it (F36)', async () => {
    const { rt, studio, f } = await started();
    const g = (await studio.open(otherTiff(), 'm2.tif')).id;
    rt.run('frame.select', f);
    setDoc(rt, f, TIME, 12.6, 'Time');
    rt.run('frame.select', g);
    rt.run('edit.undo');
    expect((rt.chrome as RecordingChrome).toasts.at(-1)!.text).toBe('Undo Time (on m1.tif)');
    await Promise.resolve();
    await Promise.resolve();
    expect(studio.current).toBe(f);
    expect(timeOf(rt, f)).toBe(10);
    rt.run('frame.select', g);
    rt.run('edit.redo');
    await Promise.resolve();
    await Promise.resolve();
    expect(studio.current).toBe(f);
  });

  it('History rows and History jumps move the one cursor', async () => {
    const { rt, studio, f } = await started();
    setDoc(rt, f, TIME, 12.6, 'Time');
    rt.run('frame.rotateRight');
    const rows = historyRows(rt.store.log, f, lookup);
    expect(rows.map(r => r.changes.map(c => c.text).join('; '))).toEqual(['Time 10.0 → 12.6 s (+⅓ stop)', 'Rotated right']);
    expect(rows.map(r => r.cursor)).toEqual([1, 2]);
    rt.run('history.jump', 0);
    expect(rt.store.log.cursor).toBe(0);
    expect(historyRows(rt.store.log, f, lookup).every(r => !r.inEffect)).toBe(true);
    rt.run('history.jump', 2);
    expect(docOf(rt, f).geometry.orientation).toBe('cw90');
    expect(whyRows(rt.store.log, f, TIME, lookup).rows.map(r => r.text)).toEqual(['10.0 s', '10.0 s → 12.6 s']);
    void studio;
  });
});

describe('agent proposals (§26)', () => {
  it('ask: a proposal is pending, published at ui.log with the document Show renders; the document is untouched', async () => {
    const { rt, studio, f } = await started();
    const seq = studio.propose([set(LIGHTS, [0.1, 0, 0])], { why: 'warmer', tx: 'eval-1' });
    await studio.flush();
    expect(rt.store.log.pending(f).map(e => e.seq)).toEqual([seq]);
    const [p] = sel.proposals(state(rt), f);
    expect(p).toMatchObject({ seq, tx: 'eval-1', why: 'warmer', by: 'agent' });
    expect(p!.changes.map(c => c.text)).toEqual(['Printer lights R 0 → +4 pt']);
    expect((p!.doc!.stages.darkroom.stack.items['lights'] as any).params.logH).toEqual([0.1, 0, 0]);
    expect((docOf(rt, f).stages.darkroom.stack.items['lights'] as any).params.logH).toEqual([0, 0, 0]);
    // Show: the viewer's handle carries the proposed document
    rt.run('proposal.show', 'eval-1');
    expect(state(rt).ui.showProposal).toBe('eval-1');
    // approve: one step, by the agent, approved by the user
    rt.run('proposal.approve', f, 'eval-1');
    await studio.flush();
    expect((docOf(rt, f).stages.darkroom.stack.items['lights'] as any).params.logH).toEqual([0.1, 0, 0]);
    expect(rt.store.log.last).toMatchObject({ approvedBy: 'user' });
    expect(rt.store.log.last!.tx.by).toBe('agent');
    expect(sel.proposals(state(rt), f)).toEqual([]);
    expect(rt.store.log.why(f, LIGHTS)).toMatchObject({ by: 'agent', approvedBy: 'user' });
  });

  it('partial approval: the unchecked change is left out; the rest is one step', async () => {
    const { rt, studio, f } = await started();
    studio.propose([set(TIME, 12), set('stages.darkroom.medium.grade', 3)], { tx: 'eval-2', why: 'two' });
    await studio.flush();
    rt.run('proposal.toggle', 'eval-2', 1);
    rt.run('proposal.approve', f, 'eval-2');
    await studio.flush();
    expect(timeOf(rt, f)).toBe(12);
    expect((docOf(rt, f).stages.darkroom.medium as any).grade).toBe(2);
    expect(rt.store.log.pending(f)).toEqual([]);
    expect(rt.store.log.entries.some(e => e.tx.id === 'eval-2' && e.tx.status === 'rejected')).toBe(true);
    rt.run('edit.undo');
    expect(timeOf(rt, f)).toBe(10);
  });

  it('E_STALE keeps the card with the reason; Apply anyway forces; reject marks it rejected', async () => {
    const { rt, studio, f } = await started();
    studio.propose([set(TIME, 12)], { tx: 'eval-3' });
    setDoc(rt, f, TIME, 15, 'Time'); // the photographer changes what the proposal would undo
    await studio.flush();
    rt.run('proposal.approve', f, 'eval-3');
    expect(state(rt).ui.approvals['eval-3']!.stale![0]!.code).toBe('E_STALE');
    expect(timeOf(rt, f)).toBe(15);
    rt.run('proposal.approve', f, 'eval-3', true);
    expect(timeOf(rt, f)).toBe(12);
    studio.propose([set('stages.darkroom.medium.grade', 3)], { tx: 'eval-4' });
    await studio.flush();
    rt.run('proposal.reject', f, 'eval-4');
    await studio.flush();
    expect(rt.store.log.pending(f)).toEqual([]);
    expect(rt.store.log.entries.at(-1)!.tx.status).toBe('rejected');
  });

  it('auto commits as the agent; read-only refuses with E_READONLY', async () => {
    const { rt, studio, f } = await started({ mode: 'auto' });
    studio.propose([set(TIME, 11)]);
    expect(timeOf(rt, f)).toBe(11);
    expect(rt.store.log.last!.tx.by).toBe('agent');
    rt.run('agent.mode', 'read-only');
    expect(studio.mode).toBe('read-only');
    expect(() => studio.propose([set(TIME, 12)])).toThrow(/E_READONLY/);
    expect(timeOf(rt, f)).toBe(11);
  });
});

describe('saved edits (persistence)', () => {
  it("a frame's edit is saved under (hash, mode) and resumes with its history; the catalog and snapshots survive a reload", async () => {
    const kv = memoryKV();
    const a = await started({ kv });
    setDoc(a.rt, a.f, TIME, 15, 'Time');
    a.rt.run('frame.pick');
    a.rt.run('snapshot.new', 'warm');
    a.studio.propose([set('stages.darkroom.medium.grade', 3)], { why: 'harder' });
    await a.studio.flush();
    const saved = await kv.get<FrameSave>('logs', logKey(sha256Hex(makeM1Tiff()), 'negative-scan'));
    expect(isFrameSave(saved)).toBe(true);
    expect(saved!.applied.map(t => t.label)).toEqual(['Time']);
    expect(saved!.pending.map(t => t.why)).toEqual(['harder']);
    // the workspace (catalog, snapshots) is saved by the shell's autosave
    a.clock.advance(2000);
    a.clock.runIdle();
    await new Promise(r => setTimeout(r, 0));
    const b = await started({ kv });
    expect(b.f).toBe(a.f);
    expect(timeOf(b.rt, b.f)).toBe(15);
    const s = state(b.rt);
    expect(s.catalog.frames[b.f]!.flag).toBe('pick');
    expect(s.snapshots[b.f]![0]!.name).toBe('warm');
    expect(historyRows(b.rt.store.log, b.f, lookup).map(r => r.label)).toEqual(['Time']);
    expect(b.rt.store.log.why(b.f, TIME).label).toBe('Time');
    expect(b.rt.store.log.pending(b.f).map(e => e.why)).toEqual(['harder']);
    // the restored step is undoable; the snapshot restore is one step
    setDoc(b.rt, b.f, TIME, 20, 'Time');
    b.rt.run('snapshot.restore', 's1');
    expect(timeOf(b.rt, b.f)).toBe(15);
    expect(b.rt.store.log.undoStep!.label).toBe('Restore "warm"');
  });

  it('a record of another format is not read: the frame opens new', async () => {
    const kv = memoryKV();
    const bytes = makeM1Tiff();
    await kv.put('logs', logKey(sha256Hex(bytes), 'negative-scan'), { initial: { kind: 'negative-scan' }, entries: [], units: [], cursor: 0 });
    const { rt, f } = await started({ kv, bytes });
    expect(timeOf(rt, f)).toBe(10);
    expect(rt.store.log.steps.length).toBe(0);
  });

  it('frameSave is what the log holds for one frame', async () => {
    const { rt, f } = await started();
    setDoc(rt, f, TIME, 12, 'Time');
    const s = frameSave(rt.store.log, f);
    expect(s.initial).toBe(rt.store.log.initial(f));
    expect(s.applied.map(t => t.mutations)).toEqual([[set(TIME, 12)]]);
    expect(s.pending).toEqual([]);
  });

  it('resetStorage: old data is cleared once (true), then never again (false)', async () => {
    const kv = memoryKV();
    expect(await resetStorage(kv)).toBe(false); // nothing there
    expect(await kv.get('settings', 'storage-format')).toBe(STORAGE_FORMAT);
    const old = memoryKV();
    await old.put('logs', 'abc', { initial: {}, entries: [] });
    await old.put('workspace', 'Studio:1:doc', { recipes: {} });
    expect(await resetStorage(old)).toBe(true);
    expect(await old.keys('logs')).toEqual([]);
    expect(await old.keys('workspace')).toEqual([]);
    await old.put('logs', 'new', { format: 'chromobench-frame' });
    expect(await resetStorage(old)).toBe(false);
    expect(await old.keys('logs')).toEqual(['new']);
  });
});

describe('adaptive drafts (CHB-027)', () => {
  it('a draft is sized to the time budget from the measured speed, on half-octave steps; a screen pass is not', async () => {
    const { rt, studio, f } = await started();
    const b = studio.bridge;
    const h = frameRef(f, rt.store.peek(['docs', f]) as Document).print();
    const t = (pass: 'draft' | 'screen') => ({ slot: 's', epoch: 1, lane: 'live' as const, pass, maxSide: 4096, signal: new AbortController().signal });
    const full = await b.render(h, t('draft'));
    b.draftTargetMs = 100;
    b.draftMinPixels = 1000;
    b.pxPerMs = 20; // 2000 px in 100 ms
    const small = await b.render(h, t('draft'));
    const n = small.image.width * small.image.height;
    expect(n).toBeLessThanOrEqual(2100);
    expect(n).toBeGreaterThan(500);
    expect(n).toBeLessThan(full.image.width * full.image.height);
    expect((await b.render(h, t('screen'))).image.width).toBe(full.image.width);
    expect(b.draftScale(1, 1e6)).toBeCloseTo(2 ** (Math.floor(2 * Math.log2(Math.sqrt(2000 / 1e6))) / 2), 9);
    b.pxPerMs = 20;
    b.measured(10_000, 10); // too short to count
    expect(b.pxPerMs).toBe(20);
    b.measured(10_000, 100);
    expect(b.pxPerMs).toBeCloseTo(0.6 * 20 + 0.4 * 100, 9);
  });
});
