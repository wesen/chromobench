// roll.analyse (guide §4.2, §6.3): a pass over a roll's frames that measures, per frame, the film layout
// (veil, open gate, image area, rebate), σ and class shares at the analysis size, and the integrated exposure
// under the frame's own rebate; then, per roll, the base (median of confident rebates, spread, mixed frames),
// the veil, the stock ranking and the roll's mean auto lights. It never writes documents.
import { canonicalJSON, set } from '@chromobench/values';
import { documentKind, edit, type Box, type Diagnostic, type Document, type Engine, type Graph, type Vec3 } from '@chromobench/contract';
import { read, withEnlargerMode } from '../../../../src/model/doc.ts';
import { ALPHA, ANALYSIS_LONG, STOCK_AMBIGUOUS_D, UNDER_BLANK } from './constants.ts';
import { totalOf } from './lower.ts';
import { measureExposure, readSource, type Pixels } from './measure.ts';
import { meanVec, r6v, type FrameAnalysis, type FrameBaseLike, type FrameId, type RollAnalysis, type RollPhysics } from './model.ts';

export interface AnalyseEntry {
  id: FrameId;
  sha256: string;
  graph: Graph;
  doc: Document;
}

export interface AnalyseOptions {
  long?: number;
  alpha?: number;
  rejected?: ReadonlySet<FrameId>;
  /** subtract the veil read on the holder before σ and classes (default true) */
  veil?: boolean;
  stocks?: string[];
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, frame: FrameId) => void;
  now?: () => number;
}

const scaleBox = (b: Box, s: number, W: number, H: number): Box => {
  const x0 = Math.max(0, Math.floor(b.x * s)), y0 = Math.max(0, Math.floor(b.y * s));
  const x1 = Math.min(W, Math.ceil((b.x + b.w) * s)), y1 = Math.min(H, Math.ceil((b.y + b.h) * s));
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
};
const toSource = (b: Box, s: number): Box => (s === 1 ? { ...b } : { x: Math.ceil(b.x / s), y: Math.ceil(b.y / s), w: Math.max(1, Math.floor(b.w / s)), h: Math.max(1, Math.floor(b.h / s)) });

function boxMean(rgb: Float32Array, w: number, b: Box): Vec3 {
  const a = [0, 0, 0];
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) for (let k = 0; k < 3; k++) a[k]! += rgb[(y * w + x) * 3 + k]!;
  return a.map((v) => v / (b.w * b.h)) as Vec3;
}
function sub(rgb: Float32Array, w: number, b: Box): Float32Array {
  const out = new Float32Array(b.w * b.h * 3);
  for (let y = 0; y < b.h; y++) out.set(rgb.subarray(((b.y + y) * w + b.x) * 3, ((b.y + y) * w + b.x + b.w) * 3), y * b.w * 3);
  return out;
}

export type PixelAnalysis = Omit<FrameAnalysis, 'latd' | 'auto' | 'under' | 'id' | 'sha256'>;

/**
 * The pixel half of a frame's analysis, on its source at the analysis size. A rebate or crop the photographer
 * picked (scan.rebate, view.frame.crop, source px) wins over the search.
 */
export function analysePixels(px: Pixels, recipe: Document | null, physics: RollPhysics, o: { veil?: boolean; conditionedVeil?: Vec3 | null } = {}): PixelAnalysis {
  const { rgb, w, h, scale } = px;
  const lay = physics.layout(rgb, w, h);
  const useVeil = o.veil !== false;
  const veil: Vec3 = useVeil && lay.surround ? lay.surround.L : [0, 0, 0];
  const picked = recipe ? (read(recipe, 'stages.scan.medium.rebate') as Box | null | undefined) : null;
  const pickedCrop = recipe ? (read(recipe, 'geometry.crop') as Box | null | undefined) : null;
  let rebate: FrameAnalysis['layout']['rebate'] = null;
  let rebateA: Box | null = null;
  if (picked) {
    rebateA = scaleBox(picked, scale, w, h);
    const T = boxMean(rgb, w, rebateA).map((t, k) => Math.max(1e-6, t - veil[k]!)) as Vec3;
    rebate = { T, box: picked, from: 'edge', confidence: 1, spreadD: 0 };
  } else if (lay.rebate) {
    rebateA = lay.rebate.box;
    const T = useVeil ? lay.rebate.T : lay.rebate.Traw;
    rebate = { T, box: toSource(lay.rebate.box, scale), from: lay.rebate.from, confidence: lay.rebate.confidence, spreadD: lay.rebate.spreadD };
  }
  const cropA = pickedCrop ? scaleBox(pickedCrop, scale, w, h) : lay.crop;
  // σ and classes on veil-corrected pixels, at this size (σ depends on it: the analysis size is reported with it)
  let cond = rgb;
  if (veil.some((v) => v !== 0)) {
    cond = Float32Array.from(rgb);
    for (let i = 0; i < w * h; i++) for (let k = 0; k < 3; k++) cond[i * 3 + k] = Math.max(1e-6, cond[i * 3 + k]! - veil[k]!);
  }
  let sigma: Vec3 | null = null;
  let classes: FrameAnalysis['classes'] = null;
  if (rebate) {
    sigma = physics.noise?.(cond, w, h, rebate.T, rebateA) ?? null;
    if (sigma && physics.classes) {
      const c = cropA ?? { x: 0, y: 0, w, h };
      classes = physics.classes(sub(cond, w, c), c.w, c.h, rebate.T, sigma);
    }
  }
  const size: [number, number] = cropA ? [cropA.w, cropA.h] : [w, h];
  return {
    size, scale,
    layout: {
      rebate,
      veil: o.conditionedVeil ?? (lay.surround ? lay.surround.L : null),
      openGate: lay.openGate?.T ?? null,
      crop: cropA ? (pickedCrop ?? toSource(cropA, scale)) : null,
      notes: lay.notes.map((n) => n.code),
    },
    sigma, classes,
    hint: classes && classes.blank > UNDER_BLANK ? 'under' : null,
  };
}

