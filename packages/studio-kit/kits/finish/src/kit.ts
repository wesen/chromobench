// cb.kits.finish (CHB-022 guide §5, §9): crop and straighten, heal and clone, finishing tones — viewport tools
// that write vectors into the recipe (view.frame, retouch.spots.<id>, scan.dust.spots), commands, panels built
// from ck.ui and cb.arg only (so every host renders them without extra renderers), passes. Headless.
//
//   const fin = cb.kits.finish;
//   cb.studio('X').use(fin.kit)
//     .module('finish', m => m.label('Finish').center(fin.viewer()).right(fin.cropPanel(), fin.retouchPanel(), fin.tonesPanel()).keys(fin.keys))
//
// Units: everything the recipe stores is sensor px of the un-oriented source (geometry.ts); a gesture converts
// at the boundary. The crop tool shows the whole frame, oriented and not straightened, with the region the crop
// will read drawn as a turned rectangle; every other tool shows the finished (cropped, straightened) print.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { setPath, type Box, type FrameRecipe, type FrameSettings, type Mutation, type RetouchSpot } from '@chromobench/contract';
import type { Ck, NodeData } from '@chromobench/shell';
import type { Cb } from '../../../src/cb.ts';
import { frameRef, isImageHandle, type ImageHandle } from '../../../src/handles.ts';
import type { Studio } from '../../../src/studio.ts';
import {
  ASPECTS, canvasToSource, centreOf, constrain, cropCorners, cropOf, fitCrop, fitsInside, frameValid, fullBox, largestCrop, orientFrame, parseAspect, rotate,
  roundBox, sensorTurn, shownContains, sourceToCanvas, swapAspect, swapsAxes, toShown, toSource, towards, type Pt,
} from './geometry.ts';
import { suggestSource, type ProxyImage } from './suggest.ts';

export type SpotMode = 'heal' | 'clone' | 'dust';
export interface FinishView {
  crop: { aspect: string; locked: boolean };
  spot: { mode: SpotMode; r: number; feather: number; opacity: number };
  /** the selected retouch spot (or dust spot) id */
  selected: string | null;
  /** draw every spot with its source line */
  show: boolean;
  /** before/after of the finishing set: the viewer shows the print without retouch and finishing (never committed) */
  bypass: boolean;
}
export const FINISH_STATE: { finish: FinishView } = {
  finish: { crop: { aspect: 'original', locked: true }, spot: { mode: 'heal', r: 12, feather: 0.5, opacity: 1 }, selected: null, show: true, bypass: false },
};

/** Paths the finishing panel offers: the finishing.* fields the contract compiles today (CHB-015 owns the ops). */
export const FINISHING_PATHS = ['finishing.values.clarity'] as const;

interface DustSpot { id: string; x: number; y: number; r: number }
export interface SpotRef { id: string; kind: 'retouch' | 'dust'; mode: SpotMode; x: number; y: number; r: number; src: Pt | null; enabled: boolean }

const plain = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const current = (s: any): string | null => s?.ui?.selection?.primary ?? null;

/** Every spot of a recipe (retouch and dust), in composite order. */
export function spotsOf(r: FrameRecipe | undefined | null): SpotRef[] {
  if (!r) return [];
  const out: SpotRef[] = [];
  for (const d of (r.scan?.dust.spots ?? []) as DustSpot[]) out.push({ id: d.id, kind: 'dust', mode: 'dust', x: d.x, y: d.y, r: d.r, src: null, enabled: true });
  const ids = Object.keys(r.retouch?.spots ?? {}).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  for (const id of ids) {
    const s = r.retouch.spots[id]!;
    out.push({ id, kind: 'retouch', mode: s.mode, x: s.x, y: s.y, r: s.r, src: s.src, enabled: s.enabled });
  }
  return out;
}
/** The next spot id: s or d plus one more than the largest counter in use. */
export function nextSpotId(r: FrameRecipe, kind: 'retouch' | 'dust'): string {
  const p = kind === 'dust' ? 'd' : 's';
  const used = kind === 'dust' ? ((r.scan?.dust.spots ?? []) as DustSpot[]).map((d) => d.id) : Object.keys(r.retouch.spots);
  const n = Math.max(0, ...used.map((id) => (id.startsWith(p) ? Number(id.slice(1)) : 0)).filter(Number.isFinite));
  return `${p}${n + 1}`;
}

/**
 * CB-F110 (finish/crop-valid, guide §9.5): a frame whose turned crop leaves the picture shows empty corners.
 * Returns the problem and the fix (the largest valid box with the same shape), or null.
 */
export function cropProblem(r: FrameRecipe, W: number, H: number): { code: 'CB-F110'; message: string; fix: FrameSettings } | null {
  const f = r.view.frame;
  if (frameValid(f, W, H)) return null;
  const fix = constrain(f, W, H);
  const b = fix.crop ?? fullBox(W, H);
  return { code: 'CB-F110', message: `the crop turned by ${f.angle_deg}° leaves the picture (empty corners)`, fix: { ...fix, crop: b } };
}

/** The agent's and the tools' common edits (guide §9.4): mutations, so a proposal is the same as a gesture. */
export const edits = {
  /** crop to an aspect at an angle, as large as fits (centre: keep the crop's) */
  crop(r: FrameRecipe, W: number, H: number, o: { aspect?: string | [number, number]; angle_deg?: number; centre?: Pt } = {}): Mutation[] {
    const f = r.view.frame;
    const centre = o.centre ?? centreOf(cropOf(f, W, H));
    const next = fitCrop(W, H, { orientation: f.orientation, angle_deg: o.angle_deg ?? f.angle_deg, aspect: o.aspect ?? 'original', centre });
    return [{ op: 'set', path: 'view.frame.angle_deg', value: next.angle_deg }, { op: 'set', path: 'view.frame.crop', value: next.crop }];
  },
  /** one spot (heal or clone), source given or found by suggestSource on a proxy */
  spot(r: FrameRecipe, s: Omit<RetouchSpot, 'enabled' | 'feather' | 'opacity'> & Partial<RetouchSpot>, id = nextSpotId(r, 'retouch')): Mutation[] {
    return [{ op: 'set', path: `retouch.spots.${id}`, value: { feather: 0.5, opacity: 1, enabled: true, ...s } }];
  },
};

