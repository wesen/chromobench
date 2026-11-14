// The automatic first print (CHB-023 stage 2): a fresh scan opens as a sensible print. The frame is integrated
// to grey: the paper exposure x that print.lights hands print.develop is measured over the central 80 % of the
// frame. In real mode (the default; time and f-number expose the paper) its mean density goes into the enlarger
// time (on the slider's 1/6-stop grid) and the colour remainder into the printer lights. In normalised mode (a
// layout's choice, CHB-031) the time does nothing, so everything goes into the lights. Two passes, so a time
// model that is not exactly log-linear still lands.
// A photo (CHB-031 F31) is first-printed too, for its density only (half way from the camera's exposure to the
// integrated grey): its colour is the camera's as-shot white balance. FIRST_PRINT_AIM holds both kinds' aims.
// Contract-only: the integrate-to-grey arithmetic is core's (print/balance.ts), injected by the host.
// CHB-034 fusz: the frame is metered on its analysis image (studio-engine.ts ANALYSIS_LONG) when the engine's working
// image is larger, so the GPU engine (4000 px) and the CPU engine (640 px) meter the same picture and propose the same Time.
import { applyMutation, compile, defaultRecipe, Graph, type Box, type Engine, type FrameRecipe, type Mutation, type Node, type Vec3 } from '@chromobench/contract';
import type { AnalysisImage } from './studio-engine.ts';

/** Core's integrateToGrey with aim LATD 0 and aim lights 0: frame LATD (relative to the aim) → lights. */
export type IntegrateToGrey = (frameLatd: Vec3, alpha: number) => Vec3;

/**
 * A lab printer's subject-failure rule (CHB-031 F30): the pixels the integration leaves out, so that a large area
 * of one strong colour (brick, grass, sky) or extreme pixels (specular highlights, deep shadows) do not pull the
 * grey. Measured under the current lights of each pass, so a later pass judges colour on the corrected print.
 */
export interface SubjectFailure {
  /** Leave out pixels whose colour, max_k |x_k − mean(x)| in log H, is above this (a strong colour). */
  chroma?: number;
  /** Leave out this fraction of the darkest and the same of the brightest pixels (by mean log H). */
  trim?: number;
}

/**
 * The first print's aim for one kind of frame (CHB-031 F30, F31): how much of the frame's density and of its colour
 * the first print corrects, and which pixels it reads.
 */
export interface FirstPrintAim {
  /**
   * Density correction share: 1 = the frame's integrated exposure prints at the aim (a negative: its exposure on
   * film says little); less keeps that share of the exposure the frame came with (a photo: the camera's metering).
   */
  density: number;
  /** Colour correction share: 1 = the frame averages to grey; 0 = the colour stays as it is. */
  alpha: number;
  /** The subject-failure rule, or null: every pixel of the central 80 % counts. */
  subjectFailure: SubjectFailure | null;
}

/** The subject-failure rule `?subjectFailure=1` turns on (and the comparison script's variant). */
export const LAB_SUBJECT_FAILURE: Readonly<SubjectFailure> = { chroma: 0.1, trim: 0.02 };

/**
 * THE setting: the first print's aim per kind of frame (one place; main.ts and the scripts read it).
 * - A negative integrates the whole frame to grey (density and alpha 1, no subject-failure rule). The owner's
 *   decision on its colour is pending (F30: Negative Lab Pro prints his Epson scans warmer and more saturated; the
 *   numbers for other alphas and for LAB_SUBJECT_FAILURE are in CHB-031 diary 04). Try another aim with
 *   ?alpha=0.75&subjectFailure=1.
 * - A photo keeps the camera's as-shot white balance as its colour (alpha 0) and moves half way from the camera's
 *   exposure to the frame's integrated grey (density 0.5): a camera has metered the scene already, and the full
 *   integration prints large shadows and night scenes too light (a lab printer's density failure; diary 04, F31).
 *   Try another share with ?photoDensity=1.
 */
export const FIRST_PRINT_AIM: Readonly<Record<FrameRecipe['kind'], Readonly<FirstPrintAim>>> = {
  'negative-scan': { density: 1, alpha: 1, subjectFailure: null },
  'digital-raw': { density: 0.5, alpha: 0, subjectFailure: null },
};

/**
 * The aim for `kind`, with the page's overrides: for a negative `alpha` (0…1) and `subjectFailure` (`1` for
 * LAB_SUBJECT_FAILURE, `0` for none, or `chroma:0.12,trim:0.01`); for a photo `photoDensity` (0…1). A photo's colour
 * stays the camera's.
 */
