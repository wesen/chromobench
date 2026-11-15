// The parity page's API: window.parity.run(name, opts) returns JSON numbers (guide §8 "How to run").
// Loaded by packages/gpu/parity-page/index.html; driven by test/browser/*.spec.ts.
import { isChromobenchError, toDiagnostic } from '@chromobench/contract';
import probeCode from '../../kernels/probe.wgsl?raw';
import { buildTableGpu, type BuildHooks } from '../tables/build-gpu.ts';
import { WorkerPool } from '../tables/build-workers.ts';
import { OpfsStore, TableCache } from '../tables/cache.ts';
import { keyFor } from '../tables/keys.ts';
import type { SolveInputs, SpectralInputs } from '../tables/inputs.ts';
import { compare, type ParityReport } from './harness.ts';
import { currentOracle, gold, ref, runtime } from './page-shared.ts';
import { buildTableF64 } from '../physics/oracle.ts';
import { bradfordMatrix, D65 } from '@chromobench/core';
import { CHAIN_TESTS } from './chain-tests.ts';
import { SPATIAL_TESTS } from './spatial-tests.ts';
import { OUTPUT_TESTS } from './output-tests.ts';
import { LAW_TESTS } from './law-tests.ts';
import { DIGITAL_TESTS } from './digital-tests.ts';
import { BENCH_TESTS } from './bench-tests.ts';
import { FILM_TESTS } from './film-tests.ts';
import { RESIDENCY_TESTS } from './residency-tests.ts';
import { GpuEngine } from '../engine-gpu.ts';
import { loadDefaultPhysicsData } from '../physics/data.ts';
// the conformance generator, imported by path: the package index also exports Vitest wrappers
import { generateCases, makeEnv } from '@chromobench/conformance/generate';

async function tableParity(kind: 'solve' | 'pd' | 'print', hooks: BuildHooks, tol: number, name: string, override?: SpectralInputs): Promise<ParityReport> {
  const rt = await runtime();
  const s = gold();
  const inp: SolveInputs | SpectralInputs = override ?? (kind === 'solve' ? s.solve : kind === 'pd' ? s.pd : s.print);
  const slow = override ? buildTableF64(currentOracle(), override) : ref(kind);
  const fast = await buildTableGpu(rt, inp, hooks);
  rt.textures.release(fast.texture);
  if (kind === 'solve') {
    const r = compare(name, fast.data, slow.data, { tolerance: tol, channels: [0, 1, 2], include: (i) => slow.data[4 * i + 3]! < 0.01, flip: { channel: 3, threshold: 0.01 }, maxFlips: 0 });
    let reach = 0;
    for (let i = 0; i < slow.data.length / 4; i++) if (slow.data[4 * i + 3]! < 0.01) reach++;
    r.extra = { ms: fast.ms, reachable: reach, nodes: slow.data.length / 4 };
    return r;
  }
  const r = compare(name, fast.data, slow.data, { tolerance: tol, channels: [0, 1, 2] });
  r.extra = { ms: fast.ms };
  return r;
}

function adaptedPrint(): SpectralInputs {
  const s = gold();
  return { ...s.print, M: bradfordMatrix(currentOracle().spectral(s.print, [0, 0, 0]), D65) };
}

// The solve table against f64 (CHB-034): 2.38e-6 on Metal (M1 Max), 2.62e-6 on SwiftShader on that Mac, below 2.5e-6
// under SwiftShader on Linux; the broken variant (gtol 1e-5) measures 1.38e-5 to 1.45e-5, so it still fails by 4.6x.
const SOLVE_TOL = 3e-6;

type Test = (opts: Record<string, unknown>) => Promise<unknown>;

