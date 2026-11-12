// CHB-012 parity: the forward film path on the GPU against core's reference engine on the SAME graph
// (guide §5.6 kernel table): source.xyz, capture.expose, film.couple (pointwise and diffused),
// film.halation, film.develop and film.grain; pcg4d uniforms bit-identical; grain statistics; a
// digital-raw recipe end to end. Each stage reports its worst difference so the spec can bound it.
import { compile, defaultRecipe, Graph, sha256Hex, type Node, type SourceInfo } from '@chromobench/contract';
import { gaussianKernelSum, RefEngine, uniformAt } from '@chromobench/core';
import { GpuEngine } from '../engine-gpu.ts';
import { FilmGpu } from '../film.ts';
import { defaultPhysicsData } from '../physics/data.ts';
import { Blur } from '../spatial.ts';
import { ChainRunner } from '../chain/run.ts';
import { TableManager } from '../tables/manager.ts';
import { runtime } from './page-shared.ts';

type T = (o: Record<string, unknown>) => Promise<unknown>;

/** A smooth synthetic RAW (camera-linear) with a few hard edges: gradients, a bright window and a red patch. */
function syntheticRaw(w: number, h: number): { info: SourceInfo; data: Float32Array } {
  const data = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 3;
    let r = 0.05 + 0.4 * (x / w), g = 0.08 + 0.3 * (y / h), b = 0.1 + 0.2 * ((x + y) / (w + h));
    if (x > w * 0.6 && x < w * 0.8 && y > h * 0.2 && y < h * 0.5) { r = 12; g = 11; b = 10; } // a window, ~6 stops over
    if (x > w * 0.15 && x < w * 0.35 && y > h * 0.55 && y < h * 0.85) { r = 0.5; g = 0.06; b = 0.08; } // a red object
    data[o] = r; data[o + 1] = g; data[o + 2] = b;
  }
  const sha = sha256Hex(new Uint8Array(data.buffer.slice(0)));
  return {
    info: {
      sha256: sha, format: 'raw', width: w, height: h, channels: 3, bits: 16, sample: 'float', encoding: { value: 'linear', evidence: 'format' },
      levels: { black: [0, 0, 0], white: [1, 1, 1], from: 'default' }, cfa: 'none', clippedFraction: 0, notes: [],
      camera: { make: 'Synthetic', model: 'CHB-012', camToXyz: [[0.62, 0.22, 0.11], [0.27, 0.88, -0.15], [0.03, -0.12, 1.18]], asShotNeutral: [1.05, 1, 0.92], from: 'dng' },
    },
    data,
  };
}

let frameP: Promise<{ gpu: GpuEngine; ref: RefEngine; g: Graph; info: SourceInfo; data: Float32Array }> | null = null;
async function frame(w = 96, h = 64) {
  const rt = await runtime();
  frameP ??= (async () => {
    const gpu = await GpuEngine.create({ runtime: rt, opfs: false });
    const ref = new RefEngine({ data: defaultPhysicsData() });
    const { info, data } = syntheticRaw(w, h);
    gpu.openDecoded(info, data);
    ref.openDecoded(info, data);
    const g = new Graph();
    g.registerSource(info);
    return { gpu, ref, g, info, data };
  })();
  return frameP;
}

async function both(f: Awaited<ReturnType<typeof frame>>, n: Node, scale: number | 'full' = 'full') {
  f.gpu.adopt(f.g.closure(n.id));
  f.ref.adopt(f.g.closure(n.id));
  const a = await (await f.gpu.evaluate(n, { scale, precision: 'export' })).read();
  const b = await (await f.ref.evaluate(n, { scale, precision: 'export' })).read();
  return { a, b, c: (n.info as { channels: number }).channels };
}

function diff(a: ArrayLike<number>, b: ArrayLike<number>, c: number, w: number, h: number, margin = 0): { max: number; mean: number; at: number } {
  let max = 0, sum = 0, n = 0, at = -1;
  for (let y = margin; y < h - margin; y++) for (let x = margin; x < w - margin; x++) for (let k = 0; k < Math.min(3, c); k++) {
    const i = (y * w + x) * c + k;
    const d = Math.abs(a[i]! - b[i]!);
    if (!(d <= max)) { max = d; at = i; }
    sum += d; n++;
  }
  return { max, mean: sum / n, at };
}

