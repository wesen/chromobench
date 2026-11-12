// The diff pass (guide §5.4): which recipe paths differ between two recipes, and by how much, in units a darkroom
// person reads — seconds and stops, printer points, CC, f-stops, names. One pass feeds the survey captions, the
// Amount result line, approval cards, "what changed since the snapshot" and cb.looks.diff in the DSL.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { canonicalJSON, fieldPattern, fieldSpec, getPath, LOGH_PER_POINT, settablePaths, type FrameRecipe, type Unit } from '@chromobench/contract';
import { formatStops, signed } from '../../../../src/model/units.ts';
import { groupOf, type SyncGroups, SYNC_GROUPS } from './groups.ts';

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
  'print.enlarger.time_s': 'time', 'print.enlarger.fstop': 'aperture', 'print.enlarger.filtration': 'filtration', 'print.enlarger.magnification': 'magnification',
  'print.enlarger.mode': 'enlarger mode', 'print.enlarger.lamp': 'lamp', 'print.lights.logH': 'lights', 'print.lights.auto': 'auto lights', 'print.grade': 'grade', 'print.preflash': 'preflash',
  'print.paper': 'paper', 'print.aim': 'aim', 'scan.stock': 'film', 'capture.stock': 'film', 'capture.exposureEV': 'exposure', 'capture.development.push': 'push',
  'capture.development.halation.strength': 'halation', 'capture.development.grain.amount': 'grain', 'capture.development.grain.size_um': 'grain size', 'finishing.look': 'look amount',
  'view.illuminant': 'viewing light', 'view.flare': 'viewing flare',
};
export function labelOf(path: string): string {
  if (LABELS[path]) return LABELS[path]!;
  const s = path.split('.');
  if (s[0] === 'print' && s[1] === 'exposures') return `exposure ${s[2]} ${s.slice(3).join('.')}`.trim();
  return s.slice(-2).join(' ').replace(/_/g, ' ');
}

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

/** One changed path in darkroom words. */
export function describeChange(path: string, a: unknown, b: unknown, groups: SyncGroups = SYNC_GROUPS): DiffEntry {
  const spec = fieldSpec(fieldPattern(path) ?? '');
  const unit = (spec?.unit as Unit | undefined) ?? null;
  const label = labelOf(path);
  const base = { path, a, b, unit, label, group: groupOf(path, groups) };
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

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function keysAt(r: unknown, prefix: string): string[] {
  const v = prefix ? getPath(r, prefix) : r;
  if (Array.isArray(v)) return v.filter(isObj).map((e) => String(e['id']));
  if (isObj(v)) return Object.keys(v);
  return [];
}
/** concrete paths of a pattern over two recipes (exposure ids, record keys) */
function expandBoth(a: FrameRecipe, b: FrameRecipe, pattern: string): string[] {
  let paths: string[] = [''];
  for (const seg of pattern.split('.')) {
    const next: string[] = [];
    for (const p of paths) {
      if (seg !== '*') next.push(p ? `${p}.${seg}` : seg);
      else for (const k of new Set([...keysAt(a, p), ...keysAt(b, p)])) next.push(`${p}.${k}`);
    }
    paths = next;
  }
  return paths;
}

export interface DiffOptions {
  /** multiplies the per-unit tolerances (default 1) */
  tolerance?: number;
  /** only these path prefixes */
  only?: readonly string[];
  groups?: SyncGroups;
}

/** Every settable path that differs between `a` and `b` (plus masks), in darkroom units. A recipe vs itself: []. */
export function diffRecipes(a: FrameRecipe, b: FrameRecipe, o: DiffOptions = {}): DiffEntry[] {
  const k = o.tolerance ?? 1;
  const want = (p: string): boolean => !o.only || o.only.some((x) => p === x || p.startsWith(`${x}.`));
  const out: DiffEntry[] = [];
  const seen = new Set<string>();
  for (const pattern of settablePaths()) {
    for (const path of pattern.includes('*') ? expandBoth(a, b, pattern) : [pattern]) {
      if (seen.has(path) || !want(path)) continue;
      seen.add(path);
      const x = getPath(a, path);
      const y = getPath(b, path);
      if (x === undefined && y === undefined) continue;
      const spec = fieldSpec(pattern);
      // an exposure that exists on one side only is one change, not one per field
      if (pattern.startsWith('print.exposures.*.') && (x === undefined || y === undefined)) {
        const id = path.split('.')[2]!;
        const p = `print.exposures.${id}`;
        if (!seen.has(p)) {
          seen.add(p);
          out.push(describeChange(p, getPath(a, p), getPath(b, p), o.groups));
        }
        continue;
      }
      if (equal((spec?.unit as Unit | undefined) ?? null, x, y, k)) continue;
      out.push(describeChange(path, x, y, o.groups));
    }
  }
  if (want('masks')) {
    for (const id of new Set([...Object.keys(a.masks ?? {}), ...Object.keys(b.masks ?? {})])) {
      const x = a.masks?.[id];
      const y = b.masks?.[id];
      if (canonicalJSON(x ?? null) === canonicalJSON(y ?? null)) continue;
      out.push({ path: `masks.${id}`, a: x, b: y, unit: null, label: `mask ${id}`, short: x === undefined ? 'added' : 'changed', shown: `mask ${id} ${x === undefined ? 'added' : 'changed'}`, group: groupOf(`masks.${id}`, o.groups) });
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
