// The render bridge (guide §5.2): a frame handle → compile(recipe) in the frame's graph → the node the handle
// names → display-referred for the presenter → Engine.evaluate at the size the viewport asks → PresentImage.
// Keys are node ids, so equal recipes mean equal keys (content addressing) and the shell's queue and thumbnail
// cache dedupe by node. The engine is injected (MockEngine in tests and the dev host; RefEngine / GpuEngine later).
import { compile, type Engine, type FrameRecipe, type Node, type OutputSpaceId } from '@chromobench/contract';
import type { PresentImage, RenderBridge, RenderTarget, Rendered } from '@chromobench/shell';
import { effectiveRecipe, isImageHandle, type ImageHandle } from '../handles.ts';
import { testStripArgs, type StripVary } from '../model/tools.ts';
import type { FrameEntry, Frames } from './frames.ts';

export interface Lowered {
  /** the node the handle names (frame.print() → view.adapt), for vocabulary parity */
  named: Node;
  /** what is shown: display-referred */
  shown: Node;
}

export class FrameRenderBridge implements RenderBridge<ImageHandle> {
  readonly id = 'chromobench';
  readonly frames: Frames;
  displaySpace: OutputSpaceId;
  /** evaluations started, by shown node id (CHB-009's chainRuns, for tests and the lab's node panel) */
  readonly runs = new Map<string, number>();
  private readonly cache = new WeakMap<FrameRecipe, Map<string, Lowered>>();

  constructor(frames: Frames, o: { displaySpace?: OutputSpaceId } = {}) {
    this.frames = frames;
    this.displaySpace = o.displaySpace ?? 'srgb';
  }
  get engine(): Engine {
    return this.frames.engine;
  }

  isRenderable(x: unknown): x is ImageHandle {
    return isImageHandle(x) && !!this.frames.get(x.frame);
  }
  key(h: ImageHandle): string {
    return this.lower(h).shown.id;
  }
  naturalSize(h: ImageHandle): [number, number] | null {
    const e = this.frames.get(h.frame);
    return e ? [e.info.width, e.info.height] : null;
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
  private cut(e: FrameEntry, top: Node, op: string): Node {
    let found: Node | undefined;
    for (const d of e.graph.closure(top.id)) if (d.op === op) found = e.graph.adopt([d])[0];
    if (!found) throw new Error(`compiled chain has no ${op}`);
    return found;
  }

  lower(h: ImageHandle): Lowered {
    const e = this.entry(h);
    const base = h.recipe === 'initial' ? e.initial : h.recipe;
    const k = `${h.what}|${JSON.stringify(h.args)}|${this.displaySpace}`;
    let per = this.cache.get(base);
    const hit = per?.get(k);
    if (hit) return hit;
    const r = effectiveRecipe(h, base);
    const g = e.graph;
    const top = compile(r, g, { displaySpace: this.displaySpace });
    const I = (op: string, inputs: string[], args: Record<string, unknown>): Node => g.intern(op, inputs, args).node;
    const displayOf = (n: Node): Node => I('output.display', [n.id], { space: this.displaySpace, rendering: r.view.output.rendering, knee: r.view.output.display.knee.method });
    const dyes = (): Node => (r.kind === 'negative-scan' ? this.cut(e, top, 'invert.dyes') : this.cut(e, top, 'film.grain'));
    let out: Lowered;
    switch (h.what) {
      case 'print':
      case 'ringTile':
        out = { named: this.cut(e, top, 'view.adapt'), shown: top };
        break;
      case 'display':
        out = { named: top, shown: top };
        break;
      case 'negative': {
        const d = dyes();
        out = { named: d, shown: I('view.inspect', [d.id], { mode: 'dyes' }) };
        break;
      }
      case 'source':
      case 'scan': {
        const src = this.cut(e, top, 'source.open');
        const named = h.what === 'scan' ? e.graph.get(dyes().inputs[0]!)! : src;
        out = { named, shown: I('view.inspect', [src.id], { mode: 'negative' }) };
        break;
      }
      case 'view': {
        const mode = h.args['mode'] as string;
        const d = dyes();
        if (mode === 'negative') out = { named: d, shown: I('view.inspect', [this.cut(e, top, 'source.open').id], { mode: 'negative' }) };
        else if (mode === 'dyes') out = { named: d, shown: I('view.inspect', [d.id], { mode: 'dyes' }) };
        else {
          const cls = I('invert.classes', [d.id], {});
          out = { named: cls, shown: I('view.inspect', [cls.id], { mode: 'classes' }) };
        }
        break;
      }
      case 'testStrip': {
        const a = h.args as { vary: StripVary; step: number; count: number };
        const strip = I('darkroom.testStrip', [dyes().id], testStripArgs(a.vary, a.step, a.count));
        out = { named: strip, shown: displayOf(strip) };
        break;
      }
    }
    if (!per) this.cache.set(base, (per = new Map()));
    per.set(k, out);
    return out;
  }

  async render(h: ImageHandle, t: RenderTarget): Promise<Rendered> {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const e = this.entry(h);
    const { shown } = this.lower(h);
    this.engine.adopt(e.graph.closure(shown.id));
    const W = e.info.width;
    const H = e.info.height;
    const region = t.region;
    const side = region ? Math.max(region.w, region.h) : Math.max(W, H);
    const scale = Math.min(1, t.maxSide / side);
    this.runs.set(shown.id, (this.runs.get(shown.id) ?? 0) + 1);
    const res = await this.engine.evaluate(shown, { scale: scale >= 1 ? 'full' : scale, precision: 'preview', signal: t.signal, ...(region ? { region } : {}) });
    const data = await res.read();
    if (t.signal.aborted) throw new DOMException('aborted', 'AbortError');
    const image: PresentImage = { width: res.width, height: res.height, channels: res.info.channels, data, region: res.region, scale: res.scale };
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return { image, srcW: W, srcH: H, ms: now - t0 };
  }
}
