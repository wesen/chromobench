// Contract 1.0 parity (CHB-037 P3): the GPU's light law, composite mix, mask algebra, heal / clone and clarity against
// core's reference engine on format-3 documents compiled by the contract's one compiler and on hand-built graphs:
// `core` is RefEngine exact end to end (the export's ground truth), `tab` RefEngine tabulated (the preview reads the
// same 33³ tables), `kernel` the law ops in f64 (reference.ts, core's functions) on the GPU's own export of every node
// before them, so only the law kernels differ. `law:core` compares whole documents at display.
import {
  compile, edit, Graph, layerEntry, groupEntry, newDocument,
  type Document, type Entry, type EntryBase, type ImageInfo, type Mask, type MaskComponent, type Node, type Params, type ScanMedium,
} from '@chromobench/contract';
import { frameImage, RefEngine, retouch } from '@chromobench/core';
import { OP } from '../chain/program.ts';
import { GpuEngine } from '../engine-gpu.ts';
import { isBarrier } from '../engine/dag.ts';
import { combineArgs } from '../engine/light.ts';
import { defaultPhysicsData } from '../physics/data.ts';
import { gold, runtime } from './page-shared.ts';
import { EngineReference, LawReference, type Img64 } from './reference.ts';
import { REBATE_W, syntheticScan } from './synthetic.ts';
import type { RepairSpot } from '../retouch.ts';

type T = (o: Record<string, unknown>) => Promise<unknown>;

const W = 96, H = 64;
/** Film µm per document pixel of the test scan (not the old default 6, so a missed pitch shows). */
const UM = 4;

// ---- documents ----------------------------------------------------------------------------------------------------

type Id = string;
const coll = <V>(entries: readonly (readonly [Id, V])[]) => ({ order: entries.map(([id]) => id), items: Object.fromEntries(entries) as Record<Id, V> });
const L = (op: string, params: Params = {}, over: Partial<EntryBase> = {}): Entry => layerEntry(op, params, over);
const C = (kind: MaskComponent['kind'], params: Params, combine: MaskComponent['combine'] = 'add', amount = 1): MaskComponent => ({ kind, params, combine, amount, enabled: true });
const M = (components: [Id, MaskComponent][], over: Partial<Mask> = {}): Mask => ({ name: 'm', components: coll(components) as Mask['components'], feather_mm: 0, invert: false, reads: 'stage-input', ...over });
const spotsColl = (s: readonly RepairSpot[]): Params[string] => coll(s.map((x, i) => [`s${i + 1}`, x] as const)) as unknown as Params[string];

/** The synthetic Gold 200 scan as a format-3 document with `stacks` appended to its stages and `masks` added. */
function scanDocument(sha: string, stacks: Partial<Record<'scan' | 'darkroom' | 'print', [Id, Entry][]>>, masks: [Id, Mask][] = [], size: [number, number] = [W, H]): Document {
  const S = gold();
  const d = newDocument('negative-scan', { sha256: sha, width: size[0], height: size[1] }, { umPerPx: UM });
  type StageRec = { medium: unknown; stack: { order: readonly Id[]; items: Readonly<Record<Id, Entry>> } };
  const st = { ...d.stages } as unknown as Record<'scan' | 'darkroom' | 'print', StageRec>;
  st.scan = { ...st.scan!, medium: { ...(st.scan!.medium as ScanMedium), scanner: S.scanner, stock: S.film, rebate: { x: 0, y: 0, w: REBATE_W, h: size[1] } } };
  for (const s of ['scan', 'darkroom', 'print'] as const) {
    const more = stacks[s];
    if (!more) continue;
    const cur = st[s]!.stack;
    const items = { ...cur.items } as Record<Id, Entry>;
    const order = [...cur.order];
    for (const [id, e] of more) {
      if (!(id in items)) order.push(id);
      items[id] = e;
    }
    st[s] = { ...st[s]!, stack: { order, items } };
  }
  return { ...d, stages: st as unknown as Document['stages'], masks: coll(masks) as Document['masks'] };
}

const STROKES = coll([
  ['k1', { points: [[10, 50, 0.5], [50, 58, 0.5], [90, 44, 0.5]], radius: 6, hardness: 0.4, mode: 'add' }],
  ['k2', { points: [[48, 40, 0.5], [48, 64, 0.5]], radius: 3, hardness: 1, mode: 'erase' }],
]) as unknown as Params[string];

