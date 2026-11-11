// Cells and the frame scheduler (port of CraftKit core/cells.js).
//
// A cell owns one τ lambda: it runs the lambda against the state, remembers the read set (paths and the values
// seen), subscribes those paths in the store's path index, and hands the result to its effect (usually a DOM
// write). A write marks the cells it touches; the scheduler re-checks them once per frame. A cell re-runs only if
// a value it read actually changed, and every cell in a frame sees the same state: glitch-free by construction,
// because cells read state, not each other (derived paths flatten their read sets into their readers).
//
// Frame lanes, in order: feedback (cursor, rubber bands), chrome (cells → DOM), render (render requests, tagged
// with the frame's epoch), idle (thumbnails, histograms, autosave; keyed jobs in 12 ms slices).
//
// New in the port: an injectable Clock, per-store cell ids, and an effect loop reported through onLoop (the
// runtime turns it into CK-P510 with the cells' call sites) instead of a console warning.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { track, type Read } from './track.ts';
import { shallowEq, type Key } from './util.ts';
import type { Store } from './store.ts';
import type { CallSite } from './diag.ts';
import { browserClock, type Clock, type IdleDeadline } from './clock.ts';

export class Scope {
  cells = new Set<Cell<any>>();
  cleanups: (() => void)[] = [];
  kids = new Set<Scope>();
  alive = true;
  readonly parent: Scope | null;
  readonly name: string;
  constructor(parent: Scope | null = null, name = '') {
    this.parent = parent;
    this.name = name;
    if (parent) parent.kids.add(this);
  }
  child(name: string): Scope {
    return new Scope(this, name);
  }
  add<T>(cell: Cell<T>): Cell<T> {
    this.cells.add(cell);
    return cell;
  }
  onDispose(f: () => void): void {
    this.cleanups.push(f);
  }
  dispose(): void {
    if (!this.alive) return;
    this.alive = false;
    for (const k of this.kids) k.dispose();
    for (const c of this.cells) c.dispose();
    for (const f of this.cleanups.splice(0)) {
      try {
        f();
      } catch (e) {
        console.error(e);
      }
    }
    if (this.parent) this.parent.kids.delete(this);
  }
}

export interface CellOpts<T> {
  equals?: (a: T | undefined, b: T) => boolean;
  arg?: unknown;
  name?: string;
  at?: CallSite | null;
  onError?: (e: unknown, c: Cell<T>) => void;
}

export class Cell<T> {
  readonly id: number;
  readonly equals: (a: T | undefined, b: T) => boolean;
  arg: unknown;
  name: string;
  at: CallSite | null;
  reads: Read[] = [];
  value: T | undefined = undefined;
  runs = 0;
  alive = true;
  error: unknown = null;
  onError: ((e: unknown, c: Cell<T>) => void) | null;
  readonly store: Store;
  readonly fn: (s: any, arg?: any) => T;
  readonly effect: ((v: T, prev: T | undefined) => void) | null;
  constructor(store: Store, fn: (s: any, arg?: any) => T, effect: ((v: T, prev: T | undefined) => void) | null, opts: CellOpts<T> = {}) {
    this.store = store;
    this.fn = fn;
    this.effect = effect;
    this.id = store.nextCellId();
    this.equals = opts.equals || defaultEquals;
    this.arg = opts.arg;
    this.name = opts.name || '';
    this.at = opts.at || null;
    this.onError = opts.onError || null;
    this.run(true);
  }
  run(first: boolean): void {
    const prevReads = this.reads;
    const r = track(this.store, this.fn, this.arg);
    this.runs++;
    // resubscribe (diff the path sets)
    const before = new Map<string, Key[]>(prevReads.map(x => [x.path.join('.'), x.path]));
    const after = new Map<string, Key[]>(r.reads.map(x => [x.path.join('.'), x.path]));
    for (const [k, p] of before) if (!after.has(k)) this.store.index.remove(p, this);
    for (const [k, p] of after) if (!before.has(k)) this.store.index.add(p, this);
    this.reads = r.reads;
    if (r.error) {
      this.error = r.error;
      if (this.onError) this.onError(r.error, this);
      else console.error(`[ck] a τ lambda failed${this.at ? ' (' + this.at.file + ':' + this.at.line + ')' : ''}:`, r.error);
      return;
    }
    this.error = null;
    const prev = this.value;
    if (first || !this.equals(prev, r.value)) {
      this.value = r.value;
      if (this.effect) this.effect(r.value, first ? undefined : prev);
    }
  }
  /** called by the scheduler when a path in the read set was written */
  check(): boolean {
    if (!this.alive) return false;
    for (const rd of this.reads)
      if (this.store.peek(rd.path) !== rd.value) {
        this.run(false);
        return true;
      }
    return false;
  }
  dispose(): void {
    if (!this.alive) return;
    this.alive = false;
    for (const rd of this.reads) this.store.index.remove(rd.path, this);
    this.reads = [];
  }
}
function defaultEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return shallowEq(a, b);
  return false;
}