export function firstPrintAim(kind: FrameRecipe['kind'], param: (k: string) => string | null = () => null): FirstPrintAim {
  const aim = { ...FIRST_PRINT_AIM[kind] };
  const share = (k: string): number | null => {
    const v = Number(param(k) ?? NaN);
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null;
  };
  if (kind !== 'negative-scan') {
    aim.density = share('photoDensity') ?? aim.density;
    return aim;
  }
  aim.alpha = share('alpha') ?? aim.alpha;
  const sf = param('subjectFailure');
  if (sf === '0') aim.subjectFailure = null;
  else if (sf === '1') aim.subjectFailure = { ...LAB_SUBJECT_FAILURE };
  else if (sf) {
    const rule: SubjectFailure = {};
    for (const [k, v] of sf.split(',').map((p) => p.split(':'))) {
      const n = Number(v);
      if ((k === 'chroma' || k === 'trim') && Number.isFinite(n) && n >= 0) rule[k] = n;
    }
    aim.subjectFailure = Object.keys(rule).length ? rule : null;
  }
  return aim;
}

/**
 * A photo's first recipe before its first print (CHB-012, F31): the frame's id and source, shot on the default film,
 * as-shot white balance when the camera recorded one, in the enlarger mode of `d` (the layout's).
 */
export function photoRecipe(d: FrameRecipe, asShot: boolean): FrameRecipe {
  const { decode, ...src } = d.source;
  const r = defaultRecipe('digital-raw', src, { frame: d.frame, decode: { ...decode, mode: 'photo' } });
  if (asShot) r.capture!.whiteBalance.mode = 'as-shot';
  return { ...r, print: { ...r.print, enlarger: { ...r.print.enlarger, mode: d.print.enlarger.mode } } };
}

export interface FirstPrintOptions {
  integrate: IntegrateToGrey;
  /** The colour aim (default FIRST_PRINT_AIM of the recipe's kind). */
  aim?: Partial<FirstPrintAim>;
  /** Pixels analysed (default 200 000). */
  analysisPixels?: number;
  /** Passes (default 2; 3 with a subject-failure rule, which picks its pixels on the corrected print). */
  passes?: number;
  /**
   * CHB-010 filtration: the dials that carry the first print's lights (core's bakeRecipe, injected by the host).
   * The colour correction then sits in print.enlarger.filtration and the time, the lights go to what the dials
   * cannot carry. Off by default: a roll's analysis and batches work in lights, with the pack as a roll setting.
   */
  bake?: (r: FrameRecipe) => Mutation[];
  /**
   * The image to meter (CHB-034 fusz; StudioEngine.analysisOf): the source's analysis image, registered with the
   * engine; null or absent: the recipe's own source (the working image is the analysis image).
   */
  analysis?: AnalysisImage | null;
}

const r6 = (x: number): number => Number(x.toFixed(6));

/** A subject-failure rule keeps at least this share of the pixels; with fewer the whole frame counts. */
const MIN_KEPT = 0.05;

/** Which pixels a subject-failure rule keeps (all finite pixels without one, or when it would keep too few). */
function keptPixels(x: ArrayLike<number>, n: number, stride: number, sf: SubjectFailure | null | undefined): Uint8Array {
  const keep = new Uint8Array(n);
  const mean = new Float64Array(n);
  let finite = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i * stride]!, b = x[i * stride + 1]!, c = x[i * stride + 2]!;
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) continue;
    keep[i] = 1;
    mean[i] = (a + b + c) / 3;
    finite++;
  }
  if (!sf || !finite) return keep;
  const out = keep.slice();
  if (sf.trim && sf.trim > 0) {
    const m = Float64Array.from({ length: finite }, () => 0);
    let j = 0;
    for (let i = 0; i < n; i++) if (keep[i]) m[j++] = mean[i]!;
    m.sort();
    const lo = m[Math.min(finite - 1, Math.floor(sf.trim * finite))]!, hi = m[Math.max(0, Math.ceil((1 - sf.trim) * finite) - 1)]!;
    for (let i = 0; i < n; i++) if (out[i] && (mean[i]! < lo || mean[i]! > hi)) out[i] = 0;
  }
  if (sf.chroma !== undefined) {
    for (let i = 0; i < n; i++) {
      if (!out[i]) continue;
      const c = Math.max(Math.abs(x[i * stride]! - mean[i]!), Math.abs(x[i * stride + 1]! - mean[i]!), Math.abs(x[i * stride + 2]! - mean[i]!));
      if (c > sf.chroma) out[i] = 0;
    }
  }
  let kept = 0;
  for (let i = 0; i < n; i++) kept += out[i]!;
  return kept >= MIN_KEPT * finite ? out : keep;
}

/**
 * log10 of the mean of 10^x per channel (the frame's integrated paper exposure, relative to the aim), over the
 * pixels a subject-failure rule keeps (all of them without one).
 */
