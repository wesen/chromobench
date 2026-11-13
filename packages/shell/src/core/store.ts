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
//
// The parts live in core/store/: types.ts (Patch, Write, TxOpts, WriteInfo), routes.ts (route types, TxRefused,
// attachRoute), readonly.ts (strip, the handlers' read-only view), path-index.ts (the subscriber trie),
// derived.ts (derived paths), layers.ts (named preview layers), snapshot.ts (a tier's committed state) and
// draft.ts (what ctx.tx hands to its lambda). This file keeps the Store class and re-exports the public names.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { isObj, pathStr, parsePath, getIn, setIn, prefixOf, deepEq, type Key, type Path } from './util.ts';
import type { DerivedSource } from './track.ts';
import type { History, HistoryPart } from './history.ts';
import type { Patch, Write, TxOpts, WriteInfo } from './store/types.ts';
import { attachRoute, TxRefused, type Route, type RouteAdapter, type RouteDecl, type RouteResult } from './store/routes.ts';
import { strip, readonlyView } from './store/readonly.ts';
import { PathIndex } from './store/path-index.ts';
import { Derived } from './store/derived.ts';
import { namedLayer, type Layer } from './store/layers.ts';
import { snapshotOf } from './store/snapshot.ts';
import { Draft } from './store/draft.ts';

export type { Patch, Write, Mirror, TxOpts, WriteInfo } from './store/types.ts';
export type { RouteResult, RouteAdapter, RouteApi, RouteDecl } from './store/routes.ts';
export { TxRefused } from './store/routes.ts';
export { strip } from './store/readonly.ts';
export { PathIndex } from './store/path-index.ts';
export type { Layer } from './store/layers.ts';
export { Draft } from './store/draft.ts';

export interface StoreOpts {
  /** view-tier prefixes ('ui', 'view', 'prefs', 'workspace', 'roll.contact'); the rest is document */
  view?: string[];
  routes?: RouteDecl[];
}

const DEFAULT_VIEW = ['ui', 'view', 'prefs', 'workspace'];
type Listener = (paths: Key[][], info: WriteInfo) => void;

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
    return attachRoute(this, prefix, adapter);
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
    return readonlyView(this);
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
    return namedLayer(this, name);
  }

  /** drain the dirty set (the scheduler calls this once per frame) */
  takePending(): Set<unknown> {
    const p = this.pending;
    this.pending = new Set();
    return p;
  }

  /** The committed state of one tier; routed prefixes are never part of the document snapshot. */
  snapshot(tier: 'document' | 'view' = 'document'): Record<string, unknown> {
    return snapshotOf(this, tier);
  }
}

export type { Key, Path };
