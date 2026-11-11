// Cells and the frame scheduler.
//
// A cell owns one τ lambda: it runs the lambda against the state, remembers the read set (paths and the values
// seen), subscribes those paths in the store's path index, and hands the result to its effect (usually a DOM
// write). A write marks the cells it touches; the scheduler re-checks them once per frame. A cell re-runs only if
// a value it read actually changed, and every cell in a frame sees the same state: glitch-free by construction,
// because cells read state, not each other (derived paths flatten their read sets into their readers).
//
// Frame lanes, in order: feedback (cursor, rubber bands, the thing under the pointer), chrome (cells → DOM),
// render (engine requests, tagged with an epoch), idle (thumbnails, histograms, autosave).

import { track } from './track.js';
import { shallowEq } from './util.js';

export class Scope {
  constructor(parent = null, name = '') { this.cells = new Set(); this.cleanups = []; this.kids = new Set(); this.parent = parent; this.name = name; if (parent) parent.kids.add(this); this.alive = true; }
  child(name) { return new Scope(this, name); }
  add(cell) { this.cells.add(cell); return cell; }
  onDispose(f) { this.cleanups.push(f); }
  dispose() {
    if (!this.alive) return;
    this.alive = false;
    for (const k of this.kids) k.dispose();
    for (const c of this.cells) c.dispose();
    for (const f of this.cleanups.splice(0)) { try { f(); } catch (e) { console.error(e); } }
    if (this.parent) this.parent.kids.delete(this);
  }
}

let cellSeq = 0;
export class Cell {
  constructor(store, fn, effect, opts = {}) {
    this.id = ++cellSeq;
    this.store = store; this.fn = fn; this.effect = effect;
    this.equals = opts.equals || defaultEquals;
    this.arg = opts.arg; this.name = opts.name || ''; this.at = opts.at || null;
    this.reads = []; this.value = undefined; this.runs = 0; this.alive = true; this.error = null;
    this.onError = opts.onError || null;
    this.run(true);
  }
  run(first) {
    const prevReads = this.reads;
    const r = track(this.store, this.fn, this.arg);
    this.runs++;
    // resubscribe (diff the path sets)
    const before = new Map(prevReads.map(x => [x.path.join('.'), x.path]));
    const after = new Map(r.reads.map(x => [x.path.join('.'), x.path]));
    for (const [k, p] of before) if (!after.has(k)) this.store.index.remove(p, this);
    for (const [k, p] of after) if (!before.has(k)) this.store.index.add(p, this);
    this.reads = r.reads;
    if (r.error) {
      this.error = r.error;
      if (this.onError) this.onError(r.error, this); else console.error(`[ck] a τ lambda failed${this.at ? ' (' + this.at.file + ':' + this.at.line + ')' : ''}:`, r.error);
      return;
    }
    this.error = null;
    const prev = this.value;
    if (first || !this.equals(prev, r.value)) {
      this.value = r.value;
      if (this.effect) this.effect(r.value, first ? undefined : prev);
    }
  }
  // called by the scheduler when a path in the read set was written
  check() {
    if (!this.alive) return;
    for (const rd of this.reads) if (this.store.peek(rd.path) !== rd.value) { this.run(false); return; }
  }
  dispose() {
    if (!this.alive) return;
    this.alive = false;
    for (const rd of this.reads) this.store.index.remove(rd.path, this);
    this.reads = [];
  }
}
function defaultEquals(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return shallowEq(a, b);
  return false;
}

const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : f => setTimeout(() => f(performance.now()), 16);
const ric = typeof requestIdleCallback === 'function' ? requestIdleCallback : f => setTimeout(() => f({ timeRemaining: () => 8, didTimeout: false }), 30);

export class Scheduler {
  constructor(store) {
    this.store = store;
    this.queued = false;
    this.lanes = { feedback: [], render: [] };
    this.idleQ = [];
    this.idleScheduled = false;
    this.stats = { frames: 0, chrome: 0, cellsRun: 0, lastFrameMs: 0, slow: 0 };
    this.epoch = 0;
    store.onDirty = () => this.request();
  }
  request() { if (this.queued) return; this.queued = true; raf(t => this.frame(t)); }
  feedback(fn) { this.lanes.feedback.push(fn); this.request(); }
  render(fn) { this.lanes.render.push(fn); this.request(); }
  idle(fn, key) {
    if (key) { const i = this.idleQ.findIndex(x => x.key === key); if (i >= 0) this.idleQ.splice(i, 1); }
    this.idleQ.push({ fn, key });
    if (!this.idleScheduled) { this.idleScheduled = true; ric(d => this.runIdle(d)); }
  }
  runIdle(deadline) {
    this.idleScheduled = false;
    const t0 = performance.now();
    while (this.idleQ.length && (performance.now() - t0 < 12 || (deadline && deadline.didTimeout))) {
      const { fn } = this.idleQ.shift();
      try { fn(); } catch (e) { console.error(e); }
    }
    if (this.idleQ.length) { this.idleScheduled = true; ric(d => this.runIdle(d)); }
  }
  frame() {
    this.queued = false;
    const t0 = performance.now();
    this.stats.frames++;
    this.epoch++;
    const fb = this.lanes.feedback.splice(0);
    for (const f of fb) { try { f(); } catch (e) { console.error(e); } }
    this.flushCells();
    const rd = this.lanes.render.splice(0);
    for (const f of rd) { try { f(this.epoch); } catch (e) { console.error(e); } }
    const ms = performance.now() - t0;
    this.stats.lastFrameMs = ms;
    if (ms > 24) this.stats.slow++;
  }
  // cells → DOM, until quiet (an effect that writes state schedules another pass; ten passes means a loop)
  flushCells() {
    for (let pass = 0; pass < 10; pass++) {
      const pending = this.store.takePending();
      if (!pending.size) return;
      const list = [...pending].sort((a, b) => (a.id || 0) - (b.id || 0));   // creation order: outer cells before inner ones
      for (const c of list) { if (c.check) { c.check(); this.stats.cellsRun++; } else if (typeof c === 'function') c(); }
    }
    console.warn('[ck] cells kept writing state for ten passes: an effect writes what it reads');
  }
  flushSync() { this.flushCells(); }
}
