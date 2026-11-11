// Develop's tools: Crop (R), Spot Removal (Q), and masks — Brush (K), Linear (M), Radial (Shift+M).
// Each is a gesture: down returns the gesture's state, drag previews, up commits one undo step. Geometry is
// LightCraft's: crops in the rotated frame, spots and masks in the uncropped photo, all normalized.
import { ck } from '../shell/index.js';
import { h, icon, svgEl } from '../shell/ui/dom.js';
import { devOf, primaryId, fmtSigned, constrainCrop, cropFits } from './develop-model.js';
import { primaryOf } from './catalog.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const UNIT = { x0: 0, y0: 0, x1: 1, y1: 1 };
const opt = (s, tool) => (s.ui.toolOptions && s.ui.toolOptions[tool]) || {};
const devPath = (s, ...rest) => ['dev', primaryId(s), ...rest];

// ── coordinates: the shown (cropped) image ↔ the uncropped photo ──
export function toSource(dev, photo, u, v) {
  const r = dev.crop.geometry.rect, a = (dev.crop.geometry.angle || 0) * Math.PI / 180, W = photo.w, H = photo.h;
  const fx = (r.x0 + u * (r.x1 - r.x0)) * W, fy = (r.y0 + v * (r.y1 - r.y0)) * H, cx = W / 2, cy = H / 2;
  const x = cx + (fx - cx) * Math.cos(a) + (fy - cy) * Math.sin(a), y = cy - (fx - cx) * Math.sin(a) + (fy - cy) * Math.cos(a);
  return { x: x / W, y: y / H };
}
export function toShown(dev, photo, x, y) {
  const r = dev.crop.geometry.rect, a = (dev.crop.geometry.angle || 0) * Math.PI / 180, W = photo.w, H = photo.h, cx = W / 2, cy = H / 2;
  const px = x * W, py = y * H;
  const fx = cx + (px - cx) * Math.cos(a) - (py - cy) * Math.sin(a), fy = cy + (px - cx) * Math.sin(a) + (py - cy) * Math.cos(a);
  return { u: (fx / W - r.x0) / (r.x1 - r.x0), v: (fy / H - r.y0) / (r.y1 - r.y0) };
}
const longEdge = (vp) => { const [w, hh] = vp.natural(); return Math.max(w, hh) * vp.scale(); };   // screen px of the shown image's long side

// ── Crop ────────────────────────────────────────────────────────────────
const ASPECTS = { original: null, free: null, '1x1': 1, '4x5': 4 / 5, '5x7': 5 / 7, '2x3': 2 / 3, '16x9': 16 / 9, '8.5x11': 8.5 / 11 };
function aspectOf(s, photo) {
  const o = opt(s, 'crop'); const k = o.aspect || 'original';
  if (k === 'free') return null;
  let r = k === 'original' ? photo.w / photo.h : ASPECTS[k];
  if (r && o.portrait !== undefined && k !== 'original') r = o.portrait ? Math.min(r, 1 / r) : Math.max(r, 1 / r);
  return o.locked === false ? null : r;
}
function fitAspect(rect, ratio, photo, anchor) {
  if (!ratio) return rect;
  const W = photo.w, H = photo.h;
  let w = (rect.x1 - rect.x0) * W, hh = (rect.y1 - rect.y0) * H;
  if (w / hh > ratio) w = hh * ratio; else hh = w / ratio;
  const ax = anchor ? anchor.x : (rect.x0 + rect.x1) / 2, ay = anchor ? anchor.y : (rect.y0 + rect.y1) / 2;
  const sx = anchor ? anchor.sx : 0.5, sy = anchor ? anchor.sy : 0.5;
  const x0 = ax - sx * w / W, y0 = ay - sy * hh / H;
  return { x0, y0, x1: x0 + w / W, y1: y0 + hh / H };
}
const HANDLES = [['nw', 0, 0], ['n', 0.5, 0], ['ne', 1, 0], ['e', 1, 0.5], ['se', 1, 1], ['s', 0.5, 1], ['sw', 0, 1], ['w', 0, 0.5]];
function cropHit(vp, rect, e) {
  for (const [name, fx, fy] of HANDLES) { const [x, y] = vp.toScreen(rect.x0 + fx * (rect.x1 - rect.x0), rect.y0 + fy * (rect.y1 - rect.y0)); if (Math.abs(e.sx - x) < 9 && Math.abs(e.sy - y) < 9) return name; }
  if (e.u > rect.x0 && e.u < rect.x1 && e.v > rect.y0 && e.v < rect.y1) return 'move';
  return 'rotate';
}
const CURSORS = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', move: 'move', rotate: 'alias' };

