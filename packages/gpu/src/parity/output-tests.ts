// CHB-011 parity: output.display on the GPU (kernels/pointwise.wgsl op 8: the space's matrix, the
// OkLCh knee by f32 bisection, the TRC) against core's f64 displaySetup/displayLinear on the same XYZ,
// for the five output spaces and both renderings. Inputs: a deterministic cloud of print XYZ from deep
// shadows to super-whites and well outside sRGB, plus the paper white and black.
import { adaptBradford, D65, displayLinear, displayPixel, displaySetup, outputSpace, paperWhiteXYZ, whiteXYZ, type KneeName, type OutputSpaceId, type Vec3 } from '@chromobench/core';
import { Graph, type Node } from '@chromobench/contract';
import { ChainRunner } from '../chain/run.ts';
import { GpuEngine } from '../engine-gpu.ts';
import { REBATE_W, syntheticScan } from './synthetic.ts';
import { lowerDisplay, type Segment } from '../chain/program.ts';
import { TableManager } from '../tables/manager.ts';
import { gold, runtime } from './page-shared.ts';

const SPACES: OutputSpaceId[] = ['srgb', 'display-p3', 'rec2020', 'adobe-rgb', 'prophoto'];

let chP: { rt: unknown; ch: ChainRunner } | null = null;
async function runner(): Promise<ChainRunner> {
  const rt = await runtime();
  if (!chP || chP.rt !== rt) chP = { rt, ch: new ChainRunner(rt, new TableManager(rt, {})) };
  return chP.ch;
}

/** The paper white of the Gold 200 set-up's paper under D50, adapted to D65 (what view.adapt gives). */
function paperWhiteD65(): Vec3 {
  const S = gold();
  const v = S.physics.env.viewing(S.paper, 'D50');
  return adaptBradford(paperWhiteXYZ(v), whiteXYZ(v), D65);
}

function cloud(n: number, pw: Vec3): Float32Array {
  let s = 12345;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const X = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    // chromaticities spread over (and beyond) the spectral locus' bounding box, luminance 0.002…1.15
    const x = 0.05 + 0.65 * rnd();
    const y = 0.03 + 0.8 * rnd();
    const Y = 0.002 + 1.15 * rnd() ** 2;
    X.set([(x / y) * Y, Y, ((1 - x - y) / y) * Y], 3 * i);
  }
  X.set(pw, 0); // paper white
  X.set([pw[0] * 0.0042, pw[1] * 0.0042, pw[2] * 0.0042], 3); // paper black
  X.set([0.95047, 1, 1.08883], 6); // perfect white
  return X;
}

/** The synthetic Gold 200 scan through the whole chain to output.display, in GpuEngine. */
async function scanToDisplay(space: OutputSpaceId, w: number, h: number): Promise<{ gpu: GpuEngine; display: Node; T: Float32Array }> {
  const rt = await runtime();
  const S = gold();
  const { T, tiff } = syntheticScan(S.solve, w, h);
  const gpu = await GpuEngine.create({ runtime: rt, opfs: false, prewarm: false });
  const g = new Graph();
  const info = await gpu.open({ kind: 'file', sha256: '', bytes: tiff });
  g.registerSource(info);
  const I = (op: string, inputs: string[], args: Record<string, unknown> = {}): Node => g.intern(op, inputs, args).node;
  const src = I('source.open', [], { source: info.sha256, encoding: 'linear' });
  const dyes = I('invert.dyes', [I('scan.density', [src.id], { rebate: { x: 0, y: 0, w: REBATE_W, h } }).id], { stock: S.film, scanner: S.scanner });
  const xyz = I('view.reflect', [I('print.develop', [I('print.lights', [I('print.expose', [dyes.id], { paper: S.paper }).id], { logH: [0, 0, 0] }).id], { paper: S.paper, grade: 2 }).id], { illuminant: 'D50' });
  const display = I('output.display', [I('view.adapt', [I('view.flare', [xyz.id], { flare: 0 }).id], { to: 'D65' }).id], { rendering: 'scan-of-print', knee: 'oklch', space });
  gpu.adopt(g.closure(display.id));
  return { gpu, display, T };
}

