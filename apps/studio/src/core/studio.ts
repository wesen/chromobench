// The studio core: owns the engine, library, open frame sessions, viewer state, render scheduler,
// probes and gestures. React components subscribe to its stores and call its methods; nothing on
// the pointer path goes through a React render.
import {
  allOps, ChromobenchError, type AgentMode, type Box, type Diagnostic, type Engine, type FrameRecipe, type Graph, type ImageInfo, type LoggedMutation, type Mutation,
  type Node, type SampleData, type Vec3,
} from '@chromobench/contract';
import type { KV } from '../storage/db.ts';
import { thumbPath, type Opfs } from '../storage/opfs.ts';
import type { PickedFile } from '../storage/fsa.ts';
import type { Colours, Presenter, PresentImage, ViewTransform } from '../present/presenter.ts';
import { exportPrint, type ExportedImage, type ExportSpace } from '../host/export.ts';
import { generateControls, type ControlModel } from './controls.ts';
import { diffRecipes, FrameSession, PRINT_SETTINGS, type InitialRecipe, type Snapshot, type ViewMode } from './frame-session.ts';
import { GestureController } from './gesture.ts';
import { LibraryStore, type FrameRecord } from './library.ts';
import { LatestWins, readProbe, type ProbeAt, type ProbeReading } from './probe.ts';
import { draftScale, RenderScheduler, type PresentFrame, type RenderRequest } from './scheduler.ts';
import { Signal, Store } from './store.ts';
import { bandBoxes, stripRecipe, stripValues, type StripVary } from './tools.ts';

export type Tool = 'testStrip' | 'ringAround' | 'contactSheet' | 'mask' | 'exposures';

/** What the host (main.tsx, from host/engines.ts) gives the studio besides the engine (CHB-023). */
export interface StudioHost {
  /** Status-line name of the engine: kind, adapter, working size. */
  label: string;
  /** The automatic first print of a frame opened for the first time (real engines). */
  firstPrint?: (engine: Engine, graph: Graph, defaults: FrameRecipe) => Promise<FrameRecipe>;
  /** Conditioning notes of the last open of a source. */
  notes?: (sha256: string) => string[] | null;
  /** Settings for files opened afterwards. */
  settings?: { dust: boolean };
}

/** One band of the test strip: its value, the document box it covers and the node it prints with. */
export interface StripBand { value: number; box: Box; node: Node }

export interface Viewport { fit: boolean; zoom: number; cx: number; cy: number }

export interface StudioState {
  frameKey: string | null;
  view: ViewMode;
  /** Split position (fraction of the canvas width) for before/after, or null. */
  split: number | null;
  /** What "before" shows: the frame's initial recipe or a snapshot id. */
  compare: string;
  tool: Tool | null;
  strip: { vary: StripVary; step: number; count: number };
  /** Ring-around step in printer points (2, 4 or 8). */
  ringStep: number;
  viewport: Viewport;
  canvas: { w: number; h: number; dpr: number };
  status: string;
  error: string | null;
  rendered: number;
  presenter: string;
  mode: AgentMode;
  probe: ProbeReading | null;
  pinned: Record<string, ProbeReading>;
  classes: Record<string, number> | null;
  focusPath: string;
  offline: 'none' | 'installing' | 'ready';
  updateReady: boolean;
  /** Last E_STALE (or other) refusal per pending tx, for "apply anyway". */
  refused: Record<string, Diagnostic[]>;
  /** The engine in use (status line). */
  engineLabel: string;
  /** Conditioning notes of the open frame. */
  notes: string[];
  busy: string | null;
}

export const FOCUS_DEFAULT = 'print.lights.logH';

