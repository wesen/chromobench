// The render bridge (guide §5.2; contract 1.0): a frame handle → compile(doc) in the frame's graph (the one
// compiler) → the cut the handle names → what is shown (display RGB: the display cut, or an inspection view) →
// Engine.evaluate at the size the viewport asks → PresentImage. Keys are node ids, so equal documents mean equal
// keys (content addressing) and the shell's queue and thumbnail cache dedupe by node. The engine is injected
// (MockEngine in tests and the dev host; the reference engine and the GPU engine in the studio).
import { set } from '@chromobench/values';
import { compile, cutNode, documentKind, edit, fail, type Box, type Document, type Engine, type ImageInfo, type ImageResult, type LinkContext, type Node, type OutputSpaceId, type SampleData } from '@chromobench/contract';
import { strip, type PresentImage, type RenderBridge, type RenderTarget, type Rendered } from '@chromobench/shell';
import { cutOf, effectiveDoc, isImageHandle, type ImageHandle } from '../handles.ts';
import { bandBoxes, stripBase, stripMutation, stripValues, type StripVary } from '../model/tools.ts';
import type { FrameEntry, Frames } from './frames.ts';

export interface Lowered {
  /** the cut the handle names (frame.print() → the print cut, view.adapt), for vocabulary parity */
  named: Node;
  /** what is shown: display-referred */
  shown: Node;
  /** the test strip (CHB-023): each band an ordinary print of the frame with its own value, over its own box */
  bands?: Band[];
}

export interface Band {
  value: number;
  box: Box;
  node: Node;
}

const intersect = (a: Box, b: Box): Box | null => {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
};

/**
 * The test strip as one image: each band's print evaluated over its own box (within `region`), pasted
 * side by side. The bands are ordinary print nodes, so the strip runs on any engine that prints (CHB-023:
 * darkroom.testStrip takes only the dyes and cannot know the enlarger settings).
 */
export async function evaluateBands(engine: Engine, bands: readonly Pick<Band, 'box' | 'node'>[], target: { scale: number | 'full'; region?: Box; precision: 'preview' | 'export'; signal?: AbortSignal }): Promise<{ result: ImageResult; data: SampleData }> {
  const first = bands[0] ?? fail('E_ARG_RANGE', 'a test strip needs at least one band');
  const info = first.node.info as ImageInfo;
  const region = target.region ?? { x: 0, y: 0, w: info.width, h: info.height };
  const parts: { box: Box; r: ImageResult; data: SampleData }[] = [];
  for (const b of bands) {
    const box = intersect(b.box, region);
    if (!box) continue;
    const r = await engine.evaluate(b.node, { scale: target.scale, precision: target.precision, region: box, ...(target.signal ? { signal: target.signal } : {}) });
    parts.push({ box, r, data: await r.read() });
  }
  const p0 = parts[0] ?? fail('E_ARG_RANGE', 'no band lies in the region');
  const scale = p0.r.scale;
  const c = p0.r.info.channels;
  const W = Math.max(1, Math.round(region.w * scale)), H = Math.max(1, Math.round(region.h * scale));
  // the parts' sample type, so a band is bit-identical to the print it stands for
  const out = p0.data instanceof Float64Array ? new Float64Array(W * H * c) : new Float32Array(W * H * c);
  for (const p of parts) {
    const ox = Math.round((p.box.x - region.x) * scale), oy = Math.round((p.box.y - region.y) * scale);
    for (let y = 0; y < p.r.height && oy + y < H; y++) {
      for (let x = 0; x < p.r.width && ox + x < W; x++) {
        for (let k = 0; k < c; k++) out[((oy + y) * W + ox + x) * c + k] = p.data[(y * p.r.width + x) * c + k]!;
      }
    }
  }
  const result: ImageResult = {
    node: p0.r.node, info: p0.r.info, scale, region: { ...region }, width: W, height: H, format: out instanceof Float64Array ? 'f64' : 'f32',
    read: async () => out.slice(), warnings: parts.flatMap((p) => p.r.warnings),
  };
  return { result, data: out };
}

