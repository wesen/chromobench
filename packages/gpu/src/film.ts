// The forward film ops on the GPU (CHB-012 guide §5.6): source.xyz, capture.expose, film.couple,
// film.halation, film.develop and film.grain as materialised steps on the output grid. Every binding
// (camera matrix, film table, curves, DIR, halation and grain specs) comes from @chromobench/core's
// *At(ctx, args) helpers, the same ones the reference engine's adapters use; the GPU applies them in
// f32 with kernels/film.wgsl and the separable blur of spatial.ts.
import { fail, type ImageInfo, type Node, type SourceInfo } from '@chromobench/contract';
import {
  coupleCurvesAt, crystals, developCurvesAt, dirAt, EXP_GAUSSIANS, exposerAt, filmOf, filmUmPerPx, grainAt, halationAt, inhibitorKernel, interpClamp,
  sceneMatrixAt, type ChainCtx, type FilmCurves, type Mat3,
} from '@chromobench/core';
import filmCode from '../kernels/film.wgsl?raw';
import type { GpuRuntime } from './device.ts';
import { Blur } from './spatial.ts';

export const FILM_WGSL: string = filmCode;
/** The ops this module runs (all materialised: spatial ones need neighbours, the rest keep it uniform). */
export const FILM_OPS: ReadonlySet<string> = new Set(['source.xyz', 'capture.expose', 'film.couple', 'film.halation', 'film.develop', 'film.grain']);

/** Largest σ (px) of one blur pass (spatial.ts MAX_RADIUS = 3σ = 96). */
const MAX_PASS_SIGMA = 32;
/** Samples of a curve row on a uniform axis when the stock's log H axis is not uniform. */
const CURVE_N = 2048;
/** Samples of a sublayer split row (d → sublayer dye) per channel and sublayer. */
const SUB_N = 512;

export interface FilmGrid {
  outW: number; outH: number;
  frameW: number; frameH: number;
  region: { x: number; y: number; w: number; h: number };
}

interface Uniforms {
  m?: Mat3; s?: number[]; g?: number[]; d?: number[]; u?: number[]; o?: number[];
}

function packUniforms(p: Uniforms): ArrayBuffer {
  const buf = new ArrayBuffer(128);
  const f = new Float32Array(buf), u = new Uint32Array(buf), i = new Int32Array(buf);
  const m = p.m ?? [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) f[r * 4 + c] = m[r]![c]!;
  (p.s ?? []).forEach((v, k) => { f[12 + k] = v; });
  (p.g ?? []).forEach((v, k) => { f[16 + k] = v; });
  (p.d ?? []).forEach((v, k) => { f[20 + k] = v; });
  (p.u ?? []).forEach((v, k) => { u[24 + k] = v >>> 0; });
  (p.o ?? []).forEach((v, k) => { i[28 + k] = v | 0; });
  return buf;
}

/** The three curve rows on a uniform axis: { data (3·n), x0, invDx, n }; the gamma stays a uniform. */
export function curveRows(c: FilmCurves): { data: Float32Array<ArrayBuffer>; x0: number; invDx: number; n: number; gamma: number[] } {
  const x = c.logH;
  const n0 = x.length;
  const dx = (x[n0 - 1]! - x[0]!) / (n0 - 1);
  let uniform = true;
  for (let i = 0; i < n0; i++) if (Math.abs(x[i]! - (x[0]! + i * dx)) > 1e-9 * Math.abs(dx) * n0) { uniform = false; break; }
  const n = uniform ? n0 : CURVE_N;
  const step = (x[n0 - 1]! - x[0]!) / (n - 1);
  const data = new Float32Array(3 * n);
  for (let k = 0; k < 3; k++) for (let i = 0; i < n; i++) data[k * n + i] = uniform ? c.f[k as 0]![i]! : interpClamp(x, c.f[k as 0]!, x[0]! + i * step);
  return { data, x0: x[0]!, invDx: 1 / step, n, gamma: [...c.gamma] };
}

