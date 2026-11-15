// The golden cases (CHB-037 P0): each a recipe v2 made the way the studio makes it (defaultRecipe, the studio's
// first print, then the closed mutation set: set, exposure.add, mask.set), named by what it exercises. Masks are
// built as the studio builds them (studio-kit maskSpec: shapes or-ed, feather, invert) or, for the ops the studio's
// editor does not reach (mask.and, mask.luminance), by interning mask.* nodes the way the agent DSL does.
// Only render.ts (regenerate) runs these builders; the check re-renders the stored recipe.json files.
import { applyMutation, compile, defaultRecipe, type DensityMask, type ExposureInput, type FrameRecipe, type MaskSpec, type Mutation, type RetouchSpot } from '@chromobench/contract';
import { maskSpec, type MaskDoc } from '../../packages/studio-kit/src/model/tools.ts';
import { M1 } from '@chromobench/engine-mock';
import { bakeRecipe, DEFAULT_CONVENTIONS, nodePacksData } from '../../packages/core/src/index.ts';
import { firstPrint } from '../../apps/studio/src/host/first-print.ts';
import { integrate, upstream, type GoldenEngine } from './engine.ts';
import { LAYOUT } from './fixtures.ts';

export type FixtureId = 'negative' | 'camera' | 'm1';

export interface CaseDef {
  id: string;
  title: string;
  exercises: string[];
  fixture: FixtureId;
  build(c: Ctx): Promise<FrameRecipe> | FrameRecipe;
  /** Set when the reference engine cannot render the case: the recipe is stored, no pictures. */
  skip?: string;
}

export interface Ctx {
  ge: GoldenEngine;
  sha: Record<FixtureId, string>;
  /** Negative: defaultRecipe with the rebate box, 10 s, no lights (the scan as opened). */
  negPlain: FrameRecipe;
  /** Negative: the studio's first print of negPlain (integrate to grey). The base of most negative cases. */
  neg: FrameRecipe;
  camPlain: FrameRecipe;
  cam: FrameRecipe;
}

const data = nodePacksData();

export async function makeCtx(ge: GoldenEngine, sha: Record<FixtureId, string>): Promise<Ctx> {
  const n0 = defaultRecipe('negative-scan', { sha256: sha.negative, name: 'negative-96x64.tif' }, { frame: 'golden-negative' });
  const negPlain = mut(ge, n0, set('scan.rebate', LAYOUT.rebate));
  const camPlain = defaultRecipe('digital-raw', { sha256: sha.camera, name: 'camera-96x64.dng' }, { frame: 'golden-camera' });
  return { ge, sha, negPlain, neg: await ge.firstPrint(negPlain), camPlain, cam: await ge.firstPrint(camPlain) };
}

// ---- helpers --------------------------------------------------------------------------------

const set = (path: string, value: unknown): Mutation => ({ op: 'set', path, value });
const expo = (e: ExposureInput): Mutation => ({ op: 'exposure.add', exposure: e });

/** Applies mutations as the frame's EditLog would (full checks; mask.set adopts into the graph). */
function mut(ge: GoldenEngine, r: FrameRecipe, ...ms: Mutation[]): FrameRecipe {
  return ms.reduce((x, m) => applyMutation(x, m, { graph: ge.graph }).recipe, r);
}

/** The source.open node of a recipe: the receiver of coordinate masks, as the studio's mask editor uses it. */
function sourceNode(c: Ctx, r: FrameRecipe): string {
  return c.ge.graph.intern('source.open', [], { source: r.source.sha256, encoding: r.source.decode.encoding }).node.id;
}

/** The studio's mask editor: shapes or-ed, then feather, then invert (studio-kit maskSpec). */
function editorMask(c: Ctx, r: FrameRecipe, doc: Partial<MaskDoc> & Pick<MaskDoc, 'shapes'>): MaskSpec {
  return maskSpec(c.ge.graph, sourceNode(c, r), { feather: 0, invert: false, ...doc });
}

