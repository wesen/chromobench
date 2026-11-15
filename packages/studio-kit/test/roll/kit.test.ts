// CHB-020 stages 3–6 headless: cb.kits.roll in a layout (build checks CB-R001..R003), and the whole flow
// through commands on the booted 'roll' layout — new roll (analysis + automatic first print, one undo step),
// cull, reference, match previewed and coalesced, partial approval, E_STALE / Apply anyway, hand-edited frames
// skipped, one undo restoring every frame (CHB-037: the frames' documents and the roll record in one step of the log).
import { describe, expect, it } from 'vitest';
import { canonicalJSON, set } from '@chromobench/values';
import { buildLayout, defineLayout, lightsOf, mainExposure, read } from '../../src/index.ts';
import { autoOf, contactRecipe, rollBadge, rollOf, type RollDoc } from '../../kits/roll/src/index.ts';
import { startedRoll, type StartedRoll } from './fixtures.ts';

const codes = (def: unknown, level: 'error' | 'warning') => buildLayout(def).app.diagnostics.list.filter((d) => d.level === level && d.code.startsWith('CB-R')).map((d) => `${d.code}${d.fix ? ` fix: ${d.fix}` : ''}`);

describe('cb.kits.roll in layouts (guide §5.5)', () => {
  it('CB-R001: roll forms without the kit installed', () => {
    const def = defineLayout({ id: 'x', label: 'x', build: (ck, cb) => cb.studio('X').module(ck.module('m', { label: 'M' }).center(cb.kits['roll'].panels.setup())) });
    expect(codes(def, 'error')).toEqual(['CB-R001 fix: .use(cb.kits.roll.kit) on the studio']);
  });
  it('CB-R002: a balance bar with no contact sheet or roll library (warning with a computed fix)', () => {
    const def = defineLayout({ id: 'x', label: 'x', build: (ck, cb) => cb.studio('X').use(cb.kits['roll'].kit).module(ck.module('m', { label: 'M' }).right(cb.kits['roll'].panels.balanceBar())) });
    expect(codes(def, 'error')).toEqual([]);
    expect(codes(def, 'warning')).toEqual(['CB-R002 fix: add cb.kits.roll.views.contactSheet() to the centre, or cb.kits.roll.panels.library() to the left dock']);
  });
  it('CB-R003: rollScope on a path the roll does not share', () => {
    const def = defineLayout({ id: 'x', label: 'x', build: (ck, cb) => cb.studio('X').use(cb.kits['roll'].kit).module(ck.module('m', { label: 'M' }).right(ck.panel.define('p', {}, cb.arg('lights.params.logH').rollScope('roll'), cb.arg('stages.scan.medium.stock').rollScope('ask')))) });
    const errs = codes(def, 'error');
    expect(errs.length).toBe(1);
    expect(errs[0]).toMatch(/^CB-R003 fix: cb.arg\('lights.params.logH'\)/);
  });
});

const recipes = (r: StartedRoll): Record<string, string> => Object.fromEntries(r.ids.map((f) => [f, canonicalJSON(r.studio.doc(f)!)]));
const doc = (r: StartedRoll): RollDoc => r.rt.store.peek(['roll']) as RollDoc;
const steps = (r: StartedRoll): string[] => r.rt.store.log.steps.slice(0, r.rt.store.log.cursor).map((x) => x.label);
const auto = (r: StartedRoll, f: string) => autoOf(r.studio.doc(f)!);

