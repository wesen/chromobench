// GpuEngine: the Engine interface on WebGPU (guide §3, §5.5). Pointwise chains lower to programs of
// kernels/pointwise.wgsl (one dispatch per segment); measure() runs GPU reductions.
//
// Physics: @chromobench/core's (CHB-017). Stocks come from a PhysicsData (default: core's interim set,
// physics/data.ts — the CHB-004 switch point); tables, aim, filtration, flare, adaptation and display
// matrices from physics/core.ts. The GPU only applies the uniforms and tables it is handed.
import {
  ChromobenchError, DOMAINS, fail, getOp, Graph, quantizeScale, sha256Hex,
  type Box, type Diagnostic, type Engine, type EngineCaps, type EvalTarget, type ImageInfo, type ImageResult,
  type Measurement, type MeasureSpec, type Node, type NodeDef, type NodeRef, type SourceInfo, type SourceRef, type TableKey, type TilePlan,
} from '@chromobench/contract';
import { readTiff } from '@chromobench/engine-mock';
import { ChainRunner, POINTWISE_WGSL } from './chain/run.ts';
import pack16Code from '../kernels/pack16.wgsl?raw';
import { lowerDisplay, OP, type PwOp, type Segment, type SegmentTables } from './chain/program.ts';
import { GpuRuntime, type AccelChoice, type RuntimeOptions } from './device.ts';
import { histPercentile, REDUCE_WGSL, Reducer } from './measure.ts';
import { densitiesOf, rebateBox, type PhysicsData } from '@chromobench/core';
import { CorePhysics } from './physics/core.ts';
import { defaultPhysicsData } from './physics/data.ts';
import { planTiles, type GpuTilePlan } from './tiles.ts';
import { WorkerPool } from './tables/build-workers.ts';
import { OpfsStore, TableCache } from './tables/cache.ts';
import { TableManager } from './tables/manager.ts';
import type { Mat3, Vec3 } from './tables/inputs.ts';

export const GPU_OPS = [
  'source.open', 'source.pattern', 'scan.density', 'invert.dyes', 'print.expose', 'print.lights', 'print.develop',
  'view.reflect', 'view.flare', 'view.adapt', 'output.display', 'film.grain',
  'measure.stats', 'measure.histogram', 'measure.patches', 'measure.densitometer',
] as const;

const DEFAULT_UM_PER_PX = 6;
const PACK16_WGSL: string = pack16Code;

export interface GpuEngineOptions extends RuntimeOptions {
  runtime?: GpuRuntime;
  accel?: AccelChoice;
  /** Use OPFS for the table cache (default true when available). */
  opfs?: boolean;
  /** f64 worker pool size (0: no workers). */
  workers?: number;
  /** Compile the chain and reduction pipelines at creation (default true). */
  prewarm?: boolean;
  /** Stock and reference data (default: core's interim set; CHB-004's packs plug in here). */
  data?: PhysicsData;
}

/**
 * A source image on the CPU: f32 samples (patterns, 8-bit files), or a 16-bit scan kept as its
 * Uint16Array (`u16`, `samples` per pixel; CHB-011), uploaded tile by tile as rgba16uint.
 */
interface SourceImg { w: number; h: number; c: number; data?: Float32Array; u16?: Uint16Array; samples?: number; max?: number }
interface Lowered { root: Node; segments: Segment[]; warnings: Diagnostic[] }
interface Cached { data: Float32Array; width: number; height: number; region: Box; scale: number; warnings: Diagnostic[] }

/** Result-cache budget: oldest entries go first (tiles of a large export must not pile up). */
const RESULT_CACHE_BYTES = 256 * 2 ** 20;

