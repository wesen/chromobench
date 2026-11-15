// Links (contract 1.0, design §27, Decision D5): shared content in a document — a roll's media and stacks, a look,
// a preset. One mechanism, resolved first in compile: a linked medium becomes the plain medium (the shared fields with
// the frame's overrides), a link entry becomes the group it expands to (with the frame's overrides). Resolvers are
// registered per link kind: rolls and presets are data the host passes (LinkContext); looks are registered,
// versioned, pure look functions (design §31: compile-time lambdas, stored only by name and version).
//
//   defineLook({ name: 'warm-print', version: 1, label: 'Warm print', group: 'Print', stages: ['darkroom'],
//                params: { warmth: { type: 'number', unit: 'point', min: 0, max: 10, default: 4, doc: '…' } },
//                fn: (p) => ({ stacks: { darkroom: Coll.of([['warmth', layerEntry('filter', { logH: … })]]) } }) });
//   insertLink(doc, { look: 'warm-print', version: 1 }, { key: 'warm1', params: { warmth: 6 }, amount: 0.6 })
//     → [insert('stages.darkroom.stack', 'warm1-darkroom', { kind: 'link', ref, params, amount: 0.6, … })]
//   compile(doc, g, { links })   // the link expands to a group `warm1-darkroom` with child `warm1-darkroom--warmth`
//   bakeLink(doc, 'warm1-darkroom', ctx) → the mutations that replace it by that group (its source records the link)
//
// A look may touch several stages: its link appears once per stage (ids `<key>-<stage>`), the entries share
// `source.link = key` and one Amount (setLinkAmount). Amount is the stage law's amount (design D2): light scales the
// look's light and density, composite and repair mix it.
import {
  applyMutation, canonicalJSON, Coll, getPath, insert, isPlainObject, remove, set, unset, type Id, type Json, type JsonObject, type Mutation,
} from '@chromobench/values';
import {
  documentKind, isLinked, STAGE_NAMES, STAGES, type Document, type Entry, type EntryBlend, type FrameKind, type Group, type LinkEntry, type LinkRef,
  type Mask, type Params, type Provenance, type StageName, type Stages,
} from './document.ts';
import { ChromobenchError, diag, fail, type Diagnostic } from './errors.ts';
import type { FrameFacts } from './bindings.ts';
import { closest } from './registry.ts';
import { checkArgValue, type ArgSpec } from './spec.ts';
import type { Roll } from './roll.ts';

export type LinkKind = 'roll' | 'look' | 'preset';

// ---- presets: stored groups and masks --------------------------------------------------------------------------

export const PRESET_FORMAT = 'chromobench.preset';
/** 3: stacks of entries per stage and masks (contract 1.0); versions 1 and 2 named recipe or document paths. */
export const PRESET_VERSION = 3;

/** A preset (design §27): a look without parameters — stored entries per stage, and the masks they use. Data. */
export interface Preset {
  readonly format: typeof PRESET_FORMAT;
  readonly version: typeof PRESET_VERSION;
  /** unique in the library */
  readonly id: Id;
  readonly name: string;
  readonly group: string;
  readonly doc: string;
  readonly stacks: Readonly<Partial<Record<StageName, Coll<Entry>>>>;
  readonly masks: Coll<Mask>;
}

// ---- the context ---------------------------------------------------------------------------------------------------

/** What the host supplies to resolve links (compile options): the shared data, and what look functions may read. */
export interface LinkContext {
  rolls?: (id: Id) => Roll | undefined;
  presets?: (id: Id) => Preset | undefined;
  facts?: FrameFacts;
  /** The source's size in document pixels (compile passes it from the graph): look functions place masks with it. */
  size?: readonly [number, number];
}

// ---- look functions ------------------------------------------------------------------------------------------------

/** What a look function reads (design §31, compile time): its parameters, the frame's kind, facts and document. */
export interface LookInput {
  readonly kind: FrameKind;
  readonly facts: FrameFacts;
  /** The document as stored (links unresolved): a look may follow other settings (a neutral filter follows the lights). */
  readonly doc: Document;
  /** Document pixels of the source, when known (null: resolving without a graph or a size). */
  readonly size: readonly [number, number] | null;
}

