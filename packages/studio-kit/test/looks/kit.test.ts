// CHB-021 stages 4–5 through commands on the booted 'looks' layout (MockEngine, six M1-derived frames; CHB-037:
// documents in the store's log): user apply as one batch (one transaction per frame with the batch id, one step of
// the log), the roll plan with partial approval, E_STALE and Apply anyway (recomputed), an agent's look batch (the
// kit's provider resolves it, the values batch builder makes it, the log holds it pending) on one card, snapshot
// restore, compare sources, survey tiles = main view node ids, copy/paste/sync, presets round trip.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { canonicalJSON, plan, set } from '@chromobench/values';
import type { Document } from '@chromobench/contract';
import { m1Codes, M1, MockEngine } from '@chromobench/engine-mock';
import { writeTiff16 } from '@chromobench/ingest';
import { manualClock } from '@chromobench/shell/testing';
import { buildLayout, createStudio, defineLayout, lightsOf, memoryKV, read } from '../../src/index.ts';
import { agentBatches, looksView, warmPrint } from '../../kits/looks/src/index.ts';
import { LAYOUTS } from '../../layouts/index.js';

function frames(n: number): Uint8Array[] {
  const base = m1Codes();
  return Array.from({ length: n }, (_, i) => {
    const c = new Uint16Array(base.length);
    const k = 0.8 + 0.08 * i;
    for (let j = 0; j < base.length; j++) c[j] = (j / 3) % M1.width < M1.rebate.w ? base[j]! : Math.min(65535, Math.round(base[j]! * k));
    return writeTiff16(M1.width, M1.height, c);
  });
}

async function startedLooks(n = 6) {
  const clock = manualClock(1_000);
  const studio = createStudio({ engine: new MockEngine(), kv: memoryKV() });
  const built = buildLayout((await LAYOUTS.looks()).default);
  const rt = await built.app.boot(studio.services({ clock }));
  studio.attach(rt);
  const ids: string[] = [];
  for (const [i, b] of frames(n).entries()) ids.push((await studio.open(b, `frame-${i + 1}.tif`)).id);
  await studio.flush();
  const looks = built.cb.kits['looks'];
  const st = () => rt.store.peek([]) as any;
  const recipes = () => Object.fromEntries(ids.map((f) => [f, canonicalJSON(studio.doc(f)!)]));
  const select = (sel: string[], primary = sel[0]!) => rt.store.writeView([{ path: ['ui', 'selection'], value: { ids: sel, primary, anchor: primary } }]);
  /** the labels of the log's steps in effect */
  const steps = () => rt.store.log.steps.slice(0, rt.store.log.cursor).map((x) => x.label);
  /** a user's own edit of one frame (one step) */
  const userEdit = (f: string, path: string, v: unknown, label = 'Edit') => studio.commit(f, [set(path, v)], label);
  /** the frame's entries in effect */
  const inEffect = (f: string) => rt.store.log.inEffect(f);
  return { rt, studio, ids, looks, st, recipes, select, clock, steps, userEdit, inEffect };
}
type S = Awaited<ReturnType<typeof startedLooks>>;
const lights = (s: S, f: string) => lightsOf(s.studio.doc(f)!);
const grade = (s: S, f: string) => read(s.studio.doc(f)!, 'stages.darkroom.medium.grade');

/** what an agent's look apply does on the host (the DSL is P6a's): the kit's provider resolves the look per frame,
 *  the values batch builder makes one batch, the log holds it pending */
async function agentLook(s: S, look: string, params: Record<string, unknown>, o: { amount?: number; why: string }): Promise<string> {
  const { rt, studio, ids, looks } = s;
  const pr = looks.lib.provider(() => rt.store.peek([]));
  const id = `look:agent-${look}`;
  const b = plan(studio.log.targets<Document>(ids), (d, f) => pr.resolve(look, { id: f, doc: d }, params, { amount: o.amount ?? 1 }).mutations, { id, label: o.why, by: 'agent', source: { kind: 'agent', turn: 1 } });
  studio.change((log) => log.propose(b, { why: o.why }));
  await studio.flush();
  return id;
}

