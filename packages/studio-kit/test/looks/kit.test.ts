// CHB-021 stages 4–5 through commands on the booted 'looks' variant (MockEngine, six M1-derived frames): user apply
// as one batch (one tx + LoggedMutation.batch per frame, one global undo), the roll plan with partial approval,
// E_STALE and Apply anyway (recomputed), the agent's cb.looks.apply from a real DslSession coalesced into one card,
// snapshot restore, compare sources, survey tiles = main view node ids, copy/paste/sync, presets round trip.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { canonicalJSON, getPath } from '@chromobench/contract';
import { m1Codes, M1, MockEngine, writeTiff16 } from '@chromobench/engine-mock';
import { manualClock } from '@chromobench/shell/testing';
import { DslSession } from '@chromobench/dsl';
import { buildVariant, createStudio, defineVariant, memoryKV } from '../../src/index.ts';
import { agentBatches, looksView, warmPrint } from '../../kits/looks/src/index.ts';
import { VARIANTS } from '../../variants/index.js';

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
  const studio = createStudio({ engine: new MockEngine(), kv: memoryKV(), now: () => clock.now() });
  const built = buildVariant((await VARIANTS.looks()).default);
  const rt = await built.app.boot(studio.services({ clock }));
  studio.attach(rt);
  const ids: string[] = [];
  for (const [i, b] of frames(n).entries()) ids.push((await studio.open(b, `frame-${i + 1}.tif`)).id);
  const looks = built.cb.kits['looks'];
  const st = () => rt.store.peek([]) as any;
  const recipes = () => Object.fromEntries(ids.map((f) => [f, canonicalJSON(studio.frames.get(f)!.log.committed)]));
  const select = (sel: string[], primary = sel[0]!) => rt.store.writeDoc([{ path: ['ui', 'selection'], value: { ids: sel, primary, anchor: primary } }], { tier: 'view' });
  return { rt, studio, ids, looks, st, recipes, select, clock };
}
const lights = (s: Awaited<ReturnType<typeof startedLooks>>, f: string) => s.studio.frames.get(f)!.log.committed.print.lights.logH;

describe('cb.kits.looks in variants', () => {
  it('CB-L001: looks forms without the kit; CB-L002: an unknown look in a choice', () => {
    const errs = (def: unknown) => buildVariant(def).app.diagnostics.list.filter((d) => d.level === 'error' && d.code.startsWith('CB-L')).map((d) => `${d.code}${d.fix ? ` fix: ${d.fix}` : ''}`);
    expect(errs(defineVariant({ id: 'x', label: 'x', build: (ck, cb) => cb.studio('X').right(cb.kits['looks'].amount()) }))).toEqual(['CB-L001 fix: .use(cb.kits.looks.kit) on the studio']);
    expect(errs(defineVariant({ id: 'x', label: 'x', build: (ck, cb) => cb.studio('X').use(cb.kits['looks'].kit).right(ck.panel('p', {}, cb.kits['looks'].choice(['warm-print', 'warm prnt']))) }))).toEqual(['CB-L002']);
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
      const log = s.studio.frames.get(f)!.log;
      expect(log.units.length).toBe(1);
      expect(log.units[0]!.tx).toBe(r.id);
      expect(log.inEffect().every((e) => e.batch === r.id && e.by === 'user')).toBe(true);
      expect(lights(s, f)[2]).toBeCloseTo(0.03, 9);
    }
    expect(rt.history.entries.map((e) => e.label)).toEqual(['Look: warm print at 60 %']);
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
    // frame 2 has been worked on
    studio.route.applyMutations(ids[1]!, [{ op: 'set', path: 'print.grade', value: 3 }], 'Grade');
    rt.runCommand('looks.pick', null, 'warm-print');
    rt.runCommand('looks.param', null, 'warmth', 8);
    rt.runCommand('looks.applyToRoll', null);
    const p = looksView(st()).pending!;
    expect(p.frames.map((f) => f.frame)).toEqual([ids[0], ids[2], ids[3], ids[4], ids[5]]);
    expect(p.aggregate).toEqual([{ path: 'print.lights.logH', label: 'lights', frames: 5, short: 'R −4.0 pt, B +4.0 pt' }]);
    // nothing applied yet
    expect(studio.frames.get(ids[0]!)!.log.units.length).toBe(0);
    rt.runCommand('looks.pending.toggle', null, ids[5]);
    // the photographer nudges frame 4's lights while the card waits
    studio.route.applyMutations(ids[3]!, [{ op: 'set', path: 'print.lights.logH', value: [0.01, 0, 0] }], 'Lights');
    const res = rt.runCommand('looks.pending.approve', null) as any;
    expect(Array.isArray(res)).toBe(true);
    expect(res[0].code).toBe('E_STALE');
    expect(looksView(st()).stale[0]!.message).toContain('frame-4.tif: print.lights.logH changed');
    expect(studio.frames.get(ids[0]!)!.log.units.length).toBe(0);
    // Apply anyway: frame 4 is recomputed against its current lights (an offset on top of the nudge)
    expect(rt.runCommand('looks.pending.approve', null, true)).toBe(true);
    expect(lights(s, ids[3]!)).toEqual([-0.09, 0, 0.1]);
    expect(lights(s, ids[0]!)).toEqual([-0.1, 0, 0.1]);
    expect(studio.frames.get(ids[5]!)!.log.units.length).toBe(0); // unticked
    expect(studio.frames.get(ids[1]!)!.log.committed.print.lights.logH).toEqual([0, 0, 0]); // edited: not unedited
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
    expect(s.studio.frames.get(s.ids[0]!)!.log.units.length).toBe(0);
  });
});

