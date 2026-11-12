// The studio's services (guide §7.1 steps 2–6): frames + EditLogs, the EditLog route, the render bridge and
// persistence, handed to app.start / mount as services. Nothing is recorded in the variant: one variant runs
// headless with MockEngine and memoryKV, and in the browser with a real engine and IndexedDB.
//
//   const studio = createStudio({ engine: new MockEngine(), kv: memoryKV() });
//   const rt = app.start(studio.services({ clock }));   // or mount(app, el, studio.services())
//   studio.attach(rt);
//   await studio.open(bytes, 'frame-12.tif');
import type { AgentMode, Engine, FrameRecipe, LoggedMutation, Mutation, OutputSpaceId } from '@chromobench/contract';
import { memoryPersistence, type Runtime, type Services } from '@chromobench/shell';
import { EditLogRoute } from './bridge/editlog-route.ts';
import { asOf, Frames, type FrameEntry, type InitialRecipe, type OpenAs, type OpenOutcome, type SourceOpener } from './bridge/frames.ts';
import type { KV } from './bridge/kv.ts';
import { kvPersistence } from './bridge/persistence.ts';
import { FrameRenderBridge } from './bridge/render-bridge.ts';
import { explainError } from './kit/messages.ts';
import type { CatalogFrame } from './cb.ts';

export interface StudioOptions {
  engine: Engine;
  kv?: KV | null;
  mode?: AgentMode;
  displaySpace?: OutputSpaceId;
  now?: () => number;
  /** the first recipe of a frame opened for the first time (the host's automatic first print, CHB-023) */
  initial?: InitialRecipe;
  /** opens a source as a photo, a negative or as guessed (the host's engine; default: Engine.open as a negative) */
  opener?: SourceOpener;
}

/**
 * What the host page contributes to the studio's menus (CHB-027: the host's top bar folded into File and View).
 * Each action is a command (file.open, file.export, …) that is hidden while the host does not offer it, so a
 * variant's menus name them and a host without them (the dev host, tests) shows nothing.
 */
export interface StudioHost {
  /** File ▸ Open Files… (Mod+O) */
  openFiles?(): unknown;
  /** File ▸ Open Folder… */
  openFolder?(): unknown;
  /** File ▸ Reopen <folder> (the folder used last; `folder` names it) */
  reopenFolder?(): unknown;
  folder?: string | null;
  /** File ▸ Export… (Mod+E): format and colour space in a dialog */
  exportPrint?(): unknown;
  /** File ▸ Save Recipe */
  saveRecipe?(): unknown;
  /** File ▸ Open As ▸ Heal Dust: the host decodes with dust healing */
  dust?(on: boolean): unknown;
  /** View ▸ Layout: the variants and how to switch */
  layouts?: { id: string; label: string }[];
  layout?: string;
  setLayout?(id: string): unknown;
  /** a library frame whose file is not open in this session (after a reload): read it again */
  relink?(id: string): unknown;
}

/** The state flags the host commands read (ui.host): which actions exist, the folder, the layouts. */
export interface HostFlags {
  actions: string[];
  folder: string | null;
  layouts: { id: string; label: string }[];
  layout: string | null;
}

export class Studio {
  readonly engine: Engine;
  readonly kv: KV | null;
  readonly frames: Frames;
  readonly route: EditLogRoute;
  readonly bridge: FrameRenderBridge;
  readonly initial: InitialRecipe | undefined;
  rt: Runtime | null = null;
  /** the host page's actions (menus); set with setHost */
  host: StudioHost | null = null;
  private proposeSeq = 0;
  private stops: (() => void)[] = [];

  constructor(o: StudioOptions) {
    this.engine = o.engine;
    this.kv = o.kv ?? null;
    this.initial = o.initial;
    this.frames = new Frames(o.engine, { kv: this.kv, ...(o.mode ? { mode: o.mode } : {}), ...(o.now ? { now: o.now } : {}), ...(o.opener ? { opener: o.opener } : {}) });
    this.route = new EditLogRoute(this.frames);
    this.bridge = new FrameRenderBridge(this.frames, o.displaySpace ? { displaySpace: o.displaySpace } : {});
  }

