// mask.grow on the GPU (contract 1.6, CHB-049): the octagon of core's growPlan as four one-dimensional passes of
// kernels/morph.wgsl (rows, columns, the diagonal, the anti-diagonal), the maximum to grow and the minimum to contract.
// Exact against core: a pass only picks one of its inputs, so f32 and f64 differ by the inputs' rounding alone.
import { growPasses } from '@chromobench/core';
import morphCode from '../kernels/morph.wgsl?raw';
import type { GpuRuntime } from './device.ts';
import { defineStruct } from './layout.ts';

export const MORPH_PARAMS = defineStruct('Morph', [['dir', 'vec2i'], ['L', 'u32'], ['grow', 'u32']]);
export const MORPH_WGSL: string = morphCode;

export class Morph {
  private readonly rt: GpuRuntime;
  constructor(rt: GpuRuntime) { this.rt = rt; }

  private tex(w: number, h: number): GPUTexture {
    return this.rt.textures.acquire({ format: 'rgba32float', w, h, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST }, 'mask.grow');
  }

  /** Grows (r > 0) or contracts (r < 0) a mask texture by r output px; a new texture (release it to rt.textures). */
  async grow(src: GPUTexture, r: number): Promise<GPUTexture> {
    const rt = this.rt;
    rt.check();
    const dev = rt.device;
    const W = src.width, H = src.height;
    const passes = growPasses(r);
    const pipe = await rt.pipelines.get({ name: 'morph', code: morphCode });
    const enc = dev.createCommandEncoder();
    const ubs: GPUBuffer[] = [];
    const temps: GPUTexture[] = [];
    let from = src;
    const out = this.tex(W, H);
    if (!passes.length) {
      enc.copyTextureToTexture({ texture: src }, { texture: out }, [W, H]);
    }
    for (let i = 0; i < passes.length; i++) {
      const [dx, dy, L] = passes[i]!;
      const to = i === passes.length - 1 ? out : this.tex(W, H);
      if (to !== out) temps.push(to);
      const u = MORPH_PARAMS.pack({ dir: [dx, dy], L, grow: r >= 0 ? 1 : 0 });
      const ub = rt.buffers.acquire({ size: u.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }, 'morph.u');
      dev.queue.writeBuffer(ub, 0, u);
      ubs.push(ub);
      const bg = dev.createBindGroup({ label: pipe.label, layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ub, size: u.byteLength } }, { binding: 1, resource: from.createView() }, { binding: 2, resource: to.createView() }] });
      const pass = enc.beginComputePass(rt.timer.pass('morph'));
      pass.setPipeline(pipe);
      pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8));
      pass.end();
      from = to;
    }
    rt.timer.resolve(enc);
    dev.queue.submit([enc.finish()]);
    await rt.timer.flush();
    for (const b of ubs) rt.buffers.release(b);
    for (const t of temps) rt.textures.release(t);
    return out;
  }
}