/** CHB-011: 16-bit RGB codes of a display-rgb node, packed on the GPU (pack2x16unorm). */
export interface U16Result { node: string; width: number; height: number; region: Box; scale: number; data: Uint16Array; warnings: Diagnostic[] }

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
  private disposed = false;
  private recreating: Promise<void> | null = null;

  private constructor(rt: GpuRuntime, opts: GpuEngineOptions, owns: boolean) {
    this.rt = rt;
    this.opts = opts;
    this.ownsRuntime = owns;
    this.pool = (opts.workers ?? 0) > 0 && typeof Worker !== 'undefined' ? new WorkerPool(opts.workers) : null;
    this.cache = new TableCache(opts.opfs !== false && OpfsStore.available() ? new OpfsStore() : null);
    this.physics = new CorePhysics(opts.data ?? defaultPhysicsData());
    this.tables = new TableManager(rt, { accel: opts.accel ?? 'auto', workers: this.pool, cache: this.cache, conventions: this.physics.conventions });
    this.chain = new ChainRunner(rt, this.tables);
    this.reducer = new Reducer(rt);
    rt.onLost(() => this.dropDeviceState());
  }

  static async create(opts: GpuEngineOptions = {}): Promise<GpuEngine> {
    const rt = opts.runtime ?? (await GpuRuntime.create(opts));
    const e = new GpuEngine(rt, opts, !opts.runtime);
    // prewarm (guide §5.2): compile the chain and reduction kernels now, not on the first slider move
    if (opts.prewarm !== false) {
      await rt.pipelines.prewarm([
        { name: 'pointwise', code: POINTWISE_WGSL },
        { name: 'reduce.moments', code: REDUCE_WGSL, entryPoint: 'moments' },
        { name: 'reduce.histogram', code: REDUCE_WGSL, entryPoint: 'histogram' },
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
    for (const b of this.unpackLut.values()) b.destroy();
    this.unpackLut.clear();
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

  private lower(nodes: Node[], treb: Map<string, Vec3>): Lowered {
    // Every parameter comes from core (physics/core.ts): the same chain settings, aim, tables, flare
    // white, adaptation and display matrix the reference engine uses for the same nodes.
    const P = this.physics;
    const segments: Segment[] = [];
    const warnings: Diagnostic[] = [];
    let cur: Segment = { ops: [], tables: {} };
    const push = (op: PwOp, need: Partial<SegmentTables> = {}, disp?: Mat3, ok?: [Mat3, Mat3]) => {
      const clash = (Object.keys(need) as (keyof SegmentTables)[]).some((k) => cur.tables[k] && cur.tables[k] !== need[k]);
      if (cur.ops.length >= 12 || clash || (disp && cur.disp)) {
        segments.push(cur);
        cur = { ops: [], tables: {} };
      }
      Object.assign(cur.tables, need);
      if (disp) cur.disp = disp;
      if (ok) cur.ok = ok;
      cur.ops.push(op);
    };
    for (let i = 0; i < nodes.length; i++) {
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
        case 'print.develop': push({ code: OP.DEVELOP, node: n.id }, { curves: P.developRow(a['paper'] as string, a['grade'] as number) }); break;
        case 'view.reflect': push({ code: OP.REFLECT, node: n.id }, { print: P.printInputs(P.paperOf(ctx), a['illuminant'] as string) }); break;
        case 'view.flare': push({ code: OP.FLARE, p0: P.flare(ctx, a['flare'] as number), p1: [1], node: n.id }); break;
        case 'view.adapt': push({ code: OP.ADAPT, p0: P.adaptGains(ctx, a['to']), node: n.id }); break;
        case 'output.display': {
          // core's display setup (CHB-011): every space, both renderings, clip / tanh / oklch knees
          const d = lowerDisplay(P.display(ctx, a), n.id);
          if (d.approx) warnings.push({ code: 'W_PREVIEW_APPROX', message: 'the cam16-ucs knee has no GPU kernel yet; the oklch knee is used instead' });
          push(d.op, {}, d.disp, d.ok);
          break;
        }
        case 'film.grain': {
          push({ code: OP.GRAIN, flags: (a['seed'] as number) >>> 0, p0: [a['amount'] as number, 0], node: n.id });
          break;
        }
        default: fail('E_NOT_IMPLEMENTED', `${n.op} has no GPU lowering`);
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

  /**
   * The source as an rgba32float texture covering `rect` of the frame (the chain reads it with srcOrigin
   * = rect's corner). The full frame is cached per source; a sub-rectangle (a tile of an export, a rebate
   * box) is uploaded for this call only and returned `owned` (CHB-011: no full-frame upload for a tile).
   */
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
      tex = this.chain.upload(sub, rect.w, rect.h, img.c, label);
    }
    if (full) this.srcTex.set(root.id, tex);
    return { tex, owned: !full };
  }

  /** A rectangle of a 16-bit source → rgba16uint upload → rgba32float by kernels/pack16.wgsl `unpack`. */
  private async uploadU16(img: SourceImg, rect: Box, label: string): Promise<GPUTexture> {
    const rt = this.rt;
    const src = img.u16!;
    const s = img.samples ?? 3;
    const rgba = new Uint16Array(rect.w * rect.h * 4);
    for (let y = 0; y < rect.h; y++) {
      let o = y * rect.w * 4;
      let i = ((rect.y + y) * img.w + rect.x) * s;
      for (let x = 0; x < rect.w; x++, o += 4, i += s) {
        rgba[o] = src[i]!;
        rgba[o + 1] = src[i + (s === 3 ? 1 : 0)]!;
        rgba[o + 2] = src[i + (s === 3 ? 2 : 0)]!;
        rgba[o + 3] = 65535;
      }
    }
    const t16 = rt.textures.acquire({ format: 'rgba16uint', w: rect.w, h: rect.h, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST }, `${label}.u16`);
    rt.device.queue.writeTexture({ texture: t16 }, rgba, { bytesPerRow: rect.w * 8 }, [rect.w, rect.h]);
    const out = rt.textures.acquire({ format: 'rgba32float', w: rect.w, h: rect.h, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING }, label);
    const pipe = await rt.pipelines.get({ name: 'pack16.unpack', code: PACK16_WGSL, entryPoint: 'unpack' });
    // code/max through a table, not code × f32(1/max): the product rounds twice and differs from the
    // f32 path's correctly rounded quotient by an ulp on some codes, which the chain parity sees
    const max = img.max ?? 65535;
    let lut = this.unpackLut.get(max);
    if (!lut) {
      const t = new Float32Array(max + 1);
      for (let i = 0; i <= max; i++) t[i] = i / max;
      lut = rt.device.createBuffer({ size: t.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, label: `pack16.lut${max}` });
      rt.device.queue.writeBuffer(lut, 0, t);
      this.unpackLut.set(max, lut);
    }
    const ub = rt.buffers.acquire({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }, 'pack16.u');
    rt.device.queue.writeBuffer(ub, 0, new Uint32Array([rect.w, rect.h, 0, 0]));
    const bg = rt.device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ub, size: 32 } }, { binding: 1, resource: t16.createView() }, { binding: 2, resource: out.createView() }, { binding: 6, resource: { buffer: lut } }] });
    const enc = rt.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipe);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(Math.ceil(rect.w / 8), Math.ceil(rect.h / 8));
    pass.end();
    rt.device.queue.submit([enc.finish()]);
    rt.buffers.release(ub);
    rt.textures.release(t16);
    return out;
  }

  /** The chain's rgba32float output → 16-bit RGB codes (kernels/pack16.wgsl `pack`, pack2x16unorm). */
  private async readU16(tex: GPUTexture, w: number, h: number): Promise<Uint16Array> {
    const rt = this.rt;
    const pipe = await rt.pipelines.get({ name: 'pack16.pack', code: PACK16_WGSL, entryPoint: 'pack' });
    const bytes = w * h * 8;
    const sb = rt.buffers.acquire({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }, 'pack16.out');
    const ub = rt.buffers.acquire({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }, 'pack16.u');
    rt.device.queue.writeBuffer(ub, 0, new Uint32Array([w, h, 0, 0]));
    const bg = rt.device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 3, resource: { buffer: ub, size: 32 } }, { binding: 4, resource: tex.createView() }, { binding: 5, resource: { buffer: sb, size: bytes } }] });
    const enc = rt.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipe);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
    pass.end();
    rt.device.queue.submit([enc.finish()]);
    const raw = await rt.readBuffer(sb, bytes);
    rt.buffers.release(sb);
    rt.buffers.release(ub);
    // pack2x16unorm puts the first component in the low half; WebGPU platforms are little-endian
    const u16 = new Uint16Array(raw);
    const out = new Uint16Array(w * h * 3);
    for (let i = 0; i < w * h; i++) { out[3 * i] = u16[4 * i]!; out[3 * i + 1] = u16[4 * i + 1]!; out[3 * i + 2] = u16[4 * i + 2]!; }
    return out;
  }

  /** Adds a result, then drops the least recently used ones over RESULT_CACHE_BYTES (the new one stays). */
  private cacheResult(key: string, res: Cached): void {
    this.results.set(key, res);
    let bytes = 0;
    for (const r of this.results.values()) bytes += r.data.byteLength;
    for (const [k, r] of this.results) {
      if (bytes <= RESULT_CACHE_BYTES || k === key) break;
      this.results.delete(k);
      bytes -= r.data.byteLength;
    }
  }

  /** Rebate transmittance for scan.density nodes: mean of the receiver over the rebate box. */
  private async rebates(nodes: Node[]): Promise<Map<string, Vec3>> {
    const out = new Map<string, Vec3>();
    for (const n of nodes) {
      if (n.op !== 'scan.density') continue;
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
    }
    return out;
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

  /** Lowers and runs a node's chain over `region`; `read` turns the output texture into the result. */
  private async render<T>(n: Node, info: ImageInfo, region: Box, scale: number, precision: EvalTarget['precision'], read: (tex: GPUTexture, w: number, h: number) => Promise<T>): Promise<{ px: T; width: number; height: number; warnings: Diagnostic[] }> {
    const nodes = this.chainOf(n.id);
    const treb = await this.rebates(nodes);
    const low = this.lower(nodes, treb);
    const width = Math.max(1, Math.round(region.w * scale));
    const height = Math.max(1, Math.round(region.h * scale));
    const um = (info.umPerPx.film ?? DEFAULT_UM_PER_PX) * (region.w / width);
    this.fillGrain(low.segments, nodes, um);
    const px = await this.gpu(async () => {
      // pointwise chains read only their own pixels: the source is uploaded for the region alone
      const { tex, owned } = await this.sourceTexture(low.root, region);
      try {
        const segs = low.segments.length ? low.segments : [{ ops: [], tables: {} }];
        const out = await this.chain.run(segs, tex, [region.x, region.y], { outW: width, outH: height, frameW: info.width, frameH: info.height, region, precision });
        try {
          return await read(out, width, height);
        } finally {
          this.rt.textures.release(out);
        }
      } finally {
        if (owned) this.rt.textures.release(tex);
      }
    });
    return { px, width, height, warnings: low.warnings };
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
