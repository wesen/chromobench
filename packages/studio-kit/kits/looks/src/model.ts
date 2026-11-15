// cb.kits.looks: the look registry, looked documents, compare sources, targets, plan and commit (split from kit.ts,
// CHB-032; CHB-037: documents and the log). What the commands, the panels and the kit's builder calls share; one
// instance per kit. A user apply is one batch of the values batch builder (`plan`) committed as one step.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { plan as planBatch } from '@chromobench/values';
import { CONTRACT_VERSION, type Document } from '@chromobench/contract';
import type { Cb } from '../../../src/cb.ts';
import { sel, type CatalogFrame } from '../../../src/sel.ts';
import { frameRef, type ImageHandle } from '../../../src/handles.ts';
import { FILTRATION_PATH, FSTOP_PATH, GRADE_PATH, LIGHTS_PATH, PAPER_PATH, read, TIME_PATH } from '../../../src/model/doc.ts';
import type { Studio } from '../../../src/studio.ts';
import { BUILTIN_LOOKS } from './engine/builtin.ts';
import { defaultsOf } from './engine/amount.ts';
import { diffDocs, summary, type DiffEntry } from './engine/diff.ts';
import { inGroups, SYNC_GROUPS, type SyncGroups } from './engine/groups.ts';
import { fromPreset, isLook, PRESET_FORMAT, PRESET_VERSION, type AmountBase, type Look, type Preset, type PresetEntry } from './engine/look.ts';
import { docAt, isLayerPath } from './engine/paths.ts';
import { changing, isUnedited, movedSince, planFrame, planLook, previewDoc, type LookPlan } from './engine/plan.ts';
import { ring } from './engine/sweep.ts';
import { type CompareSource, type LooksView, plain, looksView, amountOf } from './state.ts';

