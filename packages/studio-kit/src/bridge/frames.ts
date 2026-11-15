// The open frames: per frame its source info, its own content-addressed Graph and its first document (what
// CHB-009's FrameSession held; the edit itself is the frame's document in the store's log, opened by the Studio).
// A frame is a file opened in one mode (CHB-027): a colour negative ('negative-scan') or a photo ('digital-raw').
// Edits are saved under (source SHA-256, mode) and resumed by both, so a moved file re-attaches its edit and a
// photo's edit never lands on the file opened as a negative (F3). A file is open once: opening it again finds the
// open frame; re-opening it in the other mode replaces the frame (same id) with a fresh decode and that mode's
// document.
//
// A scan of a strip of film (CHB-027 WS-D, F16) is several frames: the opener reports one box per frame on the
// strip, and each becomes a frame of its own — same file and source (the whole strip, so the strip's base and veil
// are shared), its document cropped to its box (geometry.crop), identity (sha, mode, index): id
// `frame_<sha8>-<n>`, save key `<sha>:<mode>:<n>`. A file with one frame keeps its id and key without an index.
import { fail, Graph, sha256Hex, type Box, type Document, type Engine, type FrameKind, type Orientation, type SourceInfo, type SourceRef } from '@chromobench/contract';
import { stripOrientation } from '../model/orient.ts';
import { defaultDocument, kindOfDoc } from '../model/doc.ts';
import { isFrameSave, type FrameSave } from './saved.ts';
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

/** What a frame is: a colour negative or a photo from a digital camera (the document's kind). */
export type { FrameKind };
/** How the photographer asked to open: let the studio guess, or say. */
export type OpenAs = 'auto' | 'photo' | 'negative';

export const kindOf = (as: 'photo' | 'negative'): FrameKind => (as === 'photo' ? 'digital-raw' : 'negative-scan');
export const asOf = (k: FrameKind): 'photo' | 'negative' => (k === 'digital-raw' ? 'photo' : 'negative');

/** What an opener reports: the source, the mode it opened in, and the frames on a strip (≥ 2 boxes, source px). */
export interface Opened {
  info: SourceInfo;
  kind: FrameKind;
  /** one box per frame when the scan is a strip of several frames; absent or null for one frame */
  frames?: Box[] | null;
}

/**
 * Opens a source in the engine in a mode. The studio host's engine decodes as asked and guesses on 'auto' (it may
 * ask the photographer); the default opener (any contract Engine) opens as a negative unless told 'photo'.
 */
export type SourceOpener = (source: SourceRef, as: OpenAs) => Promise<Opened>;

export interface FrameEntry {
  readonly id: string;
  readonly sha: string;
  readonly name: string;
  readonly kind: FrameKind;
  readonly info: SourceInfo;
  readonly graph: Graph;
  /** the document the frame opens with when nothing is saved (its first print, cropped to a strip's box) */
  readonly first: Document;
  /** the edit saved for the frame's key, read on open (the Studio restores it into the log) */
  readonly saved: FrameSave | null;
  /** a frame of a strip: its place (1-based), the strip's frame count and its box (source px); absent for a whole file */
  readonly strip?: { index: number; of: number; box: Box };
}

/**
 * A frame's first document computed from the opened frame (CHB-023: the automatic first print). It gets the neutral
 * document of the frame's kind and the frame's graph (the source is registered in it); it runs only when nothing is
 * saved for the hash and mode.
 */
export type InitialDocument = (defaults: Document, graph: Graph) => Promise<Document>;

/** What opening a file did. */
export type OpenOutcome =
  /** opened now, with a new document */
  | 'opened'
  /** opened now, its saved edit resumed */
  | 'resumed'
  /** the file was open already (in the mode asked, or the mode did not matter): nothing changed */
  | 'already'
  /** the file is open in the other mode: the caller may re-open it (after asking) */
  | 'conflict';

/** What opening (or re-opening) a file did, and its frames: one, or one per frame on a strip. */
export interface OpenResult {
  /** the first frame (the file's only frame, or the first of its strip) */
  entry: FrameEntry;
  outcome: OpenOutcome;
  /** every frame of the file now open (one for a whole file) */
  entries: FrameEntry[];
}

