// The diff pass (guide §5.4; CHB-037: documents): which document paths differ between two documents, and by how
// much, in units a darkroom person reads — seconds and stops, printer points, CC, f-stops, names. Layers are
// compared by id (one present on one side only is one change); masks by id. One pass feeds the survey captions,
// the Amount result line, approval cards, "what changed since the snapshot" and the agent's looks provider.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { canonicalJSON, Coll } from '@chromobench/values';
import { LOGH_PER_POINT, stagesOf, type Document, type Entry, type Unit } from '@chromobench/contract';
import { entriesOf, read } from '../../../../src/model/doc.ts';
import { formatStops, signed } from '../../../../src/model/units.ts';
import { groupOf, type SyncGroups, SYNC_GROUPS } from './groups.ts';
import { settablePaths, specAt } from './paths.ts';

export interface DiffEntry {
  path: string;
  a: unknown;
  b: unknown;
  unit: Unit | null;
  /** in the path's working space: stops for times and f-numbers, points for lights, the stored unit otherwise */
  delta?: number | number[];
  /** the whole change: "time 12.0 → 15.1 s (+1/3 st)" */
  shown: string;
  /** the change alone: "+1/3 st", "R +4.0 pt, B −2.0 pt", "2 → 3" */
  short: string;
  /** short label of the path: time, lights, grade, paper, burn b1 stops */
  label: string;
  group: string | null;
}

const LABELS: Record<string, string> = {
  'main.params.time_s': 'time', 'main.params.fstop': 'aperture', 'main.params.filtration': 'filtration', 'stages.darkroom.medium.magnification': 'magnification',
  'stages.darkroom.medium.mode': 'enlarger mode', 'stages.darkroom.medium.lamp': 'lamp', 'lights.params.logH': 'lights', 'lights.source': 'auto lights', 'stages.darkroom.medium.grade': 'grade',
  'stages.darkroom.medium.paper': 'paper', 'stages.darkroom.medium.aim': 'aim', 'stages.scan.medium.stock': 'film', 'stages.film.medium.stock': 'film', 'stages.film.medium.exposureEV': 'exposure',
  'stages.film.medium.push': 'push', 'stages.film.medium.halation.strength': 'halation', 'stages.film.medium.grain.amount': 'grain', 'stages.film.medium.grain.size_um': 'grain size',
  'stages.print.medium.illuminant': 'viewing light', 'stages.print.medium.flare': 'viewing flare', 'geometry.crop': 'crop', 'geometry.orientation': 'orientation',
};
export function labelOf(path: string, doc?: Document | null): string {
  if (LABELS[path]) return LABELS[path]!;
  const s = path.split('.');
  const e = doc && s[0] && !path.startsWith('stages.') && !path.startsWith('geometry.') && !path.startsWith('output.') && !path.startsWith('masks.') ? layerAt(doc, s[0]) : undefined;
  if (e) return `${e.kind === 'layer' ? e.op : 'group'} ${s[0]}${s.length > 1 ? ` ${s.slice(s[1] === 'params' ? 2 : 1).join('.')}` : ''}`.trim();
  return s.slice(-2).join(' ').replace(/_/g, ' ');
}
const layerAt = (doc: Document, id: string): Entry | undefined => {
  for (const st of stagesOf(doc)) for (const p of entriesOf(doc, st)) if (p.id === id) return p.entry;
  return undefined;
};

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const num = (x: number, d = 2): string => {
  const s = Number(x.toFixed(d)).toString();
  return s.startsWith('-') ? `−${s.slice(1)}` : s;
};
const secs = (x: number): string => x.toFixed(1);
const str = (v: unknown): string => (v === null || v === undefined ? 'none' : typeof v === 'string' ? v : isNum(v) ? num(v) : canonicalJSON(v));
const stopsText = (s: number): string => {
  const sixth = Math.round(s * 6) / 6;
  return `${Math.abs(s - sixth) < 1e-3 ? formatStops(sixth) : signed(s, 2)} st`;
};

/** Per-unit equality tolerances: float noise from Amount never shows up as a change. */
function equal(unit: Unit | null, a: unknown, b: unknown, k: number): boolean {
  if (isNum(a) && isNum(b)) {
    if (unit === 's' || unit === 'fstop') return a > 0 && b > 0 ? Math.abs(Math.log2(b / a)) < 0.002 * k : Math.abs(a - b) < 1e-9;
    if (unit === 'logH') return Math.abs(a - b) < 0.0005 * k;
    if (unit === 'CC') return Math.abs(a - b) < 0.05 * k;
    if (unit === 'K') return Math.abs(1e6 / a - 1e6 / b) < 0.5 * k;
    return Math.abs(a - b) <= 1e-6 * k * Math.max(1, Math.abs(a));
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) return a.every((x, i) => equal(unit, x, b[i], k));
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return ka.join() === kb.join() && ka.every((x) => equal(unit, (a as any)[x], (b as any)[x], k));
  }
  return canonicalJSON(a ?? null) === canonicalJSON(b ?? null);
}

