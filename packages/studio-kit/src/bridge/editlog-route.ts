// The EditLog route (guide §6.2–6.4): `recipes.<frameId>` is a projection of that frame's EditLog, and writes
// under it become EditLog calls. `proposals.<frameId>` publishes the pending agent transactions, each with the
// recipe it would make (committed ⊕ that tx's mutations), so a viewer can show a proposal without touching the
// log's single preview slot.
//
//   ctx.preview(recipes.f.print.enlarger.time_s, 12.6)   → log.preview({ op: 'set', … })
//   ctx.cancel()                                         → log.preview(null)
//   ctx.commit('Time') / ctx.tx(…)                       → log.apply([set …], 'user', 'Time') per frame, shared tx,
//                                                          one history part per frame
//   route.step(…) (arrow keys, wheel, nudges)            → preview now, one apply after 800 ms without a step
//   route.apply(frame, mutations, label)                 → log.apply; pushed as its own global step
//   log events the route did not cause (agent in auto mode, approve, a History-panel jump, load)
//                                                        → republish; units push a part on the global stack
//
// The history part of a unit checks that its unit is still the frame's last unit in effect (undo) or the next
// one (redo); otherwise it returns false and the shell skips it (CB-H401, reported by the host kit).
import {
  applyMutation, canonicalJSON, fieldPattern, getPath, type Diagnostic, type FrameRecipe, type LogEvent, type Mutation, type UndoUnit,
} from '@chromobench/contract';
import { pathStr, setIn, type Clock, type HistoryPart, type Mirror, type Patch, type RouteAdapter, type RouteApi, type Store, type TxOpts } from '@chromobench/shell';
import { generateControls } from '../model/controls.ts';
import { lookupFor, pendingGroups, type ModelLookup, type PendingGroup } from '../model/history.ts';
import { diffRecipes } from '../model/recipes.ts';
import type { FrameEntry, Frames } from './frames.ts';
import { allOps } from '@chromobench/contract';

export const BURST_MS = 800;

export interface Proposal extends PendingGroup {
  /** the committed recipe with this tx's mutations folded in (what Show renders) */
  recipe: FrameRecipe;
  /** why the fold failed, if it did */
  error?: string;
}

type Key = string | number;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const same = (a: unknown, b: unknown): boolean => canonicalJSON(a) === canonicalJSON(b);

/** A store path under recipes.<f> (array indexes) → the dotted recipe path (exposure ids) and whether it is a field. */
export function recipePathOf(r: unknown, sub: readonly Key[]): { dotted: string; field: string | null } {
  const segs: string[] = [];
  let cur: unknown = r;
  let field: string | null = null;
  for (const k of sub) {
    if (Array.isArray(cur)) {
      const el = cur[Number(k)];
      segs.push(isObj(el) && typeof el['id'] === 'string' ? el['id'] : String(k));
      cur = el;
    } else {
      segs.push(String(k));
      cur = isObj(cur) ? cur[String(k)] : undefined;
    }
    if (!field && fieldPattern(segs.join('.'))) field = segs.join('.');
  }
  return { dotted: segs.join('.'), field };
}

export class EditLogRoute implements RouteAdapter {
  readonly id = 'recipes';
  readonly frames: Frames;
  readonly lookup: ModelLookup;
  api: RouteApi | null = null;
  /** >0 while the route itself calls a log (its own apply, undo, redo, preview) */
  private quiet = 0;
  private previewed = new Set<string>();
  private txSeq = 0;
  private burst: { key: string; label: string; opts: TxOpts; store: Store; clock: Clock; timer: unknown } | null = null;
  /** counters for tests and the inspector */
  readonly stats = { applies: 0, undos: 0, redos: 0, skips: 0, previews: 0, pushes: 0 };

  constructor(frames: Frames, o: { lookup?: ModelLookup } = {}) {
    this.frames = frames;
    this.lookup = o.lookup ?? lookupFor(generateControls(allOps()));
  }