/** What a look (or a preset) gives: entries per stage it touches, and the masks they use (ids local to the look). */
export interface LookOutput {
  readonly stacks: Readonly<Partial<Record<StageName, Coll<Entry>>>>;
  readonly masks?: Coll<Mask>;
}

export interface LookDef {
  /** slug, stable: documents store it */
  readonly name: string;
  readonly version: number;
  readonly label: string;
  /** where the library shows it */
  readonly group: string;
  readonly doc: string;
  /** ArgSpec-shaped parameters (checked like op arguments; the UI generates their controls) */
  readonly params: Readonly<Record<string, ArgSpec>>;
  /** the stages it gives entries for: one link entry per stage */
  readonly stages: readonly StageName[];
  /** the frames it applies to (default: both kinds) */
  readonly kinds?: readonly FrameKind[];
  /** Pure and deterministic: the same params and input give the same entries. */
  fn(params: Readonly<Record<string, Json>>, input: LookInput): LookOutput;
}

const LOOKS = new Map<string, LookDef>();
const lookKey = (name: string, version: number): string => `${name}@${version}`;

/** Registers a look function (name and version once; a new behaviour is a new version, so stored links keep theirs). */
export function defineLook(def: LookDef): LookDef {
  const key = lookKey(def.name, def.version);
  if (LOOKS.has(key)) fail('E_LINK', `look ${key} is already defined`, { hint: 'a changed look is a new version' });
  if (!/^[a-z0-9][a-z0-9-]*$/.test(def.name)) fail('E_LINK', `look name "${def.name}" must be a slug (a-z, 0-9, -)`);
  if (!def.stages.length || def.stages.some((s) => !STAGES[s] || STAGES[s].law === null)) {
    fail('E_LINK', `look ${key}: stages must be stages with a law`, { valid: STAGE_NAMES.filter((s) => STAGES[s].law !== null) });
  }
  const frozen = Object.freeze({ ...def, params: Object.freeze({ ...def.params }), stages: Object.freeze([...def.stages]) });
  LOOKS.set(key, frozen);
  return frozen;
}

/** A look by name and version; without a version, the newest. E_LINK with did-you-mean when unknown. */
export function getLook(name: string, version?: number): LookDef {
  const hit = version === undefined ? newest(name) : LOOKS.get(lookKey(name, version));
  if (hit) return hit;
  const names = [...new Set([...LOOKS.values()].map((l) => l.name))];
  const g = closest(name, names);
  return fail('E_LINK', `unknown look ${version === undefined ? name : lookKey(name, version)}`, { ...(g ? { hint: `did you mean ${g}?`, fix: g } : {}), valid: names });
}

const newest = (name: string): LookDef | undefined => [...LOOKS.values()].filter((l) => l.name === name).sort((a, b) => b.version - a.version)[0];

/** Every registered look, the newest version of each name, in registration order. */
export function allLooks(): LookDef[] {
  const seen = new Map<string, LookDef>();
  for (const l of LOOKS.values()) if (!seen.has(l.name) || seen.get(l.name)!.version < l.version) seen.set(l.name, l);
  return [...seen.values()];
}

/** A look's parameter values: defaults filled in, each checked like an op argument (E_ARG_RANGE, E_UNKNOWN_OPTION). */
export function lookParams(def: LookDef, given: Readonly<Record<string, unknown>> = {}): Record<string, Json> {
  const names = Object.keys(def.params);
  for (const k of Object.keys(given)) {
    if (!(k in def.params)) {
      const g = closest(k, names);
      fail('E_UNKNOWN_OPTION', `look ${def.name} has no parameter "${k}"`, { ...(g ? { hint: `did you mean ${g}?`, fix: g } : {}), valid: names });
    }
  }
  const out: Record<string, Json> = {};
  for (const [k, spec] of Object.entries(def.params)) out[k] = checkArgValue(spec, given[k] ?? spec.default, `${def.name}.${k}`).value as Json;
  return out;
}

