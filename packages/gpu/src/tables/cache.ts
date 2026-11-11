// Table cache: an in-memory LRU in front of an Origin Private File System store (guide §5.4).
//   opfs:/chromobench/tables/v1/<tableId>.tbl   header (magic "CBTB", version, JSON length,
//       canonical key JSON + {N, channels, format, created, payloadSha256}), padded to 16 bytes,
//       then N³ × 4 float32, x fastest
//   index.json   { tableId: { bytes, lastUsed } } for LRU eviction
// Writes go to <id>.tmp, are verified, then moved into place. Reads check magic, version, that the
// stored key equals the requested key, and the payload hash.
import { canonicalJSON, sha256Hex, type TableKey } from '@chromobench/contract';
import { tableId } from './keys.ts';
import type { Table } from './inputs.ts';

const MAGIC = 0x42544243; // "CBTB" little-endian
const VERSION = 1;

interface Meta { N: number; channels: 4; format: 'f32'; created: number; payloadSha256: string; range: [number, number] }

export function encodeTable(key: TableKey, t: Table, created = Date.now()): Uint8Array {
  const payload = new Uint8Array(t.data.buffer, t.data.byteOffset, t.data.byteLength);
  const meta: Meta = { N: t.N, channels: 4, format: 'f32', created, payloadSha256: sha256Hex(payload), range: t.range };
  const json = new TextEncoder().encode(canonicalJSON({ key, meta }));
  const head = 12 + json.length;
  const pad = Math.ceil(head / 16) * 16;
  const out = new Uint8Array(pad + payload.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, VERSION, true);
  dv.setUint32(8, json.length, true);
  out.set(json, 12);
  out.set(payload, pad);
  return out;
}

/** Decodes and verifies a stored table; returns null (never throws) on any mismatch. */
export function decodeTable(bytes: Uint8Array, key: TableKey): Table | null {
  if (bytes.length < 12) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== MAGIC || dv.getUint32(4, true) !== VERSION) return null;
  const len = dv.getUint32(8, true);
  if (12 + len > bytes.length) return null;
  let parsed: { key: unknown; meta: Meta };
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + len)));
  } catch {
    return null;
  }
  if (canonicalJSON(parsed.key) !== canonicalJSON(key)) return null;
  const pad = Math.ceil((12 + len) / 16) * 16;
  const payload = bytes.slice(pad);
  if (payload.length !== parsed.meta.N ** 3 * 16) return null;
  if (sha256Hex(payload) !== parsed.meta.payloadSha256) return null;
  return { N: parsed.meta.N, range: parsed.meta.range, data: new Float32Array(payload.buffer) };
}

/** Persistent store interface (OPFS in browsers; a Map in tests). */
export interface TableStore {
  get(id: string): Promise<Uint8Array | null>;
  put(id: string, bytes: Uint8Array): Promise<void>;
  remove(id: string): Promise<void>;
  index(): Promise<Record<string, { bytes: number; lastUsed: number }>>;
  touch(id: string, bytes: number): Promise<void>;
}

export class MemoryStore implements TableStore {
  readonly files = new Map<string, Uint8Array>();
  private idx: Record<string, { bytes: number; lastUsed: number }> = {};
  async get(id: string) { return this.files.get(id) ?? null; }
  async put(id: string, b: Uint8Array) { this.files.set(id, b); }
  async remove(id: string) { this.files.delete(id); delete this.idx[id]; }
  async index() { return { ...this.idx }; }
  async touch(id: string, bytes: number) { this.idx[id] = { bytes, lastUsed: Date.now() }; }
}