  // ── projection ──
  attach(api: RouteApi): () => void {
    this.api = api;
    const offs: (() => void)[] = [];
    offs.push(
      this.frames.onAdded(e => {
        api.publish(this.mirror(e), { init: true });
        offs.push(e.log.on(ev => this.onLog(e, ev)));
      }),
    );
    return () => {
      for (const f of offs) f();
      this.api = null;
    };
  }
  mirror(e: FrameEntry): Mirror[] {
    return [
      { path: ['recipes', e.id], value: e.log.committed },
      { path: ['proposals', e.id], value: this.proposals(e) },
    ];
  }
  proposals(e: FrameEntry): Proposal[] {
    const log = e.log;
    const pending = log.pending();
    return pendingGroups(log, this.lookup).map(g => {
      let r = log.committed;
      let error: string | undefined;
      for (const seq of g.seqs) {
        const m = pending.find(x => x.seq === seq)!.m;
        try {
          r = applyMutation(r, m).recipe;
        } catch (err) {
          error = String((err as Error)?.message ?? err);
        }
      }
      return { ...g, recipe: r, ...(error ? { error } : {}) };
    });
  }
  private publish(e: FrameEntry): void {
    this.api?.publish(this.mirror(e));
  }
  private onLog(e: FrameEntry, ev: LogEvent): void {
    if (ev.type === 'preview' || ev.type === 'mode' || this.quiet) return;
    this.publish(e);
    if ((ev.type === 'apply' || ev.type === 'approve') && this.api) {
      this.stats.pushes++;
      this.api.push({ label: labelOf(e, ev.unit), channel: e.id, parts: [this.part(e, ev.unit.tx, ev.unit.label)] });
    }
  }
  private withQuiet<T>(f: () => T): T {
    this.quiet++;
    try {
      return f();
    } finally {
      this.quiet--;
    }
  }

  // ── history parts ──
  part(e: FrameEntry, tx: string, label: string): HistoryPart {
    const log = e.log;
    return {
      source: 'recipes',
      label,
      channel: e.id,
      undo: () => {
        if (log.cursor === 0 || log.units[log.cursor - 1]!.tx !== tx) {
          this.stats.skips++;
          return false;
        }
        this.withQuiet(() => log.undo());
        this.stats.undos++;
        return this.mirror(e);
      },
      redo: () => {
        if (log.cursor >= log.units.length || log.units[log.cursor]!.tx !== tx) {
          this.stats.skips++;
          return false;
        }
        this.withQuiet(() => log.redo());
        this.stats.redos++;
        return this.mirror(e);
      },
    };
  }

  // ── store → logs ──
  private entryOf(path: readonly Key[]): FrameEntry {
    const id = String(path[1] ?? '');
    const e = this.frames.get(id);
    if (!e) throw new Error(`recipes.${id}: no such frame is open`);
    return e;
  }
  preview(writes: { path: Key[]; value: unknown }[]): void {
    const store = this.api?.store;
    for (const w of writes) {
      const e = this.frames.get(String(w.path[1] ?? ''));
      if (!e || w.path.length < 3) continue;
      const cur = store ? store.current : null;
      const r = cur ? (cur as any).recipes?.[e.id] : e.log.committed; // eslint-disable-line @typescript-eslint/no-explicit-any
      const { field } = recipePathOf(r, w.path.slice(2));
      if (!field) continue;
      try {
        this.withQuiet(() => e.log.preview({ op: 'set', path: field, value: getPath(r, field) }));
        this.previewed.add(e.id);
        this.stats.previews++;
      } catch {
        // an invalid intermediate value: readers still see the shell's overlay; the commit validates
      }
    }
  }
  cancel(): void {
    for (const id of this.previewed) this.withQuiet(() => this.frames.get(id)?.log.preview(null));
    this.previewed.clear();
  }

