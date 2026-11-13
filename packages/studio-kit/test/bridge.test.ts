// The EditLog route and the history adapter (guide §6, stage 1 "done means"): a drag is one unit, a burst is one
// unit, the interleaved undo of §6.3, CB-H401 after a panel jump (with a spy proving no stale log.undo), proposals
// as previews with partial approval, E_STALE and Apply anyway (§11), persistence round trips with memoryKV.
import { makeM1Tiff } from '@chromobench/engine-mock';
import { canonicalJSON, sha256Hex } from '@chromobench/contract';
import { describe, expect, it, vi } from 'vitest';
import { BURST_MS, frameRef, memoryKV } from '../src/index.ts';
import { hashBytes } from '../src/bridge/frames.ts';
import { recipePath, started } from './helpers.ts';

describe('file identity (CHB-027)', () => {
  it('hashBytes: WebCrypto for big files gives the contract\'s sha256Hex', async () => {
    const big = new Uint8Array(3 << 20).map((_, i) => (i * 2654435761) >>> 24);
    expect(await hashBytes(big)).toBe(sha256Hex(big));
    const small = new Uint8Array([1, 2, 3]);
    expect(await hashBytes(small)).toBe(sha256Hex(small));
  });
});

const TIME = 'print.enlarger.time_s';

describe('the EditLog route', () => {
  it('projects recipes.<frame> from the log and catalogues the frame', async () => {
    const { rt, studio, f } = await started();
    const s = rt.state as any;
    expect(rt.store.peek(['recipes', f])).toBe(studio.frames.get(f)!.log.committed);
    expect(s.catalog.frames[f].name).toBe('m1.tif');
    expect(s.ui.selection.primary).toBe(f);
    expect(s.proposals[f]).toEqual([]);
  });

  it('a 120-move drag is one EditLog unit and one undo step; Esc logs nothing', async () => {
    const { rt, studio, f } = await started();
    const log = studio.frames.get(f)!.log;
    for (let i = 1; i <= 120; i++) rt.store.preview(recipePath(f, TIME), 10 + i * 0.02);
    expect(log.state.print.enlarger.time_s).toBeCloseTo(12.4);
    expect(log.committed.print.enlarger.time_s).toBe(10);
    expect((rt.state as any).recipes[f].print.enlarger.time_s).toBeCloseTo(12.4);
    rt.store.commit('Time');
    expect(log.units.length).toBe(1);
    expect(log.entries.length).toBe(1);
    expect(log.committed.print.enlarger.time_s).toBeCloseTo(12.4);
    expect(rt.history.entries.length).toBe(1);
    // Esc
    rt.store.preview(recipePath(f, TIME), 20);
    rt.store.cancel();
    expect(log.entries.length).toBe(1);
    expect(log.state.print.enlarger.time_s).toBeCloseTo(12.4);
    // undo is the log's undo
    rt.run('edit.undo');
    expect(log.cursor).toBe(0);
    expect((rt.state as any).recipes[f].print.enlarger.time_s).toBe(10);
    rt.run('edit.redo');
    expect(log.cursor).toBe(1);
  });

  it('a keyboard burst is one unit; a pause starts a new one; another control commits the burst first', async () => {
    const { rt, studio, f, clock } = await started();
    const log = studio.frames.get(f)!.log;
    const step = (p: string, v: unknown) => studio.route.step(rt.store, rt.clock, recipePath(f, p), v, p);
    step(TIME, 11);
    clock.advance(300);
    step(TIME, 12);
    clock.advance(300);
    step(TIME, 13);
    expect(log.units.length).toBe(0);
    clock.advance(BURST_MS);
    expect(log.units.length).toBe(1);
    expect(log.committed.print.enlarger.time_s).toBe(13);
    step(TIME, 14);
    step('print.grade', 3); // another control: the time burst commits now
    expect(log.units.length).toBe(2);
    clock.advance(BURST_MS);
    expect(log.units.length).toBe(3);
    expect(rt.history.entries.length).toBe(3);
  });

  it('a component write lifts to the whole field; two frames in one tx share a tx id', async () => {
    const { rt, studio, f } = await started();
    const e2 = await studio.open(makeM1Tiff().map((b, i) => (i === 300 ? b ^ 1 : b)), 'm1b.tif');
    rt.store.tx('Yellow', (t: any) => {
      t.recipes[f].print.enlarger.filtration.y = 10;
      t.recipes[e2.id].print.enlarger.filtration.y = 10;
    });
    const a = studio.frames.get(f)!.log;
    const b = e2.log;
    expect(a.entries[0]!.m).toEqual({ op: 'set', path: 'print.enlarger.filtration', value: { c: 0, m: 0, y: 10 } });
    expect(a.units[0]!.tx).toBe(b.units[0]!.tx);
    expect(rt.history.entries.length).toBe(1);
    rt.run('edit.undo');
    expect(a.cursor + b.cursor).toBe(0);
  });

  it('a refused value aborts the whole transaction', async () => {
    const { rt, studio, f } = await started();
    rt.store.tx('Bad', (t: any) => {
      t.recipes[f].print.grade = 3;
      t.recipes[f].print.enlarger.time_s = -5;
    });
    expect(studio.frames.get(f)!.log.units.length).toBe(0);
    expect(rt.diagnostics.list.some(d => d.code === 'CK-T430')).toBe(true);
  });
});

