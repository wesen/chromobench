// CHB-037 P3: GPU time of a representative print through GpuEngine at the GPU engine's working size (4000 × 2674, a
// synthetic Gold 200 scan), as a slider drag sees it: every round changes the printer lights a little, so each
// evaluation is a new graph (no cached result). Two prints: `plain` (the main exposure and the printer lights) and
// `darkroom` (plus a burn under a feathered gradient, a dodge under an ellipse and a contrast mask, σ = 50 px), each
// as a preview at scale 0.4 (1600 × 1070, f32 readback) and as an export of the whole frame (16-bit codes, tile by tile).
// The same prints in contract 0.4's graph form were timed on the pre-contract-1.0 tree (diary 07, Step 4).
import { compile, Graph, layerEntry, newDocument, type Document, type Entry, type Mask, type MaskComponent, type Node, type ScanMedium } from '@chromobench/contract';
import { GpuEngine } from '../engine-gpu.ts';
import { gold, runtime } from './page-shared.ts';
import { REBATE_W, syntheticScan } from './synthetic.ts';

type Id = string;
const coll = <V>(entries: readonly (readonly [Id, V])[]) => ({ order: entries.map(([id]) => id), items: Object.fromEntries(entries) as Record<Id, V> });
const C = (kind: MaskComponent['kind'], params: Record<string, unknown>): MaskComponent => ({ kind, params: params as MaskComponent['params'], combine: 'add', amount: 1, enabled: true });

function doc(sha: string, w: number, h: number, kind: 'plain' | 'darkroom', lights: number): Document {
  const S = gold();
  const d = newDocument('negative-scan', { sha256: sha, width: w, height: h }, { umPerPx: 6 });
  const items: Record<Id, Entry> = { ...d.stages.darkroom!.stack.items, lights: layerEntry('filter', { logH: [lights, 0, -lights / 2] }) };
  const order = [...d.stages.darkroom!.stack.order];
  const masks: [Id, Mask][] = [];
  if (kind === 'darkroom') {
    items['sky'] = layerEntry('burn', { time_s: 6, filtration: { c: 0, m: 0, y: 15 } }, { mask: 'skyM' });
    items['face'] = layerEntry('dodge', { time_s: 3 }, { mask: 'faceM' });
    items['dm'] = layerEntry('densityMask', { gamma: 0.4, radius_um: 300, polarity: 'positive' });
    order.push('sky', 'face', 'dm');
    masks.push(['skyM', { name: 'sky', components: coll([['c', C('linear', { from: { x: 0, y: 0 }, to: { x: 0, y: h * 0.6 } })]]) as Mask['components'], feather_mm: 2, invert: false, reads: 'stage-input' }]);
    masks.push(['faceM', { name: 'face', components: coll([['c', C('ellipse', { box: { x: w * 0.3, y: h * 0.3, w: w * 0.3, h: h * 0.3 }, angle_deg: 20 })]]) as Mask['components'], feather_mm: 0, invert: false, reads: 'stage-input' }]);
  }
  const st = { ...d.stages };
  st.scan = { ...st.scan!, medium: { ...(st.scan!.medium as ScanMedium), scanner: S.scanner, stock: S.film, rebate: { x: 0, y: 0, w: REBATE_W, h } } };
  st.darkroom = { ...st.darkroom!, stack: { order, items } as typeof st.darkroom.stack };
  return { ...d, stages: st, masks: coll(masks) as Document['masks'] };
}

let frameP: Promise<{ gpu: GpuEngine; sha: string; info: import('@chromobench/contract').SourceInfo }> | null = null;

export const BENCH_TESTS: Record<string, (o: Record<string, unknown>) => Promise<unknown>> = {
  async 'bench:print'(o) {
    const w = (o['w'] as number | undefined) ?? 4000, h = (o['h'] as number | undefined) ?? 2674;
    const rounds = (o['rounds'] as number | undefined) ?? 8, warmup = (o['warmup'] as number | undefined) ?? 2;
    const rt = await runtime();
    frameP ??= (async () => {
      const gpu = await GpuEngine.create({ runtime: rt, opfs: false, cacheLimit: 4 });
      const { tiff } = syntheticScan(gold().solve, w, h);
      const info = await gpu.open({ kind: 'file', sha256: '', bytes: tiff });
      return { gpu, sha: info.sha256, info };
    })();
    const f = await frameP;
    const g = new Graph();
    g.registerSource(f.info);
    const out: Record<string, unknown> = { w, h, rounds, adapter: rt.caps.adapter };
    for (const kind of ['plain', 'darkroom'] as const) {
      const ms = { preview: [] as number[], export: [] as number[] };
      let plan = { tile: 0, halo: 0, tiles: 0 };
      for (let i = 0; i < warmup + rounds; i++) {
        const disp: Node = g.get(compile(doc(f.sha, w, h, kind, 0.01 + i * 1e-3), g).display.inputs[0]!)!; // output.display
        f.gpu.adopt(g.closure(disp.id));
        let t0 = performance.now();
        await (await f.gpu.evaluate(disp, { scale: 0.4, precision: 'preview' })).read();
        const tp = performance.now() - t0;
        t0 = performance.now();
        // the export as the export runner does it: the engine's tile plan, 16-bit codes per tile
        const p = f.gpu.planFor(disp.info as import('@chromobench/contract').ImageInfo, disp.id);
        plan = { tile: p.tile, halo: p.halo, tiles: p.tiles.length };
        for (const tile of p.tiles) await f.gpu.evaluateU16(disp, { scale: 'full', region: tile.core });
        const te = performance.now() - t0;
        if (i >= warmup) { ms.preview.push(tp); ms.export.push(te); }
      }
      const med = (a: number[]) => Number([...a].sort((x, y) => x - y)[a.length >> 1]!.toFixed(1));
      out[kind] = { previewMs: med(ms.preview), exportMs: med(ms.export), plan };
    }
    return out;
  },
};