/** One changed path in darkroom words (`doc`: the document that names the path's layer, for its op). */
export function describeChange(path: string, a: unknown, b: unknown, groups: SyncGroups = SYNC_GROUPS, doc?: Document | null): DiffEntry {
  const spec = specAt(path, doc);
  const unit = (spec?.unit as Unit | undefined) ?? null;
  const label = labelOf(path, doc);
  const base = { path, a, b, unit, label, group: groupOf(path, groups, doc) };
  if (a === undefined || b === undefined) {
    const short = a === undefined ? 'added' : 'removed';
    return { ...base, short, shown: `${label} ${short}` };
  }
  if (unit === 's' && isNum(a) && isNum(b)) {
    const st = a > 0 && b > 0 ? Math.log2(b / a) : null;
    const short = st === null ? `${secs(a)} → ${secs(b)} s` : stopsText(st);
    return { ...base, ...(st !== null ? { delta: st } : {}), short, shown: `${label} ${secs(a)} → ${secs(b)} s${st !== null ? ` (${stopsText(st)})` : ''}` };
  }
  if (unit === 'fstop' && isNum(a) && isNum(b)) {
    const st = 2 * Math.log2(a / b);
    return { ...base, delta: st, short: stopsText(st), shown: `${label} f/${num(a, 1)} → f/${num(b, 1)} (${stopsText(st)})` };
  }
  if (unit === 'logH' && Array.isArray(a) && Array.isArray(b)) {
    const d = b.map((x, i) => (Number(x) - Number(a[i])) / LOGH_PER_POINT);
    const parts = d.map((x, i) => (Math.abs(x) < 0.05 ? null : `${'RGB'[i]} ${signed(x, 1)} pt`)).filter(Boolean) as string[];
    const short = parts.length ? parts.join(', ') : '±0 pt';
    return { ...base, delta: d.map((x) => Number(x.toFixed(4))), short, shown: `${label} ${short}` };
  }
  if (unit === 'CC' && a && b && typeof a === 'object' && typeof b === 'object') {
    const parts = (['c', 'm', 'y'] as const).filter((k) => Math.abs(Number((b as any)[k]) - Number((a as any)[k])) >= 0.05).map((k) => `${k.toUpperCase()} ${num((a as any)[k], 1)} → ${num((b as any)[k], 1)}`);
    const short = `${parts.join(', ')} CC`;
    return { ...base, delta: (['c', 'm', 'y'] as const).map((k) => Number((b as any)[k]) - Number((a as any)[k])), short, shown: `${label} ${short}` };
  }
  if (unit === 'stop' && isNum(a) && isNum(b)) {
    return { ...base, delta: b - a, short: `${formatStops(a)} → ${formatStops(b)} st`, shown: `${label} ${formatStops(a)} → ${formatStops(b)} st` };
  }
  if (unit === 'K' && isNum(a) && isNum(b)) {
    return { ...base, delta: 1e6 / b - 1e6 / a, short: `${num(a, 0)} → ${num(b, 0)} K`, shown: `${label} ${num(a, 0)} → ${num(b, 0)} K` };
  }
  if (isNum(a) && isNum(b)) {
    const u = unit && !['none', 'fraction'].includes(unit) ? ` ${unit === 'percent' ? '%' : unit}` : '';
    return { ...base, delta: b - a, short: `${num(a)} → ${num(b)}${u}`, shown: `${label} ${num(a)} → ${num(b)}${u}` };
  }
  if (Array.isArray(a) && Array.isArray(b) && a.every(isNum) && b.every(isNum)) {
    return { ...base, delta: b.map((x, i) => x - (a[i] as number)), short: `[${a.map((x) => num(x)).join(', ')}] → [${b.map((x) => num(x)).join(', ')}]`, shown: `${label} [${a.map((x) => num(x)).join(', ')}] → [${b.map((x) => num(x)).join(', ')}]` };
  }
  if (spec && (typeof a !== 'object' || a === null) && (typeof b !== 'object' || b === null)) return { ...base, short: `${str(a)} → ${str(b)}`, shown: `${label} ${str(a)} → ${str(b)}` };
  return { ...base, short: 'changed', shown: `${label} changed` };
}

export interface DiffOptions {
  /** multiplies the per-unit tolerances (default 1) */
  tolerance?: number;
  /** only these path prefixes */
  only?: readonly string[];
  groups?: SyncGroups;
}

/** The layer fields compared besides the params. */
const ENTRY_FIELDS = ['enabled', 'amount', 'mask'] as const;