const FINISH_DOCS = `## cb.kits.finish
Crop and straighten (tool R: drag inside to move, a handle to resize, outside to turn; Shift snaps to 0.5°; the
crop stays inside the picture), spot heal and clone (tool Q: click a speck, drag to choose the source; the source
is found automatically on a click), and the finishing tones, which are digital and after the print, not darkroom
controls. The recipe stores vectors, never pixels: view.frame {orientation, angle_deg, crop} and
retouch.spots.<id> in sensor px of the un-oriented source, so a crop or a turn never moves a spot. Every source is
read from the print before retouching; a later spot covers an earlier one.`;

export function createFinishKit(ck: Ck, cb: Cb) {
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

  // ── the crop tool ──
  const HANDLE_PX = 9;
  const canvasOf = (r: FrameRecipe): FrameRecipe => setPath(r, 'view.frame', { orientation: r.view.frame.orientation, angle_deg: 0, crop: null });
  const screenOf = (vp: any, fr: { W: number; H: number; r: FrameRecipe }, f: FrameSettings, p: Pt): [number, number] => {
    const q = sourceToCanvas(f, fr.W, fr.H, p.x, p.y);
    const [nw, nh] = vp.natural();
    return vp.toScreen(q.x / nw, q.y / nh);
  };
  const handlesOf = (box: Box, theta: number): { hx: number; hy: number; p: Pt }[] => {
    const c = centreOf(box);
    const out: { hx: number; hy: number; p: Pt }[] = [];
    for (const hx of [-1, 0, 1]) for (const hy of [-1, 0, 1]) {
      if (!hx && !hy) continue;
      const v = rotate({ x: (hx * box.w) / 2, y: (hy * box.h) / 2 }, theta);
      out.push({ hx, hy, p: { x: c.x + v.x, y: c.y + v.y } });
    }
    return out;
  };
  /** snap a box to the locked aspect's multiples (4:5 → 4k × 5k) when it is a small integer ratio */
  const snapTo = (b: Box, pq: [number, number] | null, f: FrameSettings, W: number, H: number): Box => {
    const theta = sensorTurn(f);
    if (pq && Number.isInteger(pq[0]) && Number.isInteger(pq[1]) && pq[0] <= 64 && pq[1] <= 64) {
      const [p, q] = swapsAxes(f.orientation) ? [pq[1], pq[0]] : pq;
      const c = centreOf(b);
      for (let k = Math.floor(b.h / q); k >= 1; k--) {
        const r = { x: Math.round(c.x - (k * p) / 2), y: Math.round(c.y - (k * q) / 2), w: k * p, h: k * q };
        if (fitsInside(r, theta, W, H)) return r;
      }
    }
    const r = { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) };
    return fitsInside(r, theta, W, H) ? r : roundBox(b, theta, W, H) ?? r;
  };

  interface CropG { fr: { f: string; W: number; H: number; r: FrameRecipe }; start: FrameSettings; box0: Box; mode: 'move' | 'resize' | 'rotate'; hx: number; hy: number; p0: Pt; a0: number; last: Box; cur: FrameSettings | null }
  const cropDown = (e: any, ctx: any): CropG | false => {
    const fr = frameOf(ctx);
    if (!fr) return false;
    remember(fr);
    if (e.detail === 2) {
      ctx.run('crop.done');
      return false;
    }
    const start = plain(fr.r.view.frame);
    const box0 = cropOf(start, fr.W, fr.H);
    const theta = sensorTurn(start);
    const p0 = canvasToSource(start, fr.W, fr.H, e.x, e.y);
    const vp = ctx.vp;
    let mode: CropG['mode'] = 'rotate', hx = 0, hy = 0;
    const hit = vp ? handlesOf(box0, theta).find((h) => {
      const [sx, sy] = screenOf(vp, fr, start, h.p);
      return Math.hypot(sx - e.sx, sy - e.sy) <= HANDLE_PX;
    }) : undefined;
    if (hit) [mode, hx, hy] = ['resize', hit.hx, hit.hy];
    else {
      const l = rotate({ x: p0.x - centreOf(box0).x, y: p0.y - centreOf(box0).y }, -theta);
      if (Math.abs(l.x) <= box0.w / 2 && Math.abs(l.y) <= box0.h / 2) mode = 'move';
    }
    const cc = sourceToCanvas(start, fr.W, fr.H, centreOf(box0).x, centreOf(box0).y);
    return { fr, start, box0, mode, hx, hy, p0, a0: Math.atan2(e.y - cc.y, e.x - cc.x), last: box0, cur: null };
  };
  const cropDrag = (e: any, ctx: any, g: CropG): CropG => {
    const { W, H } = g.fr;
    const f0 = g.start;
    const theta = sensorTurn(f0);
    const p = canvasToSource(f0, W, H, e.x, e.y);
    let next: FrameSettings;
    if (g.mode === 'rotate') {
      const cc = sourceToCanvas(f0, W, H, centreOf(g.box0).x, centreOf(g.box0).y);
      let d = ((Math.atan2(e.y - cc.y, e.x - cc.x) - g.a0) * 180) / Math.PI;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      let a = Math.max(-45, Math.min(45, f0.angle_deg - d));
      a = e.shift ? Math.round(a * 2) / 2 : Number(a.toFixed(2));
      // the start box at the new angle, shrunk about its centre until it fits (the picture zooms in as it turns)
      next = constrain({ ...f0, angle_deg: a, crop: g.box0 }, W, H);
      const pq = lockAspect(ctx.state, g.fr, g.box0);
      if (next.crop && pq) next = { ...next, crop: snapTo(next.crop, pq, next, W, H) };
    } else if (g.mode === 'move') {
      const cand = { ...g.box0, x: g.box0.x + p.x - g.p0.x, y: g.box0.y + p.y - g.p0.y };
      // a move that would leave the picture stops at the edge
      g.last = towards(g.last, cand, theta, W, H);
      next = { ...f0, crop: { x: Math.round(g.last.x), y: Math.round(g.last.y), w: g.box0.w, h: g.box0.h } };
      if (!fitsInside(next.crop!, theta, W, H)) next = { ...f0, crop: snapTo(g.last, null, f0, W, H) };
    } else {
      const c0 = centreOf(g.box0);
      const l = rotate({ x: p.x - c0.x, y: p.y - c0.y }, -theta);
      let L = -g.box0.w / 2, R = g.box0.w / 2, T = -g.box0.h / 2, B = g.box0.h / 2;
      const MIN = 8;
      if (g.hx > 0) R = Math.max(L + MIN, l.x);
      if (g.hx < 0) L = Math.min(R - MIN, l.x);
      if (g.hy > 0) B = Math.max(T + MIN, l.y);
      if (g.hy < 0) T = Math.min(B - MIN, l.y);
      const pq = lockAspect(ctx.state, g.fr, g.box0);
      if (pq) {
        const [p0, q0] = swapsAxes(f0.orientation) ? [pq[1], pq[0]] : pq;
        const rho = p0 / q0;
        let w = R - L, h = B - T;
        if (g.hx && g.hy) {
          if (w / g.box0.w > h / g.box0.h) h = w / rho;
          else w = h * rho;
          if (g.hx > 0) R = L + w;
          else L = R - w;
          if (g.hy > 0) B = T + h;
          else T = B - h;
        } else if (g.hx) {
          h = w / rho;
          T = -h / 2;
          B = h / 2;
        } else {
          w = h * rho;
          L = -w / 2;
          R = w / 2;
        }
      }
      const lc = rotate({ x: (L + R) / 2, y: (T + B) / 2 }, theta);
      const w = R - L, h = B - T;
      const cand = { x: c0.x + lc.x - w / 2, y: c0.y + lc.y - h / 2, w, h };
      const fit = towards(g.box0, cand, theta, W, H);
      next = { ...f0, crop: snapTo(fit, pq, f0, W, H) };
    }
    g.cur = next;
    ctx.preview(framePath(g.fr.f), normalise(next, { W, H }));
    return g;
  };
  const cropUp = (_e: any, ctx: any, g: CropG): void => {
    if (!g.cur || JSON.stringify(normalise(g.cur, g.fr)) === JSON.stringify(normalise(g.start, g.fr))) return void ctx.cancel();
    ctx.commit(g.mode === 'rotate' ? 'Straighten' : g.mode === 'move' ? 'Move Crop' : 'Crop');
  };
  const svg = (g: any, tag: string, a: Record<string, string | number>, text?: string): any => {
    const x = (g.ownerDocument as Document).createElementNS('http://www.w3.org/2000/svg', tag);
    // presentation inline, so every host draws the overlay without a stylesheet
    const look = String(a['class'] ?? '').split(' ').map((c) => LOOK[c]).filter(Boolean).reduce((o, l) => ({ ...o, ...l }), {} as Record<string, string>);
    for (const [k, v] of Object.entries({ ...look, ...a })) x.setAttribute(k, String(v));
    if (text !== undefined) x.textContent = text;
    g.append(x);
    return x;
  };
  const cropOverlay = (g: any, vp: any, s: any): void => {
    const f = current(s);
    const r = f ? (s.recipes?.[f] as FrameRecipe | undefined) : undefined;
    const z = sizeIn(s) ?? (r && vp ? { W: swapsAxes(r.view.frame.orientation) ? vp.natural()[1] : vp.natural()[0], H: swapsAxes(r.view.frame.orientation) ? vp.natural()[0] : vp.natural()[1] } : null);
    if (!r || !z) return;
    const fr = { W: z.W, H: z.H, r };
    const fs = r.view.frame;
    const box = cropOf(fs, z.W, z.H);
    const theta = sensorTurn(fs);
    const quad = cropCorners(box, theta).map((p) => screenOf(vp, fr, fs, p));
    const [x0, y0] = vp.toScreen(0, 0);
    const [x1, y1] = vp.toScreen(1, 1);
    const poly = (pts: [number, number][]): string => `M${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}Z`;
    svg(g, 'path', { d: `M${x0} ${y0}H${x1}V${y1}H${x0}Z${poly(quad)}`, 'fill-rule': 'evenodd', class: 'cb-crop-shade' });
    svg(g, 'path', { d: poly(quad), class: 'cb-crop-frame' });
    // rule of thirds inside the turned box
    const at = (u: number, v: number): [number, number] => {
      const q = rotate({ x: (u - 0.5) * box.w, y: (v - 0.5) * box.h }, theta);
      const c = centreOf(box);
      return screenOf(vp, fr, fs, { x: c.x + q.x, y: c.y + q.y });
    };
    for (const t of [1 / 3, 2 / 3]) {
      const [a, b] = [at(t, 0), at(t, 1)];
      const [c, d] = [at(0, t), at(1, t)];
      svg(g, 'path', { d: `M${a[0]} ${a[1]}L${b[0]} ${b[1]}M${c[0]} ${c[1]}L${d[0]} ${d[1]}`, class: 'cb-crop-thirds' });
    }
    for (const h of handlesOf(box, theta)) {
      const [sx, sy] = screenOf(vp, fr, fs, h.p);
      svg(g, 'rect', { x: sx - 4, y: sy - 4, width: 8, height: 8, class: 'cb-crop-handle', 'data-handle': `${h.hx},${h.hy}` });
    }
    const label = `${box.w} × ${box.h}${fs.angle_deg ? ` · ${fs.angle_deg.toFixed(1)}°` : ''}`;
    svg(g, 'text', { x: Math.min(...quad.map((q) => q[0])) + 4, y: Math.min(...quad.map((q) => q[1])) - 6, class: 'cb-crop-label' }, label);
    g.setAttribute?.('data-crop', JSON.stringify(box));
  };

  // ── the spot tool ──
  interface SpotG { fr: { f: string; W: number; H: number; r: FrameRecipe }; kind: 'new' | 'target' | 'source'; id: string; spot: RetouchSpot | DustSpot; dust: boolean; moved: boolean; e0: { sx: number; sy: number }; p0: Pt; hover?: undefined }
  const spotScreen = (vp: any, f: FrameSettings, W: number, H: number, p: Pt): [number, number] => {
    const q = toShown(f, W, H, p.x, p.y);
    return vp.docToScreen(q.x, q.y);
  };
  const spotDown = (e: any, ctx: any): SpotG | false => {
    const fr = frameOf(ctx);
    if (!fr) return false;
    remember(fr);
    const fs = fr.r.view.frame;
    const p = toSource(fs, fr.W, fr.H, e.x, e.y);
    const o = opts(ctx.state).spot;
    const vp = ctx.vp;
    // an existing spot: its source pin, then its disc (the newest first)
    if (vp) {
      const sc = vp.scale?.() ?? 1;
      for (const s of [...spotsOf(fr.r)].reverse()) {
        if (s.src) {
          const [sx, sy] = spotScreen(vp, fs, fr.W, fr.H, s.src);
          if (Math.hypot(sx - e.sx, sy - e.sy) <= Math.max(7, s.r * sc * 0.5)) {
            ctx.set({ finish: { selected: s.id } });
            return { fr, kind: 'source', id: s.id, spot: plain(fr.r.retouch.spots[s.id]!), dust: false, moved: false, e0: { sx: e.sx, sy: e.sy }, p0: p };
          }
        }
        const [tx, ty] = spotScreen(vp, fs, fr.W, fr.H, s);
        if (Math.hypot(tx - e.sx, ty - e.sy) <= Math.max(7, s.r * sc)) {
          ctx.set({ finish: { selected: s.id } });
          const spot = s.kind === 'dust' ? plain((fr.r.scan!.dust.spots as DustSpot[]).find((d) => d.id === s.id)!) : plain(fr.r.retouch.spots[s.id]!);
          return { fr, kind: 'target', id: s.id, spot, dust: s.kind === 'dust', moved: false, e0: { sx: e.sx, sy: e.sy }, p0: p };
        }
      }
    }
    if (p.x < 0 || p.y < 0 || p.x > fr.W || p.y > fr.H) return false;
    const dust = o.mode === 'dust' && dustAvailable(ctx, fr.r);
    const mode = o.mode === 'clone' ? 'clone' : 'heal';
    const id = nextSpotId(fr.r, dust ? 'dust' : 'retouch');
    const r = Math.max(1, Number(o.r) || 12);
    const spot = dust ? { id, x: round2(p.x), y: round2(p.y), r } : { mode, x: round2(p.x), y: round2(p.y), r, src: { x: round2(p.x), y: round2(p.y) }, feather: o.feather, opacity: o.opacity, enabled: true } as RetouchSpot;
    return { fr, kind: 'new', id, spot, dust, moved: false, e0: { sx: e.sx, sy: e.sy }, p0: p };
  };
  const round2 = (v: number): number => Math.round(v * 100) / 100;
  const insideFrame = (p: Pt, r: number, W: number, H: number): Pt => ({ x: round2(Math.min(W - r, Math.max(r, p.x))), y: round2(Math.min(H - r, Math.max(r, p.y))) });
  const previewSpot = (ctx: any, g: SpotG): void => {
    if (g.dust) {
      const list = ((g.fr.r.scan?.dust.spots ?? []) as DustSpot[]).filter((d) => d.id !== g.id);
      ctx.preview(['recipes', g.fr.f, 'scan', 'dust', 'spots'], plain([...list, g.spot]));
    } else ctx.preview(['recipes', g.fr.f, 'retouch', 'spots', g.id], plain(g.spot));
  };
  const spotDrag = (e: any, ctx: any, g: SpotG): SpotG => {
    if (!g.moved && Math.hypot(e.sx - g.e0.sx, e.sy - g.e0.sy) < 3) return g;
    g.moved = true;
    const { W, H } = g.fr;
    const p = toSource(g.fr.r.view.frame, W, H, e.x, e.y);
    const s = g.spot as RetouchSpot;
    if (g.kind === 'new' || g.kind === 'source') {
      // the source pin follows the pointer and refuses to leave the picture
      if (!g.dust) s.src = insideFrame(p, s.r, W, H);
    } else {
      // move the target (and its source with it)
      const dx = p.x - g.p0.x, dy = p.y - g.p0.y;
      const base = (g.dust ? ((g.fr.r.scan!.dust.spots as DustSpot[]).find((d) => d.id === g.id) as unknown as RetouchSpot) : g.fr.r.retouch.spots[g.id]!) as RetouchSpot;
      s.x = round2(base.x + dx);
      s.y = round2(base.y + dy);
      if (s.src && base.src) s.src = insideFrame({ x: base.src.x + dx, y: base.src.y + dy }, s.r, W, H);
    }
    previewSpot(ctx, g);
    return g;
  };
  const spotUp = (_e: any, ctx: any, g: SpotG): void => {
    if (g.kind !== 'new' && !g.moved) return void ctx.cancel();
    if (g.kind === 'new' && !g.dust && !g.moved) {
      // a click: the source is found on what the viewer shows (a proxy), then written into the spot
      const s = g.spot as RetouchSpot;
      s.src = sourceFor(ctx, g.fr, s) ?? insideFrame({ x: s.x + 2.5 * s.r, y: s.y }, s.r, g.fr.W, g.fr.H);
    }
    previewSpot(ctx, g);
    ctx.commit(g.kind === 'new' ? (g.dust ? 'Remove Dust' : 'Remove Spot') : 'Move Spot');
    if (g.kind === 'new') ctx.set({ finish: { selected: g.id } });
  };
  /** suggestSource on the viewer's shown image (shown px), mapped to sensor px */
  const sourceFor = (ctx: any, fr: { W: number; H: number; r: FrameRecipe }, s: RetouchSpot): Pt | null => {
    const img = ctx.vp?.shown?.()?.image as ProxyImage | undefined;
    if (!img?.data) return null;
    const fs = fr.r.view.frame;
    const t = toShown(fs, fr.W, fr.H, s.x, s.y);
    const [nw, nh] = ctx.vp.natural();
    const best = suggestSource(img, t, s.r, {
      bounds: { w: nw, h: nh },
      accept: (q) => {
        const src = toSource(fs, fr.W, fr.H, q.x, q.y);
        return src.x >= s.r && src.y >= s.r && src.x <= fr.W - s.r && src.y <= fr.H - s.r;
      },
    });
    if (!best) return null;
    const p = toSource(fs, fr.W, fr.H, best.x, best.y);
    return { x: round2(p.x), y: round2(p.y) };
  };
  const spotOverlay = (g: any, vp: any, s: any, gs: any): void => {
    const f = current(s);
    const r = f ? (s.recipes?.[f] as FrameRecipe | undefined) : undefined;
    const z = f ? sizes.get(f) : undefined;
    if (!r) return;
    const o = opts(s);
    const fs = r.view.frame;
    const sc = vp.scale?.() ?? 1;
    if (z && o.show) {
      for (const sp of spotsOf(r)) {
        const [tx, ty] = spotScreen(vp, fs, z.W, z.H, sp);
        const hidden = !shownContains(fs, z.W, z.H, sp.x, sp.y);
        const cls = `cb-spot is-${sp.mode}${sp.id === o.selected ? ' is-selected' : ''}${hidden || !sp.enabled ? ' is-off' : ''}`;
        if (sp.src) {
          const [qx, qy] = spotScreen(vp, fs, z.W, z.H, sp.src);
          svg(g, 'path', { d: `M${tx} ${ty}L${qx} ${qy}`, class: `${cls} cb-spot-line` });
          svg(g, 'circle', { cx: qx, cy: qy, r: Math.max(3, sp.r * sc), class: `${cls} cb-spot-src`, 'data-spot-src': sp.id });
        }
        svg(g, 'circle', { cx: tx, cy: ty, r: Math.max(3, sp.r * sc), class: `${cls} cb-spot-target`, 'data-spot': sp.id });
      }
    }
    if (gs?.hover) svg(g, 'circle', { cx: gs.hover.sx, cy: gs.hover.sy, r: Math.max(2, o.spot.r * sc), class: 'cb-spot-brush' });
  };

  // ── commands ──
  const withFrame = (run: (ctx: any, fr: { f: string; W: number; H: number; r: FrameRecipe }, ...a: any[]) => unknown) => (ctx: any, ...a: any[]) => {
    const fr = frameOf(ctx);
    if (!fr) return null;
    remember(fr);
    return run(ctx, fr, ...a);
  };
  const spotCommandsEnabled = (s: any) => !!s.finish?.selected && spotsOf(s.recipes?.[current(s) ?? '']).some((x) => x.id === s.finish.selected);
  const deleteSpots = (ctx: any, fr: { f: string; r: FrameRecipe }, ids: string[], label: string): void => {
    const ms: Mutation[] = [];
    const dust = ((fr.r.scan?.dust.spots ?? []) as DustSpot[]);
    const dustOut = dust.filter((d) => ids.includes(d.id));
    if (dustOut.length) ms.push({ op: 'set', path: 'scan.dust.spots', value: plain(dust.filter((d) => !ids.includes(d.id))) });
    for (const id of ids) if (fr.r.retouch.spots[id]) ms.push({ op: 'set', path: `retouch.spots.${id}`, value: null });
    if (ms.length) studioOf(ctx).route.applyMutations(fr.f, ms, label);
    ctx.set({ finish: { selected: null } });
  };

  // ── passes (guide §9.5): CB-F101 on the kit; CB-F102 (finish tools without the kit) on the ck instance ──
  const { labelPass, framePass } = finishPasses(ck);
  ck.install(framePass);

  const kit = ck.kit<typeof FINISH_STATE>('cb.finish', (k) => {
    k.version('1')
      .requires('cb.core')
      .state('finish', { init: FINISH_STATE.finish, view: true })
      .passes(labelPass)
      .tools((t) =>
        t
          .tool('crop', {
            label: 'Crop & Straighten',
            icon: 'crop',
            key: 'R',
            cursor: 'crosshair',
            ...needFrame,
            // the whole frame, oriented and not straightened; the crop is drawn over it
            image: (h: unknown) => (isImageHandle(h) && h.what === 'print' && h.recipe !== 'initial' ? frameRef(h.frame, canvasOf(h.recipe)).print() : h),
            overlay: cropOverlay,
            on: { down: cropDown, drag: cropDrag as any, up: cropUp as any, escape: (ctx: any) => ctx.cancel() },
          })
          .tool('spot', {
            label: 'Spot Removal',
            icon: 'heal',
            key: 'Q',
            cursor: 'crosshair',
            ...needFrame,
            overlay: spotOverlay,
            on: {
              hover: (e: any, ctx: any) => {
                const fr = frameOf(ctx);
                if (fr) remember(fr);
                return { hover: { sx: e.sx, sy: e.sy } };
              },
              leave: () => undefined,
              down: spotDown,
              drag: spotDrag as any,
              up: spotUp as any,
              escape: (ctx: any) => ctx.cancel(),
            },
          }),
      )
      .commands((c) => {
        c.add('crop.reset', {
          label: 'Reset Crop', menu: 'Finish', ...needFrame,
          run: withFrame((ctx, fr) => setFrame(ctx, fr.f, { orientation: fr.r.view.frame.orientation, angle_deg: 0, crop: null }, 'Reset Crop')),
        })
          .add('crop.aspect', {
            label: 'Crop Aspect', palette: false, ...needFrame,
            run: withFrame((ctx, fr, aspect: string) => {
              ctx.set({ finish: { crop: { aspect, locked: aspect !== 'free' } } });
              if (aspect === 'free') return;
              const fs = fr.r.view.frame;
              const next = fitCrop(fr.W, fr.H, { orientation: fs.orientation, angle_deg: fs.angle_deg, aspect, centre: centreOf(cropOf(fs, fr.W, fr.H)) });
              setFrame(ctx, fr.f, next, `Crop Aspect ${aspect}`);
            }),
          })
          .add('crop.lock', {
            label: 'Lock Crop Aspect', menu: 'Finish',
            checked: (s: any) => !!s.finish?.crop?.locked,
            run: (ctx: any) => ctx.set({ finish: { crop: { locked: !opts(ctx.state).crop.locked } } }),
          })
          .add('crop.swap', {
            label: 'Swap Crop Aspect', menu: 'Finish', ...needFrame,
            run: withFrame((ctx, fr) => setFrame(ctx, fr.f, swapAspect(fr.r.view.frame, fr.W, fr.H), 'Swap Crop Aspect')),
          })
          .add('crop.straighten', {
            label: 'Straighten', palette: false, ...needFrame,
            /** by `delta` degrees (or to `{ to }`), keeping the crop inside the picture */
            run: withFrame((ctx, fr, by: number | { to: number }) => {
              const fs = fr.r.view.frame;
              const a = Math.max(-45, Math.min(45, typeof by === 'object' ? by.to : fs.angle_deg + by));
              const next = constrain({ ...fs, angle_deg: Number(a.toFixed(2)), crop: cropOf(fs, fr.W, fr.H) }, fr.W, fr.H);
              setFrame(ctx, fr.f, next, `Straighten ${a.toFixed(1)}°`);
            }),
          })
          .add('crop.fix', {
            label: 'Fix Crop (Keep Inside)', menu: 'Finish',
            enabled: (s: any) => {
              const f = current(s);
              const z = f ? sizes.get(f) : undefined;
              return !!(f && z && s.recipes?.[f] && cropProblem(s.recipes[f], z.W, z.H));
            },
            why: 'The crop lies inside the picture',
            run: withFrame((ctx, fr) => {
              const p = cropProblem(fr.r, fr.W, fr.H);
              if (p) setFrame(ctx, fr.f, p.fix, 'Fix Crop');
            }),
          })
          .add('crop.done', { label: 'Done Cropping', palette: false, run: (ctx: any) => ctx.set({ ui: { tool: null } }) })
          .add('orient.cw', { label: 'Rotate Right', menu: 'Finish', ...needFrame, run: withFrame((ctx, fr) => setFrame(ctx, fr.f, orientFrame(fr.r.view.frame, 'cw90'), 'Rotate Right')) })
          .add('orient.ccw', { label: 'Rotate Left', menu: 'Finish', ...needFrame, run: withFrame((ctx, fr) => setFrame(ctx, fr.f, orientFrame(fr.r.view.frame, 'ccw90'), 'Rotate Left')) })
          .add('orient.flipH', { label: 'Flip Horizontal', menu: 'Finish', ...needFrame, run: withFrame((ctx, fr) => setFrame(ctx, fr.f, orientFrame(fr.r.view.frame, 'flipH'), 'Flip Horizontal')) })
          .add('orient.flipV', { label: 'Flip Vertical', menu: 'Finish', ...needFrame, run: withFrame((ctx, fr) => setFrame(ctx, fr.f, orientFrame(fr.r.view.frame, 'flipV'), 'Flip Vertical')) })
          .add('spot.mode', { label: 'Spot Mode', palette: false, run: (ctx: any, mode: SpotMode) => ctx.set({ finish: { spot: { mode } } }) })
          .add('spot.size', {
            label: 'Spot Size', palette: false,
            run: (ctx: any, by: number) => ctx.set({ finish: { spot: { r: Math.max(1, Math.min(500, Math.round(opts(ctx.state).spot.r * (by > 0 ? 1.2 : 1 / 1.2)))) } } }),
          })
          .add('spot.delete', {
            label: 'Delete Spot', menu: 'Finish', enabled: spotCommandsEnabled, why: 'Click a spot to select it',
            run: withFrame((ctx, fr, id?: string) => deleteSpots(ctx, fr, [id ?? ctx.state.finish.selected], 'Delete Spot')),
          })
          .add('spot.clear', {
            label: 'Clear All Spots', menu: 'Finish',
            enabled: (s: any) => spotsOf(s.recipes?.[current(s) ?? '']).length > 0, why: 'No spots on this frame',
            run: withFrame((ctx, fr) => deleteSpots(ctx, fr, spotsOf(fr.r).map((x) => x.id), 'Clear All Spots')),
          })
          .add('spot.show', { label: 'Show Spots', menu: 'Finish', checked: (s: any) => s.finish?.show !== false, run: (ctx: any) => ctx.set({ finish: { show: !opts(ctx.state).show } }) })
          .add('spot.next', { label: 'Next Spot', palette: false, run: (ctx: any) => cycle(ctx, 1) })
          .add('spot.prev', { label: 'Previous Spot', palette: false, run: (ctx: any) => cycle(ctx, -1) })
          .add('spot.select', { label: 'Select Spot', palette: false, run: (ctx: any, id: string | null) => ctx.set({ finish: { selected: id } }) })
          .add('finish.toggle', {
            label: 'Before / After Finishing', menu: 'Finish',
            checked: (s: any) => !!s.finish?.bypass,
            run: (ctx: any) => ctx.set({ finish: { bypass: !opts(ctx.state).bypass } }),
          })
          .add('finish.resetTones', {
            label: 'Reset Finishing Tones', menu: 'Finish', ...needFrame,
            run: withFrame((ctx, fr) => ctx.tx('Reset Finishing Tones', (t: any) => {
              for (const p of FINISHING_PATHS) if (fr.r.finishing.values[p.split('.').pop()!] !== undefined) t.$set(['recipes', fr.f, ...p.split('.')], 0);
            })),
          });
      })
      .docs(FINISH_DOCS);
  });

  function cycle(ctx: any, dir: number): void {
    const list = spotsOf(ctx.state.recipes?.[current(ctx.state) ?? '']);
    if (!list.length) return;
    const i = list.findIndex((x) => x.id === ctx.state.finish?.selected);
    ctx.set({ finish: { selected: list[(i + dir + list.length) % list.length]!.id } });
  }

  // ── builder calls ──
  /** the print as the finish module shows it: retouch and finishing dropped while finish.toggle is on */
  const shown = (s: any): ImageHandle | null => {
    const h = cb.frame(s)?.print() ?? null;
    if (!h || !s.finish?.bypass || h.recipe === 'initial') return h;
    const r = setPath(setPath(h.recipe, 'retouch.spots', {}), 'finishing.values', {});
    return frameRef(h.frame, r, `${h.expr} /* before finishing */`).print();
  };
  const viewer = (o: Record<string, unknown> = {}) => cb.viewer(shown, { id: 'finish', tools: ['crop', 'spot'], compare: true, ...o } as any);
  const aspectOptions = (list: readonly string[]) => list.map((a) => ({ value: a, label: a === 'original' ? 'Original' : a === 'free' ? 'Free' : a }));
  const cropPanel = (o: { id?: string; title?: string; aspects?: readonly string[] } = {}) =>
    ck.panel(o.id ?? 'finish-crop', { title: o.title ?? 'Crop & straighten' },
      ck.row({ class: 'cb-finish-tools' }, ck.ui.command('tool.crop', { text: 'Crop (R)', small: true }), ck.ui.command('crop.done', { text: 'Done', small: true })),
      ck.ui.select(aspectOptions(o.aspects ?? ASPECTS), { bind: (s: any) => s.finish.crop.aspect, set: 'crop.aspect', label: 'Aspect' } as any),
      ck.ui.toggle('Lock aspect', { bind: (s: any) => s.finish.crop.locked } as any),
      ck.text((s: any) => {
        const r = s.recipes?.[current(s) ?? ''] as FrameRecipe | undefined;
        if (!r) return 'No frame';
        const f = r.view.frame;
        return `${f.crop ? `${f.crop.w} × ${f.crop.h} px` : 'Whole frame'} · ${f.angle_deg.toFixed(1)}° · ${f.orientation}`;
      }, { dim: true, class: 'cb-crop-readout' } as any),
      ck.row({ class: 'cb-finish-angle' },
        ck.ui.button('−1°', { run: ['crop.straighten', -1], small: true } as any),
        ck.ui.button('−0.1°', { run: ['crop.straighten', -0.1], small: true } as any),
        ck.ui.button('0°', { run: ['crop.straighten', { to: 0 }], small: true } as any),
        ck.ui.button('+0.1°', { run: ['crop.straighten', 0.1], small: true } as any),
        ck.ui.button('+1°', { run: ['crop.straighten', 1], small: true } as any)),
      ck.row({ class: 'cb-finish-orient' },
        ck.ui.command('orient.ccw', { text: '⟲', small: true }), ck.ui.command('orient.cw', { text: '⟳', small: true }),
        ck.ui.command('orient.flipH', { text: '⇋', small: true }), ck.ui.command('orient.flipV', { text: '⇵', small: true }),
        ck.ui.command('crop.swap', { text: 'Swap', small: true }), ck.ui.command('crop.reset', { text: 'Reset', small: true })),
      ck.text((s: any) => {
        const f = current(s);
        const z = f ? sizes.get(f) : undefined;
        const p = f && z && s.recipes?.[f] ? cropProblem(s.recipes[f], z.W, z.H) : null;
        return p ? `${p.code}: ${p.message}` : '';
      }, { class: 'cb-warn' } as any),
    );
  const retouchPanel = (o: { id?: string; title?: string; modes?: SpotMode[] } = {}) =>
    ck.panel(o.id ?? 'finish-retouch', { title: o.title ?? 'Spot removal' },
      ck.row({ class: 'cb-finish-tools' }, ck.ui.command('tool.spot', { text: 'Spots (Q)', small: true }), ck.ui.command('spot.show', { text: 'Show', small: true })),
      ck.ui.segmented((o.modes ?? ['heal', 'clone', 'dust']).map((m) => ({ value: m, label: m === 'dust' ? 'Dust (on the film)' : m === 'heal' ? 'Heal' : 'Clone' })), { bind: (s: any) => s.finish.spot.mode, label: 'Mode', small: true } as any),
      ck.ui.slider(1, 200, { bind: (s: any) => s.finish.spot.r, label: 'Size', step: 1, unit: 'px', decimals: 0 } as any),
      ck.ui.slider(0, 1, { bind: (s: any) => s.finish.spot.feather, label: 'Feather', step: 0.05, decimals: 2 } as any),
      ck.ui.slider(0, 1, { bind: (s: any) => s.finish.spot.opacity, label: 'Opacity', step: 0.05, decimals: 2 } as any),
      ck.view.list((s: any) => spotsOf(s.recipes?.[current(s) ?? '']), {
        id: 'finish-spots',
        key: (x: SpotRef) => x.id,
        row: (x: SpotRef) => ck.row({ class: 'cb-spot-row' },
          ck.ui.button(`${x.id} · ${x.mode} · r ${x.r}`, { run: ['spot.select', x.id], small: true, quiet: true } as any),
          ck.ui.button('✕', { run: ['spot.delete', x.id], small: true, quiet: true } as any)),
        empty: 'No spots: choose the tool (Q) and click a speck',
      } as any),
      ck.row({ class: 'cb-finish-spot-cmds' }, ck.ui.command('spot.delete', { text: 'Delete', small: true }), ck.ui.command('spot.clear', { text: 'Clear all', small: true })),
      ck.text('Heal and clone work on the print; Dust works on the film (scan.heal) where the engine has it.', { dim: true } as any),
    );
  const tonesPanel = (o: { id?: string; title?: string; only?: string[] } = {}) =>
    ck.panel(o.id ?? 'finish-tones', { title: o.title ?? 'Finishing (digital, after the print)' },
      ck.text('Not darkroom controls: they change the finished print digitally.', { dim: true } as any),
      ...FINISHING_PATHS.filter((p) => !o.only || o.only.some((x) => p.endsWith(x))).map((p) => cb.arg(p, { why: 'finishing, not darkroom' })),
      ck.row({ class: 'cb-finish-tone-cmds' }, ck.ui.command('finish.toggle', { text: 'Before / after', small: true }), ck.ui.command('finish.resetTones', { text: 'Reset', small: true })),
    );

  return {
    kit,
    state: FINISH_STATE,
    viewer,
    shown,
    cropPanel,
    retouchPanel,
    tonesPanel,
    /** the finish module's keys: X swaps the aspect, Delete removes the selected spot, [ ] size the brush */
    keys: { X: 'crop.swap', Enter: 'crop.done', Delete: 'spot.delete', Backspace: 'spot.delete', '[': ['spot.size', -1], ']': ['spot.size', 1], 'Shift+[': 'spot.prev', 'Shift+]': 'spot.next', '\\': 'finish.toggle' } as Record<string, any>,
    edits,
    spots: spotsOf,
    cropProblem,
    largestCrop,
  };
}

