// cb.kits.finish: the viewport tools (split from kit.ts, CHB-032): crop and straighten (R), spot heal, clone and
// dust (Q): gestures that write the document's geometry and its spot layers (print-stage heal/clone in the Retouch
// group, scan-stage heal in the Dust group), and their SVG overlays.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Box, Document as Doc, Geometry as FrameSettings } from '@chromobench/contract';
import { canvasToSource, centreOf, constrain, cropCorners, cropOf, fitsInside, rotate, roundBox, sensorTurn, shownContains, sourceToCanvas, swapsAxes, toShown, toSource, towards, type Pt } from './geometry.ts';
import { suggestSource, type ProxyImage } from './suggest.ts';
import { plain, spotsOf, nextSpotId, spotData, spotHome, stackWithSpot, type HealSpotData } from './state.ts';
import { DOCS } from '../../../src/model/doc.ts';
import { sel } from '../../../src/sel.ts';
import type { FinishContext } from './context.ts';

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

export function createFinishTools(F: FinishContext) {
  const { frameOf, sizeIn, sizes, remember, opts, framePath, normalise, dustAvailable, lockAspect } = F;
  // ── the crop tool ──
  const HANDLE_PX = 9;
  const canvasOf = (r: Doc): Doc => ({ ...r, geometry: { orientation: r.geometry.orientation, angle_deg: 0, crop: null } });
  const screenOf = (vp: any, fr: { W: number; H: number; r: Doc }, f: FrameSettings, p: Pt): [number, number] => {
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

  interface CropG { fr: { f: string; W: number; H: number; r: Doc }; start: FrameSettings; box0: Box; mode: 'move' | 'resize' | 'rotate'; hx: number; hy: number; p0: Pt; a0: number; last: Box; cur: FrameSettings | null }
  const cropDown = (e: any, ctx: any): CropG | false => {
    const fr = frameOf(ctx);
    if (!fr) return false;
    remember(fr);
    if (e.detail === 2) {
      ctx.run('crop.done');
      return false;
    }
    const start = plain(fr.r.geometry);
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
    const x = (g.ownerDocument as globalThis.Document).createElementNS('http://www.w3.org/2000/svg', tag);
    // presentation inline, so every host draws the overlay without a stylesheet
    const look = String(a['class'] ?? '').split(' ').map((c) => LOOK[c]).filter(Boolean).reduce((o, l) => ({ ...o, ...l }), {} as Record<string, string>);
    for (const [k, v] of Object.entries({ ...look, ...a })) x.setAttribute(k, String(v));
    if (text !== undefined) x.textContent = text;
    g.append(x);
    return x;
  };
  const cropOverlay = (g: any, vp: any, s: any): void => {
    const f = sel.current(s);
    const r = f ? (s.docs?.[f] as Doc | undefined) : undefined;
    const z = sizeIn(s) ?? (r && vp ? { W: swapsAxes(r.geometry.orientation) ? vp.natural()[1] : vp.natural()[0], H: swapsAxes(r.geometry.orientation) ? vp.natural()[0] : vp.natural()[1] } : null);
    if (!r || !z) return;
    const fr = { W: z.W, H: z.H, r };
    const fs = r.geometry;
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
  interface SpotG { fr: { f: string; W: number; H: number; r: Doc }; kind: 'new' | 'target' | 'source'; id: string; spot: HealSpotData; dust: boolean; op: 'heal' | 'clone'; moved: boolean; e0: { sx: number; sy: number }; p0: Pt; hover?: undefined }
  const spotScreen = (vp: any, f: FrameSettings, W: number, H: number, p: Pt): [number, number] => {
    const q = toShown(f, W, H, p.x, p.y);
    return vp.docToScreen(q.x, q.y);
  };
  const spotDown = (e: any, ctx: any): SpotG | false => {
    const fr = frameOf(ctx);
    if (!fr) return false;
    remember(fr);
    const fs = fr.r.geometry;
    const p = toSource(fs, fr.W, fr.H, e.x, e.y);
    const o = opts(ctx.state).spot;
    const vp = ctx.vp;
    // an existing spot: its source pin, then its disc (the newest first)
    if (vp) {
      const sc = vp.scale?.() ?? 1;
      for (const s of [...spotsOf(fr.r)].reverse()) {
        const base = spotData(fr.r, s.id)!;
        const dust = s.kind === 'dust';
        const op = s.mode === 'clone' ? 'clone' : 'heal';
        if (s.src) {
          const [sx, sy] = spotScreen(vp, fs, fr.W, fr.H, s.src);
          if (Math.hypot(sx - e.sx, sy - e.sy) <= Math.max(7, s.r * sc * 0.5)) {
            ctx.set({ finish: { selected: s.id } });
            return { fr, kind: 'source', id: s.id, spot: plain(base), dust, op, moved: false, e0: { sx: e.sx, sy: e.sy }, p0: p };
          }
        }
        const [tx, ty] = spotScreen(vp, fs, fr.W, fr.H, s);
        if (Math.hypot(tx - e.sx, ty - e.sy) <= Math.max(7, s.r * sc)) {
          ctx.set({ finish: { selected: s.id } });
          return { fr, kind: 'target', id: s.id, spot: plain(base), dust, op, moved: false, e0: { sx: e.sx, sy: e.sy }, p0: p };
        }
      }
    }
    if (p.x < 0 || p.y < 0 || p.x > fr.W || p.y > fr.H) return false;
    const dust = o.mode === 'dust' && dustAvailable(ctx, fr.r);
    const op = o.mode === 'clone' && !dust ? 'clone' : 'heal';
    const id = nextSpotId(fr.r, dust ? 'dust' : 'retouch');
    const r = Math.max(1, Number(o.r) || 12);
    const spot: HealSpotData = { x: round2(p.x), y: round2(p.y), r, src: { x: round2(p.x), y: round2(p.y) }, feather: dust ? 0.3 : o.feather, opacity: dust ? 1 : o.opacity };
    return { fr, kind: 'new', id, spot, dust, op, moved: false, e0: { sx: e.sx, sy: e.sy }, p0: p };
  };
  const round2 = (v: number): number => Math.round(v * 100) / 100;
  const insideFrame = (p: Pt, r: number, W: number, H: number): Pt => ({ x: round2(Math.min(W - r, Math.max(r, p.x))), y: round2(Math.min(H - r, Math.max(r, p.y))) });
  /** the stage's stack with the spot as the gesture has it, shown over the document (committed on release) */
  const previewSpot = (ctx: any, g: SpotG): void => {
    const kind = g.dust ? 'dust' : 'retouch';
    ctx.preview([DOCS, g.fr.f, 'stages', spotHome(kind).stage, 'stack'], plain(stackWithSpot(g.fr.r, kind, g.id, g.spot, g.op)));
  };
  const spotDrag = (e: any, ctx: any, g: SpotG): SpotG => {
    if (!g.moved && Math.hypot(e.sx - g.e0.sx, e.sy - g.e0.sy) < 3) return g;
    g.moved = true;
    const { W, H } = g.fr;
    const p = toSource(g.fr.r.geometry, W, H, e.x, e.y);
    const s = g.spot;
    if (g.kind === 'new' || g.kind === 'source') {
      // the source pin follows the pointer and refuses to leave the picture
      s.src = insideFrame(p, s.r, W, H);
    } else {
      // move the target (and its source with it)
      const dx = p.x - g.p0.x, dy = p.y - g.p0.y;
      const base = spotData(g.fr.r, g.id)!;
      s.x = round2(base.x + dx);
      s.y = round2(base.y + dy);
      s.src = insideFrame({ x: base.src.x + dx, y: base.src.y + dy }, s.r, W, H);
    }
    previewSpot(ctx, g);
    return g;
  };
  const spotUp = (_e: any, ctx: any, g: SpotG): void => {
    if (g.kind !== 'new' && !g.moved) return void ctx.cancel();
    if (g.kind === 'new' && !g.moved) {
      // a click: the source is found on what the viewer shows (a proxy), then written into the spot (dust too:
      // every heal layer has an explicit source)
      const s = g.spot;
      s.src = sourceFor(ctx, g.fr, s) ?? insideFrame({ x: s.x + 2.5 * s.r, y: s.y }, s.r, g.fr.W, g.fr.H);
    }
    previewSpot(ctx, g);
    ctx.commit(g.kind === 'new' ? (g.dust ? 'Remove Dust' : 'Remove Spot') : 'Move Spot');
    if (g.kind === 'new') ctx.set({ finish: { selected: g.id } });
  };
  /** suggestSource on the viewer's shown image (shown px), mapped to sensor px */
  const sourceFor = (ctx: any, fr: { W: number; H: number; r: Doc }, s: HealSpotData): Pt | null => {
    const img = ctx.vp?.shown?.()?.image as ProxyImage | undefined;
    if (!img?.data) return null;
    const fs = fr.r.geometry;
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
    const f = sel.current(s);
    const r = f ? (s.docs?.[f] as Doc | undefined) : undefined;
    const z = f ? sizes.get(f) : undefined;
    if (!r) return;
    const o = opts(s);
    const fs = r.geometry;
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
  return { canvasOf, cropDown, cropDrag, cropUp, cropOverlay, spotDown, spotDrag, spotUp, spotOverlay };
}
export type FinishTools = ReturnType<typeof createFinishTools>;
