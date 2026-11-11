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
import { Frames, type FrameEntry } from './bridge/frames.ts';
import type { KV } from './bridge/kv.ts';
import { kvPersistence } from './bridge/persistence.ts';
import { FrameRenderBridge } from './bridge/render-bridge.ts';
import type { CatalogFrame } from './cb.ts';

export interface StudioOptions {
  engine: Engine;
  kv?: KV | null;
  mode?: AgentMode;
  displaySpace?: OutputSpaceId;
  now?: () => number;
}

export class Studio {
  readonly engine: Engine;
  readonly kv: KV | null;
  readonly frames: Frames;
  readonly route: EditLogRoute;
  readonly bridge: FrameRenderBridge;
  rt: Runtime | null = null;
  private proposeSeq = 0;
  private stops: (() => void)[] = [];

  constructor(o: StudioOptions) {
    this.engine = o.engine;
    this.kv = o.kv ?? null;
    this.frames = new Frames(o.engine, { kv: this.kv, ...(o.mode ? { mode: o.mode } : {}), ...(o.now ? { now: o.now } : {}) });
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
    this.stops.push(
      rt.history.on((kind, e) => {
        if (kind === 'skip') rt.diagnostics.info('CB-H401', `Undo skipped "${e.entry.label}": the frame's History already moved past it`, { runtime: true, facts: [`${e.parts.length} EditLog part(s) no longer the last unit in effect`] });
      }),
      this.frames.onAdded(f => this.catalogue(f)),
    );
    return this;
  }
  detach(): void {
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
    if (!cat?.frames?.[f.id]) {
      const entry: CatalogFrame = { id: f.id, sha256: f.sha, name: f.name, flag: null, stars: 0, label: null, keywords: [] };
      writes.push({ path: ['catalog', 'frames', f.id], value: entry });
    }
    if (!(cat?.order ?? []).includes(f.id)) writes.push({ path: ['catalog', 'order'], value: [...(cat?.order ?? []), f.id] });
    if (writes.length) st.writeDoc(writes, { tier: 'document' });
    if (!st.peek(['ui', 'selection', 'primary'])) st.writeDoc([{ path: ['ui', 'selection'], value: { ids: [f.id], primary: f.id, anchor: f.id } }], { tier: 'view' });
  }

  /** open a negative's bytes (resumes its EditLog by SHA-256) */
  async open(bytes: Uint8Array, name: string, o: { initial?: FrameRecipe } = {}): Promise<FrameEntry> {
    return this.frames.open(bytes, name, o);
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
