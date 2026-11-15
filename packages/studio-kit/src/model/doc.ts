// The studio's view of a format-3 document (contract 1.0, CHB-035 design §20–§25). A frame's edit is a Document in
// the store's log (`docs.<frameId>`); controls and tools address it by document paths: an entry's params by its id
// (`main.params.time_s`, `lights.params.logH`, `b1.params.stops`), a medium by its stage (`stages.darkroom.medium.paper`),
// the geometry and the output by their root keys. The store keeps the document's physical tree (Colls as
// `{ order, items }`), so a write goes to `['docs', f, ...physical(doc, path)]`; the log records the id-anchored path.
//
// The well-known ids are the ones newDocument makes: `main` (the main exposure, the only one) and `lights` (the
// printer lights, a filter). Tools add layers with fresh ids (`burn1`, `dodge2`, …), the retouch tools a group
// `retouch` in the print stage, ingest's dust a group `dust` in the scan stage.
import {
  Coll, getPath, indexOf, isPlainObject, resolvePath, type Id, type Mutation,
} from '@chromobench/values';
import {
  documentKind, getOp, isLinked, layerEntry, newDocument, readField, stagesOf, storedPath, termSeconds,
  type Cmy, type DarkroomMedium, type Document, type Entry, type FrameKind, type Group, type Layer, type LinkContext, type Preset, type Roll,
  type StageName, type Vec3,
} from '@chromobench/contract';
import { strip } from '@chromobench/shell';

export type { Document };

/** The main exposure's id (exactly one per document). */
export const MAIN = 'main';
/** The printer lights' id (a filter layer newDocument makes). */
export const LIGHTS = 'lights';
/** The print-stage group the retouch tools write (heal and clone layers). */
export const RETOUCH = 'retouch';
/** The scan-stage group ingest's dust detection writes. */
export const DUST = 'dust';

/** The store's mount: frames are documents at docs.<frameId>. */
export const DOCS = 'docs';

/**
 * The value at a document path, or undefined when the path does not exist in this document (another kind, an id it
 * lacks). A field of a linked medium (a frame on a roll: `stages.scan.medium.stock`) reads through the link with
 * `links` (linksOf(state)); without them only the frame's own overrides are known.
 */
export function read(doc: Document | null | undefined, path: string, links?: LinkContext): unknown {
  if (!doc) return undefined;
  try {
    return links ? readField(doc, path, links) : isLinkedField(doc, path) ? readField(doc, path) : getPath(doc, path);
  } catch {
    return undefined;
  }
}
const isLinkedField = (doc: Document, path: string): boolean => storedPath(doc, path) !== path;

/**
 * The physical path of a document path in the document's tree (where the store holds it). A field of a linked medium
 * is stored as the frame's override (contract storedPath). Throws E_PATH.
 */
export function physical(doc: Document, path: string): (string | number)[] {
  return [...resolvePath(doc, storedPath(doc, path), indexOf(doc)).phys];
}

/** The shared data of the studio's state that links resolve against, as data (it crosses to the agent's worker). */
export interface LinkData {
  rolls?: Readonly<Record<string, Roll>>;
  presets?: Readonly<Record<string, Preset>>;
}
let lastLinks: { data: LinkData; ctx: LinkContext } | null = null;
/**
 * The link data of the studio's state (CHB-037 P7): the rolls (the roll kit's `roll.rolls`) and the presets (the
 * looks kit's `looks.presets`). The same object while both are unchanged.
 */
export function linkDataOf(s: any): LinkData { // eslint-disable-line @typescript-eslint/no-explicit-any
  const rolls = strip(s?.roll?.rolls) as Record<string, Roll> | undefined;
  const presets = strip(s?.looks?.presets) as Record<string, Preset> | undefined;
  if (lastLinks && lastLinks.data.rolls === rolls && lastLinks.data.presets === presets) return lastLinks.data;
  return linkEntry(rolls, presets).data;
}
function linkEntry(rolls: Record<string, Roll> | undefined, presets: Record<string, Preset> | undefined): { data: LinkData; ctx: LinkContext } {
  const data: LinkData = { ...(rolls ? { rolls } : {}), ...(presets ? { presets } : {}) };
  lastLinks = { data, ctx: { rolls: (id) => rolls?.[id], presets: (id) => presets?.[id] } };
  return lastLinks;
}
/** The links of the studio's state as a LinkContext; the same object while the data is unchanged, so caches hold. */
export function linksOf(s: any): LinkContext { // eslint-disable-line @typescript-eslint/no-explicit-any
  const rolls = strip(s?.roll?.rolls) as Record<string, Roll> | undefined;
  const presets = strip(s?.looks?.presets) as Record<string, Preset> | undefined;
  if (lastLinks && lastLinks.data.rolls === rolls && lastLinks.data.presets === presets) return lastLinks.ctx;
  return linkEntry(rolls, presets).ctx;
}