const NO_LINKS: LinkContext = Object.freeze({});

/**
 * What an engine that keeps GPU textures per frame understands (CHB-041; the GPU engine, through the studio's engine):
 * the frames on screen by their source hash (their textures go last when memory runs short), and frames closed (their
 * textures go now). Structural: an engine without it keeps nothing per frame.
 */
export interface ResidencyHint {
  resident?(o: { pinned: readonly string[]; dropped?: readonly string[] }): void;
}

export class FrameRenderBridge implements RenderBridge<ImageHandle> {
  readonly id = 'chromobench';
  readonly frames: Frames;
  displaySpace: OutputSpaceId;
  /** evaluations started, by shown node id (CHB-009's chainRuns, for tests and the lab's node panel) */
  readonly runs = new Map<string, number>();
  /** lowered handles per link context (rolls, presets: a roll change re-lowers every frame) and per document */
  private readonly cache = new WeakMap<LinkContext, WeakMap<Document, Map<string, Lowered>>>();
  /**
   * Adaptive drafts (CHB-027, F4): when set, a draft pass (a slider drag) is sized to take about this many ms on
   * this engine, from the speed measured on earlier renders, between draftMinPixels and the viewport's draft
   * size. A slow engine (the reference engine on the CPU) then shows coarse drafts while the hand moves and the
   * full screen render after. null: the viewport's draft size.
   */
  draftTargetMs: number | null = null;
  draftMinPixels = 30_000;
  /** Measured engine speed in result pixels per ms, smoothed over renders that took ≥ 20 ms (NaN: none yet). */
  pxPerMs = NaN;

  /** The scale of a draft under the time budget, on half-octave steps (so successive drafts share one sample grid). */
  draftScale(scale: number, area: number): number {
    if (this.draftTargetMs === null || area <= 0) return scale;
    const budget = Number.isFinite(this.pxPerMs) ? Math.max(this.draftMinPixels, this.pxPerMs * this.draftTargetMs) : this.draftMinPixels;
    const s = Math.sqrt(budget / area);
    if (s >= scale) return scale;
    return Math.min(scale, 2 ** (Math.floor(2 * Math.log2(s)) / 2));
  }

  /** Folds a render's speed into the estimate. */
  measured(pixels: number, ms: number): void {
    if (ms < 20 || pixels <= 0) return;
    const rate = pixels / ms;
    this.pxPerMs = Number.isFinite(this.pxPerMs) ? 0.6 * this.pxPerMs + 0.4 * rate : rate;
  }

  constructor(frames: Frames, o: { displaySpace?: OutputSpaceId } = {}) {
    this.frames = frames;
    this.displaySpace = o.displaySpace ?? 'srgb';
    // a frame closed: its textures go now, unless another open frame shows the same file (a strip)
    frames.onRemoved((e) => {
      for (const [slot, sha] of this.onScreen) if (sha === e.sha && !frames.bySha(sha)) this.onScreen.delete(slot);
      this.pin(frames.bySha(e.sha) ? [] : [e.sha]);
    });
  }

  // ── residency (CHB-041) ──
  // The frames on screen are those of the viewports' slots (vp:<id>:after, :before, :cover: the viewer's frame) and of
  // the thumbnails being drawn (thumb:… while their render runs); the engine lets their textures go last.
  private readonly onScreen = new Map<string, string>();
  private readonly drawing = new Map<string, number>();
  private pinnedKey = '';
  /** The frames on screen now (source hashes), as the engine was last told. */
  get pinned(): string[] {
    return this.pinnedKey ? this.pinnedKey.split(',') : [];
  }
  private pin(dropped: readonly string[] = []): void {
    const shas = [...new Set([...this.onScreen.values(), ...this.drawing.keys()])].sort();
    const key = shas.join(',');
    if (key === this.pinnedKey && !dropped.length) return;
    this.pinnedKey = key;
    (this.engine as Engine & ResidencyHint).resident?.({ pinned: shas, ...(dropped.length ? { dropped } : {}) });
  }
  /** a render starts in a slot: the viewer's frame is on screen; a thumbnail's while it is drawn. Returns the end. */
  private onScreenFor(slot: string, sha: string): () => void {
    if (slot.startsWith('vp:')) {
      this.onScreen.set(slot, sha);
      this.pin();
      return () => undefined;
    }
    this.drawing.set(sha, (this.drawing.get(sha) ?? 0) + 1);
    this.pin();
    return () => {
      const n = (this.drawing.get(sha) ?? 1) - 1;
      if (n > 0) this.drawing.set(sha, n);
      else this.drawing.delete(sha);
      this.pin();
    };
  }
  get engine(): Engine {
    return this.frames.engine;
  }

