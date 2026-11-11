// The shell's persistence interface over the KV (guide §6.5): the document tier (catalog, snapshots, looks,
// presets) and the workspace go to the 'workspace' store, keyed by app and version. EditLogs are saved by the
// frames registry, by SHA-256, on every non-preview event.
import type { PersistenceAdapter, SaveKey, Saved } from '@chromobench/shell';
import type { KV } from './kv.ts';

const k = (key: SaveKey, part: string): string => `${key.app}:${key.version}:${part}`;

export function kvPersistence(kv: KV): PersistenceAdapter {
  return {
    async load(key: SaveKey): Promise<Saved | null> {
      const doc = await kv.get('workspace', k(key, 'doc'));
      const view = await kv.get('workspace', k(key, 'view'));
      if (doc === undefined && view === undefined) return null;
      return { ...(doc !== undefined ? { doc } : {}), ...(view !== undefined ? { view } : {}) };
    },
    async save(key, part, value) {
      await kv.put('workspace', k(key, part), value);
    },
    async clear(key) {
      await kv.delete('workspace', k(key, 'doc'));
      await kv.delete('workspace', k(key, 'view'));
    },
  };
}