describe('one global undo (§6.3)', () => {
  it('flag, time, keyword, approved agent change: Mod+Z walks them newest first', async () => {
    const { rt, studio, f } = await started();
    const log = studio.frames.get(f)!.log;
    rt.run('frame.pick');
    rt.store.preview(recipePath(f, TIME), 12.6);
    rt.store.commit('Time');
    rt.store.tx('Add Keyword "beach"', (t: any) => void t.catalog.frames[f].keywords.push('beach'));
    studio.propose([{ op: 'set', path: 'print.lights.logH', value: [0.1, 0, 0] }], { tx: 'eval-k2', why: 'warmer' });
    rt.run('proposal.approve', f, 'eval-k2');
    const s = () => rt.state as any;
    expect(log.units.map(u => u.tx)).toEqual([log.units[0]!.tx, 'eval-k2']);
    expect(rt.history.entries.map(e => e.label)).toEqual(['Flag as Pick', 'Time', 'Add Keyword "beach"', 'Approve Agent Change (warmer)']);
    rt.run('edit.undo');
    expect(s().recipes[f].print.lights.logH).toEqual([0, 0, 0]);
    expect(log.cursor).toBe(1);
    rt.run('edit.undo');
    expect(s().catalog.frames[f].keywords).toEqual([]);
    rt.run('edit.undo');
    expect(s().recipes[f].print.enlarger.time_s).toBe(10);
    rt.run('edit.undo');
    expect(s().catalog.frames[f].flag).toBe(null);
    expect(log.stateHash).toBe(sha256Hex(canonicalJSON(studio.frames.get(f)!.initial)));
  });

  it('CHB-031 F36: Undo and Redo of a change on another frame select that frame, after the toast named it', async () => {
    const { rt, studio, f } = await started();
    const g = (await studio.open(makeM1Tiff().map((b, i) => (i === 300 ? b ^ 1 : b)), 'm1b.tif')).id;
    rt.run('frame.select', f);
    rt.store.preview(recipePath(f, TIME), 12.6);
    rt.store.commit('Time');
    rt.run('frame.select', g);
    const toasts = () => (rt.chrome as unknown as { log: { kind: string; text?: string }[] }).log.filter(x => x.kind === 'toast').map(x => x.text);
    rt.run('edit.undo');
    expect(toasts().at(-1)).toBe('Undo Time (on m1.tif)');
    await Promise.resolve();
    expect(studio.current).toBe(f);
    expect((rt.state as any).recipes[f].print.enlarger.time_s).toBe(10);
    rt.run('frame.select', g);
    rt.run('edit.redo');
    await Promise.resolve();
    expect(studio.current).toBe(f);
    // a step on the frame on screen changes nothing in the selection
    rt.run('edit.undo');
    await Promise.resolve();
    expect(studio.current).toBe(f);
  });

  it('CB-H401: after a History-panel jump the stale part is skipped, with no log.undo, and the next step is undone', async () => {
    const { rt, studio, f } = await started();
    const log = studio.frames.get(f)!.log;
    rt.run('frame.pick');
    rt.store.preview(recipePath(f, TIME), 12.6);
    rt.store.commit('Time');
    rt.run('history.jump', f, 0); // the panel moves the frame's cursor; the global stack is unchanged
    expect(log.cursor).toBe(0);
    expect(rt.history.entries.length).toBe(2);
    const spy = vi.spyOn(log, 'undo');
    rt.run('edit.undo');
    expect(spy).not.toHaveBeenCalled();
    expect((rt.state as any).catalog.frames[f].flag).toBe(null);
    expect(rt.diagnostics.list.some(d => d.code === 'CB-H401')).toBe(true);
    expect(log.stateHash).toBe(sha256Hex(canonicalJSON(studio.frames.get(f)!.initial)));
    // the mutant check: the part's guard is what prevents the second undo
    expect(studio.route.stats.skips).toBe(1);
  });
});