/** Why a look does not apply to a frame of this kind, or null. */
export function lookSkip(def: LookDef, kind: FrameKind): Diagnostic | null {
  if (!def.kinds || def.kinds.includes(kind)) return null;
  const words: Record<FrameKind, string> = { 'negative-scan': 'a negative scan', 'digital-raw': 'a camera file' };
  return diag('E_KIND', `${def.label} needs ${def.kinds.map((k) => words[k]).join(' or ')}; this frame is ${words[kind]}`, { hint: `${def.label} is for ${def.kinds.map((k) => words[k]).join(' or ')}` });
}

// ---- resolvers -----------------------------------------------------------------------------------------------------

/** What the resolution of one link sees. */
export interface LinkScope {
  readonly doc: Document;
  readonly ctx: LinkContext;
}

export interface LinkResolver {
  kind: LinkKind;
  /** The (partial) medium the link gives a stage; the frame's overrides are applied on top. */
  medium?(ref: LinkRef, stage: StageName, scope: LinkScope): JsonObject | undefined;
  /** The entries (and masks) a link entry gives a stage (ids as the shared definition has them). */
  stack?(ref: LinkRef, stage: StageName, params: Params, scope: LinkScope): LookOutput | undefined;
}

const RESOLVERS = new Map<LinkKind, LinkResolver>();

export function defineLinkResolver(r: LinkResolver): void {
  RESOLVERS.set(r.kind, r);
}

export function linkKind(ref: LinkRef): LinkKind {
  const r = ref as unknown;
  if (isPlainObject(r)) {
    if (typeof r['roll'] === 'string') return 'roll';
    if (typeof r['look'] === 'string' && typeof r['version'] === 'number') return 'look';
    if (typeof r['preset'] === 'string') return 'preset';
  }
  return fail('E_LINK', `not a link reference: ${JSON.stringify(ref)}`, { valid: ['{roll}', '{look, version}', '{preset}'] });
}

/** "roll r1", "look warm-print@1", "preset p-sky" */
export function linkLabel(ref: LinkRef): string {
  return 'roll' in ref ? `roll ${ref.roll}` : 'look' in ref ? `look ${ref.look}@${ref.version}` : `preset ${ref.preset}`;
}

function resolver(ref: LinkRef): LinkResolver {
  const k = linkKind(ref);
  return RESOLVERS.get(k) ?? fail('E_LINK', `no resolver for ${k} links`);
}

/** Applies `overrides` (path → value) to a value, with the values mutations (paths through objects and Colls). */
function override<T>(value: T, overrides: Readonly<Record<string, Json>>, what: string): T {
  let doc = { value } as object;
  for (const [p, v] of Object.entries(overrides)) {
    try {
      doc = applyMutation(doc, set(`value.${p}`, v)).doc;
    } catch (e) {
      fail('E_LINK', `${what}: override ${p} does not apply (${e instanceof Error ? e.message : String(e)})`, { path: p });
    }
  }
  return (doc as { value: T }).value;
}

/** The plain medium of a linked medium: the shared fields, then the frame's overrides (top-level fields). */
export function resolveMedium(doc: Document, stage: StageName, ctx: LinkContext = {}): JsonObject {
  const m = doc.stages[stage]?.medium;
  if (!isLinked(m)) return (m ?? fail('E_DOCUMENT', `a ${documentKind(doc)} document has no ${stage} stage`)) as unknown as JsonObject;
  const base = resolver(m.link).medium?.(m.link, stage, { doc, ctx }) ?? fail('E_LINK', `${linkLabel(m.link)} gives the ${stage} stage no medium`, { path: `stages.${stage}.medium` });
  return { ...base, ...(m.overrides as JsonObject) };
}

/** Child ids of an expanded link are prefixed with the link entry's id, so they stay unique in the document. */
export const childId = (link: Id, id: Id): Id => `${link}--${id}`;

