// Amount (guide §4): apply a resolved look at 0–200 % as a pass over its entries. The scaling rule is chosen per
// path from the path's ArgSpec (unit and ui.scale), because our parameters are physical: time and f-numbers scale
// in stops, colour temperature in mired, enums and stock ids step at a threshold, everything else is linear in its
// stored unit (log H is already linear in stops). Nothing clamps (DR-2): an out-of-range result is a diagnostic
// with the clamped value as its fix, unless the caller asked for `over: 'clamp'`.

/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ChromobenchError, canonicalJSON, checkSet, defaultRecipe, fieldPattern, fieldSpec, formatValue, getPath,
  type ArgSpec, type Diagnostic, type ExposureInput, type FrameRecipe, type Mutation,
} from '@chromobench/contract';
import { kitDiag, type AmountBase, type AmountRule, type PresetEntry, type Resolved } from './look.ts';

/** The rule for a path: the look's/preset's override, else from its ArgSpec (guide §4.2). */
export function ruleFor(path: string, overrides: Readonly<Record<string, AmountRule>> = {}): AmountRule {
  const o = overrides[path];
  if (o) return o;
  const pattern = fieldPattern(path);
  const spec = pattern ? fieldSpec(pattern) : undefined;
  if (!spec) return 'keep';
  if (spec.type === 'number' || spec.type === 'vec3' || spec.type === 'cmy') {
    if (spec.unit === 's' || spec.unit === 'fstop' || spec.ui?.scale === 'log2') return 'stops';
    if (spec.unit === 'K') return 'mired';
    return 'linear';
  }
  if (spec.type === 'enum' || spec.type === 'bool' || spec.type === 'stockId' || spec.type === 'string') return 'step';
  return 'keep';
}

type Num = number | number[] | Record<string, number>;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** 12 significant digits: float noise from scaling never shows up in diffs or hashes */
export const tidy = (x: number): number => Number(x.toPrecision(12));

/** componentwise over number | vec3 | {c, m, y}; `b` may be partial (a missing component is 0 / unchanged) */
function zip(a: unknown, b: unknown, f: (x: number, y: number | undefined) => number): unknown {
  if (isNum(a)) return f(a, isNum(b) ? b : undefined);
  if (Array.isArray(a)) return a.map((x, i) => (isNum(x) ? f(x, Array.isArray(b) && isNum(b[i]) ? b[i] : undefined) : x));
  if (a && typeof a === 'object') return Object.fromEntries(Object.entries(a as Record<string, unknown>).map(([k, x]) => [k, isNum(x) ? f(x, b && typeof b === 'object' && isNum((b as any)[k]) ? (b as any)[k] : undefined) : x]));
  return a;
}
const numeric = (v: unknown): boolean => isNum(v) || (Array.isArray(v) && v.every(isNum)) || (!!v && typeof v === 'object' && Object.values(v as object).every(isNum));

/** f-numbers move half as fast as times per stop (light ∝ 1/N²) */
const stopFactor = (path: string): number => (fieldSpec(fieldPattern(path) ?? '')?.unit === 'fstop' ? 0.5 : 1);

/** base + delta in the rule's space (an `add` entry's target at Amount 100 %) */
export function applyDelta(rule: AmountRule, base: unknown, delta: Num, path = ''): unknown {
  const r = typeof rule === 'string' ? rule : 'step';
  return zip(base, delta, (x, d) => {
    if (d === undefined) return x;
    if (r === 'stops') return tidy(x * 2 ** (d * stopFactor(path)));
    if (r === 'mired') return tidy(1e6 / (1e6 / x + d));
    return tidy(x + d);
  });
}

/**
 * The value an entry gives at Amount k, from `base` (the frame's value, or the default's):
 * linear: base + k(target − base); stops: base·(target/base)^k; mired: interpolated in 1/K; step: target from
 * the threshold on (default 0.5); keep: target. k = 1 returns the target exactly (idempotence).
 */
export function scale(rule: AmountRule, base: unknown, e: PresetEntry, k: number, path = e.path): unknown {
  let target: unknown;
  if ('set' in e) target = e.set;
  else if ('mul' in e) target = zip(base, undefined, (x) => x * e.mul);
  else target = applyDelta(rule, base, e.add, path);
  if (k === 1 || base === undefined || base === null) return target;
  if (typeof rule === 'object') return k >= rule.step ? target : base;
  switch (rule) {
    case 'keep':
      return target;
    case 'step':
      return k >= 0.5 ? target : base;
    case 'linear':
      return numeric(base) ? zip(base, target, (x, y) => (y === undefined ? x : tidy(x + (y - x) * k))) : k >= 0.5 ? target : base;
    case 'stops':
      // an `add` in stops scales its delta (+1/3 st at 60 % is +0.2 st); a `set` interpolates geometrically
      if ('add' in e) return zip(base, e.add, (x, d) => (d === undefined ? x : x > 0 ? tidy(x * 2 ** (d * k * stopFactor(path))) : x));
      return zip(base, target, (x, y) => (y === undefined ? x : x > 0 && y > 0 ? tidy(x * (y / x) ** k) : tidy(x + (y - x) * k)));
    case 'mired':
      return zip(base, target, (x, y) => (y === undefined ? x : x > 0 && y > 0 ? tidy(1e6 / (1e6 / x + (1e6 / y - 1e6 / x) * k)) : x));
  }
}

