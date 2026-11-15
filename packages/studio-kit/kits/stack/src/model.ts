// cb.kits.stack, the model (headless, pure): a stage's stack as rows, the law's rules in the photographer's words,
// and every edit the panels and commands make, as the four mutations of the builder core. Generic over the
// catalogue (`opsForStage`, ArgSpecs, `term`, `coalesce`) and the stage laws (`getLaw`: blend, groups, amount,
// order), so an op or a blend mode added to the contract appears in the panels without a change here.
//
// Ids are unique in the whole document (design §20), so an entry is addressed by its id wherever it sits; a new id
// is the op's name plus the smallest free counter (`burn2`, `clarity1`, `g1`).
import { applyTransaction, Coll, equal, getPath, insert, move, remove, set, type Id, type Json, type Log, type Mutation, type Why } from '@chromobench/values';
import {
  BLEND_MODES, getLaw, getOp, groupEntry, keyOf, LAYER_MENUS, linksOf as placedLinks, layerEntry, MASK_COMBINES, MASK_COMPONENT_KINDS, mask as maskValue, opsForStage, readableCuts, STAGES,
  documentKind, termSeconds, type CutName, type Document, type Entry, type EntryBlend, type Group, type Layer, type Mask, type MaskCombine,
  type LinkEntry, type MaskComponent, type MaskComponentKind, type OpDef, type Params, type StageLaw, type StageName,
} from '@chromobench/contract';
import { entriesOf, findEntry, mainExposure, newDarkroomLayer, nextId, paramsOf, type Placed } from '../../../src/model/doc.ts';

// ---- the law, in words ------------------------------------------------------------------------------------------

/** A stage's law, or null for a stage that takes no entries (film). */
export function lawOf(stage: StageName): StageLaw | null {
  const l = STAGES[stage].law;
  return l ? getLaw(l) : null;
}

/** What Amount means for an entry of this stage: the law's unit hint (design D2). */
export type AmountHint = 'time' | 'density' | 'light' | 'opacity';
export function amountHint(stage: StageName, e: Pick<Entry, 'kind'> & { op?: string }): AmountHint {
  const law = lawOf(stage);
  if (!law || law.amount === 'opacity') return 'opacity';
  if (e.kind !== 'layer' || !e.op) return 'light';
  return getOp(e.op).term === 'modulator' ? 'density' : 'time';
}
export const HINT_WORDS: Record<AmountHint, string> = { time: 'scales its time', density: 'scales its density', light: 'scales the light of what it holds', opacity: 'opacity' };

/** The amount track: the law's range, the usual part of it on the slider (light: 0–200 %, typed up to the law's maximum). */
export function amountTrack(stage: StageName): { min: number; max: number; hard: [number, number]; step: number } {
  const law = lawOf(stage);
  const hard: [number, number] = law ? [law.amountRange[0], law.amountRange[1]] : [0, 1];
  return { min: hard[0], max: law?.amount === 'scale' ? Math.min(2, hard[1]) : hard[1], hard, step: 0.01 };
}
export const formatAmount = (a: number): string => `${Number((a * 100).toFixed(a * 100 % 1 ? 1 : 0))} %`;

/** The blend choices for an entry under its stage's law ([] when the law has none; a group: pass, then isolated modes). */
export function blendChoices(stage: StageName, kind: Entry['kind']): EntryBlend[] {
  const law = lawOf(stage);
  if (!law) return [];
  if (kind === 'layer') return law.blend ? [...BLEND_MODES] : ['normal'];
  return [...(law.groups.includes('pass') ? (['pass'] as const) : []), ...(law.groups.includes('isolated') ? BLEND_MODES : [])];
}
export const BLEND_WORDS: Record<string, string> = { pass: 'Pass through', normal: 'Normal' };
export const blendWord = (b: string): string => BLEND_WORDS[b] ?? b.replace(/(^|-)(\w)/g, (_m, s: string, c: string) => `${s ? ' ' : ''}${c.toUpperCase()}`).replace(/^\s/, '');