function prefixed(stack: Coll<Entry>, prefix: Id, masks: ReadonlySet<Id>): Coll<Entry> {
  return Coll.of(Coll.entries(stack).map(([id, e]) => {
    const mask = e.mask !== null && masks.has(e.mask) ? childId(prefix, e.mask) : e.mask;
    const out = e.kind === 'group' ? { ...e, mask, stack: prefixed(e.stack, prefix, masks) } : { ...e, mask };
    return [childId(prefix, id), out as Entry] as const;
  }));
}

/** The group a link entry expands to, and the masks it brings (ids prefixed with the link's id). */
export function expandLink(doc: Document, id: Id, e: LinkEntry, stage: StageName, ctx: LinkContext = {}): { group: Group; masks: [Id, Mask][] } {
  const out = resolver(e.ref).stack?.(e.ref, stage, e.params, { doc, ctx }) ?? fail('E_LINK', `${linkLabel(e.ref)} has no ${stage} entries`, { path: id });
  const own = out.stacks[stage] ?? Coll.empty<Entry>();
  const changed = override({ stack: own } as { stack: Coll<Entry> }, Object.fromEntries(Object.entries(e.overrides).map(([p, v]) => [`stack.${p}`, v])), `link ${id}`).stack;
  const lm = out.masks ?? Coll.empty<Mask>();
  const names = new Set(lm.order);
  const inner = resolveStack(doc, changed, stage, ctx, []);
  return {
    group: {
      kind: 'group', name: e.name, enabled: e.enabled, amount: e.amount, mask: e.mask, blend: e.blend,
      source: { ...e.source, link: (e.source['link'] as Json | undefined) ?? id, ref: e.ref as unknown as Json, params: e.params as unknown as Json },
      stack: prefixed(inner, id, names),
    },
    masks: Coll.entries(lm).map(([mid, m]) => [childId(id, mid), m] as [Id, Mask]),
  };
}

function resolveStack(doc: Document, stack: Coll<Entry>, stage: StageName, ctx: LinkContext, masks: [Id, Mask][]): Coll<Entry> {
  return Coll.map(stack, (e, id): Entry => {
    if (e.kind === 'link') {
      const x = expandLink(doc, id, e, stage, ctx);
      masks.push(...x.masks);
      return x.group;
    }
    if (e.kind === 'group') return { ...e, stack: resolveStack(doc, e.stack, stage, ctx, masks) };
    return e;
  });
}

const hasLinks = (stack: Coll<Entry>): boolean => Coll.values(stack).some((e) => e.kind === 'link' || (e.kind === 'group' && hasLinks(e.stack)));

/** Whether a document holds a link anywhere (a medium or an entry): it needs resolveLinks before a law sees it. */
export function hasAnyLink(doc: Document): boolean {
  return STAGE_NAMES.some((s) => {
    const st = doc.stages[s];
    return !!st && (isLinked(st.medium) || hasLinks(st.stack));
  });
}

/** Step 1 of compile (design §29): the document with every link resolved into plain media, stacks and masks. */
export function resolveLinks(doc: Document, ctx: LinkContext = {}): Document {
  if (!hasAnyLink(doc)) return doc;
  const stages: Record<string, unknown> = {};
  const masks: [Id, Mask][] = [];
  for (const s of STAGE_NAMES) {
    const st = doc.stages[s];
    if (!st) continue;
    stages[s] = {
      medium: isLinked(st.medium) ? resolveMedium(doc, s, ctx) : st.medium,
      stack: hasLinks(st.stack) ? resolveStack(doc, st.stack, s, ctx, masks) : st.stack,
    };
  }
  let lib = doc.masks;
  for (const [id, m] of masks) if (!Coll.has(lib, id)) lib = Coll.insert(lib, id, m);
  return { ...doc, stages: stages as unknown as Stages, masks: lib };
}

// ---- reading and writing through links -----------------------------------------------------------------------------

const MEDIUM = /^stages\.(\w+)\.medium\.([A-Za-z_]\w*)((?:\.[^.]+)*)$/;

/**
 * Where a medium field is stored. On a linked medium a field of the medium is a per-frame override
 * (`stages.scan.medium.stock` → `stages.scan.medium.overrides.stock`; a nested field writes into its top-level
 * field's override, which must exist); every other path is itself.
 */
