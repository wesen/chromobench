// Tracking reads. A τ lambda (s => s.develop.light.exposure) runs against a proxy of the current state that
// records every path it reads; the cell that owns the lambda re-runs only when one of those paths changes.
//
// State is immutable (writes copy the objects along the path), so a changed path always has a new value at that
// path and reference equality is a complete change test. Reads of ancestors that were only walked through
// ("navigation") are dropped, so reading s.develop.light.exposure does not subscribe to all of s.develop.

import { isObj, pathStr, getIn } from './util.js';

const TARGET = Symbol('ck.target'), PATH = Symbol('ck.path');
export const rawOf = v => (v && v[TARGET]) || v;
export const pathOfProxy = v => (v && v[PATH]) || null;

export class Tracker {
  constructor(store, root, base = []) {
    this.store = store;
    this.reads = new Map();      // pathStr → path
    this.whole = new Set();      // pathStr of objects used as a whole (enumerated, returned, compared)
    this.last = null;            // the last path read (for bindings)
    this.cache = new WeakMap();  // target → { proxy, paths }: one proxy per object, so === between reads holds
    this.rootValue = root;
    this.base = base;
  }
  record(path) { const k = pathStr(path); if (!this.reads.has(k)) this.reads.set(k, path); this.last = path; }
  // The same object can be reached by several paths (structural sharing: two photos on the same default
  // settings). It gets one proxy, which remembers every path it was reached by; a read through it subscribes to
  // all of them (conservative, and correct: writing any of those paths changes what was read).
  wrap(value, path) {
    if (!isObj(value) || value[TARGET]) return value;
    const hit = this.cache.get(value);
    if (hit) { const k = pathStr(path); if (!hit.keys.has(k)) { hit.keys.add(k); hit.paths.push(path); } return hit.proxy; }
    const t = this;
    const entry = { paths: [path], keys: new Set([pathStr(path)]), proxy: null };
    entry.proxy = new Proxy(value, {
      get(target, k, recv) {
        if (k === TARGET) return target;
        if (k === PATH) return entry.paths[0];
        if (typeof k === 'symbol') return Reflect.get(target, k, recv);
        const kk = Array.isArray(target) && /^\d+$/.test(k) ? +k : k;
        const d = t.store && t.store.derivedAt(entry.paths[0].concat([kk]));
        if (d) { const v = d.read(t); t.record(entry.paths[0].concat([kk])); return v; }
        const v = Reflect.get(target, k, recv);
        if (typeof v === 'function') return v;          // array methods: they read through the proxy
        let out = v;
        for (const p of entry.paths) { const child = p.concat([kk]); t.record(child); out = t.wrap(v, child); }
        return out;
      },
      has(target, k) { if (typeof k !== 'symbol') for (const p of entry.paths) t.record(p.concat([k])); return Reflect.has(target, k); },
      ownKeys(target) { for (const p of entry.paths) { t.whole.add(pathStr(p)); t.record(p); } return Reflect.ownKeys(target); },
      getOwnPropertyDescriptor(target, k) { return Reflect.getOwnPropertyDescriptor(target, k); },
      set() { throw new TypeError('State is read-only here: change it with ctx.tx(label, t => …) or a binding'); },
      deleteProperty() { throw new TypeError('State is read-only here: change it with ctx.tx(label, t => …)'); },
    });
    this.cache.set(value, entry);
    return entry.proxy;
  }
  root() { return this.wrap(this.rootValue, this.base); }
  pathsOf(proxy) { const tgt = proxy && proxy[TARGET]; const e = tgt && this.cache.get(tgt); return e ? e.paths : []; }

  // The paths a cell depends on: leaves, and whatever was used whole. Navigation-only prefixes are dropped.
  finish(result) {
    markEscapes(result, this.whole, 0, this);
    const keys = [...this.reads.keys()];
    const out = [];
    for (const k of keys) {
      if (this.whole.has(k)) { out.push(this.reads.get(k)); continue; }
      const kd = k + '.';
      let isPrefix = false;
      for (const o of keys) if (o.length > k.length && o.startsWith(kd)) { isPrefix = true; break; }
      if (!isPrefix) out.push(this.reads.get(k));
    }
    return out;
  }
}

function markEscapes(v, whole, depth, t) {
  if (!isObj(v) || depth > 3) return;
  if (v[TARGET]) { for (const p of t.pathsOf(v)) whole.add(pathStr(p)); return; }
  if (Array.isArray(v)) { for (let i = 0; i < Math.min(v.length, 5000); i++) markEscapes(v[i], whole, depth + 1, t); return; }
  if (Object.getPrototypeOf(v) === Object.prototype) for (const x of Object.values(v)) markEscapes(x, whole, depth + 1, t);
}

// Replace proxies in a result by the plain objects (new arrays and objects the lambda built are copied).
export function unwrap(v, depth = 0) {
  if (!isObj(v)) return v;
  if (v[TARGET]) return v[TARGET];
  if (depth > 4) return v;
  if (Array.isArray(v)) { let changed = false; const out = v.map(x => { const y = unwrap(x, depth + 1); if (y !== x) changed = true; return y; }); return changed ? out : v; }
  if (Object.getPrototypeOf(v) !== Object.prototype) return v;
  let changed = false; const out = {};
  for (const [k, x] of Object.entries(v)) { const y = unwrap(x, depth + 1); if (y !== x) changed = true; out[k] = y; }
  return changed ? out : v;
}

// Run a lambda against state and return { value, reads } (reads as paths with the values seen).
export function track(store, fn, arg) {
  const t = new Tracker(store, store.current);
  const root = t.root();
  let value, error = null;
  try { value = arg === undefined ? fn(root) : fn(root, arg); } catch (e) { error = e; }
  const paths = t.finish(value);
  const reads = paths.map(p => ({ path: p, value: store.peek(p) }));
  return { value: unwrap(value), reads, error };
}

// Which path does a binding lambda (s => s.frame[key]) name? The last read chain.
export function bindingPath(store, fn) {
  const t = new Tracker(store, store.current);
  let value, error = null;
  try { value = fn(t.root()); } catch (e) { error = e; }
  const p = pathOfProxy(value) || t.last;
  return { path: p, error, value: unwrap(value) };
}

// The first key of a path that does not exist, with what the parent has (for "did you mean").
export function missingKey(state, path) {
  let v = state;
  for (let i = 0; i < path.length; i++) {
    const k = path[i];
    if (!isObj(v)) return { index: i, parent: path.slice(0, i), key: k, has: [], parentMissing: true };
    if (!(k in v)) return { index: i, parent: path.slice(0, i), key: k, has: Array.isArray(v) ? [] : Object.keys(v) };
    v = v[k];
  }
  return null;
}

export { getIn };
