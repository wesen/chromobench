// CHB-022 parity: retouch.heal on the GPU (src/retouch.ts, kernels/retouch.wgsl) against core's f64
// retouch() — on a seeded print-xyz pattern (both engines, same graph), on the Gold 200 synthetic scan's
// print (core's retouch() applied to the GPU's own view.adapt, so only the kernel is compared), tiled against
// one pass, at half scale against the reference's nearest sampling, and a broken variant that must fail.
import { Graph, type Node, type RetouchSpot } from '@chromobench/contract';
import { parseSpots, RefEngine, retouch } from '@chromobench/core';
import { GpuEngine } from '../engine-gpu.ts';
import { gold, runtime } from './page-shared.ts';
import { defaultPhysicsData } from '../physics/data.ts';
import { REBATE_W, syntheticScan } from './synthetic.ts';

const W = 96, H = 64;
const SPOTS: Record<string, RetouchSpot> = {
  s1: { mode: 'heal', x: 30.3, y: 20.7, r: 6.5, src: { x: 60.2, y: 40.1 }, feather: 0.4, opacity: 1, enabled: true },
  s2: { mode: 'clone', x: 70, y: 15, r: 5, src: { x: 20, y: 50 }, feather: 0, opacity: 0.7, enabled: true },
  s3: { mode: 'heal', x: 3, y: 60, r: 7, src: { x: 40, y: 55 }, feather: 0.2, opacity: 1, enabled: true },
  s10: { mode: 'clone', x: 34, y: 22, r: 4, src: { x: 80, y: 40 }, feather: 0.5, opacity: 1, enabled: true },
};

function diff(a: ArrayLike<number>, b: ArrayLike<number>): { maxAbs: number; maxRel: number } {
  let maxAbs = 0, maxRel = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i]! - b[i]!);
    maxAbs = Math.max(maxAbs, d);
    maxRel = Math.max(maxRel, d / Math.max(Math.abs(b[i]!), 1e-3));
  }
  return { maxAbs, maxRel };
}

async function read(e: GpuEngine | RefEngine, n: Node, scale: number | 'full' = 'full', region?: { x: number; y: number; w: number; h: number }): Promise<ArrayLike<number>> {
  return (await e.evaluate(n, { scale, precision: 'export', ...(region ? { region } : {}) })).read();
}

export const RETOUCH_TESTS: Record<string, (opts: Record<string, unknown>) => Promise<unknown>> = {
  async 'retouch:parity'(o) {
    const rt = await runtime();
    const spots = (o['broken'] ? { ...SPOTS, s1: { ...SPOTS['s1']!, src: { x: 61.2, y: 40.1 } } } : SPOTS) as Record<string, RetouchSpot>;
    // 1. a seeded print-xyz pattern in both engines
    const gpu = await GpuEngine.create({ runtime: rt, opfs: false, prewarm: false });
    const ref = new RefEngine({ data: defaultPhysicsData() });
    const g = new Graph();
    const I = (op: string, inputs: string[], args: Record<string, unknown> = {}): Node => g.intern(op, inputs, args).node;
    const pat = I('source.pattern', [], { domain: 'print-xyz', width: W, height: H, seed: 5 });
    const heal = I('retouch.heal', [pat.id], { spots: JSON.stringify(SPOTS) });
    const healGpu = I('retouch.heal', [pat.id], { spots: JSON.stringify(spots) });
    for (const e of [gpu, ref]) e.adopt(g.closure(heal.id));
    gpu.adopt(g.closure(healGpu.id));
    const [rp, gp, base] = [await read(ref, heal), await read(gpu, healGpu), await read(ref, pat)];
    let changed = 0;
    for (let i = 0; i < rp.length; i++) if (Math.abs(rp[i]! - base[i]!) > 1e-9) changed++;
    const pattern = diff(gp, rp);
    // 2. tiles (2 × 2, uneven) against one pass, on the GPU
    const tiles = [{ x: 0, y: 0, w: 41, h: 29 }, { x: 41, y: 0, w: 55, h: 29 }, { x: 0, y: 29, w: 41, h: 35 }, { x: 41, y: 29, w: 55, h: 35 }];
    let tileDiff = 0;
    for (const t of tiles) {
      const part = await read(gpu, healGpu, 'full', t);
      for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) for (let k = 0; k < 3; k++) tileDiff = Math.max(tileDiff, Math.abs(part[(y * t.w + x) * 3 + k]! - gp[((t.y + y) * W + t.x + x) * 3 + k]!));
    }
    // 3. half scale: the GPU's grid pixels against the reference's nearest samples of its full result
    const half = diff(await read(gpu, healGpu, 0.5), await read(ref, heal, 0.5));
    // 4. a real print: core's retouch() on the GPU's own view.adapt result
    const S = gold();
    const { tiff } = syntheticScan(S.solve, W, H);
    const info = await gpu.open({ kind: 'file', sha256: '', bytes: tiff });
    g.registerSource(info);
    const src = I('source.open', [], { source: info.sha256, encoding: 'linear' });
    const dyes = I('invert.dyes', [I('scan.density', [src.id], { rebate: { x: 0, y: 0, w: REBATE_W, h: H } }).id], { stock: S.film, scanner: S.scanner });
    const xyz = I('view.reflect', [I('print.develop', [I('print.lights', [I('print.expose', [dyes.id], { paper: S.paper }).id], { logH: [0, 0, 0] }).id], { paper: S.paper, grade: 2 }).id], { illuminant: 'D50' });
    const adapt = I('view.adapt', [I('view.flare', [xyz.id], { flare: 0 }).id], { to: 'D65' });
    const printHeal = I('retouch.heal', [adapt.id], { spots: JSON.stringify(spots) });
    gpu.adopt(g.closure(printHeal.id));
    const ga = Float64Array.from(await read(gpu, adapt));
    const want = retouch(ga, W, H, 3, parseSpots(JSON.stringify(SPOTS)));
    const print = diff(await read(gpu, printHeal), want);
    gpu.dispose();
    ref.dispose();
    return { changed, pattern, tileDiff, half, print };
  },
};