describe('the roll flow through commands (guide §9)', () => {
  it('new roll → analysis → first print (auto, one undo step) → cull → reference → match → approve → one undo', async () => {
    const r = await startedRoll([0, 0.004, 0.008, 0.002, 0.006, 0.01]);
    const { rt, studio, ids } = r;
    const fresh = recipes(r);
    await rt.runCommand('roll.fromFrames', null);
    const roll = rollOf(rt.state)!;
    expect(roll.frames).toEqual(ids);
    expect(roll.status).toBe('first-printed');
    expect(roll.analysis!.base.used.length).toBe(6);
    for (const f of ids) {
      expect(auto(r, f)['method']).toBe('roll');
      expect(rt.store.log.inEffect(f).every((e) => e.tx.by === 'auto')).toBe(true);
    }
    expect(steps(r)).toEqual(['New roll "Kodak Portra 400 · 6 frames"', 'Analyse Kodak Portra 400 · 6 frames', 'First print']);
    // one undo takes the first print off every frame and the roll back to analysed; redo puts it back
    const printed = recipes(r);
    rt.run('edit.undo');
    expect(recipes(r)).toEqual(fresh);
    expect(rollOf(rt.state)!.status).toBe('analysed');
    rt.run('edit.redo');
    expect(recipes(r)).toEqual(printed);
    expect(rollOf(rt.state)!.status).toBe('first-printed');

    // cull: reject frame 2 (a rating: the document tier, one undo step; no frame document involved)
    rt.runCommand('frame.select', null, ids[1]);
    rt.runCommand('frame.reject', null);
    expect((rt.state as any).ratings[ids[1]!].flag).toBe('reject');
    // reference: frame 4
    rt.runCommand('frame.select', null, ids[3]);
    rt.runCommand('roll.setReference', null);
    expect(rollOf(rt.state)!.reference).toBe(ids[3]);
    expect(rollBadge(rt.state, ids[3]!)).toContain('★ ref');

    // match: previewed, nothing applied; the rejected frame is skipped and listed
    const before = recipes(r);
    rt.runCommand('roll.matchToReference', null);
    const pending = (rt.state as any).rollView.pending;
    expect(pending.kind).toBe('match');
    expect(pending.frames.map((x: any) => x.frame)).toEqual([ids[0], ids[2], ids[4], ids[5]]);
    expect(pending.skipped).toEqual([{ frame: ids[1], why: 'rejected' }]);
    expect(recipes(r)).toEqual(before);
    expect(autoOf(contactRecipe(rt.state, ids[0]!)!)['method']).toBe('match');
    expect(rollBadge(rt.state, ids[0]!)).toContain('preview');
    // coalescing: moving the slider replaces the pending batch
    rt.runCommand('roll.alpha', null, 1);
    const p2 = (rt.state as any).rollView.pending;
    expect(p2.id).not.toBe(pending.id);
    expect(p2.meta.alpha).toBe(1);
    // partial approval: untick frame 6
    rt.runCommand('roll.pending.toggle', null, ids[5]);
    expect(rt.runCommand('roll.pending.approve', null)).toBe(true);
    expect((rt.state as any).rollView.pending).toBeNull();
    for (const f of [ids[0], ids[2], ids[4]]) expect(auto(r, f!)).toMatchObject({ method: 'match', matchFrame: ids[3], alpha: 1 });
    expect(auto(r, ids[5]!)['method']).toBe('roll');
    expect(doc(r).rolls[roll.id]!.status).toBe('balanced');
    // one undo reverts every frame of the batch and the roll's record
    expect(steps(r).at(-1)).toBe(`Print the roll like ${ids[3]}`);
    rt.run('edit.undo');
    expect(recipes(r)).toEqual(before);
    expect(doc(r).rolls[roll.id]!.status).toBe('first-printed');
  }, 60_000);

  it('a stale frame is reported, not overwritten; Apply anyway applies; hand-edited frames are skipped', async () => {
    const r = await startedRoll([0, 0.003, 0.006, 0.009]);
    const { rt, studio, ids } = r;
    await rt.runCommand('roll.fromFrames', null);
    // frame 3 gets its lights set by hand
    studio.commit(ids[2]!, [set('lights.params.logH', [0.05, 0, -0.05])], 'Lights');
    rt.runCommand('frame.select', null, ids[0]);
    rt.runCommand('roll.setReference', null);
    rt.runCommand('roll.matchToReference', null);
    const p = (rt.state as any).rollView.pending;
    expect(p.skipped).toEqual([{ frame: ids[2], why: 'lights set by hand' }]);
    expect(p.frames.map((x: any) => x.frame)).toEqual([ids[1], ids[3]]);
    // frame 2 changes after planning
    studio.commit(ids[1]!, [set('main.params.time_s', 33)], 'Time');
    const before = recipes(r);
    const res = rt.runCommand('roll.pending.approve', null) as any[];
    expect(res.map((d) => d.code)).toContain('E_STALE');
    expect(res[0].message).toContain(ids[1]);
    expect(recipes(r)).toEqual(before);
    expect((rt.state as any).rollView.stale.length).toBeGreaterThan(0);
    expect(rt.runCommand('roll.pending.approve', null, true)).toBe(true);
    expect(auto(r, ids[1]!)['method']).toBe('match');
    expect(lightsOf(studio.doc(ids[2]!)!)).toEqual([0.05, 0, -0.05]);
  }, 60_000);

  it('roll settings: one transaction sets the roll and every frame; the setup knows who diverges', async () => {
    const r = await startedRoll([0, 0.004, 0.008]);
    const { rt, studio, ids } = r;
    await rt.runCommand('roll.fromFrames', null, { analyse: false });
    const stock = 'stages.scan.medium.stock';
    rt.runCommand('roll.setShared', null, stock, 'kodak_gold_200');
    for (const f of ids) expect(read(studio.doc(f)!, stock)).toBe('kodak_gold_200');
    expect(rollOf(rt.state)!.fragment.stock).toBe('kodak_gold_200');
    expect(steps(r).at(-1)).toBe(`Roll: ${stock}`);
    // one frame diverges
    studio.commit(ids[2]!, [set('stages.darkroom.medium.grade', 3)], 'Grade');
    expect(rollBadge(rt.state, ids[2]!)).toContain('diverges');
    expect(rollBadge(rt.state, ids[0]!)).not.toContain('diverges');
    rt.run('edit.undo'); // the grade (its own step)
    rt.run('edit.undo'); // the roll stock: frames and roll together
    for (const f of ids) expect(read(studio.doc(f)!, stock)).toBe('kodak_portra_400');
    expect(rollOf(rt.state)!.fragment.stock).toBe('kodak_portra_400');
  }, 60_000);

  it('the contact sheet in "one time and pack" mode prints every frame with the reference\'s time and lights', async () => {
    const r = await startedRoll([0, 0.004, 0.008]);
    const { rt, ids } = r;
    await rt.runCommand('roll.fromFrames', null);
    rt.runCommand('frame.select', null, ids[1]);
    rt.runCommand('roll.setReference', null);
    rt.runCommand('roll.contact.mode', null, 'single');
    const ref = (rt.state as any).docs[ids[1]!];
    for (const f of ids) {
      const c = contactRecipe(rt.state, f)!;
      expect(mainExposure(c).time_s).toBe(mainExposure(ref).time_s);
      expect(lightsOf(c)).toEqual(lightsOf(ref));
    }
  }, 60_000);
});