export function cropTool(t) {
  t.tool('crop', {
    label: 'Crop Overlay', icon: 'crop', key: 'R', enabled: s => !!primaryId(s), why: 'Select a photo first',
    on: {
      enter: ctx => ctx.set({ ui: { cropStart: devOf(ctx.state).crop.geometry } }),
      hover: (e, ctx) => { const g = devOf(ctx.state).crop.geometry; const hit = cropHit(ctx.vp, g.rect, e); ctx.vp.setCursor(CURSORS[hit]); return { hover: hit }; },
      down: (e, ctx) => {
        const s = ctx.state, g = devOf(s).crop.geometry, photo = primaryOf(s);
        return { mode: cropHit(ctx.vp, g.rect, e), start: g, e0: e, photo, ratio: aspectOf(s, photo), path: devPath(s, 'crop', 'geometry') };
      },
      drag: (e, ctx, g) => {
        const r0 = g.start.rect; let rect = Object.assign({}, r0), angle = g.start.angle;
        const du = e.u - g.e0.u, dv = e.v - g.e0.v;
        if (g.mode === 'move') { const w = r0.x1 - r0.x0, hh = r0.y1 - r0.y0; const x0 = clamp(r0.x0 + du, 0, 1 - w), y0 = clamp(r0.y0 + dv, 0, 1 - hh); rect = { x0, y0, x1: x0 + w, y1: y0 + hh }; }
        else if (g.mode === 'rotate') {
          const [cx, cy] = ctx.vp.toScreen((r0.x0 + r0.x1) / 2, (r0.y0 + r0.y1) / 2);
          const a0 = Math.atan2(g.e0.sy - cy, g.e0.sx - cx), a1 = Math.atan2(e.sy - cy, e.sx - cx);
          angle = clamp(Math.round((g.start.angle + (a1 - a0) * 180 / Math.PI) * 100) / 100, -45, 45);
        } else {
          if (g.mode.includes('w')) rect.x0 = clamp(r0.x0 + du, 0, r0.x1 - 0.02);
          if (g.mode.includes('e')) rect.x1 = clamp(r0.x1 + du, r0.x0 + 0.02, 1);
          if (g.mode.includes('n')) rect.y0 = clamp(r0.y0 + dv, 0, r0.y1 - 0.02);
          if (g.mode.includes('s')) rect.y1 = clamp(r0.y1 + dv, r0.y0 + 0.02, 1);
          const ratio = e.shift && !g.ratio ? (r0.x1 - r0.x0) * g.photo.w / ((r0.y1 - r0.y0) * g.photo.h) : g.ratio;
          if (ratio) {
            const ax = g.mode.includes('w') ? rect.x1 : g.mode.includes('e') ? rect.x0 : (rect.x0 + rect.x1) / 2;
            const ay = g.mode.includes('n') ? rect.y1 : g.mode.includes('s') ? rect.y0 : (rect.y0 + rect.y1) / 2;
            rect = fitAspect(rect, ratio, g.photo, { x: ax, y: ay, sx: g.mode.includes('w') ? 1 : g.mode.includes('e') ? 0 : 0.5, sy: g.mode.includes('n') ? 1 : g.mode.includes('s') ? 0 : 0.5 });
          }
          rect = { x0: clamp(rect.x0, 0, 1), y0: clamp(rect.y0, 0, 1), x1: clamp(rect.x1, 0, 1), y1: clamp(rect.y1, 0, 1) };
        }
        // a straightened crop stays inside the picture: rotating shrinks it, a move that would leave it stops at the edge
        if (angle) {
          if (g.mode === 'move') { if (!cropFits({ rect, angle }, g.photo)) return g; }
          else rect = constrainCrop({ rect: g.mode === 'rotate' ? (g.start.full || r0) : rect, angle }, g.photo).rect;
        }
        ctx.preview(g.path, { rect, angle });
        return Object.assign({}, g, { live: g.mode });
      },
      up: (e, ctx, g) => ctx.commit(g.mode === 'rotate' ? 'Straighten' : 'Crop Rectangle', { detail: g.mode === 'rotate' ? `${fmtSigned(devOf(ctx.state).crop.geometry.angle, 1)}°` : undefined }),
      escape: ctx => { const st = ctx.state.ui.cropStart; const id = primaryId(ctx.state); if (st && id && devOf(ctx.state).crop.geometry !== st) ctx.tx('Cancel Crop', t => { t.dev[id].crop.geometry = st; }); ctx.app.selectTool(null); },
    },
    overlay(g, vp, s, ts) {
      if (!primaryId(s)) return;
      const p0 = primaryOf(s), geo = p0 ? constrainCrop(devOf(s).crop.geometry, p0) : devOf(s).crop.geometry, r = geo.rect;
      const [x0, y0] = vp.toScreen(r.x0, r.y0), [x1, y1] = vp.toScreen(r.x1, r.y1);
      const [ix0, iy0] = vp.toScreen(0, 0), [ix1, iy1] = vp.toScreen(1, 1);
      g.append(svgEl('path', { d: `M${ix0} ${iy0}H${ix1}V${iy1}H${ix0}Z M${x0} ${y0}V${y1}H${x1}V${y0}Z`, class: 'dv-crop-shade', 'fill-rule': 'evenodd' }));
      const third = ts && ts.live === 'rotate' ? 8 : 3;
      let d = '';
      for (let i = 1; i < third; i++) { const x = x0 + (x1 - x0) * i / third, y = y0 + (y1 - y0) * i / third; d += `M${x} ${y0}V${y1}M${x0} ${y}H${x1}`; }
      g.append(svgEl('path', { d, class: 'dv-crop-grid' }));
      g.append(svgEl('rect', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, class: 'dv-crop-frame' }));
      for (const [name, fx, fy] of HANDLES) { const x = x0 + fx * (x1 - x0), y = y0 + fy * (y1 - y0); const corner = name.length === 2; g.append(svgEl('path', { d: corner ? `M${x + (fx ? -14 : 14)} ${y}H${x}V${y + (fy ? -14 : 14)}` : fx === 0.5 ? `M${x - 9} ${y}H${x + 9}` : `M${x} ${y - 9}V${y + 9}`, class: 'dv-crop-h' })); }
      const p = primaryOf(s);
      const label = ts && ts.live === 'rotate' ? `${fmtSigned(geo.angle, 1)}°` : p ? `${Math.round((r.x1 - r.x0) * p.w)} × ${Math.round((r.y1 - r.y0) * p.h)}` : '';
      if (label) { const tx = svgEl('text', { x: (x0 + x1) / 2, y: y1 + 18, class: 'dv-crop-t', 'text-anchor': 'middle' }); tx.textContent = label; g.append(tx); }
    },
  });
}
export function cropOptions() {
  return ck.panel('crop-options', { title: 'Crop & Straighten', fixed: true },
    ck.row(ck.text('Aspect', { dim: true }), ck.ui.select(Object.keys(ASPECTS).map(k => ({ value: k, label: k === 'original' ? 'Original' : k === 'free' ? 'Custom (free)' : k.replace('x', ' × ') })), { bind: s => s.ui.toolOptions.crop.aspect, compact: true, grow: 1, historyLabel: 'Aspect', set: (v, ctx) => setAspect(ctx, v) }),
      ck.ui.iconButton('lock', { tip: 'Lock the aspect (A)', checked: s => s.ui.toolOptions.crop.locked !== false, run: 'crop.lock' })),
    ck.ui.slider(-45, 45, { bind: s => devOf(s).crop.geometry.angle, label: 'Angle', step: 0.05, decimals: 2, reset: 0, bipolar: true, historyLabel: 'Straighten', unit: '°' }),
    ck.row(ck.ui.command('crop.swap', { small: true, text: 'Swap (X)' }), ck.ui.command('crop.reset', { small: true, text: 'Reset' }), ck.spacer(), ck.ui.command('crop.done', { small: true, primary: true, text: 'Done' })));
}
// choosing an aspect reshapes the crop at once (around its centre, as large as fits)
function setAspect(ctx, k) {
  const s = ctx.state, o = opt(s, 'crop');
  ctx.set({ ui: { toolOptions: { crop: Object.assign({}, o, { aspect: k, locked: k !== 'free' }) } } });
  const id = primaryId(s), p = primaryOf(s); if (!id || !p) return;
  const ratio = aspectOf(ctx.state, p); if (!ratio) return;
  const g = devOf(s).crop.geometry, r = g.rect;
  // the largest rectangle of that shape inside the current one's bounds, then inside the picture
  const W = p.w, H = p.h, cw = (r.x1 - r.x0) * W, ch = (r.y1 - r.y0) * H;
  let w = cw, hh = cw / ratio; if (hh > ch) { hh = ch; w = ch * ratio; }
  const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
  const rect = { x0: cx - w / W / 2, y0: cy - hh / H / 2, x1: cx + w / W / 2, y1: cy + hh / H / 2 };
  ctx.tx(`Crop Aspect: ${k === 'original' ? 'Original' : k.replace('x', ' × ')}`, t => { t.dev[id].crop.geometry = constrainCrop({ rect, angle: g.angle }, p); });
}
export function cropCommands(c) {
  const on = s => s.ui.tool === 'crop';
  c.add('crop.done', { label: 'Apply Crop', palette: false, run: ctx => ctx.app.selectTool(null) })
    .add('crop.lock', { label: 'Lock Crop Aspect', checked: s => opt(s, 'crop').locked !== false, run: ctx => ctx.set({ ui: { toolOptions: { crop: Object.assign({}, opt(ctx.state, 'crop'), { locked: opt(ctx.state, 'crop').locked === false }) } } }) })
    .add('crop.swap', { label: 'Swap Crop Orientation', enabled: on, why: 'Open the crop tool (R) first', run: ctx => {
      const s = ctx.state, id = primaryId(s), p = primaryOf(s), g = devOf(s).crop.geometry, r = g.rect;
      const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2, w = (r.x1 - r.x0) * p.w, hh = (r.y1 - r.y0) * p.h;
      let nw = hh / p.w, nh = w / p.h; const k = Math.min(1, 1 / nw, 1 / nh); nw *= k; nh *= k;
      const x0 = clamp(cx - nw / 2, 0, 1 - nw), y0 = clamp(cy - nh / 2, 0, 1 - nh);
      ctx.tx('Swap Crop Orientation', t => { t.dev[id].crop.geometry = { rect: { x0, y0, x1: x0 + nw, y1: y0 + nh }, angle: g.angle }; });
      ctx.set({ ui: { toolOptions: { crop: Object.assign({}, opt(s, 'crop'), { portrait: !(opt(s, 'crop').portrait) }) } } });
    } })
    .add('crop.reset', { label: 'Reset Crop', enabled: s => !!primaryId(s), why: 'Select a photo first', run: ctx => { const id = primaryId(ctx.state); ctx.tx('Reset Crop', t => { t.dev[id].crop.geometry = { rect: UNIT, angle: 0 }; }); } });
}

