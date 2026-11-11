// GpuEngine: the Engine interface on WebGPU (guide §3, §5.5). Pointwise chains lower to programs of
// kernels/pointwise.wgsl (one dispatch per segment); measure() runs GPU reductions.
//
// Physics: @chromobench/core's (CHB-017). Stocks come from a PhysicsData (default: CHB-004's packs,
// physics/data.ts — the CHB-004 switch point); tables, aim, filtration, flare, adaptation and display
// matrices from physics/core.ts. The GPU only applies the uniforms and tables it is handed.
import {
  ChromobenchError, DOMAINS, fail, getOp, Graph, quantizeScale, sha256Hex,
  type Box, type Diagnostic, type Engine, type EngineCaps, type EvalTarget, type ImageInfo, type ImageResult,
  type Measurement, type MeasureSpec, type Node, type NodeDef, type NodeRef, type SourceInfo, type SourceRef, type TableKey, type TilePlan,
} from '@chromobench/contract';
import { readTiff } from '@chromobench/engine-mock';
import { ChainRunner, POINTWISE_WGSL, type RunTarget } from './chain/run.ts';
import { OP, type PwOp, type Segment, type SegmentTables } from './chain/program.ts';
import { GpuRuntime, type AccelChoice, type RuntimeOptions } from './device.ts';
import { histPercentile, REDUCE_WGSL, Reducer } from './measure.ts';
import { combineRatio, densitiesOf, densityMaskSigma, featherSigma, paintMask, parseStrokes, rebateBox, type PhysicsData } from '@chromobench/core';
import combineCode from '../kernels/combine.wgsl?raw';
import { Blur } from './spatial.ts';
import { CorePhysics } from './physics/core.ts';
import { loadDefaultPhysicsData } from './physics/data.ts';
import { planTiles, type GpuTilePlan } from './tiles.ts';
import { WorkerPool } from './tables/build-workers.ts';
import { OpfsStore, TableCache } from './tables/cache.ts';
import { TableManager } from './tables/manager.ts';
import type { Mat3, Vec3 } from './tables/inputs.ts';

export const GPU_OPS = [
  'source.open', 'source.pattern', 'scan.density', 'invert.dyes', 'print.expose', 'print.lights', 'print.develop',
  'view.reflect', 'view.flare', 'view.adapt', 'output.display', 'film.grain',
  'measure.stats', 'measure.histogram', 'measure.patches', 'measure.densitometer',
  // CHB-010: multi-exposure printing, masks and density masks
  'print.combine', 'print.densityMask', 'mask.luminance', 'mask.gradient', 'mask.ellipse', 'mask.paint', 'mask.feather', 'mask.and', 'mask.or', 'mask.not',
] as const;

/** Multi-input or spatial ops: always materialised, computed from materialised inputs (combine.wgsl, blur.wgsl). */
const BARRIER_OPS: ReadonlySet<string> = new Set(['print.combine', 'print.densityMask', 'mask.feather', 'mask.and', 'mask.or']);
/** Masks from coordinates (or strokes): their receiver's values are never read. */
const GENERATOR_OPS: ReadonlySet<string> = new Set(['mask.gradient', 'mask.ellipse', 'mask.paint']);
/** Largest σ (output px) of one blur pass (spatial.ts MAX_RADIUS = 3σ); wider blurs run several passes. */
const MAX_PASS_SIGMA = 32;
export const COMBINE_WGSL = combineCode;
const COMBINE = Object.freeze({ EXP: 0, ADD: 1, LOG: 2, MIN: 3, MAX: 4, TRANSMITTANCE: 5, DENSITY_MASK: 6, COPY: 7 });

/** The output grid every materialised texture of one evaluation shares. */
interface GridTarget { outW: number; outH: number; frameW: number; frameH: number; region: Box; precision: 'preview' | 'export'; umOut: number }
/** How one materialised node is computed: a barrier from its inputs, or a pointwise tail from a root. */
type Plan =
  | { kind: 'barrier'; reads: string[] }
  | { kind: 'tail'; reads: string[]; nodes: Node[]; from: number; root: 'source' | 'texture' | 'none'; rootId?: string };

const DEFAULT_UM_PER_PX = 6;

export interface GpuEngineOptions extends RuntimeOptions {
  runtime?: GpuRuntime;
  accel?: AccelChoice;
  /** Use OPFS for the table cache (default true when available). */
  opfs?: boolean;
  /** f64 worker pool size (0: no workers). */
  workers?: number;
  /** Compile the chain and reduction pipelines at creation (default true). */
  prewarm?: boolean;
  /** Stock and reference data (default: CHB-004's packs). */
  data?: PhysicsData;
  /** URL of the packs directory when `data` is not given and the engine runs in a browser (default `<origin>/packs/`). */
  packsBase?: string;
  /**
   * Most evaluation results kept, least recently used dropped first (default: unbounded). An
   * interactive host sets it: every slider step makes new nodes and a new cached result (CHB-023).
   */
  cacheLimit?: number;
}

interface SourceImg { w: number; h: number; c: number; data: Float32Array }
interface Lowered { root: Node; segments: Segment[]; warnings: Diagnostic[] }
interface Cached { data: Float32Array; width: number; height: number; region: Box; scale: number; warnings: Diagnostic[] }