  /** what app.start / mount take; extra services (clock, presenter, save, renderers) are merged in */
  services(extra: Services = {}): Services & { studio: Studio } {
    return {
      adapters: { recipes: this.route },
      bridges: [this.bridge],
      persistence: this.kv ? kvPersistence(this.kv) : memoryPersistence(),
      engine: this.engine,
      ...extra,
      studio: this,
    };
  }

  /** connect a started runtime: catalog entries for opened frames, CB-H401 for skipped undo steps */
  attach(rt: Runtime): this {
    this.rt = rt;
    // errors toast in the photographer's words (CHB-027 F7); the diagnostics keep the codes
    rt.explainError = explainError;
    this.stops.push(
      rt.history.on((kind, e) => {
        if (kind === 'skip') rt.diagnostics.info('CB-H401', `Undo skipped "${e.entry.label}": the frame's History already moved past it`, { runtime: true, facts: [`${e.parts.length} EditLog part(s) no longer the last unit in effect`] });
      }),
      this.frames.onAdded(f => this.catalogue(f)),
      this.frames.onRemoved(f => this.uncatalogue(f.id)),
    );
    if (this.host) this.publishHost();
    return this;
  }

  /** the host page's actions: commands in File and View (hidden while absent) */
  setHost(host: StudioHost | null): void {
    this.host = host;
    this.publishHost();
  }
  /** the host flags in ui.host, after the host changed (a folder picked) */
  publishHost(): void {
    const h = this.host;
    const flags: HostFlags = {
      actions: h ? Object.keys(h).filter(k => typeof (h as Record<string, unknown>)[k] === 'function') : [],
      folder: h?.folder ?? null,
      layouts: h?.layouts ?? [],
      layout: h?.layout ?? null,
    };
    this.rt?.store.writeDoc([{ path: ['ui', 'host'], value: flags }], { tier: 'view' });
  }
  detach(): void {
    if (this.rt?.explainError === explainError) this.rt.explainError = null;
    for (const f of this.stops) f();
    this.stops = [];
    this.rt = null;
  }

  private catalogue(f: FrameEntry): void {
    const rt = this.rt;
    if (!rt) return;
    const st = rt.store;
    const writes: { path: string[]; value: unknown }[] = [];
    const cat = st.peek(['catalog']) as { frames: Record<string, CatalogFrame>; order: string[] } | undefined;
    const had = cat?.frames?.[f.id];
    if (!had) {
      const entry: CatalogFrame = { id: f.id, sha256: f.sha, name: f.name, flag: null, stars: 0, label: null, keywords: [], kind: asOf(f.kind) };
      writes.push({ path: ['catalog', 'frames', f.id], value: entry });
    } else if (had.kind !== asOf(f.kind) || had.sha256 !== f.sha) {
      // re-opened in the other mode (or a library entry from an older version): the catalog says how it is open
      writes.push({ path: ['catalog', 'frames', f.id], value: { ...had, sha256: f.sha, kind: asOf(f.kind) } });
    }
    if (!(cat?.order ?? []).includes(f.id)) writes.push({ path: ['catalog', 'order'], value: [...(cat?.order ?? []), f.id] });
    if (writes.length) st.writeDoc(writes, { tier: 'document' });
    if (!st.peek(['ui', 'selection', 'primary'])) st.writeDoc([{ path: ['ui', 'selection'], value: { ids: [f.id], primary: f.id, anchor: f.id } }], { tier: 'view' });
  }

