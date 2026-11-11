// GpuEngine: the Engine interface on WebGPU (guide §3, §5.5). Pointwise chains lower to programs of
// kernels/pointwise.wgsl (one dispatch per segment); measure() runs GPU reductions.
//
// INTERIM physics: op parameters (aim, printer lights from time/f-stop/filtration, flare, illuminants)
// come from src/physics (a Chromogen port) until CHB-003's core provides them; the GPU only applies
// the uniforms and tables it is handed. Each interim choice is marked TODO(CHB-0NN).
import {
  ChromobenchError, DOMAINS, fail, getOp, Graph, quantizeScale, sha256Hex,
  type Box, type Diagnostic, type Engine, type EngineCaps, type EvalTarget, type ImageInfo, type ImageResult,
  type Measurement, type MeasureSpec, type Node, type NodeDef, type NodeRef, type SourceInfo, type SourceRef, type TableKey, type TilePlan,
} from '@chromobench/contract';
import { readTiff } from '@chromobench/engine-mock';
import { ChainRunner } from './chain/run.ts';
import { OP, type PwOp, type Segment, type SegmentTables } from './chain/program.ts';
import { GpuRuntime, type AccelChoice, type RuntimeOptions } from './device.ts';
import { histPercentile, Reducer } from './measure.ts';
import { chromogenOracle } from './physics/oracle.ts';
import { chainConstants, interimAim, pdInputs, printInputs, solveInputs } from './physics/setup.ts';
import { scannerChannels, type Stock } from './physics/spectral.ts';
import { camera, stock } from './physics/stocks.ts';
import { planTiles, type GpuTilePlan } from './tiles.ts';
import { WorkerPool } from './tables/build-workers.ts';
import { OpfsStore, TableCache } from './tables/cache.ts';
import { TableManager } from './tables/manager.ts';
import type { Vec3 } from './tables/inputs.ts';

export const GPU_OPS = [
  'source.open', 'source.pattern', 'scan.density', 'invert.dyes', 'print.expose', 'print.lights', 'print.develop',
  'view.reflect', 'view.flare', 'output.display', 'film.grain',
  'measure.stats', 'measure.histogram', 'measure.patches', 'measure.densitometer',
] as const;

const DEFAULT_UM_PER_PX = 6;
const ILLUMINANT_K: Record<string, number> = { D50: 5003, D55: 5503, D65: 6504, A: 2856 };

export interface GpuEngineOptions extends RuntimeOptions {
  runtime?: GpuRuntime;
  accel?: AccelChoice;
  /** Use OPFS for the table cache (default true when available). */
  opfs?: boolean;
  /** f64 worker pool size (0: no workers). */
  workers?: number;
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
  private readonly opts: GpuEngineOptions;
  private readonly pool: WorkerPool | null;
  private readonly cache: TableCache;
  private readonly sources = new Map<string, SourceImg>();
  private readonly srcTex = new Map<string, GPUTexture>();
  private readonly results = new Map<string, Cached>();
  private disposed = false;
  private recreating: Promise<void> | null = null;

  private constructor(rt: GpuRuntime, opts: GpuEngineOptions, owns: boolean) {
    this.rt = rt;
    this.opts = opts;
    this.ownsRuntime = owns;
    this.pool = (opts.workers ?? 0) > 0 && typeof Worker !== 'undefined' ? new WorkerPool(opts.workers) : null;
    this.cache = new TableCache(opts.opfs !== false && OpfsStore.available() ? new OpfsStore() : null);
    this.tables = new TableManager(rt, { accel: opts.accel ?? 'auto', workers: this.pool, cache: this.cache });
    this.chain = new ChainRunner(rt, this.tables);
    this.reducer = new Reducer(rt);
    rt.onLost(() => this.dropDeviceState());
  }

  static async create(opts: GpuEngineOptions = {}): Promise<GpuEngine> {
    const rt = opts.runtime ?? (await GpuRuntime.create(opts));
    return new GpuEngine(rt, opts, !opts.runtime);
  }

  get runtime(): GpuRuntime { return this.rt; }

  capabilities(): EngineCaps {
    const c = this.rt.caps;
    return {
      ops: [...GPU_OPS].sort(), maxSize: c.limits.maxTextureDimension2D, f16: c.features.f16, timestamps: c.features.timestamps,
      precision: ['preview', 'export'], available: c.available, adapter: { name: this.rt.name, fallback: c.adapter.fallback },
      maxTextureDimension2D: c.limits.maxTextureDimension2D, maxBufferSize: c.limits.maxBufferSize, float32Filterable: c.features.float32Filterable,
      budgetBytes: c.budgetBytes, conventions: 'chromogen-interim-0',
    };
  }