/** The store path of a document path of frame f: ['docs', f, ...physical]. */
export function storePath(f: string, doc: Document, path: string): (string | number)[] {
  return [DOCS, f, ...physical(doc, path)];
}

/** The id-anchored path of a physical path under docs.<f> (the store's key segments after the frame id). */
export function logicalPath(doc: Document, phys: readonly (string | number)[]): string {
  const segs: string[] = [];
  let cur: unknown = doc;
  for (let i = 0; i < phys.length; i++) {
    const k = phys[i]!;
    if (Coll.is(cur) && k === 'items') continue;
    if (Coll.is(cur) && k === 'order') return [...segs, 'order'].join('.');
    if (isPlainObject(cur) && Coll.is((cur as Record<string, unknown>)[String(k)]) && phys[i + 1] === 'items' && phys[i + 2] !== undefined) {
      // a collection: the item id anchors the path (ids are unique in the whole document)
      const id = String(phys[i + 2]);
      segs.length = 0;
      segs.push(id);
      cur = ((cur as Record<string, unknown>)[String(k)] as Coll<unknown>).items[id];
      i += 2;
      continue;
    }
    segs.push(String(k));
    cur = Array.isArray(cur) ? cur[Number(k)] : isPlainObject(cur) ? cur[String(k)] : undefined;
  }
  return segs.join('.');
}

// ---- entries ---------------------------------------------------------------------------------------------------

/** An entry with where it sits: its stage, the group it is in (null: the stage's stack) and its depth. */
export interface Placed {
  id: Id;
  entry: Entry;
  stage: StageName;
  parent: Id | null;
  depth: number;
}

/** Every entry of a stage, depth first, in stack order (groups before their children). */
export function entriesOf(doc: Document, stage: StageName): Placed[] {
  const out: Placed[] = [];
  const st = doc.stages[stage];
  if (!st) return out;
  const walk = (c: Coll<Entry>, parent: Id | null, depth: number): void => {
    for (const [id, e] of Coll.entries(c)) {
      out.push({ id, entry: e, stage, parent, depth });
      if (e.kind === 'group') walk(e.stack, id, depth + 1);
    }
  };
  walk(st.stack, null, 0);
  return out;
}

/** The entry with an id anywhere in the document's stacks, with its place; undefined when there is none. */
export function findEntry(doc: Document, id: Id): Placed | undefined {
  for (const s of stagesOf(doc)) {
    const hit = entriesOf(doc, s).find((p) => p.id === id);
    if (hit) return hit;
  }
  return undefined;
}

/** The layer with an id (undefined for a group, a link, or no such entry). */
export function layerOf(doc: Document, id: Id): Layer | undefined {
  const e = findEntry(doc, id)?.entry;
  return e?.kind === 'layer' ? e : undefined;
}

/** The op of a layer id: the document's, else the well-known ids' (main: expose, lights: filter). */
export function opOfId(doc: Document | null | undefined, id: string): string | undefined {
  const l = doc ? layerOf(doc, id) : undefined;
  if (l) return l.op;
  return WELL_KNOWN[id];
}
const WELL_KNOWN: Record<string, string> = { [MAIN]: 'expose', [LIGHTS]: 'filter' };

