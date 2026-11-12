// Texture work of GpuEngine (split from engine-gpu.ts, CHB-032): synthetic sources, the 16-bit source upload and
// export readback (kernels/pack16.wgsl), one combine.wgsl pass, and multi-pass Gaussian blurs.
import { DOMAINS, type Box, type ImageInfo, type Node } from '@chromobench/contract';
import type { GpuRuntime } from '../device.ts';
import type { Blur } from '../spatial.ts';
import { COMBINE_WGSL, MAX_PASS_SIGMA, mulberry32, PACK16_WGSL, type SourceImg } from './defs.ts';

/** A source.pattern node's pixels: seeded uniform noise over its domain's range (class codes for scan-classes). */
export function syntheticSource(root: Node): SourceImg {
  const info = root.info as ImageInfo;
  const rng = mulberry32(root.args['seed'] as number);
  const [lo, hi] = DOMAINS[info.domain].range;
  const data = new Float32Array(info.width * info.height * info.channels);
  for (let i = 0; i < data.length; i++) data[i] = info.domain === 'scan-classes' ? Math.floor(rng() * 4) : lo + rng() * (hi - lo);
  return { w: info.width, h: info.height, c: info.channels, data };
}

/** A rectangle of a 16-bit source → rgba16uint upload → rgba32float by kernels/pack16.wgsl `unpack`. */
export async function uploadU16(rt: GpuRuntime, img: SourceImg, rect: Box, label: string, luts: Map<number, GPUBuffer>): Promise<GPUTexture> {
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
  let lut = luts.get(max);
  if (!lut) {
    const t = new Float32Array(max + 1);
    for (let i = 0; i <= max; i++) t[i] = i / max;
    lut = rt.device.createBuffer({ size: t.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, label: `pack16.lut${max}` });
    rt.device.queue.writeBuffer(lut, 0, t);
    luts.set(max, lut);
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
export async function readU16(rt: GpuRuntime, tex: GPUTexture, w: number, h: number): Promise<Uint16Array> {
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

/** A Gaussian blur of σ output px (several passes beyond MAX_PASS_SIGMA: σ² adds); a new texture. */
export async function gaussianBlur(rt: GpuRuntime, blur: Blur, src: GPUTexture, sigma: number, copy: (t: GPUTexture) => Promise<GPUTexture>): Promise<GPUTexture> {
  if (!(sigma > 0)) return copy(src);
  const passes = Math.max(1, Math.ceil((sigma / MAX_PASS_SIGMA) ** 2));
  const s = sigma / Math.sqrt(passes);
  let cur = await blur.gaussian(src, [s, s, s, s]);
  for (let i = 1; i < passes; i++) {
    const next = await blur.gaussian(cur, [s, s, s, s]);
    rt.textures.release(cur);
    cur = next;
  }
  return cur;
}

/** One pass of kernels/combine.wgsl on output-grid textures; returns a new texture (release it). */
export async function combinePass(rt: GpuRuntime, dummy: GPUTexture, mode: number, a: GPUTexture, b: GPUTexture | null = null, m: GPUTexture | null = null, flags = 0, w: number[] = []): Promise<GPUTexture> {
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
      { binding: 2, resource: (b ?? dummy).createView() },
      { binding: 3, resource: (m ?? dummy).createView() },
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
