// Chain and lookup parity (stage 4) on synthetic Gold 200 frames. The reference is core's reference
// engine evaluating the SAME graph (CHB-017, one physics): RefEngine exact for the export path and as
// the preview's ground truth, RefEngine tabulated (core's f64 tables through look3) for the preview's
// table path. ChainRunner-level tests (the broken variant, the two table builders) run the segment of
// synthetic.ts scanChain, which is checked to render exactly what GpuEngine lowers the graph to.
import { Graph, type Node } from '@chromobench/contract';
import { RefEngine } from '@chromobench/core';
import { ChainRunner } from '../chain/run.ts';
import { LOOKUP, OP, type Segment } from '../chain/program.ts';
import type { GpuRuntime } from '../device.ts';
import { GpuEngine } from '../engine-gpu.ts';
import { defaultPhysicsData } from '../physics/data.ts';
import { coreOracle, look3 } from '../physics/oracle.ts';
import { TableManager } from '../tables/manager.ts';
import { WorkerPool } from '../tables/build-workers.ts';
import { nodeAt, type Vec3 } from '../tables/inputs.ts';
import { compare } from './harness.ts';
import { REBATE_W, rebateT, scanChain, syntheticScan } from './synthetic.ts';
import { gold, ref, runtime } from './page-shared.ts';
import { uploadF32 } from '../engine/textures.ts';

let runner: { rt: GpuRuntime; tm: TableManager; ch: ChainRunner; tmGpu: TableManager; chGpu: ChainRunner } | null = null;
async function chain() {
  const rt = await runtime();
  if (!runner || runner.rt !== rt) {
    const tm = new TableManager(rt, { workers: new WorkerPool(4) });
    const tmGpu = new TableManager(rt, { accel: 'gpu' });
    runner = { rt, tm, ch: new ChainRunner(rt, tm), tmGpu, chGpu: new ChainRunner(rt, tmGpu) };
  }
  return runner;
}

const W = 96;
const H = 64;

