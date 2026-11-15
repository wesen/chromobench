// heal and clone on the GPU (contract 1.0; the per-pixel formula of CHB-022 guide §7.2–7.3): spots apply in order,
// each reading the image as the spots before it left it, so a coalesced run is the same pixels as its layers kept
// apart (the repair and composite laws, design §23).
//
//   1. Each spot's patch reads a small full-resolution window around its source (and, for heal, its target's ring).
//      That window is the receiver rendered over the box with every earlier spot whose target meets the box
//      composited onto it (recursively: those spots' own windows are the image after *their* predecessors). Spot i's
//      windows are always asked for "after spots 0…i−1", so there are at most two per spot; they are memoised for the
//      call. Independent spots (dust) read the receiver directly, as before.
//   2. Heal's seam coefficients come from core's healCoefficients() (f64) on those windows read back. The seam
//      correction is harmonic in the domain's log encoding: the log of the values in a linear domain (print-xyz: a
//      gain), the values themselves in scanner-density (density is a log already: an additive offset, the
//      transmittance gain the dust heal of packages/ingest applies).
//   3. kernels/retouch.wgsl composites the spots in order on a grid, at the full-resolution pixel centre each grid pixel
//      samples, so tiles, drafts and exports agree.
import retouchCode from '../kernels/retouch.wgsl?raw';
import { healCoefficients, HEAL_M, HEAL_R_OFFSET, spotWindow, type PixelAt } from '@chromobench/core';
import type { Box } from '@chromobench/contract';
import type { GpuRuntime } from './device.ts';

export const RETOUCH_WGSL: string = retouchCode;
/** vec4s per spot record (kernels/retouch.wgsl STRIDE). */
const STRIDE = 22;

/** One spot of heal's or clone's `spots` (contract catalogue layers.ts; document px). */
export interface RepairSpot { x: number; y: number; r: number; src: { x: number; y: number }; feather: number; opacity: number }
/** The domain's log encoding for the heal seam: 'linear' takes the log of the values, 'density' the values. */
export type RepairEncoding = 'linear' | 'density';

export interface RetouchGrid { outW: number; outH: number; frameW: number; frameH: number; region: Box }
/** Renders the receiver over a frame box at full resolution; the caller of apply() releases what it returns. */
export type WindowRenderer = (box: Box) => Promise<GPUTexture>;
export type TextureReader = (tex: GPUTexture, w: number, h: number) => Promise<Float32Array>;

const meets = (s: RepairSpot, r: Box): boolean => s.x + s.r > r.x && s.x - s.r < r.x + r.w && s.y + s.r > r.y && s.y - s.r < r.y + r.h;
const inside = (b: Box, x: number, y: number): boolean => x >= b.x && y >= b.y && x < b.x + b.w && y < b.y + b.h;
const boxKey = (b: Box): string => `${b.x},${b.y},${b.w},${b.h}`;

/**
 * The spots composited in order need, per spot i, its source window as left by spots 0…i−1; this returns, for spot i,
 * the earlier spots whose targets meet a box (the ones that change what spot i reads there).
 */
export function priorSpots(spots: readonly RepairSpot[], k: number, box: Box): number[] {
  const out: number[] = [];
  for (let j = 0; j < k; j++) if (meets(spots[j]!, box)) out.push(j);
  return out;
}

export class Retouch {
  private readonly rt: GpuRuntime;
  private readonly read: TextureReader;
  constructor(rt: GpuRuntime, read: TextureReader) {
    this.rt = rt;
    this.read = read;
  }

  /** The spots composited in order over `base` (an output-grid texture); returns a new texture (release it). */
  async apply(base: GPUTexture, op: 'heal' | 'clone', spots: readonly RepairSpot[], enc: RepairEncoding, t: RetouchGrid, window: WindowRenderer): Promise<GPUTexture> {
    const live = spots.filter((s) => s.r > 0 && s.opacity > 0);
    const run = new SpotRun(this, op, live, enc, t.frameW, t.frameH, window);
    try {
      return await run.composite(base, live.map((_, i) => i).filter((i) => meets(live[i]!, t.region)), t);
    } finally {
      run.release();
    }
  }