/**
 * Every settable path that differs between `a` and `b` (the fixed parts, every layer by id, masks), in darkroom
 * units. A document vs itself: [].
 */
export function diffDocs(a: Document, b: Document, o: DiffOptions = {}): DiffEntry[] {
  const k = o.tolerance ?? 1;
  const want = (p: string): boolean => !o.only || o.only.some((x) => p === x || p.startsWith(`${x}.`));
  const out: DiffEntry[] = [];
  for (const path of settablePaths()) {
    if (!want(path)) continue;
    const x = read(a, path);
    const y = read(b, path);
    if (x === undefined && y === undefined) continue;
    if (equal((specAt(path, b)?.unit as Unit | undefined) ?? null, x, y, k)) continue;
    out.push(describeChange(path, x, y, o.groups, b));
  }
  // layers by id, in every stage (the main exposure and the printer lights are compared above, by their params)
  const layers = (d: Document): Map<string, Entry> => new Map(stagesOf(d).flatMap((s) => entriesOf(d, s).map((p) => [p.id, p.entry] as const)));
  const la = layers(a);
  const lb = layers(b);
  for (const id of new Set([...la.keys(), ...lb.keys()])) {
    if (!want(id)) continue;
    const x = la.get(id);
    const y = lb.get(id);
    if (!x || !y) {
      out.push(describeChange(id, x, y, o.groups, y ? b : a));
      continue;
    }
    if (x.kind !== 'layer' || y.kind !== 'layer' || x.op !== y.op) {
      if (x.kind === 'group' && y.kind === 'group') continue; // a group's children are compared by their ids
      if (canonicalJSON(x) !== canonicalJSON(y)) out.push({ ...describeChange(id, x, y, o.groups, b), short: 'changed', shown: `${labelOf(id, b)} changed` });
      continue;
    }
    for (const f of ENTRY_FIELDS) if (canonicalJSON(x[f] ?? null) !== canonicalJSON(y[f] ?? null)) out.push(describeChange(`${id}.${f}`, x[f], y[f], o.groups, b));
    if (id === 'main' || id === 'lights') continue;
    for (const p of new Set([...Object.keys(x.params), ...Object.keys(y.params)])) {
      const path = `${id}.params.${p}`;
      const xv = Coll.is(x.params[p]) ? Coll.values(x.params[p] as never) : x.params[p];
      const yv = Coll.is(y.params[p]) ? Coll.values(y.params[p] as never) : y.params[p];
      if (equal((specAt(path, b)?.unit as Unit | undefined) ?? null, xv, yv, k)) continue;
      out.push(describeChange(path, xv, yv, o.groups, b));
    }
  }
  if (want('masks')) {
    for (const id of new Set([...a.masks.order, ...b.masks.order])) {
      const x = a.masks.items[id];
      const y = b.masks.items[id];
      if (canonicalJSON(x ?? null) === canonicalJSON(y ?? null)) continue;
      out.push({ path: `masks.${id}`, a: x, b: y, unit: null, label: `mask ${id}`, short: x === undefined ? 'added' : y === undefined ? 'removed' : 'changed', shown: `mask ${id} ${x === undefined ? 'added' : y === undefined ? 'removed' : 'changed'}`, group: groupOf(`masks.${id}`, o.groups) });
    }
  }
  return out;
}

/** "time +1/3 st, lights R +2.0 pt, B −2.0 pt" (the first `max` entries, then "+n more"); "no change" when empty */
export function summary(entries: readonly DiffEntry[], max = 3): string {
  if (!entries.length) return 'no change';
  const head = entries.slice(0, max).map((e) => `${e.label} ${e.short}`);
  return entries.length > max ? `${head.join(', ')}, +${entries.length - max} more` : head.join(', ');
}

export interface AggregateEntry {
  path: string;
  label: string;
  /** frames with this change */
  frames: number;
  /** the change when it is the same on every frame, else the range */
  short: string;
}
/** Diff entries of many frames merged by path (the batch card: "lights R +1.2 pt, B −1.2 pt on all 23"). */
export function aggregate(perFrame: readonly (readonly DiffEntry[])[]): AggregateEntry[] {
  const by = new Map<string, DiffEntry[]>();
  for (const es of perFrame) for (const e of es) by.set(e.path, [...(by.get(e.path) ?? []), e]);
  return [...by].map(([path, es]) => {
    const shorts = new Set(es.map((e) => e.short));
    let short = es[0]!.short;
    if (shorts.size > 1) {
      const ds = es.map((e) => e.delta).filter(isNum);
      short = ds.length === es.length ? `${num(Math.min(...ds))} … ${num(Math.max(...ds))}${es[0]!.unit === 's' || es[0]!.unit === 'fstop' ? ' st' : ''}` : 'varies';
    }
    return { path, label: es[0]!.label, frames: es.length, short };
  });
}