/** Every darkroom kind, masked and not, with a group (design §22): the light law's whole surface. */
function richDarkroom(sha: string): Document {
  return scanDocument(sha, {
    darkroom: [
      ['main', L('expose', { time_s: 12, fstop: 8, filtration: { c: 0, m: 0, y: 0 } }, { amount: 0.95 })],
      ['lights', L('filter', { logH: [0.02, 0, -0.01] })],
      ['sky', L('burn', { time_s: 6, filtration: { c: 0, m: 0, y: 15 } }, { mask: 'skyM' })],
      ['face', L('dodge', { time_s: 3 }, { mask: 'faceM' })],
      ['strokes', L('burn', { stops: 0.5 }, { mask: 'paintM', amount: 0.8 })],
      ['fb', L('flash', { time_s: 1.5, through: 'base' }, { mask: 'skyM' })],
      ['fo', L('flash', { time_s: 0.4, through: 'open' })],
      ['dm', L('densityMask', { gamma: 0.4, radius_um: 12, polarity: 'positive' })],
      ['cc', L('filter', { logH: [0, 0.05, -0.03] }, { mask: 'faceInv' })],
      ['pf', L('preflash', { fraction: 0.01 }, { amount: 0.7 })],
      ['g', groupEntry('card', coll([['gb', L('burn', { time_s: 2 }, { mask: 'faceM' })]]) as never, { amount: 0.6, mask: 'skyM' })],
    ],
  }, [
    ['skyM', M([['c', C('linear', { from: { x: 0, y: 0 }, to: { x: 0, y: 40 } })]], { feather_mm: 0.25 })],
    ['faceM', M([['c', C('ellipse', { box: { x: 30, y: 20, w: 30, h: 20 }, angle_deg: 25 })]])],
    ['faceInv', M([['c', C('ellipse', { box: { x: 30, y: 20, w: 30, h: 20 }, angle_deg: 25 })]], { invert: true })],
    ['paintM', M([
      ['p', C('paint', { strokes: STROKES })],
      ['l', C('luminance', { above: 0.5, below: 0.65, softness: 0.1 }, 'subtract', 0.8)],
    ], { reads: 'darkroom.main' })],
  ]);
}

/** The printer lights, an unmasked open flash and a preflash: a print.combine that fuses (no texture terms). */
const fusedDarkroom = (sha: string, lightsOnly = false): Document => scanDocument(sha, {
  darkroom: [
    ['lights', L('filter', { logH: [0.03, -0.01, 0.02] })],
    ...(lightsOnly ? [] : [['fo', L('flash', { time_s: 0.5, through: 'open' })], ['pf', L('preflash', { fraction: 0.01 })]] as [Id, Entry][]),
  ],
});

// ---- the frame ----------------------------------------------------------------------------------------------------

interface Frame { gpu: GpuEngine; ref: RefEngine; tab: RefEngine; sha: string }
let frameP: Promise<Frame> | null = null;
async function frame(): Promise<Frame> {
  frameP ??= (async () => {
    const rt = await runtime();
    const { tiff } = syntheticScan(gold().solve, W, H);
    const gpu = await GpuEngine.create({ runtime: rt, workers: 4, opfs: false });
    const ref = new RefEngine({ data: defaultPhysicsData() });
    const tab = new RefEngine({ data: defaultPhysicsData(), mode: 'tabulated' });
    let sha = '';
    for (const e of [gpu, ref, tab]) sha = (await e.open({ kind: 'file', sha256: '', bytes: tiff })).sha256;
    return { gpu, ref, tab, sha };
  })();
  return frameP;
}

/** A graph for one test, the source registered, and the three references (see the header) bound to it. */
async function setup(): Promise<{ f: Frame; g: Graph; law: EngineReference; tab: EngineReference; kernel: LawReference }> {
  const f = await frame();
  const g = new Graph();
  g.registerSource(f.gpu.graph.source(f.sha)!);
  const data = defaultPhysicsData();
  return { f, g, law: new EngineReference(g, f.ref), tab: new EngineReference(g, f.tab), kernel: new LawReference(g, f.gpu, data) };
}

async function gpuRead(f: Frame, g: Graph, n: Node, o: { scale?: number | 'full'; precision?: 'preview' | 'export'; region?: { x: number; y: number; w: number; h: number } } = {}): Promise<{ data: Float32Array; w: number; h: number; c: number }> {
  f.gpu.adopt(g.closure(n.id));
  const r = await f.gpu.evaluate(n, { scale: o.scale ?? 'full', precision: o.precision ?? 'export', ...(o.region ? { region: o.region } : {}) });
  return { data: (await r.read()) as Float32Array, w: r.width, h: r.height, c: r.info.channels };
}

/** Worst absolute and relative difference over the first `ch` channels. */
function diff(a: { data: ArrayLike<number>; c: number }, b: Img64 | { data: ArrayLike<number>; c: number }, ch = 3): { maxAbs: number; maxRel: number; n: number } {
  let maxAbs = 0, maxRel = 0;
  const n = a.data.length / a.c;
  for (let i = 0; i < n; i++) for (let k = 0; k < Math.min(ch, a.c); k++) {
    const x = a.data[i * a.c + k]!, y = b.data[i * b.c + k]!;
    const d = Math.abs(x - y);
    maxAbs = Math.max(maxAbs, d);
    maxRel = Math.max(maxRel, d / Math.max(Math.abs(y), 1e-3));
  }
  return { maxAbs, maxRel, n };
}

const bitwise = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) n++;
  return n;
};

/** The mask nodes a print.combine reads. */
function combineMasks(n: Node): string[] {
  const c = combineArgs(n.args);
  return [...new Set([c.mainMask, ...c.terms.map((t) => t.mask), ...c.densities.map((d) => d.mask), ...c.filters.map((x) => x.mask), ...c.preflash.map((x) => x.mask)].filter((x): x is string => x !== undefined))];
}

// ---- tests --------------------------------------------------------------------------------------------------------

