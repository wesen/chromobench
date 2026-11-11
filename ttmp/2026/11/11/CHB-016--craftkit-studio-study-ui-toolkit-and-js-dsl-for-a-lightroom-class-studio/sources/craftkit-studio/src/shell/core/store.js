// The store: one immutable state tree in three tiers.
//
//   document  what the user makes (the catalog, develop settings, pages). Every change is a transaction with an
//             inverse, so it can be undone, and it is what autosave writes.
//   view      how the user looks at it (zoom, the open module, panel sizes, the selection in a list). Changed
//             freely, saved with the workspace, never undone.
//   preview   a transient layer over both while a gesture runs (a slider drag). Readers see it; the document does
//             not change until the gesture commits, which makes one transaction — one undo step — of the whole drag.
//
// Which tier a path belongs to is decided by its top-level key (ck.state(init, { view: ['ui', 'view'] })).
// Writes notify a path index; cells whose read sets touch a written path are marked dirty and re-run on the next
// frame, all against the same state, so no reader ever sees half a transaction.

import { isObj, pathStr, parsePath, getIn, setIn, prefixOf, deepEq } from './util.js';
import { track, rawOf as trackedRaw } from './track.js';

// State never holds proxies. A value written back may contain objects read through a proxy (ctx.state.spots
// .concat([spot]) yields the read-only proxies of the old spots): strip replaces them by the plain objects,
// walking only the new structure (plain state objects contain no proxies, so the walk stops at them).
const RO = Symbol('ck.readonly');
export function strip(v, depth = 0) {
  if (v === null || typeof v !== 'object') return v;
  const r = v[RO] || trackedRaw(v);
  if (r !== v) return r;
  if (depth > 12) return v;
  if (Array.isArray(v)) { let changed = false; const out = v.map(x => { const y = strip(x, depth + 1); if (y !== x) changed = true; return y; }); return changed ? out : v; }
  if (Object.getPrototypeOf(v) !== Object.prototype) return v;
  let changed = false; const out = {};
  for (const k of Object.keys(v)) { const y = strip(v[k], depth + 1); if (y !== v[k]) changed = true; out[k] = y; }
  return changed ? out : v;
}

// ── the path index: a trie of subscribers ─────────────────────────────────
class Node { constructor() { this.kids = new Map(); this.subs = null; } }
export class PathIndex {
  constructor() { this.root = new Node(); this.count = 0; }
  add(path, sub) {
    let n = this.root;
    for (const k of path) { const kk = String(k); let c = n.kids.get(kk); if (!c) { c = new Node(); n.kids.set(kk, c); } n = c; }
    (n.subs || (n.subs = new Set())).add(sub); this.count++;
  }
  remove(path, sub) {
    const trail = [this.root]; let n = this.root;
    for (const k of path) { n = n.kids.get(String(k)); if (!n) return; trail.push(n); }
    if (n.subs && n.subs.delete(sub)) this.count--;
    // prune empty branches
    for (let i = trail.length - 1; i > 0; i--) { const x = trail[i]; if ((x.subs && x.subs.size) || x.kids.size) break; trail[i - 1].kids.delete(String(path[i - 1])); }
  }
  // everyone who read the written path, an ancestor of it, or something inside it
  affected(path, out) {
    let n = this.root;
    if (n.subs) for (const s of n.subs) out.add(s);
    for (const k of path) {
      n = n.kids.get(String(k)); if (!n) return out;
      if (n.subs) for (const s of n.subs) out.add(s);
    }
    const stack = [...n.kids.values()];
    while (stack.length) { const x = stack.pop(); if (x.subs) for (const s of x.subs) out.add(s); for (const c of x.kids.values()) stack.push(c); }
    return out;
  }
}

