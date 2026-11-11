// IndexedDB schema (guide §5.5), through a tiny promise wrapper instead of the idb library.
// Simplification: a frame's edit log is stored as one EditLogData record keyed by the source hash
// (the log itself is append-only); per-entry rows and recipe checkpoints come when logs get long.
export const DB_NAME = 'chromobench-studio';
export const DB_VERSION = 1;

export const STORES = ['projects', 'rolls', 'frames', 'logs', 'snapshots', 'handles', 'settings', 'threads'] as const;
export type StoreName = (typeof STORES)[number];

/** The storage the core needs; IndexedDB in the browser, a Map in unit tests. */
export interface KV {
  get<T>(store: StoreName, key: string): Promise<T | undefined>;
  put(store: StoreName, key: string, value: unknown): Promise<void>;
  delete(store: StoreName, key: string): Promise<void>;
  all<T>(store: StoreName): Promise<T[]>;
}

const req = <T>(r: IDBRequest<T>): Promise<T> => new Promise((ok, no) => {
  r.onsuccess = () => ok(r.result);
  r.onerror = () => no(r.error);
});

/** Migrations by version: index i upgrades from version i to i + 1. */
const MIGRATIONS: ((db: IDBDatabase) => void)[] = [
  (db) => {
    for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
  },
];

export async function openIdb(name = DB_NAME): Promise<KV> {
  const open = indexedDB.open(name, DB_VERSION);
  open.onupgradeneeded = (ev) => {
    for (let v = ev.oldVersion; v < DB_VERSION; v++) MIGRATIONS[v]!(open.result);
  };
  const db = await req(open);
  const tx = (s: StoreName, mode: IDBTransactionMode): IDBObjectStore => db.transaction(s, mode).objectStore(s);
  return {
    get: <T>(s: StoreName, k: string) => req(tx(s, 'readonly').get(k)) as Promise<T | undefined>,
    put: async (s, k, v) => {
      await req(tx(s, 'readwrite').put(v, k));
    },
    delete: async (s, k) => {
      await req(tx(s, 'readwrite').delete(k));
    },
    all: <T>(s: StoreName) => req(tx(s, 'readonly').getAll()) as Promise<T[]>,
  };
}

export function memoryKV(): KV {
  const m = new Map<string, Map<string, unknown>>();
  const s = (n: string): Map<string, unknown> => {
    if (!m.has(n)) m.set(n, new Map());
    return m.get(n)!;
  };
  return {
    get: async <T>(n: StoreName, k: string) => structuredClone(s(n).get(k)) as T | undefined,
    put: async (n, k, v) => {
      s(n).set(k, structuredClone(v));
    },
    delete: async (n, k) => {
      s(n).delete(k);
    },
    all: async <T>(n: StoreName) => [...s(n).values()].map((v) => structuredClone(v)) as T[],
  };
}
