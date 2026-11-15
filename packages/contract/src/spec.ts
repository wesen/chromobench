// Argument specs and the per-value check shared by the binder (graph) and the document validator (layer params,
// media, mask components), so a value valid in one is valid in the other. Ported from goja-cv
// pkg/cv/graph/registry.go ArgSpec and args.go range checks. Nothing clamps (DR-2).
//
// Contract 1.0: no argument is a JSON string. A list argument is `list` with an item schema (`of`); in a document
// the same list is a Coll (design §24) and the compiler passes its items in order. `polyline` is a numeric polyline
// ([x, y, pressure] in document pixels), a value rather than a list of addressable items.
import { diag, fail, type Diagnostic } from './errors.ts';
import type { Unit } from './units.ts';

export type ArgType =
  | 'number' | 'vec3' | 'enum' | 'bool' | 'string' | 'stockId' | 'box' | 'point'
  | 'Image' | 'Mask' | 'cmy' | 'string[]' | 'list' | 'polyline';

/** Node-typed values: node ids that become inputs of the node (at top level or as fields of list items). */
export const NODE_ARG_TYPES: ReadonlySet<ArgType> = new Set(['Image', 'Mask']);

export interface UiHints {
  widget?: 'slider' | 'wheel' | 'stepper' | 'segmented' | 'toggle' | 'select' | 'box' | 'point';
  step?: number;
  detents?: number[];
  label?: string;
  group?: string;
  /** Unit shown to the photographer when it differs from the stored unit (lights: point). */
  displayUnit?: Unit;
  /** Steps as ratios: time in stops, f-numbers (CHB-009). */
  scale?: 'linear' | 'log2';
  /** Unit of a second readout (CHB-009). */
  aside?: Unit;
  /** Labels of vec3 / cmy components. */
  components?: [string, string, string];
  fmt?: string;
}

export interface Redirect {
  hint: string;
  /** Value conversion into this argument's unit; the binder renders a literal fix with it. */
  scale?: number;
}

export interface ArgSpec {
  type: ArgType;
  unit?: Unit;
  /** Hard range → E_ARG_RANGE. Applies per component for vec3 / cmy. */
  min?: number;
  max?: number;
  /** Soft range → RANGE warning. */
  usual?: [number, number];
  usualHint?: string;
  integer?: boolean;
  values?: string[];
  /** Data-pack list a stockId/string draws its valid values from (CHB-004). */
  valuesFrom?: 'stocks:film' | 'stocks:print' | 'illuminants' | 'scanners' | 'lamps';
  default?: unknown;
  /** Absent is allowed and means "automatic" / "none"; a document stores null. */
  optional?: boolean;
  /** Names agents actually type, mapped to this one (CHB-002 §11 item 10). */
  redirects?: Record<string, Redirect>;
  /** A number argument that also takes a vec3, one value per channel (R, G, B); ranges apply per component (contract 0.3, scan.flare). */
  perChannel?: boolean;
  /** `list`: the schema of one item (an object; unknown keys are refused, defaults filled). */
  of?: Readonly<Record<string, ArgSpec>>;
  /** `list`: bounds on the number of items. */
  minItems?: number;
  maxItems?: number;
  ui?: UiHints;
  doc: string;
}

export type Vec3 = [number, number, number];
export interface Box { x: number; y: number; w: number; h: number }
export interface Point { x: number; y: number }
export interface Cmy { c: number; m: number; y: number }

const isNum = (v: unknown): v is number => typeof v === 'number';

/** Normalises shapes: [x,y,w,h] → Box, [x,y] → Point, [c,m,y] → Cmy. Returns the input otherwise. */
export function normaliseShape(type: ArgType, v: unknown): unknown {
  if (type === 'box' && Array.isArray(v) && v.length === 4) return { x: v[0], y: v[1], w: v[2], h: v[3] };
  if (type === 'point' && Array.isArray(v) && v.length === 2) return { x: v[0], y: v[1] };
  if (type === 'cmy' && Array.isArray(v) && v.length === 3) return { c: v[0], m: v[1], y: v[2] };
  return v;
}

function components(type: ArgType, v: unknown): number[] | null {
  switch (type) {
    case 'number': return isNum(v) ? [v] : null;
    case 'vec3': return Array.isArray(v) && v.length === 3 && v.every(isNum) ? (v as number[]) : null;
    case 'cmy': {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o).sort().join(',');
      return keys === 'c,m,y' && isNum(o['c']) && isNum(o['m']) && isNum(o['y']) ? [o['c'], o['m'], o['y']] : null;
    }
    case 'box': {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
      const o = v as Record<string, unknown>;
      return Object.keys(o).sort().join(',') === 'h,w,x,y' && [o['x'], o['y'], o['w'], o['h']].every(isNum) ? [o['x'], o['y'], o['w'], o['h']] as number[] : null;
    }
    case 'point': {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
      const o = v as Record<string, unknown>;
      return Object.keys(o).sort().join(',') === 'x,y' && isNum(o['x']) && isNum(o['y']) ? [o['x'], o['y']] : null;
    }
    default: return null;
  }
}