// ── Spot removal ────────────────────────────────────────────────────────
export function healTool(t) {
  t.tool('heal', {
    label: 'Spot Removal', icon: 'heal', key: 'Q', enabled: s => !!primaryId(s), why: 'Select a photo first', cursor: 'crosshair',
    on: {
      hover: (e, ctx) => ({ at: e }),
      leave: () => {},
      down: (e, ctx) => {
        const s = ctx.state, dev = devOf(s), p = primaryOf(s); if (!p || !e.inside) return false;
        const src = toSource(dev, p, e.u, e.v);
        const spots = dev.spots || [];
        const hit = spots.findIndex(sp => { const q = sp.points[0]; const sh = toShown(dev, p, q.x, q.y); const [sx, sy] = ctx.vp.toScreen(sh.u, sh.v); return Math.hypot(sx - e.sx, sy - e.sy) < Math.max(8, sp.size * longEdge(ctx.vp)); });
        if (hit >= 0) { ctx.set({ ui: { spot: hit } }); return { mode: 'move', index: hit, start: spots[hit], src0: src, path: devPath(s, 'spots') }; }
        const o = opt(s, 'heal');
        const spot = { mode: o.mode || 'heal', points: [src], size: o.size || 0.025, feather: o.feather ?? 50, opacity: o.opacity ?? 100, source_offset: null };
        ctx.preview(devPath(s, 'spots'), spots.concat([spot]));
        ctx.set({ ui: { spot: spots.length } });
        return { mode: 'new', index: spots.length, spot, path: devPath(s, 'spots'), base: spots };
      },
      drag: (e, ctx, g) => {
        const s = ctx.state, dev = devOf(s), p = primaryOf(s);
        const src = toSource(dev, p, e.u, e.v);
        if (g.mode === 'move') { const dx = src.x - g.src0.x, dy = src.y - g.src0.y; const sp = Object.assign({}, g.start, { points: g.start.points.map(q => ({ x: q.x + dx, y: q.y + dy })) }); const list = (dev.spots || []).slice(); list[g.index] = sp; ctx.preview(g.path, list); return g; }
        const last = g.spot.points[g.spot.points.length - 1];
        if (Math.hypot(src.x - last.x, src.y - last.y) < g.spot.size * 0.4) return g;
        const sp = Object.assign({}, g.spot, { points: g.spot.points.concat([src]) });
        ctx.preview(g.path, g.base.concat([sp]));
        return Object.assign({}, g, { spot: sp });
      },
      up: (e, ctx, g) => ctx.commit(g.mode === 'move' ? 'Move Spot' : g.spot.points.length > 1 ? 'Spot Removal (brushed)' : 'Spot Removal', { detail: g.mode === 'move' ? '' : g.spot.mode }),
    },
    overlay(g, vp, s, ts) {
      const p = primaryOf(s); if (!p) return;
      const dev = devOf(s), sel = s.ui.spot, L = longEdge(vp);
      (dev.spots || []).forEach((sp, i) => {
        const pts = sp.points.map(q => { const sh = toShown(dev, p, q.x, q.y); return vp.toScreen(sh.u, sh.v); });
        const r = sp.size * L;
        if (pts.length > 1) g.append(svgEl('path', { d: 'M' + pts.map(q => q.join(' ')).join('L'), class: 'dv-spot-path' + (i === sel ? ' is-sel' : ''), 'stroke-width': r * 2 }));
        g.append(svgEl('circle', { cx: pts[0][0], cy: pts[0][1], r, class: 'dv-spot' + (i === sel ? ' is-sel' : '') }));
      });
      if (ts && ts.at && ts.at.inside) g.append(svgEl('circle', { cx: ts.at.sx, cy: ts.at.sy, r: (opt(s, 'heal').size || 0.025) * L, class: 'dv-brush-c' }));
    },
  });
}
export function healOptions() {
  return ck.panel('heal-options', { title: 'Spot Removal', fixed: true },
    ck.ui.segmented([{ value: 'heal', label: 'Heal' }, { value: 'clone', label: 'Clone' }, { value: 'remove', label: 'Remove' }, { value: 'fill', label: 'Fill' }], { bind: s => s.ui.toolOptions.heal.mode, small: true }),
    ck.ui.slider(0.004, 0.12, { bind: s => s.ui.toolOptions.heal.size, label: 'Size', step: 0.001, decimals: 3, reset: 0.025, format: v => Math.round(v * 1000) + '' }),
    ck.ui.slider(0, 100, { bind: s => s.ui.toolOptions.heal.feather, label: 'Feather', reset: 50 }),
    ck.ui.slider(0, 100, { bind: s => s.ui.toolOptions.heal.opacity, label: 'Opacity', reset: 100 }),
    ck.row(ck.stat(s => `${(devOf(s).spots || []).length} spots`), ck.spacer(), ck.ui.command('heal.delete', { small: true, text: 'Delete' }), ck.ui.command('heal.clear', { small: true, text: 'Clear All' })));
}
export function healCommands(c) {
  c.add('heal.delete', { label: 'Delete Spot', enabled: s => s.ui.spot != null && !!(devOf(s).spots || [])[s.ui.spot], why: 'Click a spot to select it', run: ctx => { const i = ctx.state.ui.spot; const id = primaryId(ctx.state); ctx.tx('Delete Spot', t => { t.dev[id].spots = (devOf(ctx.state).spots || []).filter((x, k) => k !== i); }); ctx.set({ ui: { spot: null } }); } })
    .add('heal.clear', { label: 'Clear All Spots', enabled: s => (devOf(s).spots || []).length > 0, why: 'No spots on this photo', run: ctx => { const id = primaryId(ctx.state); ctx.tx('Clear Spots', t => { t.dev[id].spots = []; }); } })
    .add('brush.smaller', { label: 'Smaller Brush', palette: false, run: ctx => sizeBy(ctx, 1 / 1.25) })
    .add('brush.larger', { label: 'Larger Brush', palette: false, run: ctx => sizeBy(ctx, 1.25) });
}
function sizeBy(ctx, k) {
  const tool = ctx.state.ui.tool; if (!tool) return;
  const key = tool === 'heal' ? 'heal' : 'mask-brush';
  const o = opt(ctx.state, key); const cur = o.size || (key === 'heal' ? 0.025 : 0.04);
  ctx.set({ ui: { toolOptions: { [key]: Object.assign({}, o, { size: +clamp(cur * k, 0.004, 0.25).toFixed(4) }) } } });
  ctx.app.viewport() && ctx.app.viewport().redraw();
}