// ---- rows ---------------------------------------------------------------------------------------------------------

/** One row of a stack panel: an entry, where it sits, and what the row component needs to key on. */
export interface StackRow {
  readonly id: Id;
  readonly stage: StageName;
  readonly kind: Entry['kind'];
  /** the layer's op (null for a group or a link) */
  readonly op: string | null;
  readonly depth: number;
  readonly parent: Id | null;
  /** a group with children */
  readonly kids: number;
  readonly collapsed: boolean;
  /** what a row is re-made on: id, kind, op, depth (its fields update in place) */
  readonly key: string;
}

/** the light law's panel order by kind: the main exposure, light added, light held back, then the modulators */
const KIND_RANK: Record<string, number> = { main: 0, contribution: 1, modulator: 2 };
const rankOf = (e: Entry): number => (e.kind === 'layer' ? (KIND_RANK[getOp(e.op).term ?? ''] ?? 3) : e.kind === 'group' ? Math.min(3, ...Coll.values(e.stack).map(rankOf)) : 3);

export interface RowOptions {
  /** 'stack': the document's order; 'kind': by kind (only meaningful for an order-free law) */
  order?: 'stack' | 'kind';
  /** which rows to show (a group shows when one of its children does) */
  filter?: ((row: Placed) => boolean) | null;
  collapsed?: Readonly<Record<Id, boolean>>;
}

/** The rows of a stage's stack, depth first; children of a collapsed group are left out. */
export function rowsOf(doc: Document | null | undefined, stage: StageName, o: RowOptions = {}): StackRow[] {
  const st = doc?.stages[stage];
  if (!doc || !st) return [];
  const out: StackRow[] = [];
  const keep = (p: Placed): boolean => {
    if (!o.filter) return true;
    if (o.filter(p)) return true;
    return p.entry.kind === 'group' && entriesOf({ ...doc, stages: { ...doc.stages, [stage]: { ...st, stack: p.entry.stack } } } as Document, stage).some((c) => o.filter!(c));
  };
  const walk = (c: Coll<Entry>, parent: Id | null, depth: number): void => {
    let list = Coll.entries(c);
    if (o.order === 'kind') list = list.map((x, i) => [x, i] as const).sort((a, b) => rankOf(a[0][1]) - rankOf(b[0][1]) || a[1] - b[1]).map((x) => x[0]);
    for (const [id, e] of list) {
      const p: Placed = { id, entry: e, stage, parent, depth };
      if (!keep(p)) continue;
      const kids = e.kind === 'group' ? Coll.size(e.stack) : 0;
      const collapsed = !!o.collapsed?.[id];
      const op = e.kind === 'layer' ? e.op : null;
      out.push({ id, stage, kind: e.kind, op, depth, parent, kids, collapsed, key: `${id}|${e.kind}|${op ?? ''}|${depth}` });
      if (e.kind === 'group' && !collapsed) walk(e.stack, id, depth + 1);
    }
  };
  walk(st.stack, null, 0);
  return out;
}

/** A filter of rows by op (the finish view: `ops(['heal', 'clone', 'clarity'])`). */
export const byOps = (ops: readonly string[]) => (p: Placed): boolean => p.entry.kind === 'layer' && ops.includes(p.entry.op);

/** The entry an id names in a stage, with its place (undefined when it is not there). */
export function placedIn(doc: Document | null | undefined, stage: StageName, id: Id | null | undefined): Placed | undefined {
  if (!doc || !id) return undefined;
  return entriesOf(doc, stage).find((p) => p.id === id);
}