export function integratedExposure(x: ArrayLike<number>, n: number, stride = 3, sf?: SubjectFailure | null): Vec3 {
  const keep = keptPixels(x, n, stride, sf);
  const T = [0, 0, 0];
  let m = 0;
  for (let i = 0; i < n; i++) {
    if (!keep[i]) continue;
    const a = x[i * stride]!, b = x[i * stride + 1]!, c = x[i * stride + 2]!;
    // Clamp: open gate, sprocket holes or rebate must not swamp the average.
    T[0]! += 10 ** Math.min(2, Math.max(-3, a));
    T[1]! += 10 ** Math.min(2, Math.max(-3, b));
    T[2]! += 10 ** Math.min(2, Math.max(-3, c));
    m++;
  }
  return T.map((t) => Math.log10(Math.max(t, 1e-12) / Math.max(m, 1))) as Vec3;
}

/** Time on the time slider's grid: 10 s · 2^(k/6), clamped to 2…120 s. */
export function gridTime(t: number): number {
  const k = Math.min(Math.floor(6 * Math.log2(12)), Math.max(Math.ceil(6 * Math.log2(0.2)), Math.round(6 * Math.log2(t / 10))));
  return Number((10 * 2 ** (k / 6)).toFixed(3));
}

function lightsNode(r: FrameRecipe, g: Graph): Node {
  const top = compile(r, g);
  const def = g.closure(top.id).find((d) => d.op === 'print.lights');
  if (!def) throw new Error('no print.lights node in the display chain');
  return g.adopt([def])[0]!;
}

/** A box in working-image px → analysis-image px (kx, ky ≤ 1), kept inside its old edges (as decode.ts scaleBox). */
function scaleBox(b: Box, kx: number, ky: number): Box {
  const x = Math.ceil(b.x * kx), y = Math.ceil(b.y * ky);
  return { x, y, w: Math.max(1, Math.floor((b.x + b.w) * kx) - x), h: Math.max(1, Math.floor((b.y + b.h) * ky) - y) };
}

/**
 * The recipe on the analysis image (CHB-034 fusz): its source, and the boxes a recipe has when it is first printed
 * (a strip frame's crop, the measured rebate, an open-gate box) in the analysis image's px. A strip frame's crop is
 * its frame as found on the analysis image (as the decode at that size finds it), else the crop scaled. Retouch
 * spots, masks and probes come later (a first print never has them) and are left as they are.
 */
export function onAnalysis(r: FrameRecipe, a: AnalysisImage): FrameRecipe {
  const box = (b: Box): Box => scaleBox(b, a.kx, a.ky);
  const same = (p: Box, q: Box): boolean => p.x === q.x && p.y === q.y && p.w === q.w && p.h === q.h;
  const crop = r.view.frame.crop;
  const out: FrameRecipe = { ...r, source: { ...r.source, sha256: a.info.sha256 } };
  if (crop) {
    const i = a.frames ? a.frames.working.findIndex((b) => same(b, crop)) : -1;
    out.view = { ...r.view, frame: { ...r.view.frame, crop: i >= 0 ? { ...a.frames!.analysis[i]! } : box(crop) } };
  }
  if (r.scan) {
    const { rebate, openGate } = r.scan;
    out.scan = { ...r.scan, rebate: rebate ? box(rebate) : rebate, openGate: openGate && openGate !== 'flat' ? box(openGate) : openGate };
  }
  return out;
}

/** Measures the frame's integrated exposure (relative to the aim) under recipe r, over the pixels `sf` keeps. */
export async function measureExposure(engine: Engine, g: Graph, r: FrameRecipe, analysisPixels = 200_000, sf?: SubjectFailure | null): Promise<Vec3> {
  const n = lightsNode(r, g);
  engine.adopt(g.closure(n.id));
  const info = n.info as { width: number; height: number };
  // the central 80 % of the frame: of its crop when it has one (a frame of a strip, CHB-027 WS-D), else of the source
  const c = r.view.frame?.crop ?? { x: 0, y: 0, w: info.width, h: info.height };
  const box = { x: c.x + Math.round(c.w * 0.1), y: c.y + Math.round(c.h * 0.1), w: Math.max(1, Math.round(c.w * 0.8)), h: Math.max(1, Math.round(c.h * 0.8)) };
  const scale = Math.min(1, Math.sqrt(analysisPixels / (box.w * box.h)));
  const res = await engine.evaluate(n, { scale: scale >= 1 ? 'full' : Math.max(1e-3, Number(scale.toFixed(4))), precision: 'preview', region: box });
  return integratedExposure(await res.read(), res.width * res.height, res.info.channels, sf);
}