export class Studio {
  readonly engine: Engine;
  readonly kv: KV;
  readonly opfs: Opfs | null;
  readonly library: LibraryStore;
  readonly models: ControlModel[] = generateControls(allOps());
  readonly state = new Store<StudioState>({
    frameKey: null, view: 'print', split: null, compare: 'initial', tool: null,
    strip: { vary: 'time', step: 1 / 3, count: 5 }, ringStep: 4,
    viewport: { fit: true, zoom: 1, cx: 0, cy: 0 }, canvas: { w: 0, h: 0, dpr: 1 },
    status: 'no frame', error: null, rendered: 0, presenter: '—', mode: 'ask', probe: null, pinned: {}, classes: null,
    focusPath: FOCUS_DEFAULT, offline: 'none', updateReady: false, refused: {}, engineLabel: '', notes: [], busy: null,
  });
  readonly host: StudioHost;
  /** Bumped on every edit-log event of the open frame (history, controls, pending cards). */
  readonly logSignal = new Signal();
  readonly thumbs = new Store<Record<string, string>>({});
  session: FrameSession | null = null;
  readonly gesture: GestureController;
  readonly scheduler: RenderScheduler;
  private presenter: Presenter | null = null;
  private colours: Colours = { stage: [1, 1, 1], frame: [0.1, 0.1, 0.1] };
  private readonly sessions = new Map<string, FrameSession>();
  private unsub: (() => void) | null = null;
  private readonly probes: LatestWins<ProbeReading>;
  private readonly pins: LatestWins<Record<string, ProbeReading>>;
  private readonly measures: LatestWins<Record<string, number> | null>;
  /** A refusal (E_STALE…) stays in the status line until the log changes, not until the next render. */
  private sticky = false;
  /** The last presented main image (for the pixel hook and the tools). */
  last: { node: string; image: PresentImage } | null = null;

  constructor(engine: Engine, kv: KV, opfs: Opfs | null, host: StudioHost = { label: `${engine.id} engine` }) {
    this.engine = engine;
    this.host = host;
    this.state.update({ engineLabel: host.label });
    this.kv = kv;
    this.opfs = opfs;
    this.library = new LibraryStore(kv, opfs);
    this.gesture = new GestureController(() => this.session?.log ?? null, { onError: (e) => this.report(e) });
    this.gesture.onChange = (active) => {
      if (!active) this.requestRender();
    };
    this.scheduler = new RenderScheduler(() => this.engine, (f) => this.onPresent(f), (e) => this.report(e));
    this.probes = new LatestWins((r) => this.update({ probe: r }), (e) => this.report(e));
    this.pins = new LatestWins((r) => this.update({ pinned: r }), (e) => this.report(e));
    this.measures = new LatestWins((r) => this.update({ classes: r }), (e) => this.report(e));
  }

  get s(): StudioState {
    return this.state.get();
  }

  update(p: Partial<StudioState>): void {
    this.state.update(p);
  }

  model(path: string): ControlModel | undefined {
    return this.models.find((m) => m.path === path);
  }

  report(e: unknown): void {
    const msg = e instanceof ChromobenchError ? `${e.code}: ${e.diag.message}` : e instanceof Error ? e.message : String(e);
    this.update({ error: msg, status: msg });
  }

  async init(): Promise<void> {
    await this.library.load();
    const mode = await this.kv.get<AgentMode>('settings', 'agent-mode');
    if (mode) this.update({ mode });
    void this.loadThumbs();
  }

  // ---- library and frames -----------------------------------------------------------------

  /** Files from the fallback input: used for this session, or imported into OPFS. */
  async addFiles(files: PickedFile[], name: string, how: 'session' | 'import', handle?: FileSystemDirectoryHandle): Promise<void> {
    if (!files.length) {
      this.update({ status: 'no scan files found' });
      return;
    }
    // A file seen before by hash re-attaches its recipe (and reconnects a disconnected session roll).
    await this.library.reattach(files);
    const roll = await this.library.addRoll(name, files, handle ? 'folder' : how, handle);
    const frames = this.library.framesOf(roll.id);
    if (frames[0]) await this.openFrame(frames[0].key);
    void this.makeThumbs(frames);
  }

