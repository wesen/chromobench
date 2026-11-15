// Links (contract 1.0, design §27, Decision D5): shared content in a document — a roll's media and stacks, a look,
// a preset. One mechanism, resolved first in compile: a linked medium becomes the plain medium (the link's fields
// with the frame's overrides), a link entry becomes the group it expands to (with the frame's overrides). Resolvers
// are registered per link kind; the contract registers rolls. Looks and presets register in phase 7 (look functions
// are compile-time lambdas, design §31).
import { applyMutation, Coll, isPlainObject, set, type Id, type Json, type JsonObject, type Mutation } from '@chromobench/values';
import { isLinked, STAGE_NAMES, type Document, type Entry, type Group, type LinkEntry, type LinkRef, type Params, type StageName, type Stages } from './document.ts';
import { fail } from './errors.ts';
import type { FrameFacts } from './bindings.ts';
import type { Roll } from './roll.ts';

export type LinkKind = 'roll' | 'look' | 'preset';

/** What the host supplies to resolve links (compile options): the rolls, and whatever later resolvers need. */
export interface LinkContext {
  rolls?: (id: Id) => Roll | undefined;
  facts?: FrameFacts;
}

export interface LinkResolver {
  kind: LinkKind;
  /** The (partial) medium the link gives a stage; the frame's overrides are applied on top. */
  medium?(ref: LinkRef, stage: StageName, ctx: LinkContext): JsonObject | undefined;
  /** The stack a link entry expands to in a stage (ids as the shared definition has them). */
  stack?(ref: LinkRef, stage: StageName, params: Params, ctx: LinkContext): Coll<Entry> | undefined;
}

const RESOLVERS = new Map<LinkKind, LinkResolver>();

export function defineLinkResolver(r: LinkResolver): void {
  RESOLVERS.set(r.kind, r);
}

export function linkKind(ref: LinkRef): LinkKind {
  if ('roll' in ref) return 'roll';
  if ('look' in ref) return 'look';
  if ('preset' in ref) return 'preset';
  return fail('E_LINK', `not a link reference: ${JSON.stringify(ref)}`, { valid: ['{roll}', '{look, version}', '{preset}'] });
}

const label = (ref: LinkRef): string => ('roll' in ref ? `roll ${ref.roll}` : 'look' in ref ? `look ${ref.look}@${ref.version}` : `preset ${(ref as { preset: Id }).preset}`);

