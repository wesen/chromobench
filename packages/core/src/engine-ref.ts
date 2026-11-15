// The reference engine (guide §5.7): implements the contract's Engine with core's f64 physics.
// Slow but exact. Full-resolution results are cached per node id; previews and regions are sampled
// from them (nearest sample, as the mock), so a region is bit-identical to the crop of the full result.
// Modes 'exact' and 'tabulated' (f64 tables through look3, the GPU preview's reference).
import {
  ChromobenchError, fail, getOp, Graph, gridAxis, nodeSlots, quantizeScale, sha256Hex,
  type Box, type Diagnostic, type Domain, type Engine, type EngineCaps, type EvalTarget, type ImageInfo, type ImageResult,
  type Measurement, type MeasureSpec, type Node, type NodeDef, type NodeRef, type SourceInfo, type SourceRef, type TableKey,
} from '@chromobench/contract';
import { readTiffCodes } from '@chromobench/ingest';
import type { PhysicsData } from './data/provider.ts';
import { IMAGE_OPS, newImg, PhysicsEnv, VALUE_OPS, type Img, type OpCtx, type UpNode } from './ops/ops.ts';
import { conventionsKey, DEFAULT_CONVENTIONS, type Conventions } from './spectral/conventions.ts';
import { swapsAxes } from './print/geometry.ts';
import type { SpectraTable } from './film/upsample.ts';

export interface RefEngineOptions {
  /** Stocks, papers, lights and observer (required: in Node, core's nodePacksData(); in a browser, the packs loaded by the host). */
  data: PhysicsData;
  conv?: Conventions;
  /** Restrict capabilities().ops. */
  ops?: string[];
  /**
   * 'exact' (default): every pixel through the physics. 'tabulated': invert.dyes, print.expose and
   * view.reflect read core's f64 N³ tables with the GPU's texel-centre trilinear lookup (look3), the
   * reference the GPU preview path is compared with (CHB-005 parity).
   */
  mode?: 'exact' | 'tabulated';
  /** Table size in tabulated mode (default 33). */
  N?: number;
  /**
   * Most full-resolution node images and most results kept, least recently used dropped first
   * (default: unbounded). An interactive host sets it: every slider step makes new nodes (CHB-023).
   */
  cacheLimit?: number;
  /** Spectral upsampling table of the forward path (default: core's sigmoid fit; CHB-012). */
  spectra?: SpectraTable;
  /**
   * Byte budget of the image caches (full-resolution node images, sampled images, results), least recently
   * used dropped first (default: unbounded). A host with a large working image sets it with cacheLimit (CHB-027).
   */
  cacheBytes?: number;
  /**
   * Previews on the target's sample grid (CHB-027): a preview at scale < 1 or of a region computes only the
   * pixels the result samples, for every stage that is pointwise from the nearest cached image on (spatial
   * stages run at full resolution and are cached). Nearest sampling commutes with pointwise ops, so the result
   * is bit-identical to the full-resolution path. Default off (every stage at full resolution).
   */
  sampled?: boolean;
  /**
   * Called between the stages of an evaluation, after which the signal is checked (CHB-027): a worker passes a
   * macrotask yield so a cancel message can land between stages. Default: a microtask.
   */
  yield?: () => Promise<void>;
}

/**
 * Ops a sampled preview computes on the sample grid (CHB-027): each output pixel depends only on the same pixel
 * of its inputs and on its args (no neighbourhood, no pixel coordinates), so nearest sampling commutes with it.
 * The print side only: the negative's stages (scan.*, invert.*, the forward path's capture and film) are pointwise
 * too, but they change rarely and cost most (invert.dyes solves per pixel), so they run once at full resolution
 * and stay cached, and every grid (draft, screen, a region) samples them.
 */
export const GRID_OPS: ReadonlySet<string> = new Set([
  'print.expose', 'print.develop', 'print.combine', 'composite.mix',
  'composite.encode', 'exposure', 'curve', 'levels', 'hsl', 'vibrance', 'grade', 'mixer',
  'mask.luminance', 'mask.colour', 'mask.combine', 'mask.invert',
  'view.reflect', 'view.flare', 'view.adapt', 'output.display',
]);

