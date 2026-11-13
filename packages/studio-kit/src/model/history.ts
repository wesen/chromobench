// Moved from apps/studio/src/core/history.ts (CHB-009) for CHB-019 (the original was deleted in the apps/studio migration).
// History (guide §5.8): a view of the frame's edit log. Applied units in order with the undo cursor,
// pending agent transactions, rejected entries, and labels in darkroom words from the registry.
import { applyMutation, canonicalJSON, getPath, type Author, type EditLog, type FrameRecipe, type LoggedMutation, type Mutation, type Orientation, type Provenance } from '@chromobench/contract';
import { composeOrientation } from '../../kits/finish/src/geometry.ts';
import { componentOf, type ControlModel } from './controls.ts';
import { formatSeconds, fstopMarkStops, num, stopWords } from './units.ts';

export interface Change {
  seq: number;
  text: string;
}

export interface HistoryGroup {
  tx: string;
  index: number;
  by: Author;
  ts: number;
  label: string;
  changes: Change[];
  inEffect: boolean;
  approved: boolean;
}

export interface PendingGroup {
  tx: string;
  why?: string;
  /** the cross-frame batch the entries belong to (LoggedMutation.batch, contract 0.3) */
  batch?: string;
  seqs: number[];
  changes: Change[];
}

export const WHO: Record<Author, string> = { user: 'You', agent: 'Agent', auto: 'Auto' };

export type ModelLookup = (path: string) => ControlModel | undefined;

/** Finds the control model for a path, including exposure fields and probes. */
export function lookupFor(models: readonly ControlModel[]): ModelLookup {
  const by = new Map(models.map((m) => [m.path, m]));
  return (p) => by.get(p);
}