describe('agent proposals as previews (§6.4, §11)', () => {
  it('pending entries publish proposals.<f> with the proposed recipe; the log is untouched', async () => {
    const { rt, studio, f } = await started();
    studio.propose([{ op: 'set', path: 'print.lights.logH', value: [0.1, 0, 0] }], { tx: 'eval-k2', why: 'warmer' });
    const p = (rt.state as any).proposals[f];
    expect(p.length).toBe(1);
    expect(p[0].tx).toBe('eval-k2');
    expect(p[0].why).toBe('warmer');
    expect(p[0].recipe.print.lights.logH).toEqual([0.1, 0, 0]);
    expect(p[0].changes[0].text).toBe("Printer lights R 0 → +4 pt");
    expect((rt.state as any).recipes[f].print.lights.logH).toEqual([0, 0, 0]);
    // a drag during a shown proposal still works: the proposal never uses the preview slot
    rt.run('proposal.show', 'eval-k2');
    rt.store.preview(recipePath(f, TIME), 11);
    rt.store.commit('Time');
    expect((rt.state as any).proposals[f][0].recipe.print.enlarger.time_s).toBe(11);
  });

  it('partial approval: the photographer unticks one change; the rest is one unit, the unticked stays pending', async () => {
    const { rt, studio, f } = await started();
    const log = studio.frames.get(f)!.log;
    const [a, b] = studio.propose(
      [
        { op: 'set', path: 'print.grade', value: 3 },
        { op: 'set', path: TIME, value: 12 },
      ],
      { tx: 'eval-2' },
    );
    rt.run('proposal.toggle', 'eval-2', b!.seq);
    rt.run('proposal.approve', f, 'eval-2');
    expect(log.committed.print.grade).toBe(3);
    expect(log.committed.print.enlarger.time_s).toBe(10);
    expect(log.pending().map(e => e.seq)).toEqual([b!.seq]);
    expect(log.units.at(-1)!.seqs).toEqual([a!.seq]);
    rt.run('proposal.reject', f, 'eval-2');
    expect(log.pending()).toEqual([]);
    expect((rt.state as any).proposals[f]).toEqual([]);
  });

  it('the stale flow: E_STALE keeps the card, Apply anyway forces, three undos return to the start from cache', async () => {
    const { rt, studio, f, clock } = await started();
    const log = studio.frames.get(f)!.log;
    rt.store.preview(recipePath(f, TIME), 12.599);
    rt.store.commit('Time');
    studio.propose([{ op: 'set', path: 'print.lights.logH', value: [0.1, 0, 0] }], { tx: 'eval-k2', why: 'warmer' });
    studio.route.step(rt.store, rt.clock, recipePath(f, 'print.lights.logH.1'), 0.05, 'Lights G');
    clock.advance(BURST_MS);
    expect(log.committed.print.lights.logH).toEqual([0, 0.05, 0]);
    const r = rt.run('proposal.approve', f, 'eval-k2') as { code: string }[];
    expect(r[0]!.code).toBe('E_STALE');
    expect((rt.state as any).ui.approvals['eval-k2'].stale[0].code).toBe('E_STALE');
    expect((rt.state as any).proposals[f].length).toBe(1);
    expect(rt.diagnostics.list.some(d => d.code === 'CB-H410')).toBe(true);
    rt.run('proposal.approve', f, 'eval-k2', true);
    expect(log.committed.print.lights.logH).toEqual([0.1, 0, 0]);
    expect(rt.history.entries.map(e => e.label)).toEqual(['Time', 'Lights G', 'Approve Agent Change (warmer)']);
    const bridge = studio.bridge;
    const h0 = { $: 'cb.image', frame: f, recipe: studio.frames.get(f)!.initial, what: 'print', args: {}, expr: 'frame.print()' } as const;
    const start = bridge.key(h0);
    rt.run('edit.undo');
    rt.run('edit.undo');
    rt.run('edit.undo');
    expect(log.cursor).toBe(0);
    expect(bridge.key({ ...h0, recipe: (rt.state as any).recipes[f] })).toBe(start);
  });

  it('auto mode: the agent unit enters the global stack when it happens', async () => {
    const { rt, studio, f } = await started({ mode: 'auto' });
    studio.propose([{ op: 'set', path: 'print.grade', value: 4 }], { tx: 'eval-a' });
    expect((rt.state as any).recipes[f].print.grade).toBe(4);
    expect(rt.history.entries.map(e => e.label)).toEqual(['Agent Change']);
    rt.run('edit.undo');
    expect((rt.state as any).recipes[f].print.grade).toBe(2);
  });
});

