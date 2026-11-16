// The studio's services (guide §7.1; CHB-037): the frames (sources and graphs), the render bridge and persistence,
// handed to app.start / mount as services. A frame's edit is a document in the store's log (`docs.<frameId>`, kind
// 'frame', the contract's LOG_RULES): the Studio opens it when the frame is decoded (its saved edit restored, or its
// first print), closes it when the frame leaves, saves its part of the log, publishes the pending proposals for the
// panels (`ui.log`), and is the host side of the agent's proposals (propose, approve, reject; the mode is policy).
// Nothing is recorded in the layout: one layout runs headless with MockEngine and memoryKV, and in the browser with
// a real engine and IndexedDB.
//
//   const studio = createStudio({ engine: new MockEngine(), kv: memoryKV() });
//   const rt = app.start(studio.services({ clock }));   // or mount(app, el, studio.services())
//   studio.attach(rt);
//   await studio.open(bytes, 'frame-12.tif');
import { Coll, transaction, type Author, type JsonObject, type Log, type Mutation } from '@chromobench/values';
import {
  isChromobenchError, LOG_RULES, resolveLinks, storedMutations,
  type AgentMode, type Diagnostic, type Document, type Engine, type LinkContext, type OutputSpaceId,
} from '@chromobench/contract';
import { memoryPersistence, type Runtime, type Services } from '@chromobench/shell';
import { asOf, Frames, type FrameEntry, type InitialDocument, type OpenAs, type OpenResult, rescaleStrip, type SourceOpener } from './bridge/frames.ts';
import type { KV } from './bridge/kv.ts';
import { kvPersistence } from './bridge/persistence.ts';
import { FrameRenderBridge } from './bridge/render-bridge.ts';
import { frameSave, replayFrame } from './bridge/saved.ts';
import { explainError } from './kit/messages.ts';
import { DOCS, linkDataOf, linksOf, withEnlargerMode, type EnlargerMode, type LinkData } from './model/doc.ts';
import { describe, type Change, type ModelLookup } from './model/history.ts';
import { modelAt } from './kit/args.ts';
import type { CatalogEntry as CatalogFrame } from './sel.ts';
import type { ExportRequestOf } from './commands/output.ts';
import type { ExportResult, PrinterProfileRef } from './model/export.ts';

/** The library's name of a frame: the file's, with its place on a strip ("raw010.dng · 2/3"). */
export const frameName = (f: Pick<FrameEntry, 'name' | 'strip'>): string => (f.strip ? `${f.name} · ${f.strip.index}/${f.strip.of}` : f.name);

export interface StudioOptions {
  engine: Engine;
  kv?: KV | null;
  mode?: AgentMode;
  displaySpace?: OutputSpaceId;
  /** the first document of a frame opened for the first time (the host's automatic first print, CHB-023) */
  initial?: InitialDocument;
  /** opens a source as a photo, a negative or as guessed (the host's engine; default: Engine.open as a negative) */
  opener?: SourceOpener;
  /**
   * The enlarger mode of new documents (the layout's, LayoutDef.enlarger; CHB-031): 'real' (the contract's default)
   * or 'normalised'. The first document is made in it (initialInMode); saved documents keep the mode they store.
   */
  enlarger?: EnlargerMode;
}

/**
 * The host's capabilities (CHB-029 item 1), typed: what the host page contributes to the studio's menus (CHB-027:
 * the host's top bar folded into File and View). The studio hands them to its runtime as services.host; each action
 * is a command that requires it (file.open requires 'host.openFiles', …), so a layout's menus name them and a host
 * without them (the dev host, tests) shows none of them.
 */