function short(v: unknown): string {
  const s = canonicalJSON(v);
  return s.length > 40 ? `${s.slice(0, 37)}…` : s;
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

/** Names for recipe paths that have no control model (boxes, records, objects), by path or record prefix. */
const PATH_NAMES: Record<string, string> = {
  'print.lights.auto': 'Automatic balance',
  'print.densityMasks': 'Density mask',
  'retouch.spots': 'Retouch spot',
  'scan.baseT': 'Film base',
  'scan.rebate': 'Film edge',
  'scan.openGate': 'Open gate',
  'scan.dust': 'Dust',
  'scan.dust.spots': 'Dust spots',
  'view.output.display.proof': 'Soft proof',
  'view.output.printer': 'Printer',
  'finishing.hues': 'Hue',
  roll: 'Roll',
};
/** A readable name for a recipe path: the table, else its last segments as words ("view.output.export.dpi" → "Export dpi"). */
export function pathName(path: string): string {
  const segs = path.split('.');
  for (let n = segs.length; n > 0; n--) {
    const name = PATH_NAMES[segs.slice(0, n).join('.')];
    if (name) return n < segs.length && !/^\d+$/.test(segs[n]!) ? `${name} ${segs.slice(n).join(' ')}` : name;
  }
  const words = segs
    .filter((s) => !['print', 'scan', 'capture', 'view', 'output', 'values', 'finishing', 'retouch'].includes(s))
    .slice(-2)
    .map((s) => s.replace(/_(s|px|um|deg|K)$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase());
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

/** A change of a path without a control model: "Crop set", "Automatic balance changed", "Export dpi 300 → 600". */
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

/** The exposure's kind for a path under print.exposures.<id> ("Dodge", "Burn"), from the recipe before the change. */
function exposureName(before: FrameRecipe, id: string): string {
  const kind = getPath(before, `print.exposures.${id}.kind`);
  return typeof kind === 'string' ? cap(kind) : 'Exposure';
}
const article = (w: string): string => (/^[aeiou]/i.test(w) ? 'an' : 'a');

/**
 * One line for a mutation, in the photographer's words and units (CHB-031 F32): "Time 7.94 → 10.0 s (+⅓ stop)",
 * "Aperture f/8 → f/9 (−⅓ stop)", "Filtration Y 0 → +20 CC", "Rotated right", "Crop set". No paths, ids or JSON.
 */
export function describe(m: Mutation, before: FrameRecipe, lookup: ModelLookup): string {
  switch (m.op) {
    case 'set': {
      const old = getPath(before, m.path);
      if (m.path === 'view.frame.orientation' && typeof old === 'string' && typeof m.value === 'string') return orientationWords(old as Orientation, m.value as Orientation);
      if (m.path === 'view.frame.crop') return plainChange('Crop', old, m.value);
      const model = lookup(m.path);
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
        const stops = !both ? null : model.storageUnit === 's' ? Math.log2(m.value as number / (old as number)) : model.storageUnit === 'fstop' ? fstopMarkStops(old as number, m.value as number) : null;
        return stops !== null ? `${text} (${stopWords(stops)})` : text;
      }
      const ex = /^print\.exposures\.([^.]+)\.(\w+)$/.exec(m.path);
      if (ex) {
        const name = exposureName(before, ex[1]!);
        if (ex[2] === 'time_s' && typeof m.value === 'number') return `${name} time → ${formatSeconds(m.value)} s`;
        if (ex[2] === 'stops' && typeof m.value === 'number') return `${name} ${stopWords(m.value)}`;
        if (ex[2] === 'enabled') return `${name} ${m.value ? 'on' : 'off'}`;
        return plainChange(`${name} ${pathName(ex[2]!).toLowerCase()}`, getPath(before, m.path), m.value);
      }
      const probe = /^probes\.(.+)$/.exec(m.path);
      if (probe) return m.value === null ? `Probe ${probe[1]} removed` : old ? `Probe ${probe[1]} moved` : `Probe ${probe[1]} placed`;
      return plainChange(pathName(m.path), old, m.value);
    }
    case 'exposure.add': {
      const e = m.exposure;
      const how = typeof e.stops === 'number' ? ` (${stopWords(e.kind === 'dodge' ? -e.stops : e.stops)})` : typeof e.time_s === 'number' ? ` (${formatSeconds(e.time_s)} s)` : '';
      return `Added ${article(e.kind)} ${e.kind}${how}`;
    }
    case 'exposure.remove': return `Removed the ${exposureName(before, m.id).toLowerCase()}`;
    case 'mask.set': return getPath(before, `masks.${m.id}`) ? 'Mask changed' : 'Mask drawn';
    case 'frame.add': return 'Frame added';
  }
}

/** Applied units (in effect and the redo tail) with labels, oldest first. */
export function historyGroups(log: EditLog, lookup: ModelLookup): HistoryGroup[] {
  const data = log.toJSON();
  let r = data.initial;
  const out: HistoryGroup[] = [];
  data.units.forEach((u, index) => {
    const changes: Change[] = [];
    let by: Author = 'user';
    let ts = 0;
    let approved = false;
    for (const seq of u.seqs) {
      const e = data.entries[seq - 1]!;
      by = e.by;
      ts = e.ts;
      approved ||= e.approvedBy === 'user';
      changes.push({ seq, text: describe(e.m, r, lookup) });
      try {
        r = applyMutation(r, e.m).recipe;
      } catch {
        // an entry that no longer applies (beyond the cursor after a branch) is shown, not folded
      }
    }
    out.push({ tx: u.tx, index, by, ts, label: u.label, changes, inEffect: index < data.cursor, approved });
  });
  return out;
}

/** Pending agent entries grouped by transaction, described against the committed state. */
export function pendingGroups(log: EditLog, lookup: ModelLookup): PendingGroup[] {
  const by = new Map<string, LoggedMutation[]>();
  for (const e of log.pending()) by.set(e.tx ?? '', [...(by.get(e.tx ?? '') ?? []), e]);
  return [...by].map(([tx, es]) => ({
    tx,
    ...(es[0]?.why ? { why: es[0].why } : {}),
    ...(es[0]?.batch ? { batch: es[0].batch } : {}),
    seqs: es.map((e) => e.seq),
    changes: es.map((e) => ({ seq: e.seq, text: describe(e.m, log.committed, lookup) })),
  }));
}

/** Moves the undo cursor to `target` (several undos or redos at once). */
export function moveCursor(log: EditLog, target: number): void {
  while (log.cursor > target && log.undo());
  while (log.cursor < target && log.redo());
}

/** "Why is Yellow 62.5 CC?" rows from why(path), plus pending proposals on the path. */
export interface WhyRow { when: string; who: string; text: string; note: string }

export function whyRows(log: EditLog, path: string, lookup: ModelLookup): { title: string; rows: WhyRow[]; now: string } {
  const model = lookup(path);
  const fmt = (v: unknown): string => (model ? model.format(v) : short(v));
  const time = (ts: number): string => new Date(ts).toTimeString().slice(0, 5);
  const prov: Provenance[] = log.why(path);
  const rows: WhyRow[] = [];
  let prev: unknown;
  for (const p of prov) {
    if (p.seq === 0) {
      rows.push({ when: 'default', who: WHO[p.by], text: fmt(p.value), note: 'frame.add' });
    } else {
      const v = p.path === path ? p.value : getPath(log.committed, path);
      rows.push({ when: time(p.ts), who: WHO[p.by], text: `${fmt(prev)} → ${fmt(v)}`, note: `${p.tx ? `tx ${p.tx}` : ''}${p.approvedBy ? ' · approved' : ''}` });
    }
    prev = p.seq === 0 ? p.value : p.path === path ? p.value : prev;
  }
  for (const e of log.pending()) {
    if (e.m.op === 'set' && e.m.path === path) rows.push({ when: time(e.ts), who: WHO[e.by], text: `${fmt(getPath(log.committed, path))} → ${fmt(e.m.value)}`, note: `tx ${e.tx ?? ''} · pending` });
  }
  return { title: `Why is ${model?.label ?? path} ${fmt(getPath(log.committed, path))}?`, rows, now: fmt(getPath(log.committed, path)) };
}