// ── derived values: computed paths with their own read sets ───────────────
class Derived {
  constructor(store, path, fn) { this.store = store; this.path = path; this.fn = fn; this.reads = null; this.value = undefined; this.runs = 0; }
  stale() { return !this.reads || this.reads.some(r => this.store.peek(r.path) !== r.value); }
  compute() {
    if (this.stale()) {
      const r = track(this.store, this.fn);
      if (r.error) throw r.error;
      this.reads = r.reads; this.value = r.value; this.runs++;
    }
    return this.value;
  }
  read(tracker) {   // a reader of a derived path depends on what the derived value read
    const v = this.compute();
    // these are already the derived value's final dependencies (leaves and objects it used whole); the reader
    // keeps them as they are, or its own pruning would drop catalog.photos.3 as a mere prefix of …photos.3.date
    for (const r of this.reads) { tracker.record(r.path); tracker.whole.add(pathStr(r.path)); }
    return v;
  }
}

// ── the store ────────────────────────────────────────────────────────────
export class Store {
  constructor(init = {}, opts = {}) {
    this.doc = init;                       // committed state, all tiers
    this.current = init;                   // doc with the preview layer applied
    this.previewPatches = new Map();       // pathStr → { path, value }
    this.viewKeys = new Set(opts.view || ['ui', 'view', 'prefs', 'workspace']);
    this.index = new PathIndex();
    this.derived = new Map();              // pathStr → Derived
    this.derivedParents = new Set();       // pathStr of parents that have derived children
    this.listeners = new Set();            // (changed paths, info) after every write
    this.history = null;                   // set by History
    this.version = 0;
    this.pending = new Set();              // subscribers marked dirty, waiting for a flush
    this.onDirty = null;                   // the scheduler asks to be told
  }

  tierOf(path) { return this.viewKeys.has(String(path[0])) ? 'view' : 'document'; }

  // ── reads ──
  peek(path) {
    if (this.derived.size) { const d = this.derivedAt(path); if (d) return d.compute(); }
    return getIn(this.current, path);
  }
  get(p) { return this.peek(parsePath(p)); }
  derivedAt(path) { if (!this.derived.size) return null; return this.derived.get(pathStr(path)) || null; }
  derive(p, fn) { const path = parsePath(p); this.derived.set(pathStr(path), new Derived(this, path, fn)); this.derivedParents.add(pathStr(path.slice(0, -1))); return this; }

  // A read-only view of the state for runtime handlers: derived paths resolve, writes throw.
  readonly() {
    const store = this;
    const wrap = (v, path) => {
      if (!isObj(v)) return v;
      return new Proxy(v, {
        get(t, k, r) {
          if (k === RO) return t;
          if (typeof k === 'symbol') return Reflect.get(t, k, r);
          const kk = Array.isArray(t) && /^\d+$/.test(k) ? +k : k;
          const child = path.concat([kk]);
          const d = store.derivedAt(child);
          if (d) return d.compute();
          const x = Reflect.get(t, k, r);
          return typeof x === 'function' ? x : wrap(x, child);
        },
        set(t, k) { const e = new TypeError(`State is read-only in handlers: '${pathStr(path.concat([k]))}' was not changed. Use ctx.tx(label, t => …).`); e.code = 'CK-T410'; throw e; },
        deleteProperty(t, k) { const e = new TypeError(`State is read-only in handlers: '${pathStr(path.concat([k]))}' was not deleted. Use ctx.tx(label, t => …).`); e.code = 'CK-T410'; throw e; },
      });
    };
    return wrap(this.current, []);
  }

  // ── subscriptions ──
  subscribe(paths, sub) { for (const p of paths) this.index.add(p, sub); }
  unsubscribe(paths, sub) { for (const p of paths) this.index.remove(p, sub); }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  notify(paths, info) {
    this.version++;
    const hit = new Set();
    for (const p of paths) this.index.affected(p, hit);
    for (const s of hit) this.pending.add(s);
    for (const f of this.listeners) f(paths, info);
    if (this.pending.size && this.onDirty) this.onDirty();
  }

  // ── writes ──
  // the lowest-level write: patches straight into the committed state (used by transactions, undo and view writes)
  writeDoc(patches, info = {}) {
    let doc = this.doc;
    for (const { path, value } of patches) doc = setIn(doc, path, strip(value));
    this.doc = doc;
    this.rebase();
    this.notify(patches.map(p => p.path), info);
  }
  rebase() {
    let cur = this.doc;
    for (const { path, value } of this.previewPatches.values()) cur = setIn(cur, path, value);
    this.current = cur;
  }