export interface OpenFileOptions {
  initial?: Document | InitialDocument;
  /** default 'auto' */
  as?: OpenAs;
  /** reads the file's bytes again (re-open in the other mode); the bytes are kept in memory when absent */
  read?: () => Promise<Uint8Array>;
}

export interface FramesOptions {
  kv?: KV | null;
  opener?: SourceOpener;
  /**
   * How the library last had a file open (CHB-031 F18), by hash: a file it knows opens that way when the caller
   * says 'auto' (a frame of the library opened again after a restart is what it was, not a new guess).
   */
  known?: (sha: string) => 'photo' | 'negative' | null | undefined;
}

/** The KV key of a frame's saved edit: the hash and the mode, and the frame's place on a strip. */
export const logKey = (sha: string, kind: FrameKind, index?: number): string => `${sha}:${asOf(kind)}${index ? `:${index}` : ''}`;
/** The id of a frame of a strip (a whole file keeps the document's `frame_<sha8>`). */
export const stripFrameId = (sha: string, index: number): string => `frame_${sha.slice(0, 8)}-${index}`;

/** A strip frame's document: its id, its box as the crop and, when given, the strip's orientation (F20). */
export function stripFrameDocument(d: Document, id: string, box: Box, orientation?: Orientation): Document {
  return { ...d, frame: id, geometry: { ...d.geometry, crop: { ...box }, ...(orientation ? { orientation } : {}) } };
}

/**
 * A strip frame's saved edit from a decode at another working size (CHB-031: the engines decode strips at different
 * sizes): its crop and rebate are pixels of that size. A strip frame's crop sits on its frame, so its centre scales
 * with the box's centre from the image origin: when that says the scale changed (by more than a third), the sets
 * that scale the crop and the rebate to this decode, else null. The exact ratio is the frame's first box (the saved
 * initial crop) when that agrees. `W × H`: this decode's working image.
 */
export function rescaleStrip(doc: Document, initial: Document, box: Box, W: number, H: number): { op: 'set'; path: string; value: Box }[] | null {
  const crop = doc.geometry.crop;
  if (!crop || crop.w <= 0 || crop.h <= 0) return null;
  const bx = box.x + box.w / 2, by = box.y + box.h / 2;
  const est = ((crop.x + crop.w / 2) * bx + (crop.y + crop.h / 2) * by) / Math.max(1e-9, bx * bx + by * by);
  if (!(est > 0) || Math.abs(Math.log(est)) < 0.3) return null;
  const was = initial.geometry.crop;
  const exact = was && was.w > 0 && was.h > 0 && Math.abs(Math.log((box.w / was.w) * est)) < 0.2 ? [box.w / was.w, box.h / was.h] as const : null;
  const [kx, ky] = exact ?? [1 / est, 1 / est];
  const scale = (b: Box): Box => {
    const x = Math.min(W - 1, Math.max(0, Math.round(b.x * kx))), y = Math.min(H - 1, Math.max(0, Math.round(b.y * ky)));
    return { x, y, w: Math.max(1, Math.min(W - x, Math.round(b.w * kx))), h: Math.max(1, Math.min(H - y, Math.round(b.h * ky))) };
  };
  const out: { op: 'set'; path: string; value: Box }[] = [{ op: 'set', path: 'geometry.crop', value: scale(crop) }];
  const rebate = (doc.stages.scan?.medium as { rebate?: Box | null } | undefined)?.rebate;
  if (rebate) out.push({ op: 'set', path: 'stages.scan.medium.rebate', value: scale(rebate) });
  return out;
}

/** A decoded file: what every frame of it shares. */
interface Decoded { name: string; kind: FrameKind; info: SourceInfo; boxes: Box[] | null }

export class Frames {
  readonly engine: Engine;
  readonly kv: KV | null;
  private readonly opener: SourceOpener;
  private readonly known: FramesOptions['known'];
  private readonly map = new Map<string, FrameEntry>();
  private readonly readers = new Map<string, () => Promise<Uint8Array>>();
  /** the files decoded now, by hash (their frames may be fewer: one removed) */
  private readonly decoded = new Map<string, Decoded>();
  private readonly listeners = new Set<(e: FrameEntry) => void>();
  private readonly removedListeners = new Set<(e: FrameEntry) => void>();
  private readonly opening = new Map<string, Promise<OpenResult>>();

