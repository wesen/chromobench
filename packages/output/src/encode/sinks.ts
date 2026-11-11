// Byte sinks (guide §5.9, decision D6): encoders write through these in bands, so no export holds the
// whole encoded file in memory. `writeAt` (random access) is what a compressed TIFF needs to patch its
// IFD offset; PNG and uncompressed TIFF write strictly sequentially.
import { ChromobenchError } from '@chromobench/contract';

export interface ByteSink {
  /** Appends at the current end. */
  write(chunk: Uint8Array): Promise<void>;
  /** Overwrites bytes already written (TIFF IFD patching). Optional. */
  writeAt?(offset: number, chunk: Uint8Array): Promise<void>;
  /** Commits the file. */
  close(): Promise<void>;
  /** Deletes what was written; the sink is unusable afterwards. */
  abort(): Promise<void>;
  /** Bytes appended so far. */
  readonly size: number;
}

const sinkError = (message: string, cause?: unknown): ChromobenchError =>
  new ChromobenchError({ code: 'E_SINK', message: cause instanceof Error ? `${message}: ${cause.message}` : message });

/** In-memory sink with random access (tests and small files). */
export class MemorySink implements ByteSink {
  private buf = new Uint8Array(1 << 16);
  private n = 0;
  closed = false;
  aborted = false;

  get size(): number { return this.n; }

  private reserve(end: number): void {
    if (end <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < end) cap *= 2;
    const nb = new Uint8Array(cap);
    nb.set(this.buf.subarray(0, this.n));
    this.buf = nb;
  }

  async write(chunk: Uint8Array): Promise<void> {
    if (this.closed || this.aborted) throw sinkError('write after close');
    this.reserve(this.n + chunk.length);
    this.buf.set(chunk, this.n);
    this.n += chunk.length;
  }

  async writeAt(offset: number, chunk: Uint8Array): Promise<void> {
    if (this.closed || this.aborted) throw sinkError('write after close');
    if (offset < 0 || offset + chunk.length > this.n) throw sinkError(`writeAt ${offset}+${chunk.length} outside the ${this.n} bytes written`);
    this.buf.set(chunk, offset);
  }

  async close(): Promise<void> { this.closed = true; }
  async abort(): Promise<void> { this.aborted = true; this.n = 0; this.buf = new Uint8Array(0); }

  /** The bytes written (a copy). */
  bytes(): Uint8Array { return this.buf.slice(0, this.n); }
}

/** Counts bytes and keeps only a CRC-free running size: for streaming and memory tests of huge files. */
export class CountingSink implements ByteSink {
  private n = 0;
  closed = false;
  aborted = false;
  /** First bytes kept for header checks. */
  readonly head: Uint8Array;
  private headN = 0;
  constructor(keepHead = 64) { this.head = new Uint8Array(keepHead); }
  get size(): number { return this.n; }
  async write(chunk: Uint8Array): Promise<void> {
    if (this.headN < this.head.length) {
      const k = Math.min(chunk.length, this.head.length - this.headN);
      this.head.set(chunk.subarray(0, k), this.headN);
      this.headN += k;
    }
    this.n += chunk.length;
  }
  async writeAt(offset: number, chunk: Uint8Array): Promise<void> {
    if (offset + chunk.length > this.n) throw sinkError('writeAt past the end');
    for (let i = 0; i < chunk.length; i++) if (offset + i < this.head.length) this.head[offset + i] = chunk[i]!;
  }
  async close(): Promise<void> { this.closed = true; }
  async abort(): Promise<void> { this.aborted = true; }
}

// ---- File System Access / OPFS ----------------------------------------------------------------

export interface WritableLike {
  write(data: BufferSource | { type: 'write'; position: number; data: BufferSource } | { type: 'seek'; position: number }): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}
export interface SyncHandleLike {
  write(buffer: BufferSource, opts: { at: number }): number;
  truncate(size: number): void;
  flush(): void;
  close(): void;
}
export interface FileHandleLike {
  name: string;
  createWritable(opts?: { keepExistingData?: boolean }): Promise<WritableLike>;
  createSyncAccessHandle?(): Promise<SyncHandleLike>;
  getFile(): Promise<File>;
  remove?(): Promise<void>;
}
export interface DirHandleLike {
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirHandleLike>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandleLike>;
  removeEntry(name: string): Promise<void>;
}

