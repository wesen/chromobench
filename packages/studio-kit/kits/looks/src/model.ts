// cb.kits.looks: the look registry, looked recipes, compare sources, targets, plan and commit (split from kit.ts,
// CHB-032). What the commands, the panels and the kit's builder calls share; one instance per kit.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { canonicalJSON, CONTRACT_VERSION, defaultRecipe, getPath, type FrameRecipe, type Mutation } from '@chromobench/contract';
import type { Cb } from '../../../src/cb.ts';
import { sel, type CatalogFrame } from '../../../src/sel.ts';
import { frameRef, type ImageHandle } from '../../../src/handles.ts';
import type { Studio } from '../../../src/studio.ts';
import { BUILTIN_LOOKS } from './engine/builtin.ts';
import { diffRecipes, summary, type DiffEntry } from './engine/diff.ts';
import { inGroups, SYNC_GROUPS, type SyncGroups } from './engine/groups.ts';
import { fromPreset, isLook, PRESET_FORMAT, PRESET_VERSION, type AmountBase, type Look, type Preset, type PresetEntry } from './engine/look.ts';
import { changing, isUnedited, planApply, planFrame, previewRecipe, type ApplyPlan } from './engine/plan.ts';
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

  // ── the look registry: built-ins, looks a variant registers, the library's presets ──
  const looksOf = (s: any): Look[] => {
    const presets = Object.values((s?.looks?.presets ?? {}) as Record<string, Preset>).map((p) => fromPreset(plain(p)));
    const seen = new Set<string>();
    return [...BUILTIN_LOOKS, ...extra.values(), ...presets].filter((l) => !seen.has(l.id) && (seen.add(l.id), true));
  };
  const ringLooks = ring();
  const lookById = (s: any, id: string | null | undefined): Look | null => (id ? looksOf(s).find((l) => l.id === id || l.name === id) ?? ringLooks.find((l) => l.id === id) ?? null : null);
  const paramsOf = (s: any, l: Look): Record<string, unknown> => plain(looksView(s).params?.[l.id] ?? {});
  const fromOf = (s: any): AmountBase | undefined => looksView(s).from ?? undefined;
  const optsOf = (s: any) => ({ amount: amountOf(s), ...(fromOf(s) ? { from: fromOf(s)! } : {}), groups: looksView(s).groups, syncGroups });

  /** the recipe of `f` with look `l` applied at the current Amount (null when the look does not apply) */
  const lookedRecipe = (s: any, f: string, l: Look, o: { amount?: number; params?: Record<string, unknown> } = {}): FrameRecipe | null => {
    const r = s?.recipes?.[f] as FrameRecipe | undefined;
    if (!r) return null;
    const pf = planFrame(l, o.params ?? paramsOf(s, l), f, r, { ...optsOf(s), ...(o.amount !== undefined ? { amount: o.amount } : {}), noDiff: true });
    if (pf.skipped) return null;
    return previewRecipe(r, pf.mutations);
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
    const r = f ? (s.recipes?.[f] as FrameRecipe | undefined) : undefined;
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
  /** the compare source as a recipe (guide §5.1) */
  const compareRecipe = (s: any, src: CompareSource = looksView(s).compare): { frame: string; recipe: FrameRecipe | 'initial' } | null => {
    const f = sel.current(s);
    const r = f ? (s.recipes?.[f] as FrameRecipe | undefined) : undefined;
    if (!f || !r) return null;
    if (src === 'before') return { frame: f, recipe: 'initial' };
    if (src === 'defaults') return { frame: f, recipe: defaultRecipe(r.kind, { sha256: r.source.sha256 }, { frame: r.frame }) };
    if ('snapshot' in src) {
      const snap = (s.snapshots?.[f] ?? []).find((x: any) => x.id === src.snapshot);
      return snap ? { frame: f, recipe: snap.recipe } : null;
    }
    if ('frame' in src) {
      const o = s.recipes?.[src.frame] as FrameRecipe | undefined;
      return o ? { frame: src.frame, recipe: o } : null;
    }
    if ('look' in src) {
      const l = lookById(s, src.look);
      const x = l ? lookedRecipe(s, f, l, { ...(src.amount !== undefined ? { amount: src.amount } : {}), ...(src.params ? { params: src.params } : {}) }) : null;
      return x ? { frame: f, recipe: x } : null;
    }
    return { frame: f, recipe: src.recipe };
  };
  const before = (s: any): ImageHandle | null => {
    const c = compareRecipe(s);
    return c ? frameRef(c.frame, c.recipe, 'compare').print() : null;
  };
  /** what the diff panel compares: the compare source → the current recipe (or the previewed look) */
  const diffAgainst = (s: any, against?: CompareSource, initial?: (f: string) => FrameRecipe | undefined): DiffEntry[] => {
    const f = sel.current(s);
    if (!f) return [];
    const cur = s.recipes?.[f] as FrameRecipe | undefined;
    if (!cur) return [];
    const v = looksView(s);
    const picked = v.preview && v.picked ? lookById(s, v.picked) : null;
    const now = (picked && lookedRecipe(s, f, picked)) || cur;
    const src = against ?? v.compare;
    const c = compareRecipe(s, src);
    const from = c ? (c.recipe === 'initial' ? initial?.(c.frame) ?? null : c.recipe) : null;
    return from ? diffRecipes(from, now, { groups: syncGroups }) : [];
  };

  // ── targets (guide §6.2) ──
  const committed = (ctx: any, f: string): FrameRecipe | undefined => studioOf(ctx).frames.get(f)?.log.committed;
  const selection = (s: any): string[] => {
    const ids: string[] = s?.ui?.selection?.ids ?? [];
    return ids.length ? ids : [sel.current(s)].filter((x): x is string => !!x);
  };
  const rollFrameIds = (s: any): string[] => (cb.kits['roll']?.sel?.roll?.(s)?.frames as string[] | undefined) ?? [];
  function targets(ctx: any, to: unknown, where?: 'unedited' | ((f: { id: string; recipe: FrameRecipe; unedited: boolean }) => boolean)): string[] {
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
      const e = studio.frames.get(f);
      if (!e) return false;
      if (!where) return true;
      const unedited = isUnedited(e.log);
      return where === 'unedited' ? unedited : where({ id: f, recipe: e.log.committed, unedited });
    });
  }
  function plan(ctx: any, l: Look, o: { to?: unknown; where?: any; params?: Record<string, unknown>; amount?: number; why?: string; id?: string } = {}): ApplyPlan {
    const s = ctx.state;
    const frames = targets(ctx, o.to, o.where).map((f) => ({ frame: f, recipe: committed(ctx, f)! }));
    return planApply(l, o.params ?? paramsOf(s, l), frames, { ...optsOf(s), ...(o.amount !== undefined ? { amount: o.amount } : {}), ...(o.why ? { why: o.why } : {}), ...(o.id ? { id: o.id } : {}) });
  }
  /** commit a plan: one batch, one tx, one global undo step; frames changed since planning are E_STALE unless forced */
  function commit(ctx: any, p: ApplyPlan, o: { force?: boolean; off?: readonly string[] } = {}): true | { frame: string; code: string; message: string }[] {
    const off = new Set(o.off ?? []);
    const frames = changing(p).filter((f) => !off.has(f.frame));
    const stale: { frame: string; code: string; message: string }[] = [];
    const entries: { frame: string; mutations: Mutation[] }[] = [];
    for (const f of frames) {
      const r = committed(ctx, f.frame);
      if (!r) continue;
      const moved = f.mutations.filter((m) => m.op === 'set' && m.expect !== undefined && canonicalJSON(getPath(r, m.path) ?? null) !== canonicalJSON(m.expect));
      if (moved.length && !o.force) {
        for (const m of moved) if (m.op === 'set') stale.push({ frame: f.frame, code: 'E_STALE', message: `${ctx.state.catalog?.frames?.[f.frame]?.name ?? f.frame}: ${m.path} changed since the look was planned` });
        continue;
      }
      // Apply anyway: recompute against the frame's current recipe (guide §6.4)
      const again = moved.length ? lookById(ctx.state, p.look.id) : null;
      const ms = again ? planFrame(again, p.look.params, f.frame, r, { amount: p.look.amount, from: p.look.from, groups: p.groups, syncGroups }).mutations : f.mutations;
      entries.push({ frame: f.frame, mutations: plain(ms) });
    }
    if (stale.length) return stale;
    if (entries.length) studioOf(ctx).route.applyBatch(entries, p.label, { tx: p.id, batch: p.id, detail: p.why });
    return true;
  }
  const setView = (ctx: any, k: keyof LooksView, v: unknown): void => ctx.rt.store.writeDoc([{ path: ['looksView', k], value: plain(v) }], { tier: 'view' });
  const showPending = (ctx: any, p: ApplyPlan | null): void =>
    ctx.rt.store.writeDoc([{ path: ['looksView', 'pending'], value: plain(p) }, { path: ['looksView', 'off'], value: [] }, { path: ['looksView', 'stale'], value: [] }], { tier: 'view' });
  const pickedLook = (s: any): Look | null => lookById(s, looksView(s).picked);
  const needLook = { enabled: (s: any) => !!sel.current(s) && !!pickedLook(s), why: (s: any) => (!sel.current(s) ? 'Select a frame first' : 'Pick a look first') };
  const lookArg = (ctx: any, id?: string | Look | null): Look | null => (isLook(id) ? id : lookById(ctx.state, id ?? looksView(ctx.state).picked));

  /** copy: the chosen groups' paths of the selected frame, as set entries */
  function copyEntries(r: FrameRecipe, groups: readonly string[]): PresetEntry[] {
    const d = defaultRecipe(r.kind, { sha256: r.source.sha256 }, { frame: r.frame });
    const out: PresetEntry[] = [];
    for (const e of diffRecipes(d, r, { groups: syncGroups })) {
      if (!inGroups(e.path, groups, syncGroups) || e.path.startsWith('masks.') || e.b === undefined) continue;
      if (/^print\.exposures\.[^.]+$/.test(e.path)) continue; // whole exposures are not set entries
      out.push({ path: e.path, set: plain(e.b) });
    }
    // paths equal to the defaults are copied too, so a paste resets them
    for (const p of ['print.paper', 'print.grade', 'print.lights.logH', 'print.enlarger.time_s', 'print.enlarger.filtration', 'print.enlarger.fstop', 'print.preflash'])
      if (inGroups(p, groups, syncGroups) && !out.some((e) => e.path === p)) out.push({ path: p, set: plain(getPath(r, p)) });
    return out;
  }
  function presetFrom(id: string, name: string, entries: PresetEntry[], group = 'Mine'): Preset {
    return { format: PRESET_FORMAT, version: PRESET_VERSION, id, name, group, entries, base: 'current', contract: CONTRACT_VERSION };
  }
  return { studioOf, extra, looksOf, ringLooks, lookById, paramsOf, optsOf, tile, caption, print, before, diffAgainst, committed, selection, rollFrameIds, plan, commit, setView, showPending, pickedLook, needLook, lookArg, copyEntries, presetFrom, syncGroupsOf: (g?: SyncGroups): SyncGroups => (g ? (syncGroups = g) : syncGroups) };
}
export type LooksModel = ReturnType<typeof createLooksModel>;