  /** core's f64 seam coefficients from the target's and the source's windows (read back), in the domain's log encoding. */
  async coefficients(s: RepairSpot, parts: { box: Box; tex: GPUTexture }[], enc: RepairEncoding, W: number, H: number): Promise<Float64Array> {
    const data = await Promise.all(parts.map(async (p) => ({ box: p.box, d: await this.read(p.tex, p.box.w, p.box.h) })));
    const at: PixelAt = (x, y, k) => {
      const p = data.find((q) => inside(q.box, x, y));
      return p ? p.d[((y - p.box.y) * p.box.w + (x - p.box.x)) * 4 + k]! : 0;
    };
    return healCoefficients(at, W, H, s, 3, enc === 'density' ? 'log' : 'linear');
  }

  /** One pass of kernels/retouch.wgsl over `base` with the given spot records (none: a copy). */
  async pass(base: GPUTexture, t: RetouchGrid, n: number, a: { atlas: GPUTexture; rec: Float32Array<ArrayBuffer> } | null): Promise<GPUTexture> {
    const rt = this.rt;
    rt.check();
    const dev = rt.device;
    const pipe = await rt.pipelines.get({ name: 'retouch', code: RETOUCH_WGSL });
    const W = base.width, H = base.height;
    const out = rt.textures.acquire({ format: 'rgba32float', w: W, h: H, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST }, 'retouch.out');
    const u = new Float32Array([t.region.x, t.region.y, t.region.w / t.outW, t.region.h / t.outH, t.frameW, t.frameH, n, 0]);
    const ub = rt.buffers.acquire({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }, 'retouch.u');
    dev.queue.writeBuffer(ub, 0, u);
    const rec: Float32Array<ArrayBuffer> = a?.rec.length ? a.rec : new Float32Array(STRIDE * 4);
    const sb = rt.buffers.acquire({ size: rec.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }, 'retouch.spots');
    dev.queue.writeBuffer(sb, 0, rec);
    const atlas = a?.atlas ?? base;
    const bg = dev.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: ub, size: 32 } },
        { binding: 1, resource: base.createView() },
        { binding: 2, resource: atlas.createView() },
        { binding: 3, resource: { buffer: sb, size: rec.byteLength } },
        { binding: 4, resource: out.createView() },
      ],
    });
    const enc = dev.createCommandEncoder();
    const pass = enc.beginComputePass(rt.timer.pass('retouch'));
    pass.setPipeline(pipe);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8));
    pass.end();
    rt.timer.resolve(enc);
    dev.queue.submit([enc.finish()]);
    await rt.timer.flush();
    rt.buffers.release(ub);
    rt.buffers.release(sb);
    return out;
  }

  get runtime(): GpuRuntime { return this.rt; }
}

/** One apply() call: the spots, their memoised windows ("after spots 0…k−1") and heal coefficients. */
class SpotRun {
  private readonly windows = new Map<string, Promise<GPUTexture>>();
  private readonly coefs = new Map<number, Promise<Float64Array>>();
  private readonly k: Retouch;
  private readonly op: 'heal' | 'clone';
  private readonly spots: readonly RepairSpot[];
  private readonly enc: RepairEncoding;
  private readonly W: number;
  private readonly H: number;
  private readonly window: WindowRenderer;

  constructor(k: Retouch, op: 'heal' | 'clone', spots: readonly RepairSpot[], enc: RepairEncoding, W: number, H: number, window: WindowRenderer) {
    this.k = k;
    this.op = op;
    this.spots = spots;
    this.enc = enc;
    this.W = W;
    this.H = H;
    this.window = window;
  }

  private srcBox(i: number): Box {
    const s = this.spots[i]!;
    return spotWindow(s.src.x, s.src.y, s.r, this.W, this.H);
  }

  private tgtBox(i: number): Box {
    const s = this.spots[i]!;
    return spotWindow(s.x, s.y, s.r, this.W, this.H);
  }

