// Drafts: the preview tier (design §26). A draft is a set of writes shown over the committed state and never
// logged: current = committed ⊕ named drafts (in creation order) ⊕ the gesture. The gesture (a slider drag, a tool
// stroke) is the store's own draft; named drafts are proposals shown before they are decided. Committing a draft
// makes one transaction of its net change (one undo step for the whole drag); dropping it changes nothing.

import { getIn, pathStr, parsePath, deepEq, type Path } from '../util.ts';
import type { Store } from '../store.ts';
import { strip } from './readonly.ts';
import type { Write, TxOpts } from './types.ts';

export class Draft {
  readonly name: string;
  readonly #store: Store;
  readonly #writes = new Map<string, Write>();

  constructor(store: Store, name: string) {
    this.#store = store;
    this.name = name;
  }
  /** show a value at a path (a later write to the same path replaces it) */
  set(p: string | Path, value: unknown): this {
    const path = parsePath(p);
    this.#writes.set(pathStr(path), { path, value: strip(value) });
    this.#store.rebase();
    this.#store.notify([path], { preview: true, draft: this.name });
    return this;
  }
  get size(): number {
    return this.#writes.size;
  }
  writes(): Write[] {
    return [...this.#writes.values()];
  }
  /** forget the writes; readers see the committed state again */
  drop(): void {
    if (!this.#writes.size) return;
    const paths = this.writes().map(w => w.path);
    this.#writes.clear();
    this.#store.forget(this);
    this.#store.notify(paths, { preview: true, cancel: true, draft: this.name });
  }
  /** one transaction of the net change; nothing (null) when the draft changes nothing */
  commit(label: string, opts: TxOpts = {}): unknown {
    const writes = this.writes().filter(w => !deepEq(getIn(this.#store.committed, w.path), w.value));
    this.#writes.clear();
    this.#store.forget(this);
    if (!writes.length) {
      this.#store.notify([], { preview: true, draft: this.name });
      return null;
    }
    return this.#store.commitWrites(label, writes, { ...opts, source: { kind: this.name === 'gesture' ? 'gesture' : 'draft', ...(this.name === 'gesture' ? {} : { draft: this.name }), ...opts.source } });
  }
}