/** An LRU over a Map's insertion order, bounded by entry count and bytes (CHB-023 host glue, CHB-027 bytes). */
class Lru<V> {
  private readonly m = new Map<string, { v: V; bytes: number }>();
  private total = 0;
  private readonly limit: number;
  private readonly bytes: number;
  constructor(limit: number, bytes: number) {
    this.limit = limit;
    this.bytes = bytes;
  }
  peek(k: string): V | undefined {
    return this.m.get(k)?.v;
  }
  recall(k: string): V | undefined {
    const e = this.m.get(k);
    if (!e) return undefined;
    this.m.delete(k);
    this.m.set(k, e);
    return e.v;
  }
  remember(k: string, v: V, bytes: number): V {
    this.delete(k);
    this.m.set(k, { v, bytes });
    this.total += bytes;
    // the newest entry always stays, even when it alone is over the budget
    while (this.m.size > 1 && (this.m.size > this.limit || this.total > this.bytes)) this.delete(this.m.keys().next().value as string);
    return v;
  }
  delete(k: string): void {
    const e = this.m.get(k);
    if (!e) return;
    this.total -= e.bytes;
    this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
    this.total = 0;
  }
}

/** The pixels a result samples (nearest, as evaluate() always sampled): columns xs and rows ys of the W × H grid. */
interface Grid { key: string; W: number; H: number; xs: Int32Array; ys: Int32Array }

function gridOf(W: number, H: number, region: Box, width: number, height: number): Grid {
  const xs = gridAxis(region.x, region.w, width), ys = gridAxis(region.y, region.h, height);
  return { key: `${W}x${H}|${region.x},${region.y},${region.w},${region.h}|${width}x${height}`, W, H, xs, ys };
}

/** img at the grid's pixels, or null when img is not on the grid's W × H. */
function sampleImg(img: Img, g: Grid): Img | null {
  if (img.w !== g.W || img.h !== g.H) return null;
  const w = g.xs.length, h = g.ys.length, c = img.c;
  const out = newImg(w, h, c);
  for (let y = 0; y < h; y++) {
    const row = g.ys[y]! * img.w;
    for (let x = 0; x < w; x++) {
      const i = (row + g.xs[x]!) * c, j = (y * w + x) * c;
      for (let k = 0; k < c; k++) out.data[j + k] = img.data[i + k]!;
    }
  }
  return img.warnings ? { ...out, warnings: img.warnings } : out;
}

/**
 * The grid of output.frame's receiver that a sampled output.frame reads (P3b): output pixel (x′, y′) of an
 * un-straightened frame is receiver pixel (crop.x + x, crop.y + y) with (x, y) the orientation's inverse of
 * (g.xs[x′], g.ys[y′]); x depends on one output axis and y on the other, so the receiver's samples are a grid too,
 * transposed when the orientation swaps the axes. Null when the frame is straightened (bilinear: not a sample grid).
 */
function frameGrid(n: Node, g: Grid, inW: number, inH: number): { grid: Grid; swap: boolean } | null {
  const angle = (n.args['angle_deg'] as number | undefined) ?? 0;
  if (angle !== 0) return null;
  const o = (n.args['orientation'] as string | undefined) ?? 'none';
  const b = (n.args['crop'] as Box | undefined) ?? { x: 0, y: 0, w: inW, h: inH };
  const swap = swapsAxes(o);
  // the output axis each receiver axis reads, and whether it runs backwards (geometry.ts orientPixels)
  const fx = o === 'flipH' || o === 'rot180' || o === 'ccw90' || o === 'transverse';
  const fy = o === 'flipV' || o === 'rot180' || o === 'cw90' || o === 'transverse';
  const along = (src: Int32Array, flip: boolean, n0: number, off: number): Int32Array => Int32Array.from(src, (v) => off + (flip ? n0 - 1 - v : v));
  const xs = along(swap ? g.ys : g.xs, fx, b.w, b.x);
  const ys = along(swap ? g.xs : g.ys, fy, b.h, b.y);
  return { grid: { key: `${g.key}>${n.id.slice(0, 16)}`, W: inW, H: inH, xs, ys }, swap };
}

/** img (w × h, c channels) transposed: output pixel (x, y) is img's (y, x). */
function transposeImg(img: Img): Img {
  const out = newImg(img.h, img.w, img.c);
  for (let y = 0; y < img.w; y++) for (let x = 0; x < img.h; x++) {
    for (let k = 0; k < img.c; k++) out.data[(y * img.h + x) * img.c + k] = img.data[(x * img.w + y) * img.c + k]!;
  }
  return img.warnings ? { ...out, warnings: img.warnings } : out;
}