  async openFrame(key: string): Promise<boolean> {
    const fr = this.library.frame(key);
    if (!fr) return false;
    this.gesture.commit();
    const bytes = this.sessions.has(fr.sha256) ? null : await this.library.bytes(fr);
    let s = this.sessions.get(fr.sha256);
    if (!s) {
      if (!bytes) {
        this.update({ status: `${fr.name} is disconnected: pick the file or folder again`, error: null });
        return false;
      }
      try {
        this.update({ busy: `opening ${fr.name}…`, status: `opening ${fr.name}…` });
        s = await this.openSession(fr, bytes);
      } catch (e) {
        this.report(e);
        return false;
      } finally {
        this.update({ busy: null });
      }
      s.snapshots = (await this.kv.get<Snapshot[]>('snapshots', fr.sha256)) ?? [];
      this.sessions.set(fr.sha256, s);
    }
    this.unsub?.();
    this.session = s;
    s.log.setMode(this.s.mode);
    s.displaySpace = this.presenter?.colorSpace === 'display-p3' ? 'display-p3' : 'srgb';
    this.unsub = s.log.on((e) => {
      if (e.type !== 'preview') {
        this.sticky = false;
        void this.persist(s);
      }
      this.logSignal.bump();
      this.requestRender();
    });
    this.library.selectRoll(fr.rollId);
    this.update({ frameKey: key, error: null, viewport: { ...this.s.viewport, fit: true, cx: s.width / 2, cy: s.height / 2 }, probe: null, classes: null, refused: {}, notes: this.host.notes?.(s.sha) ?? [] });
    this.logSignal.bump();
    this.requestRender();
    return true;
  }

  private async persist(s: FrameSession): Promise<void> {
    await this.library.saveLog(s.sha, s.log.toJSON());
  }

  /** Opens a frame's session: decode in the engine, resume its log by hash, or make its first print. */
  private async openSession(fr: FrameRecord, bytes: Uint8Array): Promise<FrameSession> {
    const fp = this.host.firstPrint;
    const initial: InitialRecipe | undefined = fp ? (d, g) => fp(this.engine, g, d) : undefined;
    const s = await FrameSession.open(this.engine, bytes, fr.name, {
      mode: this.s.mode, saved: await this.library.loadLog(fr.sha256), sha256: fr.sha256, ...(initial ? { initial } : {}),
    });
    if (fp && s.log.toJSON().entries.length === 0) await this.persist(s);
    return s;
  }

  async sessionFor(fr: FrameRecord): Promise<FrameSession | null> {
    const have = this.sessions.get(fr.sha256);
    if (have) return have;
    const bytes = await this.library.bytes(fr);
    if (!bytes) return null;
    const s = await this.openSession(fr, bytes);
    s.displaySpace = this.session?.displaySpace ?? 'srgb';
    this.sessions.set(fr.sha256, s);
    return s;
  }

  async setMode(mode: AgentMode): Promise<void> {
    this.session?.log.setMode(mode);
    this.update({ mode });
    await this.kv.put('settings', 'agent-mode', mode);
  }

  // ---- thumbnails (film strip, contact sheet) ---------------------------------------------

  /** Renders a display node of a session at most `side` pixels on its long side. */
  async renderSmall(s: FrameSession, node: Node, side: number): Promise<PresentImage> {
    const scale = Math.min(1, side / Math.max(s.width, s.height));
    const r = await this.engine.evaluate(node, { scale, precision: 'preview' });
    return { width: r.width, height: r.height, channels: r.info.channels, data: await r.read(), region: r.region, scale: r.scale };
  }

  private async loadThumbs(): Promise<void> {
    if (!this.opfs) return;
    const out: Record<string, string> = {};
    for (const f of this.library.s.frames) {
      const file = await this.opfs.read(thumbPath(f.sha256));
      if (file) out[f.sha256] = URL.createObjectURL(file);
    }
    this.thumbs.set({ ...this.thumbs.get(), ...out });
  }

  async makeThumbs(frames: FrameRecord[]): Promise<void> {
    for (const fr of frames) {
      if (this.thumbs.get()[fr.sha256]) continue;
      try {
        const s = await this.sessionFor(fr);
        if (!s) continue;
        const img = await this.renderSmall(s, s.displayNode(s.log.committed), 160);
        const blob = await imageToPng(img);
        if (!blob) continue;
        if (this.opfs) await this.opfs.write(thumbPath(fr.sha256), blob);
        this.thumbs.set({ ...this.thumbs.get(), [fr.sha256]: URL.createObjectURL(blob) });
      } catch {
        // a file the mock engine cannot decode keeps an empty thumbnail
      }
    }
  }

  // ---- viewer -----------------------------------------------------------------------------

  async attachPresenter(p: Presenter): Promise<void> {
    this.presenter?.dispose();
    this.presenter = p;
    this.update({ presenter: `${p.kind} · ${p.colorSpace} · ${p.format}` });
    for (const s of this.sessions.values()) s.displaySpace = p.colorSpace === 'display-p3' ? 'display-p3' : 'srgb';
    this.requestRender();
  }