  /** a frame left the studio: out of the catalog, the selection and the store */
  private uncatalogue(id: string): void {
    const rt = this.rt;
    if (!rt) return;
    const st = rt.store;
    const cat = st.peek(['catalog']) as { frames: Record<string, CatalogFrame>; order: string[] } | undefined;
    const writes: { path: string[]; value: unknown }[] = [];
    if (cat?.frames?.[id]) writes.push({ path: ['catalog', 'frames', id], value: undefined });
    if (cat?.order?.includes(id)) writes.push({ path: ['catalog', 'order'], value: cat.order.filter(x => x !== id) });
    if (writes.length) st.writeDoc(writes, { tier: 'document' });
    const sel = st.peek(['ui', 'selection']) as { ids: string[]; primary: string | null; anchor: string | null } | undefined;
    if (sel && (sel.ids.includes(id) || sel.primary === id)) {
      const order = (cat?.order ?? []).filter(x => x !== id);
      const i = (cat?.order ?? []).indexOf(id);
      const next = order[Math.min(Math.max(0, i), order.length - 1)] ?? null;
      const ids = sel.ids.filter(x => x !== id);
      const primary = sel.primary === id ? (ids[0] ?? next) : sel.primary;
      st.writeDoc([{ path: ['ui', 'selection'], value: { ids: ids.length ? ids : primary ? [primary] : [], primary, anchor: primary } }], { tier: 'view' });
    }
  }

  /** open a file's bytes as a photo, a negative or as guessed (resumes its EditLog by SHA-256 and mode) */
  async open(bytes: Uint8Array, name: string, o: { initial?: FrameRecipe | InitialRecipe; as?: OpenAs; read?: () => Promise<Uint8Array> } = {}): Promise<FrameEntry> {
    return (await this.openFile(bytes, name, o)).entry;
  }
  /** open, and say what happened: opened, resumed, already open, or open in the other mode */
  async openFile(bytes: Uint8Array, name: string, o: { initial?: FrameRecipe | InitialRecipe; as?: OpenAs; read?: () => Promise<Uint8Array> } = {}): Promise<{ entry: FrameEntry; outcome: OpenOutcome }> {
    const initial = o.initial ?? this.initial;
    return this.frames.openFile(bytes, name, { ...(initial ? { initial } : {}), ...(o.as ? { as: o.as } : {}), ...(o.read ? { read: o.read } : {}) });
  }
  /** re-open a frame as a photo or as a negative (F3, F6): decoded again, that mode's recipe */
  async reopen(id: string, as: 'photo' | 'negative'): Promise<{ entry: FrameEntry; outcome: OpenOutcome }> {
    this.route.endBurst();
    return this.frames.reopen(id, as, this.initial ? { initial: this.initial } : {});
  }
  /** take frames out of the library (their recipes stay saved: opening the file again resumes them) */
  remove(ids: string[]): void {
    this.route.endBurst();
    for (const id of ids) {
      if (this.frames.get(id)) this.frames.remove(id);
      else this.uncatalogue(id); // a library entry not open in this session
    }
  }

  get current(): string | null {
    return (this.rt?.store.peek(['ui', 'selection', 'primary']) as string | null) ?? null;
  }

  /** stands in for CHB-008's agent: propose mutations on a frame (default the selected one) */
  propose(ms: Mutation[], o: { why?: string; frame?: string; tx?: string } = {}): LoggedMutation[] {
    const id = o.frame ?? this.current;
    const e = id ? this.frames.get(id) : undefined;
    if (!e) throw new Error('propose: no frame');
    return e.log.propose(ms, { tx: o.tx ?? `eval-${++this.proposeSeq}`, ...(o.why ? { why: o.why } : {}) });
  }

  /** the densitometer at a source pixel of the frame's print (print-xyz), as the probe and pins read it */
  async measure(frame: string, recipe: FrameRecipe, x: number, y: number): Promise<{ D: number[]; visual?: number } | null> {
    const e = this.frames.get(frame);
    if (!e) return null;
    const named = this.bridge.lower({ $: 'cb.image', frame, recipe, what: 'print', args: {}, expr: 'frame.print()' }).named;
    const m = e.graph.intern('measure.densitometer', [named.id], { at: { x: Math.round(x), y: Math.round(y) }, aperture_px: 3 }).node;
    this.engine.adopt(e.graph.closure(m.id));
    const r = await this.engine.measure(m, { precision: 'preview' });
    return r.value as { D: number[]; visual?: number };
  }

  /** wait for log writes (tests) */
  flush(): Promise<unknown> {
    return this.frames.flush();
  }
}

export const createStudio = (o: StudioOptions): Studio => new Studio(o);
