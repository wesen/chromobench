// The store (port of CraftKit core/store.js): one immutable state tree in tiers.
//
//   document  what the user makes. Every change is a transaction with an inverse, so it can be undone, and it is
//             what autosave writes.
//   view      how the user looks at it (zoom, the open module, panel sizes, the selection). Changed freely, saved
//             with the workspace, never undone.
//   preview   transient layers over both: named layers (agent proposals) and the gesture layer (a slider drag).
//             Readers see them; the document does not change until the gesture commits, which makes one
//             transaction — one undo step — of the whole drag.
//
// New in the port:
//   - tiers by path prefix ('ui', 'roll.contact'): the longest listed prefix wins;
//   - named preview layers: current = doc ⊕ named layers ⊕ gesture;
//   - routes: writes under a declared prefix (recipes.<frameId>) go to an adapter first. If it throws, the whole
//     transaction is aborted and reported; otherwise the plain patches and the adapter's mirror values are written
//     in one writeDoc, so cells see one change.
//
// Writes notify a path index; cells whose read sets touch a written path are marked dirty and re-run on the next
// frame, all against the same state, so no reader ever sees half a transaction.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { isObj, pathStr, parsePath, getIn, setIn, prefixOf, deepEq, type Key, type Path } from './util.ts';
import { track, rawOf as trackedRaw, type Tracker, type DerivedSource } from './track.ts';
import type { History, HistoryPart } from './history.ts';

export interface Patch {
  path: Key[];
  before: unknown;
  after: unknown;
}
export interface Write {
  path: Key[];
  value: unknown;
}
/** A value an adapter publishes into the tree (its projection). */
export type Mirror = Write;

export interface TxOpts {
  /** merge consecutive transactions with the same key within 1.5 s */
  coalesce?: string | null;
  /** the per-channel History list this step files into (a photo, a frame) */
  channel?: string | null;
  snapPath?: Key[] | null;
  snapBefore?: unknown;
  /** the value shown next to the label */
  detail?: string;
  seedLabel?: string;
  /** false: write without a history entry */
  record?: boolean;
  /** false: do not add to the channel list (stepping back in a channel) */
  channelEntry?: boolean;
  /** a transaction elsewhere does not cancel the open gesture */
  keepPreview?: boolean;
  [k: string]: unknown;
}

export interface WriteInfo {
  label?: string;
  tier?: 'document' | 'view' | 'route';
  tx?: boolean;
  preview?: boolean;
  cancel?: boolean;
  undo?: boolean;
  redo?: boolean;
  init?: boolean;
  layer?: string;
  route?: string;
  [k: string]: unknown;
}

/** What a route adapter returns for the patches under its prefix. */
export interface RouteResult {
  /** undo/redo of what the adapter did; when absent, the store undoes the routed patches itself */
  part?: HistoryPart | null;
  parts?: HistoryPart[];
  /** the values to write instead of the routed patches (the adapter's projection); absent: write the patches */
  mirror?: Mirror[];
}
/** Supplied by the host at start for each route the program declares. */
export interface RouteAdapter {
  readonly id?: string;
  /** commit: throw to refuse (validation, E_STALE); the whole transaction is then aborted */
  apply(patches: Patch[], info: { label: string; opts: TxOpts }): RouteResult | void;
  /** told about gesture previews under the prefix (the shell still overlays them for readers) */
  preview?(writes: Write[]): void;
  cancel?(): void;
  /** called once when attached: publish projection changes not caused by the store (agent, load) */
  attach?(api: RouteApi): void | (() => void);
}
export interface RouteApi {
  publish(mirror: Mirror[], info?: WriteInfo): void;
  push(entry: { label: string; detail?: string; channel?: string | null; parts: HistoryPart[] }): void;
  readonly store: Store;
}
export interface RouteDecl {
  /** a dotted prefix: 'recipes' */
  prefix: string;
  /** how many segments after the prefix are keys (recipes.<frameId> → 1) */
  keyDepth?: number;
  /** checks a path under the prefix (without the prefix and key segments); returns an error message or null */
  checkPath?: (rest: Key[]) => string | null | undefined | { message: string; fix?: string; valid?: string[] };
  readonly?: boolean;
  source?: string;
}
interface Route {
  decl: RouteDecl;
  prefix: Key[];
  adapter: RouteAdapter | null;
}

