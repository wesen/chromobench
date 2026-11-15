// JSON values: the types, a check, deep freezing, structural equality and canonical JSON (the one implementation
// in the repository; the contract hashes nodes with it).
import { fail } from './errors.ts';

export type Json = null | boolean | number | string | readonly Json[] | JsonObject;
export interface JsonObject {
  readonly [k: string]: Json;
}

/** The deep read-only view of T: what a frozen value is. Functions are left as they are. */
export type Frozen<T> = T extends (...args: never[]) => unknown ? T : T extends object ? { readonly [K in keyof T]: Frozen<T[K]> } : T;

/** An object whose prototype is Object.prototype or null (a JSON object, a props bag), not an array. */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}

/** Why v is not JSON (finite numbers, plain objects, arrays without holes or undefined), or null when it is. */
export function jsonProblem(v: unknown, path = ''): { path: string; message: string } | null {
  switch (typeof v) {
    case 'string':
    case 'boolean':
      return null;
    case 'number':
      return Number.isFinite(v) ? null : { path, message: `non-finite number ${v}` };
    case 'object': {
      if (v === null) return null;
      if (Array.isArray(v)) {
        for (let i = 0; i < v.length; i++) {
          if (!(i in v) || v[i] === undefined) return { path: join(path, i), message: 'undefined (or a hole) in an array' };
          const p = jsonProblem(v[i], join(path, i));
          if (p) return p;
        }
        return null;
      }
      if (!isPlainObject(v)) return { path, message: `${(v as object).constructor?.name ?? 'an object'} is not a plain object` };
      for (const [k, x] of Object.entries(v)) {
        if (x === undefined) continue;
        const p = jsonProblem(x, join(path, k));
        if (p) return p;
      }
      return null;
    }
    default:
      return { path, message: `${typeof v} is not a JSON value` };
  }
}
const join = (path: string, k: string | number): string => (path ? `${path}.${k}` : String(k));

export function isJson(v: unknown): v is Json {
  return jsonProblem(v) === null;
}

/** Throws E_ARG_TYPE (E_ARG_RANGE for a non-finite number) when v is not JSON. `at` names the place in messages. */
export function assertJson(v: unknown, at = 'value'): asserts v is Json {
  const p = jsonProblem(v);
  if (!p) return;
  const where = p.path ? `${at}.${p.path}` : at;
  fail(p.message.startsWith('non-finite') ? 'E_ARG_RANGE' : 'E_ARG_TYPE', `${where}: ${p.message}`, { path: where });
}

/**
 * Freezes plain objects and arrays all the way down, in place, and returns the same value. Other objects (class
 * instances, typed arrays, functions) are left as they are.
 */
export function deepFreeze<T>(v: T): Frozen<T> {
  if (v !== null && typeof v === 'object' && (Array.isArray(v) || isPlainObject(v))) {
    for (const x of Object.values(v)) deepFreeze(x);
    Object.freeze(v);
  }
  return v as Frozen<T>;
}

/** Whether every plain object and array reachable from v is frozen. */
export function isDeepFrozen(v: unknown): boolean {
  if (v === null || typeof v !== 'object' || !(Array.isArray(v) || isPlainObject(v))) return true;
  return Object.isFrozen(v) && Object.values(v).every(isDeepFrozen);
}

/**
 * Structural equality with JSON's meaning: plain objects by keys (a key holding undefined counts as absent), arrays
 * element by element, numbers by `===` (so 0 equals −0), anything else by identity. `equal(a, b)` holds exactly when
 * `canonicalJSON(a) === canonicalJSON(b)` for JSON values.
 */
export function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!equal(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b) || !isPlainObject(a) || !isPlainObject(b)) return false;
  const ka = Object.keys(a).filter((k) => a[k] !== undefined);
  const kb = Object.keys(b).filter((k) => b[k] !== undefined);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.hasOwn(b, k) || !equal(a[k], b[k])) return false;
  return true;
}

/**
 * Canonical JSON: object keys sorted (by UTF-16 code units, as Array.prototype.sort does), keys holding undefined
 * dropped, arrays in order, numbers via JSON.stringify with −0 written as 0, undefined at the top or in an array
 * written as null. Non-finite numbers (E_ARG_RANGE) and typed arrays (E_INTERNAL) are refused. The contract's node
 * ids hash this string, so its output must never change.
 */
export function canonicalJSON(v: unknown): string {
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) fail('E_ARG_RANGE', `canonicalJSON: non-finite number ${v}`);
      return JSON.stringify(Object.is(v, -0) ? 0 : v);
    }
    if (v === undefined) return 'null';
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(canonicalJSON).join(',')}]`;
  if (ArrayBuffer.isView(v)) fail('E_INTERNAL', 'canonicalJSON: typed arrays are not canonical values');
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJSON(o[k])}`).join(',')}}`;
}