function shapeHint(type: ArgType): string {
  switch (type) {
    case 'vec3': return '[r, g, b]';
    case 'cmy': return '{c, m, y}';
    case 'box': return '{x, y, w, h} or [x, y, w, h] in source pixels';
    case 'point': return '{x, y} or [x, y] in source pixels';
    case 'string[]': return 'an array of strings';
    case 'list': return 'an array of items (a Coll in a document)';
    case 'polyline': return '[[x, y, pressure], …] in document pixels';
    default: return type;
  }
}

/** Rounds a converted value for display in a fix (12 significant digits). */
export function tidy(x: number): number {
  return Number(x.toPrecision(12));
}

function formatRange(spec: ArgSpec): string {
  return `[${spec.min ?? '-∞'}, ${spec.max ?? '∞'}]`;
}

export function formatValue(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(formatValue).join(', ')}]`;
  if (v !== null && typeof v === 'object') {
    return `{${Object.entries(v as Record<string, unknown>).map(([k, x]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${formatValue(x)}`).join(', ')}}`;
  }
  return JSON.stringify(v);
}

function scaleValue(type: ArgType, v: unknown, k: number): unknown {
  if (isNum(v)) return tidy(v * k);
  if (Array.isArray(v)) return v.map((x) => (isNum(x) ? tidy(x * k) : x));
  if (type === 'cmy' && v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([a, x]) => [a, isNum(x) ? tidy(x * k) : x]));
  }
  return v;
}

export interface CheckResult { value: unknown; warnings: Diagnostic[] }

/**
 * Checks one value against its spec. `label` names it in messages (e.g. 'print.lights.logH').
 * Throws E_ARG_TYPE / E_ARG_RANGE; returns the normalised value and RANGE warnings.
 * Node-typed values (Image, Mask, …) are checked for shape only (node id strings); the graph checks the rest.
 */