/** What a row says under its name: the seconds a darkroom contribution gives, a filter in points, else its first arguments. */
export function entryDetail(doc: Document, p: Placed): string {
  const e = p.entry;
  if (e.kind === 'group') return `${Coll.size(e.stack)} ${Coll.size(e.stack) === 1 ? 'entry' : 'entries'}`;
  if (e.kind === 'link') return linkWords(e);
  const pr = paramsOf(e);
  const s = (t: number): string => `${t < 10 ? Number(t.toFixed(2)) : Number(t.toFixed(1))} s`;
  switch (e.op) {
    case 'expose': return `${s(mainExposure(doc).time_s)} · f/${pr['fstop']}`;
    case 'burn': case 'dodge': case 'flash': {
      const t = termSeconds(e.op, pr, mainExposure(doc).time_s) * e.amount;
      const st = typeof pr['stops'] === 'number' ? ` (${e.op === 'dodge' ? '−' : '+'}${Number((pr['stops'] as number).toFixed(2))} st)` : '';
      return `${e.op === 'dodge' ? '−' : '+'}${s(t)}${st}`;
    }
    case 'preflash': return `${Number(((pr['fraction'] as number) * 100).toFixed(1))} % of the grey card`;
    case 'densityMask': return `${pr['polarity'] === 'same' ? 'unsharp' : 'contrast'} γ ${pr['gamma']} · ${pr['radius_um']} µm`;
    case 'filter': return `${(pr['logH'] as number[]).map((x) => `${x >= 0 ? '+' : ''}${Number((x / 0.025).toFixed(1))}`).join(' / ')} pt`;
    case 'heal': case 'clone': {
      const spots = pr['spots'] as { x: number; y: number; r: number }[];
      return spots.length === 1 ? `at ${Math.round(spots[0]!.x)}, ${Math.round(spots[0]!.y)} · r ${spots[0]!.r}` : `${spots.length} spots`;
    }
    default: {
      const op = getOp(e.op);
      const parts: string[] = [];
      for (const [k, spec] of Object.entries(op.args)) {
        const v = pr[k];
        if (typeof v !== 'number' || parts.length >= 2) continue;
        parts.push(`${spec.ui?.label ?? k} ${Number(v.toFixed(2))}${spec.unit && spec.unit !== 'none' && spec.unit !== 'fraction' ? ` ${spec.unit}` : ''}`);
      }
      return parts.join(' · ');
    }
  }
}

// ---- links (P7): a look, a preset or a roll's stack as one entry ------------------------------------------------

/** What a link row says: what it links to. */
export function linkWords(e: LinkEntry): string {
  const r = e.ref as Record<string, unknown>;
  return 'look' in r ? `look ${String(r['look'])}` : 'preset' in r ? 'preset' : 'roll' in r ? `roll ${String(r['roll'])}` : 'linked';
}
/** The shared key of a link entry (its siblings in other stages carry the same key). */
export function linkKey(doc: Document, id: Id): Id | null {
  const l = placedLinks(doc).find((x) => x.id === id);
  return l ? keyOf(l) : null;
}

// ---- the catalogue: what a stage can add ---------------------------------------------------------------------------

/**
 * The ops the "+ Layer" menu offers in a stage: the catalogue's layer ops of that stage, minus the one the law makes
 * unique (the main exposure, `term: 'main'`) and the coalescible ops the spot tools make (heal, clone).
 */
export function addableOps(stage: StageName): OpDef[] {
  return opsForStage(stage)
    .filter((o) => o.term !== 'main' && !o.coalesce && !o.internal)
    .sort((a, b) => menuRank(a) - menuRank(b) || (a.ui?.order ?? 999) - (b.ui?.order ?? 999) || a.name.localeCompare(b.name));
}
const menuRank = (o: OpDef): number => (o.ui ? LAYER_MENUS.indexOf(o.ui.menu) : LAYER_MENUS.length);
export const MENU_WORDS: Record<string, string> = { light: 'Light', retouch: 'Retouch', tone: 'Tone', colour: 'Colour', detail: 'Detail', effect: 'Effect', mask: 'Mask' };

/**
 * The "+ Layer" items of a stage, grouped by the catalogue's menu (`OpDef.ui.menu`, in `LAYER_MENUS` order, each by
 * `ui.order`): one flat list with separators, or submenus when the stage has more than `flat` ops.
 */
