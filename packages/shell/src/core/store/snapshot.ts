// The committed state of one tier (what autosave and the workspace write). snapshotOf is Store.snapshot.

import { getIn, setIn, prefixOf } from '../util.ts';
import type { Store } from '../store.ts';

/** The committed state of one tier; routed prefixes are never part of the document snapshot. */
export function snapshotOf(store: Store, tier: 'document' | 'view'): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const doc = store.doc as Record<string, unknown>;
  const nestedView = store.viewPrefixes.filter(p => p.length > 1);
  for (const [k, v] of Object.entries(doc)) {
    const top = [k];
    if (store.routes.some(r => prefixOf(r.prefix, top))) continue;
    const t = store.tierOf(top);
    if (t === 'view') {
      if (tier === 'view') out[k] = v;
      continue;
    }
    const nested = nestedView.filter(p => String(p[0]) === k);
    let routedInside = store.routes.filter(r => r.prefix.length > 1 && String(r.prefix[0]) === k);
    if (tier === 'document') {
      let x: unknown = v;
      for (const p of nested) x = setIn(x, p.slice(1), undefined);
      for (const r of routedInside) x = setIn(x, r.prefix.slice(1), undefined);
      out[k] = x;
    } else if (nested.length) {
      let x: unknown = {};
      for (const p of nested) {
        const val = getIn(v, p.slice(1));
        if (val !== undefined) x = setIn(x, p.slice(1), val);
      }
      out[k] = x;
    }
    routedInside = [];
  }
  return out;
}