  isRenderable(x: unknown): x is ImageHandle {
    return isImageHandle(x) && !!this.frames.get(x.frame);
  }
  /** which picture a handle shows (CHB-041): its frame — a failed render of another frame never leaves this one's picture up */
  ident(h: ImageHandle): string {
    return h.frame;
  }
  key(h: ImageHandle): string {
    const l = this.lower(h);
    return l.bands ? `strip:${l.bands.map(b => b.node.id.slice(0, 16)).join(':')}` : l.shown.id;
  }
  /** the test strip's bands of a handle (values, boxes, nodes), or null */
  bands(h: ImageHandle): Band[] | null {
    return this.lower(h).bands ?? null;
  }
  /** the shown node's size: a crop or a quarter-turn (the document's geometry, CHB-022) changes it from the frame's */
  naturalSize(h: ImageHandle): [number, number] | null {
    const e = this.frames.get(h.frame);
    if (!e) return null;
    const info = this.lower(h).shown.info as ImageInfo;
    return [info.width, info.height];
  }
  explain(h: ImageHandle): string {
    const l = this.lower(h);
    return `${h.expr} → ${l.named.op} ${l.named.id.slice(0, 8)} → ${l.shown.op} ${l.shown.id.slice(0, 8)}`;
  }

  private entry(h: ImageHandle): FrameEntry {
    const e = this.frames.get(h.frame);
    if (!e) throw new Error(`frame ${h.frame} is not open`);
    return e;
  }
  /** the document a handle compiles ('initial': the document as the frame was opened, from the log) */
  docOf(h: ImageHandle): Document {
    // a handle made in a cell holds the state's read-only proxy of the document: the plain document underneath
    if (h.doc !== 'initial' && h.doc !== 'committed') return strip(h.doc);
    const e = this.entry(h);
    return (h.doc === 'initial' ? this.initialDoc?.(h.frame) : this.committedDoc?.(h.frame)) ?? e.first;
  }
  /** the log's initial document of a frame (the Studio sets it; without one, the frame's first document) */
  initialDoc: ((f: string) => Document | undefined) | null = null;
  /** the log's current document of a frame, without drafts (the Studio sets it) */
  committedDoc: ((f: string) => Document | undefined) | null = null;
  /** the shared data links resolve against (the Studio sets it: linksOf(state)); one object while it is unchanged */
  links: (() => LinkContext) | null = null;

