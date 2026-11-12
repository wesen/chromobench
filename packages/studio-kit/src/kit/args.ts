// cb.arg's model (guide §5.1): a recipe path → CHB-009's ControlModel (from ArgSpec.ui, contract 0.2), a component
// of a vec3/cmy control, darkroom steps ('1/3 st', '5 CC', '2 pt') and typed entry in darkroom units
// ('15.12 s', '+1/3 st', '+4 pt', '62.5 CC', 'f/8') on top of the shell's arithmetic ('*2', '50%').
import { allOps, closest, fieldPattern, fieldSpec, type Vec3 } from '@chromobench/contract';
import { parseValue } from '@chromobench/shell';
import { componentOf, generateControls, withComponent, type ControlModel } from '../model/controls.ts';
import { fstopIndex, PT, timeAtStops } from '../model/units.ts';

let MODELS: ControlModel[] | null = null;
export const controlModels = (): ControlModel[] => (MODELS ??= generateControls(allOps()));
export const controlPaths = (): string[] => controlModels().map(m => m.path);

export interface ArgModel {
  model: ControlModel;
  /** the recipe path the control writes (the whole vec3/cmy for a component) */
  path: string;
  /** the component index (vec3 0–2, cmy c/m/y → 0–2), or null for the whole value */
  component: number | null;
}

const COMPONENT_KEYS: Record<string, number> = { c: 0, m: 1, y: 2, r: 0, g: 1, b: 2, '0': 0, '1': 1, '2': 2 };

/** Resolve a cb.arg path; null when no generated control owns it. */
export function argModel(path: string): ArgModel | null {
  const by = controlModels();
  const m = by.find(x => x.path === path);
  if (m) return { model: m, path, component: null };
  const i = path.lastIndexOf('.');
  if (i > 0) {
    const base = by.find(x => x.path === path.slice(0, i));
    const k = COMPONENT_KEYS[path.slice(i + 1).toLowerCase()];
    if (base && k !== undefined && (base.type === 'vec3' || base.type === 'cmy')) return { model: base, path: base.path, component: k };
  }
  return null;
}

export type ArgProblem =
  | { code: 'CB-A101'; message: string; fix?: string; valid: string[] }
  | { code: 'CB-A102'; message: string };

/** Why a path cannot be a control (CB-A101 unknown, CB-A102 no ui hints), or null. */
export function argProblem(path: string): ArgProblem | null {
  if (argModel(path)) return null;
  if (fieldPattern(path)) {
    const s = fieldSpec(fieldPattern(path)!);
    return { code: 'CB-A102', message: `cb.arg('${path}'): the recipe path has no ui hints${s ? ` (${s.type})` : ''}, so no control is generated` };
  }
  const valid = controlPaths();
  const guess = closest(path, valid) ?? valid.find(c => c.startsWith(path) && path.length >= 3);
  return { code: 'CB-A101', message: `cb.arg('${path}'): no recipe path ${path}`, ...(guess ? { fix: `cb.arg('${guess}')` } : {}), valid };
}

// ── darkroom steps ──
export interface Step {
  value: number;
  unit: 'st' | 'CC' | 'pt' | 's' | null;
}
const STEP_RE = /^\s*([+-]?\d+(?:\.\d+)?)(?:\s*\/\s*(\d+))?\s*(st|stop|stops|CC|cc|pt|pts|points?|s)?\s*$/;
export function parseStep(x: unknown): Step | null {
  if (typeof x === 'number') return { value: x, unit: null };
  if (typeof x !== 'string') return null;
  const m = STEP_RE.exec(x);
  if (!m) return null;
  const v = Number(m[1]) / (m[2] ? Number(m[2]) : 1);
  const u = m[3] ? (/^st/.test(m[3]) ? 'st' : /^cc$/i.test(m[3]) ? 'CC' : /^p/.test(m[3]) ? 'pt' : 's') : null;
  return { value: v, unit: u };
}
/** the units a control's step may be written in */
export function stepUnits(m: ControlModel): Step['unit'][] {
  if (m.storageUnit === 's' && m.scale === 'log2') return ['st', null];
  if (m.storageUnit === 'fstop') return ['st', null];
  if (m.storageUnit === 'CC') return ['CC', null];
  if (m.displayUnit === 'point') return ['pt', null];
  return [null];
}

/** One step of `dir` (±1, or a fraction for fine) from v, in storage units. */
export function stepValue(a: ArgModel, v: unknown, dir: number, step: Step | null): unknown {
  const m = a.model;
  const k = a.component;
  const cur = k === null ? (v as number) : componentOf(m.type, v, k);
  let next: number;
  if (m.storageUnit === 's' && m.scale === 'log2') next = timeAtStops(cur, dir * (step?.value ?? m.step));
  else if (m.storageUnit === 'fstop') next = nominalF(cur, dir * Math.round((step?.value ?? 1 / 3) * 3));
  else if (m.displayUnit === 'point') next = cur + dir * (step?.value ?? m.step) * PT;
  else next = m.fromDisplay(m.toDisplay(cur) + dir * (step?.value ?? m.step));
  if (m.min !== undefined) next = Math.max(m.min, next);
  if (m.max !== undefined) next = Math.min(m.max, next);
  next = Number(next.toFixed(6));
  return k === null ? next : withComponent(m.type, v, k, next);
}
function nominalF(n: number, thirds: number): number {
  const series = [1, 1.1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5, 5.6, 6.3, 7.1, 8, 9, 10, 11, 13, 14, 16, 18, 20, 22, 25, 29, 32, 36, 40, 45, 51, 57, 64];
  const i = Math.max(0, Math.min(series.length - 1, fstopIndex(n) + thirds));
  return series[i]!;
}