  // set view-tier state directly (no undo); document paths go through a transaction
  set(p, value, info) {
    const path = parsePath(p);
    if (this.tierOf(path) === 'document') return this.tx(info && info.label || 'Change', t => t.$set(path, value), info);
    this.writeDoc([{ path, value }], Object.assign({ tier: 'view' }, info));
  }
  // merge a nested object of view state: ctx.set({ view: { mode: 'loupe' } })
  setMany(obj, info) {
    const patches = [];
    const walk = (v, path) => {
      if (isObj(v) && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype && path.length < 1) { for (const [k, x] of Object.entries(v)) walk(x, path.concat([k])); return; }
      if (isObj(v) && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype && isObj(getIn(this.doc, path)) && !Array.isArray(getIn(this.doc, path))) { for (const [k, x] of Object.entries(v)) walk(x, path.concat([k])); return; }
      patches.push({ path, value: v });
    };
    walk(obj, []);
    const doc = patches.filter(p => this.tierOf(p.path) === 'document'), view = patches.filter(p => this.tierOf(p.path) === 'view');
    if (view.length) this.writeDoc(view, Object.assign({ tier: 'view' }, info));
    if (doc.length) this.tx(info && info.label || 'Change', t => { for (const p of doc) t.$set(p.path, p.value); }, info);
  }

  // A transaction: fn(t) writes through a draft; the result is one history entry with the inverse of every write.
  tx(label, fn, opts = {}) {
    const draft = new Draft(this);
    const ret = fn(draft.proxy());
    if (ret && typeof ret.then === 'function') throw new TypeError(`ctx.tx('${label}') got an async function: compute first, then write in one synchronous transaction`);
    const patches = draft.patches();
    if (!patches.length) return null;
    // an open gesture survives a transaction elsewhere (a background job finishing); one that touches what it
    // previews is cancelled, so its commit cannot overwrite the transaction
    if (this.previewPatches.size && !opts.keepPreview) {
      const overlap = [...this.previewPatches.values()].some(pp => patches.some(q => prefixOf(pp.path, q.path) || prefixOf(q.path, pp.path)));
      if (overlap) this.cancel();
    }
    return this.commitPatches(label, patches, opts);
  }
  commitPatches(label, patches, opts = {}) {
    const docPatches = patches.filter(p => this.tierOf(p.path) === 'document');
    if (opts.snapPath && opts.snapBefore === undefined) opts = Object.assign({}, opts, { snapBefore: getIn(this.doc, opts.snapPath) });
    this.writeDoc(patches.map(p => ({ path: p.path, value: p.after })), { label, tier: docPatches.length ? 'document' : 'view', tx: true });
    if (docPatches.length && this.history && opts.record !== false) return this.history.record(label, docPatches, opts);
    return null;
  }

  // ── the preview layer ──
  preview(p, value) {
    const path = parsePath(p);
    value = strip(value);
    this.previewPatches.set(pathStr(path), { path, value });
    this.current = setIn(this.current, path, value);
    this.notify([path], { preview: true });
  }
  get previewing() { return this.previewPatches.size > 0; }
  // turn the preview into one transaction
  commit(label, opts = {}) {
    if (!this.previewPatches.size) return null;
    const patches = [];
    for (const { path, value } of this.previewPatches.values()) {
      const before = getIn(this.doc, path);
      if (before !== value && !deepEq(before, value)) patches.push({ path, before, after: value });
    }
    this.previewPatches.clear();
    if (!patches.length) { this.rebase(); this.notify([], { preview: true }); return null; }
    return this.commitPatches(label, patches, opts);
  }
  cancel() {
    if (!this.previewPatches.size) return;
    const paths = [...this.previewPatches.values()].map(p => p.path);
    this.previewPatches.clear();
    this.rebase();
    this.notify(paths, { preview: true, cancel: true });
  }

  // drain the dirty set (the scheduler calls this once per frame)
  takePending() { const p = this.pending; this.pending = new Set(); return p; }

  snapshot(tier = 'document') {
    const out = {};
    for (const [k, v] of Object.entries(this.doc)) if ((this.viewKeys.has(k) ? 'view' : 'document') === tier) out[k] = v;
    return out;
  }
}

