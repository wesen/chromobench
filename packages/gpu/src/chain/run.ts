// Executes pointwise segments on the GPU: one dispatch per segment, 8 × 8 workgroups, reading the
// source (or the previous segment's output) and writing an rgba32float storage texture.
import pointwiseCode from '../../kernels/pointwise.wgsl?raw';
import type { GpuRuntime } from '../device.ts';
import type { CurveRow } from '../physics/core.ts';
import type { TableManager } from '../tables/manager.ts';
import { exactBits, LOOKUP, packProgram, packSpectra, type Segment } from './program.ts';

export const POINTWISE_WGSL = pointwiseCode;

export interface RunTarget {
  /** Output size. */
  outW: number;
  outH: number;
  /** Full-resolution frame and the region of it the output covers. */
  frameW: number;
  frameH: number;
  region: { x: number; y: number; w: number; h: number };
  precision: 'preview' | 'export';
  /** Override the lookup mode (parity tests). */
  lookup?: number;
  /** Override the exact solve (export default true). */
  exact?: boolean;
  /** Table builder for this run (export defaults to 'f64', decision D6). */
  builder?: 'f64' | 'gpu-f32';
}

export class ChainRunner {
  private dummy3: GPUTexture | null = null;
  private dummy2: GPUTexture | null = null;
  private dummyBuf: GPUBuffer | null = null;
  private sampler: GPUSampler | null = null;
  private readonly curveTex = new Map<string, GPUTexture>();
  private readonly rt: GpuRuntime;
  private readonly tables: TableManager;

  constructor(rt: GpuRuntime, tables: TableManager) {
    this.rt = rt;
    this.tables = tables;
  }

  pipeline(code = POINTWISE_WGSL): Promise<GPUComputePipeline> {
    return this.rt.pipelines.get({ name: 'pointwise', code });
  }