export function addMenu(stage: StageName, ops?: readonly string[], flat = 14): ({ label: string; run: unknown[] } | '-' | { label: string; items: { label: string; run: unknown[] }[] })[] {
  const list = addableOps(stage).filter((o) => !ops || ops.includes(o.name));
  const groups = new Map<string, { label: string; run: unknown[] }[]>();
  for (const o of list) {
    const g = o.ui?.menu ?? 'other';
    groups.set(g, [...(groups.get(g) ?? []), { label: opWord(o.name), run: ['layer.add', o.name, stage] }]);
  }
  if (list.length <= flat || groups.size === 1) return [...groups.values()].flatMap((items, i) => [...(i ? ['-' as const] : []), ...items]);
  return [...groups].map(([g, items]) => ({ label: MENU_WORDS[g] ?? g, items }));
}
/** Whether a stage has anything to add (the Scene module is built only then). */
export const hasAddableOps = (stage: StageName): boolean => addableOps(stage).length > 0;

const DARKROOM_STARTERS = new Set(['burn', 'dodge', 'flash', 'preflash', 'densityMask']);
/** The menu's words for an op. */
export function opWord(op: string): string {
  const def0 = getOp(op);
  if (def0.ui?.label) return def0.ui.label;
  const WORDS: Record<string, string> = { burn: 'Burn', dodge: 'Dodge', flash: 'Flash', preflash: 'Preflash', densityMask: 'Contrast mask', filter: 'Filter', clarity: 'Clarity', heal: 'Heal', clone: 'Clone', expose: 'Main exposure' };
  if (WORDS[op]) return WORDS[op]!;
  const d = getOp(op);
  const label = Object.values(d.args).find((a) => a.ui?.group)?.ui?.group;
  return label && !label.includes(' ') ? label : op.replace(/^\w/, (c) => c.toUpperCase()).replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** A new layer of an op at its usual starting values: the darkroom's (½ stop burn, 2 s flash, …), else the ArgSpec defaults. */
export function newLayer(op: string, o: { name?: string; mask?: Id | null } = {}): Layer {
  if (DARKROOM_STARTERS.has(op)) return newDarkroomLayer(op as 'burn', { ...(o.name ? { name: o.name } : {}), mask: o.mask ?? null });
  const def = getOp(op);
  const params: Record<string, Json> = {};
  for (const [k, spec] of Object.entries(def.args)) {
    if (spec.default === undefined || spec.type === 'Image' || spec.type === 'Mask') continue;
    params[k] = (spec.type === 'list' ? Coll.empty() : spec.default) as Json;
  }
  return layerEntry(op, params as Params, { name: o.name ?? opWord(op), mask: o.mask ?? null });
}

/** A fresh id for an op's layer (the op's name without its dots, plus a counter). */
export const idFor = (doc: Document, op: string): Id => nextId(doc, op.replace(/[^A-Za-z0-9]/g, '') || 'layer');

/** The collection path an entry sits in: the stage's stack or its group's. */
export const collOf = (stage: StageName, parent: Id | null): string => (parent ? `${parent}.stack` : `stages.${stage}.stack`);

/**
 * Where a new entry goes: after the selected entry (in its group), else at the end of the stage's stack. The
 * selected entry must be in the stage.
 */
export function placeAfter(doc: Document, stage: StageName, after?: Id | null): { into: string; at?: number } {
  const p = placedIn(doc, stage, after);
  if (!p) return { into: collOf(stage, null) };
  const c = p.parent ? (findEntry(doc, p.parent)!.entry as Group).stack : doc.stages[stage]!.stack;
  return { into: collOf(stage, p.parent), at: Coll.indexOf(c, p.id) + 1 };
}

/** The "+ Layer" edit: a new layer of `op` in `stage` (after `after` when given). */
export function addLayer(doc: Document, stage: StageName, op: string, o: { after?: Id | null; id?: Id; mask?: Id | null } = {}): { id: Id; mutations: Mutation[] } {
  if (!doc.stages[stage]) throw new Error(`this frame has no ${stage} stage`);
  if (!getOp(op).stages?.includes(stage)) throw new Error(`${op} does not live in the ${stage} stage`);
  const id = o.id ?? idFor(doc, op);
  const to = placeAfter(doc, stage, o.after);
  return { id, mutations: [insert(to.into, id, newLayer(op, { mask: o.mask ?? null }), to.at)] };
}

// ---- structural edits ----------------------------------------------------------------------------------------------

/** Every id inside a value (Coll item ids, at any depth), in document order. */
function collIds(v: unknown, out: Id[] = []): Id[] {
  if (Coll.is(v)) for (const [id, x] of Coll.entries(v)) {
    out.push(id);
    collIds(x, out);
  }
  else if (Array.isArray(v)) for (const x of v) collIds(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) collIds(x, out);
  return out;
}
/** A copy of a value with Coll ids renamed by `map`. */
function renameIds<T>(v: T, map: ReadonlyMap<Id, Id>): T {
  if (Coll.is(v)) return Coll.of(Coll.entries(v).map(([id, x]) => [map.get(id) ?? id, renameIds(x, map)] as const)) as T;
  if (Array.isArray(v)) return v.map((x) => renameIds(x, map)) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, renameIds(x, map)])) as T;
  return v;
}