  /** The mutations that a set of store patches on one frame make. */
  mutationsFor(e: FrameEntry, patches: Patch[]): Mutation[] {
    const committed = e.log.committed;
    let r: unknown = committed;
    for (const p of patches) r = p.path.length === 2 ? p.after : setIn(r, p.path.slice(2), p.after);
    if (patches.some(p => p.path.length === 2)) return diffRecipes(committed, r as FrameRecipe);
    const out: Mutation[] = [];
    const seen = new Set<string>();
    for (const p of patches) {
      const { dotted, field } = recipePathOf(r, p.path.slice(2));
      if (field) {
        if (seen.has(field)) continue;
        seen.add(field);
        const v = getPath(r, field);
        if (!same(v, getPath(committed, field))) out.push({ op: 'set', path: field, value: v });
      } else {
        for (const m of diffRecipes(committed, r as FrameRecipe, [dotted])) {
          const k = JSON.stringify(m);
          if (!seen.has(k)) out.push(m);
          seen.add(k);
        }
      }
    }
    return out;
  }

  apply(patches: Patch[], info: { label: string; opts: TxOpts }): { parts: HistoryPart[]; mirror: Mirror[] } {
    const byFrame = new Map<FrameEntry, Patch[]>();
    for (const p of patches) {
      if (String(p.path[0]) !== 'recipes') continue;
      if (p.path.length < 2) throw new Error('recipes cannot be replaced as a whole; write recipes.<frame>');
      const e = this.entryOf(p.path);
      (byFrame.get(e) || byFrame.set(e, []).get(e)!).push(p);
    }
    // validate every frame before applying any, so a refused frame leaves the others alone
    const plan: { e: FrameEntry; ms: Mutation[] }[] = [];
    for (const [e, ps] of byFrame) {
      const ms = this.mutationsFor(e, ps);
      let r = e.log.committed;
      for (const m of ms) r = applyMutation(r, m, { graph: e.graph }).recipe;
      plan.push({ e, ms });
    }
    const tx = (info.opts['tx'] as string | undefined) ?? `u${++this.txSeq}`;
    const parts: HistoryPart[] = [];
    const mirror: Mirror[] = [];
    for (const { e, ms } of plan) {
      this.previewed.delete(e.id);
      if (!ms.length) {
        this.withQuiet(() => e.log.preview(null));
        mirror.push(...this.mirror(e));
        continue;
      }
      this.withQuiet(() => e.log.apply(ms, 'user', info.label, { tx }));
      this.stats.applies++;
      parts.push(this.part(e, tx, info.label));
      mirror.push(...this.mirror(e));
    }
    // a no-op (every value unchanged): a part that never applies, so the store keeps no patches of its own
    if (!parts.length) parts.push({ source: 'recipes', label: info.label, undo: () => false, redo: () => false });
    return { parts, mirror };
  }

  // ── bursts (keyboard, wheel, nudge buttons): one undo unit per pause ──
  step(store: Store, clock: Clock, path: Key[], value: unknown, label: string, opts: TxOpts = {}): void {
    const key = pathStr(path);
    if (this.burst && this.burst.key !== key) this.endBurst();
    if (!this.burst && store.previewing) store.commit(label, opts);
    store.preview(path, value);
    if (this.burst) clock.clearTimeout(this.burst.timer as number);
    const b = { key, label, opts, store, clock, timer: null as unknown };
    b.timer = clock.timeout(() => {
      if (this.burst === b) this.endBurst();
    }, BURST_MS);
    this.burst = b;
  }
  /** commit an open burst now (another control was touched, blur, a command ran) */
  endBurst(): void {
    const b = this.burst;
    if (!b) return;
    this.burst = null;
    b.clock.clearTimeout(b.timer as number);
    b.store.commit(b.label, b.opts);
  }
  get bursting(): boolean {
    return !!this.burst;
  }

