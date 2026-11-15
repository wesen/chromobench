// CHB-041 parity: a render smaller than its region reads the source sampled on its grid (a proxy) instead of the
// frame's full-size texture — bit for bit the same pixels, on a camera file (f32 source, the film grain on) and a
// negative scan (16-bit TIFF source, the darkroom's spatial ops) at thumbnail, draft and screen scales and over a
// region; what each engine keeps per frame; and the recovery after an out-of-memory (an injected failure recovers on
// the retry; a budget too small for the render fails with E_GPU_OOM and says so).
import { compile, Graph, newDocument, type Box, type Node } from '@chromobench/contract';
import { GpuEngine } from '../engine-gpu.ts';
import { benchDoc } from './bench-tests.ts';
import { syntheticRaw } from './film-tests.ts';
import { gold, runtime } from './page-shared.ts';
import { syntheticScan } from './synthetic.ts';

type T = (o: Record<string, unknown>) => Promise<unknown>;

/** Bit-level difference of two renders: how many samples differ and the largest |Δ|. */
function bits(a: ArrayLike<number>, b: ArrayLike<number>): { n: number; differ: number; maxAbs: number } {
  let differ = 0, maxAbs = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (Object.is(a[i], b[i])) continue;
    differ++;
    maxAbs = Math.max(maxAbs, Math.abs((a[i] ?? NaN) - (b[i] ?? NaN)) || Infinity);
  }
  return { n: a.length, differ, maxAbs };
}

const SCALES = [0.04, 0.125, 0.29, 0.5, 0.731];

async function compareScales(withProxy: GpuEngine, without: GpuEngine, g: Graph, n: Node, region: Box) {
  withProxy.adopt(g.closure(n.id));
  without.adopt(g.closure(n.id));
  const out: Record<string, ReturnType<typeof bits> & { w: number; h: number }> = {};
  const targets: [string, { scale: number; region?: Box }][] = [...SCALES.map((s) => [`s${s}`, { scale: s }] as [string, { scale: number }]), ['region@0.5', { scale: 0.5, region }]];
  for (const [k, t] of targets) {
    const a = await withProxy.evaluate(n, { ...t, precision: 'preview' });
    const b = await without.evaluate(n, { ...t, precision: 'preview' });
    out[k] = { ...bits(await a.read(), await b.read()), w: a.width, h: a.height };
  }
  return out;
}

/** x rounded to the nearest IEEE half float (ties to even), as an rgba16float texture would store it. */
function f16(x: number): number {
  const native = (Math as unknown as { f16round?: (v: number) => number }).f16round;
  if (native) return native(x);
  if (!Number.isFinite(x) || x === 0) return x;
  const a = Math.abs(x);
  if (a >= 65520) return Math.sign(x) * Infinity;
  const q = 2 ** (Math.max(Math.floor(Math.log2(a)), -14) - 10);
  const m = a / q, fl = Math.floor(m);
  const r = m - fl > 0.5 || (m - fl === 0.5 && fl % 2 === 1) ? fl + 1 : fl;
  return Math.sign(x) * r * q;
}