/** One stage of a staged evaluation: a node, on a sample grid or at full resolution (null). */
interface Stage { id: string; g: Grid | null }

/** Thrown inside a sampled evaluation when a stage's image is not on the grid: evaluate falls back to full resolution. */
class OffGrid extends Error {}

const imgBytes = (i: Img): number => i.data.byteLength + 64;

/** Every op the reference engine implements. */
export const REFERENCE_OPS: readonly string[] = [...Object.keys(IMAGE_OPS), ...Object.keys(VALUE_OPS)].sort();

const cancelled = (): ChromobenchError => new ChromobenchError({ code: 'E_CANCELLED', message: 'evaluation cancelled' });

export class RefEngine implements Engine {
  readonly id = 'reference' as const;
  /** Replaced (not mutated) by forgetSource. */
  graph = new Graph();
  private readonly ops: Set<string>;
  private readonly env: PhysicsEnv;
  private readonly conv: Conventions;
  private readonly sources = new Map<string, Img>();
  /** Node images at full resolution, by 'F:<id>'. */
  private readonly full: Lru<Img>;
  /** Node images on a sample grid (sampled previews), by 'S:<id>@<grid>'. */
  private readonly grid: Lru<Img>;
  private readonly results: Lru<{ data: Float64Array; width: number; height: number; region: Box; scale: number; warnings: Diagnostic[] }>;
  private disposed = false;
  private readonly sampled: boolean;
  private readonly yieldFn: () => Promise<void>;
  /** Stages computed since construction (tests and profiling: what a change recomputed, and how many pixels). */
  readonly computed = { full: 0, sampled: 0, pixels: 0 };

  constructor(o: RefEngineOptions) {
    const limit = Math.max(4, o.cacheLimit ?? Infinity);
    const bytes = o.cacheBytes ?? Infinity;
    this.full = new Lru(limit, bytes);
    // sampled stages are small and many (one per grid): their own LRU, so they never push out a full-resolution stage
    this.grid = new Lru(limit * 8, bytes / 4);
    this.results = new Lru(limit, bytes / 4);
    this.sampled = o.sampled ?? false;
    this.yieldFn = o.yield ?? (() => Promise.resolve());
    this.conv = o.conv ?? DEFAULT_CONVENTIONS;
    this.env = new PhysicsEnv(o.data, this.conv, { mode: o.mode ?? 'exact', ...(o.N ? { N: o.N } : {}), ...(o.spectra ? { spectra: o.spectra } : {}) });
    this.ops = new Set(o.ops ?? REFERENCE_OPS);
  }

  capabilities(): EngineCaps {
    return {
      ops: [...this.ops].sort(), maxSize: 8192, f16: false, timestamps: false, precision: ['preview', 'export'], available: true,
      adapter: { name: 'reference-f64', fallback: false }, conventions: conventionsKey(this.conv),
    };
  }

  async open(source: SourceRef): Promise<SourceInfo> {
    if (!source.bytes) fail('E_FORMAT', 'RefEngine.open needs source.bytes (decoding from paths is CHB-006)');
    const bytes = source.bytes instanceof Uint8Array ? source.bytes : new Uint8Array(source.bytes);
    const sha = sha256Hex(bytes);
    if (source.sha256 && source.sha256 !== sha) fail('E_DATA_HASH', `source bytes hash to ${sha.slice(0, 12)}…, not ${source.sha256.slice(0, 12)}…`);
    const raw = readTiffCodes(bytes);
    const max = raw.bits === 16 ? 65535 : 255;
    const img = newImg(raw.width, raw.height, 3);
    let clipped = 0;
    for (let i = 0; i < raw.width * raw.height; i++) {
      for (let k = 0; k < 3; k++) {
        const v = raw.data[i * raw.samples + (raw.samples === 3 ? k : 0)]!;
        if (v >= max) clipped++;
        img.data[i * 3 + k] = v / max;
      }
    }
    this.sources.set(sha, img);
    const info: SourceInfo = {
      sha256: sha, format: 'tiff', width: raw.width, height: raw.height, channels: 3, bits: raw.bits, sample: 'uint',
      encoding: { value: 'linear', evidence: 'format' }, levels: { black: [0, 0, 0], white: [max, max, max], from: 'default' },
      cfa: 'none', clippedFraction: clipped / (raw.width * raw.height * 3), notes: [],
    };
    this.graph.registerSource(info);
    return info;
  }