/** A fresh entry id: prefix plus the smallest counter not used anywhere in the document (`burn1`, `burn2`). */
export function nextId(doc: Document, prefix: string): Id {
  const idx = indexOf(doc);
  let n = 1;
  while (idx.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

/** A layer's params with the op's defaults filled in (a stored layer may omit a defaulted argument). */
export function paramsOf(l: Layer): Record<string, unknown> {
  const op = getOp(l.op);
  const out: Record<string, unknown> = {};
  for (const [k, s] of Object.entries(op.args)) {
    const v = l.params[k];
    out[k] = v === undefined ? s.default : Coll.is(v) ? Coll.values(v) : v;
  }
  return out;
}

// ---- the darkroom ---------------------------------------------------------------------------------------------

/** The darkroom medium as stored (links are resolved by the compiler; the studio's frames hold plain media). */
export function darkroomMedium(doc: Document): DarkroomMedium {
  const m = doc.stages.darkroom.medium;
  return (isLinked(m) ? {} : m) as DarkroomMedium;
}

/** The main exposure's time, aperture and pack (defaults filled in). */
export function mainExposure(doc: Document): { time_s: number; fstop: number; filtration: Cmy } {
  const l = layerOf(doc, MAIN);
  const p = l ? paramsOf(l) : {};
  return { time_s: (p['time_s'] as number) ?? 10, fstop: (p['fstop'] as number) ?? 8, filtration: (p['filtration'] as Cmy) ?? { c: 0, m: 0, y: 0 } };
}

/** The printer lights (log H per layer), [0, 0, 0] when the document has no lights layer. */
export function lightsOf(doc: Document): Vec3 {
  const l = layerOf(doc, LIGHTS);
  return l ? ([...(paramsOf(l)['logH'] as number[])] as Vec3) : [0, 0, 0];
}

export type EnlargerMode = 'real' | 'normalised';
export const ENLARGER_MODES: readonly EnlargerMode[] = ['real', 'normalised'];
export const MODE_PATH = 'stages.darkroom.medium.mode';
export const TIME_PATH = `${MAIN}.params.time_s`;
export const FSTOP_PATH = `${MAIN}.params.fstop`;
export const FILTRATION_PATH = `${MAIN}.params.filtration`;
export const LIGHTS_PATH = `${LIGHTS}.params.logH`;
export const GRADE_PATH = 'stages.darkroom.medium.grade';
export const PAPER_PATH = 'stages.darkroom.medium.paper';

/** The paths that have no effect on the print in normalised mode (time, aperture, magnification). */
export const OPTICS_PATHS: ReadonlySet<string> = new Set([TIME_PATH, FSTOP_PATH, 'stages.darkroom.medium.magnification']);

/** true when the document prints in normalised mode */
export const isNormalised = (doc: Document | null | undefined): boolean => !!doc && darkroomMedium(doc).mode === 'normalised';

/** true when `path` is a control that does nothing for this document (the optics in normalised mode) */
export const isInert = (doc: Document | null | undefined, path: string): boolean => isNormalised(doc) && OPTICS_PATHS.has(path);

/** the document with its enlarger in `mode` (the same object when it already is) */
export function withEnlargerMode(doc: Document, mode: EnlargerMode): Document {
  if (darkroomMedium(doc).mode === mode) return doc;
  return { ...doc, stages: { ...doc.stages, darkroom: { ...doc.stages.darkroom, medium: { ...darkroomMedium(doc), mode } } } };
}

/** the three printer lights moved together by d log H, held to the contract's ±1.5 log H */
export const shiftLights = (l: readonly number[], d: number): Vec3 => l.map((x) => Number(Math.min(1.5, Math.max(-1.5, x + d)).toFixed(6))) as Vec3;

/** 1 stop in log H, and 1 printer point. */
const STOP = Math.log10(2);
const PT = 0.025;

/**
 * "Lighter" / "Darker" by `stops` (negative is lighter): the main exposure's time in real mode, as at an enlarger;
 * the three printer lights together in normalised mode, where the time does nothing. `lightsPoints` overrides the
 * step in normalised mode with a number of printer points (the lights pad's own step).
 */
export function exposureStep(doc: Document, stops: number, o: { lightsPoints?: number } = {}): { path: string; value: unknown } {
  if (!isNormalised(doc)) {
    const t = mainExposure(doc).time_s * 2 ** stops;
    return { path: TIME_PATH, value: Number(Math.min(600, Math.max(0.1, t)).toFixed(6)) };
  }
  const d = o.lightsPoints !== undefined ? Math.sign(stops) * o.lightsPoints * PT : stops * STOP;
  return { path: LIGHTS_PATH, value: shiftLights(lightsOf(doc), d) };
}

/** The log H an optics setting moves the paper's exposure by (core's optics law: log t − 2 log N − 2 log (m + 1)). */
export function opticsShift(doc: Document, path: string, value: unknown): number | null {
  if (typeof value !== 'number' || !(value > 0)) return null;
  const e = mainExposure(doc);
  if (path === TIME_PATH) return Math.log10(value / e.time_s);
  if (path === FSTOP_PATH) return -2 * Math.log10(value / e.fstop);
  if (path === 'stages.darkroom.medium.magnification') return -2 * Math.log10((value + 1) / (darkroomMedium(doc).magnification + 1));
  return null;
}

/**
 * Mutations with no inert control in them: on a normalised document time, aperture and magnification do nothing,
 * so a set of one becomes the same exposure on the printer lights (as Lighter / Darker and the test strip do), and
 * the optics keep their value. The studio's own edits that copy settings between documents (looks, a roll's match,
 * Apply Print Settings) pass through it; a mode change earlier in the list counts for the sets after it.
 */
export function withoutInert(doc: Document, ms: readonly Mutation[]): Mutation[] {
  let normal = isNormalised(doc);
  let lights = lightsOf(doc);
  const out: Mutation[] = [];
  for (const m of ms) {
    if (m.op === 'set' && m.path === MODE_PATH) normal = m.value === 'normalised';
    if (m.op === 'set' && normal && OPTICS_PATHS.has(m.path)) {
      const d = opticsShift(doc, m.path, m.value);
      if (d !== null && Math.abs(d) > 1e-9) {
        lights = shiftLights(lights, d);
        out.push({ op: 'set', path: LIGHTS_PATH, value: lights });
      }
      continue;
    }
    if (m.op === 'set' && m.path === LIGHTS_PATH) lights = [...(m.value as number[])] as Vec3;
    out.push(m);
  }
  return out;
}

// ---- the printing script (the Exposures panel's footer) -------------------------------------------------------

/** Seconds the light law gives a darkroom contribution (termSeconds of the contract's light law), amount applied. */
export function layerSeconds(l: Layer, tMain: number): number {
  return termSeconds(l.op, paramsOf(l), tMain) * l.amount;
}

/** "Expose 12.0 s, hold back face for 1.91 s; burn sky 4.97 s; flash 2.0 s." */
export function printingScript(doc: Document, fmt: { seconds: (t: number) => string }): string {
  const main = mainExposure(doc);
  const head: string[] = [`expose ${fmt.seconds(main.time_s)} s`];
  const parts: string[] = [];
  for (const p of entriesOf(doc, 'darkroom')) {
    const e = p.entry;
    if (e.kind !== 'layer' || !e.enabled || e.amount === 0) continue;
    // where: the mask's name in the library (what the photographer called it), else the whole sheet
    const where = e.mask ? (Coll.get(doc.masks, e.mask)?.name ?? e.mask) : 'the sheet';
    if (e.op === 'dodge') head.push(`hold back ${where} for ${fmt.seconds(layerSeconds(e, main.time_s))} s`);
    else if (e.op === 'burn') parts.push(`burn ${where} ${fmt.seconds(layerSeconds(e, main.time_s))} s`);
    else if (e.op === 'flash') parts.push(`flash ${fmt.seconds(layerSeconds(e, main.time_s))} s`);
    else if (e.op === 'preflash') parts.push(`preflash ${Number(((paramsOf(e)['fraction'] as number) * 100).toFixed(1))} %`);
  }
  const s = [head.join(', '), ...parts].join('; ');
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}

/** A new darkroom layer of a kind, at its usual starting values (a burn of ½ stop, a 2 s flash, a contrast mask). */
export function newDarkroomLayer(op: 'burn' | 'dodge' | 'flash' | 'preflash' | 'densityMask', o: { mask?: string | null; name?: string } = {}): Layer {
  const params = op === 'flash' ? { time_s: 2 } : op === 'preflash' ? { fraction: 0.02 } : op === 'densityMask' ? { gamma: 0.5, radius_um: 300, polarity: 'positive' } : { stops: 0.5 };
  const names: Record<string, string> = { burn: 'Burn', dodge: 'Dodge', flash: 'Flash', preflash: 'Preflash', densityMask: 'Contrast mask' };
  return layerEntry(op, params, { name: o.name ?? names[op]!, mask: o.mask ?? null });
}

// ---- documents of the studio -----------------------------------------------------------------------------------

/** What the studio calls a frame's kind. */
export type { FrameKind };
export const kindOfDoc = documentKind;

/** A group (by id) of a stage, or undefined. */
export function groupOf(doc: Document, id: Id): Group | undefined {
  const e = findEntry(doc, id)?.entry;
  return e?.kind === 'group' ? e : undefined;
}

/** A neutral document for a decoded source (the first print replaces it on open). */
export function defaultDocument(kind: FrameKind, src: { sha256: string; name?: string; width: number; height: number }, frame?: string): Document {
  return newDocument(kind, { sha256: src.sha256, ...(src.name ? { name: src.name } : {}), width: src.width, height: src.height }, frame ? { frame } : {});
}