/** Duplicate: a copy right after the entry, with fresh ids for it and everything inside (children, spots). */
export function duplicateEntry(doc: Document, id: Id): { id: Id; mutations: Mutation[] } {
  const p = findEntry(doc, id);
  if (!p) throw new Error(`no entry ${id}`);
  if (p.entry.kind === 'layer' && getOp(p.entry.op).term === 'main') throw new Error('the main exposure is the only one (the light law)');
  const taken = new Set<Id>();
  const fresh = (base: Id): Id => {
    const stem = base.replace(/\d+$/, '') || 'e';
    let n = 1;
    let probe = `${stem}${n}`;
    while (findAnyId(doc, probe) || taken.has(probe)) probe = `${stem}${++n}`;
    taken.add(probe);
    return probe;
  };
  const nid = fresh(id);
  const map = new Map<Id, Id>(collIds(p.entry).map((x) => [x, fresh(x)]));
  const copy = { ...renameIds(p.entry, map), name: `${p.entry.name} copy`, source: { kind: 'user' } } as Entry;
  const c = p.parent ? (findEntry(doc, p.parent)!.entry as Group).stack : doc.stages[p.stage]!.stack;
  return { id: nid, mutations: [insert(collOf(p.stage, p.parent), nid, copy, Coll.indexOf(c, id) + 1)] };
}
/** whether an id is taken anywhere in the document (entries, masks, components, spots, probes) */
const findAnyId = (doc: Document, id: Id): boolean => collIds(doc).includes(id);

/** The entries that use a mask (any stage). */
export function maskUsers(doc: Document, mid: Id): Id[] {
  return (['scan', 'scene', 'film', 'darkroom', 'print'] as StageName[]).flatMap((s) => entriesOf(doc, s).filter((p) => p.entry.mask === mid).map((p) => p.id));
}

/** Delete entries (never the main exposure); a mask no other entry uses goes with them. */
export function deleteEntries(doc: Document, ids: readonly Id[]): Mutation[] {
  const gone = new Set<Id>();
  const out: Mutation[] = [];
  for (const id of ids) {
    const p = findEntry(doc, id);
    if (!p || gone.has(id) || (p.entry.kind === 'layer' && getOp(p.entry.op).term === 'main')) continue;
    // a child of an entry already removed goes with it
    if (p.parent && gone.has(p.parent)) continue;
    gone.add(id);
    for (const x of collIds(p.entry)) gone.add(x);
    out.push(remove(id));
  }
  const masks = new Set<Id>();
  for (const id of gone) {
    const m = findEntry(doc, id)?.entry.mask;
    if (m) masks.add(m);
  }
  for (const m of masks) if (Coll.has(doc.masks, m) && maskUsers(doc, m).every((u) => gone.has(u))) out.push(remove(m));
  return out;
}