export function storedPath(doc: Document, path: string): string {
  const m = MEDIUM.exec(path);
  if (!m) return path;
  const st = doc.stages[m[1] as StageName];
  if (!st || !isLinked(st.medium) || m[2] === 'link' || m[2] === 'overrides') return path;
  return `stages.${m[1]}.medium.overrides.${m[2]}${m[3]}`;
}

/** The mutations with every medium field path mapped to where it is stored (storedPath). */
export function storedMutations(doc: Document, ms: readonly Mutation[]): Mutation[] {
  return ms.map((m) => (m.op === 'set' && storedPath(doc, m.path) !== m.path ? { ...m, path: storedPath(doc, m.path) } : m));
}

/** The value of a document path as the compiler sees it: medium fields of linked media through the link. */
export function readField(doc: Document, path: string, ctx: LinkContext = {}): unknown {
  const m = MEDIUM.exec(path);
  const walk = (v: unknown, segs: readonly string[]): unknown => segs.reduce<unknown>((o, k) => (isPlainObject(o) ? o[k] : Array.isArray(o) ? o[Number(k)] : undefined), v);
  if (m && isLinked(doc.stages[m[1] as StageName]?.medium) && m[2] !== 'link' && m[2] !== 'overrides') {
    let med: JsonObject;
    try {
      med = resolveMedium(doc, m[1] as StageName, ctx);
    } catch {
      // without the shared data, only the frame's own overrides are known
      med = ((doc.stages[m[1] as StageName]!.medium as { overrides: JsonObject }).overrides);
    }
    return walk(med, [m[2]!, ...m[3]!.split('.').filter(Boolean)]);
  }
  return getPath(doc, path);
}

// ---- link entries: insert, siblings, amount, bake ------------------------------------------------------------------

/** The id of a look's link entry in one stage. */
export const linkId = (key: Id, stage: StageName): Id => `${key}-${stage}`;

export interface LinkInsert {
  /** the shared key of the look's entries (`warm1`): ids are `<key>-<stage>` */
  key: Id;
  params?: Readonly<Record<string, unknown>>;
  /** the stage law's amount (default 1); composite and repair stages take at most 1 */
  amount?: number;
  name?: string;
  mask?: Id | null;
  source?: Provenance;
  /** position in each stack (default: on top) */
  at?: number;
}

/** The stages a link reference gives entries for (a look's declared stages; a preset's stacks; a roll's stacks). */
export function linkStages(ref: LinkRef, ctx: LinkContext = {}): StageName[] {
  const k = linkKind(ref);
  if (k === 'look') return [...getLook((ref as { look: string }).look, (ref as { version: number }).version).stages];
  if (k === 'preset') {
    const p = ctx.presets?.((ref as { preset: Id }).preset) ?? fail('E_LINK', `unknown preset ${(ref as { preset: Id }).preset}`, { hint: 'pass LinkContext.presets' });
    return STAGE_NAMES.filter((s) => p.stacks[s] && STAGES[s].law !== null);
  }
  const r = ctx.rolls?.((ref as { roll: Id }).roll) ?? fail('E_LINK', `unknown roll ${(ref as { roll: Id }).roll}`, { hint: 'pass LinkContext.rolls' });
  return STAGE_NAMES.filter((s) => r.stacks[s] && STAGES[s].law !== null);
}

const linkName = (ref: LinkRef, ctx: LinkContext): string => {
  if ('look' in ref) return getLook(ref.look, ref.version).label;
  if ('preset' in ref) return ctx.presets?.(ref.preset)?.name ?? ref.preset;
  return ctx.rolls?.(ref.roll)?.label ?? ref.roll;
};

/**
 * The mutations that put a look, a preset or a roll's stacks into a document: one link entry per stage it touches
 * (that the document has), sharing `source.link = key` and one amount. A look's params are checked here.
 */