describe('the roll flow on documents: the scan medium\'s baseT and flare, batch ids, the first-print card', () => {
  it('the first print writes the measured base and veil into the documents and tags every entry with its batch', async () => {
    const r = await startedRoll([0, 0.004, 0.008, 0.002]);
    const { rt, studio, ids } = r;
    await rt.runCommand('roll.fromFrames', null);
    const roll = rollOf(rt.state)!;
    const b = roll.analysis!.base;
    expect(b.veil).not.toBeNull();
    for (const f of ids) {
      const rec = studio.doc(f)!;
      const flare = read(rec, 'stages.scan.medium.flare') as number[];
      const baseT = read(rec, 'stages.scan.medium.baseT') as number[];
      expect(flare).toEqual(roll.fragment.flare);
      expect(flare.every((x) => x > 0 && x <= 20)).toBe(true);
      expect(baseT).toEqual(roll.fragment.baseT);
      // the veil is the document's: f = 100 L / (1 - L); the base is (T - L) / (1 - L)
      b.veil!.forEach((L, k) => expect(flare[k]).toBeCloseTo((100 * L) / (1 - L), 3));
      b.T!.forEach((T, k) => expect(baseT[k]).toBeCloseTo(T / (1 - b.veil![k]!), 5));
      const tags = rt.store.log.inEffect(f).map((e) => e.tx.batch);
      expect(tags.length).toBeGreaterThan(0);
      expect(new Set(tags).size).toBe(1);
      expect(tags[0]).toMatch(/^roll:first-print-/);
    }
  }, 60_000);

  it('"First print of the roll" is one card: reject leaves the frames alone, approve prints them as one batch', async () => {
    const r = await startedRoll([0, 0.004, 0.008]);
    const { rt, studio, ids } = r;
    await rt.runCommand('roll.fromFrames', null);
    // take the first print off, so there is something to print again
    rt.run('edit.undo');
    const before = recipes(r);
    rt.runCommand('roll.firstPrint', null, true);
    const card = (rt.state as any).rollView.pending;
    expect(card.kind).toBe('first-print');
    expect(card.frames.length).toBe(3);
    expect(recipes(r)).toEqual(before);
    rt.runCommand('roll.pending.reject', null);
    expect((rt.state as any).rollView.pending).toBeNull();
    expect(recipes(r)).toEqual(before);
    rt.runCommand('roll.firstPrint', null, true);
    const id = (rt.state as any).rollView.pending.id as string;
    expect(rt.runCommand('roll.pending.approve', null)).toBe(true);
    for (const f of ids) {
      expect(auto(r, f)['method']).toBe('roll');
      expect(rt.store.log.inEffect(f).at(-1)!.tx.batch).toBe(id);
    }
    expect(rollOf(rt.state)!.status).toBe('first-printed');
  }, 60_000);
});