/** A mask from interned mask.* nodes (the DSL's way): `f` gets an interning function and returns the root id. */
function nodeMask(c: Ctx, f: (I: (op: string, inputs: string[], args: Record<string, unknown>) => string) => string): MaskSpec {
  const g = c.ge.graph;
  const root = f((op, inputs, args) => g.intern(op, inputs, args).node.id);
  return { version: 1, nodes: g.closure(root) };
}

/** The main exposure node (the enlarger's print.expose) of a compiled recipe: the receiver of a print-luminance mask. */
function mainExposure(c: Ctx, r: FrameRecipe): string {
  return upstream(c.ge.graph, compile(r, c.ge.graph), 'print.expose').id;
}

/** The base negative with `ms`, then the studio's first print again (a printer re-meters after adding a density mask). */
const remeter = (c: Ctx, ...ms: Mutation[]): Promise<FrameRecipe> => c.ge.firstPrint(mut(c.ge, c.neg, ...ms));

const withMask = (c: Ctx, r: FrameRecipe, id: string, m: MaskSpec): FrameRecipe => mut(c.ge, r, { op: 'mask.set', id, mask: m });

const gradientTop = { kind: 'gradient' as const, from: [48, 0] as [number, number], to: [48, 30] as [number, number] };
const ellipseCentre = { kind: 'ellipse' as const, cx: 50, cy: 32, rx: 22, ry: 14 };
const strokes = [
  { kind: 'stroke' as const, points: [[12, 50, 0.5], [36, 56, 0.6], [60, 48, 0.5]] as [number, number, number][], radius: 6, hardness: 0.6, mode: 'add' as const },
  { kind: 'stroke' as const, points: [[34, 44, 0.5], [38, 62, 0.5]] as [number, number, number][], radius: 2.5, hardness: 1, mode: 'erase' as const },
];

const dm = (kind: DensityMask['kind'], polarity: DensityMask['polarity'], amount: number, radius_um: number): DensityMask => ({ kind, polarity, amount, radius_um, enabled: true });

const spot = (mode: RetouchSpot['mode'], x: number, y: number, r: number, src: { x: number; y: number }, o: Partial<RetouchSpot> = {}): RetouchSpot =>
  ({ mode, x, y, r, src, feather: 0.3, opacity: 1, enabled: true, ...o });

// ---- the cases ------------------------------------------------------------------------------

