// The enlarger's two modes in the studio (CHB-031 WS-A, F17). In real mode (the default since contract 0.4) time,
// aperture and magnification expose the paper as on a darkroom enlarger. Normalised mode prints the grey card at
// the aim whatever the optics (core print/enlarger.ts: "Normalised mode ignores them"), so those controls would
// do nothing: they are hidden, never changed, never recorded. A layout picks the mode new recipes get (simple and
// tiny: normalised); a saved recipe keeps the mode it stores.
import type { FrameRecipe, Graph, Mutation, Vec3 } from '@chromobench/contract';
import { STOP, PT } from './units.ts';

export type EnlargerMode = 'real' | 'normalised';
export const ENLARGER_MODES: readonly EnlargerMode[] = ['real', 'normalised'];

/** The recipe paths that have no effect on the print in normalised mode. */
export const OPTICS_PATHS: ReadonlySet<string> = new Set(['print.enlarger.time_s', 'print.enlarger.fstop', 'print.enlarger.magnification']);

/** true when the recipe prints in normalised mode */
export const isNormalised = (r: Pick<FrameRecipe, 'print'> | null | undefined): boolean => r?.print?.enlarger?.mode === 'normalised';

/** true when `path` is a control that does nothing for this recipe (time, aperture, magnification in normalised mode) */
export const isInert = (r: Pick<FrameRecipe, 'print'> | null | undefined, path: string): boolean => isNormalised(r) && OPTICS_PATHS.has(path);

/** the recipe with its enlarger in `mode` (the same object when it already is) */
export function withEnlargerMode(r: FrameRecipe, mode: EnlargerMode): FrameRecipe {
  if (r.print.enlarger.mode === mode) return r;
  return { ...r, print: { ...r.print, enlarger: { ...r.print.enlarger, mode } } };
}

type Initial = (defaults: FrameRecipe, graph: Graph) => Promise<FrameRecipe>;

/**
 * A layout's enlarger mode for new recipes: the host's first recipe (the automatic first print) is made with the
 * enlarger already in `mode`, so it puts the density where that mode has it (the time in real mode, the printer
 * lights in normalised mode), and the result is held to `mode`. Without a host first recipe the defaults are used.
 */
export function initialInMode(initial: Initial | FrameRecipe | undefined, mode: EnlargerMode): Initial {
  return async (defaults, graph) => {
    const d = withEnlargerMode(defaults, mode);
    const r = typeof initial === 'function' ? await initial(d, graph) : initial && initial.kind === d.kind ? initial : d;
    return withEnlargerMode(r, mode);
  };
}

/**
 * "Lighter" / "Darker" by `stops` (negative is lighter): the exposure time in real mode, as at an enlarger; the
 * three printer lights together in normalised mode, where the time does nothing (1 stop = log10 2 log H ≈ 12 points).
 * `lightsPoints` overrides the step in normalised mode with a number of printer points (the lights pad's own step).
 */
export function exposureStep(r: FrameRecipe, stops: number, o: { lightsPoints?: number } = {}): Mutation & { op: 'set' } {
  if (!isNormalised(r)) {
    const t = r.print.enlarger.time_s * 2 ** stops;
    return { op: 'set', path: 'print.enlarger.time_s', value: Number(Math.min(600, Math.max(0.1, t)).toFixed(6)) };
  }
  const d = o.lightsPoints !== undefined ? Math.sign(stops) * o.lightsPoints * PT : stops * STOP;
  return { op: 'set', path: 'print.lights.logH', value: shiftLights(r.print.lights.logH, d) };
}

/** the three printer lights moved together by d log H, held to the contract's ±1.5 log H */
export const shiftLights = (l: readonly number[], d: number): Vec3 => l.map((x) => Number(Math.min(1.5, Math.max(-1.5, x + d)).toFixed(6))) as Vec3;
