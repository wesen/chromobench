// The store: one immutable state tree in three tiers (design §26).
//
//   document  what the user makes. It *is* the document log of @chromobench/values: the program's own document
//             state is the log's `main` document, and documents the host opens (a frame) are mounted at a path.
//             Every change is a transaction of the log; undo and redo walk the log's steps; autosave writes the
//             main document.
//   view      how the user looks at it (zoom, the open module, panel sizes, the selection), by path prefix ('ui',
//             'roll.contact': the longest listed prefix wins). Changed freely, saved with the workspace, never undone.
//   preview   drafts over both: named drafts (proposals shown before they are decided) and the gesture (a slider
//             drag). Readers see them; the document does not change until a draft commits, which makes one
//             transaction — one undo step — of its net change.
//
// A transaction's writes (ctx.tx's lambda, a draft's commit, set/setMany on document paths) are split by document:
// each document's net change (values `diff`) is one edit, and edits to several documents commit as one batch, one
// step. A refusal (the document's rules, a value that is not JSON) aborts the whole transaction and is reported.
// Writes notify a path index; cells whose read sets touch a written path are marked dirty and re-run on the next
// frame, all against the same state, so no reader ever sees half a transaction.
//
// The parts live in core/store/: types.ts (Write, TxOpts, WriteInfo, MountDecl), project.ts (the log's documents
// in the tree), drafts.ts (the preview tier), writer.ts (what ctx.tx hands to its lambda), readonly.ts (strip, the
// handlers' read-only view), path-index.ts (the subscriber trie), derived.ts (derived paths), snapshot.ts (a tier's
// committed state). This file keeps the Store class and re-exports the public names.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { Log, type Author, type Batch, type Edit, type JsonObject, type OpenOptions, type Rules, type Step } from '@chromobench/values';
import { isObj, pathStr, parsePath, getIn, setIn, prefixOf, type Key, type Path } from './util.ts';
import type { DerivedSource } from './track.ts';
import type { Actor, Write, TxOpts, WriteInfo, MountDecl } from './store/types.ts';
import { strip, readonlyView } from './store/readonly.ts';
import { PathIndex } from './store/path-index.ts';
import { Derived } from './store/derived.ts';
import { Draft } from './store/drafts.ts';
import { snapshotOf } from './store/snapshot.ts';
import { Writer } from './store/writer.ts';
import { MAIN, changedPaths, project } from './store/project.ts';

export type { Actor, Write, TxOpts, WriteInfo, MountDecl } from './store/types.ts';
export { strip } from './store/readonly.ts';
export { PathIndex } from './store/path-index.ts';
export { Draft } from './store/drafts.ts';
export { Writer } from './store/writer.ts';
export { MAIN } from './store/project.ts';

export interface StoreOpts {
  /** view-tier prefixes ('ui', 'view', 'prefs', 'workspace', 'roll.contact'); the rest is document */
  view?: string[];
  /** the log's rules by document kind (a studio passes the contract's LOG_RULES) */
  rules?: Rules;
  /** where documents are mounted (kits declare them; the host opens the documents) */
  mounts?: MountDecl[];
  /** the clock for log entries and coalescing (default Date.now) */
  now?: () => number;
  /** consecutive transactions with one coalesce key within this many ms are one step (default 1500) */
  coalesceMs?: number;
}

const DEFAULT_VIEW = ['ui', 'view', 'prefs', 'workspace'];
type Listener = (paths: Key[][], info: WriteInfo) => void;

