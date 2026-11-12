// cb.kits.looks: the kit's state (looks, looksView), its readers and the agent-batch pass (split from kit.ts, CHB-032).
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FrameRecipe } from '@chromobench/contract';
import { aggregate, diffRecipes, type AggregateEntry, type DiffEntry } from './engine/diff.ts';
import { defaultGroups } from './engine/groups.ts';
import { type AmountBase, type Preset, type PresetEntry } from './engine/look.ts';
import type { ApplyPlan } from './engine/plan.ts';

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

export const plain = <T>(v: T): T => (v === undefined || v === null ? v : (JSON.parse(JSON.stringify(v)) as T));

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
