// The storage studio-kit needs (CHB-009's KV from apps/studio/src/storage/db.ts): IndexedDB in the host, a Map in
// tests and the dev host. The IndexedDB implementation stays in the host as a service.
// apps/studio/src/storage/db.ts implements this interface over IndexedDB (CHB-019 migration).

export const KV_STORES = ['projects', 'rolls', 'frames', 'logs', 'snapshots', 'handles', 'settings', 'threads', 'workspace'] as const;
export type KvStore = (typeof KV_STORES)[number];

export interface KV {
  get<T>(store: KvStore, key: string): Promise<T | undefined>;
  put(store: KvStore, key: string, value: unknown): Promise<void>;
  delete(store: KvStore, key: string): Promise<void>;
  all<T>(store: KvStore): Promise<T[]>;
  /** the keys of a store (the storage reset of a hard cut-off) */
  keys(store: KvStore): Promise<string[]>;
}

export function memoryKV(): KV & { data: Map<string, Map<string, unknown>> } {
  const data = new Map<string, Map<string, unknown>>();
  const s = (n: string): Map<string, unknown> => {
    if (!data.has(n)) data.set(n, new Map());
    return data.get(n)!;
  };
  return {
    data,
    get: async <T>(n: KvStore, k: string) => structuredClone(s(n).get(k)) as T | undefined,
    put: async (n, k, v) => {
      s(n).set(k, structuredClone(v));
    },
    delete: async (n, k) => {
      s(n).delete(k);
    },
    all: async <T>(n: KvStore) => [...s(n).values()].map((v) => structuredClone(v)) as T[],
    keys: async (n: KvStore) => [...s(n).keys()],
  };
}

/** localStorage-backed KV for the dev host (survives a reload, no IndexedDB needed). */
export function localStorageKV(prefix = 'cb-kv', storage?: Storage): KV {
  const ls = (): Storage | null => {
    try {
      return storage ?? (globalThis as { localStorage?: Storage }).localStorage ?? null;
    } catch {
      return null;
    }
  };
  const key = (n: string, k: string): string => `${prefix}:${n}:${k}`;
  return {
    async get<T>(n: KvStore, k: string) {
      const v = ls()?.getItem(key(n, k));
      return v == null ? undefined : (JSON.parse(v) as T);
    },
    async put(n, k, v) {
      ls()?.setItem(key(n, k), JSON.stringify(v));
    },
    async delete(n, k) {
      ls()?.removeItem(key(n, k));
    },
    async all<T>(n: KvStore) {
      const st = ls();
      if (!st) return [];
      const out: T[] = [];
      for (let i = 0; i < st.length; i++) {
        const k = st.key(i)!;
        if (k.startsWith(`${prefix}:${n}:`)) out.push(JSON.parse(st.getItem(k)!) as T);
      }
      return out;
    },
    async keys(n: KvStore) {
      const st = ls();
      if (!st) return [];
      const out: string[] = [];
      const pre = `${prefix}:${n}:`;
      for (let i = 0; i < st.length; i++) {
        const k = st.key(i)!;
        if (k.startsWith(pre)) out.push(k.slice(pre.length));
      }
      return out;
    },
  };
}
