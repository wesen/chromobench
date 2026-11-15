// Stage 5 parity: blur vs direct f64 convolution, halation laws, tile/halo/global-field parity, grain
// statistics and tile invariance, and the SAT probe. Each has a broken variant that must fail.
import satCode from '../../kernels/sat.wgsl?raw';
import { ChainRunner } from '../chain/run.ts';
import { OP, type Segment } from '../chain/program.ts';
import { GpuEngine } from '../engine-gpu.ts';
import { defineStruct } from '../layout.ts';
import { Blur } from '../spatial.ts';
import { TableManager } from '../tables/manager.ts';
import { planTiles } from '../tiles.ts';
import { Graph } from '@chromobench/contract';
import { runtime } from './page-shared.ts';

type T = (o: Record<string, unknown>) => Promise<unknown>;

function blocks(w: number, h: number, b: number, seed: number, ch = 4): Float32Array {
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const nb = Math.ceil(w / b) * Math.ceil(h / b);
  const vals = Array.from({ length: nb * ch }, rnd);
  const bw = Math.ceil(w / b);
  const out = new Float32Array(w * h * ch);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let k = 0; k < ch; k++) out[(y * w + x) * ch + k] = vals[(Math.floor(y / b) * bw + Math.floor(x / b)) * ch + k]!;
  return out;
}

/** Direct 2-D Gaussian convolution in f64, clamp-to-edge, truncated at 5σ, normalised. */
function convolve2D(src: Float32Array, w: number, h: number, sigma: number, c: number, chans: number): Float64Array {
  const out = new Float64Array(w * h);
  if (sigma <= 0) {
    for (let i = 0; i < w * h; i++) out[i] = src[i * chans + c]!;
    return out;
  }
  const R = Math.ceil(5 * sigma);
  const g = Array.from({ length: 2 * R + 1 }, (_, i) => Math.exp(-0.5 * ((i - R) / sigma) ** 2));
  const tot = g.reduce((a, b) => a + b, 0) ** 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let j = -R; j <= R; j++) {
      const yy = Math.min(h - 1, Math.max(0, y + j));
      for (let i = -R; i <= R; i++) s += g[i + R]! * g[j + R]! * src[(yy * w + Math.min(w - 1, Math.max(0, x + i))) * chans + c]!;
    }
    out[y * w + x] = s / tot;
  }
  return out;
}

let ctx: { blur: Blur; ch: ChainRunner } | null = null;
async function tools() {
  const rt = await runtime();
  ctx ??= { blur: new Blur(rt), ch: new ChainRunner(rt, new TableManager(rt)) };
  return { rt, ...ctx };
}

async function readTex(ch: ChainRunner, t: GPUTexture): Promise<Float32Array> {
  return ch.readTexture(t, t.width, t.height);
}

/** Runs `pipe` once on the whole frame and per tile (read rect → core) and compares, in 8-bit levels. */
async function tileParity(halo: number, pipe: (t: GPUTexture, tile: { read: { x: number; y: number; w: number; h: number } } | null) => Promise<GPUTexture>) {
  const { rt, ch } = await tools();
  const W = 512, H = 384;
  const img = blocks(W, H, 6, 99);
  const whole = ch.upload(img, W, H, 4);
  const one = await pipe(whole, null);
  const ref = await readTex(ch, one);
  rt.textures.release(one);
  const plan = planTiles({ w: W, h: H, umPerPx: 1 }, [], { budgetBytes: 2 ** 29, limits: { maxTextureDimension2D: 8192 } }, { tile: 256 });
  const tiled = new Float32Array(W * H * 4);
  for (const t of plan.tiles) {
    const read = { x: Math.max(0, t.core.x - halo), y: Math.max(0, t.core.y - halo), w: 0, h: 0 };
    read.w = Math.min(W, t.core.x + t.core.w + halo) - read.x;
    read.h = Math.min(H, t.core.y + t.core.h + halo) - read.y;
    const sub = new Float32Array(read.w * read.h * 4);
    for (let y = 0; y < read.h; y++) sub.set(img.subarray(((read.y + y) * W + read.x) * 4, ((read.y + y) * W + read.x + read.w) * 4), y * read.w * 4);
    const tt = ch.upload(sub, read.w, read.h, 4);
    const o = await pipe(tt, { read });
    const px = await readTex(ch, o);
    rt.textures.release(o);
    rt.textures.release(tt);
    for (let y = 0; y < t.core.h; y++) for (let x = 0; x < t.core.w; x++) {
      const sx = t.core.x - read.x + x, sy = t.core.y - read.y + y;
      tiled.set(px.subarray((sy * read.w + sx) * 4, (sy * read.w + sx) * 4 + 4), ((t.core.y + y) * W + t.core.x + x) * 4);
    }
  }
  rt.textures.release(whole);
  let max = 0, sum = 0, n = 0;
  for (let i = 0; i < ref.length; i++) {
    if (i % 4 === 3) continue;
    const d = Math.abs(ref[i]! - tiled[i]!) * 255;
    max = Math.max(max, d);
    sum += d;
    n++;
  }
  return { tiles: plan.tiles.length, halo, maxLevels: max, meanLevels: sum / n };
}

