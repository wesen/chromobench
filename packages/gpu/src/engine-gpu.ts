// GpuEngine: the Engine interface on WebGPU (guide §3, §5.5). Pointwise chains lower to programs of
// kernels/pointwise.wgsl (one dispatch per segment); measure() runs GPU reductions.
//
// Physics: @chromobench/core's (CHB-017). Stocks come from a PhysicsData (default: CHB-004's packs,
// physics/data.ts — the CHB-004 switch point); tables, aim, filtration, flare, adaptation and display
// matrices from physics/core.ts. The GPU only applies the uniforms and tables it is handed.
//
// Modules (CHB-032): engine/defs.ts (op sets, kernel constants, internal types), engine/lower.ts (pointwise
// lowering), engine/dag.ts (which nodes are materialised), engine/textures.ts (source upload, 16-bit readback,
// combine and blur passes), engine/reduce.ts (measure reductions), engine/results.ts (result cache policy).
// This file keeps the Engine surface, device-loss handling, sources, and execute() (one materialised node).
import {
  ChromobenchError, fail, getOp, Graph, quantizeScale, sha256Hex,
  type Box, type Diagnostic, type Engine, type EngineCaps, type EvalTarget, type ImageInfo, type ImageResult,
  type Measurement, type MeasureSpec, type Node, type NodeDef, type NodeRef, type SourceInfo, type SourceRef, type TableKey, type TilePlan,
} from '@chromobench/contract';
import { readTiffCodes } from '@chromobench/ingest';
import { ChainRunner, POINTWISE_WGSL, type RunTarget } from './chain/run.ts';
import type { Segment } from './chain/program.ts';
import { GpuRuntime, type AccelChoice, type RuntimeOptions } from './device.ts';
import { REDUCE_WGSL, Reducer } from './measure.ts';
import { claritySigma, clearExposure, densitiesOf, densityMaskSigma, featherSigma, paintMask, rebateBox, seedFallbackSpectra, whiteAt, type PhysicsData, type Stroke } from '@chromobench/core';
import { Blur } from './spatial.ts';
import { Retouch, type RepairSpot } from './retouch.ts';
import { FILM_OPS, FilmGpu } from './film.ts';
import { framePass, frameSource, type FrameArgs } from './frame.ts';
import { CorePhysics } from './physics/core.ts';
import { loadDefaultPhysicsData } from './physics/data.ts';
import { planTiles, type GpuTilePlan } from './tiles.ts';
import { WorkerPool } from './tables/build-workers.ts';
import type { SpectraJob, SpectraReply } from './tables/spectra-worker.ts';
import { OpfsStore, TableCache } from './tables/cache.ts';
import { TableManager } from './tables/manager.ts';
import type { Vec3 } from './tables/inputs.ts';
import { planGraph } from './engine/dag.ts';
import { cancelled, COMBINE_WGSL, GPU_OPS, type Cached, type GridTarget, type Lowered, type Plan, type SourceImg, type U16Result } from './engine/defs.ts';
import { FLAG, MODE, combineArgs, lightPasses } from './engine/light.ts';
import { fillGrain, lightContext, lowerChain } from './engine/lower.ts';
import { blendCode, encodingCode } from './chain/working.ts';
import { reduceMeasure } from './engine/reduce.ts';
import { addResult } from './engine/results.ts';
import { combinePass, gaussianBlur, readU16, syntheticSource, uploadF32, uploadU16 } from './engine/textures.ts';

export { COMBINE_WGSL, GPU_OPS, type U16Result } from './engine/defs.ts';

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