describe('cb.kits.looks in layouts', () => {
  it('CB-L001: looks forms without the kit; CB-L002: an unknown look in a choice', () => {
    const errs = (def: unknown) => buildLayout(def).app.diagnostics.list.filter((d) => d.level === 'error' && d.code.startsWith('CB-L')).map((d) => `${d.code}${d.fix ? ` fix: ${d.fix}` : ''}`);
    expect(errs(defineLayout({ id: 'x', label: 'x', build: (ck, cb) => cb.studio('X').module(ck.module('main').right(cb.kits['looks'].panels.amount())) }))).toEqual(['CB-L001 fix: .use(cb.kits.looks.kit) on the studio']);
    expect(errs(defineLayout({ id: 'x', label: 'x', build: (ck, cb) => cb.studio('X').use(cb.kits['looks'].kit).module(ck.module('main').right(ck.panel.define('p', {}, cb.kits['looks'].views.choice(['warm-print', 'warm prnt'])))) }))).toEqual(['CB-L002']);
  });
});

describe('apply (guide §6, §9)', () => {
  it('pick → Amount 60 % → result line → apply to the selection: one batch, one undo step for every frame', async () => {
    const s = await startedLooks();
    const { rt, ids, looks, st } = s;
    s.select(ids);
    rt.runCommand('looks.pick', null, 'warm-print');
    rt.runCommand('looks.amount', null, 60);
    const before = s.recipes();
    const r = rt.runCommand('looks.apply', null) as any;
    expect(r.label).toBe('Look: warm print at 60 %');
    expect(r.frames.every((f: any) => f.diff.map((d: any) => d.shown).join() === 'lights R −1.2 pt, B +1.2 pt')).toBe(true);
    for (const f of ids) {
      expect(s.inEffect(f).length).toBe(1);
      expect(s.inEffect(f).every((e) => e.tx.batch === r.id && e.tx.by === 'user')).toBe(true);
      expect(lights(s, f)[2]).toBeCloseTo(0.03, 9);
    }
    expect(s.steps()).toEqual(['Look: warm print at 60 %']);
    rt.run('edit.undo');
    expect(s.recipes()).toEqual(before);
    rt.run('edit.redo');
    expect(lights(s, ids[3]!)[0]).toBeCloseTo(-0.03, 9);
    expect(looksView(st()).preview).toBe(false);
  });
  it('the roll: unedited frames only, planned on one card, a frame unticked, a frame changed meanwhile → E_STALE → Apply anyway recomputes', async () => {
    const s = await startedLooks();
    const { rt, ids, studio, st } = s;
    await rt.runCommand('roll.fromFrames', null, { analyse: false });
    const n0 = (f: string) => s.inEffect(f).length;
    const base = new Map(ids.map((f) => [f, n0(f)]));
    // frame 2 has been worked on
    s.userEdit(ids[1]!, 'stages.darkroom.medium.grade', 3, 'Grade');
    rt.runCommand('looks.pick', null, 'warm-print');
    rt.runCommand('looks.param', null, 'warmth', 8);
    rt.runCommand('looks.applyToRoll', null);
    const p = looksView(st()).pending!;
    expect(p.frames.map((f) => f.frame)).toEqual([ids[0], ids[2], ids[3], ids[4], ids[5]]);
    expect(p.aggregate).toEqual([{ path: 'lights.params.logH', label: 'lights', frames: 5, short: 'R −4.0 pt, B +4.0 pt' }]);
    // nothing applied yet
    expect(n0(ids[0]!)).toBe(base.get(ids[0]!));
    rt.runCommand('looks.pending.toggle', null, ids[5]);
    // the photographer nudges frame 4's lights while the card waits
    s.userEdit(ids[3]!, 'lights.params.logH', [0.01, 0, 0], 'Lights');
    const res = rt.runCommand('looks.pending.approve', null) as any;
    expect(Array.isArray(res)).toBe(true);
    expect(res[0].code).toBe('E_STALE');
    expect(looksView(st()).stale[0]!.message).toContain('frame-4.tif: lights.params.logH changed');
    expect(n0(ids[0]!)).toBe(base.get(ids[0]!));
    // Apply anyway: frame 4 is recomputed against its current lights (an offset on top of the nudge)
    expect(rt.runCommand('looks.pending.approve', null, true)).toBe(true);
    expect(lights(s, ids[3]!)).toEqual([-0.09, 0, 0.1]);
    expect(lights(s, ids[0]!)).toEqual([-0.1, 0, 0.1]);
    expect(n0(ids[5]!)).toBe(base.get(ids[5]!)); // unticked
    expect(lights(s, ids[1]!)).toEqual([0, 0, 0]); // edited: not unedited
    expect(looksView(st()).pending).toBeNull();
    // one undo takes the look off all four frames
    rt.run('edit.undo');
    for (const f of [ids[0]!, ids[2]!, ids[4]!]) expect(lights(s, f)).toEqual([0, 0, 0]);
    expect(lights(s, ids[3]!)).toEqual([0.01, 0, 0]);
  });
  it('a film look on scans: every frame skipped with the reason, nothing written', async () => {
    const s = await startedLooks(2);
    s.select(s.ids);
    s.rt.runCommand('looks.pick', null, 'portra-400-endura');
    const r = s.rt.runCommand('looks.apply', null) as any;
    expect(r.frames.map((f: any) => f.skipped.hint)).toEqual(['This look needs a digital RAW', 'This look needs a digital RAW']);
    expect(s.inEffect(s.ids[0]!).length).toBe(0);
  });
});