  // ── commands' entry points ──
  /** ctx.recipe.apply: structural mutations (exposure.add, mask.set) or several sets as one unit */
  applyMutations(frame: string, ms: Mutation[], label: string, o: { tx?: string } = {}): UndoUnit {
    this.endBurst();
    const e = this.frames.get(frame);
    if (!e) throw new Error(`no frame ${frame}`);
    return e.log.apply(ms, 'user', label, o);
  }
  /**
   * A cross-frame batch (CHB-020 roll setup, first print, "print the roll like this frame"): one unit per frame
   * under one shared tx, one global undo step. Every frame is validated before any is applied. `by: 'auto'`
   * for the automatic first print (as ingest's frame.add). Until LoggedMutation.batch exists (CHB-020
   * CONTRACT-REQUESTS R3) the shared tx is what groups the entries.
   */
  applyBatch(entries: { frame: string; mutations: Mutation[] }[], label: string, o: { by?: 'user' | 'auto'; tx?: string; detail?: string; batch?: string } = {}): UndoUnit[] {
    this.endBurst();
    const plan: { e: FrameEntry; ms: Mutation[] }[] = [];
    for (const { frame, mutations } of entries) {
      if (!mutations.length) continue;
      const e = this.frames.get(frame);
      if (!e) throw new Error(`no frame ${frame}`);
      let r = e.log.committed;
      for (const m of mutations) r = applyMutation(r, m, { graph: e.graph }).recipe;
      plan.push({ e, ms: mutations });
    }
    const tx = o.tx ?? `u${++this.txSeq}`;
    const units: UndoUnit[] = [];
    const parts: HistoryPart[] = [];
    for (const { e, ms } of plan) {
      this.previewed.delete(e.id);
      units.push(this.withQuiet(() => e.log.apply(ms, o.by ?? 'user', label, { tx, ...(o.batch ? { batch: o.batch } : {}) })));
      this.stats.applies++;
      parts.push(this.part(e, tx, label));
      this.publish(e);
    }
    if (parts.length && this.api) {
      this.stats.pushes++;
      this.api.push({ label, ...(o.detail ? { detail: o.detail } : {}), channel: plan.length === 1 ? plan[0]!.e.id : null, parts });
    }
    return units;
  }
  approve(frame: string, seqs: number[], force = false): UndoUnit | Diagnostic[] {
    this.endBurst();
    const e = this.frames.get(frame);
    if (!e) throw new Error(`no frame ${frame}`);
    return e.log.approve(seqs, { force });
  }
  /**
   * Approve pending entries on several frames as one global undo step (CHB-021: one card for an agent's look batch).
   * Each frame is approved on its own (EditLog.approve); a frame refused (E_STALE, …) is reported and the others
   * are committed, so the card can offer Apply anyway or Skip for the refused ones.
   */
  approveBatch(items: { frame: string; seqs: number[] }[], label: string, o: { force?: boolean } = {}): { units: { frame: string; unit: UndoUnit }[]; refused: { frame: string; diags: Diagnostic[] }[] } {
    this.endBurst();
    const units: { frame: string; unit: UndoUnit }[] = [];
    const refused: { frame: string; diags: Diagnostic[] }[] = [];
    const parts: HistoryPart[] = [];
    for (const { frame, seqs } of items) {
      const e = this.frames.get(frame);
      if (!e || !seqs.length) continue;
      const res = this.withQuiet(() => e.log.approve(seqs, { force: !!o.force }));
      if (Array.isArray(res)) {
        refused.push({ frame, diags: res });
        continue;
      }
      units.push({ frame, unit: res });
      parts.push(this.part(e, res.tx, label));
      this.publish(e);
    }
    if (parts.length && this.api) {
      this.stats.pushes++;
      this.api.push({ label, channel: parts.length === 1 ? units[0]!.frame : null, parts });
    }
    return { units, refused };
  }
  reject(frame: string, seqs: number[]): void {
    this.frames.get(frame)?.log.reject(seqs);
  }
  /** the History panel: move this frame's cursor without touching the global stack */
  jump(frame: string, target: number): void {
    this.endBurst();
    const e = this.frames.get(frame);
    if (!e) return;
    while (e.log.cursor > target && e.log.undo());
    while (e.log.cursor < target && e.log.redo());
  }
}

function labelOf(e: FrameEntry, u: UndoUnit): string {
  const first = e.log.entries[u.seqs[0]! - 1];
  if (first?.approvedBy) return `Approve ${u.tx}`;
  if (first?.by === 'agent') return `Agent ${u.tx}`;
  return u.label;
}