export const LAW_TESTS: Record<string, T> = {
  /** The light law: every darkroom kind against lightH on core's print.expose, masks and density mask. */
  async 'law:combine'() {
    const { f, g, law, tab, kernel } = await setup();
    const c = compile(richDarkroom(f.sha), g);
    const h = c.cuts['darkroom.H']!;
    const args = combineArgs(h.args);
    const want = await law.image(h.id);
    const got = await gpuRead(f, g, h);
    const exp = diff(got, want);
    const pre = diff(await gpuRead(f, g, h, { precision: 'preview' }), await tab.image(h.id));
    const ker = diff(got, await kernel.image(h.id));
    const masks = [];
    for (const m of combineMasks(h)) masks.push({ op: g.get(m)!.op, ...diff(await gpuRead(f, g, g.get(m)!), await law.image(m), 1) });
    const dms = [];
    for (const d of args.densities) {
      const dn = g.get(d.image)!;
      const w = await law.image(dn.id);
      dms.push({ ...diff(await gpuRead(f, g, dn), w, 1), max: Math.max(...w.data) });
    }
    // half scale: masks, the feather and the density mask's blur run on the half grid (σ halved), so this bounds
    // the preview's spatial approximation, not the law
    const hg = await gpuRead(f, g, h, { scale: 0.5, precision: 'preview' });
    const half = diff(hg, await law.sampled(h.id, hg.w, hg.h));
    // the law changes the print: against the main exposure alone
    const vsMain = diff(await gpuRead(f, g, c.cuts['darkroom.main']!), want);
    return {
      barrier: isBarrier(h), terms: args.terms.map((t) => t.role), densities: args.densities.length, filters: args.filters.length, preflash: args.preflash.length,
      mainAmount: args.mainAmount, export: exp, preview: pre, kernel: ker, masks, densityMasks: dms, half, vsMain,
    };
  },

  /** A print.combine without texture terms fuses into the pointwise kernel (one LIGHT op), in both forms. */
  async 'law:combine-fused'() {
    const { f, g, law, tab } = await setup();
    const out: Record<string, unknown> = {};
    for (const [name, lightsOnly] of [['general', false], ['additive', true]] as const) {
      const c = compile(fusedDarkroom(f.sha, lightsOnly), g);
      const h = c.cuts['darkroom.H']!;
      f.gpu.adopt(g.closure(h.id));
      const ops = f.gpu.lowerNode(h).flatMap((s) => s.ops);
      const light = ops.find((o) => o.code === OP.LIGHT);
      out[name] = {
        barrier: isBarrier(h), segments: f.gpu.lowerNode(h).length, light: light ? { flags: light.flags ?? 0 } : null,
        export: diff(await gpuRead(f, g, h), await law.image(h.id)), preview: diff(await gpuRead(f, g, h, { precision: 'preview' }), await tab.image(h.id)),
      };
    }
    // the fused form against the barrier form of the same light: a full-coverage mask on the lights forces passes
    const full = M([['c', C('luminance', { above: 0, below: 1, softness: 0 })]]);
    const fused = compile(fusedDarkroom(f.sha), g).cuts['darkroom.H']!;
    const doc = fusedDarkroom(f.sha);
    const lights = doc.stages.darkroom!.stack.items['lights'] as Entry;
    const masked = { ...doc, masks: coll([['all', full]]) as Document['masks'], stages: { ...doc.stages, darkroom: { ...doc.stages.darkroom!, stack: { ...doc.stages.darkroom!.stack, items: { ...doc.stages.darkroom!.stack.items, lights: { ...lights, mask: 'all' } } } } } } as Document;
    const barrier = compile(masked, g).cuts['darkroom.H']!;
    out['fusedVsBarrier'] = { barrier: isBarrier(barrier), ...diff(await gpuRead(f, g, fused), { ...(await gpuRead(f, g, barrier)) } as never) };
    return out;
  },

  /** composite.mix: exact at coverage 0 and 1; mixPixel between. A print-stage clarity layer at 0.6 under a mask. */
  async 'law:composite'() {
    const { f, g, law, kernel } = await setup();
    const I = (op: string, inputs: string[], args: Record<string, unknown> = {}): Node => g.intern(op, inputs, args).node;
    const back = I('source.pattern', [], { domain: 'print-xyz', width: W, height: H, seed: 3 });
    const top = I('source.pattern', [], { domain: 'print-xyz', width: W, height: H, seed: 4 });
    const ell = I('mask.ellipse', [back.id], { box: { x: 20, y: 10, w: 50, h: 40 }, angle_deg: 10 });
    const one = I('mask.constant', [back.id], { value: 1 });
    const zero = I('mask.constant', [back.id], { value: 0 });
    const mix = (amount: number, mask?: Node) => I('composite.mix', [back.id], { top: top.id, amount, ...(mask ? { mask: mask.id } : {}), blend: 'normal' });
    const [b, t] = [await gpuRead(f, g, back), await gpuRead(f, g, top)];
    const exact = {
      amount0: bitwise((await gpuRead(f, g, mix(0))).data, b.data),
      amount1: bitwise((await gpuRead(f, g, mix(1))).data, t.data),
      amount1FullMask: bitwise((await gpuRead(f, g, mix(1, one))).data, t.data),
      amount1EmptyMask: bitwise((await gpuRead(f, g, mix(1, zero))).data, b.data),
    };
    const between = diff(await gpuRead(f, g, mix(0.37, ell)), await law.image(mix(0.37, ell).id));
    // through the compiler: clarity at amount 0.6 under a mask is composite.mix(print, clarity(print), 0.6, mask)
    const c = compile(scanDocument(f.sha, { print: [['cl', L('clarity', { strength: 0.6, radius_mm: 0.12 }, { amount: 0.6, mask: 'm' })]] }, [['m', M([['c', C('ellipse', { box: { x: 10, y: 5, w: 60, h: 50 } })]])]]), g);
    const fin = c.cuts.finished!;
    const gf = await gpuRead(f, g, fin);
    const doc = { chain: diff(gf, await law.image(fin.id)), kernel: diff(gf, await kernel.image(fin.id)) };
    return { exact, between, document: { op: fin.op, ...doc } };
  },

  /** The mask algebra (design §25) on the GPU against maskCombine, and its laws bit for bit where they are exact. */
  async 'law:masks'() {
    const { f, g, law } = await setup();
    const src = compile(scanDocument(f.sha, {}), g).cuts.source!;
    const I = (op: string, inputs: string[], args: Record<string, unknown> = {}): Node => g.intern(op, inputs, args).node;
    const a = I('mask.linear', [src.id], { from: { x: 5, y: 3 }, to: { x: 70, y: 50 } });
    const b = I('mask.ellipse', [src.id], { box: { x: 30, y: 20, w: 30, h: 20 }, angle_deg: 25 });
    const p = I('mask.paint', [src.id], { strokes: [{ points: [[10, 50, 0.5], [50, 58, 0.5], [90, 44, 0.5]], radius: 6, hardness: 0.4, mode: 'add' }] });
    const l = I('mask.luminance', [src.id], { above: 0.3, below: 0.7, softness: 0.1 });
    const c1 = I('mask.combine', [a.id], { other: b.id, mode: 'add', amount: 1 });
    const c2 = I('mask.combine', [c1.id], { other: p.id, mode: 'subtract', amount: 0.7 });
    const c3 = I('mask.combine', [c2.id], { other: l.id, mode: 'intersect', amount: 0.5 });
    const fe = I('mask.feather', [c3.id], { radius_px: 6 });
    const inv = I('mask.invert', [fe.id], {});
    const inv2 = I('mask.invert', [inv.id], {});
    const parity: Record<string, unknown> = {};
    for (const [k, n] of Object.entries({ a, b, p, l, c1, c2, c3, fe, inv })) parity[k] = diff(await gpuRead(f, g, n), await law.image(n.id), 1);
    const one = I('mask.constant', [src.id], { value: 1 });
    const read = async (n: Node) => (await gpuRead(f, g, n)).data;
    const laws = {
      addIdempotent: bitwise(await read(I('mask.combine', [c2.id], { other: c2.id, mode: 'add', amount: 1 })), await read(c2)),
      intersectFull: bitwise(await read(I('mask.combine', [c2.id], { other: one.id, mode: 'intersect', amount: 1 })), await read(c2)),
      amount0: bitwise(await read(I('mask.combine', [c2.id], { other: b.id, mode: 'subtract', amount: 0 })), await read(c2)),
      invertTwice: diff(await gpuRead(f, g, inv2), { data: await read(fe), c: 1 }, 1).maxAbs,
    };
    // a mask in document pixels at scale s is the full-scale mask sampled (design §37), for the pointwise algebra
    const half = await gpuRead(f, g, c3, { scale: 0.5 });
    return { parity, laws, halfScale: diff(half, await law.sampled(c3.id, half.w, half.h), 1) };
  },

  /** heal and clone: sequential spots, coalesced, in the scan (density, additive seam) and on the print. */
  async 'law:heal'(o) {
    const { f, g, law, kernel } = await setup();
    // spot 3 heals from where spot 1 just landed (its source disc overlaps spot 1's target): sequential semantics
    const h1: RepairSpot[] = [{ x: 30.3, y: 20.7, r: 6.5, src: { x: 60.2, y: 40.1 }, feather: 0.4, opacity: 1 }, { x: 70, y: 15, r: 5, src: { x: 40, y: 50 }, feather: 0, opacity: 0.7 }];
    const c1: RepairSpot[] = [{ x: 80, y: 50, r: 4, src: { x: 20, y: 50 }, feather: 0.5, opacity: 1 }];
    const h3: RepairSpot[] = [{ x: 50, y: 30, r: 5, src: { x: 32, y: 22 }, feather: 0.3, opacity: 1 }];
    // the broken variant renders a source 0.7 px off on the GPU and compares it with the reference of the true one
    const h3gpu: RepairSpot[] = o['broken'] ? [{ ...h3[0]!, src: { x: 31.3, y: 22 } }] : h3;
    const print = (sep: boolean, spots3 = h3): [Id, Entry][] => [
      ['h1', L('heal', { spots: spotsColl(h1) }, sep ? { mask: 'all' } : {})],
      ['h3', L('heal', { spots: spotsColl(spots3) }, sep ? { mask: 'all' } : {})],
      ['c1', L('clone', { spots: spotsColl(c1) })],
    ];
    const all: [Id, Mask][] = [['all', M([['c', C('luminance', { above: 0, below: 1, softness: 0 })]])]];
    const cA = compile(scanDocument(f.sha, { print: print(false, h3gpu) }, all), g);
    const cB = compile(scanDocument(f.sha, { print: print(true, h3gpu) }, all), g);
    const cR = compile(scanDocument(f.sha, { print: print(false) }, all), g);
    const fin = cA.cuts.finished!, finB = cB.cuts.finished!;
    const gp = await gpuRead(f, g, fin);
    const printParity = { chain: diff(gp, await law.image(cR.cuts.finished!.id)), kernel: diff(gp, await kernel.image(cR.cuts.finished!.id)) };
    // the coalesced run and the layers kept apart (each its own heal and composite.mix at full coverage)
    const healNode = g.get(cA.entries['h1']![0]!)!;
    const coalesced = { op: healNode.op, spots: (healNode.args['spots'] as unknown[]).length, sameNode: cA.entries['h3']?.[0] === healNode.id, ...diff(gp, await gpuRead(f, g, finB)) };
    // the old semantics (every spot reads the receiver) differ where spot 3 reads spot 1's result
    const parallel = diff(await gpuRead(f, g, healNode), repairParallel(await law.image(cA.cuts.print!.id), [...h1, ...h3]));
    // tiles against one pass, half scale against the reference's nearest samples
    const tiles = [{ x: 0, y: 0, w: 41, h: 29 }, { x: 41, y: 0, w: 55, h: 29 }, { x: 0, y: 29, w: 41, h: 35 }, { x: 41, y: 29, w: 55, h: 35 }];
    let tileDiff = 0;
    for (const t of tiles) {
      const part = await gpuRead(f, g, fin, { region: t });
      for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) for (let k = 0; k < 3; k++) tileDiff = Math.max(tileDiff, Math.abs(part.data[(y * t.w + x) * 3 + k]! - gp.data[((t.y + y) * W + t.x + x) * 3 + k]!));
    }
    const hp = await gpuRead(f, g, fin, { scale: 0.5 });
    const half = diff(hp, await kernel.sampled(cR.cuts.finished!.id, hp.w, hp.h));
    // the scan stage: dust healed in scanner density (additive seam), two overlapping spots in one layer
    const dust: RepairSpot[] = [{ x: 40, y: 30, r: 4, src: { x: 52, y: 34 }, feather: 0.3, opacity: 1 }, { x: 50, y: 33, r: 3.5, src: { x: 64, y: 20 }, feather: 0.3, opacity: 1 }];
    const cS = compile(scanDocument(f.sha, { scan: [['dust', L('heal', { spots: spotsColl(dust) })]] }), g);
    const scan = cS.cuts.scan!;
    const sp = await gpuRead(f, g, scan);
    const scanParity = diff(sp, await law.image(scan.id));
    let changed = 0;
    const scanIn = await law.image(g.get(scan.inputs[0]!)!.id);
    for (let i = 0; i < scanIn.data.length; i++) if (Math.abs(scanIn.data[i]! - sp.data[i]!) > 1e-6) changed++;
    return { op: fin.op, print: printParity, coalesced, parallel, tileDiff, half, scan: { op: scan.op, ...scanParity, changed } };
  },

  /** clarity: a small radius (direct blur) and a wide one (the downsampled low-pass) against the f64 definition. */
  async 'law:clarity'() {
    const { f, g, law, kernel } = await setup();
    const out: Record<string, unknown> = {};
    for (const [name, radius_mm, strength] of [['small', 0.1, 0.5], ['wide', 3, 0.8], ['soften', 0.2, -0.6]] as const) {
      const c = compile(scanDocument(f.sha, { print: [['cl', L('clarity', { strength, radius_mm })]] }), g);
      const fin = c.cuts.finished!;
      const info = fin.info as ImageInfo;
      const sigma = (radius_mm * 1000) / info.umPerPx.paper!;
      const want = await law.image(fin.id);
      const base = await law.image(c.cuts.print!.id);
      const got = await gpuRead(f, g, fin);
      const ker = await kernel.image(fin.id);
      // where the worst kernel difference is (the downsampled low-pass errs most at the frame's edge)
      let worst = { x: 0, y: 0, rel: 0 };
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let k = 0; k < 3; k++) {
        const i = (y * W + x) * 3 + k;
        const rel = Math.abs(got.data[i]! - ker.data[i]!) / Math.max(Math.abs(ker.data[i]!), 1e-3);
        if (rel > worst.rel) worst = { x, y, rel };
      }
      out[name] = { op: fin.op, sigma, umPaper: info.umPerPx.paper, chain: diff(got, want), kernel: diff(got, ker), worst, effect: diff({ data: base.data, c: base.c }, want).maxRel };
    }
    // a print-sized σ on a frame five times larger than it (GPU only: the kernel reference): 3.2 mm at 32 µm/px = σ 100 px
    const big = syntheticScan(gold().solve, 480, 320);
    const bi = await f.gpu.open({ kind: 'file', sha256: '', bytes: big.tiff });
    g.registerSource(bi);
    const cl = compile(scanDocument(bi.sha256, { print: [['cl', L('clarity', { strength: 0.7, radius_mm: 3.2 })]] }, [], [480, 320]), g).cuts.finished!;
    const got = await gpuRead(f, g, cl);
    out['large'] = { op: cl.op, sigma: (3.2 * 1000) / (cl.info as ImageInfo).umPerPx.paper!, kernel: diff(got, await kernel.image(cl.id)) };
    return out;
  },

  /** Gaussian blurs of any σ (mask.feather, σ = radius / 2) against core's one-pass gaussianBlur1, on a 480 × 320 frame. */
  async 'law:blur'() {
    const { f, g, kernel } = await setup();
    const big = syntheticScan(gold().solve, 480, 320);
    const bi = await f.gpu.open({ kind: 'file', sha256: '', bytes: big.tiff });
    g.registerSource(bi);
    const src = compile(scanDocument(bi.sha256, {}, [], [480, 320]), g).cuts.source!;
    const ell = g.intern('mask.ellipse', [src.id], { box: { x: 140, y: 90, w: 200, h: 140 }, angle_deg: 15 }).node;
    const out: Record<string, unknown> = {};
    for (const sigma of [10, 32, 40, 100]) {
      const fe = g.intern('mask.feather', [ell.id], { radius_px: 2 * sigma }).node;
      const got = await gpuRead(f, g, fe);
      const want = await kernel.image(fe.id);
      let worst = { x: 0, y: 0, d: 0 };
      for (let i = 0; i < 480 * 320; i++) {
        const d = Math.abs(got.data[i * got.c]! - want.data[i]!);
        if (d > worst.d) worst = { x: i % 480, y: Math.floor(i / 480), d };
      }
      out[`s${sigma}`] = worst;
    }
    return out;
  },

  /** Whole documents against core's RefEngine at the display cut (export), in 8-bit levels. */
  async 'law:core'() {
    const { f, g } = await setup();
    const out: Record<string, unknown> = {};
    const docs: Record<string, Document> = {
      combine: richDarkroom(f.sha), fused: fusedDarkroom(f.sha),
      print: scanDocument(f.sha, { print: [['h', L('heal', { spots: spotsColl([{ x: 30, y: 20, r: 6, src: { x: 60, y: 40 }, feather: 0.4, opacity: 1 }]) })], ['cl', L('clarity', { strength: 0.5, radius_mm: 0.1 }, { amount: 0.7 })]] }),
    };
    for (const [name, d] of Object.entries(docs)) {
      const disp = g.get(compile(d, g).display.inputs[0]!)!; // output.display (output.frame is the identity here)
      f.ref.adopt(g.closure(disp.id));
      const want = { data: await (await f.ref.evaluate(disp, { scale: 'full', precision: 'export' })).read(), c: 3 };
      const got = await gpuRead(f, g, disp);
      out[name] = { ...diff(got, want as never), max8bit: max8(got.data, want.data) };
    }
    return out;
  },

  /**
   * output.frame on the GPU (CHB-037 P3b): the display cut with a crop under each orientation equals the crop and
   * reorientation of the GPU's own output.display (a pixel permutation: bit for bit), at full size, at half scale and
   * over a region; a straightened crop equals core's frameImage on the GPU's own receiver (f32 bilinear), and the
   * whole display cut is within one 8-bit level of core.
   */
  async 'law:frame'() {
    const { f, g } = await setup();
    const base = fusedDarkroom(f.sha);
    const crop = { x: 7, y: 5, w: 61, h: 43 };
    const out: Record<string, unknown> = {};
    const geo = (orientation: string, angle_deg: number): Document => edit(base, [{ op: 'set', path: 'geometry', value: { orientation, angle_deg, crop } }]).doc;
    for (const o of ['none', 'flipH', 'flipV', 'rot180', 'cw90', 'ccw90', 'transpose', 'transverse']) {
      const top = g.get(compile(geo(o, 0), g).display.id)!;
      const disp = g.get(top.inputs[0]!)!;
      const inner = await gpuRead(f, g, disp);
      const want = frameImage(inner.data, inner.w, inner.h, 3, { orientation: o, angle_deg: 0, crop });
      const full = await gpuRead(f, g, top);
      // previews: the frame's grid against the same grid of a whole-frame render of the framed result
      const half = await gpuRead(f, g, top, { scale: 0.5, precision: 'preview' });
      const halfInner = await gpuRead(f, g, disp, { scale: 'full', precision: 'preview' });
      const fw = want.width, fh = want.height, hw = half.w, hh = half.h;
      const wantP = frameImage(halfInner.data, halfInner.w, halfInner.h, 3, { orientation: o, angle_deg: 0, crop });
      const halfWant = new Float32Array(hw * hh * 3);
      for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
        const sx = Math.min(fw - 1, Math.floor(((x + 0.5) * fw) / hw)), sy = Math.min(fh - 1, Math.floor(((y + 0.5) * fh) / hh));
        for (let k = 0; k < 3; k++) halfWant[(y * hw + x) * 3 + k] = wantP.data[(sy * fw + sx) * 3 + k]!;
      }
      const reg = { x: 3, y: 4, w: 20, h: 17 };
      const part = await gpuRead(f, g, top, { region: reg });
      const partWant = new Float32Array(reg.w * reg.h * 3);
      for (let y = 0; y < reg.h; y++) for (let x = 0; x < reg.w; x++) for (let k = 0; k < 3; k++) partWant[(y * reg.w + x) * 3 + k] = want.data[((reg.y + y) * fw + reg.x + x) * 3 + k]!;
      out[o] = {
        size: [full.w, full.h], want: [fw, fh], full: bitwise(full.data, Float32Array.from(want.data)),
        half: bitwise(half.data, halfWant), region: bitwise(part.data, partWant),
      };
    }
    const st = g.get(compile(geo('cw90', 3.5), g).display.id)!;
    const disp = g.get(st.inputs[0]!)!;
    const inner = await gpuRead(f, g, disp);
    const want = frameImage(inner.data, inner.w, inner.h, 3, { orientation: 'cw90', angle_deg: 3.5, crop });
    const got = await gpuRead(f, g, st);
    f.ref.adopt(g.closure(st.id));
    const core = await (await f.ref.evaluate(st, { scale: 'full', precision: 'export' })).read();
    out['straighten'] = { size: [got.w, got.h], want: [want.width, want.height], ...diff(got, { data: want.data, c: 3 }), core8bit: max8(got.data, core) };
    return out;
  },
};

