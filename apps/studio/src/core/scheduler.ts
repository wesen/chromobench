// RenderScheduler (guide §5.6): at most one evaluation in flight and one waiting slot that holds
// only the newest request. Superseded in-flight work is aborted (EvalTarget.signal); results are
// presented only in increasing request order, so the picture never steps backwards.
import { ChromobenchError, fail, type Box, type Engine, type ImageResult, type NodeRef, type SampleData } from '@chromobench/contract';

export type Pass = 'draft' | 'screen' | 'refine';

export interface RenderRequest {
  node: NodeRef;
  /** Second image for before/after (same target). */
  before?: NodeRef | null;
  pass: Pass;
  scale: number | 'full';
  region?: Box;
  /** Free-form tag carried to the presenter (view mode, tool). */
  tag?: string;
  /**
   * A composite of bands (CHB-023 test strip): each band's node is evaluated over its own box only,
   * as each strip of paper gets its own exposure, and the results are placed side by side.
   */
  bands?: Band[];
}

export interface Band {
  node: NodeRef;
  /** Document box the band covers. */
  box: Box;
}

export interface Rendered {
  result: ImageResult;
  data: SampleData;
}

export interface PresentFrame {
  gen: number;
  req: RenderRequest;
  main: Rendered;
  before: Rendered | null;
}

export interface SchedulerStats {
  requests: number;
  evaluations: number;
  presented: number;
  aborted: number;
}

const keyOf = (r: RenderRequest): string => {
  const g = r.region;
  const bands = r.bands ? r.bands.map((b) => b.node.id.slice(0, 12)).join(',') : '';
  return `${r.node.id}|${r.before?.id ?? ''}|${r.scale}|${g ? `${g.x},${g.y},${g.w},${g.h}` : ''}|${bands}`;
};

const intersect = (a: Box, b: Box): Box | null => {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
};

/** Evaluates bands over their boxes and places them in one image covering `region` (or the whole node). */
export async function evaluateBands(engine: Engine, bands: Band[], target: { scale: number | 'full'; region?: Box; precision: 'preview' | 'export'; signal?: AbortSignal }): Promise<Rendered> {
  const first = bands[0]!;
  const info = first.node.info as { width: number; height: number };
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

export class RenderScheduler {
  private gen = 0;
  private shownGen = 0;
  private waiting: { gen: number; req: RenderRequest } | null = null;
  private inflight: { gen: number; ctl: AbortController; key: string } | null = null;
  private idleWaiters: (() => void)[] = [];
  readonly stats: SchedulerStats = { requests: 0, evaluations: 0, presented: 0, aborted: 0 };
  private readonly engine: () => Engine;
  private readonly present: (f: PresentFrame) => void;
  private readonly onError: (e: unknown) => void;

  constructor(engine: () => Engine, present: (f: PresentFrame) => void, onError: (e: unknown) => void = () => {}) {
    this.engine = engine;
    this.present = present;
    this.onError = onError;
  }

  get busy(): boolean {
    return this.inflight !== null || this.waiting !== null;
  }

  /** Generation of the result on screen. */
  get shown(): number {
    return this.shownGen;
  }

  request(req: RenderRequest): number {
    const gen = ++this.gen;
    this.stats.requests++;
    this.waiting = { gen, req };
    if (this.inflight && this.inflight.key !== keyOf(req)) {
      this.inflight.ctl.abort();
      this.stats.aborted++;
    }
    queueMicrotask(() => void this.pump());
    return gen;
  }

  /** Resolves when nothing is in flight or waiting. */
  idle(): Promise<void> {
    if (!this.busy) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  private async evaluate(node: NodeRef, req: RenderRequest, signal: AbortSignal): Promise<Rendered> {
    this.stats.evaluations++;
    const result = await this.engine().evaluate(node, {
      scale: req.scale, precision: 'preview', signal, ...(req.region ? { region: req.region } : {}),
    });
    const data = await result.read();
    return { result, data };
  }

  private async pump(): Promise<void> {
    if (this.inflight || !this.waiting) {
      this.settle();
      return;
    }
    const { gen, req } = this.waiting;
    this.waiting = null;
    const ctl = new AbortController();
    this.inflight = { gen, ctl, key: keyOf(req) };
    try {
      const main = req.bands?.length
        ? (this.stats.evaluations++, await evaluateBands(this.engine(), req.bands, { scale: req.scale, precision: 'preview', signal: ctl.signal, ...(req.region ? { region: req.region } : {}) }))
        : await this.evaluate(req.node, req, ctl.signal);
      const before = req.before ? await this.evaluate(req.before, req, ctl.signal) : null;
      if (!ctl.signal.aborted && gen > this.shownGen) {
        this.shownGen = gen;
        this.stats.presented++;
        this.present({ gen, req, main, before });
      }
    } catch (e) {
      const cancelled = e instanceof ChromobenchError && e.code === 'E_CANCELLED';
      if (!cancelled && !ctl.signal.aborted) this.onError(e);
    } finally {
      this.inflight = null;
      if (this.waiting) void this.pump();
      else this.settle();
    }
  }

  private settle(): void {
    if (this.busy) return;
    const ws = this.idleWaiters;
    this.idleWaiters = [];
    for (const w of ws) w();
  }
}

/** Largest scale at which `region` stays under `maxPixels` (draft passes, guide §5.6: ≈ 0.5 MP). */
export function draftScale(screenScale: number, w: number, h: number, maxPixels = 500_000): number {
  const fit = Math.sqrt(maxPixels / Math.max(1, w * h));
  return Math.max(1 / 64, Math.min(screenScale, fit, 1));
}
