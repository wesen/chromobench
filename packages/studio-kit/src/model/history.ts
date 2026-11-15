// History (guide §5.8; CHB-037): the frame's part of the store's document log in the photographer's words. The
// log has one cursor for every document; a frame's history is the steps that touched it (in effect, and the redo
// tail), each described from the document as it was before it: "Time 7.94 → 10.0 s (+⅓ stop)", "Added a burn",
// "Rotated right". No paths, ids or JSON.
import { applyTransaction, canonicalJSON, getPath, type Author, type Log, type Mutation } from '@chromobench/values';
import type { Document, Orientation } from '@chromobench/contract';
import { composeOrientation } from '../../kits/finish/src/geometry.ts';
import { componentOf, type ControlModel } from './controls.ts';
import { findEntry, read } from './doc.ts';
import { formatSeconds, fstopMarkStops, num, stopWords } from './units.ts';

export interface Change {
  seq: number;
  text: string;
}

/** One step of the log that touched the frame. */
export interface HistoryRow {
  /** the log's cursor after this step (History jumps there) */
  cursor: number;
  by: Author;
  at: number;
  label: string;
  changes: Change[];
  inEffect: boolean;
  approved: boolean;
  /** the step also changed other frames (a batch over a roll) */
  batch: boolean;
}

export const WHO: Record<Author, string> = { user: 'You', agent: 'Agent', auto: 'Auto' };

export type ModelLookup = (path: string, doc?: Document) => ControlModel | undefined;

