// Looks as links (CHB-037 P7, design §27, D2, D5). The library is the contract's registered look functions plus the
// photographer's presets (data in `looks.presets`, looks without parameters) and sweeps (a look at fixed params: the
// ring-around). Applying one to a frame inserts its link entries (one per stage it touches, one key, one Amount: the
// stage law's amount) or, when the frame already holds that look, sets its params and Amount: re-applying adjusts,
// it never stacks a second copy. The link expands at compile, so the photographer can fade, mask, disable, bake or
// remove it as one unit, and one undo takes it off.
//
//   const item = lookItem('warm-print')                         // a registered look
//   const p = planLook(item, { warmth: 6 }, [{ frame, doc }], { amount: 0.6, links })
//   p.frames[0].mutations → [insert('stages.darkroom.stack', 'warm-print1-darkroom', { kind: 'link', … amount: 0.6 })]
import { Coll, type Id, type Json, type Mutation } from '@chromobench/values';
import {
  allLooks, ChromobenchError, documentKind, edit, expandLink, getLook, insertLink, keyOf, lookParams, lookSkip, linksOf, resolveLinks, setLinkAmount,
  setLinkParams, toDiagnostic, type ArgSpec, type Diagnostic, type Document, type Entry, type FrameKind, type Group, type LinkContext, type LinkRef,
  type Preset, type StageName,
} from '@chromobench/contract';
import { lookLines } from './describe.ts';

/** One choice of the library: a registered look, a preset, or a look at fixed params (a sweep's tile). */
export interface LookItem {
  /** unique in the library: the look's name, `preset:<id>`, or a sweep's id */
  readonly id: string;
  readonly name: string;
  readonly group: string;
  readonly doc: string;
  readonly ref: LinkRef;
  /** the parameters the photographer can move (none for a preset or a sweep tile) */
  readonly params: Readonly<Record<string, ArgSpec>>;
  /** fixed parameter values (a sweep's tile) */
  readonly fixed?: Readonly<Record<string, Json>>;
  readonly kinds?: readonly FrameKind[];
  readonly origin: 'look' | 'preset' | 'sweep';
}

export const isLookItem = (x: unknown): x is LookItem => !!x && typeof x === 'object' && 'ref' in x && 'origin' in x && 'id' in x;

/** The library's item of a registered look (the newest version). */
export function lookItem(name: string): LookItem {
  const d = getLook(name);
  return Object.freeze({ id: d.name, name: d.label, group: d.group, doc: d.doc, ref: { look: d.name, version: d.version }, params: d.params, ...(d.kinds ? { kinds: d.kinds } : {}), origin: 'look' as const });
}

/** The library's item of a preset. */
export function presetItem(p: Preset): LookItem {
  return Object.freeze({ id: `preset:${p.id}`, name: p.name, group: p.group, doc: p.doc, ref: { preset: p.id }, params: {}, origin: 'preset' as const });
}

/** Every registered look (but sweep-only ones) and the presets, in library order. */
export function lookItems(presets: Readonly<Record<string, Preset>> = {}): LookItem[] {
  return [...allLooks().filter((d) => d.group !== 'Sweep').map((d) => lookItem(d.name)), ...Object.values(presets).map(presetItem)];
}

/** "warm-print", "preset p-sky": what a key of a new link starts with. */
const slugOf = (it: LookItem): string => ('look' in it.ref ? it.ref.look : 'preset' in it.ref ? it.ref.preset : 'roll').replace(/[^A-Za-z0-9_-]+/g, '-');

