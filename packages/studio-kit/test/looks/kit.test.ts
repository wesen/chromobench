// CHB-021 stages 4–5 through commands on the booted 'looks' layout (MockEngine, six M1-derived frames; CHB-037 P7:
// looks are links): a user apply is one batch of link inserts (one step of the log), re-applying adjusts, the frame's
// looks have one Amount each, bake and remove; the roll plan with partial approval (a link is never stale: it is
// placed against the frame's current document); an agent's look batch (link inserts proposed as one batch) on one
// card; a look applied over a roll is one undo; snapshots, compare sources, survey tiles = main view node ids; sync
// by copy and by link (one preset); presets round trip.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { canonicalJSON, plan, set } from '@chromobench/values';
import { linksOf, resolveLinks, type Document } from '@chromobench/contract';
import { m1Codes, M1, MockEngine } from '@chromobench/engine-mock';
import { writeTiff16 } from '@chromobench/ingest';
import { manualClock } from '@chromobench/shell/testing';
import { buildLayout, createStudio, defineLayout, lightsOf, linksOf as stateLinks, memoryKV, read } from '../../src/index.ts';
import { agentBatches, appliedLooks, lookItem, looksView, planLook } from '../../kits/looks/src/index.ts';
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
/** the frame's look links: key → amount */
const looksOn = (s: S, f: string) => Object.fromEntries(appliedLooks(s.studio.doc(f)!).map((x) => [x.key, x.amount]));
/** the filters the light law sees on a frame (its links resolved) */
const filters = (s: S, f: string) => {
  const d = resolveLinks(s.studio.doc(f)!, s.studio.links());
  const out: number[][] = [];
  const walk = (c: any, k: number): void => { for (const e of Object.values(c.items) as any[]) { if (e.kind === 'group') walk(e.stack, k * e.amount); else if (e.op === 'filter' && e.source?.kind === 'look') out.push(e.params.logH.map((x: number) => Number((x * k * e.amount).toFixed(6)))); } };
  walk(d.stages.darkroom.stack, 1);
  return out;
};

