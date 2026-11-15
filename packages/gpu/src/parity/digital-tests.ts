// Contract 1.1 parity (CHB-037 P8a): the digital layers of the composite stages on the GPU against core's reference
// engine: every op and encoding on seeded print and scene images (RefEngine exact on the same graph), every blend mode
// fused into the pointwise kernel and as a masked combine pass, the planner's fusion, and whole documents with print
// stacks at the display cut. Plus `bench:composite`: a stack of six composite layers at 4000 px, preview and export.
import {
  compile, Graph, groupEntry, layerEntry, newDocument, BLEND_MODES,
  type Document, type Entry, type EntryBase, type ImageInfo, type Mask, type MaskComponent, type Node, type Params, type ScanMedium,
} from '@chromobench/contract';
import { RefEngine } from '@chromobench/core';
import { OP } from '../chain/program.ts';
import { GpuEngine } from '../engine-gpu.ts';
import { fusedMixTop, isBarrier } from '../engine/dag.ts';
import { defaultPhysicsData } from '../physics/data.ts';
import { gold, runtime } from './page-shared.ts';
import { EngineReference } from './reference.ts';
import { REBATE_W, syntheticScan } from './synthetic.ts';

type T = (o: Record<string, unknown>) => Promise<unknown>;
type Id = string;
const W = 96, H = 64;

const coll = <V>(entries: readonly (readonly [Id, V])[]) => ({ order: entries.map(([id]) => id), items: Object.fromEntries(entries) as Record<Id, V> });
const L = (op: string, params: Params = {}, over: Partial<EntryBase> = {}): Entry => layerEntry(op, params, over);
const C = (kind: MaskComponent['kind'], params: Params, combine: MaskComponent['combine'] = 'add'): MaskComponent => ({ kind, params, combine, amount: 1, enabled: true });
const M = (components: [Id, MaskComponent][], over: Partial<Mask> = {}): Mask => ({ name: 'm', components: coll(components) as Mask['components'], feather_mm: 0, invert: false, reads: 'stage-input', ...over });
const P = (k: string, pts: [number, number][]): Params[string] => coll(pts.map(([x, y], i) => [`${k}${i}`, { x, y }] as const)) as unknown as Params[string];

interface Frame { gpu: GpuEngine; ref: RefEngine; sha: string; info: import('@chromobench/contract').SourceInfo }
let frameP: Promise<Frame> | null = null;
async function frame(): Promise<Frame> {
  frameP ??= (async () => {
    const rt = await runtime();
    const { tiff } = syntheticScan(gold().solve, W, H);
    const gpu = await GpuEngine.create({ runtime: rt, workers: 4, opfs: false });
    const ref = new RefEngine({ data: defaultPhysicsData() });
    let info = await gpu.open({ kind: 'file', sha256: '', bytes: tiff });
    info = await ref.open({ kind: 'file', sha256: '', bytes: tiff });
    return { gpu, ref, sha: info.sha256, info };
  })();
  return frameP;
}

async function setup(): Promise<{ f: Frame; g: Graph; ref: EngineReference }> {
  const f = await frame();
  const g = new Graph();
  g.registerSource(f.info);
  return { f, g, ref: new EngineReference(g, f.ref) };
}

async function gpuRead(f: Frame, g: Graph, n: Node, o: { scale?: number | 'full'; precision?: 'preview' | 'export' } = {}): Promise<{ data: Float32Array; c: number; w: number; h: number }> {
  f.gpu.adopt(g.closure(n.id));
  const r = await f.gpu.evaluate(n, { scale: o.scale ?? 'full', precision: o.precision ?? 'export' });
  return { data: (await r.read()) as Float32Array, c: r.info.channels, w: r.width, h: r.height };
}

/** Worst absolute difference over the first three channels, and where. */
function diff(a: { data: ArrayLike<number>; c: number }, b: { data: ArrayLike<number>; c: number }): { maxAbs: number; at: number } {
  let maxAbs = 0, at = -1;
  const n = a.data.length / a.c;
  for (let i = 0; i < n; i++) for (let k = 0; k < Math.min(3, a.c); k++) {
    const d = Math.abs(a.data[i * a.c + k]! - b.data[i * b.c + k]!);
    if (!(d <= maxAbs)) { maxAbs = Number.isNaN(d) ? Infinity : d; at = i; }
  }
  return { maxAbs, at };
}

