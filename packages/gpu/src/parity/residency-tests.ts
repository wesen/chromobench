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

export const RESIDENCY_TESTS: Record<string, T> = {
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
