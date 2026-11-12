// The open frames: per frame its source info, its own content-addressed Graph and its EditLog (what CHB-009's
// FrameSession held). A frame is a file opened in one mode (CHB-027): a colour negative ('negative-scan') or a
// photo ('digital-raw'). Logs are saved under (source SHA-256, mode) on every non-preview event and resumed by
// both, so a moved file re-attaches its recipe and a photo's recipe never lands on the file opened as a negative
// (F3). A file is open once: opening it again finds the open frame; re-opening it in the other mode replaces the
// frame (same id) with a fresh decode and that mode's recipe.
import {
  EditLog, fail, Graph, sha256Hex,
  type AgentMode, type EditLogData, type Engine, type FrameRecipe, type SourceInfo, type SourceRef,
} from '@chromobench/contract';
import { defaultFor } from '../model/recipes.ts';
import type { KV } from './kv.ts';

/**
 * SHA-256 of a file as hex (the frame's identity). WebCrypto when the page has it: native and asynchronous, so a
 * 25 MB camera RAW does not hold the main thread for a third of a second (CHB-027, F4); else the contract's sha256Hex.
 */
export async function hashBytes(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || bytes.byteLength < 1 << 20) return sha256Hex(bytes);
  const d = new Uint8Array(await subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
  let hex = '';
  for (const b of d) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/** What a frame is: a colour negative or a photo from a digital camera (the recipe's kind). */
export type FrameKind = FrameRecipe['kind'];
/** How the photographer asked to open: let the studio guess, or say. */
export type OpenAs = 'auto' | 'photo' | 'negative';

export const kindOf = (as: 'photo' | 'negative'): FrameKind => (as === 'photo' ? 'digital-raw' : 'negative-scan');
export const asOf = (k: FrameKind): 'photo' | 'negative' => (k === 'digital-raw' ? 'photo' : 'negative');

/**
 * Opens a source in the engine in a mode. The studio host's engine decodes as asked and guesses on 'auto' (it may
 * ask the photographer); the default opener (any contract Engine) opens as a negative unless told 'photo'.
 */
export type SourceOpener = (source: SourceRef, as: OpenAs) => Promise<{ info: SourceInfo; kind: FrameKind }>;

export interface FrameEntry {
  readonly id: string;
  readonly sha: string;
  readonly name: string;
  readonly kind: FrameKind;
  readonly info: SourceInfo;
  readonly graph: Graph;
  readonly log: EditLog;
  /** the recipe frame.add created */
  readonly initial: FrameRecipe;
}

/**
 * A frame's first recipe computed from the opened frame (CHB-023: the automatic first print). It gets the default
 * recipe of the frame's kind and the frame's graph (the source is registered in it); it runs only when no log is
 * saved for the hash and mode.
 */
export type InitialRecipe = (defaults: FrameRecipe, graph: Graph) => Promise<FrameRecipe>;

/** What opening a file did. */
export type OpenOutcome =
  /** opened now, with a new recipe */
  | 'opened'
  /** opened now, its saved recipe resumed */
  | 'resumed'
  /** the file was open already (in the mode asked, or the mode did not matter): nothing changed */
  | 'already'
  /** the file is open in the other mode: the caller may re-open it (after asking) */
  | 'conflict';

export interface OpenFileOptions {
  initial?: FrameRecipe | InitialRecipe;
  /** default 'auto' */
  as?: OpenAs;
  /** reads the file's bytes again (re-open in the other mode); the bytes are kept in memory when absent */
  read?: () => Promise<Uint8Array>;
}

export interface FramesOptions {
  kv?: KV | null;
  mode?: AgentMode;
  now?: () => number;
  opener?: SourceOpener;
}

/** The KV key of a frame's log: the hash and the mode. */
export const logKey = (sha: string, kind: FrameKind): string => `${sha}:${asOf(kind)}`;

export class Frames {
  readonly engine: Engine;
  readonly kv: KV | null;
  mode: AgentMode;
  private readonly now: (() => number) | undefined;
  private readonly opener: SourceOpener;
  private readonly map = new Map<string, FrameEntry>();
  private readonly readers = new Map<string, () => Promise<Uint8Array>>();
  private readonly listeners = new Set<(e: FrameEntry) => void>();
  private readonly removedListeners = new Set<(e: FrameEntry) => void>();
  private readonly opening = new Map<string, Promise<{ entry: FrameEntry; outcome: OpenOutcome }>>();
  private saving: Promise<unknown> = Promise.resolve();

  constructor(engine: Engine, o: FramesOptions = {}) {
    this.engine = engine;
    this.kv = o.kv ?? null;
    this.mode = o.mode ?? 'ask';
    this.now = o.now;
    this.opener = o.opener ?? (async (src, as) => ({ info: await engine.open(src), kind: kindOf(as === 'photo' ? 'photo' : 'negative') }));
  }

  get(id: string): FrameEntry | undefined {
    return this.map.get(id);
  }
  ids(): string[] {
    return [...this.map.keys()];
  }
  all(): FrameEntry[] {
    return [...this.map.values()];
  }
  bySha(sha: string): FrameEntry | undefined {
    return this.all().find(e => e.sha === sha);
  }
  /** called for frames added now and later, and for a frame replaced by a re-open (same id, new entry) */
  onAdded(f: (e: FrameEntry) => void): () => void {
    for (const e of this.map.values()) f(e);
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }
  /** called when a frame is removed from the studio */
  onRemoved(f: (e: FrameEntry) => void): () => void {
    this.removedListeners.add(f);
    return () => this.removedListeners.delete(f);
  }
  /** true when the frame's bytes can be read again (re-open in the other mode) */
  canReread(id: string): boolean {
    const e = this.map.get(id);
    return !!e && this.readers.has(e.sha);
  }

  /** Opens bytes in the engine and creates (or resumes, by hash and mode) the frame's edit log. */
  async open(bytes: Uint8Array, name: string, o: OpenFileOptions = {}): Promise<FrameEntry> {
    return (await this.openFile(bytes, name, o)).entry;
  }

  /** Opens bytes and says what happened: opened, resumed, already open, or open in the other mode. */
  async openFile(bytes: Uint8Array, name: string, o: OpenFileOptions = {}): Promise<{ entry: FrameEntry; outcome: OpenOutcome }> {
    const sha = await hashBytes(bytes);
    const as = o.as ?? 'auto';
    // no reader from the host: a copy (an engine may transfer the bytes it decodes to a worker)
    const copy = o.read ? null : bytes.slice();
    this.readers.set(sha, o.read ?? (async () => copy!));
    const pending = this.opening.get(sha);
    if (pending) {
      // opened twice at once: the first open wins
      const r = await pending;
      return { entry: r.entry, outcome: as === 'auto' || kindOf(as) === r.entry.kind ? 'already' : 'conflict' };
    }
    const existing = this.bySha(sha);
    if (existing) return { entry: existing, outcome: as === 'auto' || kindOf(as) === existing.kind ? 'already' : 'conflict' };
    const p = this.load(bytes, sha, name, as, o.initial, null);
    this.opening.set(sha, p);
    try {
      return await p;
    } finally {
      this.opening.delete(sha);
    }
  }

  /**
   * Re-opens an open frame as a photo or as a negative (F3, F6): decodes the file again in that mode and resumes
   * that mode's saved log or starts that mode's recipe. The frame keeps its id; the other mode's log stays saved.
   */
  async reopen(id: string, as: 'photo' | 'negative', o: { initial?: FrameRecipe | InitialRecipe } = {}): Promise<{ entry: FrameEntry; outcome: OpenOutcome }> {
    const e = this.map.get(id) ?? fail('E_NO_FRAME', `frame ${id} is not open`);
    const read = this.readers.get(e.sha) ?? fail('E_NO_SOURCE', `${e.name} is not at hand: open the file again`, { hint: 'File ▸ Open Files…' });
    const bytes = await read();
    const sha = await hashBytes(bytes);
    if (sha !== e.sha) fail('E_NO_SOURCE', `${e.name} changed on disk since it was opened`, { hint: 'Open the file again: it is a new frame now' });
    return this.load(bytes, sha, e.name, as, o.initial, e);
  }

  private async load(bytes: Uint8Array, sha: string, name: string, as: OpenAs, initial: FrameRecipe | InitialRecipe | undefined, replacing: FrameEntry | null): Promise<{ entry: FrameEntry; outcome: OpenOutcome }> {
    const { info, kind } = await this.opener({ kind: 'file', sha256: sha, name, bytes }, as);
    const graph = new Graph();
    graph.registerSource(info);
    const saved = await this.savedLog(sha, kind);
    const opts = { mode: this.mode, graph, ...(this.now ? { now: this.now } : {}) };
    const defaults = defaultFor(sha, name, kind);
    const first = saved ? null : typeof initial === 'function' ? await initial(defaults, graph) : initial && initial.kind === kind ? initial : null;
    const log = saved ? new EditLog(saved, opts) : EditLog.create(first ?? defaults, { ...opts, by: 'auto' });
    const entry: FrameEntry = { id: replacing?.id ?? log.frame, sha, name, kind, info, graph, log, initial: log.toJSON().initial };
    this.add(entry);
    return { entry, outcome: saved ? 'resumed' : 'opened' };
  }

  /** The saved log of (sha, kind); an old log saved by hash alone counts only when its kind matches (F3). */
  private async savedLog(sha: string, kind: FrameKind): Promise<EditLogData | undefined> {
    if (!this.kv) return undefined;
    const now = await this.kv.get<EditLogData>('logs', logKey(sha, kind)).catch(() => undefined);
    if (now) return now;
    const old = await this.kv.get<EditLogData>('logs', sha).catch(() => undefined);
    return old && old.initial?.kind === kind ? old : undefined;
  }

  add(e: FrameEntry): FrameEntry {
    this.map.set(e.id, e);
    e.log.on(ev => {
      if (ev.type !== 'preview' && this.map.get(e.id) === e) this.save(e);
    });
    this.save(e);
    for (const f of this.listeners) f(e);
    return e;
  }

  /** Takes a frame out of the studio (its log stays saved: opening the file again resumes it). */
  remove(id: string): FrameEntry | undefined {
    const e = this.map.get(id);
    if (!e) return undefined;
    this.map.delete(id);
    this.readers.delete(e.sha);
    for (const f of this.removedListeners) f(e);
    return e;
  }

  setMode(mode: AgentMode): void {
    this.mode = mode;
    for (const e of this.map.values()) e.log.setMode(mode);
  }

  private save(e: FrameEntry): void {
    if (!this.kv) return;
    const kv = this.kv;
    const data = e.log.toJSON();
    this.saving = this.saving.then(() => kv.put('logs', logKey(e.sha, e.kind), data)).catch(() => undefined);
  }
  /** resolves when every queued log write has finished */
  flush(): Promise<unknown> {
    return this.saving;
  }
}
