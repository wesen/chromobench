// cb.kits.finish: the kit's state, the spots of a document, the crop check and the common edits (split from kit.ts,
// CHB-032; CHB-037: on format-3 documents). A heal or clone spot is a layer of its own with one spot: a print-stage
// `heal`/`clone` layer in the pass group `retouch` ("Retouch"), or a scan-stage `heal` layer in the group `dust`
// ("Dust", as ingest's dust detection makes them). The spot's id is its layer's id; the spot inside the layer's
// `spots` Coll is `<layerId>-s` (ids are unique in the whole document). Clarity is the print-stage layer `clarity`.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Coll, insert, remove, set, type Id, type Mutation } from '@chromobench/values';
import { groupEntry, layerEntry, type Document, type Entry, type Geometry, type Group, type Layer, type Params, type StageName } from '@chromobench/contract';
import { DUST, entriesOf, findEntry, nextId, paramsOf, RETOUCH } from '../../../src/model/doc.ts';
import { centreOf, constrain, cropOf, fitCrop, frameValid, fullBox, type Pt } from './geometry.ts';

export type SpotMode = 'heal' | 'clone' | 'dust';
export interface FinishView {
  crop: { aspect: string; locked: boolean };
  spot: { mode: SpotMode; r: number; feather: number; opacity: number };
  /** the selected spot (its layer's id) */
  selected: string | null;
  /** draw every spot with its source line */
  show: boolean;
  /** before/after of the finishing set: the viewer shows the print without the print stage and the dust (never committed) */
  bypass: boolean;
}
export const FINISH_STATE: { finish: FinishView } = {
  finish: { crop: { aspect: 'original', locked: true }, spot: { mode: 'heal', r: 12, feather: 0.5, opacity: 1 }, selected: null, show: true, bypass: false },
};

/** The print-stage clarity layer's id (created on first use). */
export const CLARITY = 'clarity';

/** A spot as stored in a heal or clone layer (document px). */
export interface HealSpotData { x: number; y: number; r: number; src: Pt; feather: number; opacity: number }
export interface SpotRef { id: string; spot: string; kind: 'retouch' | 'dust'; mode: SpotMode; x: number; y: number; r: number; src: Pt | null; enabled: boolean }

export const plain = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** The spot id inside a spot layer. */
export const spotIdOf = (layer: Id): Id => `${layer}-s`;

/** The group the spots of a kind live in, and its stage. */
export const spotHome = (kind: 'retouch' | 'dust'): { stage: StageName; group: Id; name: string } =>
  kind === 'dust' ? { stage: 'scan', group: DUST, name: 'Dust' } : { stage: 'print', group: RETOUCH, name: 'Retouch' };

/** Every spot of a document (dust on the negative, then retouch on the print), in stack order. */
export function spotsOf(d: Document | undefined | null): SpotRef[] {
  if (!d) return [];
  const out: SpotRef[] = [];
  for (const kind of ['dust', 'retouch'] as const) {
    const home = spotHome(kind);
    for (const p of entriesOf(d, home.stage)) {
      const e = p.entry;
      if (p.parent !== home.group || e.kind !== 'layer' || (e.op !== 'heal' && e.op !== 'clone')) continue;
      const spots = paramsOf(e)['spots'] as HealSpotData[];
      const ids = Coll.is(e.params['spots']) ? Coll.ids(e.params['spots'] as Coll<unknown>) : [];
      const s = spots[0];
      if (!s) continue;
      out.push({ id: p.id, spot: ids[0] ?? spotIdOf(p.id), kind, mode: kind === 'dust' ? 'dust' : (e.op as SpotMode), x: s.x, y: s.y, r: s.r, src: s.src ?? null, enabled: e.enabled });
    }
  }
  return out;
}

/** The spot data of a spot layer (its first spot), or undefined. */
export function spotData(d: Document, id: Id): HealSpotData | undefined {
  const e = findEntry(d, id)?.entry;
  if (!e || e.kind !== 'layer') return undefined;
  return (paramsOf(e)['spots'] as HealSpotData[])[0];
}

/** The next spot layer id: s (or dust-) plus the smallest counter not used in the document. */
export function nextSpotId(d: Document, kind: 'retouch' | 'dust'): string {
  return nextId(d, kind === 'dust' ? 'dust-' : 's');
}

/** A spot layer: op heal or clone with one spot. */
export function spotLayer(op: 'heal' | 'clone', id: Id, s: HealSpotData, name: string): Layer {
  return layerEntry(op, { spots: Coll.of([[spotIdOf(id), plain(s)]]) as unknown as Params[string] }, { name });
}

/**
 * The stage stack with a spot placed or changed: an existing layer's spot replaced (`id` names it), or a new layer
 * appended to its group (the group made, first in the stack, when it is not there). The tools preview it at the
 * stack's place and commit the net change; `edits.spot` turns it into mutations.
 */
