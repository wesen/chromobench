// GPU reductions for Engine.measure (guide §5.5): box moments (mean, min, max) with optional
// circular aperture, and atomic histograms. Partials are summed pairwise in f64 on the host.
import reduceCode from '../kernels/reduce.wgsl?raw';
import type { GpuRuntime } from './device.ts';
import { defineStruct } from './layout.ts';

export const REDUCE_PARAMS = defineStruct('R', [['box', 'vec4i'], ['circle', 'vec4f'], ['range', 'vec4f']]);
export const REDUCE_WGSL = reduceCode;

export interface Box { x: number; y: number; w: number; h: number }
export interface Moments { mean: number[]; min: number[]; max: number[]; count: number }

/** Pairwise (cascade) summation of f64 values. */
export function pairwiseSum(v: ArrayLike<number>, lo = 0, hi = v.length): number {
  if (hi - lo <= 8) {
    let s = 0;
    for (let i = lo; i < hi; i++) s += v[i]!;
    return s;
  }
  const m = (lo + hi) >> 1;
  return pairwiseSum(v, lo, m) + pairwiseSum(v, m, hi);
}

export class Reducer {
  private readonly rt: GpuRuntime;
  constructor(rt: GpuRuntime) { this.rt = rt; }

  private async dispatch(entry: 'moments' | 'histogram', tex: GPUTexture, box: Box, circle: [number, number, number], channel: number, range: [number, number, number]): Promise<{ partial?: Float32Array; bins?: Uint32Array }> {
    const rt = this.rt;
    rt.check();
    const dev = rt.device;
    const pipe = await rt.pipelines.get({ name: `reduce.${entry}`, code: REDUCE_WGSL, entryPoint: entry });
    const gx = Math.ceil(box.w / 16);
    const gy = Math.ceil(box.h / 16);
    const u = REDUCE_PARAMS.pack({ box: [box.x, box.y, box.w, box.h], circle: [...circle, channel], range: [...range, 0] });
    const ub = rt.buffers.acquire({ size: u.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }, 'reduce.u');
    dev.queue.writeBuffer(ub, 0, u);
    const pbytes = gx * gy * 64;
    const nb = range[2] || 1;
    const pb = rt.buffers.acquire({ size: pbytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }, 'reduce.partial');
    const bb = rt.buffers.acquire({ size: nb * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST }, 'reduce.bins');
    const enc = dev.createCommandEncoder();
    enc.clearBuffer(bb);
    const entries: GPUBindGroupEntry[] = [
      { binding: 0, resource: { buffer: ub, size: u.byteLength } },
      { binding: 1, resource: tex.createView() },
    ];
    if (entry === 'moments') entries.push({ binding: 2, resource: { buffer: pb, size: pbytes } });
    else entries.push({ binding: 3, resource: { buffer: bb, size: nb * 4 } });
    const bg = dev.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries });
    const pass = enc.beginComputePass();
    pass.setPipeline(pipe);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(gx, gy);
    pass.end();
    dev.queue.submit([enc.finish()]);
    const out = entry === 'moments' ? { partial: new Float32Array(await rt.readBuffer(pb, pbytes)) } : { bins: new Uint32Array(await rt.readBuffer(bb, nb * 4)) };
    rt.buffers.release(ub);
    rt.buffers.release(pb);
    rt.buffers.release(bb);
    return out;
  }

  /** Mean, min and max per channel over a box, optionally within a circle (cx, cy, r) in texture px. */
  async moments(tex: GPUTexture, box: Box, circle?: { cx: number; cy: number; r: number }): Promise<Moments> {
    const { partial } = await this.dispatch('moments', tex, box, circle ? [circle.cx, circle.cy, circle.r * circle.r] : [0, 0, -1], 0, [0, 1, 0]);
    const n = partial!.length / 16;
    const sums = [0, 1, 2, 3].map((k) => pairwiseSum(Float64Array.from({ length: n }, (_, g) => partial![16 * g + k]!)));
    const count = pairwiseSum(Float64Array.from({ length: n }, (_, g) => partial![16 * g + 12]!));
    const min = [0, 1, 2, 3].map((k) => Math.min(...Array.from({ length: n }, (_, g) => (partial![16 * g + 12]! > 0 ? partial![16 * g + 4 + k]! : Infinity))));
    const max = [0, 1, 2, 3].map((k) => Math.max(...Array.from({ length: n }, (_, g) => (partial![16 * g + 12]! > 0 ? partial![16 * g + 8 + k]! : -Infinity))));
    return { mean: sums.map((s) => (count ? s / count : 0)), min, max, count };
  }

  /** Histogram of one channel (0..2) or L = mean of RGB (3) over [lo, hi), bins ≤ 4096. */
  async histogram(tex: GPUTexture, box: Box, channel: number, lo: number, hi: number, bins: number): Promise<Uint32Array> {
    if (bins > 4096) throw new Error('histogram: at most 4096 bins');
    const { bins: b } = await this.dispatch('histogram', tex, box, [0, 0, -1], channel, [lo, hi, bins]);
    return b!;
  }
}

/** Percentile from a histogram over [lo, hi): linear within the bin. */
export function histPercentile(bins: ArrayLike<number>, lo: number, hi: number, p: number): number {
  let total = 0;
  for (let i = 0; i < bins.length; i++) total += bins[i]!;
  if (!total) return lo;
  const target = p * total;
  let acc = 0;
  const w = (hi - lo) / bins.length;
  for (let i = 0; i < bins.length; i++) {
    const b = bins[i]!;
    if (acc + b >= target && b > 0) return lo + w * (i + (target - acc) / b);
    acc += b;
  }
  return hi;
}