/** A transaction the log refused: nothing changed (the open gesture is dropped). */
export class TxRefused extends Error {
  readonly label: string;
  /** the documents it would have changed */
  readonly docs: string[];
  readonly cause2: unknown;
  constructor(label: string, docs: string[], cause: unknown) {
    super(`${label} was refused${docs.length ? ` (${docs.join(', ')})` : ''}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'TxRefused';
    this.label = label;
    this.docs = docs;
    this.cause2 = cause;
  }
}

/** One target of a write: a document (and the path in it), or the view tier. */
type Routed = { doc: string; rel: Key[]; value: unknown } | { doc: null; path: Key[]; value: unknown };

export class Store implements DerivedSource {
  /** every tier, committed (no drafts) */
  committed: any;
  /** what readers see: committed ⊕ named drafts ⊕ the gesture */
  current: any;
  /** the document tier */
  log: Log;
  /** the gesture: ctx.preview / commit / cancel */
  readonly gesture: Draft;
  /** named drafts, in creation order, under the gesture */
  readonly drafts = new Map<string, Draft>();
  viewPrefixes: Key[][];
  readonly mountDecls: MountDecl[];
  /** mounted documents: id → path */
  readonly mounts = new Map<string, Key[]>();
  index = new PathIndex();
  derived = new Map<string, Derived>();
  listeners = new Set<Listener>();
  refusals = new Set<(e: TxRefused) => void>();
  version = 0;
  /** subscribers marked dirty, waiting for a flush */
  pending = new Set<unknown>();
  /** the scheduler asks to be told */
  onDirty: (() => void) | null = null;
  private cellSeq = 0;
  private txSeq = 0;
  private readonly now: () => number;
  private readonly coalesceMs: number;
  /** the step the last coalescing transaction made, and when */
  private lastCoalesce: { key: string; at: number; step: Step } | null = null;
  /** who acts while `acting` runs (an agent through the workbench) */
  private actor: Actor | null = null;

  constructor(init: object = {}, opts: StoreOpts = {}) {
    this.viewPrefixes = (opts.view || DEFAULT_VIEW).map(p => parsePath(p));
    this.mountDecls = (opts.mounts ?? []).slice();
    this.now = opts.now ?? Date.now;
    this.coalesceMs = opts.coalesceMs ?? 1500;
    this.gesture = new Draft(this, 'gesture');
    // the initial state under a declared mount is one document per key; the rest (less the view tier) is main
    let main: unknown = init;
    for (const p of this.viewPrefixes) main = setIn(main, p, undefined);
    const docs: [string, Key[], object, string][] = [];
    for (const m of this.mountDecls) {
      const pre = parsePath(m.prefix);
      const visit = (v: unknown, at: Key[], depth: number): void => {
        if (depth === (m.keyDepth ?? 0)) {
          if (isObj(v) && !Array.isArray(v)) docs.push([at.slice(pre.length).join('.') || m.prefix, at, v, m.kind ?? 'plain']);
          return;
        }
        if (isObj(v)) for (const [k, x] of Object.entries(v)) visit(x, [...at, k], depth + 1);
      };
      visit(getIn(init, pre), pre, 0);
    }
    for (const [, at] of docs) main = setIn(main, at, undefined);
    let log = Log.create({ rules: opts.rules ?? {}, now: this.now }).open(MAIN, (main ?? {}) as object, { by: 'user', source: { kind: 'init' } });
    for (const [id, at, doc, kind] of docs) {
      log = log.open(id, doc, { kind, by: 'user', source: { kind: 'init' } });
      this.mounts.set(id, at);
    }
    this.log = log;
    this.committed = init;
    this.current = init;
    this.rebase();
  }
  nextCellId(): number {
    return ++this.cellSeq;
  }

  tierOf(path: Path): 'document' | 'view' {
    if (this.mountOf(path)) return 'document';
    let best = -1;
    for (const p of this.viewPrefixes) if (p.length > best && prefixOf(p, path)) best = p.length;
    return best >= 0 ? 'view' : 'document';
  }

  // ── documents ──
  /** the mounted document a path is in (the longest mount), and the path inside it */
  mountOf(path: Path): { doc: string; rel: Key[] } | null {
    let best: { doc: string; rel: Key[] } | null = null;
    let len = -1;
    for (const [doc, at] of this.mounts) if (at.length > len && prefixOf(at, path)) [best, len] = [{ doc, rel: path.slice(at.length) }, at.length];
    return best;
  }
  /** open a document of the log at a path (a frame at recipes.<id>); it shows there, and edits under it go to it */
  open(id: string, doc: object, o: OpenOptions & { at: string | Path }): void {
    const at = parsePath(o.at);
    if (!at.length) throw new TypeError(`store.open('${id}'): a document is mounted at a path, not at the root`);
    if (this.viewPrefixes.some(p => prefixOf(p, at) || prefixOf(at, p))) throw new TypeError(`store.open('${id}'): ${pathStr(at)} is in the view tier`);
    for (const [other, p] of this.mounts) if (prefixOf(p, at) || prefixOf(at, p)) throw new TypeError(`store.open('${id}'): ${pathStr(at)} overlaps the document '${other}' at ${pathStr(p)}`);
    if (getIn(this.log.doc(MAIN), at) !== undefined) throw new TypeError(`store.open('${id}'): the main document holds a value at ${pathStr(at)}`);
    const { at: _at, ...opts } = o;
    const log = this.log.open(id, doc, opts);
    this.mounts.set(id, at);
    this.replace(log, { label: `Open ${id}` });
  }
  /** close a mounted document: it leaves the state and the log with its history */
  close(id: string): void {
    const at = this.mounts.get(id);
    if (!at) return;
    this.cancel();
    this.mounts.delete(id);
    this.log = this.log.close(id);
    this.committed = setIn(this.committed, at, undefined);
    this.rebase();
    this.notify([at], { tier: 'document', label: `Close ${id}` });
  }
  /**
   * Replace the log (an operation of the host: approve, reject, a batch the agent proposed, a load) and show what
   * changed. Every document of the new log must be the main document or mounted.
   */
  change(f: (log: Log) => Log, info: WriteInfo = {}): Log {
    const next = f(this.log);
    if (next !== this.log) this.replace(next, info);
    return next;
  }
  private replace(next: Log, info: WriteInfo, also: Write[] = []): void {
    const prev = this.log;
    this.log = next;
    const keep: Key[][] = [...this.viewPrefixes, ...this.mounts.values()];
    const paths: Key[][] = [];
    let tree = this.committed;
    for (const id of next.ids()) {
      const b = next.doc(id);
      const a = prev.has(id) ? prev.doc(id) : undefined;
      if (a === b) continue;
      const base = id === MAIN ? [] : this.mounts.get(id);
      if (!base) throw new TypeError(`the log's document '${id}' is not mounted in the store`);
      const changed = a === undefined ? [[]] : changedPaths(a, b);
      tree = project(tree, base, changed, b, id === MAIN ? keep : []);
      for (const p of changed) paths.push([...base, ...p]);
    }
    for (const w of also) {
      tree = setIn(tree, w.path, strip(w.value));
      paths.push(w.path);
    }
    this.committed = tree;
    this.rebase();
    this.notify(paths, { tier: 'document', ...info });
  }
  /**
   * Take over another store's log and mounts: a host that replaces its program in place keeps one history
   * (CHB-031 F24, View ▸ Layout). The documents show as the log holds them.
   */
  adopt(from: Store): void {
    if (from === this) return;
    this.cancel();
    for (const [id, at] of from.mounts) this.mounts.set(id, at);
    this.replace(from.log, { label: 'Adopt' });
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
  /** write view-tier state directly (no undo); a document path is refused (it changes only through the log) */
  writeView(writes: Write[], info: WriteInfo = {}): void {
    let tree = this.committed;
    for (const { path, value } of writes) {
      if (this.tierOf(path) === 'document') throw new TypeError(`writeView: ${pathStr(path)} is in the document tier; write it in a transaction`);
      tree = setIn(tree, path, strip(value));
    }
    this.committed = tree;
    this.rebase();
    this.notify(
      writes.map(p => p.path),
      { tier: 'view', ...info },
    );
  }
  rebase(): void {
    let cur = this.committed;
    for (const d of this.drafts.values()) for (const { path, value } of d.writes()) cur = setIn(cur, path, value);
    for (const { path, value } of this.gesture.writes()) cur = setIn(cur, path, value);
    this.current = cur;
  }

  /** set view-tier state directly (no undo); document paths go through a transaction */
  set(p: string | Path, value: unknown, opts: TxOpts & { label?: string } = {}): unknown {
    const path = parsePath(p);
    const { label, ...tx } = opts;
    if (this.tierOf(path) === 'document') return this.tx(label || 'Change', t => t.$set(path, value), tx);
    this.writeView([{ path, value }], label ? { label } : {});
    return null;
  }
  /** merge a nested object of state: ctx.set({ view: { mode: 'loupe' } }); document paths become a transaction */
  setMany(obj: Record<string, unknown>, opts: TxOpts & { label?: string } = {}): void {
    const { label, ...txo } = opts;
    const writes: Write[] = [];
    const walk = (v: unknown, path: Key[]): void => {
      const plain = isObj(v) && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
      const there = getIn(this.committed, path);
      if (plain && (path.length < 1 || (isObj(there) && !Array.isArray(there)))) {
        for (const [k, x] of Object.entries(v as object)) walk(x, path.concat([k]));
        return;
      }
      writes.push({ path, value: v });
    };
    walk(obj, []);
    const doc = writes.filter(p => this.tierOf(p.path) === 'document');
    const view = writes.filter(p => this.tierOf(p.path) === 'view');
    if (view.length) this.writeView(view, label ? { label } : {});
    if (doc.length)
      this.tx(
        label || 'Change',
        t => {
          for (const p of doc) t.$set(p.path, p.value);
        },
        txo,
      );
  }

  /** A transaction: fn(t) writes through a writer; the result is one step of the log (the net change). */
  tx(label: string, fn: (t: any) => unknown, opts: TxOpts = {}): unknown {
    const w = new Writer(this);
    const ret = fn(w.proxy());
    if (ret && typeof (ret as Promise<unknown>).then === 'function')
      throw new TypeError(`ctx.tx('${label}') got an async function: compute first, then write in one synchronous transaction`);
    const writes = w.writes();
    if (!writes.length) return null;
    // an open gesture survives a transaction elsewhere (a background job finishing); one that touches what it
    // previews is cancelled, so its commit cannot overwrite the transaction
    if (this.gesture.size && !opts.keepPreview) {
      const overlap = this.gesture.writes().some(g => writes.some(q => prefixOf(g.path, q.path) || prefixOf(q.path, g.path)));
      if (overlap) this.cancel();
    }
    return this.commitWrites(label, writes, { ...opts, source: { kind: 'tx', ...opts.source } });
  }

  /** where a write lands: one document (or several, when it holds a mounted document or a view prefix), or the view */
  private route(w: Write): Routed[] {
    const m = this.mountOf(w.path);
    if (m) return [{ doc: m.doc, rel: m.rel, value: w.value }];
    if (this.tierOf(w.path) === 'view') return [{ doc: null, path: w.path, value: w.value }];
    for (const d of this.mountDecls) {
      const root = parsePath(d.prefix).length + (d.keyDepth ?? 0);
      if (w.path.length >= root && prefixOf(parsePath(d.prefix), w.path))
        throw new TypeError(`no document is open at ${pathStr(w.path.slice(0, root))}: documents under '${d.prefix}' are opened by the host`);
    }
    // a main-document write; what it holds for other tiers below it goes there
    const out: Routed[] = [];
    let main = w.value;
    for (const p of this.viewPrefixes) {
      if (p.length <= w.path.length || !prefixOf(w.path, p)) continue;
      const rel = p.slice(w.path.length);
      const v = getIn(w.value, rel);
      main = setIn(main, rel, undefined);
      if (v !== undefined) out.push({ doc: null, path: p, value: v });
    }
    for (const [doc, at] of this.mounts) {
      if (at.length <= w.path.length || !prefixOf(w.path, at)) continue;
      const rel = at.slice(w.path.length);
      const v = getIn(w.value, rel);
      main = setIn(main, rel, undefined);
      if (v !== undefined) out.push({ doc, rel: [], value: v });
    }
    for (const d of this.mountDecls) {
      const pre = parsePath(d.prefix);
      if (pre.length + (d.keyDepth ?? 0) <= w.path.length || !prefixOf(w.path, pre)) continue;
      // what is left at a declared document root is a document nobody opened
      const left = (v: unknown, depth: number, at: Key[]): void => {
        if (!isObj(v)) return;
        if (depth === 0) throw new TypeError(`no document is open at ${pathStr(at)}: documents under '${d.prefix}' are opened by the host`);
        for (const [k, x] of Object.entries(v)) left(x, depth - 1, [...at, k]);
      };
      const rel = pre.slice(w.path.length);
      left(getIn(main, rel), d.keyDepth ?? 0, pre);
    }
    out.unshift({ doc: MAIN, rel: w.path, value: main });
    return out;
  }

  /**
   * Commit writes (in the committed state's paths) as one step: each document's net change is one edit, several
   * documents' edits one batch; view-tier writes land in the same notify. Refused: nothing changes.
   */
  commitWrites(label: string, writes: Write[], opts: TxOpts = {}): Step | null {
    const id = `s${++this.txSeq}`;
    const drafts = new Map<string, ReturnType<Log['draft']>>();
    const view: Write[] = [];
    const actor = this.actor;
    const by: Author = actor?.by ?? opts.by ?? 'user';
    const source: JsonObject = { ...opts.source, ...(opts.detail !== undefined ? { detail: opts.detail } : {}), ...actor?.source };
    let next = this.log;
    try {
      for (const w of writes) {
        for (const r of this.route(w)) {
          if (r.doc === null) {
            view.push({ path: r.path, value: r.value });
            continue;
          }
          const d = drafts.get(r.doc) ?? this.log.draft(r.doc);
          drafts.set(r.doc, d.update(x => setIn(x, r.rel, strip(r.value))));
        }
      }
      const edits: Edit[] = [...drafts.values()].filter(d => d.changed).map(d => d.edit({ id: `${id}:${d.doc}`, label, by, source, ...(drafts.size > 1 ? { batch: id } : {}) }));
      if (edits.length) {
        const x: Edit | Batch = edits.length === 1 && drafts.size === 1 ? edits[0]! : { id, label, by, source, edits, skipped: [] };
        if (actor?.refuse) throw Object.assign(new Error(actor.refuse), { code: 'E_READONLY' });
        if (actor?.propose) {
          // the agent in ask mode: the document edits wait for approval; view-tier writes land now
          const proposed = this.log.propose(x, actor.why !== undefined ? { why: actor.why } : {});
          this.replace(proposed, { label, tx: true, tier: 'document' }, view);
          return null;
        }
        const key = actor ? null : (opts.coalesce ?? null);
        const c = this.lastCoalesce;
        const merge = !!key && !!c && c.key === key && this.now() - c.at < this.coalesceMs && this.log.undoStep === c.step;
        next = this.log.commit(x, { merge, ...(actor?.why !== undefined ? { why: actor.why } : {}) });
        this.lastCoalesce = key && next.undoStep ? { key, at: this.now(), step: next.undoStep } : null;
      }
    } catch (e) {
      const err = new TxRefused(label, [...drafts.keys()], e);
      if (this.gesture.size) this.cancel();
      for (const f of this.refusals) f(err);
      if (!this.refusals.size) throw err;
      return null;
    }
    if (next === this.log && !view.length) return null;
    this.replace(next, { label, tx: true, tier: next === this.log ? 'view' : 'document' }, view);
    return next === this.log ? null : next.undoStep;
  }

  /**
   * Runs fn with another author (the agent running a command through the workbench, CHB-037 P6b): its transactions
   * are by `as.by` with `as.source` added to theirs; `propose` turns their document edits into proposals (ask mode);
   * `refuse` refuses them with E_READONLY and that message (read-only); view-tier writes land in every case. Only what
   * fn writes synchronously is covered.
   */
  acting<T>(as: Actor, fn: () => T): T {
    const prev = this.actor;
    this.actor = as;
    try {
      return fn();
    } finally {
      this.actor = prev;
    }
  }

  // ── undo / redo ──
  /** revert the newest step (the open gesture is cancelled first); null when there is nothing to undo */
  undo(): Step | null {
    this.cancel();
    const st = this.log.undoStep;
    if (!st) return null;
    this.lastCoalesce = null;
    this.replace(this.log.undo(), { undo: true, label: st.label });
    return st;
  }
  redo(): Step | null {
    this.cancel();
    const st = this.log.redoStep;
    if (!st) return null;
    this.lastCoalesce = null;
    this.replace(this.log.redo(), { redo: true, label: st.label });
    return st;
  }

  // ── the gesture ──
  preview(p: string | Path, value: unknown): void {
    this.gesture.set(p, value);
  }
  get previewing(): boolean {
    return this.gesture.size > 0;
  }
  /** turn the gesture into one transaction */
  commit(label: string, opts: TxOpts = {}): unknown {
    return this.gesture.commit(label, opts);
  }
  cancel(): void {
    this.gesture.drop();
  }

  // ── named drafts ──
  draft(name: string): Draft {
    if (name === 'gesture') return this.gesture;
    let d = this.drafts.get(name);
    if (!d) {
      d = new Draft(this, name);
      this.drafts.set(name, d);
    }
    return d;
  }
  /** @internal a draft emptied itself */
  forget(d: Draft): void {
    if (d !== this.gesture) this.drafts.delete(d.name);
    this.rebase();
  }

  /** drain the dirty set (the scheduler calls this once per frame) */
  takePending(): Set<unknown> {
    const p = this.pending;
    this.pending = new Set();
    return p;
  }

  /** The committed state of one tier (the document tier: main and the mounted documents, where they show). */
  snapshot(tier: 'document' | 'view' = 'document'): Record<string, unknown> {
    return snapshotOf(this, tier);
  }
}

export type { Key, Path };