export class GpuEngine implements Engine {
  readonly id = 'gpu' as const;
  /** Replaced (not mutated) by forgetSource. */
  graph = new Graph();
  private rt: GpuRuntime;
  private readonly ownsRuntime: boolean;
  private tables: TableManager;
  private chain: ChainRunner;
  private reducer: Reducer;
  private blur: Blur;
  private film: FilmGpu;
  private dummyTex: GPUTexture | null = null;
  private retouchK: { rt: GpuRuntime; k: Retouch } | null = null;
  private readonly opts: GpuEngineOptions;
  private readonly pool: WorkerPool | null;
  private readonly cache: TableCache;
  /** core's physics for this engine's data and conventions. */
  readonly physics: CorePhysics;
  private readonly sources = new Map<string, SourceImg>();
  private readonly srcTex = new Map<string, GPUTexture>();
  /** code → code/max as f32 (the f64 quotient rounded once, as the f32 path), per max; see uploadU16. */
  private readonly unpackLut = new Map<number, GPUBuffer>();
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
    this.film = new FilmGpu(rt, this.blur);
    rt.onLost(() => this.dropDeviceState());
  }

  static async create(opts: GpuEngineOptions = {}): Promise<GpuEngine> {
    const rt = opts.runtime ?? (await GpuRuntime.create(opts));
    const data = opts.data ?? (await loadDefaultPhysicsData(opts.packsBase));
    const e = new GpuEngine(rt, opts, !opts.runtime, data);
    prefitSpectra(data);
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
    this.unpackLut.clear();
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
      this.film = new FilmGpu(rt, this.blur);
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
    if (!source.bytes) fail('E_FORMAT', 'GpuEngine.open needs source.bytes');
    const bytes = source.bytes instanceof Uint8Array ? source.bytes : new Uint8Array(source.bytes);
    const sha = sha256Hex(bytes);
    if (source.sha256 && source.sha256 !== sha) fail('E_DATA_HASH', `source bytes hash to ${sha.slice(0, 12)}…, not ${source.sha256.slice(0, 12)}…`);
    const raw = readTiffCodes(bytes);
    const max = raw.bits === 16 ? 65535 : 255;
    let clipped = 0;
    for (let i = 0; i < raw.width * raw.height; i++) for (let k = 0; k < 3; k++) if (raw.data[i * raw.samples + (raw.samples === 3 ? k : 0)]! >= max) clipped++;
    if (raw.bits === 16) {
      // CHB-011: keep the 16-bit samples (no f32 copy of the scan); tiles upload as rgba16uint
      this.sources.set(sha, { w: raw.width, h: raw.height, c: 3, u16: raw.data as Uint16Array, samples: raw.samples, max });
    } else {
      const data = new Float32Array(raw.width * raw.height * 3);
      for (let i = 0; i < raw.width * raw.height; i++) for (let k = 0; k < 3; k++) data[i * 3 + k] = raw.data[i * raw.samples + (raw.samples === 3 ? k : 0)]! / max;
      this.sources.set(sha, { w: raw.width, h: raw.height, c: 3, data });
    }
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

  /**
   * Host glue (CHB-027): forgets a source and everything computed from it, before the host registers the same file
   * decoded another way (re-opened as a photo or as a negative). source.open's node id names the file, not the
   * decode, so uploaded textures, cached results and node infos (sizes) of the old decode would otherwise survive.
   */
  forgetSource(sha: string): void {
    const old = this.graph;
    this.sources.delete(sha);
    this.results.clear();
    this.rebateT.clear();
    for (const t of this.srcTex.values()) t.destroy();
    this.srcTex.clear();
    this.graph = new Graph();
    for (const k of this.sources.keys()) {
      const info = old.source(k);
      if (info) this.graph.registerSource(info);
    }
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
    // no spatial kernels are declared, so the pitch only labels the plan (an image without one, a pattern, plans at 1)
    return planTiles({ w: info.width, h: info.height, umPerPx: info.umPerPx.film ?? 1 }, [], this.rt.caps);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.results.clear();
    this.pool?.terminate();
    for (const t of this.srcTex.values()) t.destroy();
    this.srcTex.clear();
    this.dummyTex?.destroy();
    for (const b of this.unpackLut.values()) b.destroy();
    this.unpackLut.clear();
    this.film.drop();
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

  /** Lowers nodes[from…] to segments (engine/lower.ts). */
  private lower(nodes: Node[], treb: Map<string, Vec3>, from = 0): Lowered {
    return lowerChain(this.physics, this.graph, nodes, treb, from);
  }

  /** The lowered program of a node (tests and the parity page). */
  lowerNode(ref: NodeRef): Segment[] {
    const nodes = this.chainOf(this.node(ref).id);
    return this.lower(nodes, new Map()).segments;
  }

  private sourceImage(root: Node): SourceImg {
    if (root.op === 'source.open') {
      const s = this.sources.get(root.args['source'] as string);
      if (!s) fail('E_NO_SOURCE', `source ${String(root.args['source']).slice(0, 12)}… is not open in the GPU engine`);
      return s;
    }
    return syntheticSource(root);
  }

  /**
   * The source as an rgba32float texture covering `rect` of the frame (the chain reads it with srcOrigin
   * = rect's corner). The full frame is cached per source; a sub-rectangle (a tile of an export, a rebate
   * box) is uploaded for this call only and returned `owned` (CHB-011: no full-frame upload for a tile).
   */
  /** A read-back result uploaded again for a reduction: on the GPU when it is an f32 array (CHB-034). */
  private uploadMeasured(data: ArrayLike<number>, w: number, h: number, c: number): Promise<GPUTexture> {
    const cpu = () => this.chain.upload(data, w, h, c, 'measure');
    return data instanceof Float32Array ? uploadF32(this.rt, data, w, h, c, 'measure', cpu) : Promise.resolve(cpu());
  }

  private async sourceTexture(root: Node, rect: Box): Promise<{ tex: GPUTexture; owned: boolean }> {
    const img = this.sourceImage(root);
    const full = rect.x === 0 && rect.y === 0 && rect.w === img.w && rect.h === img.h;
    if (full) {
      const t = this.srcTex.get(root.id);
      if (t) return { tex: t, owned: false };
    }
    const label = `source.${root.id.slice(0, 8)}`;
    let tex: GPUTexture;
    if (img.u16) tex = await this.uploadU16(img, rect, label);
    else {
      const d = img.data!;
      const sub = full ? d : new Float32Array(rect.w * rect.h * img.c);
      if (!full) for (let y = 0; y < rect.h; y++) sub.set(d.subarray(((rect.y + y) * img.w + rect.x) * img.c, ((rect.y + y) * img.w + rect.x + rect.w) * img.c), y * rect.w * img.c);
      tex = await uploadF32(this.rt, sub, rect.w, rect.h, img.c, label, () => this.chain.upload(sub, rect.w, rect.h, img.c, label));
    }
    if (full) this.srcTex.set(root.id, tex);
    return { tex, owned: !full };
  }

  private uploadU16(img: SourceImg, rect: Box, label: string): Promise<GPUTexture> {
    return uploadU16(this.rt, img, rect, label, this.unpackLut);
  }

  private readU16(tex: GPUTexture, w: number, h: number): Promise<Uint16Array> {
    return readU16(this.rt, tex, w, h);
  }

  /** Adds a result, then drops the least recently used ones (engine/results.ts). */
  private cacheResult(key: string, res: Cached): void {
    addResult(this.results, key, res, this.opts.cacheLimit);
  }

  /** Rebate transmittance for scan.density nodes: mean of the receiver over the rebate box. */
  private async rebates(nodes: Node[]): Promise<Map<string, Vec3>> {
    const out = new Map<string, Vec3>();
    for (const n of nodes) {
      if (n.op !== 'scan.density') continue;
      const baseT = n.args['baseT'] as Vec3 | undefined;
      if (baseT) {
        // the roll's base (contract 0.3): no measurement
        out.set(n.id, [...baseT] as Vec3);
        continue;
      }
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
  // A graph is cut into pointwise tails that end at a materialised node: the target, every barrier
  // (engine/dag.ts isBarrier: print.combine with texture terms, print.densityMask, mask.combine/feather,
  // mask.paint, composite.mix, heal, clone, clarity, the film ops), every input of one, and every node read
  // by two consumers (so a shared invert.dyes runs once). Each tail starts at the source (read through outMap
  // at full resolution), at a materialised texture (read at the output pixel), or at a generator mask
  // (mask.linear/ellipse/constant, which ignore their receiver's values).
  // All materialised textures share the target's grid: pointwise steps commute with nearest sampling, so
  // they equal the reference engine's sampled full-resolution result; spatial steps (feather, the
  // density mask's blur) run on the grid with σ scaled to it and clamp at its edge.

  /**
   * The node on grid t. output.frame (the document geometry, the display cut's last step) renders its receiver on the
   * grid the output grid maps to and reorients it, or straightens the receiver's footprint (src/frame.ts); everything
   * else is a DAG evaluation (renderDag).
   */
  private async renderGraph(id: string, t: GridTarget): Promise<{ tex: GPUTexture; warnings: Diagnostic[] }> {
    const n = this.graph.get(id);
    if (n?.op !== 'output.frame') return this.renderDag(id, t);
    const inner = this.graph.get(n.inputs[0]!) ?? fail('E_NO_NODE', 'output.frame without its receiver');
    const inInfo = inner.info as ImageInfo;
    const a = n.args as Record<string, unknown>;
    const f: FrameArgs = { orientation: a['orientation'] ?? 'none', angle_deg: (a['angle_deg'] as number | undefined) ?? 0, crop: (a['crop'] as Box | undefined) ?? { x: 0, y: 0, w: inInfo.width, h: inInfo.height } };
    const s = frameSource(f, t.region, t.outW, t.outH, inInfo.width, inInfo.height);
    const sub: GridTarget = { ...t, frameW: inInfo.width, frameH: inInfo.height, region: s.region, outW: s.full ? s.region.w : s.outW, outH: s.full ? s.region.h : s.outH };
    const r = await this.renderGraph(inner.id, sub);
    if (!s.full && f.orientation === 'none') return r;
    try {
      const tex = s.full
        ? await framePass(this.rt, 'straighten', r.tex, t.outW, t.outH, f, t.region, s.region, inInfo.width, inInfo.height)
        : await framePass(this.rt, 'orient', r.tex, t.outW, t.outH, f, t.region, { x: 0, y: 0 }, inInfo.width, inInfo.height);
      return { tex, warnings: r.warnings };
    } finally {
      this.rt.textures.release(r.tex);
    }
  }

  private async renderDag(id: string, t: GridTarget): Promise<{ tex: GPUTexture; warnings: Diagnostic[] }> {
    const { order, plans, refs } = planGraph(this.graph, id, (n) => this.check(n), (nid) => this.chainOf(nid));
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

  private async execute(nid: string, p: Plan, texs: ReadonlyMap<string, GPUTexture>, t: GridTarget, warnings: Diagnostic[]): Promise<GPUTexture> {
    const n = this.graph.get(nid)!;
    const tex = (id: string): GPUTexture => texs.get(id) ?? fail('E_INTERNAL', `GPU render: ${id.slice(0, 12)}… was not materialised`);
    const run: RunTarget = { outW: t.outW, outH: t.outH, frameW: t.frameW, frameH: t.frameH, region: t.region, precision: t.precision };
    if (p.kind === 'tail') {
      if (n.op === 'mask.paint') {
        // strokes are rasterised by core on this grid (the same f64 function as the reference engine) and uploaded
        const m = paintMask(n.args['strokes'] as readonly Stroke[], { w: t.outW, h: t.outH, region: t.region });
        return this.chain.upload(m, t.outW, t.outH, 1, 'mask.paint');
      }
      const treb = await this.rebates(p.nodes.slice(p.from));
      const low = this.lower(p.nodes, treb, p.from);
      warnings.push(...low.warnings);
      fillGrain(low.segments, p.nodes, t.region.w / t.outW);
      const segs = low.segments.length ? low.segments : [{ ops: [], tables: {} }];
      if (p.root === 'source') {
        // pointwise tails read only their own pixels: the source is uploaded for the region alone (CHB-011)
        const { tex: st, owned } = await this.sourceTexture(p.nodes[0]!, t.region);
        try {
          return await this.chain.run(segs, st, [t.region.x, t.region.y], run);
        } finally {
          if (owned) this.rt.textures.release(st);
        }
      }
      return this.chain.run(segs, p.root === 'texture' ? tex(p.rootId!) : this.dummy(), [0, 0], run, { srcOnGrid: true });
    }
    const a = n.args as Record<string, unknown>;
    const recv = tex(n.inputs[0]!);
    const scale = t.outW / t.region.w;
    switch (n.op) {
      case 'print.combine': {
        // the light law (engine/light.ts lightPasses; contract lightH): passes in linear H, one log at the end
        const chain = this.chainOf(nid);
        const passes = lightPasses(combineArgs(a), lightContext(this.physics, this.graph, chain, chain.length - 1));
        let H: GPUTexture | null = null;
        for (const q of passes) {
          const next = await this.mix(q.mode, H ?? recv, q.b === undefined ? null : tex(q.b), q.m === undefined ? null : tex(q.m), q.flags, q.w);
          if (H) this.rt.textures.release(H);
          H = next;
        }
        return H!;
      }
      case 'composite.mix': {
        // the composite law per entry (contract mixPixel, core blendPixel): exact at coverage 0 and 1; a mix without a
        // mask whose top is a pointwise chain on its backdrop is fused instead (engine/dag.ts fusedMixTop)
        const m = a['mask'] as string | undefined;
        const enc = encodingCode((this.graph.get(n.inputs[0]!)!.info as ImageInfo).domain);
        if (a['blend'] !== 'normal' && enc === 0) return fail('E_DOMAIN', `composite.mix: the blend ${String(a['blend'])} needs a working encoding (rgb or oklab)`);
        return this.mix(MODE.MIX, recv, tex(a['top'] as string), m === undefined ? null : tex(m), m === undefined ? 0 : FLAG.MASK, [a['amount'] as number, blendCode(a['blend']), enc]);
      }
      case 'mask.combine': {
        // the one mask algebra (contract maskCombine): add = max, subtract = v·(1 − c), intersect = v·c
        const mode = ['add', 'subtract', 'intersect'].indexOf(a['mode'] as string);
        return this.mix(MODE.MASK, recv, tex(a['other'] as string), null, 0, [a['amount'] as number, mode]);
      }
      case 'mask.feather': return this.gaussian(recv, featherSigma(a['radius_px'] as number) * scale);
      case 'print.densityMask': {
        // core maskDensityPolar: PD = x_clear − x from the main print.expose, blur the mean transmittance,
        // d = ±γ·(log10 H_m − log10 ref), ref the smallest (positive) or largest (same) H_m
        const gamma = a['gamma'] as number;
        if (gamma === 0) return this.mix(MODE.DENSITY, recv, recv, null, 0, [0, 0]);
        const info = n.info as ImageInfo;
        const chain = this.chainOf(nid);
        const clear = clearExposure(this.physics.ctx(chain, chain.length - 1));
        const T = await this.mix(MODE.TRANSMITTANCE, recv, null, null, 0, [...clear]);
        const Hm = await this.gaussian(T, densityMaskSigma(a['radius_um'] as number, info.umPerPx.film) * scale);
        this.rt.textures.release(T);
        const mo = await this.reducer.moments(Hm, { x: 0, y: 0, w: t.outW, h: t.outH });
        const same = a['polarity'] === 'same';
        const out = await this.mix(MODE.DENSITY, recv, Hm, null, 0, [same ? -gamma : gamma, Math.log10(same ? mo.max[0]! : mo.min[0]!)]);
        this.rt.textures.release(Hm);
        return out;
      }
      case 'clarity': case 'sharpen': {
        // core print/clarity.ts: lightness detail over the low-pass of Y at σ = radius on the print, midtone-weighted for
        // clarity, not for sharpen
        const info = n.info as ImageInfo;
        const chain = this.chainOf(nid);
        const Yw = whiteAt(this.physics.ctx(chain, chain.length - 1))[1];
        const low = await this.gaussian(recv, claritySigma(a['radius_mm'] as number, info.umPerPx.paper, n.op) * scale, 1);
        try {
          return await this.mix(MODE.CLARITY, recv, low, null, 0, [a['strength'] as number, Yw, n.op === 'clarity' ? 1 : 0]);
        } finally {
          this.rt.textures.release(low);
        }
      }
      case 'heal': case 'clone': {
        // spots in order, each reading the image the spots before it left (src/retouch.ts, kernels/retouch.wgsl)
        if (this.retouchK?.rt !== this.rt) this.retouchK = { rt: this.rt, k: new Retouch(this.rt, (tx, w, h) => this.chain.readTexture(tx, w, h)) };
        const info = n.info as ImageInfo;
        const win = async (box: Box): Promise<GPUTexture> => (await this.renderGraph(n.inputs[0]!, { ...t, outW: box.w, outH: box.h, region: box })).tex;
        return this.retouchK.k.apply(recv, n.op, a['spots'] as readonly RepairSpot[], info.domain === 'scanner-density' ? 'density' : 'linear', { outW: t.outW, outH: t.outH, frameW: t.frameW, frameH: t.frameH, region: t.region }, win);
      }
      default: {
        if (n.op === 'output.frame') return fail('E_NOT_IMPLEMENTED', 'output.frame is the display cut\'s last step on the GPU: nothing may read it');
        if (!FILM_OPS.has(n.op)) return fail('E_INTERNAL', `${n.op} is not a GPU barrier op`);
        // CHB-012 film ops (src/film.ts): bindings from core, on the output grid
        const chain = this.chainOf(nid);
        return this.film.run(n, recv, this.physics.ctx(chain, chain.length - 1), t, (sha) => this.graph.source(sha));
      }
    }
  }

  /** A Gaussian blur of σ output px, one channel or all (engine/textures.ts); a new texture. */
  private gaussian(src: GPUTexture, sigma: number, channel?: number): Promise<GPUTexture> {
    return gaussianBlur(this.rt, this.blur, src, sigma, (t) => this.mix(MODE.COPY, t), channel);
  }

  private dummy(): GPUTexture {
    this.dummyTex ??= this.rt.device.createTexture({ size: [1, 1], format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING });
    return this.dummyTex;
  }

  /** One pass of kernels/combine.wgsl (engine/textures.ts); returns a new texture (release it). */
  private mix(mode: number, a: GPUTexture, b: GPUTexture | null = null, m: GPUTexture | null = null, flags = 0, w: number[] = []): Promise<GPUTexture> {
    return combinePass(this.rt, this.dummy(), mode, a, b, m, flags, w);
  }

  private checkTarget(n: Node, target: EvalTarget): { info: ImageInfo; region: Box; scale: number } {
    if (target.signal?.aborted) throw cancelled();
    if (n.info.kind !== 'Image') fail('E_WRONG_KIND', `${n.op} returns a value; use measure()`);
    this.check(n);
    const info = n.info as ImageInfo;
    const region = target.region ?? { x: 0, y: 0, w: info.width, h: info.height };
    if (region.x < 0 || region.y < 0 || region.w <= 0 || region.h <= 0 || region.x + region.w > info.width || region.y + region.h > info.height || ![region.x, region.y, region.w, region.h].every(Number.isInteger)) {
      fail('E_ARG_RANGE', 'region lies outside the image', { valid: [`{x: 0, y: 0, w: ${info.width}, h: ${info.height}}`] });
    }
    const scale = quantizeScale(target.scale);
    if (!(scale > 0 && scale <= 1)) fail('E_ARG_RANGE', `scale ${target.scale} must be in (0, 1] or 'full'`);
    return { info, region, scale };
  }

  /**
   * Evaluates a node over `region` at `scale` through the DAG evaluation (renderGraph, CHB-010); `read`
   * turns the output texture into the result (f32 readback, or CHB-011's 16-bit pack).
   */
  private async render<T>(n: Node, info: ImageInfo, region: Box, scale: number, precision: EvalTarget['precision'], read: (tex: GPUTexture, w: number, h: number) => Promise<T>): Promise<{ px: T; width: number; height: number; warnings: Diagnostic[] }> {
    const width = Math.max(1, Math.round(region.w * scale));
    const height = Math.max(1, Math.round(region.h * scale));
    const grid: GridTarget = { outW: width, outH: height, frameW: info.width, frameH: info.height, region, precision };
    const r = await this.gpu(async () => {
      const g = await this.renderGraph(n.id, grid);
      try {
        return { px: await read(g.tex, width, height), warnings: g.warnings };
      } finally {
        this.rt.textures.release(g.tex);
      }
    });
    return { px: r.px, width, height, warnings: r.warnings };
  }

  /**
   * CHB-011 export precision path: the node at export precision as 16-bit RGB codes, packed on the GPU
   * with pack2x16unorm (8 bytes per pixel read back instead of 16) and never cached. For display-rgb
   * nodes (encoded values in [0, 1]); the tiled export runner calls it per tile.
   */
  async evaluateU16(ref: NodeRef, target: Omit<EvalTarget, 'precision'>): Promise<U16Result> {
    const n = this.node(ref);
    const { info, region, scale } = this.checkTarget(n, { ...target, precision: 'export' });
    if (info.domain !== 'display-rgb') fail('E_DOMAIN', `evaluateU16 packs display-rgb, not ${info.domain}`);
    const r = await this.render(n, info, region, scale, 'export', (tex, w, h) => this.readU16(tex, w, h));
    if (target.signal?.aborted) throw cancelled();
    return { node: n.id, width: r.width, height: r.height, region: { ...region }, scale, data: r.px, warnings: r.warnings };
  }

  async evaluate(ref: NodeRef, target: EvalTarget): Promise<ImageResult> {
    const n = this.node(ref);
    const { info, region, scale } = this.checkTarget(n, target);
    const key = `${n.id}|${scale}|${region.x},${region.y},${region.w},${region.h}|${target.precision}`;
    let res = this.results.get(key);
    if (!res) {
      const r = await this.render(n, info, region, scale, target.precision, (tex, w, h) => this.chain.readTexture(tex, w, h));
      const { width, height, px } = r;
      if (target.signal?.aborted) throw cancelled(); // nothing partial enters the cache
      const c = info.channels;
      const data = new Float32Array(width * height * c);
      for (let i = 0; i < width * height; i++) for (let k = 0; k < c; k++) data[i * c + k] = px[4 * i + k]!;
      res = { data, width, height, region, scale, warnings: r.warnings };
      this.cacheResult(key, res);
    } else {
      // most recently used last
      this.results.delete(key);
      this.results.set(key, res);
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
        const tex = await this.uploadMeasured(data, img.width, img.height, info.channels);
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
      const tex = await this.uploadMeasured(data, img.width, img.height, info.channels);
      try {
        return await this.reduce(n.op, a, tex, img.width, img.height, info, recvId);
      } finally {
        this.rt.textures.release(tex);
      }
    });
    if (spec.signal?.aborted) throw cancelled();
    return { node: n.id, value, warnings: [] };
  }

  private reduce(op: string, a: Record<string, unknown>, tex: GPUTexture, w: number, h: number, info: ImageInfo, recvId: string): Promise<Record<string, unknown>> {
    // densities of a mean pixel are core's (Status M through the stock, or −log10 of XYZ over the white)
    const densities = (mean: number[]) => {
      const chain = this.chainOf(recvId);
      return densitiesOf(this.physics.ctx(chain, chain.length), info.domain, mean as Vec3);
    };
    return reduceMeasure(this.reducer, op, a, tex, w, h, info, densities);
  }
}

/**
 * Fits core's fallback spectra in a worker and seeds core's cache with them (CHB-034): without it the first film of
 * a session fits them on the main thread (~110 ms, a visible stall during the first open). Not awaited: a file
 * opened before the worker answers fits them itself, with the same result.
 */
function prefitSpectra(data: PhysicsData): void {
  if (typeof Worker === 'undefined') return;
  let w: Worker;
  try {
    w = new Worker(new URL('./tables/spectra-worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return;
  }
  const cmf = data.cmf();
  w.onmessage = (ev: MessageEvent<SpectraReply>) => {
    const r = ev.data;
    if (r.data && r.n && r.source) seedFallbackSpectra(data, { n: r.n, data: r.data, source: r.source });
    w.terminate();
  };
  w.onerror = () => w.terminate();
  const job: SpectraJob = { cmf: [Float64Array.from(cmf[0]), Float64Array.from(cmf[1]), Float64Array.from(cmf[2])] };
  w.postMessage(job);
}