describe('agent apply: one card per batch (approval scope)', () => {
  it('cb.looks.apply from a DslSession → one batch card → frame 3 nudged → approve the others → Apply anyway', async () => {
    const s = await startedLooks(4);
    const { rt, studio, ids, looks, st } = s;
    const session = await DslSession.create({
      engine: studio.engine,
      frames: Object.fromEntries(ids.map((f) => [f, { log: studio.frames.get(f)!.log, source: studio.frames.get(f)!.info, name: studio.frames.get(f)!.name }])),
      looks: looks.provider(() => rt.store.peek([])),
    });
    const r = await session.eval({ code: `return cb.looks.apply('warm print', { warmth: 4 }, { amount: 0.6, to: 'all', why: 'warm print at 60 %' }).frames`, frame: ids[0]! });
    expect(r.error).toBeUndefined();
    expect(r.yaml.split('\n')[0]).toBe('4');
    const bs = agentBatches(st());
    expect(bs.length).toBe(1);
    expect(bs[0]!.frames.length).toBe(4);
    expect(bs[0]!.why).toBe('warm print at 60 %');
    expect(bs[0]!.aggregate[0]!.short).toBe('R −1.2 pt, B +1.2 pt');
    // while the card waits, the user nudges frame 3
    studio.route.applyMutations(ids[2]!, [{ op: 'set', path: 'print.lights.logH', value: [0, 0.025, 0] }], 'Lights');
    const n = rt.history.entries.length;
    const res = rt.runCommand('looks.batch.approve', null, bs[0]!.batch) as any;
    expect(res.units.length).toBe(3);
    expect(res.refused.map((x: any) => x.frame)).toEqual([ids[2]]);
    expect(rt.history.entries.length).toBe(n + 1); // the three approvals are one global step
    expect(looksView(st()).batchStale[bs[0]!.batch]![0]!.code).toBe('E_STALE');
    expect(lights(s, ids[0]!)[2]).toBeCloseTo(0.03, 9);
    // the card now holds frame 3 only; Apply anyway approves it as proposed
    const left = agentBatches(st());
    expect(left[0]!.frames.map((f) => f.frame)).toEqual([ids[2]]);
    rt.runCommand('looks.batch.approve', null, left[0]!.batch, true);
    expect(agentBatches(st())).toEqual([]);
    expect(studio.frames.get(ids[2]!)!.log.entries.filter((e) => e.by === 'agent').every((e) => e.status === 'applied' && e.approvedBy === 'user')).toBe(true);
    // one undo takes the frame-3 approval back, the next the other three
    rt.run('edit.undo');
    expect(lights(s, ids[2]!)).toEqual([0, 0.025, 0]);
    rt.run('edit.undo');
    expect(lights(s, ids[0]!)).toEqual([0, 0, 0]);
  });
  it('Skip rejects only the stale frames; partial approval leaves unticked frames pending', async () => {
    const s = await startedLooks(3);
    const { rt, studio, ids, looks, st } = s;
    const session = await DslSession.create({ engine: studio.engine, frames: Object.fromEntries(ids.map((f) => [f, { log: studio.frames.get(f)!.log, source: studio.frames.get(f)!.info }])), looks: looks.provider(() => rt.store.peek([])) });
    await session.eval({ code: `cb.looks.apply('strong grade 4', {}, { to: 'all' })`, frame: ids[0]! });
    const b = agentBatches(st())[0]!;
    rt.runCommand('looks.batch.toggle', null, b.batch, ids[1]);
    rt.runCommand('looks.batch.approve', null, b.batch);
    expect(studio.frames.get(ids[0]!)!.log.committed.print.grade).toBe(4);
    expect(studio.frames.get(ids[1]!)!.log.pending().length).toBe(1);
    rt.runCommand('looks.batch.reject', null, b.batch);
    expect(studio.frames.get(ids[1]!)!.log.pending().length).toBe(0);
  });
});