/** A fresh key for a look's links in a document: the look's slug plus the smallest free counter. */
export function freshKey(doc: Document, it: LookItem): Id {
  const used = new Set(linksOf(doc).map(keyOf));
  const base = slugOf(it);
  let n = 1;
  while (used.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

const sameRef = (a: LinkRef, b: LinkRef): boolean =>
  ('look' in a && 'look' in b && a.look === b.look) || ('preset' in a && 'preset' in b && a.preset === b.preset) || ('roll' in a && 'roll' in b && a.roll === b.roll);

/** The key of the frame's link of this look (any version), or null. */
export function appliedKey(doc: Document, it: LookItem): Id | null {
  const l = linksOf(doc).find((x) => sameRef(x.entry.ref, it.ref));
  return l ? keyOf(l) : null;
}

/** The parameter values of an item: its fixed ones, the given ones, the look's defaults; checked. */
export function itemParams(it: LookItem, given: Readonly<Record<string, unknown>> = {}): Record<string, Json> {
  if (!('look' in it.ref)) return {};
  return lookParams(getLook(it.ref.look, it.ref.version), { ...given, ...(it.fixed ?? {}) });
}

/** Why an item does not apply to a frame of this kind (a look for scans on a camera file), or null. */
export function itemSkip(it: LookItem, kind: FrameKind): Diagnostic | null {
  return 'look' in it.ref ? lookSkip(getLook(it.ref.look, it.ref.version), kind) : null;
}

/**
 * The mutations that give a frame this look at these params and Amount: a fresh link (inserted on top of each stack
 * it touches), or the frame's existing link of the look adjusted (params and Amount; nothing when they are equal).
 */
export function applyMutations(doc: Document, it: LookItem, params: Readonly<Record<string, unknown>>, amount: number, ctx: LinkContext = {}, o: { key?: Id; source?: Record<string, Json> } = {}): Mutation[] {
  const p = itemParams(it, params);
  const key = appliedKey(doc, it);
  if (key) {
    const ms = [...('look' in it.ref ? setLinkParams(doc, key, p) : []), ...setLinkAmount(doc, key, amount)];
    return ms.filter((m) => m.op !== 'set' || JSON.stringify(readSet(doc, m.path)) !== JSON.stringify(m.value));
  }
  return insertLink(doc, it.ref, { key: o.key ?? freshKey(doc, it), params: p, amount, name: it.name, source: { kind: it.origin === 'preset' ? 'preset' : 'look', look: it.id, ...(o.source ?? {}) } }, ctx);
}
const readSet = (doc: Document, path: string): unknown => {
  const [id, field] = path.split('.');
  const l = linksOf(doc).find((x) => x.id === id);
  return l ? (l.entry as unknown as Record<string, unknown>)[field!] : undefined;
};

/** The document with the look applied (previews, tiles, what-ifs), or null when it does not apply. */
export function withLook(doc: Document, it: LookItem, params: Readonly<Record<string, unknown>>, amount: number, ctx: LinkContext = {}): Document | null {
  if (itemSkip(it, documentKind(doc))) return null;
  try {
    const ms = applyMutations(doc, it, params, amount, ctx);
    return ms.length ? edit(doc, ms).doc : doc;
  } catch {
    return null;
  }
}

/** The groups a frame's link of a key expands to, per stage (what the look does to this frame). */
export function expansionOf(doc: Document, key: Id, ctx: LinkContext = {}): { stage: StageName; group: Group }[] {
  const out: { stage: StageName; group: Group }[] = [];
  for (const l of linksOf(doc)) {
    if (keyOf(l) !== key) continue;
    out.push({ stage: l.stage, group: expandLink(doc, l.id, l.entry, l.stage, ctx).group });
  }
  return out;
}

// ---- plans --------------------------------------------------------------------------------------------------------

export const LOOK_TX = 'look:';
let seq = 0;
export const newBatchId = (id: string): string => `${LOOK_TX}${id.replace(/[^A-Za-z0-9_-]+/g, '-')}:${Date.now().toString(36)}${(++seq).toString(36)}`;

export interface PlanFrame {
  frame: string;
  mutations: Mutation[];
  /** what the look does to the frame, in darkroom words ("filter R −1.2 pt, B +1.2 pt") */
  diff: string[];
  /** the frame is left alone: its kind, or a bad parameter */
  skipped?: Diagnostic;
}

export interface LookPlan {
  /** the batch id: every transaction it commits carries it (one step of the log) */
  id: string;
  /** "Look: warm print at 60 %" */
  label: string;
  why: string;
  look: { id: string; name: string; params: Record<string, Json>; amount: number };
  frames: PlanFrame[];
  by: 'user' | 'agent';
  /** the frames' lines merged ("filter R −1.2 pt (5 frames)") */
  aggregate: { text: string; frames: number }[];
}

export const amountLabel = (k: number): string => `${Math.round(k * 100)} %`;
export const planLabel = (name: string, k: number): string => `Look: ${name}${Math.abs(k - 1) < 1e-9 ? '' : ` at ${amountLabel(k)}`}`;

export interface PlanOptions {
  amount?: number;
  links?: LinkContext;
  id?: string;
  by?: 'user' | 'agent';
  why?: string;
  /** skip the lines (tiles need only the mutations) */
  noDiff?: boolean;
}

/** One frame of a plan: the mutations, what they do, or why the frame is skipped. */
export function planFrame(it: LookItem, params: Readonly<Record<string, unknown>>, frame: string, doc: Document, o: PlanOptions = {}): PlanFrame {
  const k = o.amount ?? 1;
  const ctx = o.links ?? {};
  const skip = itemSkip(it, documentKind(doc));
  if (skip) return { frame, mutations: [], diff: [], skipped: skip };
  try {
    const mutations = applyMutations(doc, it, params, k, ctx);
    if (o.noDiff || !mutations.length) return { frame, mutations, diff: [] };
    const after = edit(doc, mutations).doc;
    const key = appliedKey(after, it)!;
    return { frame, mutations, diff: lookLines(after, key, ctx) };
  } catch (err) {
    return { frame, mutations: [], diff: [], skipped: toDiagnostic(err) };
  }
}

/** The plan for N frames: one batch id, one label, per-frame mutations against each frame's own document. */
export function planLook(it: LookItem, params: Readonly<Record<string, unknown>>, frames: readonly { frame: string; doc: Document; links?: LinkContext }[], o: PlanOptions = {}): LookPlan {
  const k = o.amount ?? 1;
  const p = (() => {
    try {
      return itemParams(it, params);
    } catch (e) {
      throw e instanceof ChromobenchError ? e : new ChromobenchError(toDiagnostic(e));
    }
  })();
  const out = frames.map((f) => planFrame(it, p, f.frame, f.doc, { ...o, ...(f.links ? { links: f.links } : {}) }));
  const label = planLabel(it.name, k);
  const counts = new Map<string, number>();
  for (const f of out) if (!f.skipped) for (const t of f.diff) counts.set(t, (counts.get(t) ?? 0) + 1);
  return {
    id: o.id ?? newBatchId(it.id), label, why: o.why ?? label,
    look: { id: it.id, name: it.name, params: p, amount: k },
    frames: out, by: o.by ?? 'user',
    aggregate: [...counts].map(([text, n]) => ({ text, frames: n })),
  };
}

/** Frames of a plan that would change (not skipped, at least one mutation). */
export const changing = (p: LookPlan): PlanFrame[] => p.frames.filter((f) => !f.skipped && f.mutations.length > 0);

/** "unedited": nothing in effect on the frame but automatic edits (the first print, ingest, the roll's link). */
export const isUnedited = (log: { inEffect(doc: string): readonly { tx: { by: string } }[] }, frame: string): boolean => log.inEffect(frame).every((e) => e.tx.by === 'auto');

/** The stacks a frame's links and layers give a preset (Save Frame as Preset): its entries but the main exposure and
 *  the printer lights (each frame's own), links baked to their groups. */
export function frameStacks(doc: Document, stages: readonly StageName[], keep: (id: Id, e: Entry, stage: StageName) => boolean, ctx: LinkContext = {}): Partial<Record<StageName, Coll<Entry>>> {
  const r = resolveLinks(doc, ctx);
  const out: Partial<Record<StageName, Coll<Entry>>> = {};
  for (const s of stages) {
    const st = r.stages[s];
    if (!st) continue;
    const c = Coll.of(Coll.entries(st.stack).filter(([id, e]) => id !== 'main' && id !== 'lights' && keep(id, e, s)));
    if (c.order.length) out[s] = c;
  }
  return out;
}