  /**
   * Host glue (CHB-023): registers a source a host decoded itself (ingest: TIFF, PNG, DNG, camera RAW),
   * as interleaved linear RGB (0 = black, 1 = white level), under `info.sha256`. open() only reads TIFF.
   */
  openDecoded(info: SourceInfo, data: Float32Array | Float64Array): SourceInfo {
    if (data.length !== info.width * info.height * 3) fail('E_FORMAT', `openDecoded: ${data.length} samples for ${info.width}×${info.height}×3`);
    const img = newImg(info.width, info.height, 3);
    img.data.set(data);
    this.sources.set(info.sha256, img);
    this.graph.registerSource(info);
    return info;
  }

  /**
   * Host glue (CHB-027): forgets a source and everything computed from it, before the host registers the same file
   * decoded another way (re-opened as a photo or as a negative). source.open's node id names the file, not the
   * decode, so cached results and node infos (sizes) of the old decode would otherwise survive.
   */
  forgetSource(sha: string): void {
    const old = this.graph;
    this.sources.delete(sha);
    this.full.clear();
    this.grid.clear();
    this.results.clear();
    this.graph = new Graph();
    for (const k of this.sources.keys()) {
      const info = old.source(k);
      if (info) this.graph.registerSource(info);
    }
  }

  adopt(defs: readonly NodeDef[]): void {
    this.graph.adopt(defs);
  }

  async prepare(_keys: TableKey[]): Promise<void> {
    // Exact mode builds nothing ahead; tables/ builders serve CHB-005 parity directly.
  }

  dispose(): void {
    this.disposed = true;
    this.full.clear();
    this.grid.clear();
    this.results.clear();
  }

  private node(ref: NodeRef): Node {
    return this.graph.get(ref.id) ?? fail('E_NO_NODE', `RefEngine does not know node ${ref.id.slice(0, 12)}…`, { hint: 'engine.adopt(graph.closure(id)) first' });
  }

  private check(n: Node): void {
    if (this.disposed) fail('E_INTERNAL', 'engine disposed');
    if (!this.ops.has(n.op)) fail('E_NOT_IMPLEMENTED', `${n.op} is not implemented by the reference engine`, { valid: [...this.ops] });
  }

  private ctx(n: Node, image: boolean, at: (id: string) => Img = (id) => this.compute(id)): OpCtx {
    const op = getOp(n.op);
    const nArgs = new Set(nodeSlots(op, n.args).map((s) => s.id));
    const recvId = op.on === 'none' ? undefined : n.inputs[0];
    const recvNode = recvId ? this.graph.get(recvId) : undefined;
    const up = (name: string): UpNode | undefined => {
      let id = recvId;
      for (let guard = 0; id && guard < 10000; guard++) {
        const m = this.graph.get(id);
        if (!m) return undefined;
        if (m.op === name) return { op: m.op, args: m.args, id: m.id, inputs: m.inputs };
        id = getOp(m.op).on === 'none' ? undefined : m.inputs[0];
      }
      return undefined;
    };
    return {
      args: n.args,
      recv: recvId ? at(recvId) : undefined,
      recvDomain: recvNode && recvNode.info.kind === 'Image' ? (recvNode.info.domain as Domain) : undefined,
      extra: n.inputs.slice(recvId ? 1 : 0).filter((i) => nArgs.has(i)).map((i) => at(i)),
      info: image && n.info.kind === 'Image' ? n.info : undefined,
      source: (sha) => this.sources.get(sha) ?? fail('E_NO_SOURCE', `source ${sha.slice(0, 12)}… is not open in the reference engine`),
      sourceInfo: (sha) => this.graph.source(sha),
      up,
      image: (id) => at(id),
      node: (id) => {
        const m = this.graph.get(id);
        return m ? { op: m.op, args: m.args, id: m.id, inputs: m.inputs } : undefined;
      },
      env: this.env,
    };
  }