/** The synthetic scan opened in GpuEngine and in core's reference engine (exact and tabulated), one graph. */
interface Frame {
  rt: GpuRuntime;
  gpu: GpuEngine;
  exact: RefEngine;
  tabulated: RefEngine;
  T: Float32Array;
  nodes: { dyes: Node; display: Node; displayTanh: Node; darkroom: Node; masks: Node[]; combined: Node; multi: Node; densityMask: Node; flashMasked: Node };
}
let frameP: Promise<Frame> | null = null;
async function frame(): Promise<Frame> {
  const rt = await runtime();
  const f = frameP ? await frameP : null;
  if (f && f.rt === rt) return f;
  frameP = (async () => {
    const S = gold();
    const { T, tiff } = syntheticScan(S.solve, W, H);
    const data = defaultPhysicsData();
    const gpu = await GpuEngine.create({ runtime: rt, workers: 4, opfs: false });
    const exact = new RefEngine({ data });
    const tabulated = new RefEngine({ data, mode: 'tabulated' });
    const g = new Graph();
    let info = null;
    for (const e of [gpu, exact, tabulated]) info = await e.open({ kind: 'file', sha256: '', bytes: tiff });
    g.registerSource(info!);
    const I = (op: string, inputs: string[], args: Record<string, unknown> = {}): Node => g.intern(op, inputs, args).node;
    const src = I('source.open', [], { source: info!.sha256, encoding: 'linear' });
    const dens = I('scan.density', [src.id], { rebate: { x: 0, y: 0, w: REBATE_W, h: H } });
    const dyes = I('invert.dyes', [dens.id], { stock: S.film, scanner: S.scanner });
    const x = I('print.lights', [I('print.expose', [dyes.id], { paper: S.paper }).id], { logH: [0, 0, 0] });
    const xyz = I('view.reflect', [I('print.develop', [x.id], { paper: S.paper, grade: 2 }).id], { illuminant: 'D50' });
    const display = I('output.display', [I('view.adapt', [I('view.flare', [xyz.id], { flare: 0.48 }).id], { to: 'D65' }).id], { rendering: 'print-as-seen', knee: 'clip' });
    const displayTanh = I('output.display', [I('view.adapt', [I('view.flare', [xyz.id], { flare: 0 }).id], { to: 'D65' }).id], { rendering: 'scan-of-print', knee: 'tanh-shoulder' });
    // CHB-010: a real-mode print (14 s, f/8, +10 M on the neutral pack) on grade 4 (γ 1.45 about the aim grey)
    const xr = I('print.lights', [I('print.expose', [dyes.id], { paper: S.paper, mode: 'real', time_s: 14, filtration: { c: 0, m: 10, y: 0 } }).id], { logH: [0.02, 0, -0.01] });
    const xyzR = I('view.reflect', [I('print.develop', [xr.id], { paper: S.paper, grade: 4 }).id], { illuminant: 'D50' });
    const darkroom = I('output.display', [I('view.adapt', [I('view.flare', [xyzR.id], { flare: 0.48 }).id], { to: 'D65' }).id], { rendering: 'print-as-seen', knee: 'clip' });
    // CHB-010 stage 3: a real-mode print with two packs and three masks (guide §9.3). Main 12 s through the
    // neutral pack; burn 6 s through +15 Y under a feathered sky gradient; dodge 3 s under a tilted ellipse;
    // burn 4 s under painted strokes and the inverse of a luminance band (mask.and).
    const ex = (time_s: number, filtration = { c: 0, m: 0, y: 0 }) => I('print.expose', [dyes.id], { paper: S.paper, mode: 'real', time_s, filtration });
    const sky = I('mask.feather', [I('mask.gradient', [src.id], { from: { x: 0, y: 0 }, to: { x: 0, y: 40 } }).id], { radius_px: 8 });
    const face = I('mask.ellipse', [src.id], { box: { x: 30, y: 20, w: 30, h: 20 }, angle_deg: 25 });
    const strokes = JSON.stringify([{ kind: 'stroke', points: [[10, 50, 0.5], [50, 58, 0.5], [90, 44, 0.5]], radius: 6, hardness: 0.4, mode: 'add' }, { kind: 'stroke', points: [[48, 40, 0.5], [48, 64, 0.5]], radius: 3, hardness: 1, mode: 'erase' }]);
    const xMain = ex(12);
    const band = I('mask.not', [I('mask.luminance', [xMain.id], { above: 0.5, below: 0.65, softness: 0.1 }).id], {});
    const painted = I('mask.and', [I('mask.paint', [src.id], { strokes }).id], { other: band.id });
    const combined = I('print.combine', [xMain.id], { exposures: [ex(6, { c: 0, m: 0, y: 15 }).id, ex(3).id, ex(4).id], masks: [sky.id, face.id, painted.id], modes: ['add', 'subtract', 'add'] });
    const xyzM = I('view.reflect', [I('print.develop', [I('print.lights', [combined.id], { logH: [0.01, 0, -0.02] }).id], { paper: S.paper, grade: 2 }).id], { illuminant: 'D50' });
    const multi = I('output.display', [I('view.adapt', [I('view.flare', [xyzM.id], { flare: 0.48 }).id], { to: 'D65' }).id], { rendering: 'print-as-seen', knee: 'clip' });
    // stage 4 (contract 0.3): a contrast mask made from the main exposure (σ = 18 µm / 6 µm per px = 3 px), applied by
    // print.combine with a burn and a base flash (uniform, not held back by the mask)
    const densityMask = I('print.densityMask', [xMain.id], { amount: 0.4, radius_um: 18 });
    const all = I('mask.luminance', [xMain.id], { above: 0, below: 1, softness: 0 });
    const flashMasked = I('print.combine', [xMain.id], { exposures: [ex(4).id, ex(2).id], masks: [sky.id, all.id], modes: ['add', 'flash-base'], densityMasks: [densityMask.id] });
    for (const n of [display, displayTanh, darkroom, multi, densityMask, flashMasked]) for (const e of [gpu, exact, tabulated]) e.adopt(g.closure(n.id));
    return { rt, gpu, exact, tabulated, T, nodes: { dyes, display, displayTanh, darkroom, masks: [sky, face, painted, band], combined, multi, densityMask, flashMasked } };
  })();
  return frameP;
}

