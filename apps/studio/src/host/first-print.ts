// The automatic first print (CHB-023 stage 2): a fresh scan opens as a sensible print. The enlarger is
// set to 'real' (time and f-number expose the paper), then the frame is integrated to grey: the paper
// exposure x that print.lights hands print.develop is measured over the central 80 % of the frame, its
// mean density goes into the enlarger time (on the slider's 1/6-stop grid) and the colour remainder
// into the printer lights. Two passes, so a time model that is not exactly log-linear still lands.
// Contract-only: the integrate-to-grey arithmetic is core's (print/balance.ts), injected by the host.
import { applyMutation, compile, type Box, type Engine, type FrameRecipe, type Graph, type Mutation, type Node, type Vec3 } from '@chromobench/contract';

/** Core's integrateToGrey with aim LATD 0 and aim lights 0: frame LATD (relative to the aim) → lights. */
export type IntegrateToGrey = (frameLatd: Vec3, alpha: number) => Vec3;

export interface FirstPrintOptions {
  integrate: IntegrateToGrey;
  /** Colour correction share (1 = the frame averages to grey). */
  alpha?: number;
  /** Pixels analysed (default 200 000). */
  analysisPixels?: number;
  passes?: number;
  /**
   * CHB-010 filtration: the dials that carry the first print's lights (core's bakeRecipe, injected by the host).
   * The colour correction then sits in print.enlarger.filtration and the time, the lights go to what the dials
   * cannot carry. Off by default: a roll's analysis and batches work in lights, with the pack as a roll setting.
   */
  bake?: (r: FrameRecipe) => Mutation[];
}

const r6 = (x: number): number => Number(x.toFixed(6));

/** log10 of the mean of 10^x per channel (the frame's integrated paper exposure, relative to the aim). */
export function integratedExposure(x: ArrayLike<number>, n: number, stride = 3): Vec3 {
  const T = [0, 0, 0];
  let m = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i * stride]!, b = x[i * stride + 1]!, c = x[i * stride + 2]!;
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) continue;
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

/** Measures the frame's integrated exposure (relative to the aim) under recipe r. */
export async function measureExposure(engine: Engine, g: Graph, r: FrameRecipe, analysisPixels = 200_000): Promise<Vec3> {
  const n = lightsNode(r, g);
  engine.adopt(g.closure(n.id));
  const info = n.info as { width: number; height: number };
  const box = { x: Math.round(info.width * 0.1), y: Math.round(info.height * 0.1), w: Math.max(1, Math.round(info.width * 0.8)), h: Math.max(1, Math.round(info.height * 0.8)) };
  const scale = Math.min(1, Math.sqrt(analysisPixels / (box.w * box.h)));
  const res = await engine.evaluate(n, { scale: scale >= 1 ? 'full' : Math.max(1e-3, Number(scale.toFixed(4))), precision: 'preview', region: box });
  return integratedExposure(await res.read(), res.width * res.height, res.info.channels);
}

/** The first print of a frame: enlarger 'real', integrated to grey, the auto proposal recorded in print.lights.auto. */
export async function firstPrint(engine: Engine, g: Graph, recipe: FrameRecipe, o: FirstPrintOptions): Promise<FrameRecipe> {
  const alpha = o.alpha ?? 1;
  const N = o.analysisPixels ?? 200_000;
  // 'real' (set explicitly: contract request C4 on the default is open). Since CHB-010 the aim is fitted
  // once, at calibration, so time, f-number and the filtration shift move the print as at an enlarger.
  let r: FrameRecipe = { ...recipe, print: { ...recipe.print, enlarger: { ...recipe.print.enlarger, mode: 'real' } } };
  let lights = [...r.print.lights.logH] as Vec3;
  let t = r.print.enlarger.time_s;
  for (let pass = 0; pass < (o.passes ?? 2); pass++) {
    const delta = await measureExposure(engine, g, r, N);
    const add = o.integrate(delta.map((v) => -v) as Vec3, alpha);
    const total = lights.map((l, k) => l + add[k]!) as Vec3;
    // density (the mean) into the time, as at an enlarger; the colour remainder stays in the lights
    const m = (total[0] + total[1] + total[2]) / 3;
    const t2 = gridTime(t * 10 ** m);
    const moved = Math.log10(t2 / t); // log H moved into the time
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