  lower(h: ImageHandle): Lowered {
    const e = this.entry(h);
    const base = this.docOf(h);
    const k = `${h.what}|${JSON.stringify(h.args)}|${this.displaySpace}`;
    const links = this.links?.() ?? NO_LINKS;
    let docs = this.cache.get(links);
    if (!docs) this.cache.set(links, (docs = new WeakMap()));
    let per = docs.get(base);
    const hit = per?.get(k);
    if (hit) return hit;
    const d = effectiveDoc(h, base);
    const g = e.graph;
    const c = compile(d, g, { displaySpace: this.displaySpace, links });
    const top = c.display;
    const I = (op: string, inputs: string[], args: Record<string, unknown>): Node => g.intern(op, inputs, args).node;
    const kind = documentKind(d);
    let out: Lowered;
    switch (h.what) {
      case 'print':
      case 'ringTile':
      case 'finished':
      case 'display':
        out = { named: cutNode(c, cutOf(h, kind)), shown: top };
        break;
      case 'negative': {
        const n = cutNode(c, 'negative');
        out = { named: n, shown: I('view.inspect', [n.id], { mode: 'dyes' }) };
        break;
      }
      case 'source':
      case 'scan': {
        const src = cutNode(c, 'source');
        out = { named: cutNode(c, cutOf(h, kind)), shown: I('view.inspect', [src.id], { mode: 'negative' }) };
        break;
      }
      case 'view': {
        const mode = h.args['mode'] as string;
        const n = cutNode(c, 'negative');
        if (mode === 'negative') out = { named: n, shown: I('view.inspect', [cutNode(c, 'source').id], { mode: 'negative' }) };
        else if (mode === 'dyes') out = { named: n, shown: I('view.inspect', [n.id], { mode: 'dyes' }) };
        else {
          const cls = I('invert.classes', [n.id], {});
          out = { named: cls, shown: I('view.inspect', [cls.id], { mode: 'classes' }) };
        }
        break;
      }
      case 'mask': {
        // the mask overlay (CHB-039): the entry's coverage node, put where the picture is by the display's geometry
        const n = c.coverage(h.args['entry'] as string) ?? fail('E_ARG_RANGE', `${String(h.args['entry'])} acts through no mask`);
        out = { named: n, shown: I('output.frame', [n.id], top.args) };
        break;
      }
      case 'testStrip': {
        const a = h.args as { vary: StripVary; step: number; count: number };
        const values = stripValues(a.vary, stripBase(a.vary, d), a.step, a.count);
        const info = top.info as ImageInfo;
        const boxes = bandBoxes(values.length, info.width, info.height);
        const bands = values.map((value, i) => {
          const m = stripMutation(a.vary, d, value);
          const band = compile(edit(d, [set(m.path, m.value)]).doc, g, { displaySpace: this.displaySpace, links });
          return { value, box: boxes[i]!, node: band.display, named: cutNode(band, 'print') };
        });
        out = { named: bands[0]!.named, shown: bands[0]!.node, bands: bands.map(({ value, box, node }) => ({ value, box, node })) };
        break;
      }
    }
    if (!per) docs.set(base, (per = new Map()));
    per.set(k, out);
    return out;
  }

  async render(h: ImageHandle, t: RenderTarget): Promise<Rendered> {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const e = this.entry(h);
    const { shown, bands } = this.lower(h);
    for (const n of bands ? bands.map(b => b.node) : [shown]) this.engine.adopt(e.graph.closure(n.id));
    const W = (shown.info as ImageInfo).width;
    const H = (shown.info as ImageInfo).height;
    const region = t.region;
    const side = region ? Math.max(region.w, region.h) : Math.max(W, H);
    let scale = Math.min(1, t.maxSide / side);
    if (t.pass === 'draft' && !bands) scale = this.draftScale(scale, region ? region.w * region.h : W * H);
    this.runs.set(shown.id, (this.runs.get(shown.id) ?? 0) + 1);
    const target = { scale: scale >= 1 ? ('full' as const) : scale, precision: 'preview' as const, signal: t.signal, ...(region ? { region } : {}) };
    let res: ImageResult;
    let data: SampleData;
    const drawn = this.onScreenFor(t.slot ?? '', e.sha);
    try {
      if (bands) ({ result: res, data } = await evaluateBands(this.engine, bands, target));
      else {
        res = await this.engine.evaluate(shown, target);
        data = await res.read();
      }
    } finally {
      drawn();
    }
    if (t.signal.aborted) throw new DOMException('aborted', 'AbortError');
    const image: PresentImage = { width: res.width, height: res.height, channels: res.info.channels, data, region: res.region, scale: res.scale };
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!bands && h.what !== 'mask') this.measured(res.width * res.height, now - t0);
    return { image, srcW: W, srcH: H, ms: now - t0 };
  }
}