export interface StudioHost {
  /** File ▸ Open Files… (Mod+O) */
  openFiles?(): unknown;
  /** File ▸ Open Folder… */
  openFolder?(): unknown;
  /** File ▸ Reopen <folder> (the folder used last; `folder` names it) */
  reopenFolder?(): unknown;
  folder?: string | null;
  /**
   * The export of frames with his export settings (CHB-047): the Output module's Export, File ▸ Export…, and
   * output.export; progress through `onProgress`, one result per frame.
   */
  exportFrames?(req: ExportRequestOf): Promise<ExportResult[]>;
  /** File ▸ Save Document */
  saveDocument?(): unknown;
  /** File ▸ Open As ▸ Heal Dust: the host finds dust on open and adds a Dust group of heal layers to the scan stage */
  dust?(on: boolean): unknown;
  /** View ▸ Layout: the layouts and how to switch */
  layouts?: { id: string; label: string }[];
  layout?: string;
  setLayout?(id: string): unknown;
  /** a library frame whose file is not open in this session (after a reload): read it again */
  relink?(id: string): unknown;
  /** D8 (CHB-046): print a negative anew with the first print's aim (Neutralise), one step */
  firstPrint?(frame: string): unknown;
  /** CHB-047 OUT-5: add a printer profile (.icc, .icm) to his library; the host publishes the list (HostFlags.printers) */
  addPrinterProfile?(): unknown;
  /** his printer profiles (published as HostFlags.printers) */
  printers?: PrinterProfileRef[];
}

/** What the host publishes into the state (ui.host) for labels and menus: the folder, the layouts. Its actions are
 *  capabilities (services.host), not state. */
export interface HostFlags {
  folder: string | null;
  layouts: { id: string; label: string }[];
  layout: string | null;
  /** his printer profiles (CHB-047 OUT-5), for the Output panel's colour space */
  printers?: PrinterProfileRef[];
}

/** A pending proposal of the log on one frame, in the photographer's words (the Agent proposals panel's card). */
export interface Proposal {
  /** the log entry's sequence number (approve and reject select it) */
  seq: number;
  /** the transaction id (Show keys on it) */
  tx: string;
  label: string;
  by: Author;
  why?: string;
  /** the batch the proposal belongs to (an agent's look over several frames: one card) */
  batch?: string;
  changes: Change[];
  /** the document with the proposal applied (what Show renders); null when it no longer applies */
  doc: Document | null;
  error?: string;
}

/** What the Studio publishes at ui.log for the panels: a counter of log changes and the proposals per frame. */
export interface LogView {
  /** bumped on every change of the log (cells that read the log directly depend on it) */
  v: number;
  proposals: Record<string, Proposal[]>;
}

/** The result of approving: the step, or why it was refused (E_STALE: the document changed under the proposal). */
export type Approved = { ok: true } | { ok: false; diags: Diagnostic[] };

/**
 * A layout's enlarger mode for new documents: the host's first document (the automatic first print) is made with
 * the enlarger already in `mode`, so it puts the density where that mode has it (the time in real mode, the
 * printer lights in normalised mode), and the result is held to `mode`.
 */
export function initialInMode(initial: InitialDocument | undefined, mode: EnlargerMode): InitialDocument {
  return async (defaults, graph) => {
    const d = withEnlargerMode(defaults, mode);
    return withEnlargerMode(initial ? await initial(d, graph) : d, mode);
  };
}

const diagsOf = (e: unknown): Diagnostic[] => {
  const x = e as { diag?: Diagnostic; cause2?: unknown };
  if (isChromobenchError(e)) return [e.diag as Diagnostic];
  if (x?.diag && typeof x.diag.code === 'string') return [x.diag];
  if (x?.cause2) return diagsOf(x.cause2);
  return [{ code: 'E_INTERNAL', message: String((e as Error)?.message ?? e) } as Diagnostic];
};

