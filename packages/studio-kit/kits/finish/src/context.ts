// cb.kits.finish: what the tools, the commands and the panels share (split from kit.ts, CHB-032): the frame a tool
// acts on (its document at docs.<f>), the source sizes seen, the geometry writes, the aspect lock. One instance per kit.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Box, Document, Geometry } from '@chromobench/contract';
import type { Studio } from '../../../src/studio.ts';
import { DOCS } from '../../../src/model/doc.ts';
import { parseAspect, swapsAxes } from './geometry.ts';
import { type FinishView, FINISH_STATE, plain } from './state.ts';
import { sel } from '../../../src/sel.ts';

export interface FrameOf { f: string; W: number; H: number; r: Document }

export function createFinishContext() {
  const studioOf = (ctx: any): Studio => {
    const s = ctx.services?.studio as Studio | undefined;
    if (!s) throw new Error('No studio service: start the app with studio.services()');
    return s;
  };
  /** the frame the tools act on: id, size (source px), the document as the state shows it (previews included) */
  const frameOf = (ctx: any): FrameOf | null => {
    const f = sel.current(ctx.state);
    const e = f ? ctx.services?.studio?.frames?.get(f) : undefined;
    const r = f ? (ctx.state.docs?.[f] as Document | undefined) : undefined;
    return f && e && r ? { f, W: e.info.width, H: e.info.height, r } : null;
  };
  const sizeIn = (s: any): { W: number; H: number } | null => {
    // overlays get the state only: the size is the source's, remembered by the tools
    const f = sel.current(s);
    const z = f ? sizes.get(f) : undefined;
    return z ?? null;
  };
  const sizes = new Map<string, { W: number; H: number }>();
  const remember = (fr: { f: string; W: number; H: number }) => sizes.set(fr.f, { W: fr.W, H: fr.H });
  const opts = (s: any): FinishView => ({ ...FINISH_STATE.finish, ...(s?.finish ?? {}) });
  /** the store path of a frame's geometry */
  const framePath = (f: string): (string | number)[] => [DOCS, f, 'geometry'];
  const setFrame = (ctx: any, f: string, next: Geometry, label: string): void => ctx.tx(label, (t: any) => t.$set(framePath(f), normalise(next, sizes.get(f))));
  const normalise = (f: Geometry, z?: { W: number; H: number }): Geometry => {
    const c = f.crop;
    const whole = !!z && !!c && c.x === 0 && c.y === 0 && c.w === z.W && c.h === z.H && f.angle_deg === 0;
    return plain({ orientation: f.orientation, angle_deg: Number(f.angle_deg.toFixed(4)), crop: whole ? null : c });
  };
  const needFrame = { enabled: (s: any) => !!sel.current(s) && !!s.docs?.[sel.current(s)!], why: 'Open a frame first' };
  /** dust is healed on the negative: a frame opened as a negative scan has a scan stage (heal is a catalogue op) */
  const dustAvailable = (_ctx: any, r: Document): boolean => !!r.stages.scan;
  /** the shown aspect [p, q] the crop is locked to, or null (free) */
  const lockAspect = (s: any, fr: { W: number; H: number; r: Document }, box: Box): [number, number] | null => {
    const o = opts(s).crop;
    if (o.aspect === 'free' || !o.locked) return null;
    const pq = parseAspect(o.aspect, fr.W, fr.H, fr.r.geometry.orientation);
    return pq ?? (swapsAxes(fr.r.geometry.orientation) ? [box.h, box.w] : [box.w, box.h]);
  };
  return { studioOf, frameOf, sizeIn, sizes, remember, opts, framePath, setFrame, normalise, needFrame, dustAvailable, lockAspect };
}
export type FinishContext = ReturnType<typeof createFinishContext>;