export type FinishKit = ReturnType<typeof createFinishKit>;

const LOOK: Record<string, Record<string, string>> = {
  'cb-crop-shade': { fill: 'rgba(0,0,0,0.55)', stroke: 'none' },
  'cb-crop-frame': { fill: 'none', stroke: 'rgba(255,255,255,0.95)', 'stroke-width': '1.5' },
  'cb-crop-thirds': { fill: 'none', stroke: 'rgba(255,255,255,0.45)', 'stroke-width': '1' },
  'cb-crop-handle': { fill: '#fff', stroke: 'rgba(0,0,0,0.6)', 'stroke-width': '1' },
  'cb-crop-label': { fill: '#fff', 'font-size': '11', 'paint-order': 'stroke', stroke: 'rgba(0,0,0,0.7)', 'stroke-width': '3' },
  'cb-spot': { fill: 'none', stroke: 'rgba(255,255,255,0.9)', 'stroke-width': '1.5' },
  'cb-spot-src': { 'stroke-dasharray': '4 3' },
  'cb-spot-line': { stroke: 'rgba(255,255,255,0.6)', 'stroke-width': '1' },
  'is-selected': { stroke: '#ffd24a', 'stroke-width': '2' },
  'is-off': { stroke: 'rgba(160,160,160,0.6)' },
  'is-dust': { stroke: 'rgba(120,200,255,0.9)' },
  'cb-spot-brush': { fill: 'none', stroke: 'rgba(255,255,255,0.8)', 'stroke-width': '1', 'stroke-dasharray': '2 2' },
};

