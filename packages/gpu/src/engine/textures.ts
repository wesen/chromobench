// Texture work of GpuEngine (split from engine-gpu.ts, CHB-032): synthetic sources, the 16-bit source upload and
// export readback (kernels/pack16.wgsl), one combine.wgsl pass, and Gaussian blurs of any σ.
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

/**
 * Staging objects of an upload larger than this are let go after it (discard: destroyed once the GPU is done), not kept
 * for reuse (CHB-041): a 4000-px source's f32 staging buffer is 128 MB, and kept in the pool's free list it stayed in
 * the budget (the owner's E_GPU_OOM: 160 MB of free buffers next to two 164 MB source textures). Reuse pays for small ones.
 */
export const STAGING_KEPT_BYTES = 16 * 2 ** 20;

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
  const bg = rt.device.createBindGroup({ label: pipe.label, layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ub, size: 32 } }, { binding: 1, resource: t16.createView() }, { binding: 2, resource: out.createView() }, { binding: 6, resource: { buffer: lut } }] });
  const enc = rt.device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipe);
  pass.setBindGroup(0, bg);
  pass.dispatchWorkgroups(Math.ceil(rect.w / 8), Math.ceil(rect.h / 8));
  pass.end();
  rt.device.queue.submit([enc.finish()]);
  rt.buffers.release(ub);
  if (rect.w * rect.h * 8 > STAGING_KEPT_BYTES) rt.textures.discard(t16);
  else rt.textures.release(t16);
  return out;
}

/**
 * An f32 image of `c` channels per pixel → rgba32float by kernels/pack16.wgsl `unpackF32` (CHB-034): the data goes
 * to a storage buffer as it is, so the main thread does no per-pixel work. Falls back to ChainRunner.upload's CPU
 * expansion when the data is larger than one storage binding may be.
 */
export async function uploadF32(rt: GpuRuntime, data: Float32Array, w: number, h: number, c: number, label: string, cpu: () => GPUTexture): Promise<GPUTexture> {
  const bytes = w * h * c * 4;
  if (data.length < w * h * c || bytes > rt.caps.limits.maxStorageBufferBindingSize || bytes > rt.caps.limits.maxBufferSize) return cpu();
  const pipe = await rt.pipelines.get({ name: 'pack16.unpackF32', code: PACK16_WGSL, entryPoint: 'unpackF32' });
  const sb = rt.buffers.acquire({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }, `${label}.f32`);
  rt.device.queue.writeBuffer(sb, 0, data.buffer, data.byteOffset, bytes);
  const out = rt.textures.acquire({ format: 'rgba32float', w, h, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING }, label);
  const ub = rt.buffers.acquire({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }, 'pack16.f');
  rt.device.queue.writeBuffer(ub, 0, new Uint32Array([w, h, c, 0]));
  const bg = rt.device.createBindGroup({ label: pipe.label, layout: pipe.getBindGroupLayout(0), entries: [{ binding: 7, resource: { buffer: ub, size: 32 } }, { binding: 8, resource: { buffer: sb, size: bytes } }, { binding: 9, resource: out.createView() }] });
  const enc = rt.device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipe);
  pass.setBindGroup(0, bg);
  pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
  pass.end();
  rt.device.queue.submit([enc.finish()]);
  rt.buffers.release(ub);
  if (bytes > STAGING_KEPT_BYTES) rt.buffers.discard(sb);
  else rt.buffers.release(sb);
  return out;
}

/** The chain's rgba32float output → 16-bit RGB codes (kernels/pack16.wgsl `pack`, pack2x16unorm). */
export async function readU16(rt: GpuRuntime, tex: GPUTexture, w: number, h: number): Promise<Uint16Array> {
  const pipe = await rt.pipelines.get({ name: 'pack16.pack', code: PACK16_WGSL, entryPoint: 'pack' });
  const bytes = w * h * 8;
  const sb = rt.buffers.acquire({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }, 'pack16.out');
  const ub = rt.buffers.acquire({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }, 'pack16.u');
  rt.device.queue.writeBuffer(ub, 0, new Uint32Array([w, h, 0, 0]));
  const bg = rt.device.createBindGroup({ label: pipe.label, layout: pipe.getBindGroupLayout(0), entries: [{ binding: 3, resource: { buffer: ub, size: 32 } }, { binding: 4, resource: tex.createView() }, { binding: 5, resource: { buffer: sb, size: bytes } }] });
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

/** σ of the blur on a field downsampled s × s that, with the box average and the bilinear read back, makes σ (tiles.ts). */
export const fieldSigma = (sigma: number, s: number): number => Math.sqrt(Math.max(sigma * sigma - (s * s - 1) / 12 - (s * s) / 6, 0)) / s;

/**
 * A Gaussian blur of σ output px, clamp-to-edge, as one Gaussian (core gaussianBlur1): one pass up to MAX_PASS_SIGMA;
 * beyond it on a field downsampled by s = ⌈σ / MAX_PASS_SIGMA⌉ — the box average of the clamp-extended image on a
 * field padded by the blur's reach, one blur pass of the compensated σ, bilinear read back with f32 weights — so the
 * edge rule is the frame's, as in core. Repeated passes would clamp at the edge once per pass (several Gaussians with
 * clamping are not one: 28 % off core near the edge of a small frame at σ = 94 px, CHB-037 P3) and cost a pass per
 * 32 px of σ (clarity's 10 mm is σ ≈ 200 px at 48 µm/px). `channel`: blur that one only. A new texture.
 */
export async function gaussianBlur(rt: GpuRuntime, blur: Blur, src: GPUTexture, sigma: number, copy: (t: GPUTexture) => Promise<GPUTexture>, channel?: number): Promise<GPUTexture> {
  if (!(sigma > 0)) return copy(src);
  const sig = (x: number) => [0, 1, 2, 3].map((c) => (channel === undefined || c === channel ? x : 0));
  if (sigma <= MAX_PASS_SIGMA) return blur.gaussian(src, sig(sigma));
  const s = Math.ceil(sigma / MAX_PASS_SIGMA);
  const fs = fieldSigma(sigma, s);
  const pad = Math.ceil(3 * fs) + 1; // the blur's reach (and the read back's neighbour) stays inside the padded field
  const down = await blur.downsamplePadded(src, s, pad);
  const field = await blur.gaussian(down, sig(fs));
  rt.textures.release(down);
  const out = await blur.upsample(field, s, pad, src.width, src.height);
  rt.textures.release(field);
  return out;
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
    label: pipe.label, layout: pipe.getBindGroupLayout(0),
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
