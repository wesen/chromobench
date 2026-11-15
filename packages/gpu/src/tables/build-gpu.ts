// GPU (f32) table builds: SOLVE and SPECTRAL dispatch on the runtime, one invocation per node,
// 64 per workgroup (⌈35,937/64⌉ = 562 groups at N = 33). Results go to a storage buffer (read back
// for caching and parity) and to a 3-D rgba32float texture for the chain. Host side rebuilt from
// gpu.js run/gpuSolve/gpuSpectral (3550–3604) on pooled buffers and generated uniform packers.
import { ChromobenchError } from '@chromobench/contract';
import solveCode from '../../kernels/solve.wgsl?raw';
import spectralCode from '../../kernels/spectral.wgsl?raw';
import type { GpuRuntime } from '../device.ts';
import { defineStruct } from '../layout.ts';
import type { SolveInputs, SpectralInputs, Table } from './inputs.ts';

export const WG = 64;
export const MAXN = 128;
/** f32 cannot reach the CPU gtol of 1e-9; the Studio raises it to at least 1e-6 (gpu.js 3592, textbook §4.5). */
export const GPU_GTOL_FLOOR = 1e-6;

export const SOLVE_PARAMS = defineStruct('Params', [
  ['K', 'mat3x3f'], ['Dbase', 'vec4f'], ['rng', 'vec4f'],
  ['N', 'u32'], ['n', 'u32'], ['total', 'u32'], ['maxIt', 'u32'],
  ['tol', 'f32'], ['gtol', 'f32'], ['activeSet', 'u32'], ['p2', 'f32'],
]);
export const SPECTRAL_PARAMS = defineStruct('Params', [
  ['M', 'mat3x3f'], ['rng', 'vec4f'], ['N', 'u32'], ['n', 'u32'], ['total', 'u32'], ['mode', 'u32'],
]);

export const SOLVE_WGSL = solveCode;
export const SPECTRAL_WGSL = spectralCode;

/** Test hooks for the parity harness's broken variants. */
export interface BuildHooks {
  /** Rewrites the kernel source (e.g. round LOG2_10 to 3.32). */
  codeTransform?: (code: string) => string;
  /** Packs matrices row-major (a deliberate bug). */
  rowMajor?: boolean;
  /** Overrides the gtol floor (e.g. 1e-5). */
  gtol?: number;
}

export interface GpuTable extends Table {
  texture: GPUTexture;
  ms: number;
}

function pack(arrays: ArrayLike<number>[], n: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(arrays.length * n);
  arrays.forEach((a, i) => out.set(Array.from({ length: n }, (_, k) => a[k]!), i * n));
  return out;
}

async function run(rt: GpuRuntime, name: string, code: string, uniforms: ArrayBuffer, spec: Float32Array<ArrayBuffer>, N: number): Promise<GpuTable> {
  rt.check();
  const dev = rt.device;
  const total = N ** 3;
  const pipe = await rt.pipelines.get({ name, code });
  const t0 = performance.now();
  return rt.validated(`table ${name}`, async () => {
    const ub = rt.buffers.acquire({ size: uniforms.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }, `${name}.uniforms`);
    const sb = rt.buffers.acquire({ size: spec.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }, `${name}.spectra`);
    const ob = rt.buffers.acquire({ size: total * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }, `${name}.out`);
    const tex = rt.textures.acquire({ format: 'rgba32float', w: N, h: N, d: N, dimension: '3d', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC }, `${name}.table`);
    dev.queue.writeBuffer(ub, 0, uniforms);
    dev.queue.writeBuffer(sb, 0, spec);
    const bg = dev.createBindGroup({
      label: pipe.label, layout: pipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: ub, size: uniforms.byteLength } },
        { binding: 1, resource: { buffer: sb, size: spec.byteLength } },
        { binding: 2, resource: { buffer: ob, size: total * 16 } },
        { binding: 3, resource: tex.createView({ dimension: '3d' }) },
      ],
    });
    const enc = dev.createCommandEncoder();
    const pass = enc.beginComputePass(rt.timer.pass(`table.${name}`));
    pass.setPipeline(pipe);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(Math.ceil(total / WG));
    pass.end();
    rt.timer.resolve(enc);
    dev.queue.submit([enc.finish()]);
    const bytes = await rt.readBuffer(ob, total * 16);
    await rt.timer.flush();
    rt.buffers.release(ub);
    rt.buffers.release(sb);
    rt.buffers.release(ob);
    return { N, range: [0, 0] as [number, number], data: new Float32Array(bytes), texture: tex, ms: performance.now() - t0 };
  });
}

export async function buildSolveGpu(rt: GpuRuntime, inp: SolveInputs, hooks: BuildHooks = {}): Promise<GpuTable> {
  const n = inp.B.length;
  if (n > MAXN) throw new ChromobenchError({ code: 'E_EVAL', message: `${n} spectral samples exceed the kernel's ${MAXN}` });
  const u = SOLVE_PARAMS.pack({
    K: inp.K, Dbase: [...inp.Dbase, 0], rng: [inp.range[0], inp.range[1], inp.lo, inp.hi],
    N: inp.N, n, total: inp.N ** 3, maxIt: inp.maxIt, tol: inp.tol,
    gtol: hooks.gtol ?? Math.max(inp.gtol, GPU_GTOL_FLOOR), activeSet: inp.activeSet ? 1 : 0,
  }, { rowMajor: hooks.rowMajor === true });
  const code = hooks.codeTransform ? hooks.codeTransform(SOLVE_WGSL) : SOLVE_WGSL;
  const t = await run(rt, hooks.codeTransform ? 'solve-variant' : 'solve', code, u, pack([...inp.P, ...inp.E, inp.B], n), inp.N);
  t.range = inp.range;
  return t;
}

export async function buildSpectralGpu(rt: GpuRuntime, inp: SpectralInputs, hooks: BuildHooks = {}): Promise<GpuTable> {
  const n = inp.B.length;
  if (n > MAXN) throw new ChromobenchError({ code: 'E_EVAL', message: `${n} spectral samples exceed the kernel's ${MAXN}` });
  const u = SPECTRAL_PARAMS.pack({ M: inp.M, rng: [inp.range[0], inp.range[1], 0, 0], N: inp.N, n, total: inp.N ** 3, mode: inp.mode === 'log' ? 0 : 1 }, { rowMajor: hooks.rowMajor === true });
  const code = hooks.codeTransform ? hooks.codeTransform(SPECTRAL_WGSL) : SPECTRAL_WGSL;
  const t = await run(rt, hooks.codeTransform ? 'spectral-variant' : 'spectral', code, u, pack([...inp.E, inp.B, ...inp.W], n), inp.N);
  t.range = inp.range;
  return t;
}

export function buildTableGpu(rt: GpuRuntime, inp: SolveInputs | SpectralInputs, hooks: BuildHooks = {}): Promise<GpuTable> {
  return inp.kind === 'solve' ? buildSolveGpu(rt, inp, hooks) : buildSpectralGpu(rt, inp, hooks);
}
