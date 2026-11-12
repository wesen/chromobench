// cb.kits.finish: what the tools, the commands and the panels share (split from kit.ts, CHB-032): the frame a tool
// acts on, the source sizes seen, the frame writes, the aspect lock. One instance per kit.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Box, FrameRecipe, FrameSettings } from '@chromobench/contract';
import type { Studio } from '../../../src/studio.ts';
import { parseAspect, swapsAxes } from './geometry.ts';
import { type FinishView, FINISH_STATE, plain, current } from './state.ts';

export function createFinishContext() {
  const studioOf = (ctx: any): Studio => {
    const s = ctx.services?.studio as Studio | undefined;
    if (!s) throw new Error('No studio service: start the app with studio.services()');
    return s;
  };
  /** the frame the tools act on: id, size (sensor px), the recipe as the state shows it (previews included) */
  const frameOf = (ctx: any): { f: string; W: number; H: number; r: FrameRecipe } | null => {
    const f = current(ctx.state);
    const e = f ? ctx.services?.studio?.frames?.get(f) : undefined;
    const r = f ? (ctx.state.recipes?.[f] as FrameRecipe | undefined) : undefined;
    return f && e && r ? { f, W: e.info.width, H: e.info.height, r } : null;
  };
  const sizeIn = (s: any): { W: number; H: number } | null => {
    // overlays get the state only: the size is the source's, from the recipe's frame entry (set by the tools)
    const f = current(s);
    const z = f ? sizes.get(f) : undefined;
    return z ?? null;
  };
  const sizes = new Map<string, { W: number; H: number }>();
  const remember = (fr: { f: string; W: number; H: number }) => sizes.set(fr.f, { W: fr.W, H: fr.H });
  const opts = (s: any): FinishView => ({ ...FINISH_STATE.finish, ...(s?.finish ?? {}) });
  const framePath = (f: string): (string | number)[] => ['recipes', f, 'view', 'frame'];
  const setFrame = (ctx: any, f: string, next: FrameSettings, label: string): void => ctx.tx(label, (t: any) => t.$set(framePath(f), normalise(next, sizes.get(f))));
  const normalise = (f: FrameSettings, z?: { W: number; H: number }): FrameSettings => {
    const c = f.crop;
    const whole = !!z && !!c && c.x === 0 && c.y === 0 && c.w === z.W && c.h === z.H && f.angle_deg === 0;
    return plain({ orientation: f.orientation, angle_deg: Number(f.angle_deg.toFixed(4)), crop: whole ? null : c });
  };
  const needFrame = { enabled: (s: any) => !!current(s) && !!s.recipes?.[current(s)!], why: 'Open a frame first' };
  const dustAvailable = (ctx: any, r: FrameRecipe): boolean => r.kind === 'negative-scan' && !!r.scan && (studioOf(ctx).engine.capabilities().ops as string[]).includes('scan.heal');
  /** the shown aspect [p, q] the crop is locked to, or null (free) */
  const lockAspect = (s: any, fr: { W: number; H: number; r: FrameRecipe }, box: Box): [number, number] | null => {
    const o = opts(s).crop;
    if (!o.locked && o.aspect === 'free') return null;
    if (o.aspect === 'free' || !o.locked) return null;
    const pq = parseAspect(o.aspect, fr.W, fr.H, fr.r.view.frame.orientation);
    return pq ?? (swapsAxes(fr.r.view.frame.orientation) ? [box.h, box.w] : [box.w, box.h]);
  };
  return { studioOf, frameOf, sizeIn, sizes, remember, opts, framePath, setFrame, normalise, needFrame, dustAvailable, lockAspect };
}
export type FinishContext = ReturnType<typeof createFinishContext>;