function max8(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(Math.round(a[i]! * 255) - Math.round(b[i]! * 255)));
  return m;
}

/** A negative-scan document of the synthetic Gold 200 scan with a print stack and masks (export size w × h). */
function printDocument(sha: string, print: [Id, Entry][], masks: [Id, Mask][] = [], size: [number, number] = [W, H], umPerPx = 4): Document {
  const S = gold();
  const d = newDocument('negative-scan', { sha256: sha, width: size[0], height: size[1] }, { umPerPx });
  const st = { ...d.stages };
  st.scan = { ...st.scan!, medium: { ...(st.scan!.medium as ScanMedium), scanner: S.scanner, stock: S.film, rebate: { x: 0, y: 0, w: REBATE_W, h: size[1] } } };
  const dk = st.darkroom!.stack;
  st.darkroom = { ...st.darkroom!, stack: { order: dk.order, items: { ...dk.items, lights: L('filter', { logH: [0.02, 0, -0.01] }) } } as typeof dk };
  st.print = { ...st.print!, stack: coll(print) as typeof st.print.stack };
  return { ...d, stages: st, masks: coll(masks) as Document['masks'] };
}

/** Every digital op, its mask components and the six encodings, on pattern images (scene and print). */
const OPS: [name: string, domain: 'rgb' | 'oklab' | 'xyz', op: string, args: Record<string, unknown>][] = [
  ['exposure', 'rgb', 'exposure', { stops: 0.7, offset: -0.01 }],
  ['mixer', 'rgb', 'mixer', { red: [0.9, 0.2, -0.1], green: [0.05, 0.85, 0.1], blue: [0, 0.3, 0.7] }],
  ['mixer mono', 'rgb', 'mixer', { monochrome: true, grey: [0.4, 0.5, 0.1] }],
  ['vignette', 'rgb', 'vignette', { stops: -1.2, size: 0.3, feather: 0.6 }],
  ['vignette hard', 'rgb', 'vignette', { stops: 1, size: 0.5, feather: 0 }],
  ['curve R', 'rgb', 'curve', { channel: 'R', points: [{ x: 0, y: 0.05 }, { x: 0.4, y: 0.5 }, { x: 1, y: 0.95 }] }],
  ['levels G', 'rgb', 'levels', { channel: 'G', black: 0.1, white: 0.9, gamma: 1.6, outBlack: 0.02, outWhite: 0.97 }],
  ['curve L', 'oklab', 'curve', { points: [{ x: 0, y: 0 }, { x: 0.2, y: 0.15 }, { x: 0.5, y: 0.55 }, { x: 0.8, y: 0.86 }, { x: 1, y: 1 }] }],
  ['levels L', 'oklab', 'levels', { black: 0.05, white: 0.95, gamma: 0.8 }],
  ['hsl', 'oklab', 'hsl', { bands: [{ centre_deg: 25, width_deg: 60, hue_deg: 25, saturation: 0.4, lightness: 0.3 }, { centre_deg: 260, width_deg: 45, hue_deg: -40, saturation: -0.5, lightness: -0.2 }, { centre_deg: 145, width_deg: 90, hue_deg: 60, saturation: 0.2, lightness: 0 }] }],
  ['vibrance', 'oklab', 'vibrance', { vibrance: 0.8, saturation: -0.2 }],
  ['grade', 'oklab', 'grade', { shadowsHue_deg: 220, shadowsChroma: 0.06, shadowsLightness: 0.1, midtonesHue_deg: 30, midtonesChroma: 0.02, highlightsHue_deg: 70, highlightsChroma: 0.05, highlightsLightness: -0.1, balance: 0.4 }],
  ['mask.colour', 'oklab', 'mask.colour', { colour: [0.6, 0.05, 0.02], tolerance: 0.1, softness: 0.15 }],
  ['mask.radial', 'xyz', 'mask.radial', { box: { x: 12, y: 8, w: 60, h: 40 }, angle_deg: 25, feather: 0.6 }],
];