  constructor(engine: Engine, o: FramesOptions = {}) {
    this.engine = engine;
    this.kv = o.kv ?? null;
    this.known = o.known;
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
  /** every open frame of a file (one, or the frames of a strip in order) */
  allBySha(sha: string): FrameEntry[] {
    return this.all().filter(e => e.sha === sha).sort((a, b) => (a.strip?.index ?? 0) - (b.strip?.index ?? 0));
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

  /** Opens bytes in the engine and makes the frame (its saved edit read by hash and mode, or its first document). */
  async open(bytes: Uint8Array, name: string, o: OpenFileOptions = {}): Promise<FrameEntry> {
    return (await this.openFile(bytes, name, o)).entry;
  }

  /** Opens bytes and says what happened: opened, resumed, already open, or open in the other mode. */
  async openFile(bytes: Uint8Array, name: string, o: OpenFileOptions = {}): Promise<OpenResult> {
    const sha = await hashBytes(bytes);
    // 'auto' on a file the library knows: the way it had it open (F18), not a new guess
    const as: OpenAs = (o.as ?? 'auto') === 'auto' ? (this.known?.(sha) ?? 'auto') : o.as!;
    // no reader from the host: a copy (an engine may transfer the bytes it decodes to a worker)
    const copy = o.read ? null : bytes.slice();
    this.readers.set(sha, o.read ?? (async () => copy!));
    const pending = this.opening.get(sha);
    const same = (k: FrameKind): boolean => as === 'auto' || kindOf(as) === k;
    if (pending) {
      // opened twice at once: the first open wins
      const r = await pending;
      return { ...r, outcome: same(r.entry.kind) ? 'already' : 'conflict' };
    }
    const existing = this.allBySha(sha);
    if (existing.length) {
      const d = this.decoded.get(sha);
      // a strip with frames taken out of the studio: opening the file again brings them back
      if (d?.boxes && existing.length < d.boxes.length && same(d.kind)) return this.track(sha, this.build(sha, d, o.initial, existing));
      return { entry: existing[0]!, entries: existing, outcome: same(existing[0]!.kind) ? 'already' : 'conflict' };
    }
    return this.track(sha, this.load(bytes, sha, name, as, o.initial, []));
  }

  private async track(sha: string, p: Promise<OpenResult>): Promise<OpenResult> {
    this.opening.set(sha, p);
    try {
      return await p;
    } finally {
      this.opening.delete(sha);
    }
  }

  /**
   * Re-opens an open frame as a photo or as a negative (F3, F6): decodes the file again in that mode and resumes
   * that mode's saved edit or starts that mode's document. The frame keeps its id; the other mode's edit stays saved.
   * A frame of a strip re-opens the whole file (the engine holds one decode per file): all its frames are replaced
   * by the file's frames in the new mode.
   */
  async reopen(id: string, as: 'photo' | 'negative', o: { initial?: Document | InitialDocument } = {}): Promise<OpenResult> {
    const e = this.map.get(id) ?? fail('E_NO_FRAME', `frame ${id} is not open`);
    const read = this.readers.get(e.sha) ?? fail('E_NO_SOURCE', `${e.name} is not at hand: open the file again`, { hint: 'File ▸ Open Files…' });
    const bytes = await read();
    const sha = await hashBytes(bytes);
    if (sha !== e.sha) fail('E_NO_SOURCE', `${e.name} changed on disk since it was opened`, { hint: 'Open the file again: it is a new frame now' });
    return this.load(bytes, sha, e.name, as, o.initial, this.allBySha(sha));
  }

  private async load(bytes: Uint8Array, sha: string, name: string, as: OpenAs, initial: Document | InitialDocument | undefined, replacing: FrameEntry[]): Promise<OpenResult> {
    const r = await this.opener({ kind: 'file', sha256: sha, name, bytes }, as);
    const boxes = r.frames && r.frames.length >= 2 ? r.frames.map(b => ({ ...b })) : null;
    const d: Decoded = { name, kind: r.kind, info: r.info, boxes };
    this.decoded.set(sha, d);
    return this.build(sha, d, initial, replacing);
  }

  /**
   * The frames of a decoded file: the whole file, or one per box of its strip. Frames open already (`present`) are
   * replaced in place when the id stays (re-open), else removed; frames missing are created or resumed.
   */
  private async build(sha: string, d: Decoded, initial: Document | InitialDocument | undefined, present: FrameEntry[]): Promise<OpenResult> {
    const reopening = present.length > 0 && present[0]!.kind !== d.kind;
    const keep = reopening ? [] : present;
    const plan = d.boxes
      ? d.boxes.map((box, i) => ({ index: i + 1, box, id: stripFrameId(sha, i + 1) as string | null }))
      // a whole file keeps the id it had (a re-open) or takes its saved document's
      : [{ index: 0, box: null as Box | null, id: present.length === 1 && !present[0]!.strip ? present[0]!.id : null }];
    const made: FrameEntry[] = [];
    let resumed = 0;
    // frames cut from a strip read the way the strip runs (F20: landscape frames on a vertical strip are sideways)
    const turn = d.boxes ? stripOrientation(d.boxes) : 'none';
    for (const p of plan) {
      const open = keep.find(e => (p.id ? e.id === p.id : !e.strip));
      if (open) {
        made.push(open);
        continue;
      }
      const graph = new Graph();
      graph.registerSource(d.info);
      const saved = await this.savedEdit(sha, d.kind, p.index || undefined);
      let defaults = defaultDocument(d.kind, { sha256: sha, name: d.name, width: d.info.width, height: d.info.height });
      if (p.box) defaults = stripFrameDocument(defaults, p.id!, p.box, turn);
      let first = saved ? null : typeof initial === 'function' ? await initial(defaults, graph) : initial && kindOfDoc(initial) === d.kind ? initial : null;
      if (first && p.box) first = stripFrameDocument(first, p.id!, p.box, turn);
      const doc = saved?.initial ?? first ?? defaults;
      if (saved) resumed++;
      const strip = p.box && d.boxes ? { index: p.index, of: d.boxes.length, box: { ...p.box } } : undefined;
      made.push({ id: p.id ?? doc.frame, sha, name: d.name, kind: d.kind, info: d.info, graph, first: first ?? defaults, saved, ...(strip ? { strip } : {}) });
    }
    // frames of the old decode that have no place in the new one leave the studio (their edits stay saved)
    for (const e of present) if (!made.some(m => m.id === e.id)) this.drop(e);
    const added = made.filter(m => !present.includes(m) || reopening);
    for (const e of added) this.add(e);
    const fresh = made.filter(m => !keep.includes(m));
    return { entry: made[0]!, entries: made, outcome: fresh.length && resumed === fresh.length ? 'resumed' : 'opened' };
  }

  /** The saved edit of (sha, kind[, index]), or null (nothing saved, or a record of another format: not read). */
  private async savedEdit(sha: string, kind: FrameKind, index?: number): Promise<FrameSave | null> {
    if (!this.kv) return null;
    const v = await this.kv.get<unknown>('logs', logKey(sha, kind, index)).catch(() => undefined);
    return isFrameSave(v) && kindOfDoc(v.initial) === kind ? v : null;
  }

  add(e: FrameEntry): FrameEntry {
    this.map.set(e.id, e);
    for (const f of this.listeners) f(e);
    return e;
  }

  /** Saves a frame's edit under its key (the Studio calls it when the frame's part of the log changed). */
  save(e: FrameEntry, data: FrameSave): void {
    if (!this.kv) return;
    const kv = this.kv;
    this.saving = this.saving.then(() => kv.put('logs', logKey(e.sha, e.kind, e.strip?.index), data)).catch(() => undefined);
  }
  private saving: Promise<unknown> = Promise.resolve();

  /** Takes a frame out of the studio (its edit stays saved: opening the file again resumes it). Other frames of its strip stay. */
  remove(id: string): FrameEntry | undefined {
    const e = this.map.get(id);
    if (!e) return undefined;
    this.drop(e);
    if (!this.bySha(e.sha)) {
      this.readers.delete(e.sha);
      this.decoded.delete(e.sha);
    }
    return e;
  }

  private drop(e: FrameEntry): void {
    if (this.map.get(e.id) !== e) return;
    this.map.delete(e.id);
    for (const f of this.removedListeners) f(e);
  }

  /** resolves when every queued write has finished */
  flush(): Promise<unknown> {
    return this.saving;
  }
}