/** A sink over a writable file stream (OPFS in a window, or a file the user picked). */
class WritableSink implements ByteSink {
  private n = 0;
  private readonly w: WritableLike;
  private readonly onAbort: () => Promise<void>;
  readonly file: () => Promise<File>;
  constructor(w: WritableLike, onAbort: () => Promise<void>, file: () => Promise<File>) {
    this.w = w;
    this.onAbort = onAbort;
    this.file = file;
  }
  get size(): number { return this.n; }
  async write(chunk: Uint8Array): Promise<void> {
    try {
      await this.w.write({ type: 'write', position: this.n, data: chunk as Uint8Array<ArrayBuffer> });
    } catch (e) { throw sinkError('file write failed', e); }
    this.n += chunk.length;
  }
  async writeAt(offset: number, chunk: Uint8Array): Promise<void> {
    if (offset + chunk.length > this.n) throw sinkError('writeAt past the end');
    try {
      await this.w.write({ type: 'write', position: offset, data: chunk as Uint8Array<ArrayBuffer> });
    } catch (e) { throw sinkError('file write failed', e); }
  }
  async close(): Promise<void> {
    try { await this.w.close(); } catch (e) { throw sinkError('file close failed', e); }
  }
  async abort(): Promise<void> {
    try { await this.w.abort(); } catch { /* already closed */ }
    await this.onAbort();
  }
}

/** A sink over an OPFS sync access handle (dedicated workers only): in-place writes, no swap file. */
class SyncSink implements ByteSink {
  private n = 0;
  private readonly h: SyncHandleLike;
  private readonly onAbort: () => Promise<void>;
  readonly file: () => Promise<File>;
  constructor(h: SyncHandleLike, onAbort: () => Promise<void>, file: () => Promise<File>) {
    this.h = h;
    this.onAbort = onAbort;
    this.file = file;
  }
  get size(): number { return this.n; }
  async write(chunk: Uint8Array): Promise<void> {
    const k = this.h.write(chunk as Uint8Array<ArrayBuffer>, { at: this.n });
    if (k !== chunk.length) throw sinkError(`short write (${k} of ${chunk.length})`);
    this.n += k;
  }
  async writeAt(offset: number, chunk: Uint8Array): Promise<void> {
    if (offset + chunk.length > this.n) throw sinkError('writeAt past the end');
    this.h.write(chunk as Uint8Array<ArrayBuffer>, { at: offset });
  }
  async close(): Promise<void> { this.h.truncate(this.n); this.h.flush(); this.h.close(); }
  async abort(): Promise<void> {
    try { this.h.close(); } catch { /* closed */ }
    await this.onAbort();
  }
}

export type FileSink = ByteSink & { file(): Promise<File> };

const inWorker = (): boolean => typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !== 'undefined' && typeof (globalThis as { document?: unknown }).document === 'undefined';

/** OPFS root (navigator.storage.getDirectory()). */
export async function opfsRoot(): Promise<DirHandleLike> {
  const st = (globalThis as { navigator?: { storage?: { getDirectory?: () => Promise<unknown> } } }).navigator?.storage;
  if (!st?.getDirectory) throw sinkError('OPFS is not available here');
  return (await st.getDirectory()) as DirHandleLike;
}

/** An OPFS file at `path` ('exports/frame_0042.tif'); directories are created. abort() deletes the file. */
export async function opfsSink(path: string, o: { root?: DirHandleLike; sync?: boolean } = {}): Promise<FileSink> {
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop();
  if (!name) throw sinkError(`bad OPFS path "${path}"`);
  let dir = o.root ?? (await opfsRoot());
  for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true });
  const fh = await dir.getFileHandle(name, { create: true });
  const remove = async () => { try { await dir.removeEntry(name); } catch { /* gone */ } };
  if ((o.sync ?? inWorker()) && fh.createSyncAccessHandle) {
    const h = await fh.createSyncAccessHandle();
    h.truncate(0);
    return new SyncSink(h, remove, () => fh.getFile());
  }
  const w = await fh.createWritable({ keepExistingData: false });
  return new WritableSink(w, remove, () => fh.getFile());
}

/** A file the user picks (File System Access API, Chromium). Throws E_SINK where it is missing. */
export async function pickerSink(suggestedName: string, types?: { description: string; accept: Record<string, string[]> }[]): Promise<FileSink> {
  const pick = (globalThis as { showSaveFilePicker?: (o: unknown) => Promise<FileHandleLike> }).showSaveFilePicker;
  if (!pick) throw sinkError('showSaveFilePicker is not available in this browser; export to OPFS and download');
  const fh = await pick({ suggestedName, ...(types ? { types } : {}) });
  const w = await fh.createWritable({ keepExistingData: false });
  return new WritableSink(w, async () => { try { await fh.remove?.(); } catch { /* keep */ } }, () => fh.getFile());
}

export const pickerAvailable = (): boolean => typeof (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';
