// OPFS layout (guide §5.5):
//   cache/thumbs/<sha256>.png   film strip thumbnails
//   cache/pyramid/…, cache/tables/…   (CHB-006, CHB-005)
//   imports/<sha256>.<ext>      fallback copies of source files (never evicted automatically)
// Caches are evicted least-recently-used beyond a budget (default 25 % of the quota).
import type { KV } from './db.ts';

export interface CacheEntry { path: string; size: number; lastUsed: number }

/** Paths to delete so the cache fits `budget` bytes, oldest first; imports are never chosen. */
export function chooseEvictions(entries: readonly CacheEntry[], budget: number): string[] {
  const cache = entries.filter((e) => e.path.startsWith('cache/')).sort((a, b) => a.lastUsed - b.lastUsed);
  let total = cache.reduce((s, e) => s + e.size, 0);
  const out: string[] = [];
  for (const e of cache) {
    if (total <= budget) break;
    out.push(e.path);
    total -= e.size;
  }
  return out;
}

export const thumbPath = (sha: string): string => `cache/thumbs/${sha}.png`;
export const importPath = (sha: string, name: string): string => `imports/${sha}.${(/\.([A-Za-z0-9]+)$/.exec(name)?.[1] ?? 'bin').toLowerCase()}`;

export class Opfs {
  private readonly root: FileSystemDirectoryHandle;
  private readonly kv: KV;
  private index: Record<string, CacheEntry> | null = null;
  budgetFraction = 0.25;

  private constructor(root: FileSystemDirectoryHandle, kv: KV) {
    this.root = root;
    this.kv = kv;
  }

  static async open(kv: KV): Promise<Opfs | null> {
    if (!navigator.storage?.getDirectory) return null;
    try {
      return new Opfs(await navigator.storage.getDirectory(), kv);
    } catch {
      return null;
    }
  }

  private async dir(path: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
    let d = this.root;
    for (const p of path) d = await d.getDirectoryHandle(p, { create });
    return d;
  }

  private async loadIndex(): Promise<Record<string, CacheEntry>> {
    this.index ??= (await this.kv.get<Record<string, CacheEntry>>('settings', 'opfs-index')) ?? {};
    return this.index;
  }

  private async touch(path: string, size?: number): Promise<void> {
    const idx = await this.loadIndex();
    idx[path] = { path, size: size ?? idx[path]?.size ?? 0, lastUsed: Date.now() };
    await this.kv.put('settings', 'opfs-index', idx);
  }

  async write(path: string, data: Blob | Uint8Array): Promise<void> {
    const parts = path.split('/');
    const d = await this.dir(parts.slice(0, -1), true);
    const fh = await d.getFileHandle(parts.at(-1)!, { create: true });
    const w = await fh.createWritable();
    await w.write(data instanceof Uint8Array ? new Blob([data as Uint8Array<ArrayBuffer>]) : data);
    await w.close();
    await this.touch(path, data instanceof Uint8Array ? data.byteLength : data.size);
    if (path.startsWith('cache/')) await this.evict();
  }

  async read(path: string): Promise<File | null> {
    try {
      const parts = path.split('/');
      const d = await this.dir(parts.slice(0, -1), false);
      const f = await (await d.getFileHandle(parts.at(-1)!)).getFile();
      await this.touch(path, f.size);
      return f;
    } catch {
      return null;
    }
  }

  async remove(path: string): Promise<void> {
    const parts = path.split('/');
    try {
      const d = await this.dir(parts.slice(0, -1), false);
      await d.removeEntry(parts.at(-1)!);
    } catch {
      // already gone
    }
    const idx = await this.loadIndex();
    delete idx[path];
    await this.kv.put('settings', 'opfs-index', idx);
  }

  async usage(): Promise<{ usage: number; quota: number; cache: number; imports: number }> {
    const est = navigator.storage?.estimate ? await navigator.storage.estimate() : {};
    const idx = Object.values(await this.loadIndex());
    const sum = (p: string): number => idx.filter((e) => e.path.startsWith(p)).reduce((s, e) => s + e.size, 0);
    return { usage: est.usage ?? 0, quota: est.quota ?? 0, cache: sum('cache/'), imports: sum('imports/') };
  }

  async evict(): Promise<string[]> {
    const { quota } = await this.usage();
    if (!quota) return [];
    const gone = chooseEvictions(Object.values(await this.loadIndex()), quota * this.budgetFraction);
    for (const p of gone) await this.remove(p);
    return gone;
  }
}