  private compute(id: string): Img {
    const hit = this.full.recall(`F:${id}`);
    if (hit) return hit;
    const n = this.graph.get(id) ?? fail('E_NO_NODE', `unknown node ${id.slice(0, 12)}…`);
    this.check(n);
    const f = IMAGE_OPS[n.op] ?? fail('E_NOT_IMPLEMENTED', `${n.op} has no reference image implementation`);
    const img = f(this.ctx(n, true));
    this.computed.full++;
    this.computed.pixels += img.w * img.h;
    return this.full.remember(`F:${id}`, img, imgBytes(img));
  }

  /** True when node n runs on a sample grid (GRID_OPS: its pixels need only the same pixels of its inputs). */
  private pointwise(n: Node): boolean {
    return GRID_OPS.has(n.op);
  }

  /** Node id's image on grid g: sampled from its full-resolution image when that is cached, else computed pointwise on the grid. */
  private computeAt(id: string, g: Grid): Img {
    const sk = `S:${id}@${g.key}`;
    const hit = this.grid.recall(sk);
    if (hit) return hit;
    const whole = this.full.recall(`F:${id}`);
    const n = this.graph.get(id) ?? fail('E_NO_NODE', `unknown node ${id.slice(0, 12)}…`);
    let img: Img | null;
    const fg = !whole && n.op === 'output.frame' ? this.frameGridOf(n, g) : null;
    if (fg) {
      // un-straightened geometry: the receiver on its own sample grid, reoriented (no full-resolution stage)
      this.check(n);
      const inner = this.computeAt(n.inputs[0]!, fg.grid);
      img = fg.swap ? transposeImg(inner) : inner;
      if (img.w !== g.xs.length || img.h !== g.ys.length) throw new OffGrid(n.op);
      this.computed.sampled++;
    } else if (whole || !this.pointwise(n)) {
      img = sampleImg(whole ?? this.compute(id), g);
      if (!img) throw new OffGrid(n.op);
    } else {
      this.check(n);
      const f = IMAGE_OPS[n.op] ?? fail('E_NOT_IMPLEMENTED', `${n.op} has no reference image implementation`);
      img = f(this.ctx(n, true, (i) => this.computeAt(i, g)));
      if (img.w !== g.xs.length || img.h !== g.ys.length) throw new OffGrid(n.op);
      this.computed.sampled++;
      this.computed.pixels += img.w * img.h;
    }
    return this.grid.remember(sk, img, imgBytes(img));
  }

  /** output.frame's receiver grid for grid g (frameGrid), or null when straightened. */
  private frameGridOf(n: Node, g: Grid): { grid: Grid; swap: boolean } | null {
    const r = this.graph.get(n.inputs[0]!);
    if (!r || r.info.kind !== 'Image') return null;
    const info = r.info as ImageInfo;
    return frameGrid(n, g, info.width, info.height);
  }

  /**
   * The image stages of id's closure, inputs first, each with the grid it is computed on: a pointwise stage passes
   * its grid to its inputs, an un-straightened output.frame passes its receiver grid (frameGrid), every other stage
   * (spatial, the negative's stages) is computed at full resolution with its inputs and sampled from there.
   */
  private stages(id: string, g: Grid | null): Stage[] {
    const out: Stage[] = [];
    const seen = new Set<string>();
    const visit = (nid: string, at: Grid | null): void => {
      const k = `${nid}@${at?.key ?? 'F'}`;
      if (seen.has(k)) return;
      seen.add(k);
      const m = this.graph.get(nid);
      if (!m) return;
      let below: Grid | null = null;
      if (at && this.pointwise(m)) below = at;
      else if (at && m.op === 'output.frame') below = this.frameGridOf(m, at)?.grid ?? null;
      for (const i of m.inputs) visit(i, below);
      if (m.info.kind === 'Image') out.push({ id: nid, g: at });
    };
    visit(id, g);
    return out;
  }

  /**
   * Computes id stage by stage, inputs first (on grid g, or at full resolution), yielding between stages and
   * stopping with E_CANCELLED when the signal aborts. Finished stages stay cached; nothing partial is kept.
   */
  private async staged(id: string, g: Grid | null, signal: AbortSignal | undefined): Promise<{ img: Img; stages: Stage[] }> {
    const stages = this.stages(id, g);
    for (const s of stages) {
      if (this.full.peek(`F:${s.id}`) || (s.g && this.grid.peek(`S:${s.id}@${s.g.key}`))) continue;
      if (s.g) this.computeAt(s.id, s.g);
      else this.compute(s.id);
      await this.yieldFn();
      if (signal?.aborted) throw cancelled();
    }
    return { img: g ? this.computeAt(id, g) : this.compute(id), stages };
  }