describe('snapshots, compare, survey (guide §5)', () => {
  it('snapshot → three changes → restore: the state hash is the snapshot’s, undoable, and the diff panel reads it', async () => {
    const s = await startedLooks(1);
    const { rt, studio, ids, looks, st } = s;
    const f = ids[0]!;
    rt.runCommand('looks.snapshot', null, 'first print');
    const snap = st().snapshots[f][0];
    studio.route.applyMutations(f, [{ op: 'set', path: 'print.grade', value: 3 }, { op: 'set', path: 'print.enlarger.time_s', value: 12.6 }, { op: 'set', path: 'print.paper', value: 'fuji_crystal_archive' }], 'Three');
    rt.runCommand('looks.compare', null, { snapshot: snap.id });
    expect(looks.diffOf(st()).map((d: any) => d.shown)).toEqual(['time 10.0 → 12.6 s (+1/3 st)', 'grade 2 → 3', 'paper kodak_portra_endura → fuji_crystal_archive']);
    rt.runCommand('looks.restoreSnapshot', null, snap.id);
    expect(studio.frames.get(f)!.log.stateHash).toBe(snap.stateHash);
    expect(rt.history.entries.at(-1)!.label).toBe('Restore "first print"');
    rt.run('edit.undo');
    expect(studio.frames.get(f)!.log.committed.print.grade).toBe(3);
  });
  it('the same recipe in both panes is the same node; a tile is the main view’s node once the look is applied', async () => {
    const s = await startedLooks(2);
    const { rt, studio, ids, looks, st } = s;
    s.select([ids[0]!]);
    const id = (h: any) => studio.bridge.lower(h).named.id;
    // compare with the frame itself as reference: identical node
    rt.runCommand('looks.compare', null, { frame: ids[0] });
    expect(id(looks.before(st()))).toBe(id(looks.print(st())));
    // a survey tile for warm print equals the main view after applying it
    rt.runCommand('looks.pick', null, 'warm-print');
    const tile = id(looks.tile(st(), warmPrint));
    expect(id(looks.print(st()))).toBe(tile); // previewed
    rt.runCommand('looks.apply', null);
    expect(id(looks.print(st()))).toBe(tile); // applied
    // compare with the other frame: its own print
    rt.runCommand('looks.compare', null, { frame: ids[1] });
    expect(looks.before(st()).frame).toBe(ids[1]);
    // the ring sweep's centre is the current print
    const ring = looks.sweep.ring();
    expect(id(looks.tile(st(), ring.find((l: any) => l.id === 'ring-current')))).toBe(id(looks.print(st())));
    // a look that does not apply has no tile and says why
    expect(looks.tile(st(), looks.byId(st(), 'portra-400-endura'))).toBeNull();
    expect(looks.caption(st(), looks.byId(st(), 'portra-400-endura'))).toBe('This look needs a digital RAW');
  });
});

describe('copy, paste, sync; presets', () => {
  it('sync copies the default groups from the primary to the selection as one step; crop is not copied', async () => {
    const s = await startedLooks(3);
    const { rt, studio, ids } = s;
    studio.route.applyMutations(ids[0]!, [{ op: 'set', path: 'print.grade', value: 3.5 }, { op: 'set', path: 'print.lights.logH', value: [0.05, 0, -0.05] }, { op: 'set', path: 'view.frame.crop', value: { x: 10, y: 5, w: 50, h: 40 } }], 'Work');
    s.select(ids, ids[0]!);
    const n = rt.history.entries.length;
    rt.runCommand('looks.sync', null);
    for (const f of [ids[1]!, ids[2]!]) {
      const r = studio.frames.get(f)!.log.committed;
      expect(r.print.grade).toBe(3.5);
      expect(r.print.lights.logH).toEqual([0.05, 0, -0.05]);
      expect(getPath(r, 'view.frame.crop')).toBeNull();
    }
    expect(rt.history.entries.length).toBe(n + 1);
  });
  it('save as preset → export → delete → import round-trips; it applies like any look', async () => {
    const s = await startedLooks(2);
    const { rt, studio, ids, st } = s;
    studio.route.applyMutations(ids[0]!, [{ op: 'set', path: 'print.grade', value: 4.5 }], 'Grade');
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
    expect(studio.frames.get(ids[1]!)!.log.committed.print.grade).toBe(4.5);
    // bake the picked built-in look with its parameters
    rt.runCommand('looks.pick', null, 'warm-print');
    rt.runCommand('looks.param', null, 'warmth', 6);
    const baked = rt.runCommand('looks.bake', null) as any;
    expect(st().looks.presets[baked.id].name).toBe('warm print (warmth 6, density 0)');
  });
});