describe('agent apply: one card per batch (approval scope)', () => {
  it('an agent look batch → one card → frame 3 nudged → approve the others → Apply anyway', async () => {
    const s = await startedLooks(4);
    const { rt, studio, ids, st } = s;
    await agentLook(s, 'warm print', { warmth: 4 }, { amount: 0.6, why: 'warm print at 60 %' });
    const bs = agentBatches(st());
    expect(bs.length).toBe(1);
    expect(bs[0]!.frames.length).toBe(4);
    expect(bs[0]!.why).toBe('warm print at 60 %');
    expect(bs[0]!.aggregate[0]!.short).toBe('R −1.2 pt, B +1.2 pt');
    // while the card waits, the user nudges frame 3
    s.userEdit(ids[2]!, 'lights.params.logH', [0, 0.025, 0], 'Lights');
    const n = s.steps().length;
    const res = rt.runCommand('looks.batch.approve', null, bs[0]!.batch) as any;
    expect(res.approved.length).toBe(3);
    expect(res.refused.map((x: any) => x.frame)).toEqual([ids[2]]);
    expect(s.steps().length).toBe(n + 1); // the three approvals are one step
    await studio.flush();
    const left = agentBatches(st());
    expect(left.length).toBe(1);
    expect(looksView(st()).batchStale[left[0]!.batch]![0]!.code).toBe('E_STALE');
    expect(lights(s, ids[0]!)[2]).toBeCloseTo(0.03, 9);
    // the card now holds frame 3 only: Approve refuses it again; Apply anyway approves it as proposed
    expect(left[0]!.frames.map((f) => f.frame)).toEqual([ids[2]]);
    expect((rt.runCommand('looks.batch.approve', null, left[0]!.batch) as any).approved).toEqual([]);
    rt.runCommand('looks.batch.approve', null, left[0]!.batch, true);
    await studio.flush();
    expect(agentBatches(st())).toEqual([]);
    expect(s.inEffect(ids[2]!).filter((e) => e.tx.by === 'agent').every((e) => e.approvedBy === 'user')).toBe(true);
    // one undo takes the frame-3 approval back, the next the other three
    rt.run('edit.undo');
    expect(lights(s, ids[2]!)).toEqual([0, 0.025, 0]);
    rt.run('edit.undo');
    expect(lights(s, ids[0]!)).toEqual([0, 0, 0]);
  });
  it('partial approval leaves unticked frames pending; Reject rejects them', async () => {
    const s = await startedLooks(3);
    const { rt, studio, ids, st } = s;
    await agentLook(s, 'strong grade 4', {}, { why: 'Look: strong grade 4' });
    const b = agentBatches(st())[0]!;
    rt.runCommand('looks.batch.toggle', null, b.batch, ids[1]);
    rt.runCommand('looks.batch.approve', null, b.batch);
    await studio.flush();
    expect(grade(s, ids[0]!)).toBe(4);
    expect(rt.store.log.pending(ids[1]!).length).toBe(1);
    const left = agentBatches(st())[0]!;
    expect(left.frames.map((f) => f.frame)).toEqual([ids[1]]);
    rt.runCommand('looks.batch.reject', null, left.batch);
    expect(rt.store.log.pending(ids[1]!).length).toBe(0);
    expect(grade(s, ids[1]!)).toBe(2);
  });
});

