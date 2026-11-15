// The explain protocol: a value that can say what it is implements a method under the EXPLAIN symbol returning a
// plain, printable structure (JSON: no functions, no cycles, no class instances). explain(x) works on anything:
// explainable values explain themselves, plain data is copied, functions and foreign objects are named.
import type { Json, JsonObject } from './json.ts';
import { isPlainObject } from './json.ts';
import { where, type CallSite } from './site.ts';

export const EXPLAIN: unique symbol = Symbol.for('chromobench.explain');

export interface Explainable {
  [EXPLAIN](): Json;
}

export function isExplainable(v: unknown): v is Explainable {
  return (typeof v === 'object' || typeof v === 'function') && v !== null && typeof (v as Partial<Explainable>)[EXPLAIN] === 'function';
}

const MAX_DEPTH = 64;

/** A plain, printable explanation of any value. */
export function explain(v: unknown): Json {
  return walk(v, 0, new Set());
}

function walk(v: unknown, depth: number, seen: Set<object>): Json {
  if (depth > MAX_DEPTH) return '…';
  switch (typeof v) {
    case 'string':
    case 'boolean':
      return v;
    case 'number':
      return Number.isFinite(v) ? v : String(v);
    case 'undefined':
      return null;
    case 'bigint':
    case 'symbol':
      return String(v);
    case 'function':
      if (isExplainable(v)) return v[EXPLAIN]();
      return { kind: 'function', name: v.name || 'λ' };
  }
  if (v === null) return null;
  const o = v as object;
  if (seen.has(o)) return '[cycle]';
  if (isExplainable(o)) return o[EXPLAIN]();
  seen.add(o);
  try {
    if (Array.isArray(o)) return o.map((x) => walk(x, depth + 1, seen));
    if (isPlainObject(o)) {
      const out: Record<string, Json> = {};
      for (const [k, x] of Object.entries(o)) if (x !== undefined) out[k] = walk(x, depth + 1, seen);
      return out;
    }
    return { kind: o.constructor?.name ?? 'object' };
  } finally {
    seen.delete(o);
  }
}

/** The `at` field of an explanation: `file:line:col`, omitted when the call site is unknown. */
export function atField(at: CallSite | null | undefined): JsonObject {
  return at ? { at: where(at) } : {};
}
