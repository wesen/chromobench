// output.frame on the GPU (CHB-037 P3b): the document geometry (crop, straighten, orientation) as the last step of
// the display cut, so the GPU engine covers `display` as core does. An un-straightened frame is a permutation of
// pixels: the receiver renders on the grid the output grid maps to (crop offset, un-oriented region, swapped size)
// and one pass reorients it. A straightened frame renders the receiver over the crop's footprint at full resolution
// and samples it bilinearly at the output grid's nearest full-resolution pixels (contract straighten, as core).
import { sensorAngleSign, straightenFootprint, type Box } from '@chromobench/contract';
import frameCode from '../kernels/frame.wgsl?raw';
import type { GpuRuntime } from './device.ts';

export const FRAME_WGSL: string = frameCode;

const ORIENTATIONS = ['none', 'flipH', 'flipV', 'rot180', 'cw90', 'ccw90', 'transpose', 'transverse'] as const;
export const orientationCode = (o: unknown): number => Math.max(0, ORIENTATIONS.indexOf(o as (typeof ORIENTATIONS)[number]));
export const swapsAxes = (o: unknown): boolean => orientationCode(o) >= 4;

/** The region of the un-oriented crop (w × h) that oriented region b shows. */
export function unorientBox(o: unknown, b: Box, w: number, h: number): Box {
  const code = orientationCode(o);
  const fx = code === 1 || code === 3 || code === 5 || code === 7;
  const fy = code === 2 || code === 3 || code === 4 || code === 7;
  const swap = code >= 4;
  // along each un-oriented axis: the oriented axis it reads, mirrored when it runs backwards (frame.wgsl unorient)
  const [ax, aw] = swap ? [b.y, b.h] : [b.x, b.w];
  const [ay, ah] = swap ? [b.x, b.w] : [b.y, b.h];
  return { x: fx ? w - ax - aw : ax, y: fy ? h - ay - ah : ay, w: aw, h: ah };
}

export interface FrameArgs { orientation: unknown; angle_deg: number; crop: Box }

/** What the receiver must be rendered over for an output region: its region, and the grid size there (outW × outH). */
export function frameSource(f: FrameArgs, region: Box, outW: number, outH: number, frameW: number, frameH: number): { region: Box; outW: number; outH: number; full: boolean } {
  if (f.angle_deg !== 0) return { region: straightenFootprint(f.crop, f.angle_deg, frameW, frameH), outW: 0, outH: 0, full: true };
  const b = unorientBox(f.orientation, region, f.crop.w, f.crop.h);
  const swap = swapsAxes(f.orientation);
  return { region: { x: b.x + f.crop.x, y: b.y + f.crop.y, w: b.w, h: b.h }, outW: swap ? outH : outW, outH: swap ? outW : outH, full: false };
}

/** One pass of frame.wgsl: `orient` (the source's un-oriented texture) or `straighten`; a new outW × outH texture. */
export async function framePass(rt: GpuRuntime, entry: 'orient' | 'straighten' | 'crop', src: GPUTexture, outW: number, outH: number, f: FrameArgs, region: Box, origin: { x: number; y: number }, frameW: number, frameH: number): Promise<GPUTexture> {
  rt.check();
  const dev = rt.device;
  const pipe = await rt.pipelines.get({ name: `frame.${entry}`, code: FRAME_WGSL, entryPoint: entry });
  const out = rt.textures.acquire({ format: 'rgba32float', w: outW, h: outH, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC }, `frame.${entry}`);
  const u = new ArrayBuffer(80);
  new Uint32Array(u, 0, 4).set([orientationCode(f.orientation), outW, outH, 0]);
  const th = (-sensorAngleSign(f.orientation as string) * f.angle_deg * Math.PI) / 180;
  new Float32Array(u, 16, 16).set([region.x, region.y, region.w, region.h, f.crop.x, f.crop.y, f.crop.w, f.crop.h, origin.x, origin.y, frameW, frameH, Math.cos(th), Math.sin(th), 0, 0]);
  const ub = rt.buffers.acquire({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }, 'frame.u');
  dev.queue.writeBuffer(ub, 0, u);
  const bg = dev.createBindGroup({ label: pipe.label, layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ub, size: 80 } }, { binding: 1, resource: src.createView() }, { binding: 2, resource: out.createView() }] });
  const enc = dev.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipe);
  pass.setBindGroup(0, bg);
  pass.dispatchWorkgroups(Math.ceil(outW / 8), Math.ceil(outH / 8));
  pass.end();
  dev.queue.submit([enc.finish()]);
  rt.buffers.release(ub);
  return out;
}