const read = async (e: GpuEngine | RefEngine, n: Node, precision: 'preview' | 'export'): Promise<ArrayLike<number>> => (await e.evaluate(n, { scale: 'full', precision })).read();

/** Runs one segment over an interleaved 3-channel frame at full resolution (4 floats per pixel out). */
async function runFrame(ch: ChainRunner, seg: Segment, data: Float32Array, w: number, h: number, t: { precision: 'preview' | 'export'; lookup?: number; exact?: boolean; builder?: 'f64' | 'gpu-f32' }): Promise<Float32Array> {
  const rt = (await chain()).rt;
  const src = ch.upload(data, w, h, 3);
  const out = await ch.run([seg], src, [0, 0], { outW: w, outH: h, frameW: w, frameH: h, region: { x: 0, y: 0, w, h }, ...t });
  const px = await ch.readTexture(out, w, h);
  rt.textures.release(out);
  rt.textures.release(src);
  return px;
}

/** Display differences in 8-bit levels over the RGB channels of two interleaved buffers. */
function levels(a: ArrayLike<number>, sa: number, b: ArrayLike<number>, sb: number) {
  let max = 0, sum = 0, n = 0, max8 = 0;
  for (let i = 0; i < a.length / sa; i++) for (let k = 0; k < 3; k++) {
    const x = a[i * sa + k]!, y = b[i * sb + k]!;
    const d = Math.abs(x - y) * 255;
    max = Math.max(max, d);
    sum += d;
    n++;
    max8 = Math.max(max8, Math.abs(Math.round(x * 255) - Math.round(y * 255)));
  }
  return { maxLevels: max, meanLevels: sum / n, max8bit: max8 };
}

/** Random keys a in "smooth" solve cells: all eight corners reachable and strictly inside the dye box. */
function smoothKeys(n: number, seed = 1): Vec3[] {
  const T = ref('solve');
  const N = T.N;
  const [lo, hi] = T.range;
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const ok = (i: number, j: number, k: number) => {
    const q = 4 * (i + N * (j + N * k));
    return T.data[q + 3]! < 1e-3 && T.data[q]! > 1e-3 && T.data[q + 1]! > 1e-3 && T.data[q + 2]! > 1e-3;
  };
  const out: Vec3[] = [];
  let guard = 0;
  while (out.length < n && guard++ < n * 200) {
    const a: Vec3 = [lo + (hi - lo) * rnd(), lo + (hi - lo) * rnd(), lo + (hi - lo) * rnd()];
    const ijk = a.map((v) => Math.min(N - 2, Math.floor(((v - lo) / (hi - lo)) * (N - 1))));
    let all = true;
    for (let c = 0; c < 8 && all; c++) all = ok(ijk[0]! + (c & 1), ijk[1]! + ((c >> 1) & 1), ijk[2]! + ((c >> 2) & 1));
    if (all) out.push(a);
  }
  return out;
}

async function lookupTest(mode: number, n: number): Promise<Record<string, unknown>> {
  const { ch } = await chain();
  const S = gold();
  const keys = smoothKeys(n);
  const w = 200;
  const h = Math.ceil(keys.length / w);
  const D = new Float32Array(w * h * 3);
  keys.forEach((a, i) => {
    for (let k = 0; k < 3; k++) D[3 * i + k] = S.solve.K[k]![0] * a[0] + S.solve.K[k]![1] * a[1] + S.solve.K[k]![2] * a[2];
  });
  const seg: Segment = { ops: [{ code: OP.DYES }], tables: { solve: S.solve } };
  const got = await runFrame(ch, seg, D, w, h, { precision: 'preview', lookup: mode, exact: false, builder: 'f64' });
  const T = ref('solve');
  let sq = 0, m = 0, lookMax = 0, flips = 0;
  const Kinv = S.physics.env.forward(S.film, S.scanner).Kinv;
  keys.forEach((a, i) => {
    const d32 = [D[3 * i]!, D[3 * i + 1]!, D[3 * i + 2]!];
    const exact = coreOracle.solve(S.solve, [d32[0]! + S.solve.Dbase[0], d32[1]! + S.solve.Dbase[1], d32[2]! + S.solve.Dbase[2]]);
    const a32 = [0, 1, 2].map((r) => Kinv[r]![0]! * d32[0]! + Kinv[r]![1]! * d32[1]! + Kinv[r]![2]! * d32[2]!);
    const l3 = look3(T, a32);
    for (let k = 0; k < 3; k++) {
      const e = got[4 * i + k]! - exact.c[k]!;
      sq += e * e;
      m++;
      lookMax = Math.max(lookMax, Math.abs(got[4 * i + k]! - l3[k]!));
    }
    if ((got[4 * i + 3]! < 0.01) !== (exact.residual < 0.01)) flips++;
  });
  return { mode, keys: keys.length, rms: Math.sqrt(sq / m), maxVsLook3: lookMax, flips };
}

