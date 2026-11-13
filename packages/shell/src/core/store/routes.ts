// Routes: writes under a declared prefix (recipes.<frameId>) go to the host's adapter first. The adapter may
// refuse (TxRefused aborts the whole transaction), keep its own undo parts, and publish its projection (mirror)
// into the tree. The store finds a route with routeOf and applies it in commitPatches; attachRoute is Store.route.

import { pathStr, type Key } from '../util.ts';
import type { HistoryPart } from '../history.ts';
import type { Store } from '../store.ts';
import type { Patch, Write, Mirror, TxOpts, WriteInfo } from './types.ts';

/** What a route adapter returns for the patches under its prefix. */
export interface RouteResult {
  /** undo/redo of what the adapter did; when absent, the store undoes the routed patches itself */
  part?: HistoryPart | null;
  parts?: HistoryPart[];
  /** the values to write instead of the routed patches (the adapter's projection); absent: write the patches */
  mirror?: Mirror[];
}
/** Supplied by the host at start for each route the program declares. */
export interface RouteAdapter {
  readonly id?: string;
  /** commit: throw to refuse (validation, E_STALE); the whole transaction is then aborted */
  apply(patches: Patch[], info: { label: string; opts: TxOpts }): RouteResult | void;
  /** told about gesture previews under the prefix (the shell still overlays them for readers) */
  preview?(writes: Write[]): void;
  cancel?(): void;
  /** called once when attached: publish projection changes not caused by the store (agent, load) */
  attach?(api: RouteApi): void | (() => void);
}
export interface RouteApi {
  publish(mirror: Mirror[], info?: WriteInfo): void;
  push(entry: { label: string; detail?: string; channel?: string | null; parts: HistoryPart[] }): void;
  readonly store: Store;
}
export interface RouteDecl {
  /** a dotted prefix: 'recipes' */
  prefix: string;
  /** how many segments after the prefix are keys (recipes.<frameId> → 1) */
  keyDepth?: number;
  /** checks a path under the prefix (without the prefix and key segments); returns an error message or null */
  checkPath?: (rest: Key[]) => string | null | undefined | { message: string; fix?: string; valid?: string[] };
  readonly?: boolean;
  source?: string;
}
export interface Route {
  decl: RouteDecl;
  prefix: Key[];
  adapter: RouteAdapter | null;
}

export class TxRefused extends Error {
  readonly label: string;
  readonly cause2: unknown;
  readonly route: string;
  constructor(label: string, route: string, cause: unknown) {
    super(`${label} was refused by ${route}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'TxRefused';
    this.label = label;
    this.route = route;
    this.cause2 = cause;
  }
}

/** attach the host's adapter to a declared (or new) route (Store.route) */
export function attachRoute(store: Store, prefix: string, adapter: RouteAdapter): () => void {
  let r = store.routes.find(x => pathStr(x.prefix) === prefix);
  if (!r) {
    store.declareRoute({ prefix });
    r = store.routes[store.routes.length - 1]!;
  }
  r.adapter = adapter;
  const api: RouteApi = {
    store: store,
    publish: (mirror, info) => store.writeDoc(mirror, { tier: 'route', route: prefix, ...(info || {}) }),
    push: e => {
      store.history?.push({ label: e.label, ...(e.detail !== undefined ? { detail: e.detail } : {}), channel: e.channel ?? null, source: adapter.id || prefix, parts: e.parts });
    },
  };
  const off = adapter.attach ? adapter.attach(api) : undefined;
  return () => {
    if (r && r.adapter === adapter) r.adapter = null;
    if (typeof off === 'function') off();
  };
}
