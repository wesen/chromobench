// Builders for the editing components (design §30): immutable values from @chromobench/values whose chain methods are
// modifiers, so `layer('burn', { stops: 1 }).amount(0.5).mask('sky')` ≡ `.with(amount(0.5)).with(maskWith('sky'))`
// and the same modifiers apply to the plain records a document stores. A value goes into a document through the four
// mutations (`insert(stackPath('darkroom'), 'b1', burn)`); the mutations store its data. The phase-6 agent DSL and
// the phase-5 stack kit build on these.
import { Coll, defineValue, field, libraryRoot, modifier, type Id, type Json, type Modifier } from '@chromobench/values';
import {
  entryBase, type CutName, type Entry, type EntryBase, type EntryBlend, type Group, type Layer, type Mask, type MaskCombine, type MaskComponent,
  type MaskComponentKind, type Params, type Provenance, type StageName,
} from './document.ts';

libraryRoot(import.meta.url);

/** Modifiers on any entry (layer, group or link): the fields every entry carries. */
export const amount = (k: number): Modifier<{ amount: number }> => field('amount')(k);
export const maskWith = (id: Id | null): Modifier<{ mask: Id | null }> => field('mask')(id);
export const blend = (b: EntryBlend): Modifier<{ blend: EntryBlend }> => field('blend')(b);
export const named = (name: string): Modifier<{ name: string }> => field('name')(name);
export const enabled = (on: boolean): Modifier<{ enabled: boolean }> => field('enabled')(on);
export const source = (p: Provenance): Modifier<{ source: Provenance }> => field('source')(p);
/** Merges into a layer's params. */
export const params = (p: Params): Modifier<{ params: Params }> => modifier('params', (d) => ({ ...d, params: { ...d.params, ...p } }), [p]);

const entryMethods = { amount, mask: maskWith, blend, name: named, enabled, source };

export const LayerValue = defineValue<Layer>()('layer', { ...entryMethods, params });
export const GroupValue = defineValue<Group>()('group', entryMethods);

/** A layer value of an op (params as the op's arguments; list arguments as Colls). */
export function layer(op: string, p: Params = {}, over: Partial<EntryBase> = {}): ReturnType<typeof LayerValue> {
  return LayerValue({ kind: 'layer', op, params: p, ...entryBase(op, over) });
}

/** A pass group of entries, given as [id, entry] pairs (values or plain data). */
export function group(name: string, ...entries: readonly (readonly [Id, Entry | { data: Entry }])[]): ReturnType<typeof GroupValue> {
  const stack = Coll.of(entries.map(([id, e]) => [id, 'data' in e ? e.data : e] as const));
  return GroupValue({ kind: 'group', stack: stack as Coll<Entry>, ...entryBase(name, { blend: 'pass' }) });
}

// ---- masks ---------------------------------------------------------------------------------------------------------

export const reads = (cut: 'stage-input' | CutName): Modifier<{ reads: 'stage-input' | CutName }> => field('reads')(cut);
export const feather = (mm: number): Modifier<{ feather_mm: number }> => field('feather_mm')(mm);
export const inverted = (on = true): Modifier<{ invert: boolean }> => field('invert')(on);
const add = (kind: MaskComponentKind, combine: MaskCombine) => (id: Id, p: Params, a = 1): Modifier<Mask> =>
  modifier<Mask>(`${combine} ${kind}`, (m) => ({ ...m, components: Coll.insert(m.components, id, { kind, params: p, combine, amount: a, enabled: true }) }), [id, p as Json, a]);

export const MaskValue = defineValue<Mask>()('mask', {
  name: named, feather, invert: inverted, reads,
  /** Adds a component: `.add('c2', 'ellipse', { box }, 'intersect')`. */
  add: (id: Id, kind: MaskComponentKind, p: Params, combine: MaskCombine = 'add', a = 1) => add(kind, combine)(id, p, a),
});

/** A mask value: its first component, then `.add(…)`, `.feather(mm)`, `.invert()`, `.reads(cut)`. */
export function mask(name: string, first?: readonly [Id, MaskComponentKind, Params]): ReturnType<typeof MaskValue> {
  const components = first ? Coll.of<MaskComponent>([[first[0], { kind: first[1], params: first[2], combine: 'add', amount: 1, enabled: true }]]) : Coll.empty<MaskComponent>();
  return MaskValue({ name, components, feather_mm: 0, invert: false, reads: 'stage-input' });
}

// ---- paths -----------------------------------------------------------------------------------------------------------

/** The path of a stage's stack (the collection a top-level entry is inserted into). */
export const stackPath = (stage: StageName): string => `stages.${stage}.stack`;
/** The path of a stage's medium field. */
export const mediumPath = (stage: StageName, fieldPath: string): string => `stages.${stage}.medium.${fieldPath}`;