// ── passes ──
function walk(n: unknown, f: (n: NodeData) => void, seen = new Set<unknown>()): void {
  if (!n || typeof n !== 'object' || seen.has(n)) return;
  seen.add(n);
  const d = n as NodeData;
  if (typeof d.$ === 'string' && d.props) {
    f(d);
    for (const k of d.kids ?? []) walk(k, f, seen);
    for (const v of Object.values(d.props)) {
      if (Array.isArray(v)) for (const x of v) walk(x, f, seen);
      else if (v && typeof v === 'object') {
        walk(v, f, seen);
        for (const x of Object.values(v as object)) walk(x, f, seen);
      }
    }
  }
}
/** CB-F101: a finishing control in a module labelled Print or Darkroom; CB-F102: finish tools without the kit. */
export function finishPasses(ck: Ck): { labelPass: any; framePass: any } {
  const label = ck.pass('cb.finish.label', { on: 'ui', after: 'slots' }, (ir: any, p) => {
    for (const m of ir.modules as { id: string; label: string; regions: Record<string, NodeData | null> }[]) {
      if (!/print|darkroom/i.test(m.label ?? '')) continue;
      for (const r of Object.values(m.regions ?? {})) walk(r, (n) => {
        if (n.$ === 'cb.arg' && String(n.props['path'] ?? '').startsWith('finishing.'))
          p.warn('CB-F101', `cb.arg('${n.props['path']}') is a finishing control in the module '${m.label}'`, { at: n.at, facts: ['finishing tones are digital, after the print; the Print module is physical'], fix: 'move it to a Finish module (cb.kits.finish.tonesPanel()) or relabel the module' });
      });
    }
  });
  const frame = ck.pass('cb.finish.tools', { on: 'ui', after: 'slots' }, (ir: any, p) => {
    for (const n of ir.find('viewport') as NodeData[]) {
      const tools = (n.props['tools'] as string[] | undefined) ?? [];
      if ((tools.includes('crop') || tools.includes('spot')) && !ir.kits.some((k: any) => k.name === 'cb.finish'))
        p.error('CB-F102', `viewer '${n.props['id']}' lists the finish tools, but the finish kit is not installed`, { at: n.at, fix: '.use(cb.kits.finish.kit) on the studio' });
    }
  });
  return { labelPass: label, framePass: frame };
}
