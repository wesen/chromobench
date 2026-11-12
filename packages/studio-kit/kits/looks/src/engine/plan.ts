// The apply plan (guide §6): a look at an Amount on N frames is, per frame, the mutations the Amount pass produced
// against that frame's own recipe (each `set` carrying `expect`), its diff, or why it was skipped — under one batch
// id. The same data drives the tile captions, the Amount line, the confirm card, the agent's approval card and the
// DSL receipt. A user plan commits as one batch (one global undo step); an agent plan is proposed per frame with the
// batch id and coalesced into one card.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { applyMutation, toDiagnostic, type Diagnostic, type EditLog, type FrameRecipe, type Mutation } from '@chromobench/contract';
import { amountPass, type AmountOptions } from './amount.ts';
import { aggregate, diffRecipes, type AggregateEntry, type DiffEntry } from './diff.ts';
import { inGroups, SYNC_GROUPS, type SyncGroups } from './groups.ts';
import { kitDiag, lookFrame, resolveLook, type AmountBase, type Look, type PresetEntry } from './look.ts';

export const LOOK_TX = 'look:';

export interface PlanFrame {
  frame: string;
  mutations: Mutation[];
  diff: DiffEntry[];
  /** CB-LOOK-CONFLICT and silent-clamp notes; the frame is still applied */
  warnings: Diagnostic[];
  /** the frame is left alone: requires, a range diagnostic (fix = the clamped value), a path error */
  skipped?: Diagnostic;
}
export interface ApplyPlan {
  /** batch id: the EditLog tx and LoggedMutation.batch of every unit it makes */
  id: string;
  /** "Look: warm print at 60 %" */
  label: string;
  why: string;
  look: { id: string; name: string; params: Record<string, unknown>; amount: number; from: AmountBase };
  groups: string[] | null;
  frames: PlanFrame[];
  by: 'user' | 'agent';
  /** the frames' diffs merged by path */
  aggregate: AggregateEntry[];
}

export const amountLabel = (k: number): string => `${Math.round(k * 100)} %`;
export const planLabel = (name: string, k: number): string => `Look: ${name}${Math.abs(k - 1) < 1e-9 ? '' : ` at ${amountLabel(k)}`}`;

/** Paths the roll balance owns (CHB-020): a look should move them by offsets, never set them absolutely. */
export const BALANCE_PATHS = ['print.lights.logH', 'print.enlarger.time_s'];

export interface PlanOptions extends Partial<AmountOptions> {
  /** batch id (default: a fresh one) */
  id?: string;
  /** keep only entries of these sync groups (null: all) */
  groups?: readonly string[] | null;
  syncGroups?: SyncGroups;
  by?: 'user' | 'agent';
  why?: string;
}

let seq = 0;
export const newBatchId = (lookId: string): string => `${LOOK_TX}${lookId}:${Date.now().toString(36)}${(++seq).toString(36)}`;

/** The mutations of a look at Amount k on one frame, or why it is skipped. */
export function planFrame(l: Look, params: Record<string, unknown>, frame: string, recipe: FrameRecipe, o: PlanOptions = {}): PlanFrame {
  const k = o.amount ?? 1;
  let entries: PresetEntry[];
  let exposures;
  try {
    const r = resolveLook(l, lookFrame(frame, recipe), params);
    if (r.skip) return { frame, mutations: [], diff: [], warnings: [], skipped: r.skip };
    entries = o.groups ? r.entries.filter((e) => inGroups(e.path, o.groups!, o.syncGroups ?? SYNC_GROUPS)) : r.entries;
    exposures = o.groups && !o.groups.includes('Dodge and burn') ? [] : r.exposures;
    const res = amountPass({ ...r, entries, exposures }, recipe, { amount: k, ...(o.from ? { from: o.from } : {}), ...(o.over ? { over: o.over } : {}) });
    if (res.diags.length) return { frame, mutations: [], diff: [], warnings: [], skipped: res.diags[0]! };
    const warnings: Diagnostic[] = res.notes.map((n) => kitDiag('CB-L111', n));
    if (recipe.roll) {
      for (const e of entries)
        if ('set' in e && BALANCE_PATHS.includes(e.path))
          warnings.push(kitDiag('CB-L120', `${l.name} sets ${e.path} absolutely on a balanced roll`, { path: e.path, hint: 'apply as offsets (add entries) to keep the roll balance', fix: `{ path: '${e.path}', add: … }` }));
    }
    const after = previewRecipe(recipe, res.mutations);
    return { frame, mutations: res.mutations, diff: diffRecipes(recipe, after, o.syncGroups ? { groups: o.syncGroups } : {}), warnings };
  } catch (err) {
    return { frame, mutations: [], diff: [], warnings: [], skipped: toDiagnostic(err) };
  }
}

/** The plan for N frames: one batch id, one label, per-frame mutations against each frame's own recipe. */
export function planApply(l: Look, params: Record<string, unknown>, frames: readonly { frame: string; recipe: FrameRecipe }[], o: PlanOptions = {}): ApplyPlan {
  const k = o.amount ?? 1;
  const out = frames.map((f) => planFrame(l, params, f.frame, f.recipe, o));
  const label = planLabel(l.name, k);
  return {
    id: o.id ?? newBatchId(l.id),
    label,
    why: o.why ?? label,
    look: { id: l.id, name: l.name, params: { ...params }, amount: k, from: o.from ?? l.base },
    groups: o.groups ? [...o.groups] : null,
    frames: out,
    by: o.by ?? 'user',
    aggregate: aggregate(out.filter((f) => !f.skipped).map((f) => f.diff)),
  };
}

/** The recipe a frame would have with the mutations applied (previews, tiles; `expect` ignored). */
export function previewRecipe(r: FrameRecipe, ms: readonly Mutation[]): FrameRecipe {
  let out = r;
  for (const m of ms) out = applyMutation(out, m.op === 'set' ? { op: 'set', path: m.path, value: m.value } : m).recipe;
  return out;
}

/** "unedited": nothing in effect but the automatic first print and ingest (guide §6.2) */
export const isUnedited = (log: Pick<EditLog, 'inEffect'>): boolean => log.inEffect().every((e) => e.by === 'auto' || e.m.op === 'frame.add');

/** Frames of a plan that would change (not skipped, at least one mutation). */
export const changing = (p: ApplyPlan): PlanFrame[] => p.frames.filter((f) => !f.skipped && f.mutations.length > 0);
