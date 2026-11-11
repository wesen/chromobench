// History (port of CraftKit core/history.js, reworked): the global undo stack of the document tier.
//
// One gesture is one entry (a slider drag commits once). Nudges with the same coalesce key that follow each other
// closely merge into one entry. Entries can carry a channel (a photo id): the History panel lists a channel's
// entries and can step back to one; the global undo stack is unaffected.
//
// New in the port: an entry is made of the store's own patches plus *parts* from other sources (route adapters:
// a frame's EditLog unit). Undo walks the parts in reverse; a part that is no longer applicable (its unit was
// already undone elsewhere) returns false and is skipped; an entry whose every part was skipped is skipped as a
// whole and the next one is tried. `push` files changes that did not come through a transaction.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { pathStr, getIn, prefixOf, type Key } from './util.ts';
import type { Store, Patch, TxOpts, Mirror } from './store.ts';
import type { Clock } from './clock.ts';

/** One reversible piece of an entry that the store does not own (an EditLog unit). */
export interface HistoryPart {
  /** 'recipes', the route or adapter id */
  source: string;
  label?: string;
  detail?: string;
  channel?: string | null;
  /** undo it; return the values to write (its projection), or false when it no longer applies */
  undo(): Mirror[] | boolean | void;
  redo(): Mirror[] | boolean | void;
}

export interface HistoryEntry {
  id: number;
  /** 'store', or the source of the first part */
  source: string;
  label: string;
  detail?: string | undefined;
  channel: string | null;
  time: number;
  coalesce: string | null;
  patches: Patch[];
  parts: HistoryPart[];
}

export interface ChannelItem {
  id: number | string;
  label: string;
  detail?: string | undefined;
  time: number;
  snap?: unknown;
  snapPath?: Key[] | null | undefined;
}
export interface Channel {
  list: ChannelItem[];
  pos: number;
}

export type HistoryEvent = 'record' | 'change' | 'undo' | 'redo' | 'skip' | 'step' | 'clear' | 'push';

export class History {
  entries: HistoryEntry[] = [];
  redoStack: HistoryEntry[] = [];
  limit: number;
  coalesceMs: number;
  channels = new Map<string, Channel>();
  private listeners = new Set<(kind: HistoryEvent, e?: any) => void>();
  private seq = 0;
  private now: () => number;

  readonly store: Store;
  constructor(store: Store, opts: { limit?: number; coalesceMs?: number; clock?: Pick<Clock, 'now'> } = {}) {
    this.store = store;
    store.history = this;
    this.limit = opts.limit || 500;
    this.coalesceMs = opts.coalesceMs || 1500;
    this.now = opts.clock ? () => opts.clock!.now() : () => Date.now();
  }
  on(f: (kind: HistoryEvent, e?: any) => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }
  private emit(kind: HistoryEvent, e?: unknown): void {
    for (const f of this.listeners) f(kind, e);
  }

  record(label: string, patches: Patch[], opts: TxOpts = {}, parts: HistoryPart[] = []): HistoryEntry {
    const now = this.now();
    if (opts.channel != null && opts.snapPath && !patches.some(p => prefixOf(p.path, opts.snapPath!) || prefixOf(opts.snapPath!, p.path)))
      opts = Object.assign({}, opts, { channel: null, snapPath: null });
    const last = this.entries[this.entries.length - 1];
    if (opts.coalesce && last && last.coalesce === opts.coalesce && now - last.time < this.coalesceMs && !this.redoStack.length) {
      // merge: keep the first 'before' for each path, take the newest 'after'; parts accumulate
      for (const p of patches) {
        const k = pathStr(p.path);
        const old = last.patches.find(x => pathStr(x.path) === k);
        if (old) old.after = p.after;
        else last.patches.push(Object.assign({}, p));
      }
      last.parts.push(...parts);
      last.time = now;
      last.label = label;
      if (opts.detail !== undefined) last.detail = opts.detail;
      if (last.channel != null) this.updateChannel(last);
      this.emit('change', last);
      return last;
    }
    const channel = opts.channel == null ? (parts.find(p => p.channel != null)?.channel ?? null) : opts.channel;
    const e: HistoryEntry = {
      id: ++this.seq,
      source: patches.length || !parts.length ? 'store' : parts[0]!.source,
      label,
      detail: opts.detail,
      patches: patches.map(p => Object.assign({}, p)),
      parts: parts.slice(),
      time: now,
      coalesce: opts.coalesce || null,
      channel,
    };
    this.entries.push(e);
    if (this.entries.length > this.limit) this.entries.shift();
    this.redoStack = [];
    if (e.channel != null && opts.channelEntry !== false && (opts.snapPath || !parts.length)) this.addToChannel(e, opts);
    this.emit('record', e);
    return e;
  }

  /** a change that did not come through a transaction (an approved proposal): one entry of parts */
  push(entry: { label: string; detail?: string; channel?: string | null; source?: string; parts: HistoryPart[] }): HistoryEntry {
    const e: HistoryEntry = {
      id: ++this.seq,
      source: entry.source || entry.parts[0]?.source || 'external',
      label: entry.label,
      detail: entry.detail,
      channel: entry.channel ?? null,
      time: this.now(),
      coalesce: null,
      patches: [],
      parts: entry.parts.slice(),
    };
    this.entries.push(e);
    if (this.entries.length > this.limit) this.entries.shift();
    this.redoStack = [];
    this.emit('push', e);
    return e;
  }