const TESTS: Record<string, Test> = {
  async caps() {
    const rt = await runtime();
    const a = await navigator.gpu.requestAdapter();
    return { caps: rt.caps, name: rt.name, adapterLimits: { maxTextureDimension2D: a!.limits.maxTextureDimension2D, maxBufferSize: a!.limits.maxBufferSize, maxStorageBufferBindingSize: a!.limits.maxStorageBufferBindingSize, maxComputeWorkgroupStorageSize: a!.limits.maxComputeWorkgroupStorageSize } };
  },

  async 'compile-error'() {
    const rt = await runtime();
    try {
      await rt.pipelines.get({ name: 'broken', code: '@compute @workgroup_size(1)\nfn main() {\n  let x: f32 = undefined_name;\n}\n' });
      return { thrown: false };
    } catch (e) {
      return { thrown: true, diag: toDiagnostic(e) };
    }
  },

  async 'uniform-control-flow'() {
    // the barrier rule (textbook §4.5): an early return before workgroupBarrier() is refused
    const rt = await runtime();
    const code = 'var<workgroup> s: array<f32, 64>;\n@compute @workgroup_size(64)\nfn main(@builtin(local_invocation_index) li: u32) {\n  if (li >= 32u) { return; }\n  s[li] = 1.0;\n  workgroupBarrier();\n}\n';
    try {
      await rt.pipelines.get({ name: 'ucf', code });
      return { refused: false };
    } catch (e) {
      return { refused: true, message: toDiagnostic(e).message };
    }
  },

  async 'device-lost'() {
    const rt = await runtime();
    const s = gold();
    const inflight = buildTableGpu(rt, s.pd).then(() => 'resolved', (e) => (isChromobenchError(e) ? e.code : `other: ${String(e)}`));
    rt.device.destroy();
    const first = await inflight;
    let after = '';
    try {
      rt.check();
    } catch (e) {
      after = isChromobenchError(e) ? e.code : String(e);
    }
    await new Promise((r) => setTimeout(r, 10));
    const rt2 = await runtime(); // recreated
    const t = await buildTableGpu(rt2, s.pd);
    return { first, after, recreated: rt2 !== rt, rebuilt: t.data.length };
  },

  'table:solve': () => tableParity('solve', {}, SOLVE_TOL, 'solve'),
  'table:solve:gtol1e-5': () => tableParity('solve', { gtol: 1e-5 }, SOLVE_TOL, 'solve gtol 1e-5'),
  'table:pd': () => tableParity('pd', {}, 7.2e-7, 'pd'),
  'table:pd:log2-10-rounded': () => tableParity('pd', { codeTransform: (c) => c.replace('LOG2_10: f32 = 3.321928094887362', 'LOG2_10: f32 = 3.32') }, 7.2e-7, 'pd LOG2_10 = 3.32'),
  'table:print': () => tableParity('print', {}, 4.2e-7, 'print'),
  // core's print table is XYZ under the viewing light (M = I since CHB-017), where row- and column-major
  // packing agree; the broken variant therefore runs a print table with a non-symmetric M (Bradford to
  // D65), built both ways, so the packing bug still shows.
  'table:print:row-major': () => tableParity('print', { rowMajor: true }, 4.2e-7, 'print row-major M', adaptedPrint()),
  // f32 M · Σ with a full Bradford M costs a few ulp more than M = I: 6e-7 measured, so 1e-6 here
  'table:print:adapted': () => tableParity('print', {}, 1e-6, 'print, M = Bradford to D65', adaptedPrint()),

  async 'workers-bitwise'() {
    const pool = new WorkerPool(4);
    const s = gold();
    const out: Record<string, unknown> = {};
    for (const kind of ['solve', 'pd', 'print'] as const) {
      const inp = kind === 'solve' ? s.solve : kind === 'pd' ? s.pd : s.print;
      const t0 = performance.now();
      const w = await pool.build(inp, { urgent: kind !== 'solve' });
      const ms = performance.now() - t0;
      const m = ref(kind);
      const a = new Uint32Array(w.data.buffer);
      const b = new Uint32Array(m.data.buffer);
      let diff = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
      out[kind] = { words: a.length, differing: diff, ms };
    }
    out['workers'] = pool.size;
    pool.terminate();
    return out;
  },

  async 'opfs-write'() {
    const s = gold();
    const key = keyFor(s.pd, { builder: 'f64' });
    const c = new TableCache(new OpfsStore());
    await c.put(key, ref('pd'));
    return { ok: true };
  },

  async 'opfs-read'() {
    const s = gold();
    const c = new TableCache(new OpfsStore());
    const t = await c.get(keyFor(s.pd, { builder: 'f64' }));
    const changed = await c.get(keyFor({ ...s.pd, range: [0, 2.7] }, { builder: 'f64' }));
    if (!t) return { hit: false, stats: c.stats };
    const a = new Uint32Array(t.data.buffer);
    const b = new Uint32Array(ref('pd').data.buffer);
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
    return { hit: true, differing: diff, changedDomainHit: changed !== null, stats: c.stats };
  },

  async wqul() {
    const rt = await runtime();
    const dev = rt.device;
    const ints = new Uint32Array([0xffffffff, 1, 0x7fffffff, 0x10000, 3]);
    const n = 4096;
    const xs = new Float32Array(n);
    for (let i = 0; i < n; i++) xs[i] = -8 + (16 * i) / (n - 1);
    const mk = (data: ArrayBufferView<ArrayBuffer> | number, usage: number) => {
      const size = typeof data === 'number' ? data : data.byteLength;
      const b = dev.createBuffer({ size, usage: usage | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
      if (typeof data !== 'number') dev.queue.writeBuffer(b, 0, data);
      return b;
    };
    const bi = mk(ints, GPUBufferUsage.STORAGE);
    const bx = mk(xs, GPUBufferUsage.STORAGE);
    const oi = mk(32, GPUBufferUsage.STORAGE);
    const of = mk(n * 16, GPUBufferUsage.STORAGE);
    const pipe = await rt.pipelines.get({ name: 'probe', code: probeCode });
    const bg = dev.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [bi, bx, oi, of].map((b, i) => ({ binding: i, resource: { buffer: b } })) });
    const enc = dev.createCommandEncoder();
    const p = enc.beginComputePass();
    p.setPipeline(pipe);
    p.setBindGroup(0, bg);
    p.dispatchWorkgroups(n / 64);
    p.end();
    dev.queue.submit([enc.finish()]);
    const I = new Uint32Array(await rt.readBuffer(oi, 24));
    const F = new Float32Array(await rt.readBuffer(of, n * 16));
    let e2 = 0, l2 = 0, p10 = 0, l10 = 0;
    for (let i = 0; i < n; i++) {
      const x = xs[i]!;
      const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-30);
      e2 = Math.max(e2, rel(F[4 * i]!, 2 ** x));
      if (Math.abs(x) > 1e-3) l2 = Math.max(l2, Math.abs(F[4 * i + 1]! - Math.log2(Math.abs(x))));
      p10 = Math.max(p10, rel(F[4 * i + 2]!, 10 ** x));
      if (Math.abs(x) > 1e-3) l10 = Math.max(l10, Math.abs(F[4 * i + 3]! - Math.log10(Math.abs(x))));
    }
    for (const b of [bi, bx, oi, of]) b.destroy();
    return {
      ints: Array.from(I),
      expected: [0, 0x80000000, 0, 0xfffffffe, 0x80000000, 4],
      exp2MaxRel: e2, log2MaxAbs: l2, pow10ViaExp2MaxRel: p10, log10ViaLog2MaxAbs: l10,
      adapter: rt.name,
    };
  },

  ...CHAIN_TESTS,
  ...SPATIAL_TESTS,
  ...OUTPUT_TESTS,
  ...LAW_TESTS,
  ...DIGITAL_TESTS,
  ...BENCH_TESTS,
  ...FILM_TESTS,
  ...RESIDENCY_TESTS,

  /** CHB-002's generated conformance suite against GpuEngine (fresh engine per case, shared device). */
  async conformance(o) {
    const rt = await runtime();
    const make = () => GpuEngine.create({ runtime: rt, opfs: false });
    const probe = await make();
    const cases = generateCases(probe.capabilities().ops);
    probe.dispose();
    const only = o['filter'] as string | undefined;
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const c of cases) {
      if (only && !c.id.includes(only)) continue;
      const env = await makeEnv(make);
      try {
        await c.run(env);
        results.push({ id: c.id, ok: true });
      } catch (e) {
        results.push({ id: c.id, ok: false, error: e instanceof Error ? e.message : String(e) });
      } finally {
        env.engine.dispose();
      }
    }
    return { total: results.length, passed: results.filter((r) => r.ok).length, failures: results.filter((r) => !r.ok) };
  },

  /** Engine smoke: a negative-scan chain through GpuEngine, every domain tapped. */
  async 'engine:taps'() {
    const rt = await runtime();
    const eng = await GpuEngine.create({ runtime: rt, opfs: false });
    const g = (await import('@chromobench/contract')).Graph;
    const graph = new g();
    const src = graph.intern('source.pattern', [], { domain: 'camera-linear', width: 40, height: 30, seed: 9 }).node;
    const chainOps: [string, Record<string, unknown>][] = [
      ['scan.density', {}], ['invert.dyes', { stock: 'kodak_gold_200', scanner: 'xt5-rgb-led' }],
      ['print.expose', {}], ['print.combine', { filters: [{ logH: [0.1, 0, -0.05], amount: 1 }] }], ['print.develop', {}], ['view.reflect', {}], ['view.flare', {}], ['output.display', { knee: 'clip' }],
    ];
    let prev = src;
    const out: Record<string, unknown> = {};
    for (const [op, args] of chainOps) {
      prev = graph.intern(op, [prev.id], args).node;
      eng.adopt(graph.closure(prev.id));
      const r = await eng.evaluate(prev, { scale: 0.5, precision: 'preview' });
      const d = await r.read();
      let finite = true;
      for (const v of d) if (!Number.isFinite(v)) finite = false;
      out[op] = { domain: r.info.domain, channels: r.info.channels, w: r.width, h: r.height, finite, first: Array.from(d.slice(0, r.info.channels)) };
    }
    const stats = graph.intern('measure.stats', [prev.id], {}).node;
    eng.adopt(graph.closure(stats.id));
    out['measure.stats'] = (await eng.measure(stats)).value;
    eng.dispose();
    return out;
  },
};

async function run(name: string, opts: Record<string, unknown> = {}): Promise<unknown> {
  const t = TESTS[name];
  if (!t) throw new Error(`no parity test ${name}; known: ${Object.keys(TESTS).join(', ')}`);
  try {
    return await t(opts);
  } catch (e) {
    return { error: toDiagnostic(e) };
  }
}

declare global {
  interface Window { parity: { run: typeof run; names: () => string[] } }
}
await loadDefaultPhysicsData(); // packs fetched from /packs/ (packages/data/vite-packs.ts), so sync defaultPhysicsData() works below
window.parity = { run, names: () => Object.keys(TESTS) };
document.body.dataset['ready'] = '1';
