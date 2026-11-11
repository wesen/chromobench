// History: the transaction log of the document tier, with inverses.
//
// One gesture is one entry (a slider drag commits once). Nudges with the same coalesce key that follow each other
// closely merge into one entry ("Exposure" rather than twelve of them). Entries can carry a channel (a photo id):
// the History panel lists a channel's entries and can step back to one; the global undo stack is unaffected.

import { pathStr, getIn, prefixOf } from './util.js';

let seq = 0;
export class History {
  constructor(store, opts = {}) {
    this.store = store; store.history = this;
    this.entries = [];        // undo stack
    this.redoStack = [];
    this.limit = opts.limit || 500;
    this.coalesceMs = opts.coalesceMs || 1500;
    this.channels = new Map(); // channel → { list: [{ id, label, detail, snap, time }], pos }
    this.listeners = new Set();
  }
  on(f) { this.listeners.add(f); return () => this.listeners.delete(f); }
  emit(kind, e) { for (const f of this.listeners) f(kind, e); }

  record(label, patches, opts = {}) {
    const now = Date.now();
    if (opts.channel != null && opts.snapPath && !patches.some(p => prefixOf(p.path, opts.snapPath) || prefixOf(opts.snapPath, p.path))) opts = Object.assign({}, opts, { channel: null, snapPath: null });
    const last = this.entries[this.entries.length - 1];
    if (opts.coalesce && last && last.coalesce === opts.coalesce && now - last.time < this.coalesceMs && !this.redoStack.length) {
      // merge: keep the first 'before' for each path, take the newest 'after'
      for (const p of patches) {
        const k = pathStr(p.path);
        const old = last.patches.find(x => pathStr(x.path) === k);
        if (old) old.after = p.after; else last.patches.push(Object.assign({}, p));
      }
      last.time = now; last.label = label; if (opts.detail !== undefined) last.detail = opts.detail;
      if (last.channel != null) this.updateChannel(last, opts);
      this.emit('change', last);
      return last;
    }
    const e = { id: ++seq, label, detail: opts.detail, patches: patches.map(p => Object.assign({}, p)), time: now, coalesce: opts.coalesce || null, channel: opts.channel == null ? null : opts.channel };
    this.entries.push(e);
    if (this.entries.length > this.limit) this.entries.shift();
    this.redoStack = [];
    if (e.channel != null && opts.channelEntry !== false) this.addToChannel(e, opts);
    this.emit('record', e);
    return e;
  }

  // ── per-channel lists (a photo's develop history) ──
  channel(id) { let c = this.channels.get(id); if (!c) { c = { list: [], pos: -1 }; this.channels.set(id, c); } return c; }
  addToChannel(e, opts) {
    const c = this.channel(e.channel);
    // the first edit of a channel shows where it started (Lightroom's "Import" step)
    if (!c.list.length && opts.snapPath) { c.list.push({ id: 'seed:' + e.channel, label: opts.seedLabel || 'Import', time: e.time, snap: opts.snapBefore, snapPath: opts.snapPath }); c.pos = 0; }
    if (c.pos < c.list.length - 1) c.list = c.list.slice(0, c.pos + 1);   // stepping back, then editing, drops the steps above
    c.list.push({ id: e.id, label: e.label, detail: e.detail, time: e.time, snap: opts.snapPath ? getIn(this.store.doc, opts.snapPath) : undefined, snapPath: opts.snapPath });
    c.pos = c.list.length - 1;
  }
  updateChannel(e, opts) {
    const c = this.channel(e.channel);
    const item = c.list.find(x => x.id === e.id);
    if (item) { item.label = e.label; item.detail = e.detail; item.time = e.time; if (item.snapPath) item.snap = getIn(this.store.doc, item.snapPath); }
  }
  // seed a channel's first entry (Lightroom shows "Import" at the bottom of every photo's history)
  seedChannel(id, label, snapPath) {
    const c = this.channel(id);
    if (!c.list.length) { c.list.push({ id: 'seed', label, time: Date.now(), snap: getIn(this.store.doc, snapPath), snapPath }); c.pos = 0; }
  }
  // step a channel back (or forward) to an entry: one undoable transaction that restores the snapshot
  stepTo(channelId, index) {
    const c = this.channels.get(channelId); if (!c) return;
    const item = c.list[index]; if (!item || !item.snapPath) return;
    const path = item.snapPath;
    this.store.tx(`History: ${item.label}`, t => t.$set(path, item.snap), { channel: channelId, channelEntry: false });
    c.pos = index;
    this.emit('step', { channel: channelId, index });
  }

  // ── undo / redo ──
  get canUndo() { return this.entries.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get last() { const e = this.entries[this.entries.length - 1]; return e ? e.label : null; }
  get next() { const e = this.redoStack[this.redoStack.length - 1]; return e ? e.label : null; }
  undo() {
    this.store.cancel();
    const e = this.entries.pop(); if (!e) return null;
    this.store.writeDoc(e.patches.slice().reverse().map(p => ({ path: p.path, value: p.before })), { undo: true, label: e.label });
    this.redoStack.push(e);
    this.moveChannel(e, -1);
    this.emit('undo', e);
    return e;
  }
  redo() {
    this.store.cancel();
    const e = this.redoStack.pop(); if (!e) return null;
    this.store.writeDoc(e.patches.map(p => ({ path: p.path, value: p.after })), { redo: true, label: e.label });
    this.entries.push(e);
    this.moveChannel(e, +1);
    this.emit('redo', e);
    return e;
  }
  moveChannel(e, dir) {
    if (e.channel == null) return;
    const c = this.channels.get(e.channel); if (!c) return;
    const i = c.list.findIndex(x => x.id === e.id);
    if (i >= 0) c.pos = dir < 0 ? i - 1 : i;
  }
  clear() { this.entries = []; this.redoStack = []; this.emit('clear'); }
}