export const renameEntry = (id: Id, name: string): Mutation[] => [set(`${id}.name`, name)];
export function toggleEntry(doc: Document, id: Id): Mutation[] {
  const e = findEntry(doc, id)?.entry;
  return e ? [set(`${id}.enabled`, !e.enabled)] : [];
}
export function setAmount(doc: Document, id: Id, a: number): Mutation[] {
  const p = findEntry(doc, id);
  if (!p) return [];
  const [lo, hi] = amountTrack(p.stage).hard;
  return [set(`${id}.amount`, Number(Math.min(hi, Math.max(lo, a)).toFixed(4)))];
}
export function setBlend(doc: Document, id: Id, b: EntryBlend): Mutation[] {
  const p = findEntry(doc, id);
  if (!p) return [];
  if (!blendChoices(p.stage, p.entry.kind).includes(b)) throw new Error(`the ${STAGES[p.stage].law} law has no ${b} for a ${p.entry.kind}`);
  return [set(`${id}.blend`, b)];
}

/** Group entries of one stage: a pass group at the place of the first, holding them in their panel order. */
export function groupEntries(doc: Document, ids: readonly Id[], name = 'Group'): { id: Id; mutations: Mutation[] } {
  const placed = ids.map((id) => findEntry(doc, id)).filter((p): p is Placed => !!p);
  if (!placed.length) throw new Error('select the entries to group');
  const stage = placed[0]!.stage;
  if (placed.some((p) => p.stage !== stage)) throw new Error('a group holds entries of one stage');
  const order = entriesOf(doc, stage).map((p) => p.id);
  // a child whose group is also selected moves with its group
  const top = placed.filter((p) => !placed.some((q) => q.id !== p.id && isInside(doc, p.id, q.id))).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const first = top[0]!;
  const c = first.parent ? (findEntry(doc, first.parent)!.entry as Group).stack : doc.stages[stage]!.stack;
  const gid = nextId(doc, 'g');
  const out: Mutation[] = [insert(collOf(stage, first.parent), gid, groupEntry(name), Coll.indexOf(c, first.id))];
  top.forEach((p, i) => out.push(move(p.id, { into: `${gid}.stack`, at: i })));
  return { id: gid, mutations: out };
}

/** Ungroup: the children take the group's place, in order; the group goes. */
export function ungroup(doc: Document, gid: Id): Mutation[] {
  const p = findEntry(doc, gid);
  if (!p || p.entry.kind !== 'group') return [];
  const c = p.parent ? (findEntry(doc, p.parent)!.entry as Group).stack : doc.stages[p.stage]!.stack;
  const at = Coll.indexOf(c, gid);
  const into = collOf(p.stage, p.parent);
  return [...Coll.ids(p.entry.stack).map((id, i) => move(id, { into, at: at + i })), remove(gid)];
}

/** Whether entry `id` sits (at any depth) inside group `gid`. */
export function isInside(doc: Document, id: Id, gid: Id): boolean {
  let p = findEntry(doc, id);
  while (p?.parent) {
    if (p.parent === gid) return true;
    p = findEntry(doc, p.parent);
  }
  return false;
}

/**
 * A drop in a stack panel: `id` before or after `target`, or into the group `target` (at its end). Nothing (an empty
 * list) for a drop on itself, into its own children, or across stages.
 */
export function dropOn(doc: Document, id: Id, target: Id, where: 'before' | 'after' | 'into'): Mutation[] {
  const a = findEntry(doc, id);
  const t = findEntry(doc, target);
  if (!a || !t || id === target || a.stage !== t.stage || isInside(doc, target, id)) return [];
  if (where === 'into') {
    if (t.entry.kind !== 'group') return [];
    return [move(id, { into: `${target}.stack`, at: Coll.size(t.entry.stack) - (a.parent === target ? 1 : 0) })];
  }
  const c = t.parent ? (findEntry(doc, t.parent)!.entry as Group).stack : doc.stages[t.stage]!.stack;
  let at = Coll.indexOf(c, target) + (where === 'after' ? 1 : 0);
  // moving within one collection: the index counts without the moved entry
  if (a.parent === t.parent && Coll.indexOf(c, id) < at) at -= 1;
  if (a.parent === t.parent && Coll.indexOf(c, id) === at) return [];
  return [move(id, { into: collOf(t.stage, t.parent), at })];
}