/**
 * CHB-037 P3b: an export tile by tile equals the whole-frame export (16-bit codes, bit for bit) for every spatial op of
 * the negative's chain, near tile borders: density masks and feathers narrow (one pass, a halo) and wide (the
 * whole-frame field), clarity (wide) and sharpen (narrow), heal spots across tile borders, and a stack of them. 64-px
 * tiles over a 352 × 232 frame; fields built from 96-px boxes (exactBox), so they too are assembled from parts. The
 * preview path (every texture on the tile's grid) is the broken comparison: it differs.
 */
async function tilesTest(): Promise<Record<string, unknown>> {
  const TW = 352, TH = 232, T = 64;
  const rt = await runtime();
  const { tiff } = syntheticScan(gold().solve, TW, TH);
  const gpu = await GpuEngine.create({ runtime: rt, workers: 4, opfs: false, exactBox: 96 });
  const sha = (await gpu.open({ kind: 'file', sha256: '', bytes: tiff })).sha256;
  const g = new Graph();
  g.registerSource(gpu.graph.source(sha)!);
  const size: [number, number] = [TW, TH];
  const ell = (feather_mm: number): [Id, Mask][] => [['e', M([['c', C('ellipse', { box: { x: 70, y: 50, w: 150, h: 110 }, angle_deg: 20 })]], { feather_mm })]];
  const main: [Id, Entry] = ['main', L('expose', { time_s: 12, fstop: 8, filtration: { c: 0, m: 0, y: 0 } })];
  const spots = spotsColl([
    { x: 64, y: 64, r: 9, src: { x: 150, y: 120 }, feather: 0.4, opacity: 1 },
    { x: 190, y: 60, r: 12, src: { x: 186, y: 66 }, feather: 0.3, opacity: 1 },
    { x: 128, y: 190, r: 7, src: { x: 300, y: 30 }, feather: 0.5, opacity: 0.8 },
  ]);
  const docs: Record<string, Document> = {
    densityNarrow: scanDocument(sha, { darkroom: [main, ['dm', L('densityMask', { gamma: 0.5, radius_um: 40, polarity: 'positive' })]] }, [], size),
    densityWide: scanDocument(sha, { darkroom: [main, ['dm', L('densityMask', { gamma: 0.5, radius_um: 300, polarity: 'same' })]] }, [], size),
    featherNarrow: scanDocument(sha, { darkroom: [main, ['b', L('burn', { stops: 0.7 }, { mask: 'e' })]] }, ell(0.12), size),
    featherWide: scanDocument(sha, { darkroom: [main, ['b', L('burn', { stops: 0.7 }, { mask: 'e' })]] }, ell(0.6), size),
    clarity: scanDocument(sha, { print: [['cl', L('clarity', { strength: 0.6, radius_mm: 2 })]] }, [], size),
    sharpen: scanDocument(sha, { print: [['sh', L('sharpen', { strength: 0.8, radius_mm: 0.1 })]] }, [], size),
    heal: scanDocument(sha, { print: [['h', L('heal', { spots })]] }, [], size),
    stack: scanDocument(sha, {
      darkroom: [main, ['dm', L('densityMask', { gamma: 0.4, radius_um: 200, polarity: 'positive' })], ['b', L('burn', { stops: 0.5 }, { mask: 'e' })]],
      print: [['h', L('heal', { spots })], ['sh', L('sharpen', { strength: 0.5, radius_mm: 0.15 })], ['cl', L('clarity', { strength: 0.4, radius_mm: 1.5 })]],
    }, ell(0.3), size),
  };
  const out: Record<string, unknown> = {};
  for (const [name, d] of Object.entries(docs)) {
    const n = compile(d, g).display;
    gpu.adopt(g.closure(n.id));
    const whole = await gpu.evaluateU16(n, { scale: 'full' });
    const tiled = new Uint16Array(TW * TH * 3);
    const prev = new Float32Array(TW * TH * 3);
    for (let y = 0; y < TH; y += T) for (let x = 0; x < TW; x += T) {
      const region = { x, y, w: Math.min(T, TW - x), h: Math.min(T, TH - y) };
      const t = await gpu.evaluateU16(n, { scale: 'full', region });
      for (let r = 0; r < region.h; r++) tiled.set(t.data.subarray(r * region.w * 3, (r + 1) * region.w * 3), ((y + r) * TW + x) * 3);
      const p = await (await gpu.evaluate(n, { scale: 'full', precision: 'preview', region })).read();
      for (let r = 0; r < region.h; r++) prev.set(p.subarray(r * region.w * 3, (r + 1) * region.w * 3), ((y + r) * TW + x) * 3);
    }
    const pw = await (await gpu.evaluate(n, { scale: 'full', precision: 'preview' })).read();
    let codes = 0, worst = 0, before = 0;
    for (let i = 0; i < tiled.length; i++) {
      if (tiled[i] !== whole.data[i]) codes++;
      worst = Math.max(worst, Math.abs(tiled[i]! - whole.data[i]!));
      if (Math.abs(prev[i]! - pw[i]!) > 1 / 65535) before++;
    }
    out[name] = { ops: [...new Set(g.closure(n.id).map((m) => m.op))].filter((op) => ['print.densityMask', 'mask.feather', 'clarity', 'sharpen', 'heal'].includes(op)), codes, worst, before };
  }
  gpu.dispose();
  return out;
}
LAW_TESTS['law:tiles'] = tilesTest;