export function checkArgValue(spec: ArgSpec, raw: unknown, label: string): CheckResult {
  const v = normaliseShape(spec.type, raw);
  const warnings: Diagnostic[] = [];
  // a per-channel number given as [r, g, b] is checked as a vec3
  const t: ArgType = spec.type === 'number' && spec.perChannel && Array.isArray(v) ? 'vec3' : spec.type;
  if (v === null && spec.optional) return { value: null, warnings };
  switch (t) {
    case 'bool':
      if (typeof v !== 'boolean') fail('E_ARG_TYPE', `${label} must be a boolean, got ${formatValue(v)}`, { path: label });
      return { value: v, warnings };
    case 'string': case 'stockId':
      if (typeof v !== 'string' || v.length === 0) fail('E_ARG_TYPE', `${label} must be a non-empty string, got ${formatValue(v)}`, { path: label });
      if (spec.values && !spec.values.includes(v)) fail('E_ARG_RANGE', `${label} = ${JSON.stringify(v)} is not one of the valid values`, { path: label, valid: spec.values });
      return { value: v, warnings };
    case 'enum':
      if (typeof v !== 'string' && typeof v !== 'number') fail('E_ARG_TYPE', `${label} must be one of ${spec.values?.join(', ')}`, { path: label, valid: spec.values ?? [] });
      if (!(spec.values ?? []).includes(String(v))) {
        fail('E_ARG_RANGE', `${label} = ${JSON.stringify(v)} is not one of ${(spec.values ?? []).join(', ')}`, { path: label, valid: spec.values ?? [] });
      }
      return { value: String(v), warnings };
    case 'string[]':
      if (!Array.isArray(v) || !v.every((s) => typeof s === 'string')) fail('E_ARG_TYPE', `${label} must be ${shapeHint(t)}`, { path: label });
      return { value: Object.freeze([...v]), warnings };
    case 'Image': case 'Mask':
      if (typeof v !== 'string') fail('E_ARG_TYPE', `${label} must be a node handle`, { path: label });
      return { value: v, warnings };
    case 'list': return checkList(spec, v, label);
    case 'polyline': return checkPolyline(v, label);
    default: break;
  }
  const comps = components(t, v);
  if (!comps) {
    const want = spec.perChannel ? 'a number or [r, g, b]' : t === 'number' ? 'a number' : shapeHint(t);
    fail('E_ARG_TYPE', `${label} must be ${want}, got ${formatValue(v)}`, { path: label, hint: `Expected ${spec.perChannel ? 'a number or [r, g, b]' : shapeHint(t)}${spec.unit ? ` in ${spec.unit}` : ''}.` });
  }
  if (!comps.every(Number.isFinite)) {
    fail('E_ARG_RANGE', `${label} = ${formatValue(v)} is not finite`, { path: label, valid: [formatRange(spec)] });
  }
  if (spec.integer && !comps.every(Number.isInteger)) fail('E_ARG_TYPE', `${label} must be an integer, got ${formatValue(v)}`, { path: label });
  if (t === 'box' && (comps[2]! <= 0 || comps[3]! <= 0)) fail('E_ARG_RANGE', `${label} must have positive w and h`, { path: label });
  const lo = spec.min ?? -Infinity;
  const hi = spec.max ?? Infinity;
  if (t !== 'box' && t !== 'point' && comps.some((c) => c < lo || c > hi)) {
    const extra: Omit<Diagnostic, 'code' | 'message'> = { path: label, valid: [formatRange(spec)] };
    for (const r of Object.values(spec.redirects ?? {})) {
      if (r.scale === undefined) continue;
      const scaled = scaleValue(t, v, r.scale);
      const sc = components(t, scaled);
      if (sc && sc.every((c) => c >= lo && c <= hi)) {
        extra.hint = r.hint;
        extra.fix = formatValue(scaled);
        break;
      }
    }
    fail('E_ARG_RANGE', `${label} = ${formatValue(v)} is outside the allowed range ${formatRange(spec)}${spec.unit ? ` (${spec.unit})` : ''}.`, extra);
  }
  if (spec.usual && comps.some((c) => c < spec.usual![0] || c > spec.usual![1])) {
    warnings.push(diag('RANGE', `${label} = ${formatValue(v)} is outside the usual range [${spec.usual[0]}, ${spec.usual[1]}]${spec.unit ? ` (${spec.unit})` : ''}.`, {
      path: label, ...(spec.usualHint ? { hint: spec.usualHint } : {}),
    }));
  }
  const out = t === 'vec3' ? Object.freeze([...comps]) : t === 'number' ? comps[0] : Object.freeze({ ...(v as object) });
  return { value: out, warnings };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Checks one object against a field schema: unknown keys refused (did-you-mean), defaults filled, optional absent. */
export function checkFields(schema: Readonly<Record<string, ArgSpec>>, v: unknown, label: string): CheckResult {
  if (!isObj(v)) fail('E_ARG_TYPE', `${label} must be an object with ${Object.keys(schema).join(', ')}`, { path: label, valid: Object.keys(schema) });
  const warnings: Diagnostic[] = [];
  for (const k of Object.keys(v)) {
    if (!(k in schema)) fail('E_UNKNOWN_OPTION', `${label} has no field "${k}"`, { path: `${label}.${k}`, valid: Object.keys(schema) });
  }
  const out: Record<string, unknown> = {};
  for (const [k, s] of Object.entries(schema)) {
    let x = v[k];
    if (x === undefined || (x === null && s.optional)) {
      if (s.default !== undefined) x = s.default;
      else if (s.optional) continue;
      else fail('E_ARG_TYPE', `${label} needs "${k}"`, { path: `${label}.${k}`, hint: s.doc });
    }
    const r = checkArgValue(s, x, `${label}.${k}`);
    if (r.value === null) continue;
    out[k] = r.value;
    warnings.push(...r.warnings);
  }
  return { value: Object.freeze(out), warnings };
}

function checkList(spec: ArgSpec, v: unknown, label: string): CheckResult {
  if (!Array.isArray(v)) fail('E_ARG_TYPE', `${label} must be ${shapeHint('list')}`, { path: label });
  if (spec.minItems !== undefined && v.length < spec.minItems) fail('E_ARG_RANGE', `${label} needs at least ${spec.minItems} item(s)`, { path: label });
  if (spec.maxItems !== undefined && v.length > spec.maxItems) fail('E_ARG_RANGE', `${label} takes at most ${spec.maxItems} item(s)`, { path: label });
  const schema = spec.of ?? {};
  const warnings: Diagnostic[] = [];
  const items = v.map((x, i) => {
    const r = checkFields(schema, x, `${label}.${i}`);
    warnings.push(...r.warnings);
    return r.value;
  });
  return { value: Object.freeze(items), warnings };
}

function checkPolyline(v: unknown, label: string): CheckResult {
  const ok = Array.isArray(v) && v.every((p) => Array.isArray(p) && (p.length === 2 || p.length === 3) && p.every((c) => typeof c === 'number' && Number.isFinite(c)));
  if (!ok) fail('E_ARG_TYPE', `${label} must be ${shapeHint('polyline')}`, { path: label });
  const pts = (v as number[][]).map((p) => Object.freeze([p[0]!, p[1]!, p[2] ?? 1]));
  if (pts.some((p) => p[2]! < 0 || p[2]! > 1)) fail('E_ARG_RANGE', `${label}: pressure must be in [0, 1]`, { path: label });
  return { value: Object.freeze(pts), warnings: [] };
}
