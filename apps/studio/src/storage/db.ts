// IndexedDB for the studio (CHB-009 guide §5.5; the KV studio-kit's frames, persistence and the host need),
// through a tiny promise wrapper instead of the idb library. A frame's saved edit is one FrameSave record keyed by
// the source hash and mode (studio-kit bridge/saved.ts); the shell's document and workspace tiers go to 'workspace'.
import { KV_STORES, type KV, type KvStore } from '@chromobench/studio-kit';

export const DB_NAME = 'chromobench-studio';
export const DB_VERSION = 2;

const req = <T>(r: IDBRequest<T>): Promise<T> => new Promise((ok, no) => {
  r.onsuccess = () => ok(r.result);
  r.onerror = () => no(r.error);
});

/** Migrations by version: index i upgrades from version i to i + 1 (every store is created when missing). */
const MIGRATIONS: ((db: IDBDatabase) => void)[] = [
  (db) => {
    for (const s of KV_STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
  },
  (db) => {
    for (const s of KV_STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
  },
];

export async function openIdb(name = DB_NAME): Promise<KV> {
  const open = indexedDB.open(name, DB_VERSION);
  open.onupgradeneeded = (ev) => {
    for (let v = ev.oldVersion; v < DB_VERSION; v++) MIGRATIONS[v]!(open.result);
  };
  const db = await req(open);
  const tx = (s: KvStore, mode: IDBTransactionMode): IDBObjectStore => db.transaction(s, mode).objectStore(s);
  return {
    get: <T>(s: KvStore, k: string) => req(tx(s, 'readonly').get(k)) as Promise<T | undefined>,
    put: async (s, k, v) => {
      await req(tx(s, 'readwrite').put(v, k));
    },
    delete: async (s, k) => {
      await req(tx(s, 'readwrite').delete(k));
    },
    all: <T>(s: KvStore) => req(tx(s, 'readonly').getAll()) as Promise<T[]>,
    keys: async (s: KvStore) => ((await req(tx(s, 'readonly').getAllKeys())) as IDBValidKey[]).map(String),
  };
}