  /** The image over `box` at full resolution after spots 0…k−1 (memoised; released by release()). */
  after(box: Box, k: number): Promise<GPUTexture> {
    const key = `${boxKey(box)}@${k}`;
    let p = this.windows.get(key);
    if (!p) {
      p = (async () => {
        const recv = await this.window(box);
        const prior = priorSpots(this.spots, k, box);
        if (!prior.length) return recv;
        try {
          return await this.composite(recv, prior, { outW: box.w, outH: box.h, frameW: this.W, frameH: this.H, region: box });
        } finally {
          this.k.runtime.textures.release(recv);
        }
      })();
      this.windows.set(key, p);
    }
    return p;
  }

  private coefficients(i: number): Promise<Float64Array> {
    let p = this.coefs.get(i);
    if (!p) {
      p = (async () => {
        const sb = this.srcBox(i), tb = this.tgtBox(i);
        const [st, tt] = [await this.after(sb, i), await this.after(tb, i)];
        return this.k.coefficients(this.spots[i]!, [{ box: sb, tex: st }, { box: tb, tex: tt }], this.enc, this.W, this.H);
      })();
      this.coefs.set(i, p);
    }
    return p;
  }

  /** Spots `idx` (in order) composited over `base` on grid t; a new texture. */
  async composite(base: GPUTexture, idx: readonly number[], t: RetouchGrid): Promise<GPUTexture> {
    const rt = this.k.runtime;
    if (!idx.length) return this.k.pass(base, t, 0, null);
    // chunks whose source windows stack into one atlas; a chunk's composite reads the previous chunk's result
    const maxH = rt.caps.limits.maxTextureDimension2D;
    const chunks: number[][] = [];
    let cur: number[] = [];
    let h = 0;
    for (const i of idx) {
      const wh = this.srcBox(i).h;
      if (cur.length && h + wh > maxH) {
        chunks.push(cur);
        cur = [];
        h = 0;
      }
      cur.push(i);
      h += wh;
    }
    if (cur.length) chunks.push(cur);
    let out: GPUTexture | null = null;
    for (const c of chunks) {
      const next = await this.chunk(out ?? base, c, t);
      if (out) rt.textures.release(out);
      out = next;
    }
    return out!;
  }

  private async chunk(base: GPUTexture, idx: readonly number[], t: RetouchGrid): Promise<GPUTexture> {
    const rt = this.k.runtime;
    const wins = idx.map((i) => this.srcBox(i));
    const aw = Math.max(...wins.map((w) => w.w)), ah = wins.reduce((a, w) => a + w.h, 0);
    const atlas = rt.textures.acquire({ format: 'rgba32float', w: aw, h: ah, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST }, 'retouch.atlas');
    const rec = new Float32Array(idx.length * STRIDE * 4);
    try {
      let y = 0;
      for (const [j, i] of idx.entries()) {
        const s = this.spots[i]!;
        const win = wins[j]!;
        const src = await this.after(win, i);
        const coef = this.op === 'heal' ? await this.coefficients(i) : null;
        const enc = rt.device.createCommandEncoder();
        enc.copyTextureToTexture({ texture: src }, { texture: atlas, origin: [0, y] }, [win.w, win.h]);
        rt.device.queue.submit([enc.finish()]);
        const o = j * STRIDE * 4;
        rec.set([s.x, s.y, s.r, s.r * (1 - s.feather), s.src.x, s.src.y, s.opacity, coef ? 1 : 0, win.x, win.y, win.w, win.h, 0, y, s.r + HEAL_R_OFFSET, this.enc === 'density' ? 1 : 0], o);
        if (coef) for (let n = 0; n <= HEAL_M; n++) for (let q = 0; q < 2; q++) for (let k = 0; k < 3; k++) rec[o + 16 + (2 * n + q) * 4 + k] = coef[(2 * n + q) * 3 + k]!;
        y += win.h;
      }
      return await this.k.pass(base, t, idx.length, { atlas, rec });
    } finally {
      rt.textures.release(atlas);
    }
  }

  release(): void {
    for (const p of this.windows.values()) void p.then((tx) => this.k.runtime.textures.release(tx), () => undefined);
    this.windows.clear();
    this.coefs.clear();
  }
}