  setColours(c: Colours): void {
    this.colours = c;
    this.redraw();
  }

  setCanvas(w: number, h: number, dpr: number): void {
    this.update({ canvas: { w, h, dpr } });
    this.requestRender();
  }

  /** CSS px per document px, honouring Fit. */
  zoom(): number {
    const s = this.session;
    const { w, h, dpr } = this.s.canvas;
    if (!s || !w) return 1;
    if (!this.s.viewport.fit) return this.s.viewport.zoom;
    return (Math.min(w / dpr / s.width, h / dpr / s.height)) * 0.9;
  }

  viewTransform(): ViewTransform | null {
    const s = this.session;
    if (!s) return null;
    const vp = this.s.viewport;
    const fit = vp.fit;
    return { docW: s.width, docH: s.height, cx: fit ? s.width / 2 : vp.cx, cy: fit ? s.height / 2 : vp.cy, zoom: this.zoom(), dpr: this.s.canvas.dpr, split: this.s.split };
  }

  /** Canvas CSS position → document position. */
  toDoc(x: number, y: number): { x: number; y: number } | null {
    const v = this.viewTransform();
    if (!v) return null;
    const { w, h, dpr } = this.s.canvas;
    return { x: (x - w / dpr / 2) / v.zoom + v.cx, y: (y - h / dpr / 2) / v.zoom + v.cy };
  }

  /** Document position → canvas CSS position. */
  toCanvas(x: number, y: number): { x: number; y: number } | null {
    const v = this.viewTransform();
    if (!v) return null;
    const { w, h, dpr } = this.s.canvas;
    return { x: (x - v.cx) * v.zoom + w / dpr / 2, y: (y - v.cy) * v.zoom + h / dpr / 2 };
  }

  setViewport(vp: Partial<Viewport>): void {
    this.update({ viewport: { ...this.s.viewport, ...vp } });
    this.requestRender();
  }

  zoomPreset(z: 'fit' | number): void {
    const s = this.session;
    if (!s) return;
    if (z === 'fit') this.setViewport({ fit: true });
    else {
      const v = this.viewTransform()!;
      this.setViewport({ fit: false, zoom: z / this.s.canvas.dpr, cx: v.cx, cy: v.cy });
    }
  }

  /** Zooms by a factor around a canvas CSS point. */
  zoomAt(factor: number, x: number, y: number): void {
    const v = this.viewTransform();
    const d = this.toDoc(x, y);
    if (!v || !d) return;
    const zoom = Math.min(64, Math.max(0.02, v.zoom * factor));
    const { w, h, dpr } = this.s.canvas;
    this.setViewport({ fit: false, zoom, cx: d.x - (x - w / dpr / 2) / zoom, cy: d.y - (y - h / dpr / 2) / zoom });
  }

  panBy(dx: number, dy: number): void {
    const v = this.viewTransform();
    if (!v) return;
    this.setViewport({ fit: false, zoom: v.zoom, cx: v.cx - dx / v.zoom, cy: v.cy - dy / v.zoom });
  }

  setView(view: ViewMode): void {
    this.update({ view, classes: null });
    this.requestRender();
  }

  setSplit(split: number | null): void {
    this.update({ split });
    this.requestRender();
  }

  setCompare(compare: string): void {
    this.update({ compare });
    this.requestRender();
  }

  setTool(tool: Tool | null): void {
    this.gesture.commit();
    this.update({ tool: this.s.tool === tool ? null : tool });
    this.requestRender();
  }

  setStrip(p: Partial<StudioState['strip']>): void {
    this.update({ strip: { ...this.s.strip, ...p } });
    this.requestRender();
  }

  compareRecipe(): FrameRecipe | null {
    const s = this.session;
    if (!s) return null;
    if (this.s.compare === 'initial') return s.initial;
    return s.snapshots.find((x) => x.id === this.s.compare)?.recipe ?? s.initial;
  }

