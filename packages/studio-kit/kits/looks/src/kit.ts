// cb.kits.looks (CHB-021 guide §8): presets, parameterised looks, Amount, survey, diff and apply as builder calls on
// top of cb.core. Headless: state, commands, forms, passes and builder calls; the DOM renderers are
// kits/looks/src/dom.ts (LOOKS_RENDERERS, passed to mountStudio).
//
//   const looks = cb.kits.looks;
//   cb.studio('X').use(looks.kit)
//     .module('print', m => m
//       .left(looks.library())
//       .center(ck.match(s => s.looksView.mode, { print: cb.viewer(looks.print, { compare: { before: looks.before } }), survey: looks.survey() }))
//       .right(ck.dock.column({}, looks.params(), looks.amount(), looks.diff(), looks.card())))
//
// A look resolves, per frame, to plain `set` mutations (re-run concretely when a parameter or the Amount moves).
// A user apply commits one batch (one tx and LoggedMutation.batch on every frame's EditLog, one global undo step);
// an agent apply (cb.looks.apply in the DSL) proposes per frame with the batch id, and the card here coalesces the
// pending entries of a batch into one approval with partial approval by frame, E_STALE, Apply anyway and Skip.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { canonicalJSON, CONTRACT_VERSION, defaultRecipe, getPath, toDiagnostic, type Diagnostic, type FrameRecipe, type Mutation } from '@chromobench/contract';
import { slot, type Ck, type FormSpec, type NodeData } from '@chromobench/shell';
import type { Cb, CatalogFrame } from '../../../src/cb.ts';
import { visibleFrames } from '../../../src/cb.ts';
import { frameRef, type ImageHandle } from '../../../src/handles.ts';
import type { Studio } from '../../../src/studio.ts';
import { BUILTIN_LOOKS } from './engine/builtin.ts';
import { aggregate, diffRecipes, summary, type AggregateEntry, type DiffEntry } from './engine/diff.ts';
import { presetToFile, readPresetFile } from './engine/files.ts';
import { defaultGroups, inGroups, SYNC_GROUPS, type SyncGroups } from './engine/groups.ts';
import { add, bake, choice, fromPreset, isLook, look, lookFrame, mul, PRESET_FORMAT, PRESET_VERSION, pt, set, slider, type AmountBase, type Look, type Preset, type PresetEntry } from './engine/look.ts';
import { changing, isUnedited, newBatchId, planApply, planFrame, previewRecipe, type ApplyPlan } from './engine/plan.ts';
import { axis, ring } from './engine/sweep.ts';
import { looksProvider } from './engine/provider.ts';

export type CompareSource = 'before' | 'defaults' | { snapshot: string } | { frame: string } | { look: string; params?: Record<string, unknown>; amount?: number } | { recipe: FrameRecipe };

export interface LooksDoc {
  presets: Record<string, Preset>;
  favourites: string[];
  /** presets imported with problems (unknown paths): shown "needs review" */
  review: Record<string, string[]>;
}
export interface LooksView {
  picked: string | null;
  /** parameter values per look id */
  params: Record<string, Record<string, unknown>>;
  /** Amount in percent, 0–200 */
  amount: number;
  /** null: the look's own base */
  from: AmountBase | null;
  /** the picked look previewed on the main viewer (nothing committed) */
  preview: boolean;
  mode: 'print' | 'survey';
  survey: 'set' | 'ring';
  surveySet: string[];
  /** library filter */
  group: string | null;
  /** sync groups an apply keeps */
  groups: string[];
  compare: CompareSource;
  /** a planned apply to the roll or the library, waiting for confirmation */
  pending: ApplyPlan | null;
  off: string[];
  stale: { frame: string; code: string; message: string }[];
  clipboard: { from: string; entries: PresetEntry[]; groups: string[] } | null;
  /** agent batches: frames unticked, frames refused as stale */
  batchOff: Record<string, string[]>;
  batchStale: Record<string, { frame: string; code: string; message: string }[]>;
}
export const LOOKS_STATE: { looks: LooksDoc; looksView: LooksView } = {
  looks: { presets: {}, favourites: [], review: {} },
  looksView: {
    picked: null, params: {}, amount: 100, from: null, preview: true, mode: 'print', survey: 'set', surveySet: [], group: null, groups: defaultGroups(), compare: 'before',
    pending: null, off: [], stale: [], clipboard: null, batchOff: {}, batchStale: {},
  },
};

const plain = <T>(v: T): T => (v === undefined || v === null ? v : (JSON.parse(JSON.stringify(v)) as T));

// ── state readers (also used by the DOM half) ──
export const looksView = (s: any): LooksView => ({ ...LOOKS_STATE.looksView, ...(s?.looksView ?? {}) });
export const amountOf = (s: any): number => Number(looksView(s).amount ?? 100) / 100;