export class Studio {
  readonly engine: Engine;
  readonly kv: KV | null;
  readonly frames: Frames;
  readonly bridge: FrameRenderBridge;
  #mode: AgentMode;
  /** the agent's mode: read-only refuses, ask proposes, auto commits (host policy; the log takes any author) */
  get mode(): AgentMode {
    return this.#mode;
  }
  set mode(m: AgentMode) {
    if (m === this.#mode) return;
    this.#mode = m;
    this.tell();
  }
  private readonly subs = new Set<() => void>();
  /** calls fn after every change of the log (once per change, after the proposals view) or of the mode */
  subscribe(fn: () => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
  private tell(): void {
    for (const f of [...this.subs]) {
      try {
        f();
      } catch (e) {
        this.rt?.diagnostics.warn('CB-H421', 'A subscriber of the studio threw', { runtime: true, facts: [String((e as Error)?.message ?? e)] });
      }
    }
  }
  /** the first document of a new frame, in the layout's enlarger mode (setEnlarger) */
  initial: InitialDocument | undefined;
  rt: Runtime | null = null;
  /** the host page's actions (menus); set with setHost */
  host: StudioHost | null = null;
  private proposeSeq = 0;
  private stops: (() => void)[] = [];
  private logV = 0;
  private publishing = false;
  /** what was last saved per frame (the log's part of it changes → save again) */
  private savedSig = new Map<string, { doc: Document; sig: string }>();
  /** the host's first document, before the layout's enlarger mode is applied */
  private readonly hostInitial: InitialDocument | undefined;
  private readonly lookup: ModelLookup = (p, d) => modelAt(p, d) ?? undefined;

  constructor(o: StudioOptions) {
    this.engine = o.engine;
    this.kv = o.kv ?? null;
    this.#mode = o.mode ?? 'ask';
    this.hostInitial = o.initial;
    this.initial = o.enlarger ? initialInMode(o.initial, o.enlarger) : o.initial;
    this.frames = new Frames(o.engine, { kv: this.kv, ...(o.opener ? { opener: o.opener } : {}), known: sha => this.libraryKind(sha) });
    this.bridge = new FrameRenderBridge(this.frames, o.displaySpace ? { displaySpace: o.displaySpace } : {});
  }

  /** what app.start / mount take; extra services (clock, presenter, save, renderers) are merged in */
  services(extra: Services = {}): Services & { studio: Studio } {
    return {
      rules: LOG_RULES,
      bridges: [this.bridge],
      persistence: this.kv ? kvPersistence(this.kv) : memoryPersistence(),
      engine: this.engine,
      host: this.host,
      ...extra,
      studio: this,
    };
  }

  /** the store's log (the frames' documents and their history) */
  get log(): Log {
    const rt = this.rt ?? fail('the studio is not attached to a runtime');
    return rt.store.log;
  }
  /** a frame's current document (committed), or undefined when it is not open */
  doc(f: string): Document | undefined {
    const log = this.rt?.store.log;
    return log?.has(f) ? log.doc<Document>(f) : undefined;
  }
  /** the links of the state: the rolls and presets a frame's links resolve against (model/doc.ts linksOf) */
  links(): LinkContext {
    return linksOf({ roll: this.rt?.store.peek(['roll']), looks: this.rt?.store.peek(['looks']) });
  }
  /** the same as data (the agent's worker gets a copy) */
  linkData(): LinkData {
    return linkDataOf({ roll: this.rt?.store.peek(['roll']), looks: this.rt?.store.peek(['looks']) });
  }
  /**
   * a frame's current document as the compiler sees it: every link resolved (a roll's scan settings, looks and
   * presets as plain groups). Portable: what an export writes beside the image.
   */
  resolved(f: string): Document | undefined {
    const d = this.doc(f);
    return d ? resolveLinks(d, this.links()) : undefined;
  }

  /** connect a started runtime: the frames' documents in its log, catalog entries, saves, the proposals view */
  attach(rt: Runtime): this {
    this.rt = rt;
    this.bridge.initialDoc = f => (rt.store.log.has(f) ? rt.store.log.initial<Document>(f) : undefined);
    this.bridge.committedDoc = f => (rt.store.log.has(f) ? rt.store.log.doc<Document>(f) : undefined);
    this.bridge.links = () => this.links();
    // errors toast in the photographer's words (CHB-027 F7); the diagnostics keep the codes
    rt.explainError = explainError;
    this.stops.push(
      rt.store.on((paths, info) => {
        if (info.tier !== 'document' || info.preview) return;
        if (info.undo || info.redo) this.showChanged(rt, paths);
        this.afterLog();
      }),
      this.frames.onAdded(f => this.added(f)),
      this.frames.onRemoved(f => this.removed(f)),
    );
    if (this.host) {
      rt.setHost(this.host);
      this.publishHost();
    }
    this.afterLog();
    return this;
  }

  /**
   * The enlarger mode of new documents, after a layout switch in place (CHB-031 F24: the frames stay open, the next
   * new frame takes the new layout's mode; frames already open keep the mode their document stores).
   */
  setEnlarger(mode: EnlargerMode): void {
    this.initial = initialInMode(this.hostInitial, mode);
  }

  /** the host's capabilities (commands in File and View require them) and what it publishes (folder, layouts) */
  setHost(host: StudioHost | null): void {
    this.host = host;
    this.rt?.setHost(host);
    this.publishHost();
  }
  /** the host flags in ui.host, after the host changed (a folder picked) */
  publishHost(): void {
    const h = this.host;
    const flags: HostFlags = { folder: h?.folder ?? null, layouts: h?.layouts ?? [], layout: h?.layout ?? null, ...(h?.printers ? { printers: h.printers } : {}) };
    this.rt?.store.writeView([{ path: ['ui', 'host'], value: flags }]);
  }
  detach(): void {
    if (this.rt?.explainError === explainError) this.rt.explainError = null;
    this.bridge.initialDoc = null;
    this.bridge.committedDoc = null;
    this.bridge.links = null;
    for (const f of this.stops) f();
    this.stops = [];
    this.rt = null;
  }

  // ── frames in the log ──

  /** a frame was decoded: its document opens in the log (its saved edit restored, else its first document) */
  private added(e: FrameEntry): void {
    const rt = this.rt;
    if (!rt) return;
    const st = rt.store;
    if (st.mounts.has(e.id)) {
      // a layout switched in place adopted the log (the document is open already), or a re-open in the other mode
      if (st.log.has(e.id) && st.log.doc<Document>(e.id).source.sha256 === e.sha && st.log.kind(e.id) === 'frame' && this.sameKind(e)) return this.catalogue(e);
      st.close(e.id);
    }
    const at = [DOCS, e.id];
    let restored = false;
    if (e.saved) {
      try {
        st.open(e.id, e.saved.initial, { at, kind: 'frame', by: 'auto', source: { kind: 'restore' } });
        const saved = e.saved;
        st.change(log => replayFrame(log, e.id, saved), { label: `Restore ${e.name}` });
        restored = true;
      } catch (err) {
        st.close(e.id);
        rt.diagnostics.warn('CB-H402', `The saved edit of ${frameName(e)} could not be read; it opens as new`, { runtime: true, facts: diagsOf(err).map(d => `${d.code}: ${d.message}`) });
        rt.chrome.toast(`The saved edit of ${frameName(e)} could not be read: it opens with a new print`, { kind: 'warn', ms: 5000 });
      }
    }
    if (!restored) st.open(e.id, e.first, { at, kind: 'frame', by: 'auto', source: { kind: 'ingest' } });
    if (restored && e.strip) {
      // a strip frame saved from a decode at another working size: its crop and rebate follow this decode
      const doc = st.log.doc<Document>(e.id);
      const ms = rescaleStrip(doc, st.log.initial<Document>(e.id), e.strip.box, e.info.width, e.info.height);
      if (ms) this.commit(e.id, ms, 'Working size changed', { by: 'auto' });
    }
    this.catalogue(e);
    this.afterLog();
  }
  private sameKind(e: FrameEntry): boolean {
    const d = this.doc(e.id);
    return !!d && (d.stages.scan ? 'negative-scan' : 'digital-raw') === e.kind;
  }

  private removed(e: FrameEntry): void {
    const rt = this.rt;
    if (!rt) return;
    if (this.frames.get(e.id)) return; // replaced by a re-open: added() closes and opens it
    rt.store.close(e.id);
    this.savedSig.delete(e.id);
    this.uncatalogue(e.id);
  }

  /** After every change of the log: save the frames whose part changed, publish the proposals for the panels. */
  private afterLog(): void {
    if (this.publishing) return;
    this.publishing = true;
    queueMicrotask(() => {
      this.publishing = false;
      const rt = this.rt;
      if (!rt) return;
      const log = rt.store.log;
      const proposals: Record<string, Proposal[]> = {};
      for (const e of this.frames.all()) {
        if (!log.has(e.id)) continue;
        const pending = log.pending(e.id);
        if (pending.length) proposals[e.id] = this.proposals(log, e.id);
        // the document (a coalesced step changes it under the same entry), the entries in effect, the proposals
        const doc = log.doc<Document>(e.id);
        const inEffect = log.inEffect(e.id);
        const sig = `${inEffect.map(x => x.seq).join(',')}|${pending.map(p => p.seq).join(',')}`;
        const was = this.savedSig.get(e.id);
        if (!was || was.doc !== doc || was.sig !== sig) {
          this.savedSig.set(e.id, { doc, sig });
          this.frames.save(e, frameSave(log, e.id));
        }
      }
      rt.store.writeView([{ path: ['ui', 'log'], value: { v: ++this.logV, proposals } satisfies LogView }]);
      this.tell();
    });
  }

  /** a frame's pending proposals as cards: what each changes, in words, and the document it would make */
  proposals(log: Log, f: string): Proposal[] {
    const now = log.doc<Document>(f);
    return log.pending(f).map(p => {
      const changes = p.tx.mutations.map((m, i) => ({ seq: i, text: describe(m, now, this.lookup) }));
      let doc: Document | null = null;
      let error: string | undefined;
      try {
        doc = log.draft<Document>(f).apply(...p.tx.mutations).value;
      } catch (err) {
        error = diagsOf(err)[0]?.message;
      }
      return {
        seq: p.seq, tx: p.tx.id, label: p.tx.label, by: p.tx.by, changes, doc,
        ...(p.why !== undefined ? { why: p.why } : {}), ...(p.tx.batch !== undefined ? { batch: p.tx.batch } : {}), ...(error ? { error } : {}),
      };
    });
  }

  /**
   * Undo or Redo changed a frame that is not on screen: select it, so the photographer sees what changed (CHB-031
   * F36). After the runtime's toast, which names the frame ("Undo Time (on DSC_8559.NEF)"); only an open frame.
   */
  private showChanged(rt: Runtime, paths: (string | number)[][]): void {
    const frames = [...new Set(paths.filter(p => p[0] === DOCS && p.length > 1).map(p => String(p[1])))];
    const frame = frames.length === 1 ? frames[0]! : null;
    if (!frame || !this.frames.get(frame) || this.current === frame) return;
    queueMicrotask(() => {
      if (this.rt !== rt || !this.frames.get(frame) || this.current === frame) return;
      rt.store.writeView([{ path: ['ui', 'selection'], value: { ids: [frame], primary: frame, anchor: frame } }]);
    });
  }

  private catalogue(f: FrameEntry): void {
    const rt = this.rt;
    if (!rt) return;
    const st = rt.store;
    const cat = st.peek(['catalog']) as { frames: Record<string, CatalogFrame>; order: string[] } | undefined;
    const had = cat?.frames?.[f.id];
    const entry: CatalogFrame | null = !had
      ? { id: f.id, sha256: f.sha, name: frameName(f), kind: asOf(f.kind), ...(f.strip ? { file: f.name } : {}) }
      // re-opened in the other mode: the catalog says how it is open
      : had.kind !== asOf(f.kind) || had.sha256 !== f.sha ? { ...had, sha256: f.sha, kind: asOf(f.kind) } : null;
    const order = (cat?.order ?? []).includes(f.id) ? null : [...(cat?.order ?? []), f.id];
    // the library is the view tier: opening a file is not an edit (nothing to undo)
    const writes = [...(entry ? [{ path: ['catalog', 'frames', f.id], value: entry }] : []), ...(order ? [{ path: ['catalog', 'order'], value: order }] : [])];
    if (writes.length) st.writeView(writes);
    if (!st.peek(['ui', 'selection', 'primary'])) st.writeView([{ path: ['ui', 'selection'], value: { ids: [f.id], primary: f.id, anchor: f.id } }]);
  }

  /** a frame left the studio: out of the catalog and the selection */
  private uncatalogue(id: string): void {
    const rt = this.rt;
    if (!rt) return;
    const st = rt.store;
    const cat = st.peek(['catalog']) as { frames: Record<string, CatalogFrame>; order: string[] } | undefined;
    const writes = [...(cat?.frames?.[id] ? [{ path: ['catalog', 'frames', id], value: undefined }] : []), ...(cat?.order?.includes(id) ? [{ path: ['catalog', 'order'], value: cat.order.filter(x => x !== id) }] : [])];
    if (writes.length) st.writeView(writes);
    const sel = st.peek(['ui', 'selection']) as { ids: string[]; primary: string | null; anchor: string | null } | undefined;
    if (sel && (sel.ids.includes(id) || sel.primary === id)) {
      // the next open frame (after it, else before it): never a library frame whose file is not open, since
      // selecting one asks for its file (CHB-031 F21: "Where is …?" opened by itself after Remove from Library)
      const all = cat?.order ?? [];
      const i = Math.max(0, all.indexOf(id));
      const open = (x: string): boolean => x !== id && !!this.frames.get(x);
      const next = all.slice(i).find(open) ?? all.slice(0, i).reverse().find(open) ?? null;
      const ids = sel.ids.filter(x => x !== id);
      const primary = sel.primary === id ? (ids.find(open) ?? next) : sel.primary;
      st.writeView([{ path: ['ui', 'selection'], value: { ids: ids.length ? ids : primary ? [primary] : [], primary, anchor: primary } }]);
    }
  }

  /** how the library has a file (by hash): as a photo or a negative; undefined when it does not know the file */
  libraryKind(sha: string): 'photo' | 'negative' | undefined {
    const frames = (this.rt?.store.peek(['catalog', 'frames']) as Record<string, CatalogFrame> | undefined) ?? {};
    for (const c of Object.values(frames)) if (c?.sha256 === sha && c.kind) return c.kind;
    return undefined;
  }

  /** open a file's bytes as a photo, a negative or as guessed (resumes its saved edit by SHA-256 and mode) */
  async open(bytes: Uint8Array, name: string, o: { initial?: Document | InitialDocument; as?: OpenAs; read?: () => Promise<Uint8Array> } = {}): Promise<FrameEntry> {
    return (await this.openFile(bytes, name, o)).entry;
  }
  /** open, and say what happened: opened, resumed, already open, or open in the other mode */
  async openFile(bytes: Uint8Array, name: string, o: { initial?: Document | InitialDocument; as?: OpenAs; read?: () => Promise<Uint8Array> } = {}): Promise<OpenResult> {
    const initial = o.initial ?? this.initial;
    return this.frames.openFile(bytes, name, { ...(initial ? { initial } : {}), ...(o.as ? { as: o.as } : {}), ...(o.read ? { read: o.read } : {}) });
  }
  /** re-open a frame as a photo or as a negative (F3, F6): decoded again, that mode's document */
  async reopen(id: string, as: 'photo' | 'negative'): Promise<OpenResult> {
    this.rt?.store.cancel();
    const before = this.current;
    const r = await this.frames.reopen(id, as, this.initial ? { initial: this.initial } : {});
    // a strip re-opened as one photo (or a photo as a strip): the frame shown was replaced, show the file's first
    const cur = this.current;
    if (this.rt && (!cur || !this.frames.get(cur) || (before && before !== cur && !this.frames.get(before)))) this.rt.store.writeView([{ path: ['ui', 'selection'], value: { ids: [r.entry.id], primary: r.entry.id, anchor: r.entry.id } }]);
    return r;
  }
  /** take frames out of the library (their edits stay saved: opening the file again resumes them) */
  remove(ids: string[]): void {
    this.rt?.store.cancel();
    for (const id of ids) {
      if (this.frames.get(id)) this.frames.remove(id);
      else this.uncatalogue(id); // a library entry not open in this session
    }
  }

  get current(): string | null {
    return (this.rt?.store.peek(['ui', 'selection', 'primary']) as string | null) ?? null;
  }

  // ── edits on the log (commands, tools and the agent's host side) ──

  /** One transaction on one frame, one step (structural edits: a layer added, a mask drawn, a snapshot restored). */
  commit(f: string, mutations: readonly Mutation[], label: string, o: { by?: Author; source?: JsonObject; batch?: string } = {}): void {
    if (!mutations.length) return;
    // a medium field of a frame on a roll is the frame's override of the roll (contract storedMutations)
    const d = this.doc(f);
    const ms = d ? storedMutations(d, mutations) : mutations;
    const tx = transaction({ id: `c${++this.proposeSeq}`, label, by: o.by ?? 'user', source: o.source ?? { kind: 'studio' }, ...(o.batch ? { batch: o.batch } : {}), mutations: ms });
    this.change(log => log.commit({ doc: f, tx }), label);
  }

  /** The host changes the log directly (a batch from plan, an approval): the store shows what changed. */
  change(f: (log: Log) => Log, label?: string): Log {
    const rt = this.rt ?? fail('the studio is not attached to a runtime');
    rt.store.cancel();
    return rt.store.change(f, label ? { label } : {});
  }

  /**
   * The agent's write, under the mode (host policy): read-only refuses (E_READONLY), ask proposes, auto commits as
   * the agent. One transaction on one frame (the selected one by default); returns the log entry's seq.
   */
  propose(ms: readonly Mutation[], o: { why?: string; frame?: string; tx?: string; label?: string; batch?: string; source?: JsonObject } = {}): number {
    const f = o.frame ?? this.current;
    if (!f || !this.doc(f)) fail('propose: no frame is open');
    if (this.mode === 'read-only') {
      const err = new Error('E_READONLY: the assistant may only look in read-only mode') as Error & { code: string };
      err.code = 'E_READONLY';
      throw err;
    }
    const tx = transaction({
      id: o.tx ?? `eval-${++this.proposeSeq}`, label: o.label ?? o.why ?? 'Agent change', by: 'agent',
      source: o.source ?? { kind: 'agent' }, ...(o.batch ? { batch: o.batch } : {}), mutations: storedMutations(this.doc(f)!, ms),
    });
    const next = this.change(log => (this.mode === 'auto' ? log.commit({ doc: f!, tx }) : log.propose({ doc: f!, tx }, o.why !== undefined ? { why: o.why } : {})));
    return next.last?.seq ?? 0;
  }

  /**
   * Approve a proposal (by its seq; a batch's entry approves the whole batch). `off`: changes the photographer
   * unchecked (indices into its mutations): the proposal is rejected and the checked changes are proposed and
   * approved as one step in its place. E_STALE (the document changed under it) is returned, not thrown.
   */
  approve(seq: number, o: { force?: boolean; off?: readonly number[] } = {}): Approved {
    try {
      this.change(log => {
        const e = log.entry(seq);
        if (!e) return log;
        const off = new Set(o.off ?? []);
        if (!off.size) return log.approve(seq, { by: 'user', ...(o.force ? { force: true } : {}) });
        const ms = e.tx.mutations.filter((_, i) => !off.has(i));
        let next = log.reject(seq);
        if (!ms.length) return next;
        next = next.propose({ doc: e.doc, tx: transaction({ id: `${e.tx.id}-part`, label: e.tx.label, by: e.tx.by, source: e.tx.source, mutations: ms }) }, e.why !== undefined ? { why: e.why } : {});
        return next.approve(next.last!.seq, { by: 'user', ...(o.force ? { force: true } : {}) });
      }, 'Approve Agent Change');
      return { ok: true };
    } catch (err) {
      return { ok: false, diags: diagsOf(err) };
    }
  }
  /** Approve every pending entry of a batch as one step (an agent's look over several frames). */
  approveBatch(batch: string, o: { force?: boolean } = {}): Approved {
    try {
      this.change(log => log.approve({ batch }, { by: 'user', ...(o.force ? { force: true } : {}) }), 'Approve Agent Change');
      return { ok: true };
    } catch (err) {
      return { ok: false, diags: diagsOf(err) };
    }
  }
  reject(seq: number | { batch: string }): void {
    this.change(log => log.reject(seq));
  }

  /** The History panel: move the log's cursor to `cursor` (several undos or redos at once; every document's steps). */
  jump(cursor: number): void {
    const st = this.rt?.store;
    if (!st) return;
    while (st.log.cursor > cursor && st.undo());
    while (st.log.cursor < cursor && st.redo());
  }

  /** the densitometer at a source pixel of the frame's print (print-xyz), as the probe and pins read it */
  async measure(frame: string, doc: Document, x: number, y: number): Promise<{ D: number[]; visual?: number } | null> {
    const e = this.frames.get(frame);
    if (!e) return null;
    const named = this.bridge.lower({ $: 'cb.image', frame, doc, what: 'print', args: {}, expr: 'frame.print()' }).named;
    const m = e.graph.intern('measure.densitometer', [named.id], { at: { x: Math.round(x), y: Math.round(y) }, aperture_px: 3 }).node;
    this.engine.adopt(e.graph.closure(m.id));
    const r = await this.engine.measure(m, { precision: 'preview' });
    return r.value as { D: number[]; visual?: number };
  }

  /** wait for saves and the proposals view (tests) */
  async flush(): Promise<unknown> {
    await new Promise<void>(r => queueMicrotask(r));
    return this.frames.flush();
  }
}

function fail(message: string): never {
  throw Object.assign(new Error(message), { code: 'E_NO_FRAME' });
}

export const createStudio = (o: StudioOptions): Studio => new Studio(o);
export { Coll };