const cancelled = () => new ChromobenchError({ code: 'E_CANCELLED', message: 'evaluation cancelled' });

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class GpuEngine implements Engine {
  readonly id = 'gpu' as const;
  readonly graph = new Graph();
  private rt: GpuRuntime;
  private readonly ownsRuntime: boolean;
  private tables: TableManager;
  private chain: ChainRunner;
  private reducer: Reducer;
  private blur: Blur;
  private dummyTex: GPUTexture | null = null;
  private readonly opts: GpuEngineOptions;
  private readonly pool: WorkerPool | null;
  private readonly cache: TableCache;
  /** core's physics for this engine's data and conventions. */
  readonly physics: CorePhysics;
  private readonly sources = new Map<string, SourceImg>();
  private readonly srcTex = new Map<string, GPUTexture>();
  private readonly results = new Map<string, Cached>();
  /** Rebate transmittance per scan.density node id (the brightest-columns rule reads the whole receiver). */
  private readonly rebateT = new Map<string, Vec3>();
  private disposed = false;
  private recreating: Promise<void> | null = null;

  private constructor(rt: GpuRuntime, opts: GpuEngineOptions, owns: boolean, data: PhysicsData) {
    this.rt = rt;
    this.opts = opts;
    this.ownsRuntime = owns;
    this.pool = (opts.workers ?? 0) > 0 && typeof Worker !== 'undefined' ? new WorkerPool(opts.workers) : null;
    this.cache = new TableCache(opts.opfs !== false && OpfsStore.available() ? new OpfsStore() : null);
    this.physics = new CorePhysics(data);
    this.tables = new TableManager(rt, { accel: opts.accel ?? 'auto', workers: this.pool, cache: this.cache, conventions: this.physics.conventions });
    this.chain = new ChainRunner(rt, this.tables);
    this.reducer = new Reducer(rt);
    this.blur = new Blur(rt);
    rt.onLost(() => this.dropDeviceState());
  }

  static async create(opts: GpuEngineOptions = {}): Promise<GpuEngine> {
    const rt = opts.runtime ?? (await GpuRuntime.create(opts));
    const e = new GpuEngine(rt, opts, !opts.runtime, opts.data ?? (await loadDefaultPhysicsData(opts.packsBase)));
    // prewarm (guide §5.2): compile the chain and reduction kernels now, not on the first slider move
    if (opts.prewarm !== false) {
      await rt.pipelines.prewarm([
        { name: 'pointwise', code: POINTWISE_WGSL },
        { name: 'reduce.moments', code: REDUCE_WGSL, entryPoint: 'moments' },
        { name: 'reduce.histogram', code: REDUCE_WGSL, entryPoint: 'histogram' },
        { name: 'combine', code: COMBINE_WGSL },
      ]);
    }
    return e;
  }

  get runtime(): GpuRuntime { return this.rt; }

  capabilities(): EngineCaps {
    const c = this.rt.caps;
    return {
      ops: [...GPU_OPS].sort(), maxSize: c.limits.maxTextureDimension2D, f16: c.features.f16, timestamps: c.features.timestamps,
      precision: ['preview', 'export'], available: c.available, adapter: { name: this.rt.name, fallback: c.adapter.fallback },
      maxTextureDimension2D: c.limits.maxTextureDimension2D, maxBufferSize: c.limits.maxBufferSize, float32Filterable: c.features.float32Filterable,
      budgetBytes: c.budgetBytes, conventions: this.physics.conventions,
    };
  }

  // ---- device loss: drop GPU state, keep CPU state; recreate on the next call ----
  private dropDeviceState(): void {
    this.srcTex.clear();
    this.dummyTex = null;
  }

  private async ensure(): Promise<void> {
    if (this.disposed) fail('E_INTERNAL', 'engine disposed');
    if (!this.rt.lost) return;
    this.recreating ??= (async () => {
      const rt = await GpuRuntime.create(this.opts);
      this.rt = rt;
      this.tables = new TableManager(rt, { accel: this.opts.accel ?? 'auto', workers: this.pool, cache: this.cache, conventions: this.physics.conventions });
      this.chain = new ChainRunner(rt, this.tables);
      this.reducer = new Reducer(rt);
      this.blur = new Blur(rt);
      rt.onLost(() => this.dropDeviceState());
    })().finally(() => { this.recreating = null; });
    await this.recreating;
  }

  /** Wraps GPU work: a loss during the call surfaces as E_DEVICE_LOST (the host may retry once). */
  private async gpu<T>(f: () => Promise<T>): Promise<T> {
    await this.ensure();
    const rt = this.rt;
    try {
      return await f();
    } catch (e) {
      if (rt.lost) throw new ChromobenchError({ code: 'E_DEVICE_LOST', message: `GPU device lost: ${rt.lost.message || rt.lost.reason}`, hint: 'retry: the engine recreates the device' });
      throw e;
    }
  }

  async open(source: SourceRef): Promise<SourceInfo> {
    // TODO(CHB-006): delegate decoding to ingest. Interim: the mock's 16-bit TIFF reader.
    if (!source.bytes) fail('E_FORMAT', 'GpuEngine.open needs source.bytes');
    const bytes = source.bytes instanceof Uint8Array ? source.bytes : new Uint8Array(source.bytes);
    const sha = sha256Hex(bytes);
    if (source.sha256 && source.sha256 !== sha) fail('E_DATA_HASH', `source bytes hash to ${sha.slice(0, 12)}…, not ${source.sha256.slice(0, 12)}…`);
    const raw = readTiff(bytes);
    const max = raw.bits === 16 ? 65535 : 255;
    const data = new Float32Array(raw.width * raw.height * 3);
    let clipped = 0;
    for (let i = 0; i < raw.width * raw.height; i++) for (let k = 0; k < 3; k++) {
      const v = raw.data[i * raw.samples + (raw.samples === 3 ? k : 0)]!;
      if (v >= max) clipped++;
      data[i * 3 + k] = v / max;
    }
    this.sources.set(sha, { w: raw.width, h: raw.height, c: 3, data });
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
    this.sources.set(info.sha256, { w: info.width, h: info.height, c: 3, data: data instanceof Float32Array ? data : Float32Array.from(data) });
    this.graph.registerSource(info);
    return info;
  }

  adopt(defs: readonly NodeDef[]): void {
    this.graph.adopt(defs);
  }

  async prepare(keys: TableKey[]): Promise<void> {
    // Tables are resolved by content on first use (TableManager); keys name what to warm. The interim
    // engine cannot rebuild inputs from a key's hashes alone, so prepare() only checks the cache.
    for (const k of keys) if (k.kind !== 'curve') await this.cache.get(k);
  }

  async plan(ref: NodeRef, target: EvalTarget): Promise<TilePlan> {
    const n = this.node(ref);
    const info = n.info as ImageInfo;
    void target;
    return this.planFor(info);
  }

  planFor(info: ImageInfo): GpuTilePlan {
    return planTiles({ w: info.width, h: info.height, umPerPx: info.umPerPx.film ?? DEFAULT_UM_PER_PX }, [], this.rt.caps);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.results.clear();
    this.pool?.terminate();
    for (const t of this.srcTex.values()) t.destroy();
    this.srcTex.clear();
    this.dummyTex?.destroy();
    this.chain.destroy();
    if (this.ownsRuntime) this.rt.destroy();
  }

  private node(ref: NodeRef): Node {
    const n = this.graph.get(ref.id);
    if (!n) return fail('E_NO_NODE', `GpuEngine does not know node ${ref.id.slice(0, 12)}…`, { hint: 'engine.adopt(graph.closure(id)) first' });
    return n;
  }

  private check(n: Node): void {
    if (this.disposed) fail('E_INTERNAL', 'engine disposed');
    if (!(GPU_OPS as readonly string[]).includes(n.op)) fail('E_NOT_IMPLEMENTED', `${n.op} is not implemented by the GPU engine`, { valid: [...GPU_OPS] });
  }

  // ---- lowering: a chain of single-receiver pointwise nodes → program segments ----

  /** Walks receivers from `id` back to a source node. */
  private chainOf(id: string): Node[] {
    const out: Node[] = [];
    let n = this.graph.get(id) ?? fail('E_NO_NODE', `unknown node ${id.slice(0, 12)}…`);
    for (;;) {
      this.check(n);
      out.unshift(n);
      const op = getOp(n.op);
      if (op.on === 'none') break;
      n = this.graph.get(n.inputs[0]!) ?? fail('E_NO_NODE', `unknown input of ${n.op}`);
    }
    return out;
  }

  /** Lowers nodes[from…] to segments; nodes[0…from) are upstream context only (ctx.up). */
  private lower(nodes: Node[], treb: Map<string, Vec3>, from = 0): Lowered {
    // Every parameter comes from core (physics/core.ts): the same chain settings, aim, tables, flare
    // white, adaptation and display matrix the reference engine uses for the same nodes.
    const P = this.physics;
    const segments: Segment[] = [];
    const warnings: Diagnostic[] = [];
    let cur: Segment = { ops: [], tables: {} };
    const push = (op: PwOp, need: Partial<SegmentTables> = {}, disp?: Mat3) => {
      const clash = (Object.keys(need) as (keyof SegmentTables)[]).some((k) => cur.tables[k] && cur.tables[k] !== need[k]);
      if (cur.ops.length >= 12 || clash || (disp && cur.disp)) {
        segments.push(cur);
        cur = { ops: [], tables: {} };
      }
      Object.assign(cur.tables, need);
      if (disp) cur.disp = disp;
      cur.ops.push(op);
    };
    for (let i = from; i < nodes.length; i++) {
      const n = nodes[i]!;
      const a = n.args as Record<string, unknown>;
      const ctx = P.ctx(nodes, i);
      switch (n.op) {
        case 'source.open': {
          const enc = a['encoding'];
          if (enc === 'srgb' || enc === 'gamma22') push({ code: OP.DECODE, p0: [enc === 'srgb' ? 1 : 2], node: n.id });
          break;
        }
        case 'source.pattern': break;
        case 'scan.density': push({ code: OP.DENSITY, p0: [...(treb.get(n.id) ?? [1, 1, 1])], node: n.id }); break;
        case 'invert.dyes': push({ code: OP.DYES, node: n.id }, { solve: P.solveInputs(a['stock'] as string, a['scanner'] as string) }); break;
        case 'print.expose': {
          // filtration is a shift on the database neutral pack; the aim lights are core's (aim, aimView)
          const { pd, offset } = P.expose(P.exposeSettings(ctx, a));
          push({ code: OP.EXPOSE, p0: [...offset], node: n.id }, { pd });
          break;
        }
        case 'print.lights': push({ code: OP.ADD, p0: [...(a['logH'] as number[])], node: n.id }); break;
        case 'print.develop': {
          // the grade as x′ = pivot + γ(x − pivot) before the paper row (flag 1), as core's developerAt
          const gr = P.grade(ctx, a['grade'] as number);
          const curves = P.developRow(a['paper'] as string);
          push(gr ? { code: OP.DEVELOP, flags: 1, p0: [...gr.pivot], p1: [gr.gamma, gr.gamma, gr.gamma], node: n.id } : { code: OP.DEVELOP, node: n.id }, { curves });
          break;
        }
        case 'view.reflect': push({ code: OP.REFLECT, node: n.id }, { print: P.printInputs(P.paperOf(ctx), a['illuminant'] as string) }); break;
        case 'view.flare': push({ code: OP.FLARE, p0: P.flare(ctx, a['flare'] as number), p1: [1], node: n.id }); break;
        case 'view.adapt': push({ code: OP.ADAPT, p0: P.adaptGains(ctx, a['to']), node: n.id }); break;
        case 'output.display': {
          if (a['space'] !== 'srgb') fail('E_NOT_IMPLEMENTED', `output.display space ${String(a['space'])} is not implemented by the GPU engine (srgb only)`, { valid: ['srgb'] });
          const knee = a['knee'];
          if (knee === 'oklch') warnings.push({ code: 'W_PREVIEW_APPROX', message: 'the oklch knee is not implemented on the GPU yet (TODO CHB-011); clipped instead' });
          push({ code: OP.DISPLAY, flags: knee === 'tanh-shoulder' ? 1 : 0, node: n.id }, {}, P.displayMatrix(ctx, a['rendering']));
          break;
        }
        case 'film.grain': {
          push({ code: OP.GRAIN, flags: (a['seed'] as number) >>> 0, p0: [a['amount'] as number, 0], node: n.id });
          break;
        }
        // CHB-010 masks (core print/masks.ts on the grid)
        case 'mask.luminance': {
          const rd = this.graph.get(n.inputs[0]!)?.info;
          const [lo, hi] = DOMAINS[rd && rd.kind === 'Image' ? rd.domain : 'mask'].range;
          push({ code: OP.MASK_LUM, p0: [a['above'] as number, a['below'] as number, a['softness'] as number], p1: [lo, hi], node: n.id });
          break;
        }
        case 'mask.gradient': {
          const f = a['from'] as { x: number; y: number }, t = a['to'] as { x: number; y: number };
          push({ code: OP.MASK_GRADIENT, p0: [f.x, f.y, t.x, t.y], node: n.id });
          break;
        }
        case 'mask.ellipse': {
          const b = a['box'] as Box;
          const th = (((a['angle_deg'] as number | undefined) ?? 0) * Math.PI) / 180;
          push({ code: OP.MASK_ELLIPSE, p0: [b.x + b.w / 2, b.y + b.h / 2, Math.max(b.w / 2, 1e-9), Math.max(b.h / 2, 1e-9)], p1: [Math.cos(th), Math.sin(th)], node: n.id });
          break;
        }
        case 'mask.not': push({ code: OP.MASK_NOT, node: n.id }); break;
        default: fail('E_INTERNAL', `${n.op} has no pointwise GPU lowering (barrier ops are materialised)`);
      }
    }
    if (cur.ops.length || !segments.length) segments.push(cur);
    return { root: nodes[0]!, segments, warnings };
  }

  /** The lowered program of a node (tests and the parity page). */
  lowerNode(ref: NodeRef): Segment[] {
    const nodes = this.chainOf(this.node(ref).id);
    return this.lower(nodes, new Map()).segments;
  }

  /** Grain σ per output pixel from size_um (Selwyn: σ²·A constant), filled per target. */
  private fillGrain(segs: Segment[], nodes: Node[], umPerPxOut: number): void {
    for (const s of segs) for (const o of s.ops) {
      if (o.code !== OP.GRAIN) continue;
      const n = nodes.find((x) => x.id === o.node)!;
      const size = n.args['size_um'] as number;
      // σ at a pixel of area p² = 0.012 · size/p (0.012: the Studio's grain scale at p = size)
      o.p0 = [o.p0![0]!, 0.012 * (size / umPerPxOut)];
    }
  }

  private sourceImage(root: Node): SourceImg {
    if (root.op === 'source.open') {
      const s = this.sources.get(root.args['source'] as string);
      if (!s) fail('E_NO_SOURCE', `source ${String(root.args['source']).slice(0, 12)}… is not open in the GPU engine`);
      return s;
    }
    const info = root.info as ImageInfo;
    const rng = mulberry32(root.args['seed'] as number);
    const [lo, hi] = DOMAINS[info.domain].range;
    const data = new Float32Array(info.width * info.height * info.channels);
    for (let i = 0; i < data.length; i++) data[i] = info.domain === 'scan-classes' ? Math.floor(rng() * 4) : lo + rng() * (hi - lo);
    return { w: info.width, h: info.height, c: info.channels, data };
  }

  private sourceTexture(root: Node): { tex: GPUTexture; img: SourceImg } {
    const img = this.sourceImage(root);
    let tex = this.srcTex.get(root.id);
    if (!tex) {
      tex = this.chain.upload(img.data, img.w, img.h, img.c, `source.${root.id.slice(0, 8)}`);
      this.srcTex.set(root.id, tex);
    }
    return { tex, img };
  }

  /** Rebate transmittance for scan.density nodes: mean of the receiver over the rebate box. */
  private async rebates(nodes: Node[]): Promise<Map<string, Vec3>> {
    const out = new Map<string, Vec3>();
    for (const n of nodes) {
      if (n.op !== 'scan.density') continue;
      const known = this.rebateT.get(n.id);
      if (known) {
        out.set(n.id, known);
        continue;
      }
      let box = n.args['rebate'] as Box | undefined;
      const recvRef = { id: n.inputs[0]!, info: this.graph.get(n.inputs[0]!)!.info };
      if (!box) {
        // no box: the brightest 5 % column band, the rule the mock and reference engines share (core rebateBox)
        const full = await this.evaluate(recvRef, { scale: 'full', precision: 'export' });
        box = rebateBox(full.width, full.height, full.info.channels, await full.read());
      }
      const r = await this.evaluate(recvRef, { scale: 'full', precision: 'export', region: box });
      const d = await r.read();
      const c = r.info.channels;
      const m = [0, 0, 0];
      for (let i = 0; i < r.width * r.height; i++) for (let k = 0; k < 3; k++) m[k]! += d[i * c + Math.min(k, c - 1)]! / (r.width * r.height);
      out.set(n.id, m.map((v) => Math.max(v, 1e-8)) as Vec3);
      this.rebateT.set(n.id, out.get(n.id)!);
    }
    return out;
  }

  // ---- DAG evaluation (CHB-010): materialised nodes on the output grid ----
  //
  // A graph is cut into pointwise tails that end at a materialised node: the target, every multi-input
  // or spatial op (print.combine, mask.and/or/feather/paint, print.densityMask), every input of one,
  // and every node read by two consumers (so a shared invert.dyes runs once). Each tail starts at the
  // source (read through outMap at full resolution, as before), at a materialised texture (read at the
  // output pixel), or at a coordinate mask (mask.gradient/ellipse, which ignore their receiver's values).
  // All materialised textures share the target's grid: pointwise steps commute with nearest sampling, so
  // they equal the reference engine's sampled full-resolution result; spatial steps (feather, the
  // density mask's blur) run on the grid with σ scaled to it and clamp at its edge.

  private async render(id: string, t: GridTarget): Promise<{ tex: GPUTexture; warnings: Diagnostic[] }> {
    const order: string[] = [];
    const seen = new Set<string>();
    const consumers = new Map<string, number>();
    const visit = (nid: string): void => {
      if (seen.has(nid)) return;
      seen.add(nid);
      const n = this.graph.get(nid) ?? fail('E_NO_NODE', `unknown node ${nid.slice(0, 12)}…`);
      this.check(n);
      if (!GENERATOR_OPS.has(n.op)) {
        for (const i of n.inputs) {
          consumers.set(i, (consumers.get(i) ?? 0) + 1);
          visit(i);
        }
      }
      order.push(nid);
    };
    visit(id);
    const mat = new Set<string>([id]);
    for (const nid of order) {
      const n = this.graph.get(nid)!;
      if ((consumers.get(nid) ?? 0) >= 2 || n.op === 'mask.paint') mat.add(nid);
      if (BARRIER_OPS.has(n.op)) {
        mat.add(nid);
        for (const i of n.inputs) mat.add(i);
      }
    }
    // plan: what each materialised node reads, for reference counts
    const plans = new Map<string, Plan>();
    const refs = new Map<string, number>([[id, 1]]);
    for (const nid of order) {
      if (!mat.has(nid)) continue;
      const p = this.planNode(nid, mat);
      plans.set(nid, p);
      for (const r of p.reads) refs.set(r, (refs.get(r) ?? 0) + 1);
    }
    const texs = new Map<string, GPUTexture>();
    const warnings: Diagnostic[] = [];
    const done = (r: string): void => {
      const left = (refs.get(r) ?? 1) - 1;
      refs.set(r, left);
      if (left <= 0) {
        const tx = texs.get(r);
        if (tx) this.rt.textures.release(tx);
        texs.delete(r);
      }
    };
    try {
      for (const nid of order) {
        const p = plans.get(nid);
        if (!p) continue;
        const tex = await this.execute(nid, p, texs, t, warnings);
        texs.set(nid, tex);
        for (const r of p.reads) done(r);
      }
      const out = texs.get(id)!;
      texs.delete(id);
      return { tex: out, warnings };
    } finally {
      for (const tx of texs.values()) this.rt.textures.release(tx);
    }
  }

  /** What a materialised node reads, and from where its pointwise tail starts. */
  private planNode(nid: string, mat: ReadonlySet<string>): Plan {
    const n = this.graph.get(nid)!;
    if (BARRIER_OPS.has(n.op)) return { kind: 'barrier', reads: [...n.inputs] };
    const nodes = this.chainOf(nid);
    for (let i = nodes.length - 1; ; i--) {
      const m = nodes[i]!;
      if (getOp(m.op).on === 'none') return { kind: 'tail', reads: [], nodes, from: 0, root: 'source' };
      if (GENERATOR_OPS.has(m.op)) return { kind: 'tail', reads: [], nodes, from: i, root: 'none' };
      const r = nodes[i - 1]!;
      if (mat.has(r.id)) return { kind: 'tail', reads: [r.id], nodes, from: i, root: 'texture', rootId: r.id };
    }
  }

  private async execute(nid: string, p: Plan, texs: ReadonlyMap<string, GPUTexture>, t: GridTarget, warnings: Diagnostic[]): Promise<GPUTexture> {
    const n = this.graph.get(nid)!;
    const tex = (id: string): GPUTexture => texs.get(id) ?? fail('E_INTERNAL', `GPU render: ${id.slice(0, 12)}… was not materialised`);
    const run: RunTarget = { outW: t.outW, outH: t.outH, frameW: t.frameW, frameH: t.frameH, region: t.region, precision: t.precision };
    if (p.kind === 'tail') {
      if (n.op === 'mask.paint') {
        // strokes are rasterised by core on this grid (the same f64 function as the reference engine) and uploaded
        const m = paintMask(parseStrokes(String(n.args['strokes'])), { w: t.outW, h: t.outH, region: t.region });
        return this.chain.upload(m, t.outW, t.outH, 1, 'mask.paint');
      }
      const treb = await this.rebates(p.nodes.slice(p.from));
      const low = this.lower(p.nodes, treb, p.from);
      warnings.push(...low.warnings);
      this.fillGrain(low.segments, p.nodes, t.umOut);
      const segs = low.segments.length ? low.segments : [{ ops: [], tables: {} }];
      if (p.root === 'source') return this.chain.run(segs, this.sourceTexture(p.nodes[0]!).tex, [0, 0], run);
      return this.chain.run(segs, p.root === 'texture' ? tex(p.rootId!) : this.dummy(), [0, 0], run, { srcOnGrid: true });
    }
    const a = n.args as Record<string, unknown>;
    const recv = tex(n.inputs[0]!);
    const scale = t.outW / t.region.w;
    switch (n.op) {
      case 'print.combine': {
        // core combinePixel: H = max(10^x − Σ dodge, 0) + Σ add, one log at the end
        const ids = a['exposures'] as string[], masks = a['masks'] as string[], modes = a['modes'] as string[];
        if (!ids.length) return this.mix(COMBINE.COPY, recv);
        const chain = this.chainOf(nid);
        const main = this.physics.ctx(chain, chain.length - 1).up('print.expose')?.args;
        const terms = ids.map((id, i) => {
          const e = this.graph.get(id);
          return { e: tex(id), m: tex(masks[i]!), sign: modes[i] === 'subtract' ? -1 : 1, ratio: combineRatio(main, e?.op === 'print.expose' ? e.args : undefined) };
        });
        let H = await this.mix(COMBINE.EXP, recv);
        let firstAdd = true;
        for (const term of [...terms.filter((x) => x.sign < 0), ...terms.filter((x) => x.sign > 0)]) {
          const next = await this.mix(COMBINE.ADD, H, term.e, term.m, term.sign > 0 && firstAdd ? 1 : 0, [term.sign * term.ratio]);
          if (term.sign > 0) firstAdd = false;
          this.rt.textures.release(H);
          H = next;
        }
        const out = await this.mix(COMBINE.LOG, H, null, null, 1);
        this.rt.textures.release(H);
        return out;
      }
      case 'mask.and': return this.mix(COMBINE.MIN, recv, tex(a['other'] as string));
      case 'mask.or': return this.mix(COMBINE.MAX, recv, tex(a['other'] as string));
      case 'mask.feather': return this.gaussian(recv, featherSigma(a['radius_px'] as number) * scale);
      case 'print.densityMask': {
        // core maskDensity: blur the mean transmittance, d = γ·(log10 H_m − log10 min H_m), added to every layer
        const amount = a['amount'] as number;
        if (amount === 0) return this.mix(COMBINE.COPY, recv);
        const info = n.info as ImageInfo;
        const T = await this.mix(COMBINE.TRANSMITTANCE, recv);
        const Hm = await this.gaussian(T, densityMaskSigma(a['radius_um'] as number, info.umPerPx.film) * scale);
        this.rt.textures.release(T);
        const ref = (await this.reducer.moments(Hm, { x: 0, y: 0, w: t.outW, h: t.outH })).min[0]!;
        const out = await this.mix(COMBINE.DENSITY_MASK, recv, Hm, null, 0, [amount, Math.log10(ref)]);
        this.rt.textures.release(Hm);
        return out;
      }
      default: return fail('E_INTERNAL', `${n.op} is not a GPU barrier op`);
    }
  }

  /** A Gaussian blur of σ output px (several passes beyond MAX_PASS_SIGMA: σ² adds); a new texture. */
  private async gaussian(src: GPUTexture, sigma: number): Promise<GPUTexture> {
    if (!(sigma > 0)) return this.mix(COMBINE.COPY, src);
    const passes = Math.max(1, Math.ceil((sigma / MAX_PASS_SIGMA) ** 2));
    const s = sigma / Math.sqrt(passes);
    let cur = await this.blur.gaussian(src, [s, s, s, s]);
    for (let i = 1; i < passes; i++) {
      const next = await this.blur.gaussian(cur, [s, s, s, s]);
      this.rt.textures.release(cur);
      cur = next;
    }
    return cur;
  }

  private dummy(): GPUTexture {
    this.dummyTex ??= this.rt.device.createTexture({ size: [1, 1], format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING });
    return this.dummyTex;
  }

  /** One pass of kernels/combine.wgsl on output-grid textures; returns a new texture (release it). */
  private async mix(mode: number, a: GPUTexture, b: GPUTexture | null = null, m: GPUTexture | null = null, flags = 0, w: number[] = []): Promise<GPUTexture> {
    const rt = this.rt;
    rt.check();
    const dev = rt.device;
    const pipe = await rt.pipelines.get({ name: 'combine', code: COMBINE_WGSL });
    const W = a.width, H = a.height;
    const out = rt.textures.acquire({ format: 'rgba32float', w: W, h: H, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC }, `combine.${mode}`);
    const u = new ArrayBuffer(32);
    new Uint32Array(u, 0, 4).set([mode, flags, 0, 0]);
    new Float32Array(u, 16, 4).set([w[0] ?? 0, w[1] ?? 0, w[2] ?? 0, w[3] ?? 0]);
    const ub = rt.buffers.acquire({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }, 'combine.u');
    dev.queue.writeBuffer(ub, 0, u);
    const bg = dev.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: ub, size: 32 } },
        { binding: 1, resource: a.createView() },
        { binding: 2, resource: (b ?? this.dummy()).createView() },
        { binding: 3, resource: (m ?? this.dummy()).createView() },
        { binding: 4, resource: out.createView() },
      ],
    });
    const enc = dev.createCommandEncoder();
    const pass = enc.beginComputePass(rt.timer.pass(`combine.${mode}`));
    pass.setPipeline(pipe);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8));
    pass.end();
    rt.timer.resolve(enc);
    dev.queue.submit([enc.finish()]);
    await rt.timer.flush();
    rt.buffers.release(ub);
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
    let res = this.results.get(key);
    if (res) {
      this.results.delete(key);
      this.results.set(key, res);
    } else {
      const width = Math.max(1, Math.round(region.w * scale));
      const height = Math.max(1, Math.round(region.h * scale));
      const um = (info.umPerPx.film ?? DEFAULT_UM_PER_PX) * (region.w / width);
      const grid: GridTarget = { outW: width, outH: height, frameW: info.width, frameH: info.height, region, precision: target.precision, umOut: um };
      const { px, warnings } = await this.gpu(async () => {
        const r = await this.render(n.id, grid);
        const raw = await this.chain.readTexture(r.tex, width, height);
        this.rt.textures.release(r.tex);
        return { px: raw, warnings: r.warnings };
      });
      if (target.signal?.aborted) throw cancelled(); // nothing partial enters the cache
      const c = info.channels;
      const data = new Float32Array(width * height * c);
      for (let i = 0; i < width * height; i++) for (let k = 0; k < c; k++) data[i * c + k] = px[4 * i + k]!;
      res = { data, width, height, region, scale, warnings };
      this.results.set(key, res);
      const limit = Math.max(4, this.opts.cacheLimit ?? Infinity);
      while (this.results.size > limit) this.results.delete(this.results.keys().next().value!);
    }
    const r = res;
    return {
      node: n.id, info, scale: r.scale, region: { ...r.region }, width: r.width, height: r.height, format: 'f32',
      read: async () => r.data.slice(), warnings: [...r.warnings],
    };
  }

  async measure(ref: NodeRef, spec: MeasureSpec = {}): Promise<Measurement> {
    if (spec.signal?.aborted) throw cancelled();
    const n = this.node(ref);
    if (n.info.kind !== 'Value') fail('E_WRONG_KIND', `${n.op} returns an image; use evaluate()`);
    this.check(n);
    const recvId = n.inputs[0]!;
    const recv = this.graph.get(recvId)!;
    const info = recv.info as ImageInfo;
    const a = n.args as Record<string, unknown>;
    const precision = spec.precision ?? 'export';
    const scale = spec.scale ?? 'full';
    if (n.op === 'measure.densitometer' && scale === 'full') {
      // Only the aperture is evaluated (CHB-023): a probe must not read back the whole frame.
      const at = a['at'] as { x: number; y: number };
      const r = (a['aperture_px'] as number) / 2;
      const x0 = Math.max(0, Math.floor(at.x - r)), y0 = Math.max(0, Math.floor(at.y - r));
      const x1 = Math.min(info.width - 1, Math.ceil(at.x + r)), y1 = Math.min(info.height - 1, Math.ceil(at.y + r));
      if (x1 < x0 || y1 < y0) fail('E_ARG_RANGE', 'densitometer aperture lies outside the image');
      const box = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
      const img = await this.evaluate(recv, { scale: 'full', precision, region: box });
      const data = await img.read();
      const local = { ...a, at: { x: at.x - x0, y: at.y - y0 } };
      const value = await this.gpu(async () => {
        const tex = this.chain.upload(data, img.width, img.height, info.channels, 'measure');
        try {
          return await this.reduce(n.op, local, tex, img.width, img.height, info, recvId);
        } finally {
          this.rt.textures.release(tex);
        }
      });
      if (spec.signal?.aborted) throw cancelled();
      return { node: n.id, value, warnings: [] };
    }
    const img = await this.evaluate(recv, { scale, precision });
    const data = await img.read();
    const value = await this.gpu(async () => {
      const tex = this.chain.upload(data, img.width, img.height, info.channels, 'measure');
      try {
        return await this.reduce(n.op, a, tex, img.width, img.height, info, recvId);
      } finally {
        this.rt.textures.release(tex);
      }
    });
    if (spec.signal?.aborted) throw cancelled();
    return { node: n.id, value, warnings: [] };
  }

  private async reduce(op: string, a: Record<string, unknown>, tex: GPUTexture, w: number, h: number, info: ImageInfo, recvId: string): Promise<Record<string, unknown>> {
    const full: Box = { x: 0, y: 0, w, h };
    // densities of a mean pixel are core's (Status M through the stock, or −log10 of XYZ over the white)
    const densities = (mean: number[]) => {
      const chain = this.chainOf(recvId);
      return densitiesOf(this.physics.ctx(chain, chain.length), info.domain, mean as Vec3);
    };
    const nc = Math.min(3, info.channels);
    const [dlo, dhi] = DOMAINS[info.domain].range;
    switch (op) {
      case 'measure.stats': {
        // TODO: the optional mask argument is not applied yet
        const box = (a['box'] as Box | undefined) ?? full;
        const m = await this.reducer.moments(tex, box);
        const p01: number[] = [];
        const p99: number[] = [];
        let low = 0, high = 0;
        for (let k = 0; k < info.channels; k++) {
          const lo = m.min[k]!;
          const hi = m.max[k]! > lo ? m.max[k]! : lo + 1e-6;
          const bins = await this.reducer.histogram(tex, box, k, lo, hi * (1 + 1e-7) + 1e-12, 4096);
          p01.push(histPercentile(bins, lo, hi, 0.01));
          p99.push(histPercentile(bins, lo, hi, 0.99));
          if (k < nc) {
            const lb = await this.reducer.histogram(tex, box, k, dlo, dhi, 4096);
            low += lb[0]!;
            high += lb[4095]!;
          }
        }
        const N = m.count * nc;
        return { mean: m.mean.slice(0, info.channels), p01, p99, clipLow: N ? low / N : 0, clipHigh: N ? high / N : 0 };
      }
      case 'measure.histogram': {
        const bins = a['bins'] as number;
        const chName = a['channel'] as string;
        const ch = chName === 'L' ? (info.channels >= 3 ? 3 : 0) : Math.min('rgb'.indexOf(chName), info.channels - 1);
        const counts = await this.reducer.histogram(tex, full, ch, dlo, dhi, bins);
        return { edges: Array.from({ length: bins + 1 }, (_, i) => dlo + ((dhi - dlo) * i) / bins), counts: Array.from(counts) };
      }
      case 'measure.patches': {
        const b = (a['box'] as Box | undefined) ?? full;
        const cols = a['cols'] as number, rows = a['rows'] as number;
        const cells = [];
        for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
          const cb = { x: b.x + Math.floor((i * b.w) / cols), y: b.y + Math.floor((j * b.h) / rows), w: Math.max(1, Math.floor(b.w / cols)), h: Math.max(1, Math.floor(b.h / rows)) };
          const m = await this.reducer.moments(tex, cb);
          const d = densities([0, 1, 2].map((k) => m.mean[Math.min(k, info.channels - 1)]!));
          cells.push({ cell: j * cols + i, D: d.D, visual: d.visual ?? (d.D[0] + d.D[1] + d.D[2]) / 3 });
        }
        return { cells };
      }
      case 'measure.densitometer': {
        const at = a['at'] as { x: number; y: number };
        const r = (a['aperture_px'] as number) / 2;
        const x0 = Math.max(0, Math.floor(at.x - r)), y0 = Math.max(0, Math.floor(at.y - r));
        const x1 = Math.min(w - 1, Math.ceil(at.x + r)), y1 = Math.min(h - 1, Math.ceil(at.y + r));
        if (x1 < x0 || y1 < y0) fail('E_ARG_RANGE', 'densitometer aperture lies outside the image');
        const m = await this.reducer.moments(tex, { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, { cx: at.x, cy: at.y, r });
        if (!m.count) fail('E_ARG_RANGE', 'densitometer aperture lies outside the image');
        const d = densities([0, 1, 2].map((k) => m.mean[Math.min(k, info.channels - 1)]!));
        return d.visual === undefined ? { D: d.D } : { D: d.D, visual: d.visual };
      }
      default:
        return fail('E_NOT_IMPLEMENTED', `${op} has no GPU reduction`);
    }
  }
}
