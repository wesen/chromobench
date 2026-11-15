// cb.kits.looks: the kit's state (looks, looksView), its readers and the agent-batch pass (split from kit.ts, CHB-032;
// CHB-037 P7: looks are links, presets are the contract's Preset records).
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Document, Preset } from '@chromobench/contract';
import { strip } from '@chromobench/shell';
import { sel } from '../../../src/sel.ts';
import { docAt } from './engine/paths.ts';
import { aggregate, diffDocs, type AggregateEntry, type DiffEntry } from './engine/diff.ts';
import { defaultGroups } from './engine/groups.ts';
import type { LookPlan } from './engine/looks.ts';

export type CompareSource = 'before' | 'defaults' | { snapshot: string } | { frame: string } | { look: string; params?: Record<string, unknown>; amount?: number } | { doc: Document };

/** How a sync carries settings: copies (each frame on its own afterwards) or one shared preset every frame links. */
export type SyncMode = 'copy' | 'link';

export interface LooksDoc {
  /** the photographer's presets (contract Preset records: stored entries and masks) */
  presets: Record<string, Preset>;
  favourites: string[];
  /** presets imported with problems (unknown ops): shown "needs review" */
  review: Record<string, string[]>;
}
export interface LooksView {
  picked: string | null;
  /** parameter values per look id */
  params: Record<string, Record<string, unknown>>;
  /** Amount in percent, 0–200 (the stage law's amount: light and density in the darkroom, at most 100 % opacity on the print) */
  amount: number;
  /** the picked look previewed on the main viewer (nothing committed) */
  preview: boolean;
  mode: 'print' | 'survey';
  survey: 'set' | 'ring';
  surveySet: string[];
  /** library filter */
  group: string | null;
  /** sync groups a copy keeps */
  groups: string[];
  /** copy values, or link one shared preset */
  syncMode: SyncMode;
  compare: CompareSource;
  /** a planned apply to the roll or the library, waiting for confirmation */
  pending: LookPlan | null;
  off: string[];
  stale: { frame: string; code: string; message: string }[];
  /** a copy: the values (path, value) and the looks (the same links) of a frame, in the chosen groups */
  clipboard: { from: string; values: { path: string; value: unknown }[]; links: { ref: unknown; params: unknown; amount: number; name: string; key: string }[]; groups: string[]; lines: string[] } | null;
  /** agent batches: frames unticked, frames refused as stale */
  batchOff: Record<string, string[]>;
  batchStale: Record<string, { frame: string; code: string; message: string }[]>;
}
export const LOOKS_STATE: { looks: LooksDoc; looksView: LooksView } = {
  looks: { presets: {}, favourites: [], review: {} },
  looksView: {
    picked: null, params: {}, amount: 100, preview: true, mode: 'print', survey: 'set', surveySet: [], group: null, groups: defaultGroups(), syncMode: 'copy', compare: 'before',
    pending: null, off: [], stale: [], clipboard: null, batchOff: {}, batchStale: {},
  },
};

export const plain = <T>(v: T): T => (v === undefined || v === null ? v : (JSON.parse(JSON.stringify(v)) as T));

// ── state readers (also used by the DOM half) ──
export const looksView = (s: any): LooksView => ({ ...LOOKS_STATE.looksView, ...(s?.looksView ?? {}) });
export const amountOf = (s: any): number => Number(looksView(s).amount ?? 100) / 100;

/** an agent batch: pending proposals of the log sharing a batch id, coalesced (approval scope): one card */
export interface AgentBatch {
  batch: string;
  why: string;
  frames: { frame: string; tx: string; seq: number; doc: Document | null; diff: DiffEntry[] }[];
  aggregate: AggregateEntry[];
}
/** The approval-scope pass over the published proposals (ui.log): one entry per batch id. */
export function agentBatches(s: any): AgentBatch[] {
  const by = new Map<string, AgentBatch['frames']>();
  const why = new Map<string, string>();
  for (const f of Object.keys(s?.ui?.log?.proposals ?? {})) {
    for (const p of sel.proposals(s, f)) {
      if (!p.batch) continue;
      const d = docAt(s, f);
      by.set(p.batch, [...(by.get(p.batch) ?? []), { frame: f, tx: p.tx, seq: p.seq, doc: p.doc, diff: d && p.doc ? diffDocs(d, strip(p.doc)) : [] }]);
      if (!why.has(p.batch)) why.set(p.batch, p.why ?? p.label);
    }
  }
  return [...by].map(([batch, frames]) => ({ batch, why: why.get(batch) ?? batch, frames, aggregate: aggregate(frames.map((f) => f.diff)) }));
}