export function insertLink(doc: Document, ref: LinkRef, o: LinkInsert, ctx: LinkContext = {}): Mutation[] {
  const kind = documentKind(doc);
  let params: Params = {};
  if ('look' in ref) {
    const def = getLook(ref.look, ref.version);
    const skip = lookSkip(def, kind);
    if (skip) throw new ChromobenchError(skip);
    params = lookParams(def, o.params ?? {});
  }
  const stages = linkStages(ref, ctx).filter((s) => doc.stages[s]);
  if (!stages.length) fail('E_LINK', `${linkLabel(ref)} touches no stage a ${kind} document has`);
  const source: Provenance = { kind: linkKind(ref), ...(o.source ?? {}), link: o.key };
  const name = o.name ?? linkName(ref, ctx);
  return stages.map((s) => {
    const amount = clampAmount(s, o.amount ?? 1);
    const e: LinkEntry = { kind: 'link', ref, params, overrides: {}, name, enabled: true, amount, mask: o.mask ?? null, blend: 'pass' as EntryBlend, source };
    return insert(`stages.${s}.stack`, linkId(o.key, s), e, o.at ?? doc.stages[s]!.stack.order.length);
  });
}

/** A law's amount range applied to an amount (the UI's 0–200 % is time and density in the darkroom, opacity elsewhere). */
export function clampAmount(stage: StageName, a: number): number {
  return STAGES[stage].law === 'light' ? Math.max(0, Math.min(16, a)) : Math.max(0, Math.min(1, a));
}

export interface PlacedLink {
  id: Id;
  stage: StageName;
  entry: LinkEntry;
}

/** Every link entry of a document (any depth), in stage order. */
export function linksOf(doc: Document): PlacedLink[] {
  const out: PlacedLink[] = [];
  const walk = (stack: Coll<Entry>, stage: StageName): void => {
    for (const [id, e] of Coll.entries(stack)) {
      if (e.kind === 'link') out.push({ id, stage, entry: e });
      else if (e.kind === 'group') walk(e.stack, stage);
    }
  };
  for (const s of STAGE_NAMES) if (doc.stages[s]) walk(doc.stages[s]!.stack, s);
  return out;
}

/** The shared key of a link entry (its `source.link`, else its id). */
export const keyOf = (l: PlacedLink): Id => (typeof l.entry.source['link'] === 'string' ? (l.entry.source['link'] as Id) : l.id);

/** The link entries that share a key (one per stage a look touches). */
export function linkSiblings(doc: Document, key: Id): PlacedLink[] {
  return linksOf(doc).filter((l) => keyOf(l) === key || l.id === key);
}

/** One Amount for a look over every stage it touches (each clamped to its law's range). */
export function setLinkAmount(doc: Document, key: Id, amount: number): Mutation[] {
  return linkSiblings(doc, key).map((l) => set(`${l.id}.amount`, clampAmount(l.stage, amount)));
}

/** New parameters for a look's link entries (checked; one set per stage). */
export function setLinkParams(doc: Document, key: Id, given: Readonly<Record<string, unknown>>): Mutation[] {
  return linkSiblings(doc, key).map((l) => {
    const ref = l.entry.ref;
    const params = 'look' in ref ? lookParams(getLook(ref.look, ref.version), { ...l.entry.params, ...given }) : l.entry.params;
    return set(`${l.id}.params`, params);
  });
}

/** The mutations that take a look out (every stage). */
export function removeLink(doc: Document, key: Id): Mutation[] {
  return linkSiblings(doc, key).map((l) => remove(l.id));
}

/**
 * "Bake" (design §27): the mutations that replace a link (every stage of its key) by the plain groups it expands to,
 * their source recording the link, and insert the masks they use.
 */
export function bakeLink(doc: Document, key: Id, ctx: LinkContext = {}): Mutation[] {
  const sibs = linkSiblings(doc, key);
  if (!sibs.length) fail('E_LINK', `no link ${key} in the document`, { valid: [...new Set(linksOf(doc).map(keyOf))] });
  const out: Mutation[] = [];
  const masks = new Map<Id, Mask>();
  for (const l of sibs) {
    const x = expandLink(doc, l.id, l.entry, l.stage, ctx);
    for (const [id, m] of x.masks) masks.set(id, m);
    out.push(set(l.id, { ...x.group, source: { ...x.group.source, kind: 'baked' } }));
  }
  const ins = [...masks].filter(([id]) => !Coll.has(doc.masks, id)).map(([id, m]) => insert('masks', id, m));
  return [...ins, ...out];
}