  /** Warnings the ops of the stages attached to their images (e.g. W_DODGE_EXCEEDS_MAIN), deduplicated. */
  private warningsOf(stages: readonly Stage[]): Diagnostic[] {
    const out: Diagnostic[] = [];
    const seen = new Set<string>();
    for (const s of stages) {
      const img = this.full.peek(`F:${s.id}`) ?? (s.g ? this.grid.peek(`S:${s.id}@${s.g.key}`) : undefined);
      for (const w of img?.warnings ?? []) {
        const k = `${w.code}|${w.message}`;
        if (!seen.has(k)) { seen.add(k); out.push(w); }
      }
    }
    return out;
  }

  async evaluate(ref: NodeRef, target: EvalTarget): Promise<ImageResult> {
    if (target.signal?.aborted) throw cancelled();
    const n = this.node(ref);
    if (n.info.kind !== 'Image') fail('E_WRONG_KIND', `${n.op} returns a value; use measure()`);
    this.check(n);
    const info = n.info as ImageInfo;
    const region = target.region ?? { x: 0, y: 0, w: info.width, h: info.height };
    if (region.x < 0 || region.y < 0 || region.w <= 0 || region.h <= 0 || region.x + region.w > info.width || region.y + region.h > info.height || ![region.x, region.y, region.w, region.h].every(Number.isInteger)) {
      fail('E_ARG_RANGE', 'region lies outside the image', { valid: [`{x: 0, y: 0, w: ${info.width}, h: ${info.height}}`] });
    }
    const scale = quantizeScale(target.scale);
    if (!(scale > 0 && scale <= 1)) fail('E_ARG_RANGE', `scale ${target.scale} must be in (0, 1] or 'full'`);
    const key = `${n.id}|${scale}|${region.x},${region.y},${region.w},${region.h}|${target.precision}`;
    let res = this.results.recall(key);
    if (!res) {
      await Promise.resolve();
      if (target.signal?.aborted) throw cancelled();
      const width = Math.max(1, Math.round(region.w * scale));
      const height = Math.max(1, Math.round(region.h * scale));
      const grid = gridOf(info.width, info.height, region, width, height);
      const whole = width === info.width && height === info.height;
      let data: Float64Array | null = null;
      let warnings: Diagnostic[] = [];
      if (this.sampled && !whole && target.precision === 'preview') {
        try {
          const r = await this.staged(n.id, grid, target.signal);
          data = r.img.data;
          warnings = this.warningsOf(r.stages);
        } catch (e) {
          if (!(e instanceof OffGrid)) throw e;
        }
      }
      if (!data) {
        const { img, stages } = await this.staged(n.id, null, target.signal);
        data = sampleImg(img, grid)?.data ?? fail('E_INTERNAL', `${n.op}: image ${img.w}×${img.h} is not the node's ${info.width}×${info.height}`);
        warnings = this.warningsOf(stages);
      }
      if (target.signal?.aborted) throw cancelled();
      res = this.results.remember(key, { data, width, height, region, scale, warnings }, data.byteLength);
    }
    const r = res;
    return {
      node: n.id, info, scale: r.scale, region: { ...r.region }, width: r.width, height: r.height, format: 'f64',
      read: async () => r.data.slice(), warnings: [...r.warnings],
    };
  }

  async measure(ref: NodeRef, spec: MeasureSpec = {}): Promise<Measurement> {
    if (spec.signal?.aborted) throw cancelled();
    const n = this.node(ref);
    if (n.info.kind !== 'Value') fail('E_WRONG_KIND', `${n.op} returns an image; use evaluate()`);
    this.check(n);
    const f = VALUE_OPS[n.op] ?? fail('E_NOT_IMPLEMENTED', `${n.op} has no reference value implementation`);
    await Promise.resolve();
    if (spec.signal?.aborted) throw cancelled();
    return { node: n.id, value: f(this.ctx(n, false)), warnings: [] };
  }
}