/** what an agent's look apply does on the host: link inserts planned per frame, proposed as one batch */
async function agentLook(s: S, look: string, params: Record<string, unknown>, o: { amount?: number; why: string }): Promise<string> {
  const { studio, ids } = s;
  const id = `look:agent-${look}`;
  const p = planLook(lookItem(look), params, ids.map((f) => ({ frame: f, doc: studio.doc(f)! })), { amount: o.amount ?? 1 });
  const by = new Map(p.frames.map((f) => [f.frame, f.mutations]));
  const b = plan(studio.log.targets<Document>(ids), (_d, f) => by.get(f) ?? null, { id, label: o.why, by: 'agent', source: { kind: 'agent', turn: 1 } });
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
  it('pick → Amount 60 % → what it does → apply to the selection: one batch of links, one undo step; re-apply adjusts', async () => {
    const s = await startedLooks();
    const { rt, ids, st } = s;
    s.select(ids);
    rt.runCommand('looks.pick', null, 'warm-print');
    rt.runCommand('looks.amount', null, 60);
    const before = s.recipes();
    const r = rt.runCommand('looks.apply', null) as any;
    expect(r.label).toBe('Look: Warm print at 60 %');
    expect(r.frames.every((f: any) => f.diff.join() === 'Warmth R −1.2 pt, B +1.2 pt')).toBe(true);
    for (const f of ids) {
      expect(s.inEffect(f).length).toBe(1);
      expect(s.inEffect(f).every((e) => e.tx.batch === r.id && e.tx.by === 'user')).toBe(true);
      expect(looksOn(s, f)).toEqual({ 'warm-print1': 0.6 });
      expect(lights(s, f)).toEqual([0, 0, 0]); // the frame's own lights are untouched: the look is its own filter
      expect(filters(s, f)).toEqual([[-0.03, 0, 0.03]]);
    }
    expect(s.steps()).toEqual(['Look: Warm print at 60 %']);
    rt.run('edit.undo');
    expect(s.recipes()).toEqual(before);
    rt.run('edit.redo');
    // apply again at 80 %: the frames' links adjust (one more step), no second copy
    rt.runCommand('looks.amount', null, 80);
    rt.runCommand('looks.apply', null);
    for (const f of ids) expect(looksOn(s, f)).toEqual({ 'warm-print1': 0.8 });
    expect(s.steps().length).toBe(2);
    expect(looksView(st()).preview).toBe(false);
  });
  it('the frame\'s looks: one Amount over every stage, bake into plain layers, remove', async () => {
    const s = await startedLooks(1);
    const { rt, studio, ids } = s;
    s.select(ids);
    rt.runCommand('looks.pick', null, 'crisp-warm');
    rt.runCommand('looks.apply', null);
    const f = ids[0]!;
    rt.runCommand('looks.setAmount', null, 'crisp-warm1', 50);
    expect(linksOf(studio.doc(f)!).map((l) => [l.id, l.entry.amount])).toEqual([['crisp-warm1-darkroom', 0.5], ['crisp-warm1-print', 0.5]]);
    const node = (d: Document) => studio.bridge.lower({ $: 'cb.image', frame: f, doc: d, what: 'print', args: {}, expr: 'x' } as any).shown.id;
    const linked = node(studio.doc(f)!);
    rt.runCommand('looks.bake', null, 'crisp-warm1');
    expect(linksOf(studio.doc(f)!)).toEqual([]);
    expect(studio.doc(f)!.stages.print.stack.items['crisp-warm1-print']).toMatchObject({ kind: 'group', source: { kind: 'baked', link: 'crisp-warm1' } });
    expect(node(studio.doc(f)!)).toBe(linked); // the same picture
    expect(s.steps().at(-1)).toBe('Bake Crisp and warm');
    rt.run('edit.undo');
    rt.runCommand('looks.remove', null, 'crisp-warm1');
    expect(studio.doc(f)!.stages.print.stack.order).toEqual([]);
  });
  it('the roll: unedited frames only, planned on one card, a frame unticked; one undo takes the look off the roll', async () => {
    const s = await startedLooks();
    const { rt, ids, st } = s;
    await rt.runCommand('roll.fromFrames', null, { analyse: false });
    // the roll's links are by auto: every frame is still unedited; frame 2 has been worked on
    s.userEdit(ids[1]!, 'stages.darkroom.medium.grade', 3, 'Grade');
    rt.runCommand('looks.pick', null, 'warm-print');
    rt.runCommand('looks.param', null, 'warmth', 8);
    rt.runCommand('looks.applyToRoll', null);
    const p = looksView(st()).pending!;
    expect(p.frames.map((f) => f.frame)).toEqual([ids[0], ids[2], ids[3], ids[4], ids[5]]);
    expect(p.aggregate).toEqual([{ text: 'Warmth R −4.0 pt, B +4.0 pt', frames: 5 }]);
    expect(looksOn(s, ids[0]!)).toEqual({});
    rt.runCommand('looks.pending.toggle', null, ids[5]);
    // the photographer nudges frame 4's lights while the card waits: the look goes on top (it is its own filter)
    s.userEdit(ids[3]!, 'lights.params.logH', [0.01, 0, 0], 'Lights');
    expect(rt.runCommand('looks.pending.approve', null)).toBe(true);
    expect(lights(s, ids[3]!)).toEqual([0.01, 0, 0]);
    for (const f of [ids[0]!, ids[2]!, ids[3]!, ids[4]!]) expect(filters(s, f)).toEqual([[-0.1, 0, 0.1]]);
    expect(looksOn(s, ids[5]!)).toEqual({}); // unticked
    expect(looksOn(s, ids[1]!)).toEqual({}); // edited: not unedited
    expect(looksView(st()).pending).toBeNull();
    // one undo takes the look off all four frames of the roll (their scans stay linked to the roll)
    const n = s.steps().length;
    rt.run('edit.undo');
    expect(s.rt.store.log.cursor).toBe(n - 1);
    for (const f of ids) expect(looksOn(s, f)).toEqual({});
    for (const f of ids) expect(s.studio.doc(f)!.stages.scan!.medium).toMatchObject({ link: { roll: 'roll-1' } });
    expect(lights(s, ids[3]!)).toEqual([0.01, 0, 0]);
  });
});