  // ---- device loss: drop GPU state, keep CPU state; recreate on the next call ----
  private dropDeviceState(): void {
    this.srcTex.clear();
  }

  private async ensure(): Promise<void> {
    if (this.disposed) fail('E_INTERNAL', 'engine disposed');
    if (!this.rt.lost) return;
    this.recreating ??= (async () => {
      const rt = await GpuRuntime.create(this.opts);
      this.rt = rt;
      this.tables = new TableManager(rt, { accel: this.opts.accel ?? 'auto', workers: this.pool, cache: this.cache });
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
    const segments: Segment[] = [];
    const warnings: Diagnostic[] = [];
    let cur: Segment = { ops: [], tables: {} };
    let film: Stock | null = null;
    let paper: Stock | null = null;
    let printInp: ReturnType<typeof printInputs> | null = null;
    const push = (op: PwOp, need: Partial<SegmentTables> = {}) => {
      const clash = (Object.keys(need) as (keyof SegmentTables)[]).some((k) => cur.tables[k] && cur.tables[k] !== need[k]);
      if (cur.ops.length >= 12 || clash) {
        segments.push(cur);
        cur = { ops: [], tables: {} };
      }
      Object.assign(cur.tables, need);
      cur.ops.push(op);
    };
    for (const n of nodes) {
      const a = n.args as Record<string, unknown>;
      switch (n.op) {
        case 'source.open': {
          const enc = a['encoding'];
          if (enc === 'srgb' || enc === 'gamma22') push({ code: OP.DECODE, p0: [enc === 'srgb' ? 1 : 2], node: n.id });
          break;
        }
        case 'source.pattern': break;
        case 'scan.density': push({ code: OP.DENSITY, p0: [...(treb.get(n.id) ?? [1, 1, 1])], node: n.id }); break;
        case 'invert.dyes': {
          film = stock(a['stock'] as string);
          // TODO(CHB-003/CHB-004): scanner models come from core and packs; 'xt5-rgb-led' = Chromogen's xt5-fitted LEDs
          const si = solveInputs(scannerChannels(a['scanner'] as string, camera()), film);
          push({ code: OP.DYES, node: n.id }, { solve: si });
          break;
        }
        case 'print.expose': {
          film ??= stock('kodak_portra_400');
          paper = stock(a['paper'] as string);
          const pd = pdInputs(film, paper, 3200); // TODO(CHB-010): lamp spectra by id ('TH-KG3' ≈ 3200 K blackbody)
          const si = solveInputs(scannerChannels('xt5-fitted', camera()), film);
          const cc = chainConstants(si, paper);
          const f = a['filtration'] as { c: number; m: number; y: number };
          // TODO(CHB-010): real enlarger exposure. Interim: time and f-stop scale all layers; CC filters subtract density/100.
          const t = Math.log10((a['time_s'] as number) / 10) - 2 * Math.log10((a['fstop'] as number) / 8);
          const filt = [f.c, f.m, f.y].map((v) => -v / 100);
          const aim = a['mode'] === 'normalised' ? interimAim(film, paper, pd, cc.clear, (c) => chromogenOracle.spectral(pd, c)) : [0, 0, 0];
          push({ code: OP.EXPOSE, p0: [0, 1, 2].map((k) => cc.clear[k]! + aim[k]! + t + filt[k]!), node: n.id }, { pd });
          break;
        }
        case 'print.lights': push({ code: OP.ADD, p0: [...(a['logH'] as number[])], node: n.id }); break;
        case 'print.develop': {
          paper = stock(a['paper'] as string);
          film ??= stock('kodak_portra_400');
          if (a['grade'] !== 2) warnings.push({ code: 'W_PREVIEW_APPROX', message: 'print.develop grade is not modelled by the interim GPU physics (grade 2 used)' });
          push({ code: OP.DEVELOP, node: n.id }, { curves: { film, paper } });
          break;
        }
        case 'view.reflect': {
          paper ??= stock('kodak_portra_endura');
          const ill = a['illuminant'] as string;
          printInp = printInputs(paper, { viewingK: ILLUMINANT_K[ill] ?? 5003 }); // TODO(CHB-003): CIE illuminant spectra
          push({ code: OP.REFLECT, node: n.id }, { print: printInp });
          break;
        }
        case 'view.flare': {
          const f = (a['flare'] as number) / 100;
          const W = chromogenOracle.spectral(printInp ?? printInputs(paper ?? stock('kodak_portra_endura')), [0, 0, 0]);
          push({ code: OP.FLARE, p0: W.map((w) => w * f), p1: [1 / (1 + f)], node: n.id });
          break;
        }
        case 'output.display': {
          if (a['space'] !== 'srgb') fail('E_NOT_IMPLEMENTED', `output.display space ${String(a['space'])} is not implemented by the GPU engine (srgb only)`, { valid: ['srgb'] });
          const knee = a['knee'];
          if (knee === 'cam16-ucs') warnings.push({ code: 'W_PREVIEW_APPROX', message: 'cam16-ucs knee not implemented on the GPU yet (TODO CHB-011); clipped instead' });
          push({ code: OP.DISPLAY, flags: knee === 'tanh-shoulder' ? 1 : 0, node: n.id });
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
      const box = n.args['rebate'] as Box | undefined;
      if (!box) continue; // TODO(CHB-006): a percentile rebate estimate (W_REBATE_PERCENTILE); interim T_reb = 1
      const r = await this.evaluate({ id: n.inputs[0]!, info: this.graph.get(n.inputs[0]!)!.info }, { scale: 'full', precision: 'export', region: box });
      const d = await r.read();
      const c = r.info.channels;
      const m = [0, 0, 0];
      for (let i = 0; i < r.width * r.height; i++) for (let k = 0; k < 3; k++) m[k]! += d[i * c + Math.min(k, c - 1)]! / (r.width * r.height);
      out.set(n.id, m.map((v) => Math.max(v, 1e-8)) as Vec3);
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
    let res = this.results.get(key);
    if (!res) {
      const nodes = this.chainOf(n.id);
      const treb = await this.rebates(nodes);
      const low = this.lower(nodes, treb);
      const width = Math.max(1, Math.round(region.w * scale));
      const height = Math.max(1, Math.round(region.h * scale));
      const um = (info.umPerPx.film ?? DEFAULT_UM_PER_PX) * (region.w / width);
      this.fillGrain(low.segments, nodes, um);
      const px = await this.gpu(async () => {
        const { tex } = this.sourceTexture(low.root);
        const segs = low.segments.length ? low.segments : [{ ops: [], tables: {} }];
        const out = await this.chain.run(segs, tex, [0, 0], { outW: width, outH: height, frameW: info.width, frameH: info.height, region, precision: target.precision });
        const raw = await this.chain.readTexture(out, width, height);
        this.rt.textures.release(out);
        return raw;
      });
      if (target.signal?.aborted) throw cancelled(); // nothing partial enters the cache
      const c = info.channels;
      const data = new Float32Array(width * height * c);
      for (let i = 0; i < width * height; i++) for (let k = 0; k < c; k++) data[i * c + k] = px[4 * i + k]!;
      res = { data, width, height, region, scale, warnings: low.warnings };
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
        return await this.reduce(n.op, a, tex, img.width, img.height, info);
      } finally {
        this.rt.textures.release(tex);
      }
    });
    if (spec.signal?.aborted) throw cancelled();
    return { node: n.id, value, warnings: [] };
  }

  private async reduce(op: string, a: Record<string, unknown>, tex: GPUTexture, w: number, h: number, info: ImageInfo): Promise<Record<string, unknown>> {
    const full: Box = { x: 0, y: 0, w, h };
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
          const D = [0, 1, 2].map((k) => m.mean[Math.min(k, info.channels - 1)]!);
          cells.push({ cell: j * cols + i, D, visual: (D[0]! + D[1]! + D[2]!) / 3 });
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
        const mean = [0, 1, 2].map((k) => m.mean[Math.min(k, info.channels - 1)]!);
        if (info.domain === 'print-xyz') {
          // TODO(CHB-003): status densities of a print; interim: densities of sRGB-linear reflectance
          const M = [[3.2404542, -1.5371385, -0.4985314], [-0.969266, 1.8760108, 0.041556], [0.0556434, -0.2040259, 1.0572252]];
          const R = M.map((row) => row[0]! * mean[0]! + row[1]! * mean[1]! + row[2]! * mean[2]!);
          return { D: R.map((v) => -Math.log10(Math.max(v, 1e-8))), visual: -Math.log10(Math.max(mean[1]!, 1e-8)) };
        }
        return { D: mean };
      }
      default:
        return fail('E_NOT_IMPLEMENTED', `${op} has no GPU reduction`);
    }
  }
}
