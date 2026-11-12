// retouch.heal on the GPU (CHB-022 guide §7.2–7.3): a patch pass, then a pointwise composite.
//
//   1. For every enabled spot whose target disc meets the region: the receiver (the image before retouching)
//      is rendered at full resolution over a small window around the source disc (and, for heal, around the
//      target's ring). Windows go into one atlas texture.
//   2. Heal's seam coefficients come from core's healCoefficients() (f64) on the windows read back: a few
//      kilobytes per spot; the engine never searches.
//   3. kernels/retouch.wgsl composites every spot on the output grid in one pass, at the full-resolution
//      pixel centre each grid pixel samples, so tiles, drafts and exports agree with core's retouch().
import retouchCode from '../kernels/retouch.wgsl?raw';
import { healCoefficients, HEAL_M, HEAL_R_OFFSET, spotWindow, type PixelAt, type Spot } from '@chromobench/core';
import type { Box } from '@chromobench/contract';
import type { GpuRuntime } from './device.ts';

export const RETOUCH_WGSL: string = retouchCode;
/** vec4s per spot record (kernels/retouch.wgsl STRIDE). */
const STRIDE = 22;

export interface RetouchGrid { outW: number; outH: number; frameW: number; frameH: number; region: Box }
/** Renders the receiver over a frame box at full resolution; the caller of apply() owns nothing it returns. */
export type WindowRenderer = (box: Box) => Promise<GPUTexture>;
export type TextureReader = (tex: GPUTexture, w: number, h: number) => Promise<Float32Array>;

const meets = (s: Spot, r: Box): boolean => s.x + s.r > r.x && s.x - s.r < r.x + r.w && s.y + s.r > r.y && s.y - s.r < r.y + r.h;
const inside = (b: Box, x: number, y: number): boolean => x >= b.x && y >= b.y && x < b.x + b.w && y < b.y + b.h;

export class Retouch {
  private readonly rt: GpuRuntime;
  private readonly read: TextureReader;
  constructor(rt: GpuRuntime, read: TextureReader) {
    this.rt = rt;
    this.read = read;
  }

  /** The spots composited over `base` (an output-grid texture); returns a new texture (release it). */
  async apply(base: GPUTexture, spots: readonly Spot[], t: RetouchGrid, window: WindowRenderer): Promise<GPUTexture> {
    const live = spots.filter((s) => meets(s, t.region));
    const rt = this.rt;
    const maxH = rt.caps.limits.maxTextureDimension2D;
    // chunks whose source windows stack into one atlas; a chunk's composite reads the previous chunk's result
    const chunks: Spot[][] = [];
    let cur: Spot[] = [];
    let h = 0;
    for (const s of live) {
      const wh = spotWindow(s.src.x, s.src.y, s.r, t.frameW, t.frameH).h;
      if (cur.length && h + wh > maxH) {
        chunks.push(cur);
        cur = [];
        h = 0;
      }
      cur.push(s);
      h += wh;
    }
    if (cur.length) chunks.push(cur);
    let out = await this.composite(base, [], t, null);
    for (const c of chunks) {
      const next = await this.chunk(out, c, t, window);
      rt.textures.release(out);
      out = next;
    }
    return out;
  }

  private async chunk(base: GPUTexture, spots: Spot[], t: RetouchGrid, window: WindowRenderer): Promise<GPUTexture> {
    const rt = this.rt;
    const wins = spots.map((s) => spotWindow(s.src.x, s.src.y, s.r, t.frameW, t.frameH));
    const aw = Math.max(...wins.map((w) => w.w)), ah = wins.reduce((a, w) => a + w.h, 0);
    const atlas = rt.textures.acquire({ format: 'rgba32float', w: aw, h: ah, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST }, 'retouch.atlas');
    const rec = new Float32Array(spots.length * STRIDE * 4);
    try {
      let y = 0;
      for (const [i, s] of spots.entries()) {
        const win = wins[i]!;
        const src = await window(win);
        let coef: Float64Array | null = null;
        try {
          if (s.mode === 'heal') {
            // the ring around the target and the source, read back (small) for core's f64 coefficients
            const tw = spotWindow(s.x, s.y, s.r, t.frameW, t.frameH);
            const tt = await window(tw);
            try {
              const parts = [{ box: win, d: await this.read(src, win.w, win.h) }, { box: tw, d: await this.read(tt, tw.w, tw.h) }];
              const at: PixelAt = (x, yy, k) => {
                const p = parts.find((q) => inside(q.box, x, yy));
                return p ? p.d[((yy - p.box.y) * p.box.w + (x - p.box.x)) * 4 + k]! : 0;
              };
              coef = healCoefficients(at, t.frameW, t.frameH, s, 3);
            } finally {
              rt.textures.release(tt);
            }
          }
          const enc = rt.device.createCommandEncoder();
          enc.copyTextureToTexture({ texture: src }, { texture: atlas, origin: [0, y] }, [win.w, win.h]);
          rt.device.queue.submit([enc.finish()]);
        } finally {
          rt.textures.release(src);
        }
        const o = i * STRIDE * 4;
        rec.set([s.x, s.y, s.r, s.r * (1 - s.feather), s.src.x, s.src.y, s.opacity, s.mode === 'heal' ? 1 : 0, win.x, win.y, win.w, win.h, 0, y, s.r + HEAL_R_OFFSET, 3], o);
        if (coef) for (let n = 0; n <= HEAL_M; n++) for (let j = 0; j < 2; j++) for (let k = 0; k < 3; k++) rec[o + 16 + (2 * n + j) * 4 + k] = coef[(2 * n + j) * 3 + k]!;
        y += win.h;
      }
      return await this.composite(base, spots, t, { atlas, rec });
    } finally {
      rt.textures.release(atlas);
    }
  }

  /** One pass of kernels/retouch.wgsl (with no spots: a copy). */
  private async composite(base: GPUTexture, spots: readonly Spot[], t: RetouchGrid, a: { atlas: GPUTexture; rec: Float32Array<ArrayBuffer> } | null): Promise<GPUTexture> {
    const rt = this.rt;
    rt.check();
    const dev = rt.device;
    const pipe = await rt.pipelines.get({ name: 'retouch', code: RETOUCH_WGSL });
    const W = base.width, H = base.height;
    const out = rt.textures.acquire({ format: 'rgba32float', w: W, h: H, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC }, 'retouch.out');
    const u = new Float32Array([t.region.x, t.region.y, t.region.w / t.outW, t.region.h / t.outH, t.frameW, t.frameH, spots.length, 0]);
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
}