export const FILM_TESTS: Record<string, T> = {
  /** pcg4d uniforms: rngProbe (four draws per pixel) against core's uniformAt, bit for bit. */
  async 'film:rng'(o) {
    const rt = await runtime();
    const seed = (o['seed'] as number | undefined) ?? 12345;
    const W = 257, H = 129;
    const ch = new ChainRunner(rt, new TableManager(rt));
    const film = new FilmGpu(rt, new Blur(rt));
    const src = ch.upload(new Float32Array(W * H * 4), W, H, 4);
    const [out] = await film.pass('rngProbe', src, { u: [0, 0, seed] });
    const px = await ch.readTexture(out!, W, H);
    rt.textures.release(out!);
    rt.textures.release(src);
    let differing = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let j = 0; j < 4; j++) if (px[(y * W + x) * 4 + j] !== uniformAt(x, y, 5, seed, j)) differing++;
    film.drop();
    return { values: W * H * 4, differing };
  },

  /** Every forward stage on the same graph in both engines (diffusion and halation on). */
  async 'film:stages'(o) {
    const f = await frame();
    const W = f.info.width, H = f.info.height;
    const I = (op: string, inputs: string[], args: Record<string, unknown> = {}): Node => f.g.intern(op, inputs, args).node;
    const src = I('source.open', [], { source: f.info.sha256, encoding: 'linear' });
    const xyz = I('source.xyz', [src.id], { mode: (o['wb'] as string | undefined) ?? 'as-shot', temperature_K: 5500, tint: 0 });
    const ex = I('capture.expose', [xyz.id], { stock: 'kodak_portra_400', exposureEV: 0.5 });
    const cp = I('film.couple', [ex.id], { amount: 1, diffusion_um: 0 });
    const cd = I('film.couple', [ex.id], { amount: 1, diffusion_um: 20 });
    const ha = I('film.halation', [ex.id], { strength: 2 });
    const dv = I('film.develop', [cp.id], { push: 0, curves: 'precorrected' });
    const dp = I('film.develop', [ex.id], { push: 1, curves: 'datasheet' });
    const out: Record<string, unknown> = {};
    for (const [name, n, margin] of [['xyz', xyz, 0], ['expose', ex, 0], ['couple', cp, 0], ['coupleDiffused', cd, 4], ['halation', ha, 4], ['develop', dv, 0], ['developPush', dp, 0]] as const) {
      const { a, b, c } = await both(f, n);
      out[name] = diff(a, b, c, W, H, margin);
      if (o['debug']) { const d = out[name] as { at: number }; (out[name] as Record<string, unknown>)['gpuRef'] = [a[d.at], b[d.at]]; }
    }
    if (o['debug']) {
      const e = await both(f, ex);
      out['exposeAt3920'] = [e.a[3920], e.b[3920], e.a[3921], e.b[3921]];
    }
    return out;
  },

  /** Grain: GPU and core on a uniform field; mean, variance and the share of identical pixels. */
  async 'film:grain'() {
    const f = await frame();
    const W = f.info.width, H = f.info.height;
    const I = (op: string, inputs: string[], args: Record<string, unknown> = {}): Node => f.g.intern(op, inputs, args).node;
    const src = I('source.open', [], { source: f.info.sha256, encoding: 'linear' });
    const ex = I('capture.expose', [I('source.xyz', [src.id], { mode: 'daylight', temperature_K: 5500, tint: 0 }).id], { stock: 'kodak_portra_400', exposureEV: 0 });
    const dv = I('film.develop', [ex.id], { push: 0, curves: 'datasheet' });
    const gr = I('film.grain', [dv.id], { amount: 1, size_um: 12, seed: 7 });
    const { a, b } = await both(f, gr);
    const base = await both(f, dv);
    const stats = (x: ArrayLike<number>) => {
      let s = 0, s2 = 0;
      for (let i = 0; i < W * H; i++) { const d = x[i * 3 + 1]! - base.b[i * 3 + 1]!; s += d; s2 += d * d; }
      const m = s / (W * H);
      return { mean: m, variance: s2 / (W * H) - m * m };
    };
    let same = 0;
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i]! - b[i]!) < 1e-4) same++;
    return { gpu: stats(a), ref: stats(b), identicalShare: same / a.length, maxDiff: diff(a, b, 3, W, H).max };
  },

  /** FilmGpu.mixture (identity + σ 4 + σ 45, the last in two passes) against core's gaussianKernelSum. */
  async 'film:mixture'() {
    const rt = await runtime();
    const W = 360, H = 300;
    const ch = new ChainRunner(rt, new TableManager(rt));
    const film = new FilmGpu(rt, new Blur(rt));
    let s = 7;
    const rnd = (): number => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    const img = new Float64Array(W * H * 3);
    const blocks = Array.from({ length: 30 * 25 * 3 }, rnd);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let k = 0; k < 3; k++) img[(y * W + x) * 3 + k] = blocks[(Math.floor(y / 12) * 30 + Math.floor(x / 12)) * 3 + k]!;
    const terms = [{ w: [0.5, 0.4, 0.3], sigma: [0, 0, 0] }, { w: [0.3, 0.4, 0.5], sigma: [4, 3, 2] }, { w: [0.2, 0.2, 0.2], sigma: [45, 40, 36] }];
    const src = ch.upload(img, W, H, 3);
    const out = await film.mixture(src, terms);
    const px = await ch.readTexture(out, W, H);
    rt.textures.release(out);
    rt.textures.release(src);
    film.drop();
    const ref = gaussianKernelSum(img, W, H, 3, terms);
    let max = 0, sum = 0, n = 0;
    for (let y = 140; y < 160; y++) for (let x = 160; x < 200; x++) for (let k = 0; k < 3; k++) {
      const d = Math.abs(px[(y * W + x) * 4 + k]! - ref[(y * W + x) * 3 + k]!);
      max = Math.max(max, d); sum += d; n++;
    }
    return { max, mean: sum / n };
  },

  /** A digital-raw recipe through compile: the display image of both engines. */
  async 'film:recipe'() {
    const f = await frame();
    const r = defaultRecipe('digital-raw', { sha256: f.info.sha256, name: 'synthetic.dng' });
    r.capture!.whiteBalance.mode = 'as-shot';
    r.capture!.development.grain.amount = 0;
    const top = compile(r, f.g);
    const disp = top.op === 'output.frame' ? f.g.get(top.inputs[0]!)! : top;
    const { a, b, c } = await both(f, disp);
    let finite = true;
    for (const v of a) if (!Number.isFinite(v)) finite = false;
    return { ...diff(a, b, c, f.info.width, f.info.height, 6), finite, ops: [...new Set(f.g.closure(disp.id).map((d) => d.op))] };
  },
};