export const RESIDENCY_TESTS: Record<string, T> = {
  /**
   * CHB-041 (asked: 16-bit storage for full-size intermediates): what storing a camera file's first full-size texture
   * in rgba16float would cost in accuracy. The source is rounded to half floats (the input of film.camMatrix, the texture
   * of the owner's E_GPU_OOM) and the scene cut and the display are compared with the f32 render, at preview and export,
   * against the tolerances the parity specs hold the GPU to against the reference engine (film:scene: scene 3e-5,
   * display 2e-4).
   */
  async 'residency:f16'() {
    const rt = await runtime();
    const gpu = await GpuEngine.create({ runtime: rt, opfs: false, prewarm: false });
    try {
      const raw = syntheticRaw(403, 271);
      const half = { info: { ...raw.info, sha256: raw.info.sha256.replace(/^./, (c) => (c === '0' ? '1' : '0')) }, data: raw.data.map(f16) };
      let rel = 0;
      for (let i = 0; i < raw.data.length; i++) rel = Math.max(rel, Math.abs(half.data[i]! - raw.data[i]!) / Math.max(Math.abs(raw.data[i]!), 1e-6));
      gpu.openDecoded(raw.info, raw.data);
      gpu.openDecoded(half.info, half.data);
      const out: Record<string, { maxAbs: number; mean: number }> = {};
      for (const cut of ['scene', 'display'] as const) {
        for (const precision of ['preview', 'export'] as const) {
          const r: Float32Array[] = [];
          for (const src of [raw, half]) {
            const g = new Graph();
            g.registerSource(src.info);
            const c = compile(newDocument('digital-raw', { sha256: src.info.sha256, name: 'synthetic.dng', width: 403, height: 271 }), g);
            const n = cut === 'scene' ? c.cuts.scene! : c.display;
            gpu.adopt(g.closure(n.id));
            r.push((await (await gpu.evaluate(n, { scale: 'full', precision })).read()) as Float32Array);
          }
          let maxAbs = 0, sum = 0;
          for (let i = 0; i < r[0]!.length; i++) {
            const d = Math.abs(r[0]![i]! - r[1]![i]!);
            maxAbs = Math.max(maxAbs, d);
            sum += d;
          }
          out[`${cut}.${precision}`] = { maxAbs, mean: sum / r[0]!.length };
        }
      }
      return { sourceRelError: rel, ...out };
    } finally {
      gpu.dispose();
    }
  },

  async 'residency:proxy'() {
    const rt = await runtime();
    const proxy = await GpuEngine.create({ runtime: rt, opfs: false, prewarm: false });
    const full = await GpuEngine.create({ runtime: rt, opfs: false, prewarm: false, proxies: false });
    try {
      // a camera file at an odd size (sampling ratios that are not powers of two), the film grain on (the default)
      const raw = syntheticRaw(403, 271);
      proxy.openDecoded(raw.info, raw.data);
      full.openDecoded(raw.info, raw.data);
      const gc = new Graph();
      gc.registerSource(raw.info);
      const cam = compile(newDocument('digital-raw', { sha256: raw.info.sha256, name: 'synthetic.dng', width: 403, height: 271 }), gc).display;
      const camera = await compareScales(proxy, full, gc, cam, { x: 37, y: 21, w: 251, h: 173 });
      // a negative scan (16-bit TIFF, rgba16uint upload) through the darkroom print: a burn, a dodge, a density mask
      const { tiff } = syntheticScan(gold().solve, 517, 347);
      const info = await proxy.open({ kind: 'file', sha256: '', bytes: tiff });
      await full.open({ kind: 'file', sha256: '', bytes: tiff });
      const gn = new Graph();
      gn.registerSource(info);
      const neg = gn.get(compile(benchDoc(info.sha256, 517, 347, 'darkroom', 0.02), gn).display.inputs[0]!)!;
      const negative = await compareScales(proxy, full, gn, neg, { x: 64, y: 40, w: 300, h: 200 });
      // what each keeps: proxies on their grids; the full-size texture only without them
      const kept = { proxy: proxy.memory().resident, full: full.memory().resident };
      return { camera, negative, kept };
    } finally {
      proxy.dispose();
      full.dispose();
    }
  },

  async 'residency:recover'() {
    const rt = await runtime();
    const gpu = await GpuEngine.create({ runtime: rt, opfs: false, prewarm: false });
    const plain = await GpuEngine.create({ runtime: rt, opfs: false, prewarm: false });
    try {
      const raw = syntheticRaw(301, 203);
      gpu.openDecoded(raw.info, raw.data);
      plain.openDecoded(raw.info, raw.data);
      const g = new Graph();
      g.registerSource(raw.info);
      const n = compile(newDocument('digital-raw', { sha256: raw.info.sha256, name: 'synthetic.dng', width: 301, height: 203 }), g).display;
      gpu.adopt(g.closure(n.id));
      plain.adopt(g.closure(n.id));
      await (await gpu.evaluate(n, { scale: 0.25, precision: 'preview' })).read();
      const residentBefore = gpu.memory().resident.bytes;
      // one injected failure: the engine lets go of what it keeps and tries again — the same pixels as without one
      rt.budget.inject(1);
      const got = await (await gpu.evaluate(n, { scale: 0.5, precision: 'preview' })).read();
      const want = await (await plain.evaluate(n, { scale: 0.5, precision: 'preview' })).read();
      const recovered = { residentBefore, same: bits(got, want) };
      // failures beyond the retry: E_GPU_OOM that says what was tried
      rt.budget.inject(1000);
      let failed: { code: string | undefined; message: string; hint: string | undefined } | null = null;
      try {
        await gpu.evaluate(n, { scale: 0.375, precision: 'preview' });
      } catch (e) {
        const d = (e as { diag?: { code?: string; message: string; hint?: string } }).diag;
        failed = { code: d?.code, message: d?.message ?? String(e), hint: d?.hint };
      }
      rt.budget.inject(0);
      // and the engine works again afterwards
      const after = await (await gpu.evaluate(n, { scale: 0.375, precision: 'preview' })).read();
      return { recovered, failed, afterLength: after.length };
    } finally {
      gpu.dispose();
      plain.dispose();
    }
  },
};