// ── typed entry ──
const ENTRY_RE = /^\s*([+−-])?\s*(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+))?(?:\s+(\d+)\/(\d+))?\s*(st|stops?|s|sec|pt|pts|points?|CC|cc)?\s*$/;

/**
 * A typed value → the new stored value, or null when it does not parse. A relative entry needs a sign and a unit
 * (CHB-031 F8): '+1/3 st' on 10 s → 12.599 s; '−5 s' → 5 s; '+4 pt' adds 0.1 log H; '−5 CC' subtracts. A plain
 * number sets the value: '4' and '−2' set points, '−10' sets a filtration shift. A bare sign on a control that
 * cannot be negative (time, aperture: '−5') is refused (null), so it is never read as "5 less" or as −5 s.
 */
export function parseEntry(a: ArgModel, text: string, current: unknown): unknown {
  const m = a.model;
  const k = a.component;
  const cur = k === null ? (current as number) : componentOf(m.type, current, k);
  // a decimal comma (German '7,5', '+2,5 st') reads as a point
  const t = text.trim().replace(/(\d),(\d)/g, '$1.$2');
  const put = (x: number): unknown => {
    const y = Number(x.toFixed(6));
    return k === null ? y : withComponent(m.type, current, k, y);
  };
  const f = /^f\s*\/\s*(\d+(?:\.\d+)?)$/i.exec(t);
  if (f) return m.storageUnit === 'fstop' ? put(Number(f[1])) : null;
  const e = ENTRY_RE.exec(t);
  if (e) {
    const sign = e[1] ? (e[1] === '+' ? 1 : -1) : 0;
    let x = Number(e[2]) / (e[3] ? Number(e[3]) : 1);
    if (e[4]) x += Number(e[4]) / Number(e[5]);
    const unit = e[6] ? (/^st/.test(e[6]) ? 'st' : /^s/.test(e[6]) ? 's' : /^p/.test(e[6]) ? 'pt' : 'CC') : null;
    const isTime = m.storageUnit === 's' && m.scale === 'log2';
    if (unit === 'st') {
      if (isTime) return put(sign ? timeAtStops(cur, sign * x) : timeAtStops(cur, x));
      if (m.storageUnit === 'fstop') return put(cur / Math.sqrt(2) ** ((sign || 1) * x));
      return null;
    }
    if (unit === 's' && m.storageUnit !== 's') return null;
    if (unit === 'pt' && m.displayUnit !== 'point') return null;
    if (unit === 'CC' && m.storageUnit !== 'CC') return null;
    if (unit === 'pt') return put(sign ? cur + sign * x * PT : x * PT);
    // a sign without a unit: the signed value itself, where values can be negative (a shift, points)
    if (sign && unit === null) return isSigned(m) ? put(m.fromDisplay(sign * x)) : null;
    const disp = sign ? m.toDisplay(cur) + sign * x : x;
    return put(m.fromDisplay(disp));
  }
  // the shell's arithmetic: '*2', '50%', '12+3'
  const d = parseValue(t, { current: m.toDisplay(cur) });
  return d.ok ? put(m.fromDisplay(d.value)) : null;
}

/** true for a control whose values may be negative (printer lights, the filtration shift): a plain '−2' sets it */
export const isSigned = (m: ControlModel): boolean => (m.min ?? 0) < 0;

/** the track's range for a value: the usual range, widened by a margin to take in x, never past the hard range */
export function trackRange(sc: { min: number; max: number; step: number; hard: { min: number; max: number } }, x: number): { min: number; max: number } {
  if (!Number.isFinite(x)) return { min: sc.min, max: sc.max };
  const margin = Math.max(sc.step * 3, (sc.max - sc.min) * 0.05);
  // widen on the step grid, so the thumb keeps landing on whole steps
  const grid = (y: number, f: (n: number) => number): number => f(y / sc.step) * sc.step;
  const min = x - margin < sc.min ? Math.max(sc.hard.min, grid(x - margin, Math.floor)) : sc.min;
  const max = x + margin > sc.max ? Math.min(sc.hard.max, grid(x + margin, Math.ceil)) : sc.max;
  return { min: Number(min.toFixed(6)), max: Number(max.toFixed(6)) };
}

/** the paths .testStrip() applies to (time, filtration and its components) */
export const STRIPPABLE = new Set(['print.enlarger.time_s', 'print.enlarger.filtration', 'print.enlarger.filtration.c', 'print.enlarger.filtration.m', 'print.enlarger.filtration.y']);

export const lightsOffset = (l: Vec3, axis: number, pt: number): Vec3 => l.map((x, i) => (i === axis ? Number((x + pt * PT).toFixed(6)) : x)) as Vec3;