/** an agent batch: pending proposals sharing a batch id (or one tx across frames), coalesced (approval-scope) */
export interface AgentBatch {
  batch: string;
  why: string;
  frames: { frame: string; tx: string; seqs: number[]; recipe: FrameRecipe; diff: DiffEntry[] }[];
  aggregate: AggregateEntry[];
}
/** The approval-scope pass over the published proposals: one entry per batch that spans frames or carries a batch id. */
export function agentBatches(s: any): AgentBatch[] {
  const by = new Map<string, AgentBatch['frames']>();
  const why = new Map<string, string>();
  const count = new Map<string, number>();
  for (const [f, ps] of Object.entries((s?.proposals ?? {}) as Record<string, any[]>)) for (const p of ps ?? []) count.set(p.tx, (count.get(p.tx) ?? 0) + 1);
  for (const [f, ps] of Object.entries((s?.proposals ?? {}) as Record<string, any[]>)) {
    for (const p of ps ?? []) {
      const key = p.batch ?? ((count.get(p.tx) ?? 0) > 1 ? p.tx : null);
      if (!key) continue;
      const r = s.recipes?.[f] as FrameRecipe | undefined;
      by.set(key, [...(by.get(key) ?? []), { frame: f, tx: p.tx, seqs: [...p.seqs], recipe: p.recipe, diff: r && p.recipe ? diffRecipes(r, p.recipe) : [] }]);
      if (p.why && !why.has(key)) why.set(key, p.why);
    }
  }
  return [...by].map(([batch, frames]) => ({ batch, why: why.get(batch) ?? batch, frames, aggregate: aggregate(frames.map((f) => f.diff)) }));
}

const LOOKS_DOCS = `## cb.kits.looks
Presets (data: path entries set / add / mul) and looks (a JS function with ArgSpec-shaped parameters) resolve per
frame to plain \`set\` mutations; Amount (0–200 %) scales them by a rule chosen from each path's unit — stops for
times and f-numbers, mired for colour temperature, a threshold for enums and stock ids, linear otherwise. Diffs are
in darkroom units. Apply to the selection commits one batch (one undo step); to the roll or the library it is
planned on one card first. Agent applies (cb.looks.apply) arrive as one card per batch with partial approval.`;