const SATS = defineStruct('S', [['w', 'u32'], ['h', 'u32'], ['box', 'u32'], ['scale', 'f32']]);

export const SPATIAL_TESTS: Record<string, T> = {
  async 'blur:vs-direct'(o) {
    const { rt, blur, ch } = await tools();
    const W = 128, H = 96;
    const img = blocks(W, H, 8, 7);
    const sig = [1.5, 3, 6, 0];
    const k = (o['k'] as number | undefined) ?? 3;
    const src = ch.upload(img, W, H, 4);
    const out = await blur.gaussian(src, sig, k);
    const got = await readTex(ch, out);
    rt.textures.release(out);
    let max = 0;
    for (let c = 0; c < 4; c++) {
      const want = convolve2D(img, W, H, sig[c]!, c, 4);
      for (let i = 0; i < W * H; i++) max = Math.max(max, Math.abs(got[4 * i + c]! - want[i]!) * 255);
    }
    // flat field stays flat
    const flat = ch.upload(new Float32Array(W * H * 4).fill(0.37), W, H, 4);
    const fo = await blur.gaussian(flat, sig, k);
    const fv = await readTex(ch, fo);
    let flatDev = 0;
    for (const v of fv) flatDev = Math.max(flatDev, Math.abs(v - 0.37));
    for (const t of [src, flat, fo]) rt.textures.release(t);
    return { k, maxLevels: max, flatDev };
  },

  async 'halation'() {
    const { rt, blur, ch } = await tools();
    const W = 256, H = 256;
    const E = new Float32Array(W * H);
    // uniform exposure 1 with bright highlights well inside the frame (clamp-to-edge then conserves mass)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const d1 = (x - 110) ** 2 + (y - 120) ** 2, d2 = (x - 150) ** 2 + (y - 140) ** 2;
      E[y * W + x] = 1 + (d1 < 64 ? 40 : 0) + (d2 < 25 ? 80 : 0) + ((x >> 3) % 2 && x > 90 && x < 166 && y > 90 && y < 166 ? 0.5 : 0);
    }
    const mean = (a: ArrayLike<number>, stride = 4) => { let s = 0; for (let i = 0; i < a.length; i += stride) s += a[i]!; return s / (a.length / stride); };
    const src = ch.upload(E, W, H, 1);
    const good = await blur.halation(src, 65, 6, 0.3);
    const bad = await blur.halation(src, 65, 6, 0.3, { normalise: false });
    const g = await readTex(ch, good);
    const b = await readTex(ch, bad);
    const m0 = mean(E, 1);
    // the law log10(K∗E) ≥ K∗log10(E): blur E then log, against blur of log E (σ = 65 µm at 6 µm/px)
    const KE = await blur.gaussian(src, [65 / 6, 0, 0, 0]);
    const logE = ch.upload(Float32Array.from(E, (v) => Math.log10(v)), W, H, 1);
    const KlogE = await blur.gaussian(logE, [65 / 6, 0, 0, 0]);
    const a = await readTex(ch, KE);
    const l = await readTex(ch, KlogE);
    let minGap = Infinity, uniformGap = 0, maxGap = 0;
    for (let i = 0; i < W * H; i++) {
      const gap = Math.log10(a[4 * i]!) - l[4 * i]!;
      minGap = Math.min(minGap, gap);
      maxGap = Math.max(maxGap, gap);
      const x = i % W, y = Math.floor(i / W);
      if (x < 20 && y < 20) uniformGap = Math.max(uniformGap, Math.abs(gap));
    }
    for (const t of [src, good, bad, KE, logE, KlogE]) rt.textures.release(t);
    return { meanRelGood: mean(g) / m0 - 1, meanRelStudio: mean(b) / m0 - 1, lawMinGap: minGap, lawMaxGap: maxGap, uniformGap };
  },

  'tiles:halo8': async () => {
    const { blur } = await tools();
    return tileParity(8, async (t) => { const a = await blur.gaussian(t, [1, 1, 1, 1]); const b = await blur.gaussian(a, [1, 1, 1, 1]); (await tools()).rt.textures.release(a); return b; });
  },
  'tiles:no-halo': async () => {
    const { blur } = await tools();
    return tileParity(0, async (t) => { const a = await blur.gaussian(t, [1, 1, 1, 1]); const b = await blur.gaussian(a, [1, 1, 1, 1]); (await tools()).rt.textures.release(a); return b; });
  },
  'tiles:wide-per-tile': async () => {
    const { blur } = await tools();
    return tileParity(8, (t) => blur.gaussian(t, [16, 16, 16, 16]));
  },
  'tiles:wide-global-field': async (o) => {
    const { rt, blur, ch } = await tools();
    // The field is computed once on the whole frame at downsample s (σ/s ≥ 2 gives s = 8) and every
    // tile samples it at frame coordinates. (a) Tiles against a one-pass render that samples the same
    // field: must agree exactly (textbook §4.7: "read from the global pass errs by 0"). (b) The field
    // against the full-resolution σ = 16 blur, away from the frame edge (3σ), where clamp-to-edge of
    // one pixel and of an 8-px block differ by construction.
    const W = 512, H = 384;
    const img = blocks(W, H, 6, 99);
    const whole = ch.upload(img, W, H, 4);
    const plan = planTiles({ w: W, h: H, umPerPx: 1 }, [{ id: 'wide', sigmaUm: 16, fieldOk: true }], { budgetBytes: 2 ** 29, limits: { maxTextureDimension2D: 8192 } }, { tile: 256 });
    const f0 = plan.fields[0]!;
    const ds = (o['downsample'] as number | undefined) ?? f0.downsample;
    const f = ds === f0.downsample ? f0 : { ...f0, downsample: ds, sigmaPx: 16 / ds, blurSigmaPx: Math.sqrt(256 - (ds * ds - 1) / 12 - (ds * ds) / 6) / ds };
    const down = await blur.downsample(whole, f.downsample);
    const sf = o['uncompensated'] ? f.sigmaPx : f.blurSigmaPx;
    const field = await blur.gaussian(down, [sf, sf, sf, sf]);
    const one = await blur.gaussian(whole, [16, 16, 16, 16]);
    const ref = await readTex(ch, one);
    const onePassFieldTex = await blur.sampleField(field, [0, 0], W, H, [W, H]);
    const onePassField = await readTex(ch, onePassFieldTex);
    let max = 0, sum = 0, n = 0, tileVsOnePass = 0;
    const border = 48;
    for (const t of plan.tiles) {
      const o = await blur.sampleField(field, [t.core.x, t.core.y], t.core.w, t.core.h, [W, H]);
      const px = await readTex(ch, o);
      rt.textures.release(o);
      for (let y = 0; y < t.core.h; y++) for (let x = 0; x < t.core.w; x++) for (let k = 0; k < 3; k++) {
        const fx = t.core.x + x, fy = t.core.y + y;
        const v = px[(y * t.core.w + x) * 4 + k]!;
        tileVsOnePass = Math.max(tileVsOnePass, Math.abs(v - onePassField[(fy * W + fx) * 4 + k]!) * 255);
        if (fx < border || fy < border || fx >= W - border || fy >= H - border) continue;
        const d = Math.abs(v - ref[(fy * W + fx) * 4 + k]!) * 255;
        max = Math.max(max, d);
        sum += d;
        n++;
      }
    }
    for (const t of [whole, down, field, one, onePassFieldTex]) rt.textures.release(t);
    return { downsample: f.downsample, fieldSigmaPx: f.sigmaPx, tileVsOnePassLevels: tileVsOnePass, interiorMaxLevels: max, interiorMeanLevels: sum / n };
  },

  async 'grain:tiles'() {
    const { rt, ch } = await tools();
    const W = 300, H = 200;
    const seg: Segment = { ops: [{ code: OP.GRAIN, flags: 1234, p0: [1, 0.05] }], tables: {} };
    const c = new Float32Array(W * H * 3).fill(0.8);
    const src = ch.upload(c, W, H, 3);
    const full = await ch.run([seg], src, [0, 0], { outW: W, outH: H, frameW: W, frameH: H, region: { x: 0, y: 0, w: W, h: H }, precision: 'preview' });
    const a = await ch.readTexture(full, W, H);
    rt.textures.release(full);
    let diff = 0;
    for (const t of planTiles({ w: W, h: H, umPerPx: 1 }, [], { budgetBytes: 2 ** 29, limits: { maxTextureDimension2D: 8192 } }, { tile: 64 }).tiles) {
      const o = await ch.run([seg], src, [0, 0], { outW: t.core.w, outH: t.core.h, frameW: W, frameH: H, region: t.core, precision: 'preview' });
      const b = await ch.readTexture(o, t.core.w, t.core.h);
      rt.textures.release(o);
      for (let y = 0; y < t.core.h; y++) for (let x = 0; x < t.core.w; x++) for (let k = 0; k < 3; k++) {
        if (!Object.is(b[(y * t.core.w + x) * 4 + k], a[((t.core.y + y) * W + t.core.x + x) * 4 + k])) diff++;
      }
    }
    rt.textures.release(src);
    return { values: W * H * 3, differing: diff };
  },

  async 'grain:stats'() {
    const { rt, ch } = await tools();
    const W = 2048, H = 512;
    const amp = 0.01;
    const seg: Segment = { ops: [{ code: OP.GRAIN, flags: 77, p0: [1, amp] }], tables: {} };
    const src = ch.upload(new Float32Array(W * H * 3).fill(0.95), W, H, 3); // √(c + 0.05) = 1
    const o = await ch.run([seg], src, [0, 0], { outW: W, outH: H, frameW: W, frameH: H, region: { x: 0, y: 0, w: W, h: H }, precision: 'preview' });
    const px = await ch.readTexture(o, W, H);
    rt.textures.release(o);
    rt.textures.release(src);
    const N = new Float64Array(W * H);
    for (let i = 0; i < W * H; i++) N[i] = (px[4 * i]! - 0.95) / amp;
    let m = 0;
    for (const v of N) m += v;
    m /= N.length;
    let v2 = 0;
    for (const v of N) v2 += (v - m) ** 2;
    v2 /= N.length;
    const lag = (L: number, dy = 0) => {
      let s = 0, n = 0;
      for (let y = 0; y < H - dy; y++) for (let x = 0; x < W - L; x++) { s += (N[y * W + x]! - m) * (N[(y + dy) * W + x + L]! - m); n++; }
      return s / n / v2;
    };
    return { n: N.length, mean: m, variance: v2, acf1: lag(1), acf1024: lag(1024), acfY1: lag(0, 1) };
  },

  async 'grain:selwyn'() {
    // engine-level: σ²·A constant across preview scales (textbook §2.5). CHB-012: film.grain is the
    // Poisson sublayer model on the print grid, whose final 0.65 px blur also softens the image, so
    // the field is uniform (a constant RAW through capture.expose and film.develop).
    const rt = await runtime();
    const eng = await GpuEngine.create({ runtime: rt, opfs: false });
    const g = new Graph();
    const W = 512, H = 512;
    const data = new Float32Array(W * H * 3).fill(0.12);
    const info = {
      sha256: 'f'.repeat(64), format: 'raw' as const, width: W, height: H, channels: 3 as const, bits: 16, sample: 'float' as const,
      encoding: { value: 'linear' as const, evidence: 'format' as const }, levels: { black: [0, 0, 0], white: [1, 1, 1], from: 'default' as const }, clippedFraction: 0, notes: [],
    };
    eng.openDecoded(info, data);
    g.registerSource(info);
    const src = g.intern('source.open', [], { source: info.sha256, encoding: 'linear', umPerPx: 36000 / W }).node // a 36 mm frame;
    const ex = g.intern('capture.expose', [g.intern('source.xyz', [src.id], {}).node.id], { stock: 'kodak_portra_400' }).node;
    const base = g.intern('film.develop', [ex.id], {}).node;
    const gr = g.intern('film.grain', [base.id], { amount: 1, size_um: 12, seed: 5 }).node;
    eng.adopt(g.closure(gr.id));
    const out: { scale: number; variance: number; sigma2A: number }[] = [];
    for (const scale of [1, 0.5, 0.25]) {
      const a = await (await eng.evaluate(gr, { scale, precision: 'preview' })).read();
      let s = 0, s2 = 0, n = 0;
      for (let i = 0; i < a.length; i += 3) { s += a[i]!; s2 += a[i]! * a[i]!; n++; }
      const v = s2 / n - (s / n) ** 2;
      out.push({ scale, variance: v, sigma2A: v / (scale * scale) });
    }
    eng.dispose();
    return { scales: out, spread: Math.max(...out.map((o) => o.sigma2A)) / Math.min(...out.map((o) => o.sigma2A)) - 1 };
  },

  async sat() {
    const rt = await runtime();
    const dev = rt.device;
    const W = 4096, H = 2731, box = 16;
    // flat field, density 1.0 with σ = 0.010 D noise (Box–Muller, f64 → f32)
    const x = new Float32Array(W * H);
    let s = 12345;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) + 0.5) / 2 ** 32;
    for (let i = 0; i < x.length; i += 2) {
      const r = Math.sqrt(-2 * Math.log(rnd()));
      const t = 2 * Math.PI * rnd();
      x[i] = 1 + 0.01 * r * Math.cos(t);
      if (i + 1 < x.length) x[i + 1] = 1 + 0.01 * r * Math.sin(t);
    }
    const scale = 2 ** 20;
    const u = SATS.pack({ w: W, h: H, box, scale });
    const nb = Math.floor(W / box) * Math.floor(H / box);
    const mk = (size: number, usage: number) => dev.createBuffer({ size, usage: usage | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
    const ub = mk(u.byteLength, GPUBufferUsage.UNIFORM);
    const xb = mk(x.byteLength, GPUBufferUsage.STORAGE);
    const fb = mk(W * H * 8, GPUBufferUsage.STORAGE);
    const qb = mk(W * H * 8, GPUBufferUsage.STORAGE);
    const vb = mk(nb * 8, GPUBufferUsage.STORAGE);
    dev.queue.writeBuffer(ub, 0, u);
    dev.queue.writeBuffer(xb, 0, x);
    const enc = dev.createCommandEncoder();
    for (const [entry, count] of [['rows', H], ['cols', W], ['boxVar', nb]] as const) {
      const pipe = await rt.pipelines.get({ name: `sat.${entry}`, code: satCode, entryPoint: entry });
      const all = [ub, xb, fb, qb, vb];
      const used = entry === 'boxVar' ? [0, 2, 3, 4] : entry === 'rows' ? [0, 1, 2, 3] : [0, 2, 3];
      const bg = dev.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: used.map((i) => ({ binding: i, resource: { buffer: all[i]! } })) });
      const p = enc.beginComputePass();
      p.setPipeline(pipe);
      p.setBindGroup(0, bg);
      p.dispatchWorkgroups(Math.ceil(count / 64));
      p.end();
    }
    dev.queue.submit([enc.finish()]);
    const v = new Float32Array(await rt.readBuffer(vb, nb * 8));
    // per-box σ estimates (16 × 16 boxes), summarised by their median: averaging the variances over
    // all boxes would let the f32 rounding errors cancel; one box's estimate is what a kernel uses
    const med = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1]!;
    const bf: number[] = [], bu: number[] = [];
    let negF = 0;
    for (let i = 0; i < nb; i++) {
      if (v[2 * i]! < 0) negF++;
      bf.push(Math.sqrt(Math.max(0, v[2 * i]!)));
      bu.push(Math.sqrt(Math.max(0, v[2 * i + 1]!)));
    }
    // the true σ of the samples (f64), for reference
    let m = 0, q = 0;
    for (const t of x) m += t;
    m /= x.length;
    for (const t of x) q += (t - m) ** 2;
    for (const b of [ub, xb, fb, qb, vb]) b.destroy();
    return { w: W, h: H, box, boxes: nb, sigmaF32: med(bf), sigmaU32: med(bu), negativeVarF32: negF / nb, sigmaTrue: Math.sqrt(q / x.length) };
  },
};