// ── Masks ───────────────────────────────────────────────────────────────
export const LOCAL = [['exposure', 'Exposure', -4, 4, 0.01], ['contrast', 'Contrast', -100, 100, 1], ['highlights', 'Highlights', -100, 100, 1], ['shadows', 'Shadows', -100, 100, 1], ['whites', 'Whites', -100, 100, 1], ['blacks', 'Blacks', -100, 100, 1], ['temp', 'Temp', -100, 100, 1], ['tint', 'Tint', -100, 100, 1], ['texture', 'Texture', -100, 100, 1], ['clarity', 'Clarity', -100, 100, 1], ['dehaze', 'Dehaze', -100, 100, 1], ['saturation', 'Saturation', -100, 100, 1], ['sharpness', 'Sharpness', -100, 100, 1], ['noise', 'Noise', -100, 100, 1]];
const LOCAL0 = { temp: 0, tint: 0, exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, texture: 0, clarity: 0, dehaze: 0, hue: 0, saturation: 0, sharpness: 0, noise: 0, moire: 0, defringe: 0, color_hue: 0, color_sat: 0, amount: 100 };
let maskSeq = 1;
function newMask(dev, shape, name) { const id = Date.now() % 1e9 + (maskSeq++); return { id, name: name || `Mask ${(dev.masks || []).length + 1}`, visible: true, invert: false, components: [{ op: 'add', invert: false, shape }], adjust: Object.assign({}, LOCAL0, { exposure: 0.3 }), refine: 0 }; }
const selMask = s => { const m = devOf(s).masks || []; return m.findIndex(x => x.id === s.ui.mask) ; };