describe('persistence', () => {
  it('logs resume by SHA-256; the catalog and snapshots survive a reload through the KV', async () => {
    const kv = memoryKV();
    const a = await started({ kv });
    a.rt.store.preview(recipePath(a.f, TIME), 15);
    a.rt.store.commit('Time');
    a.rt.run('frame.pick');
    a.rt.run('snapshot.new', 'warm');
    await a.studio.flush();
    await (a.rt as any).flushSave?.();
    a.clock.advance(2000);
    a.clock.runIdle();
    await new Promise(r => setTimeout(r, 0));
    const b = await started({ kv });
    expect(b.f).toBe(a.f);
    const s = b.rt.state as any;
    expect(s.recipes[b.f].print.enlarger.time_s).toBe(15);
    expect(s.catalog.frames[b.f].flag).toBe('pick');
    expect(s.snapshots[b.f][0].name).toBe('warm');
    // restore is one EditLog unit
    b.rt.store.preview(recipePath(b.f, TIME), 20);
    b.rt.store.commit('Time');
    b.rt.run('snapshot.restore', 's1');
    expect((b.rt.state as any).recipes[b.f].print.enlarger.time_s).toBe(15);
    expect(b.studio.frames.get(b.f)!.log.units.at(-1)!.label).toBe('Restore "warm"');
  });
});

describe('adaptive drafts (CHB-027)', () => {
  it('a draft is sized to the time budget from the measured speed, on half-octave steps; a screen pass is not', async () => {
    const { rt, studio, f } = await started();
    const b = studio.bridge;
    const h = frameRef(f, rt.store.peek(['recipes', f]) as never).print();
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