  /** The test strip's bands on the current state: each prints its own value over its own strip (CHB-023). */
  stripBands(): StripBand[] {
    const s = this.session;
    if (!s) return [];
    const st = this.s.strip;
    const r = s.log.state;
    const base = st.vary === 'time' ? r.print.enlarger.time_s : r.print.enlarger.filtration[st.vary.slice(-1) as 'c' | 'm' | 'y'];
    const values = stripValues(st.vary, base, st.step, st.count);
    const info = s.displayNode(r).info as ImageInfo;
    const boxes = bandBoxes(values.length, info.width, info.height);
    return values.map((value, i) => ({ value, box: boxes[i]!, node: s.displayNode(stripRecipe(st.vary, r, value)) }));
  }

  /** The node the main viewer shows now (tool or view); for the test strip, its first band. */
  mainNode(): Node | null {
    const s = this.session;
    if (!s) return null;
    if (this.s.tool === 'testStrip') return this.stripBands()[0]?.node ?? null;
    return s.viewNode(this.s.view);
  }

  private region(scale: number): RenderRequest['region'] {
    const s = this.session!;
    const v = this.viewTransform()!;
    const { w, h, dpr } = this.s.canvas;
    if (this.s.viewport.fit || !w) return undefined;
    const halfW = (w / dpr / 2 / v.zoom) * 1.1;
    const halfH = (h / dpr / 2 / v.zoom) * 1.1;
    const grid = 256 / scale;
    const x0 = Math.max(0, Math.floor((v.cx - halfW) / grid) * grid);
    const y0 = Math.max(0, Math.floor((v.cy - halfH) / grid) * grid);
    const x1 = Math.min(s.width, Math.ceil((v.cx + halfW) / grid) * grid);
    const y1 = Math.min(s.height, Math.ceil((v.cy + halfH) / grid) * grid);
    if (x1 <= x0 || y1 <= y0) return undefined;
    if (x0 === 0 && y0 === 0 && x1 === s.width && y1 === s.height) return undefined;
    return { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
  }

  requestRender(): void {
    const s = this.session;
    if (!s) return;
    let node: Node | null;
    let before: Node | null = null;
    let bands: StripBand[] | undefined;
    try {
      bands = this.s.tool === 'testStrip' ? this.stripBands() : undefined;
      node = bands ? (bands[0]?.node ?? null) : this.mainNode();
      const cmp = this.compareRecipe();
      if (this.s.split !== null && !this.s.tool && cmp) before = s.viewNode(this.s.view, cmp);
    } catch (e) {
      this.report(e);
      return;
    }
    if (!node) return;
    const { dpr } = this.s.canvas;
    const screen = Math.min(1, this.zoom() * dpr);
    const pass = this.gesture.isActive ? 'draft' : 'screen';
    const region = this.region(screen);
    const scale = pass === 'draft' ? draftScale(screen, region?.w ?? s.width, region?.h ?? s.height) : screen;
    this.scheduler.request({ node, before, pass, scale: scale >= 1 ? 'full' : scale, ...(region ? { region } : {}), tag: this.s.tool ?? this.s.view, ...(bands ? { bands } : {}) });
    this.refreshPins();
    if (this.s.view === 'classes' && !this.s.tool) this.measureClasses();
  }

  private onPresent(f: PresentFrame): void {
    const img = (r: PresentFrame['main']): PresentImage => ({ width: r.result.width, height: r.result.height, channels: r.result.info.channels, data: r.data, region: r.result.region, scale: r.result.scale });
    const main = img(f.main);
    this.last = { node: f.main.result.node, image: main };
    if (this.presenter) {
      this.presenter.setImages(main, f.before ? img(f.before) : null);
      this.redraw();
    }
    const n = this.s.rendered + 1;
    const w = f.main.result.warnings.find((x) => x.code !== 'W_DECODE_NOTE');
    if (this.sticky) this.update({ rendered: n });
    else this.update({ rendered: n, status: `rendered ${n} · ${f.req.pass}${w ? ` · ${w.code}` : ''}`, error: null });
  }

  redraw(): void {
    const v = this.viewTransform();
    if (v && this.presenter && this.last) this.presenter.draw(v, this.colours);
  }

  /** The value of a document pixel in the last presented result (display-encoded floats). */
  pixel(x: number, y: number): number[] | null {
    const l = this.last?.image;
    if (!l) return null;
    const tx = Math.floor((x - l.region.x) * l.scale);
    const ty = Math.floor((y - l.region.y) * l.scale);
    if (tx < 0 || ty < 0 || tx >= l.width || ty >= l.height) return null;
    const i = (ty * l.width + tx) * l.channels;
    return [0, 1, 2].map((k) => l.data[i + Math.min(k, l.channels - 1)]!);
  }

  async canvasPixel(x: number, y: number): Promise<number[] | null> {
    return this.presenter ? this.presenter.readDocPixel(x, y) : null;
  }

  // ---- probes -----------------------------------------------------------------------------

  probeAt(at: ProbeAt | null): void {
    const s = this.session;
    if (!s || !at || at.x < 0 || at.y < 0 || at.x >= s.width || at.y >= s.height) {
      this.update({ probe: null });
      return;
    }
    const p = { x: Math.round(at.x), y: Math.round(at.y), r: at.r };
    this.probes.run((signal) => readProbe(this.engine, s.graph, { printXyz: s.printXyzNode(), dyes: s.chainNode('invert.dyes') }, p, signal));
  }

  pinProbe(name: string, at: ProbeAt): void {
    const id = name.replace(/[^A-Za-z0-9_-]/g, '_') || 'probe';
    this.gesture.set(`probes.${id}`, { x: Math.round(at.x), y: Math.round(at.y), r: at.r }, `Pin probe ${id}`);
  }

  private refreshPins(): void {
    const s = this.session;
    if (!s) return;
    const probes = s.log.state.probes;
    if (!Object.keys(probes).length) {
      if (Object.keys(this.s.pinned).length) this.update({ pinned: {} });
      return;
    }
    this.pins.run(async (signal) => {
      const out: Record<string, ProbeReading> = {};
      const t = { printXyz: s.printXyzNode(), dyes: s.chainNode('invert.dyes') };
      for (const [id, p] of Object.entries(probes)) out[id] = await readProbe(this.engine, s.graph, t, p, signal);
      return out;
    });
  }

  private measureClasses(): void {
    const s = this.session;
    if (!s) return;
    this.measures.run(async (signal) => {
      const dyes = s.chainNode('invert.dyes');
      if (!dyes) return null;
      const n = s.graph.intern('invert.classify', [dyes.id], {}).node;
      this.engine.adopt(s.graph.closure(n.id));
      const m = await this.engine.measure(n, { signal, precision: 'preview' });
      return m.value as Record<string, number>;
    });
  }

  // ---- history, approvals, snapshots ------------------------------------------------------

  undo(): void {
    this.gesture.commit();
    this.session?.log.undo();
  }

  redo(): void {
    this.gesture.commit();
    this.session?.log.redo();
  }

  /** Approves pending entries; E_STALE and other refusals are kept for the card. */
  approve(seqs: number[], tx: string, force = false): boolean {
    const log = this.session?.log;
    if (!log) return false;
    this.gesture.commit();
    const r = log.approve(seqs, { force });
    if (Array.isArray(r)) {
      this.sticky = true;
      this.update({ refused: { ...this.s.refused, [tx]: r }, status: r.map((d) => `${d.code}: ${d.message}`).join('; '), error: r[0]?.code ?? 'refused' });
      this.logSignal.bump();
      return false;
    }
    const { [tx]: _, ...rest } = this.s.refused;
    this.update({ refused: rest, status: `approved ${tx}`, error: null });
    return true;
  }

  reject(seqs: number[], tx: string): void {
    this.session?.log.reject(seqs);
    const { [tx]: _, ...rest } = this.s.refused;
    this.update({ refused: rest });
  }

  /** Agent mutations (stands in for CHB-007/008's EvalHost): one tx, by 'agent'. */
  propose(ms: Mutation[], why?: string): LoggedMutation[] {
    const log = this.session?.log;
    if (!log) throw new Error('no frame');
    return log.propose(ms, { tx: `eval-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`, ...(why ? { why } : {}) });
  }

  async snapshot(name?: string): Promise<Snapshot | null> {
    const s = this.session;
    if (!s) return null;
    const snap = s.snapshot(name ?? String.fromCharCode(65 + (s.snapshots.length % 26)));
    await this.kv.put('snapshots', s.sha, s.snapshots);
    this.logSignal.bump();
    return snap;
  }

  async deleteSnapshot(id: string): Promise<void> {
    const s = this.session;
    if (!s) return;
    s.deleteSnapshot(id);
    await this.kv.put('snapshots', s.sha, s.snapshots);
    if (this.s.compare === id) this.setCompare('initial');
    this.logSignal.bump();
  }

  /** Restores a snapshot as one transaction of mutations (undoable, in the history). */
  restore(id: string): void {
    const s = this.session;
    const snap = s?.snapshots.find((x) => x.id === id);
    if (!s || !snap) return;
    const ms = diffRecipes(s.log.committed, snap.recipe);
    this.gesture.apply(ms, `Restore snapshot ${snap.name}`, `restore-${Date.now().toString(36)}`);
  }

  /** Contact sheet: applies the current print settings to frames, one transaction each, one shared tx id. */
  async applyToFrames(keys: string[]): Promise<number> {
    const cur = this.session;
    if (!cur) return 0;
    const tx = `sheet-${Date.now().toString(36)}`;
    let n = 0;
    for (const key of keys) {
      const fr = this.library.frame(key);
      if (!fr || fr.sha256 === cur.sha) continue;
      const s = await this.sessionFor(fr);
      if (!s) continue;
      const ms = diffRecipes(s.log.committed, cur.log.committed, PRINT_SETTINGS);
      if (!ms.length) continue;
      try {
        s.log.apply(ms, 'user', `Apply settings from ${cur.name} (${keys.length} frames)`, { tx });
        await this.persist(s);
        n++;
      } catch (e) {
        this.report(e);
      }
    }
    this.update({ status: `applied to ${n} frame${n === 1 ? '' : 's'}` });
    return n;
  }

  // ---- export ------------------------------------------------------------------------------

  /** The committed print at working resolution, export precision, as an 8-bit PNG (CHB-023). */
  async exportPng(space: ExportSpace = 'srgb'): Promise<ExportedImage | null> {
    const s = this.session;
    if (!s) return null;
    this.gesture.commit();
    this.update({ busy: 'exporting…', status: 'exporting…', error: null });
    try {
      const x = await exportPrint(this.engine, s.graph, s.log.committed, s.name, space);
      this.update({ status: `exported ${x.fileName} · ${x.width}×${x.height} · ${space === 'srgb' ? 'sRGB' : 'Display P3'} 8-bit` });
      return x;
    } catch (e) {
      this.report(e);
      return null;
    } finally {
      this.update({ busy: null });
    }
  }

  /** The frame's edit log as JSON (the recipe and its history), for saving beside the scan. */
  recipeJson(): { json: string; fileName: string } | null {
    const s = this.session;
    if (!s) return null;
    return { json: JSON.stringify(s.log.toJSON(), null, 2), fileName: `${s.name.replace(/\.[^.]+$/, '')}.chromobench.json` };
  }

  /** Ring-around / test strip helpers: one `set` from a tool click. */
  setLights(v: Vec3, label: string): void {
    this.gesture.set('print.lights.logH', v, label, `ring-${Date.now().toString(36)}`);
  }

  async idle(): Promise<void> {
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 0));
      if (!this.scheduler.busy && !this.probes.busy && !this.pins.busy && !this.measures.busy) return;
      await Promise.all([this.scheduler.idle(), this.probes.idle(), this.pins.idle(), this.measures.idle()]);
    }
  }

  /** How often the engine computed each node of the current display chain (M1 test hook). */
  chainRuns(): { op: string; runs: number }[] {
    const s = this.session;
    const runs = (this.engine as Engine & { runs?: (id: string) => number }).runs;
    if (!s || !runs) return [];
    const top = s.displayNode();
    return s.graph.closure(top.id).map((d) => ({ op: d.op, runs: runs.call(this.engine, s.graph.adopt([d]).at(-1)!.id) }));
  }
}

/** Encodes a display image as PNG (thumbnails). */
async function imageToPng(img: PresentImage): Promise<Blob | null> {
  if (typeof OffscreenCanvas === 'undefined') return null;
  const c = new OffscreenCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const id = ctx.createImageData(img.width, img.height);
  const ch = img.channels;
  for (let i = 0; i < img.width * img.height; i++) {
    for (let k = 0; k < 3; k++) id.data[i * 4 + k] = Math.round(Math.min(1, Math.max(0, (img.data as SampleData)[i * ch + Math.min(k, ch - 1)]!)) * 255);
    id.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  return c.convertToBlob({ type: 'image/png' });
}
