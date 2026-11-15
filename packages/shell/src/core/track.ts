// Tracking reads (port of CraftKit core/track.js). A τ lambda (s => s.develop.light.exposure) runs against a proxy
// of the current state that records every path it reads; the cell that owns the lambda re-runs only when one of
// those paths changes.
//
// State is immutable (writes copy the objects along the path), so a changed path always has a new value at that
// path and reference equality is a complete change test. Reads of ancestors that were only walked through
// ("navigation") are dropped, so reading s.develop.light.exposure does not subscribe to all of s.develop.
//
// New in the port: probe mode. At build, s => s.recipes[s.ui.frame].print.time_s reads a missing key; in probe
// mode a missing value is a recording proxy, so the whole path is still recorded and can be checked against a
// mount's checkPath (with the key segment as a wildcard).

/* eslint-disable @typescript-eslint/no-explicit-any */
import { isObj, overProxy, pathStr, getIn, type Key, type Path } from './util.ts';

const TARGET = Symbol('ck.target');
const PATH = Symbol('ck.path');
const PROBE = Symbol('ck.probe');
export const rawOf = <T>(v: T): T => ((v && (v as any)[TARGET]) || v) as T;
export const pathOfProxy = (v: unknown): Key[] | null => (isObj(v) || typeof v === 'function' ? ((v as any)[PATH] as Key[]) || null : null);
export const isProbe = (v: unknown): boolean => !!(v && (typeof v === 'object' || typeof v === 'function') && (v as any)[PROBE]);

/** What a tracker needs from the store: derived paths (computed values with their own read sets). */
export interface DerivedSource {
  derivedAt(path: Path): { read(t: Tracker): unknown } | null;
  peek(path: Path): unknown;
  current: unknown;
}

interface Entry {
  paths: Key[][];
  keys: Set<string>;
  proxy: any;
}

export class Tracker {
  reads = new Map<string, Key[]>();
  /** pathStr of objects used as a whole (enumerated, returned, compared) */
  whole = new Set<string>();
  /** the last path read (for bindings) */
  last: Key[] | null = null;
  private cache = new WeakMap<object, Entry>();
  readonly probe: boolean;
  /** a probe was handed out: some read went through a missing value */
  probed = false;
  readonly store: DerivedSource | null;
  readonly rootValue: unknown;
  readonly base: Key[];
  constructor(store: DerivedSource | null, rootValue: unknown, base: Key[] = [], opts: { probe?: boolean } = {}) {
    this.store = store;
    this.rootValue = rootValue;
    this.base = base;
    this.probe = !!opts.probe;
  }
  record(path: Key[]): void {
    const k = pathStr(path);
    if (!this.reads.has(k)) this.reads.set(k, path);
    this.last = path;
  }
  // The same object can be reached by several paths (structural sharing: two photos on the same default
  // settings). It gets one proxy, which remembers every path it was reached by; a read through it subscribes to
  // all of them (conservative, and correct: writing any of those paths changes what was read).
  wrap(value: unknown, path: Key[]): any {
    if (!isObj(value)) return value;
    if ((value as any)[TARGET]) return value;
    const hit = this.cache.get(value);
    if (hit) {
      const k = pathStr(path);
      if (!hit.keys.has(k)) {
        hit.keys.add(k);
        hit.paths.push(path);
      }
      return hit.proxy;
    }
    const t = this;
    const entry: Entry = { paths: [path], keys: new Set([pathStr(path)]), proxy: null };
    entry.proxy = overProxy(value, {
      get(target: any, k, recv) {
        if (k === TARGET) return target;
        if (k === PATH) return entry.paths[0];
        if (typeof k === 'symbol') return Reflect.get(target, k, recv);
        const kk: Key = Array.isArray(target) && /^\d+$/.test(k) ? +k : k;
        const first = entry.paths[0]!;
        const d = t.store && t.store.derivedAt(first.concat([kk]));
        if (d) {
          const v = d.read(t);
          t.record(first.concat([kk]));
          return v;
        }
        const v = Reflect.get(target, k, recv);
        if (typeof v === 'function') return v; // array methods: they read through the proxy
        let out = v;
        for (const p of entry.paths) {
          const child = p.concat([kk]);
          t.record(child);
          out = t.wrap(v, child);
        }
        if (v === undefined && t.probe && !Array.isArray(target) && !(k in target)) return t.probeAt(first.concat([kk]));
        return out;
      },
      has(target, k) {
        if (typeof k !== 'symbol') for (const p of entry.paths) t.record(p.concat([k]));
        return Reflect.has(target, k);
      },
      ownKeys(target) {
        for (const p of entry.paths) {
          t.whole.add(pathStr(p));
          t.record(p);
        }
        return Reflect.ownKeys(target);
      },
      set() {
        throw new TypeError('State is read-only here: change it with ctx.tx(label, t => …) or a binding');
      },
      deleteProperty() {
        throw new TypeError('State is read-only here: change it with ctx.tx(label, t => …)');
      },
    });
    this.cache.set(value, entry);
    return entry.proxy;
  }
  /** probe mode: a missing value that keeps recording the path read through it */
  probeAt(path: Key[]): any {
    const t = this;
    t.probed = true;
    const fn = function () {};
    return new Proxy(fn, {
      get(_tg, k) {
        if (k === PATH) return path;
        if (k === PROBE) return true;
        if (k === Symbol.toPrimitive) return (hint: string) => (hint === 'number' ? NaN : `«${pathStr(path)}»`);
        if (typeof k === 'symbol') return undefined;
        if (k === 'then' || k === 'toJSON') return undefined;
        const child = path.concat([/^\d+$/.test(k) ? +k : k]);
        t.record(child);
        return t.probeAt(child);
      },
      apply() {
        return t.probeAt(path.concat(['()']));
      },
      has() {
        return false;
      },
    });
  }
  root(): any {
    return this.wrap(this.rootValue, this.base);
  }
  pathsOf(proxy: unknown): Key[][] {
    const tgt = proxy && (proxy as any)[TARGET];
    const e = tgt && this.cache.get(tgt);
    return e ? e.paths : [];
  }

