// Named preview layers (agent proposals): current = doc ⊕ named layers ⊕ gesture. A layer can be dropped, or
// committed as one transaction. namedLayer is Store.layer.

import { getIn, pathStr, parsePath, deepEq, type Path } from '../util.ts';
import type { Store } from '../store.ts';
import { strip } from './readonly.ts';
import type { Patch, Write, TxOpts } from './types.ts';

/** A named preview layer (agent proposals). */
export interface Layer {
  readonly name: string;
  set(p: string | Path, value: unknown): Layer;
  get size(): number;
  writes(): Write[];
  drop(): void;
  commit(label: string, opts?: TxOpts): unknown;
}

export function namedLayer(store: Store, name: string): Layer {
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