/** Finds the control model for a document path (a layer's argument by its op's argument, whatever the entry's id). */
export function lookupFor(models: readonly ControlModel[], layer?: (path: string, doc?: Document) => ControlModel | null): ModelLookup {
  const by = new Map(models.map((m) => [m.path, m]));
  return (p, doc) => by.get(p) ?? layer?.(p, doc) ?? undefined;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** What the eight orientations of output.frame did, in the Frame menu's words (CHB-031 F32: not "transpose → flipH"). */
const MIRRORED = new Set<string>(['flipH', 'flipV', 'transpose', 'transverse']);
export function orientationWords(from: Orientation, to: Orientation): string {
  if (from === to) return 'Orientation unchanged';
  const steps: [Parameters<typeof composeOrientation>[1], string][] = [['cw90', 'Rotated right'], ['ccw90', 'Rotated left'], ['flipH', 'Flipped left to right'], ['flipV', 'Flipped top to bottom']];
  for (const [step, words] of steps) if (composeOrientation(from, step) === to) return words;
  if (composeOrientation(composeOrientation(from, 'cw90'), 'cw90') === to) return 'Rotated 180°';
  return MIRRORED.has(from) !== MIRRORED.has(to) ? 'Rotated and flipped' : 'Rotated';
}

/** Names for document paths that have no control model (boxes, records, objects), by path or prefix. */
const PATH_NAMES: Record<string, string> = {
  'stages.scan.medium.baseT': 'Film base',
  'stages.scan.medium.rebate': 'Film edge',
  'stages.scan.medium.openGate': 'Open gate',
  'output.display.proof': 'Soft proof',
  'output.printer': 'Printer',
  'geometry.crop': 'Crop',
};
/** A readable name for a document path: the table, else its last segments as words ("output.export.dpi" → "Export dpi"). */
export function pathName(path: string): string {
  const segs = path.split('.');
  for (let n = segs.length; n > 0; n--) {
    const name = PATH_NAMES[segs.slice(0, n).join('.')];
    if (name) return n < segs.length && !/^\d+$/.test(segs[n]!) ? `${name} ${segs.slice(n).join(' ')}` : name;
  }
  const words = segs
    .filter((s) => !['stages', 'scan', 'scene', 'film', 'darkroom', 'print', 'medium', 'params', 'output', 'geometry'].includes(s))
    .slice(-2)
    .map((s) => s.replace(/_(s|px|um|mm|deg|K)$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase());
  return cap(words.join(' ') || path);
}

/** A value without a model, in words: numbers and names as they are, an object or a box as nothing (set/changed). */
function plainValue(v: unknown): string | null {
  if (typeof v === 'number') return num(v, Math.abs(v) >= 100 || Number.isInteger(v) ? 0 : 2);
  if (typeof v === 'string') return v.replace(/_/g, ' ');
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (Array.isArray(v) && v.every((x) => typeof x === 'number')) return `(${v.map((x) => num(x, Number.isInteger(x) ? 0 : 2)).join(', ')})`;
  return null;
}

/** A change of a path without a control model: "Crop set", "Export dpi 300 → 600". */
function plainChange(name: string, old: unknown, value: unknown): string {
  if (old === undefined || old === null) return value === null || value === undefined ? `${name} unchanged` : `${name} set${plainValue(value) !== null && !isObj(value) ? ` to ${plainValue(value)}` : ''}`;
  if (value === null || value === undefined) return `${name} removed`;
  const a = plainValue(old);
  const b = plainValue(value);
  return a !== null && b !== null ? `${name} ${a} → ${b}` : `${name} changed`;
}

/** The changed components of a vec3 / cmy value: "Filtration Y 0 → +20 CC", "Printer lights −4 pt (all three)". */
function componentChange(model: ControlModel, old: unknown, value: unknown): string | null {
  if ((model.type !== 'vec3' && model.type !== 'cmy') || !model.components) return null;
  const unit = /(\s\S+)$/.exec(model.format(value, 0))?.[1] ?? '';
  const num1 = (v: unknown, k: number): string => model.format(v, k).replace(unit, '');
  const changed = [0, 1, 2].filter((k) => num1(old, k) !== num1(value, k));
  if (!changed.length) return `${model.label} unchanged`;
  const delta = (k: number): number => model.toDisplay(componentOf(model.type, value, k)) - model.toDisplay(componentOf(model.type, old, k));
  if (changed.length === 3 && changed.every((k) => Math.abs(delta(k) - delta(0)) < model.step / 2)) {
    const d = delta(0);
    return `${model.label} ${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(model.step >= 1 ? 0 : 1)}${unit} (all three)`;
  }
  return `${model.label} ${changed.map((k) => `${model.components![k]} ${num1(old, k)} → ${num1(value, k)}`).join(', ')}${unit}`;
}

const article = (w: string): string => (/^[aeiou]/i.test(w) ? 'an' : 'a');
/** What an entry is called in a sentence: its op's word ("burn", "contrast mask", "heal spot"), or a group's name. */
function entryWord(e: { kind: string; op?: string; name?: string }): string {
  if (e.kind === 'group') return `group "${e.name}"`;
  const words: Record<string, string> = { expose: 'main exposure', densityMask: 'contrast mask', filter: 'filter', heal: 'heal spot', clone: 'clone spot', preflash: 'preflash' };
  return words[e.op ?? ''] ?? e.op ?? 'layer';
}

/**
 * One line for a mutation, in the photographer's words and units (CHB-031 F32): "Time 7.94 → 10.0 s (+⅓ stop)",
 * "Aperture f/8 → f/9 (−⅓ stop)", "Filtration Y 0 → +20 CC", "Rotated right", "Crop set", "Added a burn".
 */
export function describe(m: Mutation, before: Document, lookup: ModelLookup): string {
  switch (m.op) {
    case 'set': {
      const old = read(before, m.path);
      if (m.path === 'geometry.orientation' && typeof old === 'string' && typeof m.value === 'string') return orientationWords(old as Orientation, m.value as Orientation);
      if (m.path === 'geometry.crop') return plainChange('Crop', old, m.value);
      const model = lookup(m.path, before);
      if (model) {
        const parts = componentChange(model, old, m.value);
        if (parts) return parts;
        const a = model.format(old);
        const b = model.format(m.value);
        const ma = /^(.*) (\S+)$/.exec(a);
        const mb = /^(.*) (\S+)$/.exec(b);
        // a shared unit is written once (Time 10.0 → 12.6 s); names (Kodak Portra Endura) are not units
        const numeric = model.type !== 'string' && model.type !== 'enum';
        const text = numeric && ma && mb && ma[2] === mb[2] ? `${model.label} ${ma[1]} → ${b}` : `${model.label} ${a} → ${b}`;
        // the change in stops: of time (longer is more light) and of the lens (a larger f-number is less light)
        const both = typeof old === 'number' && typeof m.value === 'number' && old > 0 && m.value > 0;
        const stops = !both ? null : model.storageUnit === 's' ? Math.log2((m.value as number) / (old as number)) : model.storageUnit === 'fstop' ? fstopMarkStops(old as number, m.value as number) : null;
        const who = /^([^.]+)\.params\./.exec(m.path)?.[1];
        const owner = who && who !== 'main' && who !== 'lights' ? findEntry(before, who)?.entry : undefined;
        const prefix = owner ? `${cap(owner.name || entryWord(owner))}: ` : '';
        return `${prefix}${stops !== null ? `${text} (${stopWords(stops)})` : text}`;
      }
      const en = /^([^.]+)\.(enabled|amount|mask|name|blend)$/.exec(m.path);
      const owner = en ? findEntry(before, en[1]!)?.entry : undefined;
      if (en && owner) {
        const name = cap(owner.name || entryWord(owner));
        if (en[2] === 'enabled') return `${name} ${m.value ? 'on' : 'off'}`;
        if (en[2] === 'amount' && typeof m.value === 'number') return `${name} amount ${Math.round(Number(old ?? 1) * 100)} → ${Math.round(m.value * 100)} %`;
        if (en[2] === 'mask') return m.value ? `${name} through a mask` : `${name} without its mask`;
        return plainChange(`${name} ${en[2]}`, old, m.value);
      }
      const p = /^([^.]+)\.params\.(\w+)/.exec(m.path);
      const layer = p ? findEntry(before, p[1]!)?.entry : undefined;
      if (p && layer) {
        if (p[2] === 'time_s' && typeof m.value === 'number') return `${cap(layer.name || entryWord(layer))} time → ${formatSeconds(m.value)} s`;
        if (p[2] === 'stops' && typeof m.value === 'number') return `${cap(layer.name || entryWord(layer))} ${stopWords(layer.kind === 'layer' && layer.op === 'dodge' ? -m.value : m.value)}`;
        return plainChange(`${cap(layer.name || entryWord(layer))} ${pathName(p[2]!).toLowerCase()}`, old, m.value);
      }
      const probe = /^([^.]+)$/.exec(m.path);
      if (probe && before.probes.items[probe[1]!]) return m.value === undefined ? `Probe ${probe[1]} removed` : `Probe ${probe[1]} moved`;
      return plainChange(pathName(m.path), old, m.value);
    }
    case 'insert': {
      const it = m.item as { kind?: string; op?: string; name?: string; params?: { stops?: number; time_s?: number } } | undefined;
      if (m.coll === 'masks') return 'Mask drawn';
      if (m.coll === 'probes') return `Probe ${m.id} placed`;
      if (it?.kind === 'layer' || it?.kind === 'group') {
        const w = entryWord(it as { kind: string });
        const pr = it.params ?? {};
        const how = typeof pr.stops === 'number' ? ` (${stopWords(it.op === 'dodge' ? -pr.stops : pr.stops)})` : typeof pr.time_s === 'number' && it.op !== 'expose' ? ` (${formatSeconds(pr.time_s)} s)` : '';
        return `Added ${article(w)} ${w}${how}`;
      }
      return `Added ${m.id}`;
    }
    case 'remove': {
      const e = findEntry(before, m.id)?.entry;
      if (e) return `Removed the ${entryWord(e)}`;
      if (before.masks.items[m.id]) return 'Mask removed';
      if (before.probes.items[m.id]) return `Probe ${m.id} removed`;
      return `Removed ${m.id}`;
    }
    case 'move': {
      const e = findEntry(before, m.id)?.entry;
      return e ? `Moved the ${entryWord(e)}${m.into ? ' into a group' : ''}` : `Moved ${m.id}`;
    }
  }
}

/** The steps of the log that touched frame f, oldest first (in effect, then the redo tail), in words. */
export function historyRows(log: Log, f: string, lookup: ModelLookup): HistoryRow[] {
  const out: HistoryRow[] = [];
  let d = log.initial<Document>(f);
  log.steps.forEach((st, i) => {
    const mine = st.seqs.map((s) => log.entry(s)!).filter((e) => e.doc === f);
    if (!mine.length) return;
    const changes: Change[] = [];
    let approved = false;
    for (const e of mine) {
      approved ||= e.approvedBy === 'user';
      let cur = d;
      for (const m of e.tx.mutations) {
        changes.push({ seq: e.seq, text: describe(m, cur, lookup) });
        try {
          cur = applyTransaction(cur, { ...e.tx, mutations: [m], inverses: [] }).doc;
        } catch {
          // a mutation that does not apply here (beyond the cursor after a branch) is shown, not folded
        }
      }
      d = cur;
    }
    const first = mine[0]!;
    out.push({ cursor: i + 1, by: first.tx.by, at: first.at, label: st.label, changes, inEffect: i < log.cursor, approved, batch: log.docsOf(st).length > 1 });
  });
  return out;
}

/** "Why is Yellow 62.5 CC?" rows from the log's trail of the path, plus pending proposals on the path. */
export interface WhyRow { when: string; who: string; text: string; note: string }

export function whyRows(log: Log, f: string, path: string, lookup: ModelLookup): { title: string; rows: WhyRow[]; now: string } {
  const doc = log.doc<Document>(f);
  const model = lookup(path, doc);
  const fmt = (v: unknown): string => (v === undefined ? '—' : model ? model.format(v) : short(v));
  const time = (ts: number): string => new Date(ts).toTimeString().slice(0, 5);
  const rows: WhyRow[] = [];
  let prev: unknown;
  let trail: ReturnType<Log['trail']> = [];
  try {
    trail = log.trail(f, path);
  } catch {
    trail = [];
  }
  for (const w of trail) {
    if (w.seq === 0) rows.push({ when: 'opened', who: WHO[w.by], text: fmt(w.value), note: String(w.source['kind'] ?? 'open') });
    else rows.push({ when: time(w.at), who: WHO[w.by], text: `${fmt(prev)} → ${fmt(w.value)}`, note: `${w.label}${w.approvedBy ? ' · approved' : ''}` });
    prev = w.value;
  }
  for (const e of log.pending(f)) {
    for (const m of e.tx.mutations) if (m.op === 'set' && m.path === path) rows.push({ when: time(e.at), who: WHO[e.tx.by], text: `${fmt(read(doc, path))} → ${fmt(m.value)}`, note: `${e.tx.label} · pending` });
  }
  const now = fmt(read(doc, path));
  return { title: `Why is ${model?.label ?? pathName(path)} ${now}?`, rows, now };
}

function short(v: unknown): string {
  const s = canonicalJSON(v);
  return s.length > 40 ? `${s.slice(0, 37)}…` : s;
}

export { getPath };