export class FilmGpu {
  private readonly rt: GpuRuntime;
  private readonly blur: Blur;
  private readonly buffers = new Map<string, GPUBuffer>();
  private readonly unreclaim: () => void;
  constructor(rt: GpuRuntime, blur: Blur) {
    this.rt = rt;
    this.blur = blur;
    // the textures of ones count in the budget and go when memory runs short (CHB-041): the oldest sizes first, the
    // newest only in a recovery (they are made again on the next grain)
    this.unreclaim = rt.addReclaimer((need, all) => {
      let freed = 0;
      const sizes = [...this.onesBySize.keys()];
      for (const k of all ? sizes : sizes.slice(0, -1)) {
        if (freed >= need) break;
        const t = this.onesBySize.get(k)!;
        freed += rt.textures.bytesOfLive(t);
        this.onesBySize.delete(k);
        rt.textures.discard(t);
      }
      return freed;
    });
  }

  /** Forget device objects (device loss, dispose). */
  drop(): void {
    this.unreclaim();
    for (const b of this.buffers.values()) b.destroy();
    this.buffers.clear();
    for (const t of this.onesBySize.values()) this.rt.textures.discard(t);
    this.onesBySize.clear();
  }

  private buffer(key: string, make: () => Float32Array<ArrayBuffer>): GPUBuffer {
    let b = this.buffers.get(key);
    if (!b) {
      const d = make();
      b = this.rt.device.createBuffer({ size: Math.max(16, d.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, label: `film.${key.slice(0, 40)}` });
      this.rt.device.queue.writeBuffer(b, 0, d);
      this.buffers.set(key, b);
    }
    return b;
  }

  private tex(w: number, h: number, label: string): GPUTexture {
    return this.rt.textures.acquire({ format: 'rgba32float', w, h, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST }, label);
  }

  /** One dispatch of an entry point of film.wgsl; returns the new output texture(s). */
  async pass(entry: string, a: GPUTexture, p: Uniforms, o: { b?: GPUTexture; tab?: GPUBuffer; outputs?: 1 | 3 } = {}): Promise<GPUTexture[]> {
    const rt = this.rt;
    rt.check();
    const dev = rt.device;
    const pipe = await rt.pipelines.get({ name: `film.${entry}`, code: FILM_WGSL, entryPoint: entry });
    const W = a.width, H = a.height;
    const outs = Array.from({ length: o.outputs ?? 1 }, (_, i) => this.tex(W, H, `film.${entry}.${i}`));
    const ubytes = packUniforms(p);
    const ub = rt.buffers.acquire({ size: ubytes.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }, 'film.u');
    dev.queue.writeBuffer(ub, 0, ubytes);
    const entries: GPUBindGroupEntry[] = [
      { binding: 0, resource: { buffer: ub, size: ubytes.byteLength } },
      { binding: 1, resource: a.createView() },
      { binding: 3, resource: outs[0]!.createView() },
    ];
    if (o.b) entries.push({ binding: 2, resource: o.b.createView() });
    if (o.tab) entries.push({ binding: 4, resource: { buffer: o.tab } });
    if (outs.length === 3) entries.push({ binding: 5, resource: outs[1]!.createView() }, { binding: 6, resource: outs[2]!.createView() });
    const bg = dev.createBindGroup({ label: pipe.label, layout: pipe.getBindGroupLayout(0), entries });
    const enc = dev.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipe);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8));
    pass.end();
    dev.queue.submit([enc.finish()]);
    await dev.queue.onSubmittedWorkDone();
    rt.buffers.release(ub);
    return outs;
  }

  private async one(entry: string, a: GPUTexture, p: Uniforms, o: { b?: GPUTexture; tab?: GPUBuffer } = {}): Promise<GPUTexture> {
    return (await this.pass(entry, a, p, o))[0]!;
  }

  /** Separable Gaussian with σ px per channel; several passes beyond MAX_PASS_SIGMA (σ² adds). */
  async gauss(src: GPUTexture, sig: readonly number[]): Promise<GPUTexture> {
    const smax = Math.max(...sig);
    const passes = Math.max(1, Math.ceil((smax / MAX_PASS_SIGMA) ** 2));
    const s = sig.map((v) => v / Math.sqrt(passes));
    let cur = await this.blur.gaussian(src, [s[0] ?? 0, s[1] ?? 0, s[2] ?? 0, 0]);
    for (let i = 1; i < passes; i++) {
      const next = await this.blur.gaussian(cur, [s[0] ?? 0, s[1] ?? 0, s[2] ?? 0, 0]);
      this.rt.textures.release(cur);
      cur = next;
    }
    return cur;
  }

  /** Σ_t w_t ⊙ (G_{σ_t} ∗ src) per channel (σ px; σ = 0 is the identity). */
  async mixture(src: GPUTexture, terms: readonly { w: readonly number[]; sigma: readonly number[] }[]): Promise<GPUTexture> {
    let acc: GPUTexture | null = null;
    for (const t of terms) {
      if (t.w.every((v) => v === 0)) continue;
      const blurred = t.sigma.some((v) => v > 0) ? await this.gauss(src, t.sigma) : src;
      const next: GPUTexture = acc
        ? await this.one('axpy', acc, { g: [...t.w] }, { b: blurred })
        : await this.one('axpy', blurred, { u: [0, 4], m: [[t.w[0]!, t.w[1]!, t.w[2]!], [0, 0, 0], [0, 0, 0]], g: [0, 0, 0] }, { b: blurred });
      if (blurred !== src) this.rt.textures.release(blurred);
      if (acc) this.rt.textures.release(acc);
      acc = next;
    }
    return acc ?? this.one('axpy', src, { u: [0, 4], m: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], g: [0, 0, 0] }, { b: src });
  }

  /**
   * How far (px at full resolution) film op `n` reads around a pixel: its blurs' reach as gauss() and mixture() run
   * them (passes of σ/√p, each truncated at ⌈3σ⌉ ≤ 96); the halation's scatter and bounce mixtures add (CHB-037 P3b:
   * the tile halo of an exact export).
   */
  reach(n: Node, ctx: ChainCtx): number {
    if (n.op !== 'film.couple' && n.op !== 'film.halation') return 0;
    const a = n.args as Record<string, unknown>;
    const um = filmUmPerPx(n.info as ImageInfo); // only the ops with a physical size need the pitch (as run())
    const g = (sig: number): number => {
      if (!(sig > 0)) return 0;
      const p = Math.max(1, Math.ceil((sig / MAX_PASS_SIGMA) ** 2));
      return p * Math.min(96, Math.ceil((3 * sig) / Math.sqrt(p)));
    };
    const max = (v: readonly number[]): number => Math.max(0, ...v);
    if (n.op === 'film.couple') {
      const dir = dirAt(ctx, filmOf(ctx), a);
      return dir.amount === 0 ? 0 : max(inhibitorKernel(dir).map((k) => g(k.sigma_um / um)));
    }
    if (n.op === 'film.halation') {
      const s = halationAt(ctx, a);
      const sc = s.scatter, hp = s.halation;
      const ch = [0, 1, 2] as const;
      const scatter = sc.amount > 0 ? max([g(max(ch.map((k) => (sc.core_um[k] * sc.scale) / um))), ...EXP_GAUSSIANS.map(([, r]) => g(max(ch.map((k) => (r * sc.tail_um[k] * sc.scale) / um))))]) : 0;
      const amt = ch.map((k) => hp.strength[k] * hp.amount);
      const bounce = hp.bounces >= 1 && amt.some((v) => v > 0) ? max(Array.from({ length: hp.bounces }, (_, i) => g(max(ch.map((k) => (hp.sigma_um[k] * hp.scale * Math.sqrt(i + 1)) / um))))) : 0;
      return scatter + bounce;
    }
    return 0;
  }

  /**
   * Runs film op `n` on its materialised receiver `recv` (output grid `t`), with `ctx` the node's
   * upstream context and `source` the graph's decoded-source facts.
   */
  async run(n: Node, recv: GPUTexture, ctx: ChainCtx, t: FilmGrid, source: (sha: string) => SourceInfo | undefined): Promise<GPUTexture> {
    const a = n.args as Record<string, unknown>;
    const info = n.info as ImageInfo;
    const scale = t.outW / t.region.w;
    // the pitch only where a size is physical (couple, halation, grain): pointwise film ops need none, as in core
    const um = (): number => filmUmPerPx(info) / scale;
    switch (n.op) {
      case 'source.xyz': {
        const sha = ctx.up('source.open')?.args['source'] as string | undefined;
        return this.one('camMatrix', recv, { m: sceneMatrixAt(sha ? source(sha)?.camera : undefined, a) });
      }
      case 'capture.expose': {
        const { film, ex } = exposerAt(ctx, a);
        const tab = this.buffer(`table:${film.table.key}`, () => Float32Array.from(film.table.raw));
        return this.one('expose', recv, { m: ex.M, s: [ex.scale], u: [film.table.n] }, { tab });
      }
      case 'film.develop': {
        const { curves, key } = developCurvesAt(ctx, a);
        const rows = curveRows(curves);
        const tab = this.buffer(`curves:${key}`, () => rows.data);
        return this.one('curves', recv, { s: [rows.x0, rows.invDx], g: rows.gamma, u: [rows.n, 0] }, { tab, b: recv });
      }
      case 'film.couple': {
        const stock = filmOf(ctx);
        const dir = dirAt(ctx, stock, a);
        if (dir.amount === 0) return this.one('axpy', recv, { g: [0, 0, 0] }, { b: recv });
        const c = coupleCurvesAt(ctx);
        const rows = curveRows(c);
        const tab = this.buffer(`curves:couple:${stock}`, () => rows.data);
        const Mt: Mat3 = [0, 1, 2].map((j) => [0, 1, 2].map((k) => dir.M[k]![j]!)) as Mat3;
        const inh = await this.one('inhibit', recv, { m: Mt, s: [rows.x0, rows.invDx], g: rows.gamma, d: [c.max(0), c.max(1), c.max(2)], u: [rows.n, dir.positive ? 2 : 0] }, { tab });
        const K = inhibitorKernel(dir);
        let blurred = inh;
        if (K.length) {
          blurred = await this.mixture(inh, K.map((k) => ({ w: [k.w, k.w, k.w], sigma: [k.sigma_um / um(), k.sigma_um / um(), k.sigma_um / um()] })));
          this.rt.textures.release(inh);
        }
        const out = await this.one('axpy', recv, { g: [-1, -1, -1] }, { b: blurred });
        this.rt.textures.release(blurred);
        return out;
      }
      case 'film.halation': {
        const s = halationAt(ctx, a);
        const E = await this.one('exp10', recv, {});
        const sc = s.scatter;
        let cur = E;
        if (sc.amount > 0) {
          const ch = [0, 1, 2] as const;
          cur = await this.mixture(E, [
            { w: ch.map(() => 1 - sc.amount), sigma: [0, 0, 0] },
            { w: ch.map((k) => sc.amount * (1 - sc.tailWeight[k])), sigma: ch.map((k) => (sc.core_um[k] * sc.scale) / um()) },
            ...EXP_GAUSSIANS.map(([w, r]) => ({ w: ch.map((k) => sc.amount * sc.tailWeight[k] * w), sigma: ch.map((k) => (r * sc.tail_um[k] * sc.scale) / um()) })),
          ]);
          this.rt.textures.release(E);
        }
        const hp = s.halation;
        const amt = [0, 1, 2].map((k) => hp.strength[k as 0] * hp.amount);
        if (hp.bounces >= 1 && amt.some((v) => v > 0)) {
          const dec = Array.from({ length: hp.bounces }, (_, i) => hp.decay ** i);
          const ds = dec.reduce((x, y) => x + y, 0);
          const norm = amt.map((v) => (hp.renormalise ? 1 + v : 1));
          const next = await this.mixture(cur, [
            { w: norm.map((v) => 1 / v), sigma: [0, 0, 0] },
            ...dec.map((d, i) => ({ w: amt.map((v, k) => (v * d) / ds / norm[k]!), sigma: [0, 1, 2].map((k) => (hp.sigma_um[k as 0] * hp.scale * Math.sqrt(i + 1)) / um()) })),
          ]);
          this.rt.textures.release(cur);
          cur = next;
        }
        const out = await this.one('log10e', cur, {});
        this.rt.textures.release(cur);
        return out;
      }
      case 'film.grain': {
        const { spec, sub } = grainAt(ctx, a);
        if (spec.amount === 0) return this.one('axpy', recv, { g: [0, 0, 0] }, { b: recv });
        const { N, od } = crystals(sub, spec, um());
        const span = [0, 1, 2].map((ch) => Math.max(1e-6, sub.d[ch as 0][sub.d[ch as 0].length - 1]!));
        const data = new Float32Array(9 * SUB_N + 27);
        for (let ch = 0; ch < 3; ch++) for (let sl = 0; sl < 3; sl++) for (let i = 0; i < SUB_N; i++) {
          data[(ch * 3 + sl) * SUB_N + i] = interpClamp(sub.d[ch as 0], sub.layer[ch]![sl]!, (span[ch]! * i) / (SUB_N - 1));
        }
        for (let sl = 0; sl < 3; sl++) for (let ch = 0; ch < 3; ch++) {
          const q = 9 * SUB_N + (sl * 3 + ch) * 3;
          data[q] = sub.dmax[sl]![ch]!;
          data[q + 1] = N[sl]![ch]!;
          data[q + 2] = sub.dmin[sl]![ch]!;
        }
        const tab = this.buffer(`grain:${filmOf(ctx)}:${spec.particleArea_um2}:${um()}`, () => data);
        // print-grid keys: frame pixels at scale 1, the preview grid's own pixels below (guide §5.4 decision (c))
        const origin = [Math.round(t.region.x * scale), Math.round(t.region.y * scale)];
        const fields = await this.pass('grainDraw', recv, { m: [span as [number, number, number], [...spec.uniformity] as [number, number, number], [0, 0, 0]], u: [SUB_N, 0, spec.seed >>> 0], o: origin }, { tab, outputs: 3 });
        let sum: GPUTexture | null = null;
        for (let sl = 0; sl < 3; sl++) {
          const sig = [0, 1, 2].map((ch) => spec.dyeCloudBlur * Math.sqrt(od[sl]![ch]!));
          const b = spec.dyeCloudBlur > 0 ? await this.gauss(fields[sl]!, sig) : fields[sl]!;
          if (b !== fields[sl]) this.rt.textures.release(fields[sl]!);
          const next: GPUTexture = sum ? await this.one('axpy', sum, { g: [1, 1, 1] }, { b }) : b;
          if (sum) { this.rt.textures.release(sum); this.rt.textures.release(b); }
          sum = next;
        }
        // − density_min, then the final blur in print-grid pixels, then the amount
        const dm = await this.one('axpy', sum!, { u: [0, 4], m: [[1, 1, 1], [0, 0, 0], [0, 0, 0]], g: spec.densityMin.map((v) => -v) }, { b: await this.ones(sum!) });
        this.rt.textures.release(sum!);
        const fin = spec.finalBlur_px > 0 ? await this.gauss(dm, [spec.finalBlur_px, spec.finalBlur_px, spec.finalBlur_px]) : dm;
        if (fin !== dm) this.rt.textures.release(dm);
        if (spec.amount === 1) return fin;
        // D + amount·(D̂ − D) = (1 − amount)·D + amount·D̂
        const am = spec.amount;
        const out = await this.one('axpy', recv, { u: [0, 4], m: [[1 - am, 1 - am, 1 - am], [0, 0, 0], [0, 0, 0]], g: [am, am, am] }, { b: fin });
        this.rt.textures.release(fin);
        return out;
      }
      default: return fail('E_INTERNAL', `${n.op} is not a film op`);
    }
  }

  /**
   * Textures of ones by grid size, the newest few (CHB-038). There was one, destroyed when another size was asked: a
   * thumbnail's grain (160×107) and the viewer's grain take turns, and each pass awaits its pipeline between getting
   * this texture and submitting, so the other render destroyed it under a pending submit — the owner's repeated
   * "Destroyed texture [Texture (unlabeled 160x107 px, TextureFormat::RGBA32Float)] used in a submit". Now each size
   * keeps its own, and one let go is retired (destroyed when no GPU work is in flight). CHB-041: from the texture pool,
   * so they count in the budget (a 4000-px one is 171 MB), and discarded (retired) when let go.
   */
  private readonly onesBySize = new Map<string, GPUTexture>();
  private static readonly ONES_KEPT = 4;
  /** A texture of ones on the grid of `like`. */
  private async ones(like: GPUTexture): Promise<GPUTexture> {
    const key = `${like.width}x${like.height}`;
    const hit = this.onesBySize.get(key);
    if (hit) {
      this.onesBySize.delete(key);
      this.onesBySize.set(key, hit);
      return hit;
    }
    const t = this.rt.textures.acquire({ format: 'rgba32float', w: like.width, h: like.height, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST }, `film.grain.ones ${key}`);
    this.rt.device.queue.writeTexture({ texture: t }, new Float32Array(like.width * like.height * 4).fill(1), { bytesPerRow: like.width * 16 }, [like.width, like.height]);
    this.onesBySize.set(key, t);
    while (this.onesBySize.size > FilmGpu.ONES_KEPT) {
      const [k, old] = this.onesBySize.entries().next().value!;
      this.onesBySize.delete(k);
      this.rt.textures.discard(old);
    }
    return t;
  }
}