function resolver(ref: LinkRef): LinkResolver {
  const k = linkKind(ref);
  return RESOLVERS.get(k) ?? fail('E_LINK', `no resolver for ${k} links`, { hint: k === 'roll' ? 'pass CompileOptions.links.rolls' : 'look and preset links arrive with phase 7' });
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

/** Writes `v` at a dotted path of a plain object, creating objects on the way (a partial medium completed by overrides). */
function setDeep(o: JsonObject, path: string, v: Json): JsonObject {
  const [k, ...rest] = path.split('.');
  const cur = o[k!];
  return { ...o, [k!]: rest.length === 0 ? v : setDeep(isPlainObject(cur) ? (cur as JsonObject) : {}, rest.join('.'), v) };
}

/** The plain medium of a linked medium: the link's fields, then the frame's overrides. */
export function resolveMedium(stage: StageName, m: { link: LinkRef; overrides: Readonly<Record<string, Json>> }, ctx: LinkContext): JsonObject {
  const base = resolver(m.link).medium?.(m.link, stage, ctx) ?? fail('E_LINK', `${label(m.link)} gives the ${stage} stage no medium`, { path: `stages.${stage}.medium` });
  let out = base;
  for (const [p, v] of Object.entries(m.overrides)) out = setDeep(out, p, v);
  return out;
}

/** Child ids of an expanded link are prefixed with the link entry's id, so they stay unique in the document. */
function prefixed(stack: Coll<Entry>, prefix: Id): Coll<Entry> {
  return Coll.of(Coll.entries(stack).map(([id, e]) => [`${prefix}--${id}`, e.kind === 'group' ? { ...e, stack: prefixed(e.stack, prefix) } : e] as const));
}

/** The group a link entry expands to: its fields (amount, mask, …) and the shared stack with the frame's overrides. */
export function expandLink(id: Id, e: LinkEntry, stage: StageName, ctx: LinkContext): Group {
  const stack = resolver(e.ref).stack?.(e.ref, stage, e.params, ctx) ?? fail('E_LINK', `${label(e.ref)} has no ${stage} stack`, { path: id });
  const changed = override({ stack } as { stack: Coll<Entry> }, Object.fromEntries(Object.entries(e.overrides).map(([p, v]) => [`stack.${p}`, v])), `link ${id}`).stack;
  return {
    kind: 'group', name: e.name, enabled: e.enabled, amount: e.amount, mask: e.mask, blend: e.blend,
    source: { ...e.source, link: e.ref as unknown as Json },
    stack: prefixed(resolveStack(changed, stage, ctx), id),
  };
}

function resolveStack(stack: Coll<Entry>, stage: StageName, ctx: LinkContext): Coll<Entry> {
  return Coll.map(stack, (e, id): Entry => {
    if (e.kind === 'link') return expandLink(id, e, stage, ctx);
    if (e.kind === 'group') return { ...e, stack: resolveStack(e.stack, stage, ctx) };
    return e;
  });
}

const hasLinks = (stack: Coll<Entry>): boolean => Coll.values(stack).some((e) => e.kind === 'link' || (e.kind === 'group' && hasLinks(e.stack)));

/** Step 1 of compile (design §29): the document with every link resolved into plain media and stacks. */
export function resolveLinks(doc: Document, ctx: LinkContext = {}): Document {
  let changed = false;
  const stages: Record<string, unknown> = {};
  for (const s of STAGE_NAMES) {
    const st = doc.stages[s];
    if (!st) continue;
    const linkedMedium = isLinked(st.medium);
    const linkedStack = hasLinks(st.stack);
    if (!linkedMedium && !linkedStack) {
      stages[s] = st;
      continue;
    }
    changed = true;
    stages[s] = {
      medium: linkedMedium ? resolveMedium(s, st.medium as { link: LinkRef; overrides: Readonly<Record<string, Json>> }, ctx) : st.medium,
      stack: linkedStack ? resolveStack(st.stack, s, ctx) : st.stack,
    };
  }
  return changed ? { ...doc, stages: stages as unknown as Stages } : doc;
}

/** "Bake" (design §27): the mutation that replaces a link entry by the plain group it expands to, its source recorded. */
export function bakeLink(doc: Document, id: Id, stage: StageName, ctx: LinkContext = {}): Mutation {
  const find = (stack: Coll<Entry>): LinkEntry | undefined => {
    for (const [k, e] of Coll.entries(stack)) {
      if (k === id && e.kind === 'link') return e;
      if (e.kind === 'group') {
        const f = find(e.stack);
        if (f) return f;
      }
    }
    return undefined;
  };
  const e = find(doc.stages[stage]?.stack ?? Coll.empty()) ?? fail('E_LINK', `no link entry ${id} in the ${stage} stage`, { path: id });
  return set(id, expandLink(id, e, stage, ctx));
}

// Rolls (CHB-020): a roll record holds partial media and stacks; a frame's media and link entries name it.
defineLinkResolver({
  kind: 'roll',
  medium: (ref, stage, ctx) => {
    const r = ctx.rolls?.((ref as { roll: Id }).roll) ?? fail('E_LINK', `unknown roll ${(ref as { roll: Id }).roll}`, { hint: 'pass CompileOptions.links.rolls' });
    return r.media[stage];
  },
  stack: (ref, stage, _params, ctx) => {
    const r = ctx.rolls?.((ref as { roll: Id }).roll) ?? fail('E_LINK', `unknown roll ${(ref as { roll: Id }).roll}`, { hint: 'pass CompileOptions.links.rolls' });
    return r.stacks[stage];
  },
});