export const DIGITAL_TESTS: Record<string, T> = {
  /** Every digital op and encoding against RefEngine on the same graph (pattern images, scene and print, D50 and D65). */
  async 'law:digital'() {
    const { f, g, ref } = await setup();
    const I = (op: string, inputs: string[], args: Record<string, unknown> = {}): Node => g.intern(op, inputs, args).node;
    const out: Record<string, { maxAbs: number; at: number }> = {};
    for (const [stage, white] of [['print', 'D50'], ['print', 'D65'], ['scene', 'D65']] as const) {
      const xyz = I('source.pattern', [], { domain: `${stage}-xyz`, width: W, height: H, seed: 11 });
      const enc = { xyz, rgb: I('composite.encode', [xyz.id], { to: `${stage}-rgb`, white }), oklab: I('composite.encode', [xyz.id], { to: `${stage}-oklab`, white }) };
      // the encodings themselves, and a conversion's round trip
      for (const [k, n] of Object.entries(enc)) if (k !== 'xyz') out[`${stage} ${white} encode ${k}`] = diff(await gpuRead(f, g, n), await ref.image(n.id));
      const back = I('composite.encode', [I('composite.encode', [enc.oklab.id], { to: `${stage}-rgb`, white }).id], { to: `${stage}-xyz`, white });
      out[`${stage} ${white} round trip`] = diff(await gpuRead(f, g, back), await gpuRead(f, g, xyz));
      if (white === 'D50') continue;
      for (const [name, dom, op, args] of OPS) {
        const n = I(op, [enc[dom].id], args);
        out[`${stage} ${name}`] = diff(await gpuRead(f, g, n), await ref.image(n.id));
      }
    }
    return out;
  },

  /** Every blend mode, fused (no mask) and as a masked combine pass, in linear RGB and in OkLab, against core. */
  async 'law:blend'() {
    const { f, g, ref } = await setup();
    const I = (op: string, inputs: string[], args: Record<string, unknown> = {}): Node => g.intern(op, inputs, args).node;
    // print colours (non-negative working RGB): a random XYZ is mostly imaginary colours, whose negative LMS the cube
    // root and the cube amplify in f32 through the two conversions around a separable blend in OkLab
    const rgb = I('source.pattern', [], { domain: 'print-rgb', width: W, height: H, seed: 5 });
    const xyz = I('composite.encode', [rgb.id], { to: 'print-xyz' });
    const ok = I('composite.encode', [rgb.id], { to: 'print-oklab' });
    const tops = {
      rgb: I('mixer', [rgb.id], { red: [0.3, 0.6, 0.2], green: [0.7, 0.1, 0.3], blue: [0.1, 0.4, 0.6] }),
      oklab: I('curve', [I('hsl', [ok.id], { bands: [{ centre_deg: 200, width_deg: 120, hue_deg: 50, saturation: 0.6, lightness: 0.1 }] }).id], { points: [{ x: 0, y: 0.1 }, { x: 0.5, y: 0.35 }, { x: 1, y: 0.9 }] }),
    };
    const backs = { rgb, oklab: ok };
    const radial = I('mask.radial', [xyz.id], { box: { x: 8, y: 4, w: 80, h: 56 }, feather: 0.8 });
    const out: Record<string, unknown> = {};
    let fusedCount = 0;
    for (const enc of ['rgb', 'oklab'] as const) {
      for (const blend of BLEND_MODES) {
        const fused = I('composite.mix', [backs[enc].id], { top: tops[enc].id, amount: 0.7, blend });
        const masked = I('composite.mix', [backs[enc].id], { top: tops[enc].id, amount: 0.7, blend, mask: radial.id });
        if (!isBarrier(fused, g)) fusedCount++;
        const gf = await gpuRead(f, g, fused), gm = await gpuRead(f, g, masked);
        out[`${enc} ${blend}`] = { fused: diff(gf, await ref.image(fused.id)).maxAbs, masked: diff(gm, await ref.image(masked.id)).maxAbs };
      }
    }
    // the lowered program of a fused mix: SAVE, the top's ops, MIX in one segment
    const one = I('composite.mix', [ok.id], { top: tops.oklab.id, amount: 0.5, blend: 'luminosity' });
    f.gpu.adopt(g.closure(one.id));
    const segs = f.gpu.lowerNode(one);
    const last = segs[segs.length - 1]!.ops.map((o) => o.code);
    return { modes: out, fusedCount, total: 2 * BLEND_MODES.length, program: last, saveMix: last.includes(OP.SAVE) && last.includes(OP.MIX), top: fusedMixTop(g, one)?.map((n) => n.op) };
  },

  /** Whole documents with print stacks (every op, masks, blends, groups) at the display cut, against RefEngine exact. */
  async 'law:digital-doc'() {
    const { f, g } = await setup();
    const masks: [Id, Mask][] = [
      ['spot', M([['r', C('radial', { box: { x: 18, y: 8, w: 56, h: 46 }, angle_deg: 15, feather: 0.7 })]])],
      ['warm', M([['c', C('colour', { colour: [0.6, 0.03, 0.05], tolerance: 0.08, softness: 0.12 })], ['l', C('linear', { from: { x: 0, y: 10 }, to: { x: 0, y: 50 } }, 'intersect')]])],
    ];
    const docs: Record<string, Document> = {
      tone: printDocument(f.sha, [
        ['x', L('exposure', { stops: 0.3, offset: -0.004 })], ['lb', L('levels', { channel: 'B', black: 0.04, white: 0.97, gamma: 0.92 })],
        ['s', L('curve', { points: P('s', [[0, 0.02], [0.25, 0.2], [0.6, 0.66], [1, 0.98]]) })], ['v', L('vibrance', { vibrance: 0.35 })],
      ]),
      colour: printDocument(f.sha, [
        ['h', L('hsl', { bands: coll([['hb', { centre_deg: 260, width_deg: 50, hue_deg: -12, saturation: 0.4, lightness: -0.2 }], ['ho', { centre_deg: 55, hue_deg: 6, saturation: -0.15, lightness: 0.25 }]]) as unknown as Params[string] })],
        ['g', L('grade', { shadowsHue_deg: 200, shadowsChroma: 0.04, highlightsHue_deg: 70, highlightsChroma: 0.03, balance: 0.2 })],
        ['m', L('mixer', { red: [0.92, 0.1, -0.02], green: [0.04, 0.9, 0.06], blue: [0, 0.12, 0.88] }, { amount: 0.7 })],
      ]),
      masked: printDocument(f.sha, [
        ['c', L('curve', { points: P('c', [[0, 0], [0.3, 0.36], [0.7, 0.76], [1, 1]]) }, { mask: 'spot', amount: 0.8 })],
        ['x', L('exposure', { stops: -0.6 }, { mask: 'warm' })], ['n', L('vignette', { stops: -0.8, size: 0.35, feather: 0.8 })],
        ['sh', L('sharpen', { strength: 0.7, radius_mm: 0.05 })],
      ], masks),
      blends: printDocument(f.sha, [
        ['mu', L('curve', { points: P('mu', [[0, 0], [0.5, 0.42], [1, 1]]) }, { blend: 'multiply', amount: 0.5 })],
        ['sc', L('exposure', { stops: -1 }, { blend: 'screen', amount: 0.6 })],
        ['lu', L('curve', { points: P('lu', [[0, 0], [0.4, 0.3], [1, 1]]) }, { blend: 'luminosity' })],
        ['co', L('vibrance', { vibrance: 0.6, saturation: 0.2 }, { blend: 'colour', amount: 0.8 })],
        ['iso', groupEntry('tone', coll([['i1', L('exposure', { stops: 0.4 })], ['i2', L('vibrance', { vibrance: 1 })]]) as never, { blend: 'luminosity', mask: 'spot', amount: 0.9 })],
        ['pg', groupEntry('look', coll([['p1', L('grade', { shadowsHue_deg: 250, shadowsChroma: 0.05 })], ['p2', L('levels', { gamma: 1.2 })]]) as never, { amount: 0.6 })],
      ], masks),
    };
    const out: Record<string, unknown> = {};
    for (const [name, d] of Object.entries(docs)) {
      const c = compile(d, g);
      const disp = g.get(c.display.inputs[0]!)!; // output.display (output.frame is the identity here)
      f.ref.adopt(g.closure(disp.id));
      const want = await (await f.ref.evaluate(disp, { scale: 'full', precision: 'export' })).read();
      const got = await gpuRead(f, g, disp);
      const fin = c.cuts.finished!;
      f.ref.adopt(g.closure(fin.id));
      const wantF = { data: await (await f.ref.evaluate(fin, { scale: 'full', precision: 'export' })).read(), c: 3 };
      // how the print stage ran: fused mixes and barriers in the planned graph
      const mixes = g.closure(fin.id).map((x) => x).filter((x) => x.op === 'composite.mix');
      const ids = [...new Set(c.entries ? Object.values(c.entries).flat() : [])];
      const fusedMixes = ids.map((id) => g.get(id)!).filter((n) => n.op === 'composite.mix' && !isBarrier(n, g)).length;
      out[name] = { display: { ...diff(got, { data: want, c: 3 }), max8bit: max8(got.data, want) }, finished: diff(await gpuRead(f, g, fin), wantF), mixes: mixes.length, fusedMixes };
    }
    return out;
  },

  /**
   * GPU time of a stack of six composite layers on the print at 4000 × 2674 (a synthetic Gold 200 scan), as a slider drag
   * sees it (each round a new graph): exposure, an S-curve, HSL, vibrance, colour grading (one fused OkLab run) and a
   * vignette at 0.8 (a fused mix), plus a curve under a radial mask (a combine pass) in `masked`. Preview at scale 0.4
   * (f32 read back) and an export of the whole frame (16-bit codes, tile by tile); `plain` is the print without layers.
   */
  async 'bench:composite'(o) {
    const w = (o['w'] as number | undefined) ?? 4000, h = (o['h'] as number | undefined) ?? 2674;
    const rounds = (o['rounds'] as number | undefined) ?? 8, warmup = (o['warmup'] as number | undefined) ?? 2;
    const rt = await runtime();
    const gpu = await GpuEngine.create({ runtime: rt, opfs: false, cacheLimit: 4 });
    const { tiff } = syntheticScan(gold().solve, w, h);
    const info = await gpu.open({ kind: 'file', sha256: '', bytes: tiff });
    const g = new Graph();
    g.registerSource(info);
    const stack = (i: number, masked: boolean): [Id, Entry][] => [
      ['x', L('exposure', { stops: 0.2 + i * 1e-3 })],
      ['s', L('curve', { points: P('s', [[0, 0.02], [0.25, 0.2], [0.6, 0.66], [1, 0.98]]) })],
      ['h', L('hsl', { bands: coll([['hb', { centre_deg: 260, hue_deg: -10, saturation: 0.3 }], ['ho', { centre_deg: 55, lightness: 0.2 }]]) as unknown as Params[string] })],
      ['v', L('vibrance', { vibrance: 0.3 })],
      ['g', L('grade', { shadowsHue_deg: 220, shadowsChroma: 0.03, highlightsHue_deg: 60, highlightsChroma: 0.02 })],
      ['n', L('vignette', { stops: -0.6 }, { amount: 0.8 })],
      ...(masked ? [['c', L('curve', { points: P('c', [[0, 0], [0.4, 0.5], [1, 1]]) }, { mask: 'spot', amount: 0.7 })]] as [Id, Entry][] : []),
    ];
    const spot: [Id, Mask][] = [['spot', M([['r', C('radial', { box: { x: w * 0.2, y: h * 0.2, w: w * 0.6, h: h * 0.6 }, feather: 0.6 })]])]];
    const out: Record<string, unknown> = { w, h, rounds, adapter: rt.caps.adapter };
    for (const kind of ['plain', 'six', 'masked'] as const) {
      const ms = { preview: [] as number[], export: [] as number[] };
      for (let i = 0; i < warmup + rounds; i++) {
        const d = printDocument(info.sha256, kind === 'plain' ? [['x', L('exposure', { stops: 0.2 + i * 1e-3 })]] : stack(i, kind === 'masked'), spot, [w, h], 6);
        const disp = g.get(compile(d, g).display.inputs[0]!)!;
        gpu.adopt(g.closure(disp.id));
        let t0 = performance.now();
        await (await gpu.evaluate(disp, { scale: 0.4, precision: 'preview' })).read();
        const tp = performance.now() - t0;
        t0 = performance.now();
        for (const tile of gpu.planFor(disp.info as ImageInfo, disp.id).tiles) await gpu.evaluateU16(disp, { scale: 'full', region: tile.core });
        const te = performance.now() - t0;
        if (i >= warmup) { ms.preview.push(tp); ms.export.push(te); }
      }
      const med = (a: number[]) => Number([...a].sort((x, y) => x - y)[a.length >> 1]!.toFixed(1));
      out[kind] = { previewMs: med(ms.preview), exportMs: med(ms.export) };
    }
    gpu.dispose();
    return out;
  },
};