  // ── per-channel lists (a photo's develop history) ──
  channel(id: string): Channel {
    let c = this.channels.get(id);
    if (!c) {
      c = { list: [], pos: -1 };
      this.channels.set(id, c);
    }
    return c;
  }
  private addToChannel(e: HistoryEntry, opts: TxOpts): void {
    const c = this.channel(e.channel!);
    // the first edit of a channel shows where it started (Lightroom's "Import" step)
    if (!c.list.length && opts.snapPath) {
      c.list.push({ id: 'seed:' + e.channel, label: opts.seedLabel || 'Import', time: e.time, snap: opts.snapBefore, snapPath: opts.snapPath });
      c.pos = 0;
    }
    if (c.pos < c.list.length - 1) c.list = c.list.slice(0, c.pos + 1); // stepping back, then editing, drops the steps above
    c.list.push({ id: e.id, label: e.label, detail: e.detail, time: e.time, snap: opts.snapPath ? getIn(this.store.doc, opts.snapPath) : undefined, snapPath: opts.snapPath });
    c.pos = c.list.length - 1;
  }
  private updateChannel(e: HistoryEntry): void {
    const c = this.channel(e.channel!);
    const item = c.list.find(x => x.id === e.id);
    if (item) {
      item.label = e.label;
      item.detail = e.detail;
      item.time = e.time;
      if (item.snapPath) item.snap = getIn(this.store.doc, item.snapPath);
    }
  }
  /** seed a channel's first entry (Lightroom shows "Import" at the bottom of every photo's history) */
  seedChannel(id: string, label: string, snapPath: Key[]): void {
    const c = this.channel(id);
    if (!c.list.length) {
      c.list.push({ id: 'seed', label, time: this.now(), snap: getIn(this.store.doc, snapPath), snapPath });
      c.pos = 0;
    }
  }
  /** step a channel back (or forward) to an entry: one undoable transaction that restores the snapshot */
  stepTo(channelId: string, index: number): void {
    const c = this.channels.get(channelId);
    if (!c) return;
    const item = c.list[index];
    if (!item || !item.snapPath) return;
    const path = item.snapPath;
    this.store.tx(`History: ${item.label}`, t => t.$set(path, item.snap), { channel: channelId, channelEntry: false });
    c.pos = index;
    this.emit('step', { channel: channelId, index });
  }

  // ── undo / redo ──
  get canUndo(): boolean {
    return this.entries.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get last(): string | null {
    const e = this.entries[this.entries.length - 1];
    return e ? e.label : null;
  }
  get next(): string | null {
    const e = this.redoStack[this.redoStack.length - 1];
    return e ? e.label : null;
  }
  /** Undo the newest entry that still applies; entries whose every part was skipped are passed over. */
  undo(): HistoryEntry | null {
    this.store.cancel();
    for (;;) {
      const e = this.entries.pop();
      if (!e) return null;
      const writes = e.patches
        .slice()
        .reverse()
        .map(p => ({ path: p.path, value: p.before }));
      let applied = e.patches.length > 0;
      const skipped: HistoryPart[] = [];
      for (const part of e.parts.slice().reverse()) {
        const r = part.undo();
        if (r === false) skipped.push(part);
        else {
          applied = true;
          if (Array.isArray(r)) writes.push(...r);
        }
      }
      if (skipped.length) this.emit('skip', { entry: e, parts: skipped, dir: 'undo' });
      if (!applied) continue;
      this.store.writeDoc(writes, { undo: true, label: e.label });
      this.redoStack.push(e);
      this.moveChannel(e, -1);
      this.emit('undo', e);
      return e;
    }
  }
  redo(): HistoryEntry | null {
    this.store.cancel();
    for (;;) {
      const e = this.redoStack.pop();
      if (!e) return null;
      const writes = e.patches.map(p => ({ path: p.path, value: p.after }));
      let applied = e.patches.length > 0;
      const skipped: HistoryPart[] = [];
      for (const part of e.parts) {
        const r = part.redo();
        if (r === false) skipped.push(part);
        else {
          applied = true;
          if (Array.isArray(r)) writes.push(...r);
        }
      }
      if (skipped.length) this.emit('skip', { entry: e, parts: skipped, dir: 'redo' });
      if (!applied) continue;
      this.store.writeDoc(writes, { redo: true, label: e.label });
      this.entries.push(e);
      this.moveChannel(e, +1);
      this.emit('redo', e);
      return e;
    }
  }
  private moveChannel(e: HistoryEntry, dir: number): void {
    if (e.channel == null) return;
    const c = this.channels.get(e.channel);
    if (!c) return;
    const i = c.list.findIndex(x => x.id === e.id);
    if (i >= 0) c.pos = dir < 0 ? i - 1 : i;
  }
  clear(): void {
    this.entries = [];
    this.redoStack = [];
    this.emit('clear');
  }
}
