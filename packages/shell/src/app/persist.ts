// Persistence behind an async interface (CraftKit saved to localStorage directly). Autosave is debounced 700 ms on
// the idle lane, and runs on page hide and visibilitychange to hidden (IndexedDB writes on pagehide may not
// finish). The document tier goes through `persist`; the view tier less `transient`, and of `ui` only `keepUi`.
// The document tier is every document of the log where it shows (a host that saves its mounted documents itself
// drops them in `persist`).

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Runtime } from './runtime.ts';

export interface SaveKey {
  app: string;
  version: number;
}
export interface Saved {
  doc?: unknown;
  view?: unknown;
}
export interface PersistenceAdapter {
  load(key: SaveKey): Promise<Saved | null>;
  save(key: SaveKey, part: 'doc' | 'view', value: unknown): Promise<void>;
  clear(key: SaveKey): Promise<void>;
}

const k = (key: SaveKey, part: string): string => `ck:${key.app}:${key.version}:${part}`;

/** In memory (tests, and a session that must not keep anything). */
export function memoryPersistence(initial: Record<string, unknown> = {}): PersistenceAdapter & { data: Map<string, unknown>; saves: number } {
  const data = new Map<string, unknown>(Object.entries(initial));
  const api = {
    data,
    saves: 0,
    async load(key: SaveKey): Promise<Saved | null> {
      const doc = data.get(k(key, 'doc'));
      const view = data.get(k(key, 'view'));
      if (doc === undefined && view === undefined) return null;
      return { ...(doc !== undefined ? { doc: structuredClone(doc) } : {}), ...(view !== undefined ? { view: structuredClone(view) } : {}) };
    },
    async save(key: SaveKey, part: 'doc' | 'view', value: unknown): Promise<void> {
      api.saves++;
      data.set(k(key, part), structuredClone(value));
    },
    async clear(key: SaveKey): Promise<void> {
      data.delete(k(key, 'doc'));
      data.delete(k(key, 'view'));
    },
  };
  return api;
}

/** This browser's localStorage (CraftKit's behaviour). Storage that is off loads nothing and saves nothing. */
export function localStoragePersistence(storage?: Storage): PersistenceAdapter {
  const ls = (): Storage | null => {
    try {
      return storage ?? (globalThis as { localStorage?: Storage }).localStorage ?? null;
    } catch {
      return null;
    }
  };
  return {
    async load(key) {
      try {
        const s = ls();
        if (!s) return null;
        const doc = s.getItem(k(key, 'doc'));
        const view = s.getItem(k(key, 'view'));
        if (!doc && !view) return null;
        return { ...(doc ? { doc: JSON.parse(doc) } : {}), ...(view ? { view: JSON.parse(view) } : {}) };
      } catch {
        return null;
      }
    },
    async save(key, part, value) {
      ls()?.setItem(k(key, part), JSON.stringify(value));
    },
    async clear(key) {
      const s = ls();
      if (!s) return;
      s.removeItem(k(key, 'doc'));
      s.removeItem(k(key, 'view'));
    },
  };
}

/** The view-tier record that is saved: workspace, prefs, view (less transient), ui (only keepUi), nested view slices. */
export function viewRecord(rt: Runtime<any>): Record<string, unknown> {
  const so = rt.app.ir.stateOpts;
  const transient = so.transient || [];
  const keepUi = so.keepUi || [];
  const v = rt.store.snapshot('view') as Record<string, any>;
  const view = Object.assign({}, v['view']);
  for (const t of transient) delete view[t];
  const ui: Record<string, unknown> = {};
  for (const key of keepUi) if (v['ui'] && v['ui'][key] !== undefined) ui[key] = v['ui'][key];
  const out: Record<string, unknown> = { ...v, view, ui };
  return out;
}

/** Start autosave on a runtime: returns a stop function and a flush function. */
export function startAutosave(rt: Runtime<any>, adapter: PersistenceAdapter, key: SaveKey): { stop(): void; flush(): Promise<void> } {
  const so = rt.app.ir.stateOpts;
  const transient = so.transient || [];
  const keepUi = so.keepUi || [];
  let timer: unknown = null;
  let dirtyDoc = false;
  let dirtyView = false;
  let chain: Promise<void> = Promise.resolve();
  const flush = (): Promise<void> => {
    if (timer != null) rt.clock.clearTimeout(timer);
    timer = null;
    const doDoc = dirtyDoc;
    const doView = dirtyView;
    dirtyDoc = dirtyView = false;
    if (!doDoc && !doView) return chain;
    chain = chain.then(async () => {
      try {
        if (doDoc) {
          const doc = rt.store.snapshot('document');
          await adapter.save(key, 'doc', so.persist ? so.persist(doc) : doc);
        }
        if (doView) await adapter.save(key, 'view', viewRecord(rt));
        if (doDoc) rt.emit('saved', 'Saved');
      } catch (e) {
        rt.emit('saved', 'Not saved (storage is off)');
        rt.diagnostics.warn('CK-T440', 'Autosave failed', { runtime: true, facts: [String((e as Error)?.message ?? e)] });
      }
    });
    return chain;
  };
  const off = rt.store.on((paths, info) => {
    if (info && (info.preview || info.init)) return;
    for (const p of paths) {
      if (rt.store.tierOf(p) === 'document') dirtyDoc = true;
      else if (p[0] === 'workspace' || p[0] === 'prefs' || (p[0] === 'view' && !transient.includes(String(p[1]))) || (p[0] === 'ui' && keepUi.includes(String(p[1]))) || (p[0] !== 'ui' && p[0] !== 'view')) dirtyView = true;
    }
    if ((dirtyDoc || dirtyView) && timer == null) timer = rt.clock.timeout(() => rt.scheduler.idle(() => void flush(), 'autosave'), 700);
  });
  const g = globalThis as { addEventListener?: (t: string, f: () => void) => void; removeEventListener?: (t: string, f: () => void) => void; document?: { visibilityState?: string } };
  const onHide = (): void => void flush();
  const onVis = (): void => {
    if (g.document?.visibilityState === 'hidden') void flush();
  };
  g.addEventListener?.('pagehide', onHide);
  g.addEventListener?.('visibilitychange', onVis);
  return {
    stop() {
      off();
      if (timer != null) rt.clock.clearTimeout(timer);
      g.removeEventListener?.('pagehide', onHide);
      g.removeEventListener?.('visibilitychange', onVis);
    },
    flush,
  };
}
