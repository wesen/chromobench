// Chain and lookup parity tests (stage 4) on synthetic frames. The reference is the CPU f64
// evaluation of the same program (exact solve, exact spectral integrals): the interim stand-in for
// CHB-003's reference engine. TODO(CHB-003): evaluate the same graph with core's engine instead.
import { ChainRunner } from '../chain/run.ts';
import { evalPixelF64, LOOKUP, OP, type Segment } from '../chain/program.ts';
import { chromogenOracle, look3 } from '../physics/oracle.ts';
import { TableManager } from '../tables/manager.ts';
import { WorkerPool } from '../tables/build-workers.ts';
import type { GpuRuntime } from '../device.ts';
import { nodeAt, type Vec3 } from '../tables/inputs.ts';
import { compare } from './harness.ts';
import { scanChain, syntheticScan } from './synthetic.ts';
import { gold, ref, runtime } from './page-shared.ts';

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

/** Runs one segment over an interleaved 3-channel frame at full resolution. */
async function runFrame(ch: ChainRunner, seg: Segment, data: Float32Array, w: number, h: number, t: { precision: 'preview' | 'export'; lookup?: number; exact?: boolean; builder?: 'f64' | 'gpu-f32' }): Promise<Float32Array> {
  const rt = (await chain()).rt;
  const src = ch.upload(data, w, h, 3);
  const out = await ch.run([seg], src, [0, 0], { outW: w, outH: h, frameW: w, frameH: h, region: { x: 0, y: 0, w, h }, ...t });
  const px = await ch.readTexture(out, w, h);
  rt.textures.release(out);
  rt.textures.release(src);
  return px;
}

function refFrame(seg: Segment, data: Float32Array, w: number, h: number): Float64Array {
  const out = new Float64Array(w * h * 4);
  for (let i = 0; i < w * h; i++) out.set(evalPixelF64(seg, [data[3 * i]!, data[3 * i + 1]!, data[3 * i + 2]!], [i % w, Math.floor(i / w)], chromogenOracle), 4 * i);
  return out;
}

const W = 96;
const H = 64;

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
  const Kinv = invK(S.solve.K);
  keys.forEach((a, i) => {
    const d32 = [D[3 * i]!, D[3 * i + 1]!, D[3 * i + 2]!];
    const exact = chromogenOracle.solve(S.solve, [d32[0]! + S.solve.Dbase[0], d32[1]! + S.solve.Dbase[1], d32[2]! + S.solve.Dbase[2]]);
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

function invK(K: number[][]): number[][] {
  const det = K[0]![0]! * (K[1]![1]! * K[2]![2]! - K[1]![2]! * K[2]![1]!) - K[0]![1]! * (K[1]![0]! * K[2]![2]! - K[1]![2]! * K[2]![0]!) + K[0]![2]! * (K[1]![0]! * K[2]![1]! - K[1]![1]! * K[2]![0]!);
  const c = (i: number, j: number) => {
    const r = [0, 1, 2].filter((x) => x !== i);
    const s = [0, 1, 2].filter((x) => x !== j);
    return K[r[0]!]![s[0]!]! * K[r[1]!]![s[1]!]! - K[r[0]!]![s[1]!]! * K[r[1]!]![s[0]!]!;
  };
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => (((i + j) % 2 ? -1 : 1) * c(j, i)) / det));
}

const levels = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let max = 0, sum = 0, n = 0, max8 = 0;
  for (let i = 0; i < a.length; i++) {
    if (i % 4 === 3) continue;
    const d = Math.abs(a[i]! - b[i]!) * 255;
    max = Math.max(max, d);
    sum += d;
    n++;
    max8 = Math.max(max8, Math.abs(Math.round(a[i]! * 255) - Math.round(b[i]! * 255)));
  }
  return { maxLevels: max, meanLevels: sum / n, max8bit: max8 };
};

export const CHAIN_TESTS: Record<string, (opts: Record<string, unknown>) => Promise<unknown>> = {
  async 'chain:export-dyes'() {
    const { ch } = await chain();
    const S = gold();
    const { T } = syntheticScan(S.solve, W, H);
    const seg = scanChain(S, 'dyes');
    const t0 = performance.now();
    const got = await runFrame(ch, seg, T, W, H, { precision: 'export' });
    const ms = performance.now() - t0;
    const want = refFrame(seg, T, W, H);
    const r = compare('export film-dyes', got, want, { tolerance: 5e-6, channels: [0, 1, 2], include: (i) => want[4 * i + 3]! < 0.01 });
    let flips = 0;
    for (let i = 0; i < W * H; i++) {
      const e = want[4 * i + 3]!;
      if (Math.abs(e - 0.01) > 1e-5 && (got[4 * i + 3]! < 0.01) !== (e < 0.01)) flips++;
    }
    return { ...r, flips, pass: r.pass && flips === 0, extra: { ms, pixels: W * H } };
  },

  async 'chain:preview-display'(o) {
    const { ch } = await chain();
    const S = gold();
    const { T } = syntheticScan(S.solve, W, H);
    const seg = scanChain(S, 'display');
    const got = await runFrame(ch, seg, T, W, H, { precision: 'preview', ...(o['lookup'] !== undefined ? { lookup: o['lookup'] as number } : {}) });
    const want = refFrame(seg, T, W, H);
    return levels(got, want);
  },

  async 'chain:export-display'() {
    const { ch } = await chain();
    const S = gold();
    const { T } = syntheticScan(S.solve, W, H);
    const seg = scanChain(S, 'display');
    const got = await runFrame(ch, seg, T, W, H, { precision: 'export' });
    return levels(got, refFrame(seg, T, W, H));
  },

  async 'chain:builders-identical'() {
    const { ch, chGpu } = await chain();
    const S = gold();
    const { T } = syntheticScan(S.solve, W, H);
    const seg = scanChain(S, 'display');
    const a = await runFrame(ch, seg, T, W, H, { precision: 'preview', builder: 'f64' });
    const b = await runFrame(chGpu, seg, T, W, H, { precision: 'preview', builder: 'gpu-f32' });
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