export const CASES: CaseDef[] = [
  // --- sources and the plain print
  { id: 'neg-plain', fixture: 'negative', title: 'Negative as opened: default recipe, rebate box, 10 s, no lights', exercises: ['source:negative-scan', 'scan.rebate', 'print.enlarger (default)'], build: (c) => c.negPlain },
  {
    id: 'neg-m1-plain', fixture: 'm1', title: 'The M1 fixture negative (fixtures/synthetic) with its rebate, first-printed', exercises: ['source:negative-scan', 'fixture:m1', 'print.lights.auto'],
    build: async (c) => {
      const r = defaultRecipe('negative-scan', { sha256: c.sha.m1, name: 'm1-negative-96x64.tif' }, { frame: 'golden-m1' });
      return c.ge.firstPrint(mut(c.ge, r, set('scan.rebate', M1.rebate)));
    },
  },
  { id: 'cam-plain', fixture: 'camera', title: 'Camera file as opened: default digital-raw recipe (daylight WB, 10 s)', exercises: ['source:digital-raw', 'capture', 'film.* forward path'], build: (c) => c.camPlain },

  // --- printer lights and auto balance
  { id: 'neg-auto-lights', fixture: 'negative', title: "Studio first print: integrate to grey, density into time, colour into lights", exercises: ['print.lights.auto (integrate)', 'print.lights.logH', 'print.enlarger.time_s'], build: (c) => c.neg },
  {
    id: 'neg-auto-filtration', fixture: 'negative', title: 'First print baked into filtration (studio ?filtration=1)', exercises: ['print.lights.auto (integrate)', 'bake', 'print.enlarger.filtration'],
    build: (c) => firstPrint(c.ge.engine, c.ge.graph, c.negPlain, { integrate, bake: (r) => bakeRecipe(r, data, DEFAULT_CONVENTIONS).mutations }),
  },
  { id: 'neg-lights-manual', fixture: 'negative', title: 'Printer lights moved by hand: +4 pt red, −2 pt blue', exercises: ['print.lights.logH'], build: (c) => mut(c.ge, c.neg, set('print.lights.logH', c.neg.print.lights.logH.map((v, k) => Number((v + [0.1, 0, -0.05][k]!).toFixed(6))))) },
  { id: 'cam-auto', fixture: 'camera', title: 'Camera file first print (density half way to grey, colour as shot)', exercises: ['print.lights.auto (integrate)', 'source:digital-raw'], build: (c) => c.cam },

  // --- enlarger time and filtration
  { id: 'neg-time-half', fixture: 'negative', title: 'Main exposure halved (one stop less)', exercises: ['print.enlarger.time_s'], build: (c) => mut(c.ge, c.neg, set('print.enlarger.time_s', c.neg.print.enlarger.time_s / 2)) },
  { id: 'neg-time-double', fixture: 'negative', title: 'Main exposure doubled (one stop more)', exercises: ['print.enlarger.time_s'], build: (c) => mut(c.ge, c.neg, set('print.enlarger.time_s', c.neg.print.enlarger.time_s * 2)) },
  { id: 'neg-fstop', fixture: 'negative', title: 'Lens stopped down from f/8 to f/11', exercises: ['print.enlarger.fstop'], build: (c) => mut(c.ge, c.neg, set('print.enlarger.fstop', 11)) },
  { id: 'neg-filtration-magenta', fixture: 'negative', title: 'Filtration +20 M', exercises: ['print.enlarger.filtration'], build: (c) => mut(c.ge, c.neg, set('print.enlarger.filtration', { c: 0, m: 20, y: 0 })) },
  { id: 'neg-filtration-cyan-yellow', fixture: 'negative', title: 'Filtration +10 C −15 Y', exercises: ['print.enlarger.filtration'], build: (c) => mut(c.ge, c.neg, set('print.enlarger.filtration', { c: 10, m: 0, y: -15 })) },
  {
    id: 'neg-normalised', fixture: 'negative', title: 'Normalised enlarger mode, first-printed (everything in the lights)', exercises: ['print.enlarger.mode normalised', 'print.lights.auto'],
    build: (c) => c.ge.firstPrint(mut(c.ge, c.negPlain, set('print.enlarger.mode', 'normalised'))),
  },

  // --- grade and preflash
  { id: 'neg-grade-soft', fixture: 'negative', title: 'Grade 0.5 (soft)', exercises: ['print.grade'], build: (c) => mut(c.ge, c.neg, set('print.grade', 0.5)) },
  { id: 'neg-grade-hard', fixture: 'negative', title: 'Grade 4.5 (hard)', exercises: ['print.grade'], build: (c) => mut(c.ge, c.neg, set('print.grade', 4.5)) },
  { id: 'neg-preflash', fixture: 'negative', title: 'Preflash 3 % of the grey-card exposure', exercises: ['print.preflash'], build: (c) => mut(c.ge, c.neg, set('print.preflash', 0.03)) },
  { id: 'neg-preflash-strong', fixture: 'negative', title: 'Preflash 15 % (beyond the usual range)', exercises: ['print.preflash'], build: (c) => mut(c.ge, c.neg, set('print.preflash', 0.15)) },

  // --- exposures: dodge, burn, flash, split, with every mask op
  {
    id: 'neg-dodge-ellipse', fixture: 'negative', title: 'Dodge ½ stop through an ellipse over the patches', exercises: ['exposure:dodge', 'stops', 'mask.ellipse'],
    build: (c) => mut(c.ge, withMask(c, c.neg, 'face', editorMask(c, c.neg, { shapes: [ellipseCentre] })), expo({ id: 'dodge1', kind: 'dodge', mask: 'face', stops: 0.5 })),
  },
  {
    id: 'neg-dodge-ellipse-feather', fixture: 'negative', title: 'Dodge 1 stop through a rotated, feathered ellipse', exercises: ['exposure:dodge', 'mask.ellipse angle_deg', 'mask.feather'],
    build: (c) => mut(c.ge, withMask(c, c.neg, 'face', editorMask(c, c.neg, { shapes: [{ ...ellipseCentre, angle: 25 }], feather: 6 })), expo({ id: 'dodge1', kind: 'dodge', mask: 'face', stops: 1 })),
  },
  {
    id: 'neg-burn-gradient', fixture: 'negative', title: 'Burn 1 stop through a gradient from the top edge (a sky)', exercises: ['exposure:burn', 'stops', 'mask.gradient'],
    build: (c) => mut(c.ge, withMask(c, c.neg, 'sky', editorMask(c, c.neg, { shapes: [gradientTop] })), expo({ id: 'burn1', kind: 'burn', mask: 'sky', stops: 1 })),
  },
  {
    id: 'neg-burn-gradient-not', fixture: 'negative', title: 'Burn 2 s through the inverted top gradient (the foreground)', exercises: ['exposure:burn', 'time_s', 'mask.gradient', 'mask.not'],
    build: (c) => mut(c.ge, withMask(c, c.neg, 'ground', editorMask(c, c.neg, { shapes: [gradientTop], invert: true })), expo({ id: 'burn1', kind: 'burn', mask: 'ground', time_s: 2 })),
  },
  {
    id: 'neg-burn-paint', fixture: 'negative', title: 'Burn 0.7 stop through painted strokes (one add, one erase)', exercises: ['exposure:burn', 'mask.paint (add, erase)'],
    build: (c) => mut(c.ge, withMask(c, c.neg, 'brush', editorMask(c, c.neg, { shapes: strokes })), expo({ id: 'burn1', kind: 'burn', mask: 'brush', stops: 0.7 })),
  },
  {
    id: 'neg-dodge-or', fixture: 'negative', title: 'Dodge ⅔ stop through an ellipse or-ed with painted strokes, feathered', exercises: ['exposure:dodge', 'mask.or', 'mask.ellipse', 'mask.paint', 'mask.feather'],
    build: (c) => mut(c.ge, withMask(c, c.neg, 'mix', editorMask(c, c.neg, { shapes: [{ kind: 'ellipse', cx: 78, cy: 10, rx: 12, ry: 8 }, ...strokes], feather: 3 })), expo({ id: 'dodge1', kind: 'dodge', mask: 'mix', stops: 2 / 3 })),
  },
  {
    id: 'neg-burn-and', fixture: 'negative', title: 'Burn 1 stop where a gradient and an ellipse overlap', exercises: ['exposure:burn', 'mask.and', 'mask.gradient', 'mask.ellipse'],
    build: (c) => {
      const s = sourceNode(c, c.neg);
      const m = nodeMask(c, (I) => I('mask.and', [I('mask.gradient', [s], { from: { x: 0, y: 0 }, to: { x: 96, y: 0 } })], { other: I('mask.ellipse', [s], { box: { x: 10, y: 6, w: 76, h: 52 } }) }));
      return mut(c.ge, withMask(c, c.neg, 'and', m), expo({ id: 'burn1', kind: 'burn', mask: 'and', stops: 1 }));
    },
  },
  {
    id: 'neg-burn-luminance-scan', fixture: 'negative', title: 'Burn ½ stop through a luminance mask of the scan (thin negative = shadows)', exercises: ['exposure:burn', 'mask.luminance (camera-linear)'],
    build: (c) => {
      const s = sourceNode(c, c.neg);
      return mut(c.ge, withMask(c, c.neg, 'lum', nodeMask(c, (I) => I('mask.luminance', [s], { above: 0.08, below: 1, softness: 0.06 }))), expo({ id: 'burn1', kind: 'burn', mask: 'lum', stops: 0.5 }));
    },
  },
  {
    id: 'neg-dodge-luminance-print', fixture: 'negative', title: 'Dodge ½ stop through a feathered luminance mask of the main exposure (paper log H)', exercises: ['exposure:dodge', 'mask.luminance (paper-logH)', 'mask.feather'],
    build: (c) => {
      const x = mainExposure(c, c.neg);
      return mut(c.ge, withMask(c, c.neg, 'shadows', nodeMask(c, (I) => I('mask.feather', [I('mask.luminance', [x], { above: 0.62, below: 1, softness: 0.04 })], { radius_px: 2 }))), expo({ id: 'dodge1', kind: 'dodge', mask: 'shadows', stops: 0.5 }));
    },
  },
  { id: 'neg-flash-base', fixture: 'negative', title: 'Flash through the film base, 0.2 s, whole frame', exercises: ['exposure:flash through base', 'unmasked'], build: (c) => mut(c.ge, c.neg, expo({ id: 'flash1', kind: 'flash', time_s: 0.2, through: 'base' })) },
  {
    id: 'neg-flash-base-gradient', fixture: 'negative', title: 'Flash through the base, 0.5 s, under the top gradient', exercises: ['exposure:flash through base', 'mask.gradient'],
    build: (c) => mut(c.ge, withMask(c, c.neg, 'sky', editorMask(c, c.neg, { shapes: [gradientTop] })), expo({ id: 'flash1', kind: 'flash', mask: 'sky', time_s: 0.5, through: 'base' })),
  },
  {
    id: 'neg-flash-open-ellipse', fixture: 'negative', title: 'Flash through an open gate, 0.5 s, through an ellipse', exercises: ['exposure:flash open', 'mask.ellipse'],
    build: (c) => mut(c.ge, withMask(c, c.neg, 'face', editorMask(c, c.neg, { shapes: [ellipseCentre] })), expo({ id: 'flash1', kind: 'flash', mask: 'face', time_s: 0.5, through: 'open' })),
  },
  {
    id: 'neg-split', fixture: 'negative', title: 'Split: half the time as main, half at +40 M (whole frame)', exercises: ['exposure:split', 'exposure filtration', 'print.enlarger.time_s'],
    build: (c) => {
      const t = c.neg.print.enlarger.time_s / 2;
      return mut(c.ge, c.neg, set('print.enlarger.time_s', t), expo({ id: 'split1', kind: 'split', time_s: t, filtration: { c: 0, m: 40, y: 0 } }));
    },
  },
  {
    id: 'neg-split-masked', fixture: 'negative', title: 'Split +30 Y for 2 s through a luminance mask of the scan', exercises: ['exposure:split', 'exposure filtration', 'mask.luminance'],
    build: (c) => {
      const s = sourceNode(c, c.neg);
      return mut(c.ge, withMask(c, c.neg, 'lum', nodeMask(c, (I) => I('mask.luminance', [s], { above: 0, below: 0.1, softness: 0.05 }))), expo({ id: 'split1', kind: 'split', mask: 'lum', time_s: 2, filtration: { c: 0, m: 0, y: 30 } }));
    },
  },
  {
    id: 'neg-exposures-mixed', fixture: 'negative', title: 'Dodge, burn, base flash and a disabled burn together (the sum is order-free)', exercises: ['exposure:dodge', 'exposure:burn', 'exposure:flash through base', 'exposure enabled=false', 'burn filtration'],
    build: (c) => {
      let r = withMask(c, c.neg, 'face', editorMask(c, c.neg, { shapes: [ellipseCentre], feather: 4 }));
      r = withMask(c, r, 'sky', editorMask(c, r, { shapes: [gradientTop] }));
      return mut(c.ge, r,
        expo({ id: 'dodge1', kind: 'dodge', mask: 'face', stops: 0.5 }),
        expo({ id: 'burn1', kind: 'burn', mask: 'sky', stops: 1, filtration: { c: 0, m: 10, y: 0 } }),
        expo({ id: 'flash1', kind: 'flash', mask: 'sky', time_s: 0.2, through: 'base' }),
        expo({ id: 'burn2', kind: 'burn', stops: 2, enabled: false }));
    },
  },

  // --- density masks
  { id: 'neg-dm-contrast-positive', fixture: 'negative', title: 'Contrast mask, positive, γ 0.5, 300 µm, re-metered', exercises: ['print.densityMasks contrast positive'], build: (c) => remeter(c, set('print.densityMasks.dm1', dm('contrast', 'positive', 0.5, 300))) },
  { id: 'neg-dm-contrast-same', fixture: 'negative', title: 'Contrast mask, same polarity, γ 0.4, 300 µm, re-metered', exercises: ['print.densityMasks contrast same'], build: (c) => remeter(c, set('print.densityMasks.dm1', dm('contrast', 'same', 0.4, 300))) },
  { id: 'neg-dm-unsharp-positive', fixture: 'negative', title: 'Unsharp mask, positive, γ 0.6, 25 µm, re-metered', exercises: ['print.densityMasks unsharp positive'], build: (c) => remeter(c, set('print.densityMasks.dm1', dm('unsharp', 'positive', 0.6, 25))) },
  { id: 'neg-dm-unsharp-same', fixture: 'negative', title: 'Unsharp mask, same polarity, γ 0.5, 25 µm, re-metered', exercises: ['print.densityMasks unsharp same'], build: (c) => remeter(c, set('print.densityMasks.dm1', dm('unsharp', 'same', 0.5, 25))) },
  { id: 'neg-dm-unmetered', fixture: 'negative', title: 'Unsharp mask, positive, γ 0.6, 25 µm, at the base time (the mask lightens the whole print)', exercises: ['print.densityMasks unsharp positive'], build: (c) => mut(c.ge, c.neg, set('print.densityMasks.dm1', dm('unsharp', 'positive', 0.6, 25))) },
  {
    id: 'neg-dm-two-with-burn-flash', fixture: 'negative', title: 'Contrast and unsharp masks (and a disabled one) with a burn and a base flash, re-metered (masks act on the burn, not the flash)', exercises: ['print.densityMasks (several, enabled=false)', 'exposure:burn', 'exposure:flash through base'],
    build: (c) => {
      const r = withMask(c, c.neg, 'sky', editorMask(c, c.neg, { shapes: [gradientTop] }));
      return c.ge.firstPrint(mut(c.ge, r,
        set('print.densityMasks.a', dm('contrast', 'positive', 0.3, 400)),
        set('print.densityMasks.b', dm('unsharp', 'positive', 0.4, 20)),
        set('print.densityMasks.c', { ...dm('unsharp', 'same', 0.9, 50), enabled: false }),
        expo({ id: 'burn1', kind: 'burn', mask: 'sky', stops: 1 }),
        expo({ id: 'flash1', kind: 'flash', time_s: 0.2, through: 'base' })));
    },
  },

  // --- retouch (print-xyz, after view.adapt: the print cut is the base's, the display cut shows the spots)
  {
    id: 'neg-retouch-heal', fixture: 'negative', title: 'Heal the three white dust specks on the print (one spot disabled)', exercises: ['retouch.spots heal', 'enabled=false'],
    build: (c) => mut(c.ge, c.neg,
      set('retouch.spots.s1', spot('heal', 30.5, 31.5, 3, { x: 24.5, y: 31.5 })),
      set('retouch.spots.s2', spot('heal', 70.5, 51.5, 3, { x: 61.5, y: 56.5 })),
      set('retouch.spots.s3', spot('heal', 84.5, 9.5, 3, { x: 84.5, y: 15.5 })),
      set('retouch.spots.s4', spot('heal', 50, 10, 4, { x: 40, y: 10 }, { enabled: false }))),
  },
  {
    id: 'neg-retouch-clone', fixture: 'negative', title: 'Clone a patch onto another (feather 0.5, opacity 0.8)', exercises: ['retouch.spots clone', 'feather', 'opacity'],
    build: (c) => mut(c.ge, c.neg, set('retouch.spots.c1', spot('clone', 30, 32, 6, { x: 70, y: 32 }, { feather: 0.5, opacity: 0.8 }))),
  },

  // --- crop and orientation (output.frame, after the display transform)
  { id: 'neg-crop', fixture: 'negative', title: 'Crop to 72 × 52', exercises: ['view.frame.crop'], build: (c) => mut(c.ge, c.neg, set('view.frame.crop', { x: 10, y: 4, w: 72, h: 52 })) },
  { id: 'neg-orient-cw90-crop', fixture: 'negative', title: 'Crop, then rotate 90° clockwise', exercises: ['view.frame.orientation cw90', 'view.frame.crop'], build: (c) => mut(c.ge, c.neg, set('view.frame.crop', { x: 10, y: 4, w: 72, h: 52 }), set('view.frame.orientation', 'cw90')) },
  { id: 'neg-orient-flipH', fixture: 'negative', title: 'Mirror left-right', exercises: ['view.frame.orientation flipH'], build: (c) => mut(c.ge, c.neg, set('view.frame.orientation', 'flipH')) },
  { id: 'neg-orient-transverse', fixture: 'negative', title: 'Transverse (flip about the anti-diagonal)', exercises: ['view.frame.orientation transverse'], build: (c) => mut(c.ge, c.neg, set('view.frame.orientation', 'transverse')) },
  { id: 'neg-straighten', fixture: 'negative', title: 'Straighten 4° inside a crop, rotated 180°', exercises: ['view.frame.angle_deg', 'view.frame.crop', 'view.frame.orientation rot180'], build: (c) => mut(c.ge, c.neg, set('view.frame.crop', { x: 12, y: 8, w: 70, h: 48 }), set('view.frame.angle_deg', 4), set('view.frame.orientation', 'rot180')) },

  // --- scan and view settings that the stages around the darkroom carry
  { id: 'neg-scan-flare', fixture: 'negative', title: 'Scanner flare 1.5 % (per channel)', exercises: ['scan.flare'], build: (c) => mut(c.ge, c.neg, set('scan.flare', [1.5, 1.2, 1.0])) },
  { id: 'neg-scan-baseT', fixture: 'negative', title: 'The roll base as scan.baseT instead of the rebate box', exercises: ['scan.baseT'], build: (c) => mut(c.ge, c.neg, set('scan.baseT', [0.78, 0.49, 0.345])) },
  { id: 'neg-view-print-as-seen', fixture: 'negative', title: 'Rendering print-as-seen (viewing flare on), white D50, illuminant D65', exercises: ['view.output.rendering', 'view.output.white', 'view.illuminant', 'view.flare'], build: (c) => mut(c.ge, c.neg, set('view.output.rendering', 'print-as-seen'), set('view.output.white', 'D50'), set('view.illuminant', 'D65'), set('view.flare', 1)) },
  { id: 'neg-knee-clip', fixture: 'negative', title: 'Display knee: clip instead of OkLCh', exercises: ['view.output.display.knee.method'], build: (c) => mut(c.ge, mut(c.ge, c.neg, set('print.enlarger.time_s', c.neg.print.enlarger.time_s / 2)), set('view.output.display.knee.method', 'clip')) },

  // --- the camera file through the same darkroom
  { id: 'cam-exposure-plus1', fixture: 'camera', title: 'Capture exposure +1 EV', exercises: ['capture.exposureEV'], build: (c) => mut(c.ge, c.cam, set('capture.exposureEV', 1)) },
  { id: 'cam-wb-as-shot', fixture: 'camera', title: 'White balance as shot', exercises: ['capture.whiteBalance.mode as-shot'], build: (c) => mut(c.ge, c.cam, set('capture.whiteBalance.mode', 'as-shot')) },
  { id: 'cam-wb-custom', fixture: 'camera', title: 'White balance custom 4000 K, tint +10', exercises: ['capture.whiteBalance custom'], build: (c) => mut(c.ge, c.cam, set('capture.whiteBalance.mode', 'custom'), set('capture.whiteBalance.temperature_K', 4000), set('capture.whiteBalance.tint', 10)) },
  {
    id: 'cam-development', fixture: 'camera', title: 'Development: push +1, no grain, no halation, no DIR coupling', exercises: ['capture.development'],
    build: (c) => mut(c.ge, c.cam, set('capture.development.push', 1), set('capture.development.grain.amount', 0), set('capture.development.halation.strength', 0), set('capture.development.dir.amount', 0)),
  },
  { id: 'cam-grade-lights', fixture: 'camera', title: 'Grade 3.5 and lights −3 pt green', exercises: ['print.grade', 'print.lights.logH'], build: (c) => mut(c.ge, c.cam, set('print.grade', 3.5), set('print.lights.logH', c.cam.print.lights.logH.map((v, k) => Number((v + [0, -0.075, 0][k]!).toFixed(6))))) },
  {
    id: 'cam-exposures', fixture: 'camera', title: 'Burn through a gradient, dodge through an ellipse, open flash through paint', exercises: ['exposure:burn', 'exposure:dodge', 'exposure:flash open', 'mask.gradient', 'mask.ellipse', 'mask.paint'],
    build: (c) => {
      let r = withMask(c, c.cam, 'sky', editorMask(c, c.cam, { shapes: [gradientTop] }));
      r = withMask(c, r, 'face', editorMask(c, r, { shapes: [ellipseCentre], feather: 2 }));
      r = withMask(c, r, 'brush', editorMask(c, r, { shapes: strokes }));
      return mut(c.ge, r, expo({ id: 'burn1', kind: 'burn', mask: 'sky', stops: 1 }), expo({ id: 'dodge1', kind: 'dodge', mask: 'face', stops: 0.5 }), expo({ id: 'flash1', kind: 'flash', mask: 'brush', time_s: 0.4, through: 'open' }));
    },
  },
  { id: 'cam-dm-unsharp', fixture: 'camera', title: 'Unsharp mask on the camera file, γ 0.5, 30 µm, with preflash 2 %, re-metered', exercises: ['print.densityMasks unsharp positive', 'print.preflash'], build: (c) => c.ge.firstPrint(mut(c.ge, c.cam, set('print.densityMasks.u', dm('unsharp', 'positive', 0.5, 30)), set('print.preflash', 0.02))) },
  {
    id: 'cam-retouch', fixture: 'camera', title: 'Heal two dark sensor-dust spots and clone over the third', exercises: ['retouch.spots heal', 'retouch.spots clone'],
    build: (c) => mut(c.ge, c.cam,
      set('retouch.spots.s1', spot('heal', 30.5, 31.5, 3, { x: 24.5, y: 31.5 })),
      set('retouch.spots.s2', spot('heal', 70.5, 51.5, 3, { x: 61.5, y: 56.5 })),
      set('retouch.spots.s3', spot('clone', 84.5, 9.5, 3, { x: 84.5, y: 15.5 }, { feather: 0.6, opacity: 0.9 }))),
  },
  { id: 'cam-crop-ccw90', fixture: 'camera', title: 'Crop and rotate 90° counter-clockwise', exercises: ['view.frame.crop', 'view.frame.orientation ccw90'], build: (c) => mut(c.ge, c.cam, set('view.frame.crop', { x: 6, y: 0, w: 90, h: 60 }), set('view.frame.orientation', 'ccw90')) },

  // --- features the reference engine cannot render (stored as recipes only; see README)
  {
    id: 'neg-dust-heal', fixture: 'negative', title: 'Scan dust heal of the three specks (scan.heal)', exercises: ['scan.dust.spots', 'scan.dust.method'],
    skip: 'scan.heal is implemented by no physics engine (only engine-mock, as identity): neither RefEngine nor GpuEngine renders it',
    build: (c) => mut(c.ge, c.neg, set('scan.dust.spots', LAYOUT.specks.map((s, i) => ({ id: `d${i + 1}`, x: s.x, y: s.y, r: 2.5 })))),
  },
  {
    id: 'neg-finishing-clarity', fixture: 'negative', title: 'Finishing clarity +0.4, radius 12 px (finishing.clarity)', exercises: ['finishing.values.clarity', 'finishing.values.clarity_radius_px'],
    skip: 'finishing.clarity is implemented by no physics engine (only engine-mock): neither RefEngine nor GpuEngine renders it',
    build: (c) => mut(c.ge, c.neg, set('finishing.values.clarity', 0.4), set('finishing.values.clarity_radius_px', 12)),
  },
];