describe('snapshots, compare, survey (guide §5)', () => {
  it('snapshot → three changes → restore: the state hash is the snapshot’s, undoable, and the diff panel reads it', async () => {
    const s = await startedLooks(1);
    const { rt, studio, ids, looks, st } = s;
    const f = ids[0]!;
    rt.runCommand('looks.snapshot', null, 'first print');
    const snap = st().snapshots[f][0];
    studio.commit(f, [set('stages.darkroom.medium.grade', 3), set('main.params.time_s', 12.6), set('stages.darkroom.medium.paper', 'kodak_supra_endura')], 'Three');
    rt.runCommand('looks.compare', null, { snapshot: snap.id });
    expect(looks.sel.diffOf(st()).map((d: any) => d.shown)).toEqual(['paper kodak_portra_endura → kodak_supra_endura', 'grade 2 → 3', 'time 10.0 → 12.6 s (+1/3 st)']);
    rt.runCommand('looks.restoreSnapshot', null, snap.id);
    expect(canonicalJSON(studio.doc(f))).toBe(canonicalJSON(snap.doc));
    expect(s.steps().at(-1)).toBe('Restore "first print"');
    rt.run('edit.undo');
    expect(grade(s, f)).toBe(3);
  });
  it('the same recipe in both panes is the same node; a tile is the main view’s node once the look is applied', async () => {
    const s = await startedLooks(2);
    const { rt, studio, ids, looks, st } = s;
    s.select([ids[0]!]);
    const id = (h: any) => studio.bridge.lower(h).named.id;
    // compare with the frame itself as reference: identical node
    rt.runCommand('looks.compare', null, { frame: ids[0] });
    expect(id(looks.sel.before(st()))).toBe(id(looks.sel.print(st())));
    // a survey tile for warm print equals the main view after applying it
    rt.runCommand('looks.pick', null, 'warm-print');
    const tile = id(looks.lib.tile(st(), warmPrint));
    expect(id(looks.sel.print(st()))).toBe(tile); // previewed
    rt.runCommand('looks.apply', null);
    expect(id(looks.sel.print(st()))).toBe(tile); // applied
    // compare with the other frame: its own print
    rt.runCommand('looks.compare', null, { frame: ids[1] });
    expect(looks.sel.before(st()).frame).toBe(ids[1]);
    // the ring sweep's centre is the current print
    const ring = looks.lib.sweep.ring();
    expect(id(looks.lib.tile(st(), ring.find((l: any) => l.id === 'ring-current')))).toBe(id(looks.sel.print(st())));
    // a look that does not apply has no tile and says why
    expect(looks.lib.tile(st(), looks.sel.byId(st(), 'portra-400-endura'))).toBeNull();
    expect(looks.lib.caption(st(), looks.sel.byId(st(), 'portra-400-endura'))).toBe('This look needs a digital RAW');
  });
});

describe('copy, paste, sync; presets', () => {
  it('sync copies the default groups from the primary to the selection as one step; crop is not copied', async () => {
    const s = await startedLooks(3);
    const { rt, studio, ids } = s;
    studio.commit(ids[0]!, [set('stages.darkroom.medium.grade', 3.5), set('lights.params.logH', [0.05, 0, -0.05]), set('geometry.crop', { x: 10, y: 5, w: 50, h: 40 })], 'Work');
    s.select(ids, ids[0]!);
    const n = s.steps().length;
    rt.runCommand('looks.sync', null);
    for (const f of [ids[1]!, ids[2]!]) {
      expect(grade(s, f)).toBe(3.5);
      expect(lights(s, f)).toEqual([0.05, 0, -0.05]);
      expect(read(studio.doc(f)!, 'geometry.crop')).toBeNull();
    }
    expect(s.steps().length).toBe(n + 1);
  });
  it('save as preset → export → delete → import round-trips; it applies like any look', async () => {
    const s = await startedLooks(2);
    const { rt, studio, ids, st } = s;
    s.userEdit(ids[0]!, 'stages.darkroom.medium.grade', 4.5, 'Grade');
    s.select([ids[0]!]);
    const p = rt.runCommand('looks.saveAsPreset', null, 'Hard') as any;
    expect(Object.keys(st().looks.presets)).toEqual([p.id]);
    const text = rt.runCommand('looks.exportPreset', null, p.id) as string;
    rt.runCommand('looks.deletePreset', null, p.id);
    expect(st().looks.presets).toEqual({});
    const r = rt.runCommand('looks.importPreset', null, text) as any;
    expect(r.status).toBe('ok');
    expect(canonicalJSON(st().looks.presets[p.id])).toBe(canonicalJSON(p));
    s.select([ids[1]!]);
    rt.runCommand('looks.pick', null, p.id);
    rt.runCommand('looks.apply', null);
    expect(grade(s, ids[1]!)).toBe(4.5);
    // bake the picked built-in look with its parameters
    rt.runCommand('looks.pick', null, 'warm-print');
    rt.runCommand('looks.param', null, 'warmth', 6);
    const baked = rt.runCommand('looks.bake', null) as any;
    expect(st().looks.presets[baked.id].name).toBe('warm print (warmth 6, density 0)');
  });
});
