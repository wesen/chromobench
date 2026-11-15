// Amount (guide §4): apply a resolved look at 0–200 % as a pass over its entries. The scaling rule is chosen per
// path from the path's ArgSpec (unit and ui.scale), because our parameters are physical: time and f-numbers scale
// in stops, colour temperature in mired, enums and stock ids step at a threshold, everything else is linear in its
// stored unit (log H is already linear in stops). Nothing clamps (DR-2): an out-of-range result is a diagnostic
// with the clamped value as its fix, unless the caller asked for `over: 'clamp'`.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { canonicalJSON, insert, set, type Mutation } from '@chromobench/values';
import {
  ChromobenchError, checkArgValue, documentKind, formatValue, layerEntry, newDocument,
  type ArgSpec, type Diagnostic, type Document,
} from '@chromobench/contract';
import { layerOf, paramsOf, read } from '../../../../src/model/doc.ts';
import { kitDiag, type AmountBase, type AmountRule, type LayerInput, type PresetEntry, type Resolved } from './look.ts';
import { specAt } from './paths.ts';

/** The rule for a path: the look's/preset's override, else from its ArgSpec (guide §4.2). */
export function ruleFor(path: string, overrides: Readonly<Record<string, AmountRule>> = {}, doc?: Document | null): AmountRule {
  const o = overrides[path];
  if (o) return o;
  const spec = specAt(path, doc);
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
const stopFactor = (path: string): number => (specAt(path)?.unit === 'fstop' ? 0.5 : 1);

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
  /** what Amount 0 means for set entries: the frame's value (default) or the default document's */
  from?: AmountBase;
  /** out of range: report with a clamped fix (default) or clamp silently with a note */
  over?: 'diagnose' | 'clamp';
}
export interface AmountResult {
  mutations: Mutation[];
  /** the value each set replaces (the staleness check at approval) */
  expect: Record<string, unknown>;
  /** CB-L110 (with fix), or a path/type error from the value check */
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

/** A neutral document of the frame's kind (Amount from 'defaults'): the film pitch is the frame's. */
export function defaultsOf(doc: Document): Document {
  const scan = (doc.stages.scan?.medium ?? null) as { umPerPx?: number; format?: '135' } | null;
  return newDocument(documentKind(doc), { sha256: doc.source.sha256 }, { frame: doc.frame, ...(scan?.umPerPx ? { umPerPx: scan.umPerPx } : {}), ...(scan?.format ? { format: scan.format } : {}) });
}

/** The Amount pass: resolved entries + the frame's document + k → `set` mutations, with the values they replace. */
export function amountPass(r: Resolved, doc: Document, o: AmountOptions): AmountResult {
  const k = o.amount;
  const from = o.from ?? r.look.base;
  const defaults = from === 'defaults' ? defaultsOf(doc) : null;
  const out: Mutation[] = [];
  const expect: Record<string, unknown> = {};
  const diags: Diagnostic[] = [];
  const notes: string[] = [];
  const pct = `${Math.round(k * 100)} %`;
  for (const e of r.entries) {
    const cur = read(doc, e.path);
    const spec = specAt(e.path, doc);
    if (cur === undefined || !spec) {
      diags.push(kitDiag('E_PATH', `${e.path}: this frame has no such setting`, { path: e.path }));
      continue;
    }
    const base = defaults && 'set' in e ? read(defaults, e.path) : cur;
    const rule = ruleFor(e.path, r.look.amount, doc);
    let v = scale(rule, base, e, k);
    try {
      v = checkArgValue(spec, v, e.path).value;
    } catch (err) {
      if (!(err instanceof ChromobenchError)) throw err;
      if (err.diag.code === 'E_ARG_RANGE') {
        const c = clampTo(spec, v);
        if (o.over === 'clamp') {
          notes.push(`Amount ${pct}: ${e.path} would be ${formatValue(v)}, clamped to ${formatValue(c)}`);
          v = c;
        } else {
          diags.push(kitDiag('CB-L110', `Amount ${pct}: ${e.path} would be ${formatValue(v)}, ${spec.max !== undefined && zipAny(v, (x) => x > spec.max!) ? `maximum ${spec.max}` : `minimum ${spec.min}`}; apply clamped?`, { path: e.path, fix: formatValue(c) }));
          continue;
        }
      } else {
        diags.push(err.diag);
        continue;
      }
    }
    if (canonicalJSON(v ?? null) === canonicalJSON(cur ?? null)) continue;
    out.push(set(e.path, plain(v)));
    expect[e.path] = plain(cur ?? null);
  }
  for (const x of r.layers) {
    const ms = layerMutations(doc, x, k);
    out.push(...ms);
    for (const m of ms) if (m.op === 'set') expect[m.path] = plain(read(doc, m.path) ?? null);
  }
  return { mutations: out, expect, diags, notes };
}

function zipAny(v: unknown, f: (x: number) => boolean): boolean {
  let hit = false;
  zip(v, undefined, (x) => ((hit = hit || f(x)), x));
  return hit;
}

/** the params Amount scales (log exposure in stops, seconds of a flash, the preflash fraction): from 0 when absent */
const SCALED = ['stops', 'time_s', 'fraction'];

/**
 * A preset's darkroom layer at Amount k: a new layer with its scaled params (inserted into the darkroom stack), or,
 * when the document has a layer of that id, its scaled params moved from their current values.
 */
function layerMutations(doc: Document, x: LayerInput, k: number): Mutation[] {
  const have = layerOf(doc, x.id);
  if (!have) {
    if (k === 0) return [];
    const params = Object.fromEntries(Object.entries(x.params).map(([p, v]) => [p, SCALED.includes(p) && typeof v === 'number' ? tidy(v * k) : v]));
    return [insert('stages.darkroom.stack', x.id, layerEntry(x.op, params, { name: x.name ?? x.op, mask: x.mask ?? null }))];
  }
  const now = paramsOf(have);
  const out: Mutation[] = [];
  for (const [p, v] of Object.entries(x.params)) {
    if (!SCALED.includes(p) || typeof v !== 'number') continue;
    const b = typeof now[p] === 'number' ? (now[p] as number) : 0;
    const next = tidy(b + (v - b) * k);
    if (next !== now[p]) out.push(set(`${x.id}.params.${p}`, next));
  }
  return out;
}