export interface SchedulerStats {
  frames: number;
  /** cells checked (marked dirty and re-checked) */
  cellsRun: number;
  /** cells whose lambda actually re-ran */
  cellsRerun: number;
  lastFrameMs: number;
  chromeMs: number;
  slow: number;
  loops: number;
}

export class Scheduler {
  queued = false;
  lanes: { feedback: (() => void)[]; render: ((epoch: number) => void)[] } = { feedback: [], render: [] };
  idleQ: { fn: () => void; key?: string | undefined }[] = [];
  idleScheduled = false;
  stats: SchedulerStats = { frames: 0, cellsRun: 0, cellsRerun: 0, lastFrameMs: 0, chromeMs: 0, slow: 0, loops: 0 };
  epoch = 0;
  readonly clock: Clock;
  /** ten passes of effects writing state: the cells involved */
  onLoop: ((cells: Cell<unknown>[]) => void) | null = null;
  onError: ((e: unknown) => void) | null = null;
  readonly store: Store;
  constructor(store: Store, clock?: Clock) {
    this.store = store;
    this.clock = clock || browserClock();
    store.onDirty = () => this.request();
  }
  private ticket = 0;
  request(): void {
    if (this.queued) return;
    this.queued = true;
    const t = ++this.ticket;
    // a frame run early (rt.flush()) makes this callback stale
    this.clock.frame(() => {
      if (this.queued && t === this.ticket) this.frame();
    });
  }
  feedback(fn: () => void): void {
    this.lanes.feedback.push(fn);
    this.request();
  }
  render(fn: (epoch: number) => void): void {
    this.lanes.render.push(fn);
    this.request();
  }
  idle(fn: () => void, key?: string): void {
    if (key) {
      const i = this.idleQ.findIndex(x => x.key === key);
      if (i >= 0) this.idleQ.splice(i, 1);
    }
    this.idleQ.push({ fn, key });
    if (!this.idleScheduled) {
      this.idleScheduled = true;
      this.clock.idle(d => this.runIdle(d));
    }
  }
  runIdle(deadline?: IdleDeadline): void {
    this.idleScheduled = false;
    const t0 = this.clock.now();
    while (this.idleQ.length && (this.clock.now() - t0 < 12 || (deadline && deadline.didTimeout))) {
      const { fn } = this.idleQ.shift()!;
      this.guard(fn);
    }
    if (this.idleQ.length) {
      this.idleScheduled = true;
      this.clock.idle(d => this.runIdle(d));
    }
  }
  private guard(f: () => void): void {
    try {
      f();
    } catch (e) {
      if (this.onError) this.onError(e);
      else console.error(e);
    }
  }
  frame(): void {
    this.queued = false;
    const t0 = this.clock.now();
    this.stats.frames++;
    this.epoch++;
    for (const f of this.lanes.feedback.splice(0)) this.guard(f);
    const c0 = this.clock.now();
    this.flushCells();
    this.stats.chromeMs = this.clock.now() - c0;
    const epoch = this.epoch;
    for (const f of this.lanes.render.splice(0)) this.guard(() => f(epoch));
    const ms = this.clock.now() - t0;
    this.stats.lastFrameMs = ms;
    if (ms > 24) this.stats.slow++;
  }
  /** cells → DOM, until quiet (an effect that writes state schedules another pass; ten passes means a loop) */
  flushCells(): void {
    let last: Cell<unknown>[] = [];
    for (let pass = 0; pass < 10; pass++) {
      const pending = this.store.takePending();
      if (!pending.size) return;
      // creation order: outer cells before inner ones
      const list = [...pending].sort((a: any, b: any) => (a.id || 0) - (b.id || 0));
      last = [];
      for (const c of list) {
        if (c instanceof Cell) {
          this.stats.cellsRun++;
          if (c.check()) {
            this.stats.cellsRerun++;
            last.push(c);
          }
        } else if (typeof c === 'function') this.guard(c as () => void);
      }
    }
    this.stats.loops++;
    if (this.onLoop) this.onLoop(last);
    else console.warn('[ck] cells kept writing state for ten passes: an effect writes what it reads');
  }
  flushSync(): void {
    this.flushCells();
  }
}