export function createLooksKit(ck: Ck, cb: Cb) {
  const node = (form: string, props: Record<string, unknown> = {}): any => ck.node(form, props, []);
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
    const f = cb.current(s);
    if (!f) return null;
    const r = lookedRecipe(s, f, l);
    return r ? frameRef(f, r, `frame.look('${l.name}')`).print() : null;
  };
  /** the caption under a tile: the diff summary, or why the look does not apply */
  const caption = (s: any, l: Look): string => {
    const f = cb.current(s);
    const r = f ? (s.recipes?.[f] as FrameRecipe | undefined) : undefined;
    if (!f || !r) return '';
    const pf = planFrame(l, paramsOf(s, l), f, r, optsOf(s));
    return pf.skipped ? (pf.skipped.hint ?? pf.skipped.message) : summary(pf.diff, 2);
  };
  /** the main viewer's print: the picked look previewed (uncommitted) when preview is on */
  const print = (s: any): ImageHandle | null => {
    const f = cb.frame(s);
    if (!f) return null;
    const v = looksView(s);
    const l = v.preview && v.picked ? lookById(s, v.picked) : null;
    const r = l ? lookedRecipe(s, f.frame, l) : null;
    return r ? frameRef(f.frame, r, `frame.look('${l!.name}')`).print() : f.print();
  };
  /** the compare source as a recipe (guide §5.1) */
  const compareRecipe = (s: any, src: CompareSource = looksView(s).compare): { frame: string; recipe: FrameRecipe | 'initial' } | null => {
    const f = cb.current(s);
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
    const f = cb.current(s);
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
    return ids.length ? ids : [cb.current(s)].filter((x): x is string => !!x);
  };
  const rollFrameIds = (s: any): string[] => (cb.kits['roll']?.of?.(s)?.frames as string[] | undefined) ?? [];
  function targets(ctx: any, to: unknown, where?: 'unedited' | ((f: { id: string; recipe: FrameRecipe; unedited: boolean }) => boolean)): string[] {
    const s = ctx.state;
    let ids: string[];
    if (to === undefined || to === 'selection') ids = selection(s);
    else if (to === 'frame') ids = [cb.current(s)].filter((x): x is string => !!x);
    else if (to === 'roll') ids = rollFrameIds(s);
    else if (to === 'library') ids = visibleFrames(s).map((x: CatalogFrame) => x.id);
    else if (typeof to === 'string') ids = [to];
    else if (Array.isArray(to)) ids = to.map(String);
    else if (to && typeof to === 'object' && 'roll' in (to as any)) ids = (cb.kits['roll']?.of?.(s, (to as any).roll)?.frames as string[] | undefined) ?? [];
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
  const needLook = { enabled: (s: any) => !!cb.current(s) && !!pickedLook(s), why: (s: any) => (!cb.current(s) ? 'Select a frame first' : 'Pick a look first') };
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

  // ── forms ──
  const { build: bt, traced: tr } = slot;
  const spec = (name: string, slots: FormSpec['slots'], doc: string): FormSpec => ({ name, slots: { model: tr<unknown>('the form’s model, computed by the kit'), ...slots }, doc, kind: 'cb' });
  const FORMS: FormSpec[] = [
    spec('looks.params', { look: tr<string | null>('the look whose parameters to show (default: the picked one)') }, 'Generated sliders of the picked look (ArgSpec: unit, range, step)'),
    spec('looks.amount', { range: bt<[number, number]>('[0, 200]'), showDiff: bt<boolean>(), apply: bt<boolean>() }, 'Amount 0–200 % and the result in darkroom units; Apply to selection / roll / library'),
    spec('looks.diff', { against: bt<string>("'before' · 'defaults' · 'snapshot' · 'reference' (default: the compare source)") }, 'What differs from the compare source, in darkroom units, by sync group'),
    spec('looks.card', {}, 'The planned apply (roll, library) and agent look batches: one card each, partial approval by frame, Apply anyway, Skip'),
    spec('looks.groups', {}, 'Sync groups an apply, copy or paste keeps'),
    spec('looks.presets', {}, 'The library presets: export, delete, needs review; save the current frame as a preset'),
    spec('looks.compare', {}, 'The compare source: before, defaults, a snapshot, the reference frame'),
  ];

  // ── passes ──
  /** CB-L001: looks forms in a variant that did not install the kit; CB-L002: unknown look ids in a choice */
  const installed = ck.pass('cb.looks.installed', { on: 'ui', after: 'slots' }, (ir: any, p) => {
    if (ir.kits.some((k: any) => k.name === 'cb.looks')) return;
    for (const f of FORMS) {
      const n = (ir.find(f.name) as NodeData[])[0];
      if (n) {
        p.error('CB-L001', `${f.name} is used, but the looks kit is not installed`, { at: n.at, fix: '.use(cb.kits.looks.kit) on the studio' });
        return;
      }
    }
  });
  ck.install(installed);
  const checks = ck.pass('cb.looks.checks', { on: 'ui', after: 'slots' }, (ir: any, p) => {
    for (const n of ir.find('button') as NodeData[]) {
      const run = n.props['run'];
      if (!Array.isArray(run) || !String(run[0]).startsWith('looks.') || typeof run[1] !== 'string') continue;
      if (!['looks.pick', 'looks.apply'].includes(String(run[0]))) continue;
      const id = run[1] as string;
      if (!lookById({}, id)) {
        const ids = looksOf({}).map((l) => l.id);
        p.error('CB-L002', `${String(run[0])}: no look '${id}'`, { at: n.at, facts: [`looks: ${ids.join(', ')}`] });
      }
    }
  });

  // ── the kit ──
  const kit = ck.kit<typeof LOOKS_STATE>('cb.looks', (k) => {
    k.version('1')
      .requires('cb.core')
      .state('looks', { init: LOOKS_STATE.looks })
      .state('looksView', { init: LOOKS_STATE.looksView, view: true })
      .forms(...FORMS)
      .passes(checks)
      .commands((c) => {
        c.add('looks.pick', {
          label: 'Pick Look',
          palette: false,
          run: (ctx: any, id: string | null) => {
            ctx.rt.store.writeDoc([{ path: ['looksView', 'picked'], value: looksView(ctx.state).picked === id ? null : id }, { path: ['looksView', 'preview'], value: true }], { tier: 'view' });
          },
        })
          .add('looks.param', {
            label: 'Set Look Parameter',
            palette: false,
            run: (ctx: any, name: string, value: unknown) => {
              const l = pickedLook(ctx.state);
              if (!l) return;
              ctx.rt.store.writeDoc([{ path: ['looksView', 'params', l.id], value: { ...paramsOf(ctx.state, l), [name]: value } }], { tier: 'view' });
            },
          })
          .add('looks.amount', { label: 'Look Amount', palette: false, run: (ctx: any, pct: number) => setView(ctx, 'amount', Math.max(0, Math.min(200, Number(pct)))) })
          .add('looks.from', { label: 'Amount From', palette: false, run: (ctx: any, from: AmountBase | null) => setView(ctx, 'from', from) })
          .add('looks.preview', {
            label: 'Preview Look',
            menu: 'Looks',
            checked: (s: any) => looksView(s).preview,
            run: (ctx: any, on?: boolean) => setView(ctx, 'preview', on ?? !looksView(ctx.state).preview),
          })
          .add('looks.apply', {
            label: 'Apply Look to Selection',
            menu: 'Looks',
            ...needLook,
            enabled: (s: any) => !!cb.current(s) && !!pickedLook(s),
            run: (ctx: any, id?: string | Look, o: { to?: unknown; where?: any; params?: Record<string, unknown>; amount?: number; why?: string } = {}) => {
              const l = lookArg(ctx, id);
              if (!l) return null;
              const p = plan(ctx, l, o);
              const res = commit(ctx, p);
              const bad = p.frames.filter((f) => f.skipped);
              if (bad.length && !changing(p).length) ctx.toast(bad[0]!.skipped!.hint ?? bad[0]!.skipped!.message, { kind: 'error' });
              setView(ctx, 'preview', false);
              return res === true ? p : res;
            },
          })
          .add('looks.applyToSelection', { label: 'Apply Look to Selected Frames', palette: false, ...needLook, run: (ctx: any) => ctx.run('looks.apply', null, { to: 'selection' }) })
          .add('looks.applyToRoll', {
            label: 'Apply Look to the Roll’s Unedited Frames…',
            menu: 'Looks',
            enabled: (s: any) => !!pickedLook(s) && rollFrameIds(s).length > 0,
            why: (s: any) => (!pickedLook(s) ? 'Pick a look first' : 'Make a roll first (Roll ▸ New Roll from Open Frames)'),
            run: (ctx: any, where: 'unedited' | 'all' = 'unedited') => {
              const l = pickedLook(ctx.state)!;
              const p = plan(ctx, l, { to: 'roll', ...(where === 'unedited' ? { where: 'unedited' } : {}) });
              showPending(ctx, p);
              return p;
            },
          })
          .add('looks.applyToLibrary', {
            label: 'Apply Look to the Library…',
            menu: 'Looks',
            enabled: (s: any) => !!pickedLook(s) && visibleFrames(s).length > 0,
            why: 'Pick a look first',
            run: (ctx: any, where?: 'unedited') => {
              const p = plan(ctx, pickedLook(ctx.state)!, { to: 'library', ...(where ? { where } : {}) });
              showPending(ctx, p);
              return p;
            },
          })
          .add('looks.pending.toggle', {
            label: 'Include Frame',
            palette: false,
            run: (ctx: any, f: string) => {
              const off = looksView(ctx.state).off;
              setView(ctx, 'off', off.includes(f) ? off.filter((x) => x !== f) : [...off, f]);
            },
          })
          .add('looks.pending.approve', {
            label: 'Apply Planned Look',
            palette: false,
            enabled: (s: any) => !!looksView(s).pending,
            why: 'Nothing planned',
            run: (ctx: any, force = false) => {
              const p = plain(looksView(ctx.state).pending);
              if (!p) return null;
              const res = commit(ctx, p, { force: !!force, off: looksView(ctx.state).off });
              if (res !== true) {
                setView(ctx, 'stale', res);
                return res;
              }
              showPending(ctx, null);
              return true;
            },
          })
          .add('looks.pending.reject', { label: 'Cancel Planned Look', palette: false, run: (ctx: any) => showPending(ctx, null) })
          // agent batches (approval scope): approve the ticked frames as one global step; stale frames are reported
          .add('looks.batch.toggle', {
            label: 'Include Frame in Batch',
            palette: false,
            run: (ctx: any, batch: string, f: string) => {
              const off = looksView(ctx.state).batchOff?.[batch] ?? [];
              ctx.rt.store.writeDoc([{ path: ['looksView', 'batchOff', batch], value: off.includes(f) ? off.filter((x) => x !== f) : [...off, f] }], { tier: 'view' });
            },
          })
          .add('looks.batch.approve', {
            label: 'Approve Agent Look Batch',
            palette: false,
            run: (ctx: any, batch: string, force = false) => {
              const b = agentBatches(ctx.state).find((x) => x.batch === batch);
              if (!b) return null;
              const off = new Set(looksView(ctx.state).batchOff?.[batch] ?? []);
              const items = b.frames.filter((f) => !off.has(f.frame)).map((f) => ({ frame: f.frame, seqs: f.seqs }));
              const res = studioOf(ctx).route.approveBatch(items, `Approve ${b.why}`, { force: !!force });
              const stale = res.refused.flatMap((x) => x.diags.map((d) => ({ frame: x.frame, code: d.code, message: `${ctx.state.catalog?.frames?.[x.frame]?.name ?? x.frame}: ${d.message}` })));
              ctx.rt.store.writeDoc([{ path: ['looksView', 'batchStale', batch], value: stale }], { tier: 'view' });
              return res;
            },
          })
          .add('looks.batch.reject', {
            label: 'Reject Agent Look Batch',
            palette: false,
            run: (ctx: any, batch: string, onlyStale = false) => {
              const b = agentBatches(ctx.state).find((x) => x.batch === batch);
              if (!b) return;
              const stale = new Set((looksView(ctx.state).batchStale?.[batch] ?? []).map((x) => x.frame));
              for (const f of b.frames) if (!onlyStale || stale.has(f.frame)) studioOf(ctx).route.reject(f.frame, f.seqs);
              ctx.rt.store.writeDoc([{ path: ['looksView', 'batchStale', batch], value: [] }], { tier: 'view' });
            },
          })
          .add('looks.survey.open', {
            label: 'Survey Looks',
            menu: 'Looks',
            checked: (s: any) => looksView(s).mode === 'survey',
            run: (ctx: any, mode?: 'set' | 'ring') => {
              const v = looksView(ctx.state);
              const open = v.mode !== 'survey' || (mode && mode !== v.survey);
              ctx.rt.store.writeDoc([{ path: ['looksView', 'mode'], value: open ? 'survey' : 'print' }, ...(mode ? [{ path: ['looksView', 'survey'], value: mode }] : [])], { tier: 'view' });
            },
          })
          .add('looks.survey.toggle', {
            label: 'Add Look to Survey',
            palette: false,
            run: (ctx: any, id: string) => {
              const set = looksView(ctx.state).surveySet;
              setView(ctx, 'surveySet', set.includes(id) ? set.filter((x) => x !== id) : [...set, id]);
            },
          })
          .add('looks.compare', {
            label: 'Compare With',
            palette: false,
            run: (ctx: any, src: CompareSource) => setView(ctx, 'compare', src),
          })
          .add('looks.setReference', {
            label: 'Compare With This Frame',
            menu: 'Looks',
            enabled: (s: any) => !!cb.current(s),
            why: 'Select a frame first',
            run: (ctx: any) => setView(ctx, 'compare', { frame: cb.current(ctx.state)! }),
          })
          .add('looks.snapshot', { label: 'Snapshot', menu: 'Looks', enabled: (s: any) => !!cb.current(s), why: 'Select a frame first', run: (ctx: any, name?: string) => ctx.run('snapshot.new', name) })
          .add('looks.restoreSnapshot', { label: 'Restore Snapshot', palette: false, run: (ctx: any, id: string) => ctx.run('snapshot.restore', id) })
          .add('looks.copy', {
            label: 'Copy Settings',
            menu: 'Looks',
            enabled: (s: any) => !!cb.current(s),
            why: 'Select a frame first',
            run: (ctx: any) => {
              const f = cb.current(ctx.state)!;
              const r = committed(ctx, f);
              if (!r) return null;
              const groups = looksView(ctx.state).groups;
              const clip = { from: f, entries: copyEntries(r, groups), groups };
              setView(ctx, 'clipboard', clip);
              return clip;
            },
          })
          .add('looks.paste', {
            label: 'Paste Settings',
            menu: 'Looks',
            enabled: (s: any) => !!looksView(s).clipboard && !!cb.current(s),
            why: 'Copy the settings of a frame first',
            run: (ctx: any) => {
              const clip = looksView(ctx.state).clipboard;
              if (!clip) return null;
              const name = ctx.state.catalog?.frames?.[clip.from]?.name ?? clip.from;
              const l = fromPreset(presetFrom(`paste-${clip.from}`, `settings of ${name}`, plain(clip.entries)));
              const p = plan(ctx, l, { to: selection(ctx.state).filter((f) => f !== clip.from), amount: 1, id: newBatchId('paste') });
              const res = commit(ctx, { ...p, label: `Paste settings of ${name}` });
              return res === true ? p : res;
            },
          })
          .add('looks.sync', {
            label: 'Sync Settings to Selection',
            menu: 'Looks',
            enabled: (s: any) => (s.ui?.selection?.ids?.length ?? 0) > 1,
            why: 'Select the frames to sync to, with the source as primary',
            run: (ctx: any) => {
              ctx.run('looks.copy');
              return ctx.run('looks.paste');
            },
          })
          .add('looks.saveAsPreset', {
            label: 'Save Frame as Preset…',
            menu: 'Looks',
            enabled: (s: any) => !!cb.current(s),
            why: 'Select a frame first',
            run: (ctx: any, name?: string) => {
              const f = cb.current(ctx.state)!;
              const r = committed(ctx, f);
              if (!r) return null;
              const n = name ?? `${ctx.state.catalog?.frames?.[f]?.name ?? f} settings`;
              const id = `p-${n.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.replace(/-+$/, '');
              const p = presetFrom(id, n, copyEntries(r, looksView(ctx.state).groups));
              ctx.tx(`Save preset "${n}"`, (t: any) => t.$set(['looks', 'presets', id], p));
              return p;
            },
          })
          .add('looks.bake', {
            label: 'Save Look as Preset',
            menu: 'Looks',
            ...needLook,
            run: (ctx: any) => {
              const l = pickedLook(ctx.state)!;
              const f = cb.current(ctx.state)!;
              const p = bake(l, lookFrame(f, committed(ctx, f)!), paramsOf(ctx.state, l));
              ctx.tx(`Save preset "${p.name}"`, (t: any) => t.$set(['looks', 'presets', p.id], p));
              return p;
            },
          })
          .add('looks.deletePreset', {
            label: 'Delete Preset',
            palette: false,
            run: (ctx: any, id: string) => {
              // the draft is a proxy; copy the presets from the (JSON-able) state and replace the map
              const rest = { ...plain(ctx.state.looks?.presets ?? {}) } as Record<string, Preset>;
              delete rest[id];
              ctx.tx(`Delete preset "${ctx.state.looks?.presets?.[id]?.name ?? id}"`, (t: any) => t.$set(['looks', 'presets'], rest));
            },
          })
          .add('looks.importPreset', {
            label: 'Import Preset',
            palette: false,
            run: (ctx: any, text: string) => {
              const r = readPresetFile(text);
              ctx.tx(`Import preset "${r.preset.name}"`, (t: any) => {
                t.$set(['looks', 'presets', r.preset.id], r.preset);
                t.$set(['looks', 'review', r.preset.id], r.status === 'needs-review' ? r.diags.map((d) => d.message) : []);
              });
              return r;
            },
          })
          .add('looks.exportPreset', {
            label: 'Export Preset',
            palette: false,
            run: (ctx: any, id: string) => {
              const p = ctx.state.looks?.presets?.[id];
              return p ? presetToFile(plain(p)) : null;
            },
          })
          .add('looks.favourite', {
            label: 'Favourite Look',
            palette: false,
            run: (ctx: any, id?: string) => {
              const l = lookArg(ctx, id);
              if (!l) return;
              const fav: string[] = ctx.state.looks?.favourites ?? [];
              ctx.tx(fav.includes(l.id) ? `Unfavourite ${l.name}` : `Favourite ${l.name}`, (t: any) => t.$set(['looks', 'favourites'], fav.includes(l.id) ? fav.filter((x) => x !== l.id) : [...fav, l.id]));
            },
          })
          .add('looks.group', { label: 'Look Group', palette: false, run: (ctx: any, g: string | null) => setView(ctx, 'group', g) })
          .add('looks.syncGroup', {
            label: 'Sync Group',
            palette: false,
            run: (ctx: any, name: string) => {
              const g = looksView(ctx.state).groups;
              setView(ctx, 'groups', g.includes(name) ? g.filter((x) => x !== name) : [...g, name]);
            },
          })
          .add('looks.virtualCopy', { label: 'Virtual Copy', menu: 'Looks', enabled: () => false, why: 'Virtual copies need a catalog field and a stack display (CHB-019/020)', run: () => null })
          .add('looks.match', { label: 'Match to Reference', menu: 'Looks', enabled: () => false, why: 'Match measures both frames (measure.stats); not built yet — use Roll ▸ Print the Roll Like the Reference', run: () => null });
      })
      .docs(LOOKS_DOCS);
  });

  // ── builder calls ──
  // each form node carries its model (a τ function of the state and the services), so the renderers stay dumb
  const panel = (form: string, id: string, title: string, model: (s: any, o: Record<string, unknown>, services: any) => unknown) => (o: Record<string, unknown> = {}) => {
    const { id: pid, title: t, ...rest } = o as { id?: string; title?: string };
    return ck.panel(pid ?? id, { title: t ?? title }, node(form, { ...rest, model: (s: any, services?: any) => model(s, rest, services) }));
  };
  const nameOf = (s: any, f: string): string => s?.catalog?.frames?.[f]?.name ?? f;
  const paramsModel = (s: any) => {
    const v = looksView(s);
    const l = pickedLook(s);
    if (!l) return { look: null, preview: v.preview };
    const vals = paramsOf(s, l);
    return {
      look: { id: l.id, name: l.name, group: l.group, notes: l.notes ?? null, requires: l.requires, origin: l.origin },
      params: Object.entries(l.params).map(([name, spec]) => ({ name, spec: { type: spec.type, unit: spec.unit ?? null, min: spec.min ?? null, max: spec.max ?? null, step: spec.ui?.step ?? null, values: spec.values ?? null, label: spec.ui?.label ?? name }, value: vals[name] ?? spec.default })),
      preview: v.preview,
      inSurvey: v.surveySet.includes(l.id),
      favourite: (s.looks?.favourites ?? []).includes(l.id),
    };
  };
  const amountModel = (s: any, o: Record<string, unknown>) => {
    const v = looksView(s);
    const l = pickedLook(s);
    const f = cb.current(s);
    const r = f ? (s.recipes?.[f] as FrameRecipe | undefined) : undefined;
    const pf = l && f && r ? planFrame(l, paramsOf(s, l), f, r, optsOf(s)) : null;
    return {
      pct: v.amount,
      range: (o['range'] as [number, number] | undefined) ?? [0, 200],
      look: l ? l.name : null,
      frame: f ? nameOf(s, f) : null,
      result: pf ? (pf.skipped ? null : pf.diff.map((d) => d.shown)) : null,
      skipped: pf?.skipped ? (pf.skipped.hint ?? pf.skipped.message) : null,
      warnings: pf?.warnings.map((w) => w.message) ?? [],
      selected: selection(s).length,
      roll: rollFrameIds(s).length,
      library: visibleFrames(s).length,
      from: v.from ?? l?.base ?? 'current',
    };
  };
  const SOURCES: { key: string; label: string; src: CompareSource }[] = [
    { key: 'before', label: 'Before (first print)', src: 'before' },
    { key: 'defaults', label: 'Defaults', src: 'defaults' },
  ];
  const srcKey = (src: CompareSource): string => (typeof src === 'string' ? src : 'snapshot' in src ? `snapshot:${src.snapshot}` : 'frame' in src ? `frame:${src.frame}` : 'look' in src ? `look:${src.look}` : 'recipe');
  const diffModel = (s: any, o: Record<string, unknown>, services: any) => {
    const v = looksView(s);
    const against = (o['against'] as string | undefined) ?? null;
    const src: CompareSource =
      against === 'snapshot' ? ((s.snapshots?.[cb.current(s) ?? ''] ?? []).slice(-1)[0] ? { snapshot: (s.snapshots[cb.current(s)!] as any[]).slice(-1)[0].id } : v.compare)
        : against === 'defaults' ? 'defaults' : against === 'before' ? 'before' : v.compare;
    const studio = services?.studio as Studio | undefined;
    const entries = diffAgainst(s, src, (f) => studio?.frames.get(f)?.initial);
    return { against: srcKey(src), entries: entries.map((e) => ({ shown: e.shown, group: e.group ?? 'Other', path: e.path })), previewing: !!(v.preview && v.picked) };
  };
  const compareModel = (s: any) => {
    const f = cb.current(s);
    const v = looksView(s);
    const snaps = f ? ((s.snapshots?.[f] ?? []) as any[]).map((x) => ({ key: `snapshot:${x.id}`, label: `Snapshot “${x.name}”`, src: { snapshot: x.id } as CompareSource })) : [];
    const ref = typeof v.compare === 'object' && 'frame' in v.compare ? [{ key: `frame:${v.compare.frame}`, label: `Frame ${nameOf(s, v.compare.frame)}`, src: v.compare }] : [];
    return { current: srcKey(v.compare), options: [...SOURCES, ...snaps, ...ref], frame: f ? nameOf(s, f) : null };
  };
  const cardModel = (s: any) => {
    const v = looksView(s);
    const p = v.pending;
    return {
      pending: p
        ? {
            id: p.id, label: p.label, why: p.why,
            frames: p.frames.filter((f) => !f.skipped && f.mutations.length).map((f) => ({ frame: f.frame, name: nameOf(s, f.frame), on: !v.off.includes(f.frame), warnings: f.warnings.map((w) => w.code) })),
            skipped: p.frames.filter((f) => f.skipped).map((f) => ({ frame: f.frame, name: nameOf(s, f.frame), why: f.skipped!.hint ?? f.skipped!.message })),
            aggregate: p.aggregate.map((a) => `${a.label} ${a.short}${a.frames > 1 ? ` (${a.frames} frames)` : ''}`),
            stale: v.stale.map((x) => x.message),
          }
        : null,
      batches: agentBatches(s).map((b) => ({
        batch: b.batch, why: b.why,
        frames: b.frames.map((f) => ({ frame: f.frame, name: nameOf(s, f.frame), on: !(v.batchOff?.[b.batch] ?? []).includes(f.frame), changes: f.diff.length })),
        aggregate: b.aggregate.map((a) => `${a.label} ${a.short}${a.frames > 1 ? ` (${a.frames} frames)` : ''}`),
        stale: (v.batchStale?.[b.batch] ?? []).map((x) => x.message),
      })),
    };
  };
  const groupsModel = (s: any) => ({ chosen: looksView(s).groups, all: Object.entries(syncGroups).map(([name, g]) => ({ name, default: g.default, note: g.note ?? null })) });
  const presetsModel = (s: any) => ({
    presets: Object.values((s.looks?.presets ?? {}) as Record<string, Preset>).map((p) => ({ id: p.id, name: p.name, entries: p.entries.length, review: (s.looks?.review?.[p.id] ?? []) as string[] })),
    frame: cb.current(s) ? nameOf(s, cb.current(s)!) : null,
  });
  const favMark = (s: any, l: Look): string => ((s.looks?.favourites ?? []).includes(l.id) ? '★ ' : '');
  const lookCell = (o: { size?: number; survey?: boolean } = {}) => (l: Look) =>
    ck.column(
      { class: `cb-look-cell${o.survey ? ' is-survey' : ''}` },
      ck.view.thumb({ image: (s: any) => tile(s, l), max: o.size ?? 120 } as any),
      ck.text((s: any) => `${looksView(s).picked === l.id ? '● ' : ''}${favMark(s, l)}${l.name}`, { strong: true } as any),
      ck.text((s: any) => caption(s, l), { dim: true, class: 'cb-look-caption' } as any),
      ck.row(
        { class: 'cb-look-actions' },
        ck.ui.button('Preview', { run: ['looks.pick', l.id], small: true } as any),
        o.survey ? ck.ui.button('Apply', { run: ['looks.apply', l.id], small: true, primary: true } as any) : ck.ui.button('Survey ±', { run: ['looks.survey.toggle', l.id], small: true } as any),
      ),
    );
  const library = (o: { groups?: string[]; size?: number; id?: string; title?: string } = {}) =>
    ck.panel(
      o.id ?? 'looks-library',
      { title: o.title ?? 'Looks' },
      ck.ui.segmented([{ value: null, label: 'All' }, ...(o.groups ?? ['Print', 'Contrast', 'Film', 'Mine']).map((g) => ({ value: g, label: g }))], { bind: (s: any) => s.looksView.group, label: 'Group', small: true } as any),
      ck.view.grid((s: any) => looksOf(s).filter((l) => (!looksView(s).group || l.group === looksView(s).group) && (!o.groups || o.groups.includes(l.group))), {
        id: `${o.id ?? 'looks-library'}-grid`,
        cell: lookCell({ size: o.size ?? 96 }),
        key: (l: Look) => l.id,
        size: () => (o.size ?? 96) + 24,
        empty: 'No looks in this group',
      } as any),
    );
  const surveyLooks = (s: any): Look[] => {
    const v = looksView(s);
    if (v.survey === 'ring') return ringLooks;
    const set = v.surveySet.map((id) => lookById(s, id)).filter((l): l is Look => !!l);
    return set.length ? set : looksOf(s).filter((l) => l.group === 'Print' || l.group === 'Contrast');
  };
  const survey = (o: { size?: number; id?: string } = {}) =>
    ck.column(
      { grow: 1, class: 'cb-looks-survey' },
      ck.row(
        { class: 'cb-looks-survey-bar' },
        ck.text((s: any) => `Survey: ${surveyLooks(s).length} ${looksView(s).survey === 'ring' ? 'ring-around prints' : 'looks'} of ${s.catalog?.frames?.[cb.current(s) ?? '']?.name ?? 'no frame'} at ${looksView(s).amount} %`, { strong: true } as any),
        ck.ui.segmented([{ value: 'set', label: 'Chosen looks' }, { value: 'ring', label: 'Ring-around' }], { bind: (s: any) => s.looksView.survey, label: 'Survey', small: true } as any),
        ck.ui.command('looks.survey.open', { text: 'Back to the print', small: true } as any),
      ),
      ck.view.grid((s: any) => surveyLooks(s), { id: o.id ?? 'looks-survey', cell: lookCell({ size: o.size ?? 220, survey: true }), key: (l: Look) => l.id, size: () => (o.size ?? 220) + 30, empty: 'Add looks to the survey (Survey ± in the library)' } as any),
    );
  /** a one-row choice of looks for a simple variant: a button per look applies it at the current Amount */
  const choiceRow = (ids: string[]) => ck.row({ class: 'cb-looks-choice' }, ...ids.map((id) => ck.ui.button(lookById({}, id)?.name ?? id, { run: ['looks.apply', id], small: true } as any)));

  return {
    kit,
    state: LOOKS_STATE,
    // forms and builder calls
    library,
    survey,
    params: panel('looks.params', 'looks-params', 'Look', paramsModel),
    amount: panel('looks.amount', 'looks-amount', 'Amount', amountModel),
    diff: panel('looks.diff', 'looks-diff', 'What changed', diffModel),
    card: panel('looks.card', 'looks-card', 'Look batches', cardModel),
    groups: panel('looks.groups', 'looks-groups', 'Sync groups', groupsModel),
    presets: panel('looks.presets', 'looks-presets', 'Presets', presetsModel),
    compare: panel('looks.compare', 'looks-compare', 'Compare with', compareModel),
    choice: choiceRow,
    cell: lookCell,
    /** the main viewer's image: the frame's print with the picked look previewed */
    print,
    /** the viewer's compare image: the compare source (before, defaults, snapshot, reference frame, a look) */
    before,
    tile,
    caption,
    // authoring
    look,
    slider,
    choiceParam: choice,
    set,
    add,
    mul,
    pt,
    fromPreset,
    bake,
    register: (l: Look) => (extra.set(l.id, l), l),
    syncGroups: (g?: SyncGroups) => (g ? (syncGroups = g) : syncGroups),
    sweep: { ring, axis },
    // readers and passes as functions
    looks: looksOf,
    byId: lookById,
    view: looksView,
    diffOf: diffAgainst,
    diffRecipes,
    summary,
    batches: agentBatches,
    planApply,
    /** the DSL's LooksProvider (cb.looks.* for the agent), over the same registry */
    provider: (getState: () => any) => looksProvider(() => looksOf(getState())),
    keys: { N: 'looks.survey.open', 'Mod+Enter': 'looks.apply', 'Mod+Alt+N': 'looks.snapshot' } as Record<string, any>,
    errors: (e: unknown): Diagnostic => toDiagnostic(e),
  };
}

export type LooksKit = ReturnType<typeof createLooksKit>;