export interface AmountOptions {
  /** the scale factor k, 0–2 (Amount 0–200 %) */
  amount: number;
  /** what Amount 0 means for set entries: the frame's value (default) or the default recipe's */
  from?: AmountBase;
  /** out of range: report with a clamped fix (default) or clamp silently with a note */
  over?: 'diagnose' | 'clamp';
}
export interface AmountResult {
  mutations: Mutation[];
  /** CB-LOOK-RANGE (with fix), or a path/type error from the recipe check */
  diags: Diagnostic[];
  /** silent clamps (over: 'clamp') */
  notes: string[];
}

const plain = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

function clampTo(spec: ArgSpec | undefined, v: unknown): unknown {
  const lo = spec?.min ?? -Infinity;
  const hi = spec?.max ?? Infinity;
  return zip(v, undefined, (x) => Math.min(hi, Math.max(lo, x)));
}

/** The Amount pass: resolved entries + the frame's recipe + k → `set` mutations carrying `expect` (DR-7). */
export function amountPass(r: Resolved, recipe: FrameRecipe, o: AmountOptions): AmountResult {
  const k = o.amount;
  const from = o.from ?? r.look.base;
  const defaults = from === 'defaults' ? defaultRecipe(recipe.kind, { sha256: recipe.source.sha256 }, { frame: recipe.frame }) : null;
  const out: Mutation[] = [];
  const diags: Diagnostic[] = [];
  const notes: string[] = [];
  const pct = `${Math.round(k * 100)} %`;
  for (const e of r.entries) {
    const cur = getPath(recipe, e.path);
    const base = defaults && 'set' in e ? getPath(defaults, e.path) : cur;
    const rule = ruleFor(e.path, r.look.amount);
    let v = scale(rule, base, e, k);
    try {
      v = checkSet(recipe, e.path, v).value;
    } catch (err) {
      if (!(err instanceof ChromobenchError)) throw err;
      if (err.diag.code === 'E_ARG_RANGE') {
        const spec = fieldSpec(fieldPattern(e.path) ?? '');
        const c = clampTo(spec, v);
        if (o.over === 'clamp') {
          notes.push(`Amount ${pct}: ${e.path} would be ${formatValue(v)}, clamped to ${formatValue(c)}`);
          v = c;
        } else {
          diags.push(kitDiag('CB-L110', `Amount ${pct}: ${e.path} would be ${formatValue(v)}, ${spec?.max !== undefined && zipAny(v, (x) => x > spec.max!) ? `maximum ${spec.max}` : `minimum ${spec?.min}`}; apply clamped?`, { path: e.path, fix: formatValue(c) }));
          continue;
        }
      } else {
        diags.push(err.diag);
        continue;
      }
    }
    if (canonicalJSON(v ?? null) === canonicalJSON(cur ?? null)) continue;
    out.push({ op: 'set', path: e.path, value: plain(v), expect: plain(cur ?? null) });
  }
  for (const x of r.exposures) out.push(...exposureMutations(recipe, x, k));
  return { mutations: out, diags, notes };
}

function zipAny(v: unknown, f: (x: number) => boolean): boolean {
  let hit = false;
  zip(v, undefined, (x) => ((hit = hit || f(x)), x));
  return hit;
}

/** a preset's dodge/burn row at Amount k: stops scaled (stops are log exposure, so linear is stops) */
function exposureMutations(recipe: FrameRecipe, x: ExposureInput, k: number): Mutation[] {
  if (k === 0) return [];
  const stops = typeof x.stops === 'number' ? tidy(x.stops * k) : x.stops;
  const have = recipe.print.exposures.find((e) => e.id === x.id);
  if (!have) return [{ op: 'exposure.add', exposure: plain({ ...x, ...(stops !== undefined ? { stops } : {}) }) }];
  return stops !== undefined && have.stops !== stops ? [{ op: 'set', path: `print.exposures.${x.id}.stops`, value: stops, expect: have.stops }] : [];
}