/**
 * CHB-045 GPUC-1 (CHB-037 P10-10): an exact export tile that has taken a whole-frame field and not yet submitted the pass
 * that reads it, while a preview starts (dropFields) and another render takes a texture of the field's descriptor from
 * the pool and writes it. The interleaving is forced: the tile's first upsampleAt runs the preview and the intruder
 * before it reads the field. With leases the field returns to the pool only after the tile's pass is submitted, so the
 * intruder gets another texture and the tile equals the whole-frame export; `broken` turns the leases off (the code
 * before the fix): the pool hands the field itself to the intruder and the tile reads its writes.
 */
async function fieldRaceTest(o: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const TW = 352, TH = 232;
  const rt = await runtime();
  const { tiff } = syntheticScan(gold().solve, TW, TH);
  const gpu = await GpuEngine.create({ runtime: rt, workers: 4, opfs: false, exactBox: 96 });
  const sha = (await gpu.open({ kind: 'file', sha256: '', bytes: tiff })).sha256;
  const g = new Graph();
  g.registerSource(gpu.graph.source(sha)!);
  const main: [Id, Entry] = ['main', L('expose', { time_s: 12, fstop: 8, filtration: { c: 0, m: 0, y: 0 } })];
  const d = scanDocument(sha, { darkroom: [main, ['dm', L('densityMask', { gamma: 0.5, radius_um: 300, polarity: 'same' })]] }, [], [TW, TH]);
  const n = compile(d, g).display;
  gpu.adopt(g.closure(n.id));
  const pool = rt.textures as unknown as { lease(t: GPUTexture): () => void };
  const lease = pool.lease;
  if (o['broken']) pool.lease = () => () => undefined;
  const blur = (gpu as unknown as { blur: { upsampleAt(f: GPUTexture, ...rest: unknown[]): Promise<GPUTexture> } }).blur;
  const upsampleAt = blur.upsampleAt;
  let intruder: GPUTexture | null = null;
  let same: boolean | null = null;
  try {
    const whole = await gpu.evaluateU16(n, { scale: 'full' });
    const region = { x: 128, y: 64, w: 64, h: 64 };
    const first = await gpu.evaluateU16(n, { scale: 'full', region }); // builds the fields; the next tile takes them from the cache
    blur.upsampleAt = async function (this: unknown, field: GPUTexture, ...rest: unknown[]): Promise<GPUTexture> {
      if (same === null) {
        // the tile holds the field and awaits its pipeline: a preview starts, and another render takes a texture
        await gpu.evaluate(n, { scale: 0.5, precision: 'preview' });
        intruder = rt.textures.acquire({ format: field.format, w: field.width, h: field.height, usage: field.usage }, 'test.intruder');
        same = intruder === field;
        rt.device.queue.writeTexture({ texture: intruder }, new Float32Array(field.width * field.height * 4).fill(0.25), { bytesPerRow: field.width * 16 }, [field.width, field.height]);
      }
      return upsampleAt.call(blur, field, ...rest);
    };
    const raced = await gpu.evaluateU16(n, { scale: 'full', region });
    let codes = 0, firstCodes = 0;
    for (let y = 0; y < region.h; y++) for (let x = 0; x < region.w; x++) for (let k = 0; k < 3; k++) {
      const want = whole.data[((region.y + y) * TW + region.x + x) * 3 + k]!;
      if (raced.data[(y * region.w + x) * 3 + k] !== want) codes++;
      if (first.data[(y * region.w + x) * 3 + k] !== want) firstCodes++;
    }
    return { same, codes, firstCodes, pending: rt.budget.pending };
  } finally {
    blur.upsampleAt = upsampleAt;
    pool.lease = lease;
    if (intruder) rt.textures.release(intruder);
    gpu.dispose();
  }
}
LAW_TESTS['law:field-race'] = fieldRaceTest;

function max8(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(Math.round(a[i]! * 255) - Math.round(b[i]! * 255)));
  return m;
}

/** CHB-022's semantics (every spot reads the receiver), for the broken comparison: heal each spot from `src`. */
function repairParallel(src: Img64, spots: readonly RepairSpot[]): Img64 {
  const out = Float64Array.from(src.data);
  for (const s of spots) {
    const one = retouch(src.data, src.w, src.h, src.c, [s], 'heal', 'linear');
    for (let i = 0; i < out.length; i++) if (one[i] !== src.data[i]) out[i] = one[i]!;
  }
  return { ...src, data: out };
}
