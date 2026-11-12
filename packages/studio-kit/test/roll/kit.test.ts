// CHB-020 stages 3–6 headless: cb.kits.roll in a variant (build checks CB-R001..R003), and the whole flow
// through commands on the booted 'roll' variant — new roll (analysis + automatic first print, one undo step),
// cull, reference, match previewed and coalesced, partial approval, E_STALE / Apply anyway, hand-edited frames
// skipped, one global undo restoring every frame.
import { describe, expect, it } from 'vitest';
import { canonicalJSON } from '@chromobench/contract';
import { buildVariant, defineVariant } from '../../src/index.ts';
import { contactRecipe, rollBadge, rollOf, type RollDoc } from '../../kits/roll/src/index.ts';
import { startedRoll, type StartedRoll } from './fixtures.ts';

const codes = (def: unknown, level: 'error' | 'warning') => buildVariant(def).app.diagnostics.list.filter((d) => d.level === level && d.code.startsWith('CB-R')).map((d) => `${d.code}${d.fix ? ` fix: ${d.fix}` : ''}`);

describe('cb.kits.roll in variants (guide §5.5)', () => {
  it('CB-R001: roll forms without the kit installed', () => {
    const def = defineVariant({ id: 'x', label: 'x', build: (ck, cb) => cb.studio('X').module('m', (m: any) => m.label('M').center(cb.kits['roll'].setup())) });
    expect(codes(def, 'error')).toEqual(['CB-R001 fix: .use(cb.kits.roll.kit) on the studio']);
  });
  it('CB-R002: a balance bar with no contact sheet or roll library (warning with a computed fix)', () => {
    const def = defineVariant({ id: 'x', label: 'x', build: (ck, cb) => cb.studio('X').use(cb.kits['roll'].kit).module('m', (m: any) => m.label('M').right(cb.kits['roll'].balanceBar())) });
    expect(codes(def, 'error')).toEqual([]);
    expect(codes(def, 'warning')).toEqual(['CB-R002 fix: add cb.kits.roll.contactSheet() to the centre, or cb.kits.roll.library() to the left dock']);
  });
  it('CB-R003: rollScope on a path the roll does not share', () => {
    const def = defineVariant({ id: 'x', label: 'x', build: (ck, cb) => cb.studio('X').use(cb.kits['roll'].kit).module('m', (m: any) => m.label('M').right(ck.panel('p', {}, cb.arg('print.lights.logH').rollScope('roll'), cb.arg('scan.stock').rollScope('ask')))) });
    const errs = codes(def, 'error');
    expect(errs.length).toBe(1);
    expect(errs[0]).toMatch(/^CB-R003 fix: cb.arg\('print.lights.logH'\)/);
  });
});