// ---- linked media: link, unlink, divergence ------------------------------------------------------------------------

/**
 * The mutation that links a stage's medium to shared fields (a roll's): the frame keeps as overrides every field it
 * has that the link does not give, and every shared field where its value differs (divergence from the start). A
 * medium linked elsewhere is relinked from its resolved value (`ctx` resolves the old link).
 */
export function linkMedium(doc: Document, stage: StageName, ref: LinkRef, shared: JsonObject, ctx: LinkContext = {}): Mutation {
  const m = doc.stages[stage]?.medium ?? fail('E_DOCUMENT', `a ${documentKind(doc)} document has no ${stage} stage`);
  const own = (isLinked(m) ? resolveMedium(doc, stage, ctx) : m) as unknown as JsonObject;
  const overrides: Record<string, Json> = {};
  for (const [k, v] of Object.entries(own)) if (!(k in shared) || canonicalJSON(shared[k]) !== canonicalJSON(v)) overrides[k] = v;
  return set(`stages.${stage}.medium`, { link: ref, overrides });
}

/** The mutation that makes a linked medium plain again (its resolved value): a medium's bake. */
export function unlinkMedium(doc: Document, stage: StageName, ctx: LinkContext = {}): Mutation {
  return set(`stages.${stage}.medium`, resolveMedium(doc, stage, ctx));
}

/** The fields where a linked medium departs from what its link gives (divergence = the overrides of shared fields). */
export function divergence(doc: Document, stage: StageName, shared: JsonObject): string[] {
  const m = doc.stages[stage]?.medium;
  if (!isLinked(m)) return [];
  return Object.keys(m.overrides).filter((k) => k in shared);
}

/** The mutation that drops a frame's override of a linked medium's field (it follows the link again). */
export function followLink(doc: Document, stage: StageName, field: string): Mutation | null {
  const m = doc.stages[stage]?.medium;
  return isLinked(m) && field in m.overrides ? unset(`stages.${stage}.medium.overrides.${field}`) : null;
}

// ---- the resolvers -------------------------------------------------------------------------------------------------

const rollOf = (ref: LinkRef, ctx: LinkContext): Roll =>
  ctx.rolls?.((ref as { roll: Id }).roll) ?? fail('E_LINK', `unknown roll ${(ref as { roll: Id }).roll}`, { hint: 'pass CompileOptions.links.rolls' });

// Rolls (CHB-020): a roll record holds partial media and stacks; a frame's media and link entries name it.
defineLinkResolver({
  kind: 'roll',
  medium: (ref, stage, { ctx }) => rollOf(ref, ctx).media[stage],
  stack: (ref, stage, _params, { ctx }) => {
    const s = rollOf(ref, ctx).stacks[stage];
    return s ? { stacks: { [stage]: s } } : undefined;
  },
});

// Presets: stored entries and masks (looks without parameters).
defineLinkResolver({
  kind: 'preset',
  stack: (ref, _stage, _params, { ctx }) => {
    const id = (ref as { preset: Id }).preset;
    const p = ctx.presets?.(id) ?? fail('E_LINK', `unknown preset ${id}`, { hint: 'pass CompileOptions.links.presets' });
    return { stacks: p.stacks, masks: p.masks };
  },
});

// Looks: the registered look function, called with the link's params (defaults filled in).
defineLinkResolver({
  kind: 'look',
  stack: (ref, _stage, params, { doc, ctx }) => {
    const r = ref as { look: string; version: number };
    const def = getLook(r.look, r.version);
    const kind = documentKind(doc);
    const skip = lookSkip(def, kind);
    if (skip) throw new ChromobenchError({ ...skip, code: 'E_LINK' });
    return def.fn(lookParams(def, params), { kind, facts: ctx.facts ?? {}, doc, size: ctx.size ?? null });
  },
});

// ---- presets: validation and making ---------------------------------------------------------------------------------