/** A frame's analysis: pixels, then the integrated exposure under its own rebate box and a real enlarger. */
export async function analyseFrame(engine: Engine, e: AnalyseEntry, physics: RollPhysics, o: AnalyseOptions = {}): Promise<FrameAnalysis> {
  const long = o.long ?? ANALYSIS_LONG;
  const px = await readSource(engine, e.graph, e.doc, long, o.signal);
  const cond = physics.conditioned?.(e.sha256) ?? null;
  const p = analysePixels(px, e.doc, physics, { ...(o.veil !== undefined ? { veil: o.veil } : {}), conditionedVeil: cond?.veil ?? null });
  let r: Document = withEnlargerMode(e.doc, 'real');
  if (documentKind(r) === 'negative-scan' && !read(r, 'stages.scan.medium.rebate') && p.layout.rebate) r = edit(r, [set('stages.scan.medium.rebate', p.layout.rebate.box)]).doc;
  const X = await measureExposure(engine, e.graph, r, { area: p.layout.crop, ...(o.signal ? { signal: o.signal } : {}) });
  const t = totalOf(r);
  const latd = r6v(X.map((x, k) => -(x - t[k]!)));
  const auto = r6v(physics.integrateToGrey(latd, { latd: [0, 0, 0], lights: [0, 0, 0] }, o.alpha ?? ALPHA));
  const under = canonicalJSON({ stock: read(r, 'stages.scan.medium.stock') ?? null, scanner: read(r, 'stages.scan.medium.scanner') ?? null, rebate: read(r, 'stages.scan.medium.rebate') ?? null, crop: r.geometry.crop ?? null, long });
  return { id: e.id, sha256: e.sha256, ...p, latd, auto, under };
}

/** The roll level: base, veil, ranking, mean auto lights, diagnostics. */
export function summarise(frames: Record<FrameId, FrameAnalysis>, order: readonly FrameId[], physics: RollPhysics, o: { long: number; alpha: number; at: number; rejected?: ReadonlySet<FrameId>; stocks?: string[] }): RollAnalysis {
  const list = order.map((f) => frames[f]).filter((x): x is FrameAnalysis => !!x);
  const bases: FrameBaseLike[] = list.map((f) => ({
    id: f.id, T: f.layout.rebate?.T ?? null, confidence: f.layout.rebate?.confidence ?? 0, veil: f.layout.veil, openGate: f.layout.openGate,
    ...(f.layout.rebate ? { from: f.layout.rebate.from } : {}),
  }));
  const base = physics.rollBase(bases);
  const diagnostics: Diagnostic[] = [...base.notes];
  const ranking = physics.rank?.(base, o.stocks) ?? null;
  if (ranking && ranking.length >= 2) {
    const metric = (x: (typeof ranking)[number]): number => (base.absD ? x.maxDiffD : x.shapeDiffD);
    const gap = metric(ranking[1]!) - metric(ranking[0]!);
    if (gap < STOCK_AMBIGUOUS_D)
      diagnostics.push({ code: 'W_ROLL_STOCK_AMBIGUOUS', message: `${ranking[0]!.stock} and ${ranking[1]!.stock} fit the base within ${gap.toFixed(3)} D${base.absD ? '' : ' (by shape only: no open gate)'}: the scan cannot tell them apart. Name the stock.` });
  }
  const blank = list.filter((f) => f.layout.rebate?.from === 'blank').map((f) => f.id);
  if (blank.length) diagnostics.push({ code: 'CB-R110', message: `No film edge on ${blank.join(', ')}: their base was read on blank film inside the frame; the roll base is safer.` });
  const under = list.filter((f) => f.hint === 'under').map((f) => f.id);
  if (under.length) diagnostics.push({ code: 'CB-R111', message: `Probable under-exposure (more than ${UNDER_BLANK * 100} % blank film at ${o.long} px): ${under.join(', ')}.` });
  const autos = list.filter((f) => !o.rejected?.has(f.id)).map((f) => f.auto);
  return { at: o.at, long: o.long, alpha: o.alpha, frames, base, ranking, rollMean: autos.length >= 2 ? r6v(meanVec(autos)!) : null, diagnostics };
}

export async function analyseRoll(engine: Engine, entries: readonly AnalyseEntry[], physics: RollPhysics, o: AnalyseOptions = {}): Promise<RollAnalysis> {
  const frames: Record<FrameId, FrameAnalysis> = {};
  let done = 0;
  for (const e of entries) {
    if (o.signal?.aborted) throw new DOMException('roll analysis aborted', 'AbortError');
    frames[e.id] = await analyseFrame(engine, e, physics, o);
    o.onProgress?.(++done, entries.length, e.id);
  }
  return summarise(frames, entries.map((e) => e.id), physics, {
    long: o.long ?? ANALYSIS_LONG, alpha: o.alpha ?? ALPHA, at: (o.now ?? Date.now)(),
    ...(o.rejected ? { rejected: o.rejected } : {}), ...(o.stocks ? { stocks: o.stocks } : {}),
  });
}