/**
 * CHB-034: GPU time of the preview display chain per table lookup mode at a working size (default 4000 × 2674, the
 * GPU engine's 4000 px), on the synthetic frame tiled to that size. Modes run round-robin so drift (clocks, heat)
 * falls on all of them alike; each sample is submit → onSubmittedWorkDone after `warmup` unmeasured rounds.
 */
async function lookupBench(o: Record<string, unknown>): Promise<Record<string, unknown>> {
  const w = (o['w'] as number | undefined) ?? 4000;
  const h = (o['h'] as number | undefined) ?? 2674;
  const rounds = (o['rounds'] as number | undefined) ?? 15;
  const warmup = (o['warmup'] as number | undefined) ?? 3;
  const { ch, rt } = await chain();
  const f = await frame();
  const big = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = 3 * ((y % H) * W + (x % W));
    const d = 3 * (y * w + x);
    big[d] = f.T[s]!;
    big[d + 1] = f.T[s + 1]!;
    big[d + 2] = f.T[s + 2]!;
  }
  const seg = scanChain(gold(), 'display', 0.48, rebateT(f.T, W, H));
  const src = ch.upload(big, w, h, 3);
  const modes = { hw: LOOKUP.hw, trilinear: LOOKUP.trilinear, tetra: LOOKUP.tetra } as const;
  const ms: Record<string, number[]> = { hw: [], trilinear: [], tetra: [] };
  for (let r = 0; r < warmup + rounds; r++) {
    for (const [name, lookup] of Object.entries(modes)) {
      await rt.device.queue.onSubmittedWorkDone();
      const t0 = performance.now();
      const out = await ch.run([seg], src, [0, 0], { outW: w, outH: h, frameW: w, frameH: h, region: { x: 0, y: 0, w, h }, precision: 'preview', lookup });
      await rt.device.queue.onSubmittedWorkDone();
      const t = performance.now() - t0;
      rt.textures.release(out);
      if (r >= warmup) ms[name]!.push(t);
    }
  }
  rt.textures.release(src);
  const stat = (a: number[]) => {
    const s = [...a].sort((x, y) => x - y);
    const q = (p: number) => Number(s[Math.min(s.length - 1, Math.floor(p * s.length))]!.toFixed(2));
    return { median: q(0.5), p10: q(0.1), p90: q(0.9), n: s.length };
  };
  return { w, h, rounds, adapter: rt.caps?.adapter ?? null, hw: stat(ms['hw']!), trilinear: stat(ms['trilinear']!), tetra: stat(ms['tetra']!) };
}

/** CHB-034: the GPU upload of an f32 source (unpackF32) equals ChainRunner.upload's CPU expansion, bit for bit. */
async function uploadParity(): Promise<Record<string, unknown>> {
  const { ch, rt } = await chain();
  const w = 37, h = 23;
  const out: Record<string, unknown> = {};
  for (const c of [1, 3, 4]) {
    const data = new Float32Array(w * h * c);
    for (let i = 0; i < data.length; i++) data[i] = Math.fround(Math.sin(i * 12.9898) * 43758.5453) % 1;
    const a = ch.upload(data, w, h, c, 'cpu');
    const b = await uploadF32(rt, data, w, h, c, 'gpu', () => { throw new Error('GPU upload fell back to the CPU'); });
    const pa = await ch.readTexture(a, w, h);
    const pb = await ch.readTexture(b, w, h);
    rt.textures.release(a);
    rt.textures.release(b);
    let diff = 0;
    for (let i = 0; i < pa.length; i++) if (!Object.is(pa[i], pb[i])) diff++;
    out[`c${c}`] = { values: pa.length, differing: diff };
  }
  return out;
}