const recipes = (r: StartedRoll): Record<string, string> => Object.fromEntries(r.ids.map((f) => [f, canonicalJSON(r.studio.frames.get(f)!.log.committed)]));
const doc = (r: StartedRoll): RollDoc => r.rt.store.peek(['roll']) as RollDoc;

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
      const log = studio.frames.get(f)!.log;
      expect(log.committed.print.lights.auto.method).toBe('roll');
      expect(log.inEffect().every((e) => e.by === 'auto')).toBe(true);
    }
    expect(rt.history.entries.map((e) => e.label)).toEqual(['New roll "Kodak Portra 400 · 6 frames"', 'First print']);
    // one undo takes the first print off every frame; redo puts it back
    const printed = recipes(r);
    rt.run('edit.undo');
    expect(recipes(r)).toEqual(fresh);
    rt.run('edit.redo');
    expect(recipes(r)).toEqual(printed);

    // cull: reject frame 2 (catalog, undoable, no EditLog involvement)
    rt.runCommand('frame.select', null, ids[1]);
    rt.runCommand('frame.reject', null);
    expect((rt.state as any).catalog.frames[ids[1]!].flag).toBe('reject');
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
    expect(contactRecipe(rt.state, ids[0]!)!.print.lights.auto.method).toBe('match');
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
    for (const f of [ids[0], ids[2], ids[4]]) expect(studio.frames.get(f!)!.log.committed.print.lights.auto).toMatchObject({ method: 'match', matchFrame: ids[3], alpha: 1 });
    expect(studio.frames.get(ids[5]!)!.log.committed.print.lights.auto.method).toBe('roll');
    expect(doc(r).rolls[roll.id]!.status).toBe('balanced');
    // one global undo reverts every frame of the batch
    const n = rt.history.entries.length;
    expect(rt.history.entries[n - 1]!.label).toBe(`Print the roll like ${ids[3]}`);
    rt.run('edit.undo');
    expect(recipes(r)).toEqual(before);
  }, 60_000);

  it('a stale frame is reported, not overwritten; Apply anyway applies; hand-edited frames are skipped', async () => {
    const r = await startedRoll([0, 0.003, 0.006, 0.009]);
    const { rt, studio, ids } = r;
    await rt.runCommand('roll.fromFrames', null);
    // frame 3 gets its lights set by hand
    studio.route.applyMutations(ids[2]!, [{ op: 'set', path: 'print.lights.logH', value: [0.05, 0, -0.05] }], 'Lights');
    rt.runCommand('frame.select', null, ids[0]);
    rt.runCommand('roll.setReference', null);
    rt.runCommand('roll.matchToReference', null);
    const p = (rt.state as any).rollView.pending;
    expect(p.skipped).toEqual([{ frame: ids[2], why: 'lights set by hand' }]);
    expect(p.frames.map((x: any) => x.frame)).toEqual([ids[1], ids[3]]);
    // frame 2 changes after planning
    studio.route.applyMutations(ids[1]!, [{ op: 'set', path: 'print.enlarger.time_s', value: 33 }], 'Time');
    const before = recipes(r);
    const res = rt.runCommand('roll.pending.approve', null) as any[];
    expect(res.map((d) => d.code)).toContain('E_STALE');
    expect(res[0].message).toContain(ids[1]);
    expect(recipes(r)).toEqual(before);
    expect((rt.state as any).rollView.stale.length).toBeGreaterThan(0);
    expect(rt.runCommand('roll.pending.approve', null, true)).toBe(true);
    expect(studio.frames.get(ids[1]!)!.log.committed.print.lights.auto.method).toBe('match');
    expect(studio.frames.get(ids[2]!)!.log.committed.print.lights.logH).toEqual([0.05, 0, -0.05]);
  }, 60_000);

  it('roll settings: one transaction sets the roll and every frame; the setup knows who diverges', async () => {
    const r = await startedRoll([0, 0.004, 0.008]);
    const { rt, studio, ids } = r;
    await rt.runCommand('roll.fromFrames', null, { analyse: false });
    rt.runCommand('roll.setShared', null, 'scan.stock', 'kodak_gold_200');
    for (const f of ids) expect(studio.frames.get(f)!.log.committed.scan!.stock).toBe('kodak_gold_200');
    expect(rollOf(rt.state)!.fragment['scan.stock']).toBe('kodak_gold_200');
    expect(rt.history.entries.at(-1)!.label).toBe('Roll: scan.stock');
    // one frame diverges
    studio.route.applyMutations(ids[2]!, [{ op: 'set', path: 'print.grade', value: 3 }], 'Grade');
    expect(rollBadge(rt.state, ids[2]!)).toContain('diverges');
    expect(rollBadge(rt.state, ids[0]!)).not.toContain('diverges');
    rt.run('edit.undo'); // the grade (its own global step)
    rt.run('edit.undo'); // the roll stock: frames and roll together
    for (const f of ids) expect(studio.frames.get(f)!.log.committed.scan!.stock).toBe('kodak_portra_400');
    expect(rollOf(rt.state)!.fragment['scan.stock']).toBe('kodak_portra_400');
  }, 60_000);

  it('the contact sheet in "one time and pack" mode prints every frame with the reference\'s time and lights', async () => {
    const r = await startedRoll([0, 0.004, 0.008]);
    const { rt, ids } = r;
    await rt.runCommand('roll.fromFrames', null);
    rt.runCommand('frame.select', null, ids[1]);
    rt.runCommand('roll.setReference', null);
    rt.runCommand('roll.contact.mode', null, 'single');
    const ref = (rt.state as any).recipes[ids[1]!];
    for (const f of ids) {
      const c = contactRecipe(rt.state, f)!;
      expect(c.print.enlarger.time_s).toBe(ref.print.enlarger.time_s);
      expect(c.print.lights.logH).toEqual(ref.print.lights.logH);
    }
  }, 60_000);
});

describe('contract 0.3 in the roll flow: scan.baseT, scan.flare, FrameRecipe.roll, batch ids, the first-print card', () => {
  it('the first print writes the measured base and veil into the recipes, names the roll, and tags every entry with its batch', async () => {
    const r = await startedRoll([0, 0.004, 0.008, 0.002]);
    const { rt, studio, ids } = r;
    await rt.runCommand('roll.fromFrames', null);
    const roll = rollOf(rt.state)!;
    const b = roll.analysis!.base;
    expect(b.veil).not.toBeNull();
    for (const f of ids) {
      const rec = studio.frames.get(f)!.log.committed;
      expect(rec.roll).toEqual({ id: roll.id });
      expect(rec.scan!.flare).toEqual(roll.fragment['scan.flare']);
      expect((rec.scan!.flare as number[]).every((x) => x > 0 && x <= 20)).toBe(true);
      expect(rec.scan!.baseT).toEqual(roll.fragment['scan.baseT']);
      // the veil is the recipe's: f = 100 L / (1 - L); the base is (T - L) / (1 - L)
      b.veil!.forEach((L, k) => expect((rec.scan!.flare as number[])[k]).toBeCloseTo((100 * L) / (1 - L), 3));
      b.T!.forEach((T, k) => expect(rec.scan!.baseT![k]).toBeCloseTo(T / (1 - b.veil![k]!), 5));
      const tags = studio.frames.get(f)!.log.inEffect().map((e) => e.batch);
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
      const log = studio.frames.get(f)!.log;
      expect(log.committed.print.lights.auto.method).toBe('roll');
      expect(log.inEffect().at(-1)!.batch).toBe(id);
    }
    expect(rollOf(rt.state)!.status).toBe('first-printed');
  }, 60_000);
});
