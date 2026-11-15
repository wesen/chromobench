// The look plan (guide §6; CHB-037): a look at an Amount on N frames is, per frame, the mutations the Amount pass
// produced against that frame's own document (with the values they replace, for the staleness check), its diff, or
// why it was skipped. The same data drives the tile captions, the Amount line, the confirm card, the agent's
// approval card and the agent's receipt. Committing it is the values batch builder's job (`plan` in the looks
// model): one batch over the frames, one step of the document log.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { canonicalJSON, type Log, type Mutation } from '@chromobench/values';
import { edit, toDiagnostic, type Diagnostic, type Document } from '@chromobench/contract';
import { LIGHTS_PATH, read, TIME_PATH, withoutInert } from '../../../../src/model/doc.ts';
import { amountPass, type AmountOptions } from './amount.ts';
import { aggregate, diffDocs, type AggregateEntry, type DiffEntry } from './diff.ts';
import { inGroups, SYNC_GROUPS, type SyncGroups } from './groups.ts';
import { kitDiag, lookFrame, resolveLook, type AmountBase, type Look, type PresetEntry } from './look.ts';

export const LOOK_TX = 'look:';

export interface PlanFrame {
  frame: string;
  mutations: Mutation[];
  /** the value each set replaces: a frame whose value moved since planning is stale at approval */
  expect: Record<string, unknown>;
  diff: DiffEntry[];
  /** CB-L120 and silent-clamp notes; the frame is still applied */
  warnings: Diagnostic[];
  /** the frame is left alone: requires, a range diagnostic (fix = the clamped value), a path error */
  skipped?: Diagnostic;
}
export interface LookPlan {
  /** the batch id: every transaction it commits carries it (one step of the log) */
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
export const BALANCE_PATHS = [LIGHTS_PATH, TIME_PATH];

export interface PlanOptions extends Partial<AmountOptions> {
  /** batch id (default: a fresh one) */
  id?: string;
  /** keep only entries of these sync groups (null: all) */
  groups?: readonly string[] | null;
  syncGroups?: SyncGroups;
  by?: 'user' | 'agent';
  why?: string;
  /** skip the diff (tiles and previews need only the mutations; the diff walk is most of the cost) */
  noDiff?: boolean;
  /** the frames that belong to a roll (CB-L120: an absolute set of the balance's paths there) */
  onRoll?: (frame: string) => boolean;
}

let seq = 0;
export const newBatchId = (lookId: string): string => `${LOOK_TX}${lookId}:${Date.now().toString(36)}${(++seq).toString(36)}`;

/** The mutations of a look at Amount k on one frame, or why it is skipped. */
export function planFrame(l: Look, params: Record<string, unknown>, frame: string, doc: Document, o: PlanOptions = {}): PlanFrame {
  const k = o.amount ?? 1;
  let entries: PresetEntry[];
  try {
    const r = resolveLook(l, lookFrame(frame, doc), params);
    if (r.skip) return { frame, mutations: [], expect: {}, diff: [], warnings: [], skipped: r.skip };
    entries = o.groups ? r.entries.filter((e) => inGroups(e.path, o.groups!, o.syncGroups ?? SYNC_GROUPS, doc)) : r.entries;
    const layers = o.groups && !o.groups.includes('Dodge and burn') ? r.layers.filter((x) => x.op === 'preflash' && o.groups!.includes('Contrast')) : r.layers;
    const res = amountPass({ ...r, entries, layers }, doc, { amount: k, ...(o.from ? { from: o.from } : {}), ...(o.over ? { over: o.over } : {}) });
    if (res.diags.length) return { frame, mutations: [], expect: {}, diff: [], warnings: [], skipped: res.diags[0]! };
    const warnings: Diagnostic[] = res.notes.map((n) => kitDiag('CB-L111', n));
    if (o.onRoll?.(frame)) {
      for (const e of entries)
        if ('set' in e && BALANCE_PATHS.includes(e.path))
          warnings.push(kitDiag('CB-L120', `${l.name} sets ${e.path} absolutely on a balanced roll`, { path: e.path, hint: 'apply as offsets (add entries) to keep the roll balance', fix: `{ path: '${e.path}', add: … }` }));
    }
    // a normalised document takes no time or aperture: their exposure goes on the printer lights (CHB-031 srvr)
    const mutations = withoutInert(doc, res.mutations);
    const expect: Record<string, unknown> = {};
    for (const m of mutations) if (m.op === 'set') expect[m.path] = res.expect[m.path] ?? JSON.parse(JSON.stringify(read(doc, m.path) ?? null));
    const after = previewDoc(doc, mutations);
    if (o.noDiff) return { frame, mutations, expect, diff: [], warnings };
    return { frame, mutations, expect, diff: diffDocs(doc, after, o.syncGroups ? { groups: o.syncGroups } : {}), warnings };
  } catch (err) {
    return { frame, mutations: [], expect: {}, diff: [], warnings: [], skipped: toDiagnostic(err) };
  }
}

/** The plan for N frames: one batch id, one label, per-frame mutations against each frame's own document. */
export function planLook(l: Look, params: Record<string, unknown>, frames: readonly { frame: string; doc: Document }[], o: PlanOptions = {}): LookPlan {
  const k = o.amount ?? 1;
  const out = frames.map((f) => planFrame(l, params, f.frame, f.doc, o));
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

/** The document a frame would have with the mutations applied (previews, tiles), under the contract's rules. */
export function previewDoc(d: Document, ms: readonly Mutation[]): Document {
  return ms.length ? edit(d, ms).doc : d;
}

/** "unedited": nothing in effect on the frame but automatic edits (the first print, ingest; guide §6.2) */
export const isUnedited = (log: Pick<Log, 'inEffect'>, frame: string): boolean => log.inEffect(frame).every((e) => e.tx.by === 'auto');

/** Frames of a plan that would change (not skipped, at least one mutation). */
export const changing = (p: LookPlan): PlanFrame[] => p.frames.filter((f) => !f.skipped && f.mutations.length > 0);

/** The paths of a planned frame whose value moved since planning (E_STALE at approval). */
export function movedSince(f: PlanFrame, now: Document): string[] {
  return Object.entries(f.expect).filter(([p, v]) => canonicalJSON(read(now, p) ?? null) !== canonicalJSON(v ?? null)).map(([p]) => p);
}