/** Structural checks of a preset record (entries are checked when a document resolves it). Empty = valid. */
export function validatePreset(x: unknown): Diagnostic[] {
  if (!isPlainObject(x)) return [diag('E_FORMAT', 'a preset is a JSON object')];
  const out: Diagnostic[] = [];
  if (x['format'] !== PRESET_FORMAT) out.push(diag('E_FORMAT', `not a chromobench preset (format ${JSON.stringify(x['format'])})`, { fix: PRESET_FORMAT }));
  const v = x['version'];
  if (typeof v !== 'number') out.push(diag('E_FORMAT', 'preset version missing'));
  else if (v > PRESET_VERSION) out.push(diag('E_FORMAT', `preset version ${v} is newer than this app (${PRESET_VERSION})`, { hint: 'update chromobench to read it' }));
  else if (v < PRESET_VERSION) out.push(diag('E_FORMAT', `preset version ${v} names recipe or document paths, which presets no longer hold`, { hint: 'make the preset again from a frame (Save Frame as Preset)' }));
  if (typeof x['id'] !== 'string' || !/^[A-Za-z0-9_-]+$/.test(x['id'])) out.push(diag('E_FORMAT', 'preset id must be an id (letters, digits, _ and -)'));
  if (typeof x['name'] !== 'string' || !x['name']) out.push(diag('E_FORMAT', 'preset name missing'));
  const st = x['stacks'];
  if (!isPlainObject(st)) out.push(diag('E_FORMAT', 'preset stacks must be an object keyed by stage'));
  else for (const [s, c] of Object.entries(st)) {
    if (!STAGE_NAMES.includes(s as StageName) || STAGES[s as StageName].law === null) out.push(diag('E_FORMAT', `preset stacks: ${s} is not a stage with entries`, { valid: STAGE_NAMES.filter((n) => STAGES[n].law !== null) }));
    else if (Coll.problem(c)) out.push(diag('E_FORMAT', `preset stacks.${s}: ${Coll.problem(c)}`));
  }
  if (Coll.problem(x['masks'])) out.push(diag('E_FORMAT', `preset masks: ${Coll.problem(x['masks'])}`));
  return out;
}

/** A preset from entries per stage (and the masks of the document they use), e.g. "Save Frame as Preset". */
export function makePreset(id: Id, name: string, stacks: Partial<Record<StageName, Coll<Entry>>>, masks: Coll<Mask> = Coll.empty(), o: { group?: string; doc?: string } = {}): Preset {
  const used = new Set<Id>();
  const walk = (c: Coll<Entry>): void => {
    for (const e of Coll.values(c)) {
      if (e.mask) used.add(e.mask);
      if (e.kind === 'group') walk(e.stack);
    }
  };
  for (const c of Object.values(stacks)) if (c) walk(c);
  const keep = Coll.of(Coll.entries(masks).filter(([mid]) => used.has(mid)));
  return { format: PRESET_FORMAT, version: PRESET_VERSION, id, name, group: o.group ?? 'Mine', doc: o.doc ?? '', stacks, masks: keep };
}

/** A look at chosen parameters, resolved on a frame, as a preset (data, safe to share): "Save Look as Preset". */
export function lookAsPreset(doc: Document, ref: { look: string; version: number }, given: Readonly<Record<string, unknown>>, o: { id: Id; name?: string }, ctx: LinkContext = {}): Preset {
  const def = getLook(ref.look, ref.version);
  const kind = documentKind(doc);
  const skip = lookSkip(def, kind);
  if (skip) throw new ChromobenchError(skip);
  const params = lookParams(def, given);
  const out = def.fn(params, { kind, facts: ctx.facts ?? {}, doc, size: ctx.size ?? null });
  const shown = Object.entries(params).map(([k, v]) => `${k} ${String(v)}`).join(', ');
  return { format: PRESET_FORMAT, version: PRESET_VERSION, id: o.id, name: o.name ?? (shown ? `${def.label} (${shown})` : def.label), group: def.group, doc: def.doc, stacks: out.stacks, masks: out.masks ?? Coll.empty() };
}