  // The paths a cell depends on: leaves, and whatever was used whole. Navigation-only prefixes are dropped.
  finish(result: unknown): Key[][] {
    markEscapes(result, this.whole, 0, this);
    const keys = [...this.reads.keys()];
    const out: Key[][] = [];
    for (const k of keys) {
      if (this.whole.has(k)) {
        out.push(this.reads.get(k)!);
        continue;
      }
      const kd = k + '.';
      let isPrefix = false;
      for (const o of keys)
        if (o.length > k.length && o.startsWith(kd)) {
          isPrefix = true;
          break;
        }
      if (!isPrefix) out.push(this.reads.get(k)!);
    }
    return out;
  }
}

function markEscapes(v: unknown, whole: Set<string>, depth: number, t: Tracker): void {
  if (!isObj(v) || depth > 3) return;
  if ((v as any)[TARGET]) {
    for (const p of t.pathsOf(v)) whole.add(pathStr(p));
    return;
  }
  if (Array.isArray(v)) {
    for (let i = 0; i < Math.min(v.length, 5000); i++) markEscapes(v[i], whole, depth + 1, t);
    return;
  }
  if (Object.getPrototypeOf(v) === Object.prototype) for (const x of Object.values(v)) markEscapes(x, whole, depth + 1, t);
}

/** Replace proxies in a result by the plain objects (new arrays and objects the lambda built are copied). */
export function unwrap<T>(v: T, depth = 0): T {
  if (!isObj(v)) return v;
  if ((v as any)[TARGET]) return (v as any)[TARGET];
  if (depth > 4) return v;
  if (Array.isArray(v)) {
    let changed = false;
    const out = v.map(x => {
      const y = unwrap(x, depth + 1);
      if (y !== x) changed = true;
      return y;
    });
    return (changed ? out : v) as T;
  }
  if (Object.getPrototypeOf(v) !== Object.prototype) return v;
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    const y = unwrap(x, depth + 1);
    if (y !== x) changed = true;
    out[k] = y;
  }
  return (changed ? out : v) as T;
}

export interface Read {
  path: Key[];
  value: unknown;
}
export interface Tracked<T> {
  value: T;
  reads: Read[];
  error: unknown;
}

/** Run a lambda against state and return { value, reads } (reads as paths with the values seen). */
export function track<T>(store: DerivedSource, fn: (s: any, arg?: any) => T, arg?: unknown, opts: { probe?: boolean } = {}): Tracked<T> {
  const t = new Tracker(store, store.current, [], opts);
  const root = t.root();
  let value: any;
  let error: unknown = null;
  try {
    value = arg === undefined ? fn(root) : fn(root, arg);
  } catch (e) {
    error = e;
  }
  const paths = t.finish(value);
  const reads = paths.map(p => ({ path: p, value: store.peek(p) }));
  return { value: unwrap(value), reads, error };
}

/** Which path does a binding lambda (s => s.frame[key]) name? The last read chain. */
export function bindingPath(store: DerivedSource, fn: (s: any) => unknown, opts: { probe?: boolean } = {}): { path: Key[] | null; error: unknown; value: unknown; probed: boolean } {
  const t = new Tracker(store, store.current, [], opts);
  let value: unknown;
  let error: unknown = null;
  try {
    value = fn(t.root());
  } catch (e) {
    error = e;
  }
  const p = pathOfProxy(value) || t.last;
  return { path: p, error, value: isProbe(value) ? undefined : unwrap(value), probed: t.probed };
}

export interface Missing {
  index: number;
  parent: Key[];
  key: Key;
  has: string[];
  parentMissing?: boolean;
}
/** The first key of a path that does not exist, with what the parent has (for "did you mean"). */
export function missingKey(state: unknown, path: Path): Missing | null {
  let v: any = state;
  for (let i = 0; i < path.length; i++) {
    const k = path[i]!;
    if (!isObj(v)) return { index: i, parent: path.slice(0, i), key: k, has: [], parentMissing: true };
    if (!(k in v)) return { index: i, parent: path.slice(0, i), key: k, has: Array.isArray(v) ? [] : Object.keys(v) };
    v = v[k];
  }
  return null;
}

export { getIn };