/** Move one place up or down within its collection (the keyboard's and the menu's reorder). */
export function nudgeEntry(doc: Document, id: Id, by: -1 | 1): Mutation[] {
  const p = findEntry(doc, id);
  if (!p) return [];
  const c = p.parent ? (findEntry(doc, p.parent)!.entry as Group).stack : doc.stages[p.stage]!.stack;
  const at = Coll.indexOf(c, id) + by;
  if (at < 0 || at >= Coll.size(c)) return [];
  return [move(id, { into: collOf(p.stage, p.parent), at })];
}

// ---- masks ----------------------------------------------------------------------------------------------------------

/** The component kinds the catalogue has (P8a adds radial and colour): `mask.<kind>` exists. */
export const componentKinds = (): readonly MaskComponentKind[] => MASK_COMPONENT_KINDS;
export const COMBINE_WORDS: Record<MaskCombine, string> = { add: 'Add', subtract: 'Subtract', intersect: 'Intersect' };
export const combines = (): readonly MaskCombine[] => MASK_COMBINES;
export const KIND_WORDS: Record<string, string> = { linear: 'Linear gradient', radial: 'Radial', ellipse: 'Ellipse', paint: 'Brush', luminance: 'Luminance range', colour: 'Colour range' };

/** The cuts a mask used by an entry of `stage` may read (range components measure them). */
export function readsChoices(doc: Document, stage: StageName): ('stage-input' | CutName)[] {
  return ['stage-input', ...readableCuts(stage, documentKind(doc), 'mask')];
}

/** A component's starting params: the op's defaults (geometry comes from the tool that draws it). */
export function componentDefaults(kind: MaskComponentKind): Params {
  const op = getOp(`mask.${kind}`);
  const out: Record<string, Json> = {};
  for (const [k, s] of Object.entries(op.args)) if (s.default !== undefined) out[k] = (s.type === 'list' ? Coll.empty() : s.default) as Json;
  return out as Params;
}

/** A new mask with one component, attached to an entry (one step: the mask into the library, the entry's mask set). */
export function newMaskOn(doc: Document, id: Id, kind: MaskComponentKind, params: Params = componentDefaults(kind), o: { feather_mm?: number } = {}): { mask: Id; component: Id; mutations: Mutation[] } {
  const mid = nextId(doc, 'm');
  const cid = `${mid}c1`;
  let m = maskValue(`Mask ${mid.slice(1)}`, [cid, kind, params]);
  if (o.feather_mm) m = m.feather(o.feather_mm);
  return { mask: mid, component: cid, mutations: [insert('masks', mid, m), set(`${id}.mask`, mid)] };
}

/** Another component in a mask, combined by `combine` (the one algebra: add = max, subtract, intersect). */
export function addComponent(doc: Document, mid: Id, kind: MaskComponentKind, params: Params = componentDefaults(kind), combine: MaskCombine = 'add'): { id: Id; mutations: Mutation[] } {
  const m = Coll.get(doc.masks, mid);
  if (!m) throw new Error(`no mask ${mid}`);
  let n = Coll.size(m.components) + 1;
  while (findAnyId(doc, `${mid}c${n}`)) n++;
  const cid = `${mid}c${n}`;
  const c: MaskComponent = { kind, params, combine, amount: 1, enabled: true };
  return { id: cid, mutations: [insert(`${mid}.components`, cid, c)] };
}

/**
 * What a mask tool's gesture writes: a component into the target entry's mask (a new mask when it has none), or,
 * without a target, a burn through a new mask in the darkroom (the darkroom's quick gesture).
 */
