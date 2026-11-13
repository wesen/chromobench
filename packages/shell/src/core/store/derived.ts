// Derived values: computed paths (Store.derive) with their own read sets, recomputed when a read changed.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { pathStr, type Key } from '../util.ts';
import { track, type Tracker } from '../track.ts';
import type { Store } from '../store.ts';

// ── derived values: computed paths with their own read sets ───────────────
export class Derived {
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