export class TxRefused extends Error {
  readonly label: string;
  readonly cause2: unknown;
  readonly route: string;
  constructor(label: string, route: string, cause: unknown) {
    super(`${label} was refused by ${route}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'TxRefused';
    this.label = label;
    this.route = route;
    this.cause2 = cause;
  }
}

// State never holds proxies. A value written back may contain objects read through a proxy (ctx.state.spots
// .concat([spot]) yields the read-only proxies of the old spots): strip replaces them by the plain objects,
// walking only the new structure (plain state objects contain no proxies, so the walk stops at them).
const RO = Symbol('ck.readonly');
export function strip<T>(v: T, depth = 0): T {
  if (v === null || typeof v !== 'object') return v;
  const r = (v as any)[RO] || trackedRaw(v);
  if (r !== v) return r;
  if (depth > 12) return v;
  if (Array.isArray(v)) {
    let changed = false;
    const out = v.map(x => {
      const y = strip(x, depth + 1);
      if (y !== x) changed = true;
      return y;
    });
    return (changed ? out : v) as T;
  }
  if (Object.getPrototypeOf(v) !== Object.prototype) return v;
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v)) {
    const x = (v as any)[k];
    const y = strip(x, depth + 1);
    if (y !== x) changed = true;
    out[k] = y;
  }
  return (changed ? out : v) as T;
}

// ── the path index: a trie of subscribers ─────────────────────────────────
class TrieNode {
  kids = new Map<string, TrieNode>();
  subs: Set<unknown> | null = null;
}
export class PathIndex {
  root = new TrieNode();
  count = 0;
  add(path: Path, sub: unknown): void {
    let n = this.root;
    for (const k of path) {
      const kk = String(k);
      let c = n.kids.get(kk);
      if (!c) {
        c = new TrieNode();
        n.kids.set(kk, c);
      }
      n = c;
    }
    (n.subs || (n.subs = new Set())).add(sub);
    this.count++;
  }
  remove(path: Path, sub: unknown): void {
    const trail = [this.root];
    let n: TrieNode | undefined = this.root;
    for (const k of path) {
      n = n.kids.get(String(k));
      if (!n) return;
      trail.push(n);
    }
    if (n.subs && n.subs.delete(sub)) this.count--;
    // prune empty branches
    for (let i = trail.length - 1; i > 0; i--) {
      const x = trail[i]!;
      if ((x.subs && x.subs.size) || x.kids.size) break;
      trail[i - 1]!.kids.delete(String(path[i - 1]));
    }
  }
  /** everyone who read the written path, an ancestor of it, or something inside it */
  affected(path: Path, out: Set<unknown>): Set<unknown> {
    let n: TrieNode | undefined = this.root;
    if (n.subs) for (const s of n.subs) out.add(s);
    for (const k of path) {
      n = n.kids.get(String(k));
      if (!n) return out;
      if (n.subs) for (const s of n.subs) out.add(s);
    }
    const stack = [...n.kids.values()];
    while (stack.length) {
      const x = stack.pop()!;
      if (x.subs) for (const s of x.subs) out.add(s);
      for (const c of x.kids.values()) stack.push(c);
    }
    return out;
  }
}

// ── derived values: computed paths with their own read sets ───────────────
class Derived {
  reads: { path: Key[]; value: unknown }[] | null = null;
  value: unknown = undefined;
  runs = 0;
  readonly store: Store;
  readonly path: Key[];
  readonly fn: (s: any) => unknown;
  constructor(store: Store, path: Key[], fn: (s: any) => unknown) {
    this.store = store;
    this.path = path;
    this.fn = fn;
  }
  stale(): boolean {
    return !this.reads || this.reads.some(r => this.store.peek(r.path) !== r.value);
  }
  compute(): unknown {
    if (this.stale()) {
      const r = track(this.store, this.fn);
      if (r.error) throw r.error;
      this.reads = r.reads;
      this.value = r.value;
      this.runs++;
    }
    return this.value;
  }
  // a reader of a derived path depends on what the derived value read: these are already the derived value's
  // final dependencies (leaves and objects it used whole); the reader keeps them as they are
  read(tracker: Tracker): unknown {
    const v = this.compute();
    for (const r of this.reads!) {
      tracker.record(r.path);
      tracker.whole.add(pathStr(r.path));
    }
    return v;
  }
}

export interface StoreOpts {
  /** view-tier prefixes ('ui', 'view', 'prefs', 'workspace', 'roll.contact'); the rest is document */
  view?: string[];
  routes?: RouteDecl[];
}

const DEFAULT_VIEW = ['ui', 'view', 'prefs', 'workspace'];
type Listener = (paths: Key[][], info: WriteInfo) => void;

/** A named preview layer (agent proposals). */
export interface Layer {
  readonly name: string;
  set(p: string | Path, value: unknown): Layer;
  get size(): number;
  writes(): Write[];
  drop(): void;
  commit(label: string, opts?: TxOpts): unknown;
}

export class Store implements DerivedSource {
  doc: any;
  current: any;
  /** the gesture layer: pathStr → { path, value } */
  previewPatches = new Map<string, Write>();
  /** named layers, in creation order, under the gesture layer */
  layers = new Map<string, Map<string, Write>>();
  viewPrefixes: Key[][];
  routes: Route[] = [];
  index = new PathIndex();
  derived = new Map<string, Derived>();
  listeners = new Set<Listener>();
  refusals = new Set<(e: TxRefused) => void>();
  history: History | null = null;
  version = 0;
  /** subscribers marked dirty, waiting for a flush */
  pending = new Set<unknown>();
  /** the scheduler asks to be told */
  onDirty: (() => void) | null = null;
  private cellSeq = 0;

  constructor(init: object = {}, opts: StoreOpts = {}) {
    this.doc = init;
    this.current = init;
    this.viewPrefixes = (opts.view || DEFAULT_VIEW).map(p => parsePath(p));
    for (const r of opts.routes || []) this.declareRoute(r);
  }
  nextCellId(): number {
    return ++this.cellSeq;
  }

  tierOf(path: Path): 'document' | 'view' {
    let best = -1;
    for (const p of this.viewPrefixes) if (p.length > best && prefixOf(p, path)) best = p.length;
    return best >= 0 ? 'view' : 'document';
  }

  // ── routes ──
  declareRoute(decl: RouteDecl): void {
    const prefix = parsePath(decl.prefix);
    const prev = this.routes.find(r => pathStr(r.prefix) === pathStr(prefix));
    if (prev) prev.decl = decl;
    else this.routes.push({ decl, prefix, adapter: null });
  }
  /** attach the host's adapter to a declared (or new) route */
  route(prefix: string, adapter: RouteAdapter): () => void {
    let r = this.routes.find(x => pathStr(x.prefix) === prefix);
    if (!r) {
      this.declareRoute({ prefix });
      r = this.routes[this.routes.length - 1]!;
    }
    r.adapter = adapter;
    const api: RouteApi = {
      store: this,
      publish: (mirror, info) => this.writeDoc(mirror, { tier: 'route', route: prefix, ...(info || {}) }),
      push: e => {
        this.history?.push({ label: e.label, ...(e.detail !== undefined ? { detail: e.detail } : {}), channel: e.channel ?? null, source: adapter.id || prefix, parts: e.parts });
      },
    };
    const off = adapter.attach ? adapter.attach(api) : undefined;
    return () => {
      if (r && r.adapter === adapter) r.adapter = null;
      if (typeof off === 'function') off();
    };
  }
  routeOf(path: Path): Route | null {
    for (const r of this.routes) if (prefixOf(r.prefix, path) || prefixOf(path, r.prefix)) return r;
    return null;
  }
  isRouted(path: Path): boolean {
    return !!this.routeOf(path);
  }

  // ── reads ──
  peek(path: Path): any {
    if (this.derived.size) {
      const d = this.derivedAt(path);
      if (d) return d.compute();
    }
    return getIn(this.current, path);
  }
  get(p: string | Path): any {
    return this.peek(parsePath(p));
  }
  derivedAt(path: Path): Derived | null {
    if (!this.derived.size) return null;
    return this.derived.get(pathStr(path)) || null;
  }
  derive(p: string | Path, fn: (s: any) => unknown): this {
    const path = parsePath(p);
    this.derived.set(pathStr(path), new Derived(this, path, fn));
    return this;
  }

  /** A read-only view of the state for runtime handlers: derived paths resolve, writes throw (CK-T410). */
  readonly(): any {
    const store = this;
    const wrap = (v: unknown, path: Key[]): any => {
      if (!isObj(v)) return v;
      return new Proxy(v, {
        get(t: any, k, r) {
          if (k === RO) return t;
          if (typeof k === 'symbol') return Reflect.get(t, k, r);
          const kk: Key = Array.isArray(t) && /^\d+$/.test(k) ? +k : k;
          const child = path.concat([kk]);
          const d = store.derivedAt(child);
          if (d) return d.compute();
          const x = Reflect.get(t, k, r);
          return typeof x === 'function' ? x : wrap(x, child);
        },
        set(_t, k) {
          const e = new TypeError(`State is read-only in handlers: '${pathStr(path.concat([String(k)]))}' was not changed. Use ctx.tx(label, t => …).`);
          (e as any).code = 'CK-T410';
          throw e;
        },
        deleteProperty(_t, k) {
          const e = new TypeError(`State is read-only in handlers: '${pathStr(path.concat([String(k)]))}' was not deleted. Use ctx.tx(label, t => …).`);
          (e as any).code = 'CK-T410';
          throw e;
        },
      });
    };
    return wrap(this.current, []);
  }

  // ── subscriptions ──
  subscribe(paths: Path[], sub: unknown): void {
    for (const p of paths) this.index.add(p, sub);
  }
  unsubscribe(paths: Path[], sub: unknown): void {
    for (const p of paths) this.index.remove(p, sub);
  }
  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  onRefused(fn: (e: TxRefused) => void): () => void {
    this.refusals.add(fn);
    return () => this.refusals.delete(fn);
  }

  notify(paths: Key[][], info: WriteInfo): void {
    this.version++;
    const hit = new Set<unknown>();
    for (const p of paths) this.index.affected(p, hit);
    for (const s of hit) this.pending.add(s);
    for (const f of this.listeners) f(paths, info);
    if (this.pending.size && this.onDirty) this.onDirty();
  }

  // ── writes ──
  /** the lowest-level write: straight into the committed state (used by transactions, undo and view writes) */
  writeDoc(writes: Write[], info: WriteInfo = {}): void {
    let doc = this.doc;
    for (const { path, value } of writes) doc = setIn(doc, path, strip(value));
    this.doc = doc;
    this.rebase();
    this.notify(
      writes.map(p => p.path),
      info,
    );
  }
  rebase(): void {
    let cur = this.doc;
    for (const layer of this.layers.values()) for (const { path, value } of layer.values()) cur = setIn(cur, path, value);
    for (const { path, value } of this.previewPatches.values()) cur = setIn(cur, path, value);
    this.current = cur;
  }

  /** set view-tier state directly (no undo); document paths go through a transaction */
  set(p: string | Path, value: unknown, info?: WriteInfo & TxOpts): unknown {
    const path = parsePath(p);
    if (this.tierOf(path) === 'document') return this.tx((info && info.label) || 'Change', t => t.$set(path, value), info);
    this.writeDoc([{ path, value }], Object.assign({ tier: 'view' as const }, info));
    return null;
  }
  /** merge a nested object of state: ctx.set({ view: { mode: 'loupe' } }); document paths become a transaction */
  setMany(obj: Record<string, unknown>, info?: WriteInfo & TxOpts): void {
    const writes: Write[] = [];
    const walk = (v: unknown, path: Key[]): void => {
      const plain = isObj(v) && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
      const there = getIn(this.doc, path);
      if (plain && (path.length < 1 || (isObj(there) && !Array.isArray(there)))) {
        for (const [k, x] of Object.entries(v as object)) walk(x, path.concat([k]));
        return;
      }
      writes.push({ path, value: v });
    };
    walk(obj, []);
    const doc = writes.filter(p => this.tierOf(p.path) === 'document');
    const view = writes.filter(p => this.tierOf(p.path) === 'view');
    if (view.length) this.writeDoc(view, Object.assign({ tier: 'view' as const }, info));
    if (doc.length)
      this.tx(
        (info && info.label) || 'Change',
        t => {
          for (const p of doc) t.$set(p.path, p.value);
        },
        info,
      );
  }

  /** A transaction: fn(t) writes through a draft; the result is one history entry with the inverse of every write. */
  tx(label: string, fn: (t: any) => unknown, opts: TxOpts = {}): unknown {
    const draft = new Draft(this);
    const ret = fn(draft.proxy());
    if (ret && typeof (ret as Promise<unknown>).then === 'function')
      throw new TypeError(`ctx.tx('${label}') got an async function: compute first, then write in one synchronous transaction`);
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

  commitPatches(label: string, patches: Patch[], opts: TxOpts = {}): unknown {
    if (opts.snapPath && opts.snapBefore === undefined) opts = Object.assign({}, opts, { snapBefore: getIn(this.doc, opts.snapPath) });
    // routes first: an adapter may refuse, which aborts everything
    const plain: Patch[] = [];
    const byRoute = new Map<Route, Patch[]>();
    for (const p of patches) {
      const r = this.routeOf(p.path);
      if (r && r.adapter) (byRoute.get(r) || byRoute.set(r, []).get(r)!).push(p);
      else plain.push(p);
    }
    const writes: Write[] = plain.map(p => ({ path: p.path, value: p.after }));
    const undoable: Patch[] = plain.filter(p => this.tierOf(p.path) === 'document');
    const parts: HistoryPart[] = [];
    for (const [r, ps] of byRoute) {
      let res: RouteResult | void;
      try {
        res = r.adapter!.apply(ps, { label, opts });
      } catch (e) {
        const err = new TxRefused(label, r.adapter!.id || pathStr(r.prefix), e);
        if (this.previewPatches.size) this.cancel();
        for (const f of this.refusals) f(err);
        if (!this.refusals.size) throw err;
        return null;
      }
      const ownParts = res ? (res.parts || (res.part ? [res.part] : [])) : [];
      parts.push(...ownParts);
      if (res && res.mirror) writes.push(...res.mirror);
      else writes.push(...ps.map(p => ({ path: p.path, value: p.after })));
      if (!ownParts.length) undoable.push(...ps);
    }
    const tier = undoable.length || parts.length ? 'document' : 'view';
    this.writeDoc(writes, { label, tier, tx: true });
    if ((undoable.length || parts.length) && this.history && opts.record !== false) return this.history.record(label, undoable, opts, parts);
    return null;
  }

  // ── the gesture layer ──
  preview(p: string | Path, value: unknown): void {
    const path = parsePath(p);
    value = strip(value);
    this.previewPatches.set(pathStr(path), { path, value });
    this.current = setIn(this.current, path, value);
    const r = this.routeOf(path);
    if (r && r.adapter && r.adapter.preview) r.adapter.preview([{ path, value }]);
    this.notify([path], { preview: true });
  }
  get previewing(): boolean {
    return this.previewPatches.size > 0;
  }
  /** turn the gesture layer into one transaction */
  commit(label: string, opts: TxOpts = {}): unknown {
    if (!this.previewPatches.size) return null;
    const patches: Patch[] = [];
    for (const { path, value } of this.previewPatches.values()) {
      const before = getIn(this.doc, path);
      if (before !== value && !deepEq(before, value)) patches.push({ path, before, after: value });
    }
    this.previewPatches.clear();
    if (!patches.length) {
      this.rebase();
      this.notify([], { preview: true });
      return null;
    }
    return this.commitPatches(label, patches, opts);
  }
  cancel(): void {
    if (!this.previewPatches.size) return;
    const paths = [...this.previewPatches.values()].map(p => p.path);
    const routes = new Set(paths.map(p => this.routeOf(p)).filter(Boolean) as Route[]);
    this.previewPatches.clear();
    this.rebase();
    for (const r of routes) r.adapter?.cancel?.();
    this.notify(paths, { preview: true, cancel: true });
  }

  // ── named layers ──
  layer(name: string): Layer {
    const store = this;
    const get = (): Map<string, Write> => {
      let m = store.layers.get(name);
      if (!m) {
        m = new Map();
        store.layers.set(name, m);
      }
      return m;
    };
    const api: Layer = {
      name,
      set(p, value) {
        const path = parsePath(p);
        get().set(pathStr(path), { path, value: strip(value) });
        store.rebase();
        store.notify([path], { preview: true, layer: name });
        return api;
      },
      get size() {
        return store.layers.get(name)?.size ?? 0;
      },
      writes() {
        return [...(store.layers.get(name)?.values() ?? [])];
      },
      drop() {
        const m = store.layers.get(name);
        if (!m) return;
        store.layers.delete(name);
        store.rebase();
        store.notify(
          [...m.values()].map(w => w.path),
          { preview: true, cancel: true, layer: name },
        );
      },
      commit(label, opts = {}) {
        const m = store.layers.get(name);
        if (!m) return null;
        store.layers.delete(name);
        const patches: Patch[] = [];
        for (const { path, value } of m.values()) {
          const before = getIn(store.doc, path);
          if (before !== value && !deepEq(before, value)) patches.push({ path, before, after: value });
        }
        if (!patches.length) {
          store.rebase();
          store.notify([], { preview: true, layer: name });
          return null;
        }
        return store.commitPatches(label, patches, opts);
      },
    };
    return api;
  }

  /** drain the dirty set (the scheduler calls this once per frame) */
  takePending(): Set<unknown> {
    const p = this.pending;
    this.pending = new Set();
    return p;
  }

  /** The committed state of one tier; routed prefixes are never part of the document snapshot. */
  snapshot(tier: 'document' | 'view' = 'document'): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const doc = this.doc as Record<string, unknown>;
    const nestedView = this.viewPrefixes.filter(p => p.length > 1);
    for (const [k, v] of Object.entries(doc)) {
      const top = [k];
      if (this.routes.some(r => prefixOf(r.prefix, top))) continue;
      const t = this.tierOf(top);
      if (t === 'view') {
        if (tier === 'view') out[k] = v;
        continue;
      }
      const nested = nestedView.filter(p => String(p[0]) === k);
      let routedInside = this.routes.filter(r => r.prefix.length > 1 && String(r.prefix[0]) === k);
      if (tier === 'document') {
        let x: unknown = v;
        for (const p of nested) x = setIn(x, p.slice(1), undefined);
        for (const r of routedInside) x = setIn(x, r.prefix.slice(1), undefined);
        out[k] = x;
      } else if (nested.length) {
        let x: unknown = {};
        for (const p of nested) {
          const val = getIn(v, p.slice(1));
          if (val !== undefined) x = setIn(x, p.slice(1), val);
        }
        out[k] = x;
      }
      routedInside = [];
    }
    return out;
  }
}

// ── drafts: what ctx.tx hands to its lambda ──────────────────────────────
// t.develop.light.exposure = 0.3 · t.catalog.photos[3].flag = 'pick' · t.$set(path, v) · t.$update(path, f)
// t.$merge(path, obj) · t.$push(path, ...items) · t.$remove(path, pred) · array methods on draft arrays
const MUTATING = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin']);
export class Draft {
  next: any;
  writes = new Map<string, { path: Key[]; before: unknown }>();
  readonly store: Store;
  constructor(store: Store) {
    this.store = store;
    this.next = store.doc;
  }
  read(path: Key[]): any {
    const d = this.store.derivedAt(path);
    if (d) return d.compute();
    return getIn(this.next, path);
  }
  write(path: Key[], value: unknown): void {
    value = strip(value);
    const k = pathStr(path);
    // a write inside a path written earlier, or above it, is fine: keep the earliest 'before' per exact path
    if (!this.writes.has(k)) this.writes.set(k, { path, before: getIn(this.store.doc, path) });
    this.next = setIn(this.next, path, value);
  }
  patches(): Patch[] {
    // collapse: if both a path and its ancestor were written, keep the ancestor's write only
    const list = [...this.writes.values()].sort((a, b) => a.path.length - b.path.length);
    const kept: typeof list = [];
    for (const w of list) if (!kept.some(k => prefixOf(k.path, w.path))) kept.push(w);
    return kept.map(w => ({ path: w.path, before: w.before, after: getIn(this.next, w.path) })).filter(p => p.before !== p.after);
  }
  proxy(path: Key[] = []): any {
    const d = this;
    const target = function () {};
    return new Proxy(target, {
      get(_t, k) {
        if (k === '$set') return (p: string | Path, v: unknown) => d.write(path.concat(parsePath(p)), v);
        if (k === '$update')
          return (p: string | Path, f: (x: any) => unknown) => {
            const pp = path.concat(parsePath(p));
            d.write(pp, f(d.read(pp)));
          };
        if (k === '$merge')
          return (p: string | Path, o: object) => {
            const pp = path.concat(parsePath(p));
            const cur = d.read(pp);
            d.write(pp, Object.assign({}, cur, o));
          };
        if (k === '$push')
          return (p: string | Path, ...items: unknown[]) => {
            const pp = path.concat(parsePath(p));
            d.write(pp, (d.read(pp) || []).concat(items));
          };
        if (k === '$remove')
          return (p: string | Path, pred: (x: any, i: number) => boolean) => {
            const pp = path.concat(parsePath(p));
            d.write(
              pp,
              (d.read(pp) || []).filter((x: any, i: number) => !pred(x, i)),
            );
          };
        if (k === '$get') return (p?: string | Path) => d.read(path.concat(parsePath(p == null ? [] : p)));
        if (k === '$path') return path;
        if (k === '$value') return d.read(path);
        if (typeof k === 'symbol') {
          const v = d.read(path);
          return v == null ? undefined : v[k];
        }
        const cur = d.read(path);
        if (Array.isArray(cur)) {
          if (k === 'length') return cur.length;
          if (MUTATING.has(k))
            return (...args: unknown[]) => {
              const copy: any = cur.slice();
              const r = copy[k](...args);
              d.write(path, copy);
              return r;
            };
          if (typeof (Array.prototype as any)[k] === 'function' && !/^\d+$/.test(k)) {
            const els = cur.map((x, i) => (isObj(x) ? d.proxy(path.concat([i])) : x));
            return (...args: unknown[]) => (Array.prototype as any)[k].apply(els, args);
          }
        }
        const kk: Key = Array.isArray(cur) && /^\d+$/.test(k) ? +k : k;
        const child = path.concat([kk]);
        const v = d.read(child);
        return isObj(v) ? d.proxy(child) : v;
      },
      set(_t, k, v) {
        const cur = d.read(path);
        const kk: Key = Array.isArray(cur) && typeof k === 'string' && /^\d+$/.test(k) ? +k : (k as string);
        d.write(path.concat([kk]), v && v.$path && v.$value !== undefined ? v.$value : v);
        return true;
      },
      deleteProperty(_t, k) {
        d.write(path.concat([k as string]), undefined);
        return true;
      },
      has(_t, k) {
        const cur = d.read(path);
        return isObj(cur) && k in cur;
      },
      ownKeys() {
        const cur = d.read(path);
        return isObj(cur) ? Reflect.ownKeys(cur).concat(['prototype']).filter((x, i, a) => a.indexOf(x) === i) : ['prototype'];
      },
      getOwnPropertyDescriptor(t, k) {
        if (k === 'prototype') return Reflect.getOwnPropertyDescriptor(t, k);
        const cur = d.read(path);
        if (!isObj(cur) || !(k in cur)) return undefined;
        return { value: cur[k as string], writable: true, enumerable: true, configurable: true };
      },
    });
  }
}

export type { Key, Path };