export function maskGesture(doc: Document, target: Id | null, kind: MaskComponentKind, params: Params, o: { combine?: MaskCombine; feather_mm?: number } = {}): { layer: Id; mask: Id; mutations: Mutation[]; label: string } {
  const t = target ? findEntry(doc, target) : undefined;
  if (t && !(t.entry.kind === 'layer' && getOp(t.entry.op).term === 'main')) {
    const mid = t.entry.mask;
    if (mid && Coll.has(doc.masks, mid)) {
      const r = addComponent(doc, mid, kind, params, o.combine ?? 'add');
      return { layer: t.id, mask: mid, mutations: r.mutations, label: `${COMBINE_WORDS[o.combine ?? 'add']} ${KIND_WORDS[kind]?.toLowerCase() ?? kind} to ${t.entry.name}` };
    }
    const r = newMaskOn(doc, t.id, kind, params, o.feather_mm ? { feather_mm: o.feather_mm } : {});
    return { layer: t.id, mask: r.mask, mutations: r.mutations, label: `Mask ${t.entry.name} (${KIND_WORDS[kind]?.toLowerCase() ?? kind})` };
  }
  const lid = idFor(doc, 'burn');
  const mid = nextId(doc, 'm');
  let m = maskValue(`Mask ${mid.slice(1)}`, [`${mid}c1`, kind, params]);
  if (o.feather_mm) m = m.feather(o.feather_mm);
  const layer = newLayer('burn', { mask: mid, name: `Burn ${lid.slice(4)}` });
  return { layer: lid, mask: mid, mutations: [insert('masks', mid, m), insert('stages.darkroom.stack', lid, layer)], label: `Burn ${lid.slice(4)} through mask ${mid}` };
}

/** The mask of an entry, with its components in order (null when it has none). */
export function maskOf(doc: Document, id: Id): { id: Id; mask: Mask; components: [Id, MaskComponent][] } | null {
  const mid = findEntry(doc, id)?.entry.mask;
  const m = mid ? Coll.get(doc.masks, mid) : undefined;
  return mid && m ? { id: mid, mask: m, components: Coll.entries(m.components) } : null;
}

/** Detach: the entry has no mask; the mask goes from the library when nothing else uses it. */
export function detachMask(doc: Document, id: Id): Mutation[] {
  const mid = findEntry(doc, id)?.entry.mask;
  if (!mid) return [];
  return [set(`${id}.mask`, null), ...(maskUsers(doc, mid).length <= 1 && Coll.has(doc.masks, mid) ? [remove(mid)] : [])];
}

// ---- provenance -----------------------------------------------------------------------------------------------------

const PROV = new WeakMap<Log, Map<string, Map<Id, Why>>>();
/**
 * Who last changed each entry of a frame (design §26, `why`): the log's `why(f, id)` for every id at once, folded
 * once per log value (rows ask on every redraw). An entry no step changed has the opening (seq 0).
 */
export function provenance(log: Log, f: string): Map<Id, Why> {
  let per = PROV.get(log);
  if (!per) PROV.set(log, (per = new Map()));
  const hit = per.get(f);
  if (hit) return hit;
  const out = new Map<Id, Why>();
  if (log.has(f)) {
    const cur = log.doc<Document>(f);
    const ids = (['scan', 'scene', 'darkroom', 'print'] as StageName[]).flatMap((s) => entriesOf(cur, s).map((p) => p.id));
    // the opening: the document as the frame was opened (who opened it, from where)
    const open = log.trail(f, 'frame')[0]!;
    let d = log.initial<Document>(f);
    for (const id of ids) out.set(id, open);
    for (const e of log.inEffect(f)) {
      const after = applyTransaction(d, e.tx).doc as Document;
      for (const id of ids) {
        const a = getPath(after, id);
        if (a !== getPath(d, id) && !equal(a, getPath(d, id))) out.set(id, { seq: e.seq, doc: f, by: e.tx.by, source: e.tx.source, label: e.tx.label, tx: e.tx.id, at: e.at, value: a as Json, ...(e.approvedBy ? { approvedBy: e.approvedBy } : {}) } as Why);
      }
      d = after;
    }
  }
  per.set(f, out);
  return out;
}
