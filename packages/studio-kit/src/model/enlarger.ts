// The enlarger's two modes in the studio (CHB-031 WS-A, F17). In real mode (the default since contract 0.4) time,
// aperture and magnification expose the paper as on a darkroom enlarger. Normalised mode prints the grey card at
// the aim whatever the optics (core print/enlarger.ts: "Normalised mode ignores them"), so those controls would
// do nothing: they are hidden, never changed, never recorded. A layout picks the mode new recipes get (simple and
// tiny: normalised); a saved recipe keeps the mode it stores.
import { applyMutation, EditLog, type EditLogOptions, type FrameRecipe, type Graph, type Mutation, type Vec3 } from '@chromobench/contract';
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

/**
 * The log H an optics setting moves the paper's exposure by from the recipe's own (core's optics law in real mode,
 * print/enlarger.ts opticsLogH: log t − 2 log N − 2 log (m + 1)); null for another path or a value that is no number.
 */
export function opticsShift(r: FrameRecipe, path: string, value: unknown): number | null {
  if (typeof value !== 'number' || !(value > 0)) return null;
  const e = r.print.enlarger;
  if (path === 'print.enlarger.time_s') return Math.log10(value / e.time_s);
  if (path === 'print.enlarger.fstop') return -2 * Math.log10(value / e.fstop);
  if (path === 'print.enlarger.magnification') return -2 * Math.log10((value + 1) / ((e.magnification ?? REFERENCE_MAGNIFICATION) + 1));
  return null;
}
/** A null magnification is the calibration's reference: core's REFERENCE_OPTICS (10 s, f/8, 8×). */
const REFERENCE_MAGNIFICATION = 8;

/**
 * The mutations with no inert control in them (CHB-031 srvr): on a normalised recipe time, aperture and
 * magnification do nothing, so a write to one becomes the same exposure on the three printer lights (as Lighter /
 * Darker and the test strip do), and the optics keep their value. Taken in order: a mode change earlier in the same
 * list counts for the writes after it. On a real recipe the list is returned as it is.
 */
export function withoutInert(r: FrameRecipe, ms: readonly Mutation[]): Mutation[] {
  let cur = r;
  const out: Mutation[] = [];
  for (const m of ms) {
    const d = m.op === 'set' && isInert(cur, m.path) ? opticsShift(cur, m.path, m.value) : null;
    let w: Mutation | null = m;
    if (d !== null) {
      const now = cur.print.lights.logH;
      w = Math.abs(d) < 1e-9 ? null : { op: 'set', path: 'print.lights.logH', value: shiftLights(now, d), ...('expect' in m && m.expect !== undefined ? { expect: [...now] } : {}) };
    } else if (m.op === 'set' && isInert(cur, m.path)) w = null; // an optics value that is no exposure: nothing to write
    if (!w) continue;
    out.push(w);
    try {
      cur = applyMutation(cur, w).recipe;
    } catch {
      // an invalid mutation: the log refuses it with its own diagnostic
    }
  }
  return out;
}

/**
 * The studio's EditLog (CHB-031 srvr): no inert control enters the log, whoever writes — the controls, the looks
 * kit, a script, the agent's proposals replayed on the page. apply, propose and preview pass through withoutInert.
 */
export class StudioLog extends EditLog {
  /** A new log for a frame (EditLog.create's record, as a StudioLog). */
  static make(initial: FrameRecipe, opts: EditLogOptions & { by?: 'user' | 'agent' | 'auto' } = {}): StudioLog {
    return new StudioLog(EditLog.create(initial, opts).toJSON(), opts);
  }
  override apply(...[ms, ...rest]: Parameters<EditLog['apply']>): ReturnType<EditLog['apply']> {
    return super.apply(withoutInert(this.committed, ms), ...rest);
  }
  override propose(...[ms, meta]: Parameters<EditLog['propose']>): ReturnType<EditLog['propose']> {
    return super.propose(withoutInert(this.committed, ms), meta);
  }
  override preview(m: Parameters<EditLog['preview']>[0]): void {
    if (m === null) return super.preview(null);
    super.preview(withoutInert(this.committed, Array.isArray(m) ? (m as readonly Mutation[]) : [m as Mutation]));
  }
}
