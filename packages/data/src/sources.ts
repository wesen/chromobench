// Where pack bytes come from. The app wraps fetch() (the HTTP cache and service worker do the
// caching); node tests and tools read the file system (./node.ts). Paths are relative to the packs
// root, e.g. "spektrafilm@0.3.2+3bb2c2d/manifest.json".
import { fail } from '@chromobench/contract';

export interface DataSource {
  read(path: string): Promise<Uint8Array>;
  /** Present on synchronous sources (file system, memory); lets PhysicsData be served synchronously. */
  readSync?(path: string): Uint8Array;
}

/** fetch()-backed source; `base` is the URL of the packs directory (with or without trailing slash). */
export function fetchSource(base: string | URL, fetchFn: typeof fetch = fetch): DataSource {
  const root = String(base).endsWith('/') ? String(base) : `${String(base)}/`;
  return {
    async read(path) {
      const url = root + path.split('/').map(encodeURIComponent).join('/');
      const r = await fetchFn(url);
      if (!r.ok) fail('E_DATA_SCHEMA', `pack file ${path} not found (${r.status} ${r.statusText})`, { path });
      return new Uint8Array(await r.arrayBuffer());
    },
  };
}

/** In-memory source (tests, preloaded bundles). */
export function memorySource(files: Map<string, Uint8Array> | Record<string, Uint8Array>): DataSource {
  const m = files instanceof Map ? files : new Map(Object.entries(files));
  const get = (path: string): Uint8Array => m.get(path) ?? fail('E_DATA_SCHEMA', `pack file ${path} not found`, { path });
  return { read: async (p) => get(p), readSync: get };
}