/**
 * The first print of a frame in the recipe's enlarger mode (real by default since contract 0.4; CHB-031), integrated
 * to grey with the aim of its kind (FIRST_PRINT_AIM: a negative to grey, a photo half way in density, its colour as shot), the auto
 * proposal recorded in print.lights.auto. Since CHB-010 the aim is fitted once, at calibration, so in real mode
 * time, f-number and the filtration shift move the print as at an enlarger.
 */
export async function firstPrint(engine: Engine, g: Graph, recipe: FrameRecipe, o: FirstPrintOptions): Promise<FrameRecipe> {
  const aim: FirstPrintAim = { ...FIRST_PRINT_AIM[recipe.kind], ...o.aim };
  const { alpha, density } = aim;
  const N = o.analysisPixels ?? 200_000;
  let r: FrameRecipe = recipe;
  const real = r.print.enlarger.mode === 'real';
  const lights0 = [...r.print.lights.logH] as Vec3;
  const t0 = r.print.enlarger.time_s;
  let lights = lights0;
  let t = t0;
  // the analysis image (CHB-034 fusz): its own graph, the recipe moved onto it for each measurement
  const ag = o.analysis ? new Graph() : g;
  if (o.analysis) ag.registerSource(o.analysis.info);
  for (let pass = 0; pass < (o.passes ?? (aim.subjectFailure ? 3 : 2)); pass++) {
    const delta = await measureExposure(engine, ag, o.analysis ? onAnalysis(r, o.analysis) : r, N, aim.subjectFailure);
    // the exposure moved so far (lights and time) and the frame's own departure from the aim at the start: each pass
    // re-aims from the start, so alpha is the colour share however many passes refine it (not 1 − (1 − α)^passes)
    const off = lights.map((l, k) => l - lights0[k]! + Math.log10(t / t0)) as Vec3;
    const D0 = delta.map((v, k) => v - off[k]!) as Vec3;
    // core's integrate-to-grey (the mean in full, the colour by alpha), less the share of the density kept
    const kept = ((1 - density) * (D0[0] + D0[1] + D0[2])) / 3;
    const want = o.integrate(D0.map((v) => -v) as Vec3, alpha).map((w) => w + kept) as Vec3;
    const total = lights0.map((l, k) => l + want[k]!) as Vec3;
    // real: density (the mean) into the time, as at an enlarger; the colour remainder stays in the lights.
    // normalised: the time does nothing; density and colour both stay in the lights
    const m = (total[0] + total[1] + total[2]) / 3;
    const t2 = real ? gridTime(t0 * 10 ** m) : t0;
    const moved = Math.log10(t2 / t0); // log H moved into the time
    lights = total.map((l) => r6(l - moved)) as Vec3;
    t = t2;
    r = { ...r, print: { ...r.print, enlarger: { ...r.print.enlarger, time_s: t }, lights: { ...r.print.lights, logH: lights } } };
  }
  const out: FrameRecipe = {
    ...r,
    print: {
      ...r.print,
      lights: {
        logH: lights,
        auto: { ...r.print.lights.auto, method: 'integrate', alpha, analysisLongSide_px: Math.round(Math.sqrt(N * 1.5)), applied: true, logH: lights },
      },
    },
  };
  // the auto record keeps the proposal in lights (what was measured); the dials carry it
  return o.bake ? o.bake(out).reduce((x, m) => applyMutation(x, m).recipe, out) : out;
}

/** The new recipe with the measured rebate box (CHB-020) as its scan base; no box leaves scan.density's own rule. */
export function withRebate(recipe: FrameRecipe, rebate: Box | null | undefined): FrameRecipe {
  return rebate && recipe.scan ? { ...recipe, scan: { ...recipe.scan, rebate } } : recipe;
}

/** What the host measured at decode (conditionScan), for the new recipe's scan settings (contract 0.3). */
export interface MeasuredScan {
  rebate?: Box | null;
  /** scan.flare, percent per channel, from the holder's veil */
  flare?: Vec3 | null;
  /** scan.baseT: the flare-corrected base */
  baseT?: Vec3 | null;
}

/** The recipe with the measured scan settings: rebate box, per-channel flare and base. Nothing measured leaves the default. */
export function withMeasured(recipe: FrameRecipe, m: MeasuredScan | null | undefined): FrameRecipe {
  if (!m || !recipe.scan) return recipe;
  const scan = { ...recipe.scan };
  if (m.rebate) scan.rebate = m.rebate;
  if (m.flare && m.flare.some((f) => f > 0)) scan.flare = [...m.flare] as Vec3;
  if (m.baseT) scan.baseT = [...m.baseT] as Vec3;
  return { ...recipe, scan };
}