export const CHAIN_TESTS: Record<string, (opts: Record<string, unknown>) => Promise<unknown>> = {
  'upload:f32': () => uploadParity(),
  'chain:lookup-bench': (o) => lookupBench(o),

  async 'chain:export-dyes'() {
    const f = await frame();
    const t0 = performance.now();
    const got = await read(f.gpu, f.nodes.dyes, 'export');
    const ms = performance.now() - t0;
    const want = await read(f.exact, f.nodes.dyes, 'export');
    const r = compare('export film-dyes vs core exact', got, want, { tolerance: 5e-6, channels: [0, 1, 2], include: (i) => want[4 * i + 3]! < 0.01 });
    let flips = 0;
    for (let i = 0; i < W * H; i++) {
      const e = want[4 * i + 3]!;
      if (Math.abs(e - 0.01) > 1e-5 && (got[4 * i + 3]! < 0.01) !== (e < 0.01)) flips++;
    }
    return { ...r, flips, pass: r.pass && flips === 0, extra: { ms, pixels: W * H } };
  },

  async 'chain:preview-display'(o) {
    const f = await frame();
    const want = await read(f.exact, f.nodes.display, 'export');
    if (o['lookup'] !== undefined) {
      // the broken variant runs the same segment through ChainRunner with the lookup overridden
      const { ch } = await chain();
      const got = await runFrame(ch, scanChain(gold(), 'display', 0.48, rebateT(f.T, W, H)), f.T, W, H, { precision: 'preview', lookup: o['lookup'] as number });
      return levels(got, 4, want, 3);
    }
    const got = await read(f.gpu, f.nodes.display, 'preview');
    const tab = await read(f.tabulated, f.nodes.display, 'export');
    const { ch } = await chain();
    const seg = await runFrame(ch, scanChain(gold(), 'display', 0.48, rebateT(f.T, W, H)), f.T, W, H, { precision: 'preview' });
    return { ...levels(got, 3, want, 3), vsTabulated: levels(got, 3, tab, 3), tabulatedVsExact: levels(tab, 3, want, 3), segmentVsEngine: levels(seg, 4, got, 3) };
  },

  async 'chain:export-display'() {
    const f = await frame();
    const got = await read(f.gpu, f.nodes.display, 'export');
    const tanh = levels(await read(f.gpu, f.nodes.displayTanh, 'export'), 3, await read(f.exact, f.nodes.displayTanh, 'export'), 3);
    return { ...levels(got, 3, await read(f.exact, f.nodes.display, 'export'), 3), tanhScanOfPrint: tanh };
  },

  async 'chain:darkroom'() {
    // CHB-010 real mode and grade: export against core exact, preview against core tabulated
    const f = await frame();
    const exp = levels(await read(f.gpu, f.nodes.darkroom, 'export'), 3, await read(f.exact, f.nodes.darkroom, 'export'), 3);
    const pre = levels(await read(f.gpu, f.nodes.darkroom, 'preview'), 3, await read(f.tabulated, f.nodes.darkroom, 'export'), 3);
    const differs = levels(await read(f.exact, f.nodes.darkroom, 'export'), 3, await read(f.exact, f.nodes.display, 'export'), 3);
    return { export: exp, preview: pre, vsDefaultPrint: differs };
  },

  async 'chain:masks'() {
    // CHB-010: masks, the multi-exposure sum and the density mask against core exact (guide §9.3)
    const f = await frame();
    const masks = [];
    for (const m of f.nodes.masks) masks.push(compare(`mask ${m.op}`, await read(f.gpu, m, 'export'), await read(f.exact, m, 'export'), { tolerance: 1e-5, stride: 1 }));
    const x = compare('combined paper-logH (export)', await read(f.gpu, f.nodes.combined, 'export'), await read(f.exact, f.nodes.combined, 'export'), { tolerance: 2e-4, stride: 3 });
    const xPre = compare('combined paper-logH (preview vs tabulated)', await read(f.gpu, f.nodes.combined, 'preview'), await read(f.tabulated, f.nodes.combined, 'export'), { tolerance: 2e-4, stride: 3 });
    const exp = levels(await read(f.gpu, f.nodes.multi, 'export'), 3, await read(f.exact, f.nodes.multi, 'export'), 3);
    const pre = levels(await read(f.gpu, f.nodes.multi, 'preview'), 3, await read(f.tabulated, f.nodes.multi, 'export'), 3);
    const differs = levels(await read(f.exact, f.nodes.multi, 'export'), 3, await read(f.exact, f.nodes.darkroom, 'export'), 3);
    const dmExact = await read(f.exact, f.nodes.densityMask, 'export');
    const dm = compare('density mask d_m', await read(f.gpu, f.nodes.densityMask, 'export'), dmExact, { tolerance: 1e-4, stride: 1 });
    const dmMax = Math.max(...Array.from(dmExact));
    const flash = compare('burn, base flash and density mask (paper-logH)', await read(f.gpu, f.nodes.flashMasked, 'export'), await read(f.exact, f.nodes.flashMasked, 'export'), { tolerance: 2e-4, stride: 3 });
    const half = await f.gpu.evaluate(f.nodes.multi, { scale: 0.5, precision: 'preview' });
    const halfRef = await f.tabulated.evaluate(f.nodes.multi, { scale: 0.5, precision: 'export' });
    return { masks, x, xPre, export: exp, preview: pre, vsDarkroomPrint: differs, densityMask: dm, densityMaskMax: dmMax, flashMasked: flash, halfScale: levels(await half.read(), 3, await halfRef.read(), 3) };
  },

  async 'chain:builders-identical'() {
    const { ch, chGpu } = await chain();
    const f = await frame();
    const seg = scanChain(gold(), 'display', 0.48, rebateT(f.T, W, H));
    const a = await runFrame(ch, seg, f.T, W, H, { precision: 'preview', builder: 'f64' });
    const b = await runFrame(chGpu, seg, f.T, W, H, { precision: 'preview', builder: 'gpu-f32' });
    let diff8 = 0;
    let maxLevels = 0;
    for (let i = 0; i < a.length; i++) {
      if (i % 4 === 3) continue;
      if (Math.round(a[i]! * 255) !== Math.round(b[i]! * 255)) diff8++;
      maxLevels = Math.max(maxLevels, Math.abs(a[i]! - b[i]!) * 255);
    }
    return { values: (a.length / 4) * 3, differing8bit: diff8, maxLevels };
  },

  async 'chain:node-solve'() {
    // the per-pixel exact solve at node positions reproduces the (GPU-built) table's node values
    const { chGpu, tmGpu } = await chain();
    const S = gold();
    const N = S.solve.N;
    const total = N ** 3;
    const w = N * N;
    const h = N;
    const D = new Float32Array(total * 3);
    for (let q = 0; q < total; q++) {
      const a = nodeAt(q, N, S.solve.range[0], S.solve.range[1]);
      for (let k = 0; k < 3; k++) D[3 * q + k] = S.solve.K[k]![0] * a[0] + S.solve.K[k]![1] * a[1] + S.solve.K[k]![2] * a[2];
    }
    const seg: Segment = { ops: [{ code: OP.DYES }], tables: { solve: S.solve } };
    const got = await runFrame(chGpu, seg, D, w, h, { precision: 'export' });
    const table = (await tmGpu.resolve(S.solve, { builder: 'gpu-f32' })).table;
    return compare('per-pixel solve at nodes vs table', got, table.data, { tolerance: 1e-5, channels: [0, 1, 2], include: (i) => table.data[4 * i + 3]! < 0.01 });
  },

  'lookup:hw': () => lookupTest(LOOKUP.hw, 20000),
  'lookup:trilinear': () => lookupTest(LOOKUP.trilinear, 20000),
  'lookup:tetra': () => lookupTest(LOOKUP.tetra, 20000),
  'lookup:no-half-texel': () => lookupTest(LOOKUP.noHalfTexel, 20000),
};