export function stackWithSpot(d: Document, kind: 'retouch' | 'dust', id: Id, s: HealSpotData, op: 'heal' | 'clone' = 'heal'): Coll<Entry> {
  const home = spotHome(kind);
  const stack = d.stages[home.stage]!.stack;
  const found = findEntry(d, id);
  const mapIn = (c: Coll<Entry>, f: (e: Entry, eid: Id) => Entry): Coll<Entry> =>
    Coll.map(c, (e, eid) => {
      const x = f(e, eid);
      return x.kind === 'group' ? { ...x, stack: mapIn(x.stack, f) } : x;
    });
  if (found && found.entry.kind === 'layer') {
    const l = found.entry;
    const spots = Coll.is(l.params['spots']) ? (l.params['spots'] as Coll<HealSpotData>) : Coll.empty<HealSpotData>();
    const sid = Coll.ids(spots)[0] ?? spotIdOf(id);
    const next: Layer = { ...l, params: { ...l.params, spots: (Coll.has(spots, sid) ? Coll.replace(spots, sid, plain(s)) : Coll.of([[sid, plain(s)]])) as unknown as Params[string] } };
    return mapIn(stack, (e, eid) => (eid === id ? next : e));
  }
  const n = kind === 'dust' ? Number(id.replace(/^dust-/, '')) || 1 : Number(id.replace(/^s/, '')) || 1;
  const layer = spotLayer(kind === 'dust' ? 'heal' : op, id, s, kind === 'dust' ? `Dust ${n}` : `${op === 'clone' ? 'Clone' : 'Heal'} ${n}`);
  const group = findEntry(d, home.group);
  if (group && group.entry.kind === 'group') {
    const g = group.entry;
    return mapIn(stack, (e, eid) => (eid === home.group ? ({ ...g, stack: Coll.insert(g.stack, id, layer) } as Group) : e));
  }
  return Coll.insert(stack, home.group, groupEntry(home.name, Coll.of([[id, layer]])), 0);
}

/** The removals that take spots out: their layers, and a group left empty. */
export function removeSpots(d: Document, ids: readonly Id[]): Mutation[] {
  const out: Mutation[] = [];
  const gone = new Set(ids.filter((id) => findEntry(d, id)?.entry.kind === 'layer'));
  for (const kind of ['dust', 'retouch'] as const) {
    const home = spotHome(kind);
    const g = findEntry(d, home.group)?.entry;
    if (!g || g.kind !== 'group') continue;
    const mine = Coll.ids(g.stack).filter((id) => gone.has(id));
    if (!mine.length) continue;
    if (mine.length === Coll.size(g.stack)) out.push(remove(home.group));
    else for (const id of mine) out.push(remove(id));
  }
  return out;
}

/**
 * CB-F110 (finish/crop-valid, guide §9.5): a frame whose turned crop leaves the picture shows empty corners.
 * Returns the problem and the fix (the largest valid box with the same shape), or null.
 */
export function cropProblem(d: Document, W: number, H: number): { code: 'CB-F110'; message: string; fix: Geometry } | null {
  const f = d.geometry;
  if (frameValid(f, W, H)) return null;
  const fix = constrain(f, W, H);
  const b = fix.crop ?? fullBox(W, H);
  return { code: 'CB-F110', message: `the crop turned by ${f.angle_deg}° leaves the picture (empty corners)`, fix: { ...fix, crop: b } };
}

/** The document as the finish module shows it with Before / after on: the print stage and the dust turned off. */
export function withoutFinishing(d: Document): Document {
  const off = (c: Coll<Entry>): Coll<Entry> => Coll.map(c, (e) => ({ ...e, enabled: false }));
  const st = d.stages;
  const scan = st.scan ? { ...st.scan, stack: Coll.map(st.scan.stack, (e, id) => (id === DUST ? { ...e, enabled: false } : e)) } : undefined;
  return { ...d, stages: { ...st, ...(scan ? { scan } : {}), print: { ...st.print, stack: off(st.print.stack) } } };
}

/** The agent's and the tools' common edits (guide §9.4): mutations, so a proposal is the same as a gesture. */
export const edits = {
  /** crop to an aspect at an angle, as large as fits (centre: keep the crop's) */
  crop(d: Document, W: number, H: number, o: { aspect?: string | [number, number]; angle_deg?: number; centre?: Pt } = {}): Mutation[] {
    const f = d.geometry;
    const centre = o.centre ?? centreOf(cropOf(f, W, H));
    const next = fitCrop(W, H, { orientation: f.orientation, angle_deg: o.angle_deg ?? f.angle_deg, aspect: o.aspect ?? 'original', centre });
    return [set('geometry.angle_deg', next.angle_deg), set('geometry.crop', next.crop)];
  },
  /** one spot (heal or clone on the print, or dust on the negative): its layer, and its group on the first spot */
  spot(d: Document, s: { mode: SpotMode; x: number; y: number; r: number; src: Pt; feather?: number; opacity?: number }, id = nextSpotId(d, s.mode === 'dust' ? 'dust' : 'retouch')): Mutation[] {
    const kind = s.mode === 'dust' ? 'dust' : 'retouch';
    const home = spotHome(kind);
    const data: HealSpotData = { x: s.x, y: s.y, r: s.r, src: s.src, feather: s.feather ?? (kind === 'dust' ? 0.3 : 0.5), opacity: s.opacity ?? 1 };
    const stack = stackWithSpot(d, kind, id, data, s.mode === 'clone' ? 'clone' : 'heal');
    const g = findEntry(d, home.group);
    if (!g) return [insert(`stages.${home.stage}.stack`, home.group, Coll.get(stack, home.group)!, 0)];
    return [insert(`${home.group}.stack`, id, (Coll.get(stack, home.group) as Group).stack.items[id]!)];
  },
  /** the clarity layer (created when the document has none) at a strength */
  clarity(d: Document, strength: number, radius_mm?: number): Mutation[] {
    if (findEntry(d, CLARITY)) return [set(`${CLARITY}.params.strength`, strength), ...(radius_mm !== undefined ? [set(`${CLARITY}.params.radius_mm`, radius_mm)] : [])];
    return [insert('stages.print.stack', CLARITY, layerEntry('clarity', { strength, radius_mm: radius_mm ?? 10 }, { name: 'Clarity' }))];
  },
};
