// Spatial kernels (guide §5.6): separable Gaussian blur with per-channel weights, global fields read
// through frame coordinates, and the halation combine. Sizes of physical effects are given in µm
// and converted with the frame's µm per pixel.
import blurCode from '../kernels/blur.wgsl?raw';
import fieldCode from '../kernels/field.wgsl?raw';
import type { GpuRuntime } from './device.ts';
import { defineStruct } from './layout.ts';

export const BLUR_PARAMS = defineStruct('Blur', [['dir', 'vec2i'], ['R', 'u32'], ['pad', 'u32'], ['w', { array: 'vec4f', n: 97 }]]);
export const FIELD_PARAMS = defineStruct('F', [['tileOrigin', 'vec2i'], ['frameSize', 'vec2f'], ['s', 'u32'], ['mode', 'u32'], ['pad', 'vec2u'], ['wts', 'vec4f']]);
export const MAX_RADIUS = 96;

/**
 * Gaussian taps per channel (render.js blurKernel 2970–2981): truncated at R = ⌈kσ⌉ (k = 3), at most
 * 96, normalised so w0 + 2 Σ w_i = 1 and a flat field stays flat. σ = 0 is the identity.
 */
export function gaussianWeights(sigmas: readonly number[], k = 3): { R: number; w: number[][] } {
  const radii = [0, 1, 2, 3].map((c) => Math.min(MAX_RADIUS, Math.ceil(k * (sigmas[c] ?? 0))));
  const R = Math.max(0, ...radii);
  const w = Array.from({ length: R + 1 }, () => [0, 0, 0, 0]);
  for (let c = 0; c < 4; c++) {
    const s = sigmas[c] ?? 0;
    if (s <= 0) {
      w[0]![c] = 1;
      continue;
    }
    let sum = 0;
    for (let i = 0; i <= radii[c]!; i++) {
      const v = Math.exp(-0.5 * (i / s) ** 2);
      w[i]![c] = v;
      sum += i ? 2 * v : v;
    }
    for (let i = 0; i <= radii[c]!; i++) w[i]![c]! /= sum;
  }
  return { R, w };
}

export class Blur {
  private readonly rt: GpuRuntime;
  private sampler: GPUSampler | null = null;
  constructor(rt: GpuRuntime) { this.rt = rt; }

  private tex(w: number, h: number, label: string): GPUTexture {
    return this.rt.textures.acquire({ format: 'rgba32float', w, h, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST }, label);
  }

  /** Separable Gaussian with σ (px) per channel; returns a new texture (release it to rt.textures). */
  async gaussian(src: GPUTexture, sigmas: readonly number[], k = 3): Promise<GPUTexture> {
    const rt = this.rt;
    rt.check();
    const dev = rt.device;
    const { R, w } = gaussianWeights(sigmas, k);
    const pipe = await rt.pipelines.get({ name: 'blur', code: blurCode });
    const W = src.width;
    const H = src.height;
    const mid = this.tex(W, H, 'blur.h');
    const out = this.tex(W, H, 'blur.v');
    const enc = dev.createCommandEncoder();
    const ubs: GPUBuffer[] = [];
    for (const [dir, from, to] of [[[1, 0], src, mid], [[0, 1], mid, out]] as const) {
      const u = BLUR_PARAMS.pack({ dir, R, w });
      const ub = rt.buffers.acquire({ size: u.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }, 'blur.u');
      dev.queue.writeBuffer(ub, 0, u);
      ubs.push(ub);
      const bg = dev.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ub, size: u.byteLength } }, { binding: 1, resource: from.createView() }, { binding: 2, resource: to.createView() }] });
      const pass = enc.beginComputePass(rt.timer.pass('blur'));
      pass.setPipeline(pipe);
      pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8));
      pass.end();
    }
    rt.timer.resolve(enc);
    dev.queue.submit([enc.finish()]);
    await rt.timer.flush();
    for (const b of ubs) rt.buffers.release(b);
    rt.textures.release(mid);
    return out;
  }

  private async field(entry: 'down' | 'sampleField' | 'combine', outW: number, outH: number, src: GPUTexture, field: GPUTexture | null, p: Record<string, unknown>): Promise<GPUTexture> {
    const rt = this.rt;
    rt.check();
    const dev = rt.device;
    this.sampler ??= dev.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    const pipe = await rt.pipelines.get({ name: `field.${entry}`, code: fieldCode, entryPoint: entry });
    const out = this.tex(outW, outH, `field.${entry}`);
    const u = FIELD_PARAMS.pack(p);
    const ub = rt.buffers.acquire({ size: u.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }, 'field.u');
    dev.queue.writeBuffer(ub, 0, u);
    const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: { buffer: ub, size: u.byteLength } }, { binding: 2, resource: out.createView() }];
    if (entry !== 'sampleField') entries.push({ binding: 1, resource: src.createView() });
    if (entry !== 'down') entries.push({ binding: 3, resource: field!.createView() });
    if (entry === 'sampleField') entries.push({ binding: 4, resource: this.sampler });
    const bg = dev.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries });
    const enc = dev.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipe);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(Math.ceil(outW / 8), Math.ceil(outH / 8));
    pass.end();
    dev.queue.submit([enc.finish()]);
    await dev.queue.onSubmittedWorkDone();
    rt.buffers.release(ub);
    return out;
  }

  /** s × s area average. */
  downsample(src: GPUTexture, s: number): Promise<GPUTexture> {
    return this.field('down', Math.ceil(src.width / s), Math.ceil(src.height / s), src, null, { s });
  }

  /** A tile of size w × h at frame position origin, sampled bilinearly from a whole-frame field. */
  sampleField(field: GPUTexture, origin: [number, number], w: number, h: number, frame: [number, number]): Promise<GPUTexture> {
    return this.field('sampleField', w, h, field, field, { tileOrigin: origin, frameSize: frame });
  }

  /**
   * Halation in spektrafilm's form on linear exposure E (channel 0):
   * E₂ = (E + a Σ_k w_k G(σ_h√k) ∗ E) / (1 + a), w = (4/7, 2/7, 1/7). σ_h in µm.
   * `normalise: false` is the Studio's variant without the 1 + a (a broken variant for tests).
   */
  async halation(E: GPUTexture, sigmaUm: number, umPerPx: number, a: number, opts: { normalise?: boolean } = {}): Promise<GPUTexture> {
    const s = sigmaUm / umPerPx;
    const bounces = await this.gaussian(E, [s, s * Math.SQRT2, s * Math.sqrt(3), 0]);
    const out = await this.field('combine', E.width, E.height, E, bounces, { wts: [4 / 7, 2 / 7, 1 / 7, a], mode: opts.normalise === false ? 1 : 0 });
    this.rt.textures.release(bounces);
    return out;
  }
}