export const OUTPUT_TESTS: Record<string, (opts: Record<string, unknown>) => Promise<unknown>> = {
  /**
   * The 16-bit export precision path (CHB-005 6bzj → CHB-011): evaluateU16 (rgba16uint source tiles,
   * pack2x16unorm) equals round(65535·f32 evaluate) exactly; 2 × 2 tiles equal one pass bit for bit;
   * a quarter-size export of the smooth frame has > 256 distinct values that are not all multiples of
   * 257 (the Studio's "screen size" 16-bit export, 05-inline.js 4484, had only multiples of 257).
   */
  async 'output:u16'() {
    const w = 192;
    const h = 128;
    const { gpu, display } = await scanToDisplay('prophoto', w, h);
    const f = await gpu.evaluate(display, { scale: 'full', precision: 'export' });
    const f32 = await f.read();
    const u = await gpu.evaluateU16(display, { scale: 'full' });
    // pack2x16unorm is floor(0.5 + 65535·e) with the product in f32: values within an f32 ulp of a
    // half code may round the other way than JS's f64 product (count them, bound them to one code)
    let packDiff = 0;
    let packOff = 0;
    for (let i = 0; i < w * h * 3; i++) {
      const d = Math.abs(u.data[i]! - Math.round(Math.min(1, Math.max(0, f32[i]!)) * 65535));
      packDiff = Math.max(packDiff, d);
      if (d) packOff++;
    }
    // tiles
    const tiled = new Uint16Array(w * h * 3);
    for (const [x, y, tw, th] of [[0, 0, 100, 60], [100, 0, 92, 60], [0, 60, 100, 68], [100, 60, 92, 68]] as const) {
      const t = await gpu.evaluateU16(display, { scale: 'full', region: { x, y, w: tw, h: th } });
      for (let r = 0; r < th; r++) tiled.set(t.data.subarray(r * tw * 3, (r + 1) * tw * 3), ((y + r) * w + x) * 3);
    }
    let tileDiff = 0;
    for (let i = 0; i < tiled.length; i++) tileDiff = Math.max(tileDiff, Math.abs(tiled[i]! - u.data[i]!));
    // screen size (quarter) export
    const q = await gpu.evaluateU16(display, { scale: 0.25 });
    const distinct = [0, 1, 2].map((k) => new Set(Array.from({ length: q.width * q.height }, (_, i) => q.data[3 * i + k])).size);
    const all257 = Array.from(q.data).every((v) => v % 257 === 0);
    const distinctFull = [0, 1, 2].map((k) => new Set(Array.from({ length: w * h }, (_, i) => u.data[3 * i + k])).size);
    gpu.dispose();
    return { packDiff, packOff, packValues: w * h * 3, tileDiff, quarter: { w: q.width, h: q.height, distinct, all257 }, distinctFull, warnings: u.warnings.map((x) => x.code) };
  },


  /** opts.knee ('oklch' | 'clip' | 'tanh-shoulder'); opts.swapRendering: broken variant. */
  async 'output:display'(o) {
    const ch = await runner();
    const rt = await runtime();
    const knee = (o['knee'] as KneeName | undefined) ?? 'oklch';
    const w = 64;
    const h = 32;
    const pw = paperWhiteD65();
    const X = cloud(w * h, pw);
    const src = ch.upload(X, w, h, 3, 'output.xyz');
    const results: Record<string, unknown>[] = [];
    let maxLin = 0;
    let maxCodes = 0;
    let outside = 0;
    let over2e6 = 0;
    let paperWhiteScan: number[] = [];
    for (const space of SPACES) {
      const S = outputSpace(space);
      for (const rendering of ['print-as-seen', 'scan-of-print'] as const) {
        const ds = displaySetup({ rendering, white: D65, paperWhite: pw, space, knee });
        const gpuSetup = o['swapRendering'] ? displaySetup({ rendering: rendering === 'scan-of-print' ? 'print-as-seen' : 'scan-of-print', white: D65, paperWhite: pw, space, knee }) : ds;
        const d = lowerDisplay(gpuSetup);
        const seg: Segment = { ops: [d.op], tables: {}, disp: d.disp, ok: d.ok };
        const out = await ch.run([seg], src, [0, 0], { outW: w, outH: h, frameW: w, frameH: h, region: { x: 0, y: 0, w, h }, precision: 'export' });
        const got = await ch.readTexture(out, w, h);
        rt.textures.release(out);
        let ml = 0;
        let mc = 0;
        let worst = -1;
        for (let i = 0; i < w * h; i++) {
          const xyz = [X[3 * i]!, X[3 * i + 1]!, X[3 * i + 2]!];
          const lin = displayLinear(xyz, ds);
          for (let k = 0; k < 3; k++) {
            const e = got[4 * i + k]!;
            if (!(e >= 0 && e <= 1)) outside++;
            const dl = Math.abs(S.decode(e) - lin[k]!);
            const dc = Math.abs(Math.round(e * 65535) - Math.round(S.encode(lin[k]!) * 65535));
            if (dl > 2e-6) over2e6++;
            if (dl > ml) { ml = dl; worst = i; }
            mc = Math.max(mc, dc);
          }
        }
        if (rendering === 'scan-of-print') paperWhiteScan = paperWhiteScan.concat([0, 1, 2].map((k) => Math.round(got[k]! * 65535)));
        maxLin = Math.max(maxLin, ml);
        maxCodes = Math.max(maxCodes, mc);
        results.push({ space, rendering, maxLin: ml, maxCodes16: mc, worstXYZ: worst >= 0 ? [X[3 * worst], X[3 * worst + 1], X[3 * worst + 2]] : null, worstRef: worst >= 0 ? displayPixel([X[3 * worst]!, X[3 * worst + 1]!, X[3 * worst + 2]!], ds) : null, worstGpu: worst >= 0 ? [got[4 * worst], got[4 * worst + 1], got[4 * worst + 2]] : null });
      }
    }
    rt.textures.release(src);
    return { knee, n: w * h, values: w * h * 3 * SPACES.length * 2, over2e6, maxLin, maxCodes16: maxCodes, outside, paperWhiteScan, results };
  },
};