export function maskTools(t) {
  const ready = { enabled: s => !!primaryId(s), why: 'Select a photo first' };
  t.tool('mask-brush', Object.assign({ label: 'Brush', icon: 'brush', key: 'K', cursor: 'none',
    on: {
      hover: (e) => ({ at: e }),
      leave: () => {},
      down: (e, ctx) => {
        const s = ctx.state, dev = devOf(s), p = primaryOf(s); if (!p) return false;
        const o = opt(s, 'mask-brush');
        const q = toSource(dev, p, e.u, e.v);
        const stroke = { points: [q], size: o.size || 0.04, feather: o.feather ?? 50, flow: o.flow ?? 100, density: 100, erase: e.alt, auto_mask: false, pressure: e.pen ? [e.pressure] : [] };
        let masks = (dev.masks || []).slice(), i = selMask(s);
        if (i < 0 || !masks[i].components.some(c => c.shape.kind === 'brush')) { masks.push(newMask(dev, { kind: 'brush', strokes: [] }, `Brush ${masks.length + 1}`)); i = masks.length - 1; ctx.set({ ui: { mask: masks[i].id } }); }
        const ci = masks[i].components.findIndex(c => c.shape.kind === 'brush');
        return { i, ci, masks, stroke, path: devPath(s, 'masks'), at: e, created: masks.length !== (dev.masks || []).length };
      },
      drag: (e, ctx, g) => {
        const s = ctx.state, dev = devOf(s), p = primaryOf(s);
        const q = toSource(dev, p, e.u, e.v), last = g.stroke.points[g.stroke.points.length - 1];
        if (Math.hypot(q.x - last.x, q.y - last.y) < g.stroke.size * 0.25) return Object.assign({}, g, { at: e });
        const stroke = Object.assign({}, g.stroke, { points: g.stroke.points.concat([q]), pressure: e.pen ? g.stroke.pressure.concat([e.pressure]) : g.stroke.pressure });
        ctx.preview(g.path, withStroke(g.masks, g.i, g.ci, stroke));
        return Object.assign({}, g, { stroke, at: e });
      },
      up: (e, ctx, g) => { ctx.preview(g.path, withStroke(g.masks, g.i, g.ci, g.stroke)); ctx.commit(g.stroke.erase ? 'Brush: Erase' : 'Brush Stroke'); },
    },
    overlay(g, vp, s, ts) { drawMasks(g, vp, s); if (ts && ts.at && ts.at.inside) { const L = longEdge(vp), o = opt(s, 'mask-brush'), r = (o.size || 0.04) * L; g.append(svgEl('circle', { cx: ts.at.sx, cy: ts.at.sy, r, class: 'dv-brush-c' })); g.append(svgEl('circle', { cx: ts.at.sx, cy: ts.at.sy, r: r * (1 - (o.feather ?? 50) / 200), class: 'dv-brush-c is-in' })); } },
  }, ready));
  // a gradient's pins: drag an end to move it, the middle (or a radial's centre) to move the whole, a radial's edge
  // to resize it; anywhere else draws a new one
  t.tool('mask-linear', Object.assign({ label: 'Linear Gradient', icon: 'linear', key: 'M', cursor: 'crosshair',
    on: {
      down: (e, ctx) => {
        const s = ctx.state, dev = devOf(s), p = primaryOf(s); if (!p) return false; const q = toSource(dev, p, e.u, e.v);
        const hit = gradientHit(s, ctx.vp, e, 'linear');
        if (hit) { ctx.set({ ui: { mask: dev.masks[hit.i].id } }); return { edit: hit, masks: dev.masks, q0: q, shape: dev.masks[hit.i].components[0].shape, path: devPath(s, 'masks'), photo: p }; }
        const masks = (dev.masks || []).concat([newMask(dev, { kind: 'linear', start: q, end: q }, `Linear ${(dev.masks || []).length + 1}`)]);
        return { masks, q0: q, path: devPath(s, 'masks'), photo: p, prevMask: s.ui.mask, newId: masks[masks.length - 1].id };
      },
      drag: (e, ctx, g) => {
        const dev = devOf(ctx.state), q = toSource(dev, g.photo, e.u, e.v), m = g.masks.slice();
        if (g.edit) {
          const sh = g.shape, d = { x: q.x - g.q0.x, y: q.y - g.q0.y };
          const shape = g.edit.part === 'start' ? Object.assign({}, sh, { start: q }) : g.edit.part === 'end' ? Object.assign({}, sh, { end: q }) : Object.assign({}, sh, { start: { x: sh.start.x + d.x, y: sh.start.y + d.y }, end: { x: sh.end.x + d.x, y: sh.end.y + d.y } });
          m[g.edit.i] = withShape(m[g.edit.i], shape); ctx.preview(g.path, m); return Object.assign({}, g, { moved: true });
        }
        if (!g.moved) ctx.set({ ui: { mask: g.newId } });
        const last = m[m.length - 1]; m[m.length - 1] = withShape(last, { kind: 'linear', start: g.q0, end: q }); ctx.preview(g.path, m); return Object.assign({}, g, { moved: true });
      },
      up: (e, ctx, g) => { if (!g.moved) { ctx.cancel(); return; } ctx.commit(g.edit ? 'Edit Linear Gradient' : 'Linear Gradient'); },
    },
    overlay: (g, vp, s) => drawMasks(g, vp, s),
  }, ready));
  t.tool('mask-radial', Object.assign({ label: 'Radial Gradient', icon: 'radial', key: 'Shift+M', cursor: 'crosshair',
    on: {
      down: (e, ctx) => {
        const s = ctx.state, dev = devOf(s), p = primaryOf(s); if (!p) return false; const q = toSource(dev, p, e.u, e.v);
        const hit = gradientHit(s, ctx.vp, e, 'radial');
        if (hit) { ctx.set({ ui: { mask: dev.masks[hit.i].id } }); return { edit: hit, masks: dev.masks, q0: q, shape: dev.masks[hit.i].components[0].shape, path: devPath(s, 'masks'), photo: p }; }
        const masks = (dev.masks || []).concat([newMask(dev, { kind: 'radial', center: q, rx: 0.001, ry: 0.001, angle: 0, feather: opt(s, 'mask-radial').feather ?? 50, invert: false }, `Radial ${(dev.masks || []).length + 1}`)]);
        return { masks, c: q, path: devPath(s, 'masks'), photo: p, newId: masks[masks.length - 1].id };
      },
      drag: (e, ctx, g) => {
        const dev = devOf(ctx.state), q = toSource(dev, g.photo, e.u, e.v), L = Math.max(g.photo.w, g.photo.h), m = g.masks.slice();
        const radii = c => { let rx = Math.abs(q.x - c.x) * g.photo.w / L, ry = Math.abs(q.y - c.y) * g.photo.h / L; if (e.shift) rx = ry = Math.max(rx, ry); return { rx: Math.max(0.005, rx), ry: Math.max(0.005, ry) }; };
        if (g.edit) {
          const sh = g.shape;
          const shape = g.edit.part === 'move' ? Object.assign({}, sh, { center: { x: sh.center.x + q.x - g.q0.x, y: sh.center.y + q.y - g.q0.y } }) : Object.assign({}, sh, radii(sh.center));
          m[g.edit.i] = withShape(m[g.edit.i], shape); ctx.preview(g.path, m); return Object.assign({}, g, { moved: true });
        }
        if (!g.moved) ctx.set({ ui: { mask: g.newId } });
        const last = m[m.length - 1]; m[m.length - 1] = withShape(last, Object.assign({}, last.components[0].shape, radii(g.c)));
        ctx.preview(g.path, m); return Object.assign({}, g, { moved: true });
      },
      // a click without a drag makes nothing (and keeps the mask that was selected)
      up: (e, ctx, g) => { if (!g.moved) { ctx.cancel(); return; } ctx.commit(g.edit ? 'Edit Radial Gradient' : 'Radial Gradient'); },
    },
    overlay: (g, vp, s) => drawMasks(g, vp, s),
  }, ready));
}
const withShape = (mk, shape) => Object.assign({}, mk, { components: [Object.assign({}, mk.components[0], { shape })].concat(mk.components.slice(1)) });
// which gradient pin is under the pointer (the selected mask first)
function gradientHit(s, vp, e, kind) {
  const dev = devOf(s), p = primaryOf(s), masks = dev.masks || []; if (!p) return null;
  const P = (x, y) => { const sh = toShown(dev, p, x, y); return vp.toScreen(sh.u, sh.v); };
  const order = masks.map((m, i) => i).sort((a, b) => (masks[b].id === s.ui.mask) - (masks[a].id === s.ui.mask));
  const near = (pt, r = 10) => Math.hypot(e.sx - pt[0], e.sy - pt[1]) < r;
  for (const i of order) {
    const c = masks[i].components[0]; if (!c || c.shape.kind !== kind) continue; const sh = c.shape;
    if (kind === 'linear') {
      const a = P(sh.start.x, sh.start.y), b = P(sh.end.x, sh.end.y);
      if (near(a)) return { i, part: 'start' }; if (near(b)) return { i, part: 'end' }; if (near([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], 12)) return { i, part: 'move' };
    } else {
      const c0 = P(sh.center.x, sh.center.y); if (near(c0, 12)) return { i, part: 'move' };
      const Ls = longEdge(vp), rxs = Math.max(4, sh.rx * Ls), rys = Math.max(4, sh.ry * Ls), dx = e.sx - c0[0], dy = e.sy - c0[1];
      if (Math.abs(Math.hypot(dx / rxs, dy / rys) - 1) * Math.min(rxs, rys) < 8) return { i, part: 'edge' };
    }
  }
  return null;
}
function withStroke(masks, i, ci, stroke) {
  const m = masks.slice(); const mk = Object.assign({}, m[i]); const comps = mk.components.slice();
  const c = Object.assign({}, comps[ci]); c.shape = Object.assign({}, c.shape, { strokes: c.shape.strokes.concat([stroke]) });
  comps[ci] = c; mk.components = comps; m[i] = mk; return m;
}
// the red overlay (O): an outline of what the engine masks, drawn from the shapes
let clipSeq = 0;
function drawMasks(g, vp, s) {
  const p = primaryOf(s); if (!p) return;
  const dev = devOf(s), L = longEdge(vp), sel = s.ui.mask, showTint = s.ui.maskOverlay !== false;
  const P = (x, y) => { const sh = toShown(dev, p, x, y); return vp.toScreen(sh.u, sh.v); };
  const defs = svgEl('defs', {}); g.append(defs);
  // lines and tints stay on the picture (a gradient's lines would otherwise run across the window); pins are not clipped
  const [ix0, iy0] = vp.toScreen(0, 0), [ix1, iy1] = vp.toScreen(1, 1), cid = 'dvclip' + (++clipSeq);
  const cp = svgEl('clipPath', { id: cid }); cp.append(svgEl('rect', { x: Math.min(ix0, ix1), y: Math.min(iy0, iy1), width: Math.abs(ix1 - ix0), height: Math.abs(iy1 - iy0) })); defs.append(cp);
  const cg = svgEl('g', { 'clip-path': `url(#${cid})` }); g.append(cg);
  (dev.masks || []).forEach((mk, mi) => {
    const isSel = mk.id === sel;
    for (const c of mk.components) {
      const sh = c.shape;
      if (sh.kind === 'brush' && isSel && showTint) {
        const fid = 'blur' + mi; const f = svgEl('filter', { id: fid }); f.append(svgEl('feGaussianBlur', { stdDeviation: 3 })); defs.append(f);
        const grp = svgEl('g', { class: 'dv-mask-tint', filter: `url(#${fid})` });
        for (const st of sh.strokes) { const pts = st.points.map(q => P(q.x, q.y)); const w = st.size * L * 2; grp.append(svgEl('path', { d: 'M' + pts.map(q => q.join(' ')).join('L') + (pts.length === 1 ? 'l0.1 0' : ''), 'stroke-width': w, class: st.erase ? 'is-erase' : '' })); }
        cg.append(grp);
      }
      if (sh.kind === 'linear') {
        const a = P(sh.start.x, sh.start.y), b = P(sh.end.x, sh.end.y);
        const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1, nx = -dy / len * 2000, ny = dx / len * 2000;
        if (isSel && showTint) { const gid = 'lg' + mi; const lg = svgEl('linearGradient', { id: gid, gradientUnits: 'userSpaceOnUse', x1: a[0], y1: a[1], x2: b[0], y2: b[1] }); lg.append(svgEl('stop', { offset: 0, 'stop-color': '#ff2d2d', 'stop-opacity': 0.5 }), svgEl('stop', { offset: 1, 'stop-color': '#ff2d2d', 'stop-opacity': 0 })); defs.append(lg); const ext = 4000; cg.append(svgEl('path', { d: `M${a[0] + nx} ${a[1] + ny}L${a[0] - nx} ${a[1] - ny}L${a[0] - nx - dx / len * ext} ${a[1] - ny - dy / len * ext}L${a[0] + nx - dx / len * ext} ${a[1] + ny - dy / len * ext}Z M${a[0] + nx} ${a[1] + ny}L${a[0] - nx} ${a[1] - ny}L${b[0] - nx} ${b[1] - ny}L${b[0] + nx} ${b[1] + ny}Z`, fill: `url(#${gid})` })); }
        for (const [q, cls] of [[a, 'is-full'], [[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], 'is-mid'], [b, 'is-none']]) cg.append(svgEl('path', { d: `M${q[0] + nx} ${q[1] + ny}L${q[0] - nx} ${q[1] - ny}`, class: 'dv-grad-line ' + cls + (isSel ? ' is-sel' : '') }));
      }
      if (sh.kind === 'radial') {
        const ctr = P(sh.center.x, sh.center.y), rx = sh.rx * L, ry = sh.ry * L;
        if (isSel && showTint) { const gid = 'rg' + mi; const rg = svgEl('radialGradient', { id: gid }); const inner = Math.max(0, 1 - sh.feather / 100); rg.append(svgEl('stop', { offset: 0, 'stop-color': '#ff2d2d', 'stop-opacity': 0.5 }), svgEl('stop', { offset: inner, 'stop-color': '#ff2d2d', 'stop-opacity': 0.5 }), svgEl('stop', { offset: 1, 'stop-color': '#ff2d2d', 'stop-opacity': 0 })); defs.append(rg); cg.append(svgEl('ellipse', { cx: ctr[0], cy: ctr[1], rx, ry, fill: `url(#${gid})` })); }
        cg.append(svgEl('ellipse', { cx: ctr[0], cy: ctr[1], rx, ry, class: 'dv-grad-line' + (isSel ? ' is-sel' : '') }));
      }
    }
    // the pin
    const first = mk.components[0] && mk.components[0].shape; if (!first) return;
    const pin = first.kind === 'radial' ? first.center : first.kind === 'linear' ? first.start : first.strokes && first.strokes[0] && first.strokes[0].points[0];
    if (pin) { const q = P(pin.x, pin.y); g.append(svgEl('circle', { cx: q[0], cy: q[1], r: 6, class: 'dv-pin' + (isSel ? ' is-sel' : '') })); }
  });
}
export function masksPanel() {
  const adj = ([k, label, min, max, step]) => ck.ui.slider(min, max, { bind: s => { const i = Math.max(0, selMask(s)); const m = devOf(s).masks || []; return m[i] ? m[i].adjust[k] : 0; }, label, step, decimals: step < 1 ? 2 : 0, reset: 0, bipolar: true, historyLabel: `Mask ${label}`, disabled: s => selMask(s) < 0, compact: true, lazy: true });
  return ck.panel('masks', { title: 'Masks', fixed: false },
    ck.view.list(s => devOf(s).masks || [], {
      id: 'masks-list', rowHeight: 24, key: mk => mk.id,
      select: { bind: s => s.ui.maskSel, mode: 'single' },
      onSelect: (sel, ctx) => ctx.set({ ui: { mask: sel.primary } }),
      row: mk => ck.html(m => { const r = h('div', { class: 'dv-mask-r' }, icon(mk.components[0] && mk.components[0].shape.kind === 'radial' ? 'radial' : mk.components[0] && mk.components[0].shape.kind === 'linear' ? 'linear' : 'brush', 12), h('span', { text: mk.name })); m.cell(s => s.ui.mask === mk.id, on => r.classList.toggle('is-on', on)); return r; }),
      context: ['mask.invert', 'mask.delete'],
      empty: 'Paint with the Brush (K), drag a Linear (M) or Radial (Shift+M) gradient',
    }),
    ck.row(ck.ui.checkbox('Show overlay (O)', { bind: s => s.ui.maskOverlay }), ck.spacer(), ck.ui.command('mask.invert', { small: true, text: 'Invert' }), ck.ui.command('mask.delete', { small: true, text: 'Delete' })),
    ck.when(s => s.ui.tool === 'mask-brush', ck.column({ gap: 1 },
      ck.ui.slider(0.005, 0.25, { bind: s => s.ui.toolOptions['mask-brush'].size, label: 'Size', step: 0.001, decimals: 3, reset: 0.04, format: v => Math.round(v * 1000) + '', compact: true }),
      ck.ui.slider(0, 100, { bind: s => s.ui.toolOptions['mask-brush'].feather, label: 'Feather', reset: 50, compact: true }),
      ck.ui.slider(1, 100, { bind: s => s.ui.toolOptions['mask-brush'].flow, label: 'Flow', reset: 100, compact: true }))),
    ck.section('Adjust the mask', {}, ...LOCAL.map(adj)));
}
export function maskCommands(c) {
  const has = s => selMask(s) >= 0;
  c.add('mask.delete', { label: 'Delete Mask', enabled: has, why: 'Select a mask first', run: ctx => { const id = primaryId(ctx.state); const sel = ctx.state.ui.mask; ctx.tx('Delete Mask', t => { t.dev[id].masks = (devOf(ctx.state).masks || []).filter(m => m.id !== sel); }); ctx.set({ ui: { mask: null } }); } })
    .add('mask.invert', { label: 'Invert Mask', enabled: has, why: 'Select a mask first', run: ctx => { const id = primaryId(ctx.state); const i = selMask(ctx.state); ctx.tx('Invert Mask', t => { t.dev[id].masks[i].invert = !devOf(ctx.state).masks[i].invert; }); } })
    .add('mask.overlay', { label: 'Show Mask Overlay', checked: s => s.ui.maskOverlay !== false, run: ctx => ctx.set({ ui: { maskOverlay: ctx.state.ui.maskOverlay === false } }) });
}