describe('agent apply: one card per batch (approval scope)', () => {
  it('an agent look batch of links → one card → a frame nudged meanwhile is not stale (the look is its own filter) → one step', async () => {
    const s = await startedLooks(4);
    const { rt, studio, ids, st } = s;
    await agentLook(s, 'warm-print', { warmth: 4 }, { amount: 0.6, why: 'warm print at 60 %' });
    const bs = agentBatches(st());
    expect(bs.length).toBe(1);
    expect(bs[0]!.frames.length).toBe(4);
    expect(bs[0]!.why).toBe('warm print at 60 %');
    expect(bs[0]!.aggregate[0]).toMatchObject({ label: 'look Warm print', short: 'added', frames: 4 });
    // while the card waits, the user nudges frame 3's lights: the agent's link does not overwrite them
    s.userEdit(ids[2]!, 'lights.params.logH', [0, 0.025, 0], 'Lights');
    const n = s.steps().length;
    const res = rt.runCommand('looks.batch.approve', null, bs[0]!.batch) as any;
    expect(res.approved.length).toBe(4);
    expect(res.refused).toEqual([]);
    expect(s.steps().length).toBe(n + 1); // the approvals are one step
    await studio.flush();
    expect(agentBatches(st())).toEqual([]);
    for (const f of ids) expect(looksOn(s, f)).toEqual({ 'warm-print1': 0.6 });
    expect(lights(s, ids[2]!)).toEqual([0, 0.025, 0]);
    rt.run('edit.undo');
    for (const f of ids) expect(looksOn(s, f)).toEqual({});
  });
  it('partial approval leaves unticked frames pending; Reject rejects them', async () => {
    const s = await startedLooks(3);
    const { rt, studio, ids, st } = s;
    await agentLook(s, 'more-contrast', {}, { why: 'Look: more contrast' });
    const b = agentBatches(st())[0]!;
    rt.runCommand('looks.batch.toggle', null, b.batch, ids[1]);
    rt.runCommand('looks.batch.approve', null, b.batch);
    await studio.flush();
    expect(looksOn(s, ids[0]!)).toEqual({ 'more-contrast1': 1 });
    expect(rt.store.log.pending(ids[1]!).length).toBe(1);
    const left = agentBatches(st())[0]!;
    expect(left.frames.map((f) => f.frame)).toEqual([ids[1]]);
    rt.runCommand('looks.batch.reject', null, left.batch);
    expect(rt.store.log.pending(ids[1]!).length).toBe(0);
    expect(looksOn(s, ids[1]!)).toEqual({});
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
  it('a tile is the main view’s node once the look is applied; the ring’s centre is the print itself', async () => {
    const s = await startedLooks(2);
    const { rt, studio, ids, looks, st } = s;
    s.select([ids[0]!]);
    const id = (h: any) => studio.bridge.lower(h).shown.id;
    rt.runCommand('looks.compare', null, { frame: ids[0] });
    expect(id(looks.sel.before(st()))).toBe(id(looks.sel.print(st())));
    rt.runCommand('looks.pick', null, 'warm-print');
    const tile = id(looks.lib.tile(st(), looks.sel.byId(st(), 'warm-print')));
    expect(id(looks.sel.print(st()))).toBe(tile); // previewed
    rt.runCommand('looks.apply', null);
    expect(id(looks.sel.print(st()))).toBe(tile); // applied
    rt.runCommand('looks.compare', null, { frame: ids[1] });
    expect(looks.sel.before(st()).frame).toBe(ids[1]);
    const ring = looks.lib.sweep.ring();
    rt.runCommand('looks.preview', null, false);
    expect(id(looks.lib.tile(st(), ring.find((l: any) => l.id === 'ring-D+1')))).not.toBe(id(looks.sel.print(st())));
    expect(looks.lib.caption(st(), ring.find((l: any) => l.id === 'ring-D+1'))).toBe('Balance +1/3 st');
  });
});

describe('copy, paste, sync; presets', () => {
  it('sync by copy: the default groups and the looks from the primary to the selection as one step; crop is not copied', async () => {
    const s = await startedLooks(3);
    const { rt, studio, ids } = s;
    studio.commit(ids[0]!, [set('stages.darkroom.medium.grade', 3.5), set('lights.params.logH', [0.05, 0, -0.05]), set('geometry.crop', { x: 10, y: 5, w: 50, h: 40 })], 'Work');
    s.select([ids[0]!]);
    rt.runCommand('looks.pick', null, 'warm-print');
    rt.runCommand('looks.apply', null);
    s.select(ids, ids[0]!);
    const n = s.steps().length;
    expect((rt.runCommand('looks.sync', null, 'copy') as any).mode).toBe('copy');
    for (const f of [ids[1]!, ids[2]!]) {
      expect(grade(s, f)).toBe(3.5);
      expect(lights(s, f)).toEqual([0.05, 0, -0.05]);
      expect(read(studio.doc(f)!, 'geometry.crop')).toBeNull();
      expect(looksOn(s, f)).toEqual({ 'warm-print1': 1 });
    }
    expect(s.steps().length).toBe(n + 1);
  });
  it('sync by link: the primary\'s layers become one preset the frames link (the source prints the same); one undo', async () => {
    const s = await startedLooks(3);
    const { rt, studio, ids, st } = s;
    const f = ids[0]!;
    studio.commit(f, [set('stages.darkroom.medium.grade', 3)], 'Grade');
    studio.commit(f, [{ op: 'insert', coll: 'stages.darkroom.stack', id: 'b1', item: { kind: 'layer', op: 'burn', params: { stops: 0.5 }, name: 'Burn', enabled: true, amount: 1, mask: null, blend: 'normal', source: { kind: 'user' } } }], 'Burn');
    const node = (x: string) => studio.bridge.lower({ $: 'cb.image', frame: x, doc: 'committed', what: 'print', args: {}, expr: 'x' } as any).shown.id;
    const before = node(f);
    s.select(ids, f);
    const r = rt.runCommand('looks.sync', null, 'link') as any;
    expect(r).toMatchObject({ mode: 'link', frames: 3 });
    const p = st().looks.presets[r.preset];
    expect(p.stacks.darkroom.order).toEqual(['b1']);
    for (const x of ids) expect(looksOn(s, x)).toEqual({ [`${r.preset}-link`]: 1 });
    expect(studio.doc(f)!.stages.darkroom.stack.order).toEqual(['main', 'lights', `${r.preset}-link-darkroom`]);
    expect(node(f)).toBe(before); // the source prints as before: its burn now comes through the link
    expect(grade(s, ids[2]!)).toBe(3); // values are copied
    rt.run('edit.undo');
    expect(st().looks.presets[r.preset]).toBeUndefined();
    expect(studio.doc(f)!.stages.darkroom.stack.order).toEqual(['main', 'lights', 'b1']);
  });
  it('D4 (CHB-046): Sync from the menu asks in the page: it says it copies values, Copy is the default, Link the explicit choice', async () => {
    const s = await startedLooks(3);
    const { rt, studio, ids } = s;
    studio.commit(ids[0]!, [set('stages.darkroom.medium.grade', 3.5)], 'Work');
    s.select(ids, ids[0]!);
    const chrome = rt.chrome as any;
    const n0 = s.steps().length;
    // Cancel: nothing changes
    const p0 = rt.runCommand('looks.sync', null) as Promise<unknown>;
    const d0 = chrome.dialogs.at(-1);
    expect(d0.spec.title).toMatch(/^Sync the settings of /);
    expect(d0.spec.buttons.map((b: any) => b.label)).toEqual(['Cancel', 'Sync 2 frames']);
    d0.close('cancel');
    expect(await p0).toBeNull();
    expect(grade(s, ids[1]!)).not.toBe(3.5);
    // Sync with the default choice: values copied, no preset, one step
    const p1 = rt.runCommand('looks.sync', null) as Promise<unknown>;
    chrome.dialogs.at(-1).close('sync');
    expect(await p1).toMatchObject({ mode: 'copy' });
    expect(grade(s, ids[1]!)).toBe(3.5);
    expect(grade(s, ids[2]!)).toBe(3.5);
    expect(Object.keys(s.st().looks.presets ?? {})).toEqual([]);
    expect(s.steps().length).toBe(n0 + 1);
  });
  it('save as preset → export → delete → import round-trips; it applies like any look; save a look as a preset', async () => {
    const s = await startedLooks(2);
    const { rt, studio, ids, st } = s;
    studio.commit(ids[0]!, [{ op: 'insert', coll: 'stages.darkroom.stack', id: 'b1', item: { kind: 'layer', op: 'burn', params: { stops: 1 }, name: 'Burn', enabled: true, amount: 1, mask: null, blend: 'normal', source: { kind: 'user' } } }], 'Burn');
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
    rt.runCommand('looks.pick', null, `preset:${p.id}`);
    rt.runCommand('looks.apply', null);
    expect(looksOn(s, ids[1]!)).toEqual({ [`${p.id}1`]: 1 });
    expect(resolveLinks(studio.doc(ids[1]!)!, stateLinks(st())).stages.darkroom.stack.items[`${p.id}1-darkroom`]).toMatchObject({ kind: 'group' });
    rt.runCommand('looks.pick', null, 'warm-print');
    rt.runCommand('looks.param', null, 'warmth', 6);
    const saved = rt.runCommand('looks.saveLookAsPreset', null) as any;
    expect(st().looks.presets[saved.id].name).toBe('Warm print (warmth 6, density 0)');
  });
});
