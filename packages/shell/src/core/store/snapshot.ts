// The committed state of one tier (what autosave and the workspace write). snapshotOf is Store.snapshot.

import { getIn, setIn } from '../util.ts';
import type { Store } from '../store.ts';

/** The committed state of one tier: the document tier is the log's documents where they show (main and mounted). */
export function snapshotOf(store: Store, tier: 'document' | 'view'): Record<string, unknown> {
  if (tier === 'document') {
    let doc: unknown = store.committed;
    for (const p of store.viewPrefixes) doc = setIn(doc, p, undefined);
    return (doc ?? {}) as Record<string, unknown>;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(store.committed as Record<string, unknown>)) {
    if (store.tierOf([k]) === 'view') {
      out[k] = v;
      continue;
    }
    const nested = store.viewPrefixes.filter(p => p.length > 1 && String(p[0]) === k);
    if (!nested.length) continue;
    let x: unknown = {};
    for (const p of nested) {
      const val = getIn(v, p.slice(1));
      if (val !== undefined) x = setIn(x, p.slice(1), val);
    }
    out[k] = x;
  }
  return out;
}