// ── drafts: what ctx.tx hands to its lambda ──────────────────────────────
// t.develop.light.exposure = 0.3 · t.catalog.photos[3].flag = 'pick' · t.$set(path, v) · t.$update(path, f)
// t.$merge(path, obj) · t.$push(path, ...items) · t.$remove(path, pred) · array methods on draft arrays
const MUTATING = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin']);
export class Draft {
  constructor(store) { this.store = store; this.next = store.doc; this.writes = new Map(); }
  read(path) {
    const d = this.store.derivedAt(path);
    if (d) return d.compute();
    return getIn(this.next, path);
  }
  write(path, value) {
    value = strip(value);
    const k = pathStr(path);
    // a write inside a path written earlier, or above it, is fine: keep the earliest 'before' per exact path
    if (!this.writes.has(k)) this.writes.set(k, { path, before: getIn(this.store.doc, path) });
    this.next = setIn(this.next, path, value);
  }
  patches() {
    // collapse: if both a path and its ancestor were written, keep the ancestor's write only
    const list = [...this.writes.values()].sort((a, b) => a.path.length - b.path.length);
    const kept = [];
    for (const w of list) if (!kept.some(k => prefixOf(k.path, w.path))) kept.push(w);
    return kept.map(w => ({ path: w.path, before: w.before, after: getIn(this.next, w.path) }))
      .filter(p => p.before !== p.after);
  }
  proxy(path = []) {
    const d = this;
    const target = function () {};
    return new Proxy(target, {
      get(t, k) {
        if (k === '$set') return (p, v) => d.write(path.concat(parsePath(p)), v);
        if (k === '$update') return (p, f) => { const pp = path.concat(parsePath(p)); d.write(pp, f(d.read(pp))); };
        if (k === '$merge') return (p, o) => { const pp = path.concat(parsePath(p)); const cur = d.read(pp); d.write(pp, Object.assign({}, cur, o)); };
        if (k === '$push') return (p, ...items) => { const pp = path.concat(parsePath(p)); d.write(pp, (d.read(pp) || []).concat(items)); };
        if (k === '$remove') return (p, pred) => { const pp = path.concat(parsePath(p)); d.write(pp, (d.read(pp) || []).filter((x, i) => !pred(x, i))); };
        if (k === '$get') return p => d.read(path.concat(parsePath(p == null ? [] : p)));
        if (k === '$path') return path;
        if (k === '$value') return d.read(path);
        if (typeof k === 'symbol') { const v = d.read(path); return v == null ? undefined : v[k]; }
        const cur = d.read(path);
        if (Array.isArray(cur)) {
          if (k === 'length') return cur.length;
          if (MUTATING.has(k)) return (...args) => { const copy = cur.slice(); const r = copy[k](...args); d.write(path, copy); return r; };
          if (typeof Array.prototype[k] === 'function' && !/^\d+$/.test(k)) {
            const els = cur.map((x, i) => (isObj(x) ? d.proxy(path.concat([i])) : x));
            return (...args) => Array.prototype[k].apply(els, args);
          }
        }
        const kk = Array.isArray(cur) && /^\d+$/.test(k) ? +k : k;
        const child = path.concat([kk]);
        const v = d.read(child);
        return isObj(v) ? d.proxy(child) : v;
      },
      set(t, k, v) {
        const cur = d.read(path);
        const kk = Array.isArray(cur) && /^\d+$/.test(k) ? +k : k;
        d.write(path.concat([kk]), v && v.$path && v.$value !== undefined ? v.$value : v);
        return true;
      },
      deleteProperty(t, k) { d.write(path.concat([k]), undefined); return true; },
      has(t, k) { const cur = d.read(path); return isObj(cur) && k in cur; },
      ownKeys() { const cur = d.read(path); return isObj(cur) ? Reflect.ownKeys(cur).concat(['prototype']).filter((x, i, a) => a.indexOf(x) === i) : ['prototype']; },
      getOwnPropertyDescriptor(t, k) { if (k === 'prototype') return Reflect.getOwnPropertyDescriptor(t, k); const cur = d.read(path); if (!isObj(cur) || !(k in cur)) return undefined; return { value: cur[k], writable: true, enumerable: true, configurable: true }; },
    });
  }
}
