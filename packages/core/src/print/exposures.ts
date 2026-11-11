// Multi-exposure printing (CHB-010 guide §6.5): dodge, burn, split filtration and flash add light on
// the paper before the paper responds, so exposures sum in linear H and the log is taken once.
//
// The graph form (contract compile()): every enabled extra exposure is its own print.expose node
// (its seconds, its pack) and print.combine sums them on the main exposure with one mask each,
// mode 'add' (burn, split, flash) or 'subtract' (dodge). combinePixel is that sum per pixel, shared
// by the reference engine and (as WGSL) packages/gpu.
import { fail, type Cmy, type Diagnostic, type Exposure, type FrameRecipe } from '@chromobench/contract';

/** Lowest paper exposure a combined pixel keeps (x = −8: paper white). */
export const H_FLOOR = 1e-8;

export interface CombineTerm {
  /** Paper log exposure of the extra exposure at this pixel (per layer). */
  x: ArrayLike<number>;
  /** Mask value in 0..1. */
  m: number;
  /** +1 adds light (burn, split, flash), −1 withholds it (dodge). */
  sign: 1 | -1;
  /** Seconds ratio applied to 10^x (1 in real mode; t_i / t_main in normalised mode, see combineRatio). */
  ratio: number;
}

/**
 * H_k = max(10^x_main,k − Σ_dodge r·m·10^x_i,k, 0) + Σ_add r·m·10^x_i,k ;  x_k = log10 max(H_k, H_FLOOR).
 * Dodges hold back main light, so they come off the main exposure and are clamped there (you cannot hold
 * back more light than the main exposure gives; guide §6.5 W_DODGE_EXCEEDS_MAIN). Returns whether the
 * clamp engaged in any layer.
 */
export function combinePixel(xMain: ArrayLike<number>, terms: readonly CombineTerm[], out: Float64Array | number[]): boolean {
  let clamped = false;
  for (let k = 0; k < 3; k++) {
    let H = 10 ** xMain[k]!;
    for (const t of terms) if (t.sign < 0) H -= t.ratio * t.m * 10 ** t.x[k]!;
    if (H < 0) {
      // a rounding-level excess (a dodge of exactly the main exposure) is not a user error
      if (H < -1e-9 * 10 ** xMain[k]!) clamped = true;
      H = 0;
    }
    for (const t of terms) if (t.sign > 0) H += t.ratio * t.m * 10 ** t.x[k]!;
    out[k] = Math.log10(Math.max(H, H_FLOOR));
  }
  return clamped;
}

/** The print.expose arguments combineRatio reads (a node's args, or ExposeSettings). */
export interface ExposeArgsLike { mode?: unknown; time_s?: unknown }

/**
 * Seconds ratio of an extra exposure. In real mode print.expose already carries its time in x (the
 * optics offset), so the ratio is 1. In normalised mode print.expose ignores time (the grey card always
 * prints at the aim), so a burn of t_i seconds on a t_main main exposure is weighted t_i / t_main here.
 * Without an upstream main print.expose (or when the extra image is not a print.expose) the ratio is 1.
 */
export function combineRatio(main: ExposeArgsLike | undefined, extra: ExposeArgsLike | undefined): number {
  if (!main || !extra || extra.mode !== 'normalised') return 1;
  const tm = Number(main.time_s), te = Number(extra.time_s);
  return tm > 0 && te > 0 ? te / tm : 1;
}

// ---- Exposure semantics (recipe → seconds), the rule compile() applies --------------------------

export interface CompiledExposure {
  id: string;
  kind: Exposure['kind'];
  /** Seconds of light (after `stops`, before the 0.1 s floor of print.expose). */
  seconds: number;
  /** The exposure's pack as a shift on the database neutral (its own, or the main pack). */
  filtration: Cmy;
  mask: string | null;
  sign: 1 | -1;
}

/**
 * Seconds of an extra exposure: `time_s` when given; else from `stops` relative to the main time
 * (burn, split, flash: t_main·(2^s − 1); dodge: t_main·(1 − 2^−s)); else the main time.
 */
export function exposureSeconds(ex: Pick<Exposure, 'kind' | 'time_s' | 'stops'>, tMain: number): number {
  if (ex.time_s !== null) return ex.time_s;
  if (ex.stops === null) return tMain;
  return ex.kind === 'dodge' ? tMain * (1 - 2 ** -ex.stops) : tMain * (2 ** ex.stops - 1);
}

/** Most distinct packs a frame may use (each is a printing-density table on the GPU, guide §6.5). */
export const MAX_PACKS = 4;

const packKey = (c: Cmy): string => `${c.c},${c.m},${c.y}`;

/**
 * The enabled exposures of a recipe with their seconds, packs and signs, plus diagnostics: a dodge with
 * its own filtration is refused (E_RECIPE: dodging withholds main light, it cannot change the filter),
 * more than MAX_PACKS distinct packs is E_TOO_MANY_PACKS, a flash `through: 'base'` is noted as not yet
 * modelled (contract request C6: compile exposes the flash through the negative).
 */
export function compileExposures(print: FrameRecipe['print'], masks: FrameRecipe['masks'] = {}): { exposures: CompiledExposure[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const e = print.enlarger;
  const packs = new Set([packKey(e.filtration)]);
  const exposures: CompiledExposure[] = [];
  for (const ex of print.exposures) {
    if (!ex.enabled) continue;
    if (ex.kind === 'dodge' && ex.filtration !== null) fail('E_RECIPE', `exposure ${ex.id}: a dodge cannot carry a filtration`, { path: `print.exposures.${ex.id}.filtration`, hint: 'dodging withholds main light; burn through another pack instead' });
    if (ex.mask !== null && !(ex.mask in masks)) fail('E_RECIPE', `exposure ${ex.id}: unknown mask ${ex.mask}`, { path: `print.exposures.${ex.id}.mask` });
    const filtration = ex.filtration ?? e.filtration;
    packs.add(packKey(filtration));
    if (ex.kind === 'flash' && ex.through !== 'open') {
      diagnostics.push({ code: 'W_PREVIEW_APPROX', message: `exposure ${ex.id}: a flash is exposed through the negative until compile can expose it through the film base (CHB-010 contract request C6)`, path: `print.exposures.${ex.id}` });
    }
    exposures.push({ id: ex.id, kind: ex.kind, seconds: exposureSeconds(ex, e.time_s), filtration, mask: ex.mask, sign: ex.kind === 'dodge' ? -1 : 1 });
  }
  if (packs.size > MAX_PACKS) fail('E_TOO_MANY_PACKS', `${packs.size} distinct filter packs; at most ${MAX_PACKS} per frame`, { path: 'print.exposures' });
  const held = exposures.filter((x) => x.sign < 0 && x.mask === null).reduce((s, x) => s + x.seconds, 0);
  if (held > e.time_s) diagnostics.push({ code: 'W_DODGE_EXCEEDS_MAIN', message: `unmasked dodges hold back ${held} s of a ${e.time_s} s main exposure`, path: 'print.exposures' });
  return { exposures, diagnostics };
}
