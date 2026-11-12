// Small shared helpers: paths, structural writes, equality, suggestions (port of CraftKit core/util.js).
// Platform detection and id counters moved out: the platform is a parameter, ids are per instance.

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Key = string | number;
export type Path = readonly Key[];

export const isObj = (v: unknown): v is Record<string | number | symbol, any> => v !== null && typeof v === 'object';
export const isPlainObject = (v: unknown): v is Record<string, any> =>
  isObj(v) && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

// ── paths ────────────────────────────────────────────────────────────────
// A path is an array of keys. Its string form joins with '.', and is what the path index and diagnostics use.
export const pathStr = (p: Path): string => p.join('.');
export const parsePath = (s: string | Path): Key[] =>
  Array.isArray(s) ? [...(s as Path)] : String(s).split('.').filter(Boolean).map(k => (/^\d+$/.test(k) ? +k : k));

export function getIn(obj: unknown, path: Path): any {
  let v: any = obj;
  for (const k of path) {
    if (v == null) return undefined;
    v = v[k];
  }
  return v;
}

// structural write: copies only the objects along the path, so every untouched subtree keeps its identity
export function setIn(obj: any, path: Path, value: unknown, i = 0): any {
  if (i === path.length) return value;
  const k = path[i]!;
  const cur = obj == null ? (typeof k === 'number' ? [] : {}) : obj;
  const next = setIn(cur[k], path, value, i + 1);
  if (cur[k] === next && obj != null) return obj;
  if (Array.isArray(cur)) {
    const c = cur.slice();
    (c as any)[k] = next;
    return c;
  }
  const c: Record<Key, unknown> = Object.assign({}, cur);
  if (next === undefined) delete c[k];
  else c[k] = next;
  return c;
}

/** a is a prefix of b (or equal) */
export const prefixOf = (a: Path, b: Path): boolean => a.length <= b.length && a.every((k, i) => String(b[i]) === String(k));

export function shallowEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!isObj(a) || !isObj(b)) return Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}

export function deepEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!isObj(a) || !isObj(b)) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!deepEq(a[k], b[k])) return false;
  return true;
}

export function deepMerge(base: unknown, patch: unknown): any {
  if (!isPlainObject(patch)) return patch;
  const out: Record<string, unknown> = Object.assign({}, isPlainObject(base) ? base : {});
  for (const [k, v] of Object.entries(patch)) out[k] = isPlainObject(v) ? deepMerge(out[k], v) : v;
  return out;
}

// ── suggestions (did you mean) ─────────────────────────────────────────────
/** edit distance with transpositions (optimal string alignment): 'stpe' is one step from 'step' */
export function lev(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev2: number[] = [];
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2]! + 1);
      cur[j] = v;
    }
    prev2 = prev;
    prev = cur;
  }
  return prev[n]!;
}

export function suggest<T extends Key>(name: Key, pool: Iterable<T>, k = 3): T[] {
  const low = String(name).toLowerCase();
  return [...new Set(pool)]
    .map(p => {
      const pl = String(p).toLowerCase();
      const near = Math.min(pl.length, low.length) / Math.max(pl.length, low.length) >= 0.5;
      const d = pl === low ? 0 : near && (pl.includes(low) || low.includes(pl)) ? 0.5 : lev(low, pl);
      return [p, d] as const;
    })
    .sort((a, b) => a[1] - b[1])
    .filter(x => x[1] <= Math.max(2, Math.ceil(String(name).length / 3)))
    .slice(0, k)
    .map(x => x[0]);
}

/** a cheap stable hash for render caches and signatures */
export function hash(s: unknown): string {
  let h = 2166136261;
  const t = String(s);
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** JSON with sorted keys, undefined as 'u' (a cache key for plain values) */
export function stable(v: unknown): string {
  if (v === undefined) return 'u';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).sort().map(k => JSON.stringify(k) + ':' + stable(o[k])).join(',') + '}';
}

/** Platform: Mod is ⌘ on macOS and Ctrl elsewhere. Passed in, never read from a global at module load. */
export interface Platform {
  readonly mac: boolean;
}
export const OTHER: Platform = Object.freeze({ mac: false });
export const MAC: Platform = Object.freeze({ mac: true });
/** Read the browser's platform (call it from the DOM half, never at module top level). */
export function detectPlatform(): Platform {
  const nav = (globalThis as { navigator?: { platform?: string; userAgent?: string } }).navigator;
  return nav && /Mac|iPhone|iPad/.test(nav.platform || nav.userAgent || '') ? MAC : OTHER;
}