export class OpfsStore implements TableStore {
  private dirP: Promise<FileSystemDirectoryHandle> | null = null;
  private idxCache: Record<string, { bytes: number; lastUsed: number }> | null = null;
  static available(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory;
  }
  private dir(): Promise<FileSystemDirectoryHandle> {
    this.dirP ??= (async () => {
      let d = await navigator.storage.getDirectory();
      for (const p of ['chromobench', 'tables', 'v1']) d = await d.getDirectoryHandle(p, { create: true });
      // without persist() the browser may evict the origin's storage under pressure: costs a rebuild only
      navigator.storage.persist?.().catch(() => undefined);
      return d;
    })();
    return this.dirP;
  }
  async get(id: string): Promise<Uint8Array | null> {
    try {
      const f = await (await (await this.dir()).getFileHandle(`${id}.tbl`)).getFile();
      return new Uint8Array(await f.arrayBuffer());
    } catch {
      return null;
    }
  }
  async put(id: string, bytes: Uint8Array): Promise<void> {
    const d = await this.dir();
    const tmp = await d.getFileHandle(`${id}.tmp`, { create: true });
    const w = await tmp.createWritable();
    await w.write(bytes as unknown as FileSystemWriteChunkType);
    await w.close();
    const back = new Uint8Array(await (await tmp.getFile()).arrayBuffer());
    if (sha256Hex(back) !== sha256Hex(bytes)) {
      await d.removeEntry(`${id}.tmp`);
      throw new Error('table cache: write verification failed');
    }
    const fin = await d.getFileHandle(`${id}.tbl`, { create: true });
    const w2 = await fin.createWritable();
    await w2.write(bytes as unknown as FileSystemWriteChunkType);
    await w2.close();
    await d.removeEntry(`${id}.tmp`);
  }
  async remove(id: string): Promise<void> {
    const d = await this.dir();
    await d.removeEntry(`${id}.tbl`).catch(() => undefined);
    const idx = await this.index();
    delete idx[id];
    await this.writeIndex(idx);
  }
  async index(): Promise<Record<string, { bytes: number; lastUsed: number }>> {
    if (this.idxCache) return this.idxCache;
    try {
      const f = await (await (await this.dir()).getFileHandle('index.json')).getFile();
      this.idxCache = JSON.parse(await f.text());
    } catch {
      this.idxCache = {};
    }
    return this.idxCache!;
  }
  async touch(id: string, bytes: number): Promise<void> {
    const idx = await this.index();
    idx[id] = { bytes, lastUsed: Date.now() };
    await this.writeIndex(idx);
  }
  private async writeIndex(idx: Record<string, { bytes: number; lastUsed: number }>): Promise<void> {
    this.idxCache = idx;
    const h = await (await this.dir()).getFileHandle('index.json', { create: true });
    const w = await h.createWritable();
    await w.write(JSON.stringify(idx));
    await w.close();
  }
}

export interface CacheStats { memoryHits: number; storeHits: number; misses: number; rejected: number }

export class TableCache {
  private readonly mem = new Map<string, Table>(); // insertion order = LRU order
  readonly stats: CacheStats = { memoryHits: 0, storeHits: 0, misses: 0, rejected: 0 };
  private readonly store: TableStore | null;
  private readonly opts: { memEntries?: number; storeBudget?: number };
  constructor(store: TableStore | null, opts: { memEntries?: number; storeBudget?: number } = {}) {
    this.store = store;
    this.opts = opts;
  }

  async get(key: TableKey): Promise<Table | null> {
    const id = tableId(key);
    const m = this.mem.get(id);
    if (m) {
      this.mem.delete(id);
      this.mem.set(id, m);
      this.stats.memoryHits++;
      return m;
    }
    if (this.store) {
      const bytes = await this.store.get(id);
      if (bytes) {
        const t = decodeTable(bytes, key);
        if (t) {
          this.stats.storeHits++;
          this.remember(id, t);
          await this.store.touch(id, bytes.length);
          return t;
        }
        this.stats.rejected++;
        await this.store.remove(id);
      }
    }
    this.stats.misses++;
    return null;
  }

  async put(key: TableKey, t: Table): Promise<void> {
    const id = tableId(key);
    this.remember(id, t);
    if (!this.store) return;
    const bytes = encodeTable(key, t);
    await this.store.put(id, bytes);
    await this.store.touch(id, bytes.length);
    await this.evict();
  }

  /** Build-through: memory → store → build (then store). */
  async resolve(key: TableKey, build: () => Promise<Table>): Promise<Table> {
    return (await this.get(key)) ?? (await (async () => {
      const t = await build();
      await this.put(key, t);
      return t;
    })());
  }

  private remember(id: string, t: Table): void {
    this.mem.set(id, t);
    const max = this.opts.memEntries ?? 16;
    while (this.mem.size > max) this.mem.delete(this.mem.keys().next().value!);
  }

  /** Evicts least recently used stored tables beyond the budget (default 200 MB). */
  private async evict(): Promise<void> {
    if (!this.store) return;
    const budget = this.opts.storeBudget ?? 200e6;
    const idx = await this.store.index();
    const entries = Object.entries(idx).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    let total = entries.reduce((s, [, e]) => s + e.bytes, 0);
    for (const [id, e] of entries) {
      if (total <= budget) break;
      await this.store.remove(id);
      total -= e.bytes;
    }
  }

  clearMemory(): void { this.mem.clear(); }
}