export function createLooksModel(cb: Cb) {
  const studioOf = (ctx: any): Studio => {
    const s = ctx.services?.studio as Studio | undefined;
    if (!s) throw new Error('No studio service: start the app with studio.services()');
    return s;
  };
  const extra = new Map<string, Look>();
  let syncGroups: SyncGroups = SYNC_GROUPS;

  // ── the look registry: built-ins, looks a layout registers, the library's presets ──
  const looksOf = (s: any): Look[] => {
    const presets = Object.values((s?.looks?.presets ?? {}) as Record<string, Preset>).map((p) => fromPreset(plain(p)));
    const seen = new Set<string>();
    return [...BUILTIN_LOOKS, ...extra.values(), ...presets].filter((l) => !seen.has(l.id) && (seen.add(l.id), true));
  };
  const ringLooks = ring();
  const lookById = (s: any, id: string | null | undefined): Look | null => (id ? looksOf(s).find((l) => l.id === id || l.name === id) ?? ringLooks.find((l) => l.id === id) ?? null : null);
  const paramsOf = (s: any, l: Look): Record<string, unknown> => plain(looksView(s).params?.[l.id] ?? {});
  const fromOf = (s: any): AmountBase | undefined => looksView(s).from ?? undefined;
  const rollFrameIds = (s: any): string[] => (cb.kits['roll']?.sel?.roll?.(s)?.frames as string[] | undefined) ?? [];
  const optsOf = (s: any) => ({ amount: amountOf(s), ...(fromOf(s) ? { from: fromOf(s)! } : {}), groups: looksView(s).groups, syncGroups, onRoll: (f: string) => rollFrameIds(s).includes(f) });

  /** the document of `f` with look `l` applied at the current Amount (null when the look does not apply) */
  const lookedRecipe = (s: any, f: string, l: Look, o: { amount?: number; params?: Record<string, unknown> } = {}): Document | null => {
    const r = docAt(s, f);
    if (!r) return null;
    const pf = planFrame(l, o.params ?? paramsOf(s, l), f, r, { ...optsOf(s), ...(o.amount !== undefined ? { amount: o.amount } : {}), noDiff: true });
    if (pf.skipped) return null;
    try {
      return previewDoc(r, pf.mutations);
    } catch {
      return null;
    }
  };
  /** a tile's print: the selected frame through the look at the current Amount */
  const tile = (s: any, l: Look): ImageHandle | null => {
    const f = sel.current(s);
    if (!f) return null;
    const r = lookedRecipe(s, f, l);
    return r ? frameRef(f, r, `frame.look('${l.name}')`).print() : null;
  };
  /** the caption under a tile: the diff summary, or why the look does not apply */
  const caption = (s: any, l: Look): string => {
    const f = sel.current(s);
    const r = f ? docAt(s, f) : undefined;
    if (!f || !r) return '';
    const pf = planFrame(l, paramsOf(s, l), f, r, optsOf(s));
    return pf.skipped ? (pf.skipped.hint ?? pf.skipped.message) : summary(pf.diff, 2);
  };
  /** the main viewer's print: the picked look previewed (uncommitted) when preview is on */
  const print = (s: any): ImageHandle | null => {
    const f = cb.sel.frame(s);
    if (!f) return null;
    const v = looksView(s);
    const l = v.preview && v.picked ? lookById(s, v.picked) : null;
    const r = l ? lookedRecipe(s, f.frame, l) : null;
    return r ? frameRef(f.frame, r, `frame.look('${l!.name}')`).print() : f.print();
  };
  /** the compare source as a document (guide §5.1) */
  const compareRecipe = (s: any, src: CompareSource = looksView(s).compare): { frame: string; doc: Document | 'initial' } | null => {
    const f = sel.current(s);
    const r = f ? docAt(s, f) : undefined;
    if (!f || !r) return null;
    if (src === 'before') return { frame: f, doc: 'initial' };
    if (src === 'defaults') return { frame: f, doc: defaultsOf(r) };
    if ('snapshot' in src) {
      const snap = (s.snapshots?.[f] ?? []).find((x: any) => x.id === src.snapshot);
      return snap ? { frame: f, doc: snap.doc } : null;
    }
    if ('frame' in src) {
      const o = docAt(s, src.frame);
      return o ? { frame: src.frame, doc: o } : null;
    }
    if ('look' in src) {
      const l = lookById(s, src.look);
      const x = l ? lookedRecipe(s, f, l, { ...(src.amount !== undefined ? { amount: src.amount } : {}), ...(src.params ? { params: src.params } : {}) }) : null;
      return x ? { frame: f, doc: x } : null;
    }
    return { frame: f, doc: src.doc };
  };
  const before = (s: any): ImageHandle | null => {
    const c = compareRecipe(s);
    return c ? frameRef(c.frame, c.doc, 'compare').print() : null;
  };
  /** what the diff panel compares: the compare source → the current document (or the previewed look) */
  const diffAgainst = (s: any, against?: CompareSource, initial?: (f: string) => Document | undefined): DiffEntry[] => {
    const f = sel.current(s);
    if (!f) return [];
    const cur = docAt(s, f);
    if (!cur) return [];
    const v = looksView(s);
    const picked = v.preview && v.picked ? lookById(s, v.picked) : null;
    const now = (picked && lookedRecipe(s, f, picked)) || cur;
    const src = against ?? v.compare;
    const c = compareRecipe(s, src);
    const from = c ? (c.doc === 'initial' ? initial?.(c.frame) ?? null : c.doc) : null;
    return from ? diffDocs(from, now, { groups: syncGroups }) : [];
  };

  // ── targets (guide §6.2) ──
  const committed = (ctx: any, f: string): Document | undefined => studioOf(ctx).doc(f);
  const selection = (s: any): string[] => {
    const ids: string[] = s?.ui?.selection?.ids ?? [];
    return ids.length ? ids : [sel.current(s)].filter((x): x is string => !!x);
  };
  function targets(ctx: any, to: unknown, where?: 'unedited' | ((f: { id: string; doc: Document; unedited: boolean }) => boolean)): string[] {
    const s = ctx.state;
    let ids: string[];
    if (to === undefined || to === 'selection') ids = selection(s);
    else if (to === 'frame') ids = [sel.current(s)].filter((x): x is string => !!x);
    else if (to === 'roll') ids = rollFrameIds(s);
    else if (to === 'library') ids = sel.visible(s).map((x: CatalogFrame) => x.id);
    else if (typeof to === 'string') ids = [to];
    else if (Array.isArray(to)) ids = to.map(String);
    else if (to && typeof to === 'object' && 'roll' in (to as any)) ids = (cb.kits['roll']?.sel?.roll?.(s, (to as any).roll)?.frames as string[] | undefined) ?? [];
    else ids = selection(s);
    const studio = studioOf(ctx);
    return ids.filter((f) => {
      const d = studio.doc(f);
      if (!d) return false;
      if (!where) return true;
      const unedited = isUnedited(studio.log, f);
      return where === 'unedited' ? unedited : where({ id: f, doc: d, unedited });
    });
  }
  function plan(ctx: any, l: Look, o: { to?: unknown; where?: any; params?: Record<string, unknown>; amount?: number; why?: string; id?: string } = {}): LookPlan {
    const s = ctx.state;
    const frames = targets(ctx, o.to, o.where).map((f) => ({ frame: f, doc: committed(ctx, f)! }));
    return planLook(l, o.params ?? paramsOf(s, l), frames, { ...optsOf(s), ...(o.amount !== undefined ? { amount: o.amount } : {}), ...(o.why ? { why: o.why } : {}), ...(o.id ? { id: o.id } : {}) });
  }
  /**
   * Commit a plan: one batch of the values batch builder over its frames (each transaction carries the plan's id),
   * one step of the log; frames changed since planning are E_STALE unless forced (then recomputed against their
   * current document, guide §6.4).
   */
  function commit(ctx: any, p: LookPlan, o: { force?: boolean; off?: readonly string[] } = {}): true | { frame: string; code: string; message: string }[] {
    const off = new Set(o.off ?? []);
    const frames = new Map(changing(p).filter((f) => !off.has(f.frame)).map((f) => [f.frame, f]));
    const studio = studioOf(ctx);
    const stale: { frame: string; code: string; message: string }[] = [];
    for (const f of frames.values()) {
      const d = committed(ctx, f.frame);
      if (!d || o.force) continue;
      for (const path of movedSince(f, d)) stale.push({ frame: f.frame, code: 'E_STALE', message: `${ctx.state.catalog?.frames?.[f.frame]?.name ?? f.frame}: ${path} changed since the look was planned` });
    }
    if (stale.length) return stale;
    const again = lookById(ctx.state, p.look.id);
    const batch = planBatch(studio.log.targets<Document>([...frames.keys()].filter((f) => studio.log.has(f))), (d, id) => {
      const f = frames.get(id)!;
      // Apply anyway: a frame that moved is recomputed against its current document
      if (again && movedSince(f, d).length) return planFrame(again, p.look.params, id, d, { amount: p.look.amount, from: p.look.from, groups: p.groups, syncGroups }).mutations;
      return plain(f.mutations);
    }, { id: p.id, label: p.label, by: 'user', source: { kind: 'look', look: p.look.id, name: p.look.name, amount: p.look.amount, why: p.why } });
    if (batch.edits.length) studio.change((log) => log.commit(batch), p.label);
    return true;
  }
  const setView = (ctx: any, k: keyof LooksView, v: unknown): void => ctx.rt.store.writeView([{ path: ['looksView', k], value: plain(v) }]);
  const showPending = (ctx: any, p: LookPlan | null): void =>
    ctx.rt.store.writeView([{ path: ['looksView', 'pending'], value: plain(p) }, { path: ['looksView', 'off'], value: [] }, { path: ['looksView', 'stale'], value: [] }]);
  const pickedLook = (s: any): Look | null => lookById(s, looksView(s).picked);
  const needLook = { enabled: (s: any) => !!sel.current(s) && !!pickedLook(s), why: (s: any) => (!sel.current(s) ? 'Select a frame first' : 'Pick a look first') };
  const lookArg = (ctx: any, id?: string | Look | null): Look | null => (isLook(id) ? id : lookById(ctx.state, id ?? looksView(ctx.state).picked));

  /** copy: the chosen groups' paths of the selected frame, as set entries (the fixed parts and the main exposure's
   *  and the printer lights' params; layers of the frame's own are not copied: a paste sets, it adds nothing) */
  function copyEntries(r: Document, groups: readonly string[]): PresetEntry[] {
    const d = defaultsOf(r);
    const out: PresetEntry[] = [];
    for (const e of diffDocs(d, r, { groups: syncGroups })) {
      if (!inGroups(e.path, groups, syncGroups, r) || e.path.startsWith('masks.') || e.b === undefined) continue;
      if (isLayerPath(e.path) && !/^(main|lights)\.params\./.test(e.path)) continue;
      out.push({ path: e.path, set: plain(e.b) });
    }
    // paths equal to the defaults are copied too, so a paste resets them
    for (const p of [PAPER_PATH, GRADE_PATH, LIGHTS_PATH, TIME_PATH, FILTRATION_PATH, FSTOP_PATH])
      if (inGroups(p, groups, syncGroups, r) && !out.some((e) => e.path === p) && read(r, p) !== undefined) out.push({ path: p, set: plain(read(r, p)) });
    return out;
  }
  function presetFrom(id: string, name: string, entries: PresetEntry[], group = 'Mine'): Preset {
    return { format: PRESET_FORMAT, version: PRESET_VERSION, id, name, group, entries, base: 'current', contract: CONTRACT_VERSION };
  }
  return { studioOf, extra, looksOf, ringLooks, lookById, paramsOf, optsOf, tile, caption, print, before, diffAgainst, committed, selection, rollFrameIds, plan, commit, setView, showPending, pickedLook, needLook, lookArg, copyEntries, presetFrom, syncGroupsOf: (g?: SyncGroups): SyncGroups => (g ? (syncGroups = g) : syncGroups) };
}
export type LooksModel = ReturnType<typeof createLooksModel>;