  private dummies(): { t3: GPUTexture; t2: GPUTexture; buf: GPUBuffer; samp: GPUSampler } {
    const dev = this.rt.device;
    this.dummy3 ??= dev.createTexture({ size: [2, 2, 2], dimension: '3d', format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING });
    this.dummy2 ??= dev.createTexture({ size: [2, 3], format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING });
    this.dummyBuf ??= dev.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE });
    this.sampler ??= dev.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' });
    return { t3: this.dummy3, t2: this.dummy2, buf: this.dummyBuf, samp: this.sampler };
  }

  private curves(row: CurveRow): GPUTexture {
    let t = this.curveTex.get(row.id);
    if (!t) {
      const N1 = row.data.length / 4;
      t = this.rt.device.createTexture({ size: [N1, 1], format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      this.rt.device.queue.writeTexture({ texture: t }, row.data as Float32Array<ArrayBuffer>, { bytesPerRow: N1 * 16 }, [N1, 1]);
      this.curveTex.set(row.id, t);
    }
    return t;
  }

  /**
   * Runs the segments; returns the output texture (owned by the caller: release to rt.textures).
   * `src` is a full-res (or read-rect) texture whose texel (0,0) is frame position srcOrigin, or, with
   * `srcOnGrid`, a texture already on the output grid (read at the output pixel, CHB-010 DAG evaluation).
   */
  async run(segments: Segment[], src: GPUTexture, srcOrigin: [number, number], t: RunTarget, opts: { code?: string; srcOnGrid?: boolean } = {}): Promise<GPUTexture> {
    const rt = this.rt;
    rt.check();
    const dev = rt.device;
    const pipe = await this.pipeline(opts.code);
    const d = this.dummies();
    const exact = t.exact ?? t.precision === 'export';
    // preview: manual trilinear, core's look3 in f32. The hardware filter (LOOKUP.hw) quantises its weights to 1/256 on
    // real GPUs (Metal, measured CHB-034: up to 0.86 of an 8-bit level from core); the manual lookup costs ~1.1 ms
    // per 4000 × 2674 preview on an M1 Max (5.3 → 6.4 ms)
    const lookup = t.lookup ?? (t.precision === 'export' ? LOOKUP.tetra : LOOKUP.trilinear);
    const builder = t.builder ?? (t.precision === 'export' ? 'f64' : undefined);
    let input = src;
    let prev: GPUTexture | null = null;
    const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      const tb = seg.tables;
      const res = async (inp: typeof tb.solve | typeof tb.pd) => (inp ? (await this.tables.resolve(inp, builder ? { builder } : {})).texture : d.t3);
      // the exact path needs no tables
      const solveTex = tb.solve && !exact ? await res(tb.solve) : d.t3;
      const pdTex = !exact ? await res(tb.pd) : d.t3;
      const printTex = !exact ? await res(tb.print) : d.t3;
      const curveTex = tb.curves ? this.curves(tb.curves) : d.t2;
      let specBuf = d.buf;
      let ownSpec: GPUBuffer | null = null;
      if (exactBits(seg, exact)) {
        // export: exact solve and exact pd / print integrals per pixel (no table interpolation)
        const arr = packSpectra(seg);
        ownSpec = rt.buffers.acquire({ size: arr.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }, 'pointwise.spectra');
        dev.queue.writeBuffer(ownSpec, 0, arr);
        specBuf = ownSpec;
      }
      const out = rt.textures.acquire({ format: 'rgba32float', w: t.outW, h: t.outH, usage }, `pointwise.${i}`);
      const prog = packProgram({ seg, outW: t.outW, outH: t.outH, frameW: t.frameW, frameH: t.frameH, region: t.region, srcOrigin, srcIsPrev: i > 0 || !!opts.srcOnGrid, lookup, exact });
      const ub = rt.buffers.acquire({ size: prog.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }, 'pointwise.prog');
      dev.queue.writeBuffer(ub, 0, prog);
      const bg = dev.createBindGroup({
        layout: pipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: ub, size: prog.byteLength } },
          { binding: 1, resource: input.createView() },
          { binding: 2, resource: out.createView() },
          { binding: 3, resource: solveTex.createView({ dimension: '3d' }) },
          { binding: 4, resource: pdTex.createView({ dimension: '3d' }) },
          { binding: 5, resource: printTex.createView({ dimension: '3d' }) },
          { binding: 6, resource: curveTex.createView() },
          { binding: 7, resource: d.samp },
          { binding: 8, resource: { buffer: specBuf } },
        ],
      });
      const enc = dev.createCommandEncoder();
      const pass = enc.beginComputePass(rt.timer.pass(`pointwise.${i}`));
      pass.setPipeline(pipe);
      pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(Math.ceil(t.outW / 8), Math.ceil(t.outH / 8));
      pass.end();
      rt.timer.resolve(enc);
      dev.queue.submit([enc.finish()]);
      await rt.timer.flush();
      rt.buffers.release(ub);
      if (ownSpec) rt.buffers.release(ownSpec);
      if (prev) rt.textures.release(prev);
      prev = out;
      input = out;
    }
    if (!prev) throw new Error('no segments');
    return prev;
  }

  /** Reads an rgba32float texture back as a tightly packed Float32Array (4 per pixel). */
  async readTexture(tex: GPUTexture, w: number, h: number): Promise<Float32Array> {
    const rt = this.rt;
    rt.check();
    const bpr = Math.ceil((w * 16) / 256) * 256; // copyTextureToBuffer needs a multiple of 256
    const size = bpr * h;
    const buf = rt.buffers.acquire({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC }, 'readtex');
    const enc = rt.device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: bpr }, [w, h]);
    rt.device.queue.submit([enc.finish()]);
    const raw = new Float32Array(await rt.readBuffer(buf, size));
    rt.buffers.release(buf);
    if (bpr === w * 16) return raw;
    const out = new Float32Array(w * h * 4);
    for (let y = 0; y < h; y++) out.set(raw.subarray((y * bpr) / 4, (y * bpr) / 4 + w * 4), y * w * 4);
    return out;
  }

  /** Uploads interleaved samples (1, 3 or 4 channels) as an rgba32float texture. */
  upload(data: ArrayLike<number>, w: number, h: number, channels: number, label = 'source'): GPUTexture {
    const rgba = new Float32Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      for (let k = 0; k < 4; k++) rgba[4 * i + k] = k < channels ? data[i * channels + k]! : k === 3 ? 1 : channels === 1 ? data[i]! : 0;
    }
    const tex = this.rt.textures.acquire({ format: 'rgba32float', w, h, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING }, label);
    this.rt.device.queue.writeTexture({ texture: tex }, rgba, { bytesPerRow: w * 16 }, [w, h]);
    return tex;
  }

  destroy(): void {
    for (const t of this.curveTex.values()) t.destroy();
    this.curveTex.clear();
    this.dummy2?.destroy();
    this.dummy3?.destroy();
    this.dummyBuf?.destroy();
  }
}
