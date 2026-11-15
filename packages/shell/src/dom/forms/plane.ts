// Planes (port of CraftKit ui/forms/plane.js): 2-D controls. A tone curve, a colour wheel and the histogram (a plane
// you can read and drag). Each gesture previews and commits once.
//
// The curve and the wheel are widgets first (`curvePlane`, `wheelDisc`: the drawing and the gestures, writing through
// callbacks) and renderers second (`curve`, `wheel`: the widgets bound to one store path). A kit that keeps its values
// elsewhere (a document's Coll of points, three arguments of a layer) uses the same widgets with its own callbacks,
// so every curve and every wheel in a layout looks and behaves the same.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { clamp, type Key } from '../../core/util.ts';
import type { Scope } from '../../core/cells.ts';
import { bindingPath } from '../../core/track.ts';
import { fmtNum, monotone } from '../../core/math.ts';
import { makeNode } from '../../ir/node.ts';
import { h, listen, drag, svgEl } from '../h.ts';
import { defineRenderer, type MountCtx } from '../mount.ts';

/** A curve's control point; `id` is the caller's (kept on moves, absent on a new point unless `newId` gives one). */
export type CurvePt = { x: number; y: number; id?: string };
const IDENT: CurvePt[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];
const ptsOf = (v: unknown): CurvePt[] => (Array.isArray(v) && v.length >= 2 ? v.map(p => (Array.isArray(p) ? { x: p[0], y: p[1] } : { ...p })) : IDENT.map(p => ({ ...p })));
const ARROWS: Record<string, [number, number]> = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
const at = (path: Key[], s: any): any => path.reduce((o: any, k) => (o == null ? o : o[k]), s);
const same = (a: readonly CurvePt[], b: readonly CurvePt[]): boolean => a.length === b.length && a.every((p, i) => p.x === b[i]!.x && p.y === b[i]!.y && p.id === b[i]!.id);

/** What a curve gesture did (the caller words its step from it). */
export type CurveEdit = 'move' | 'add' | 'delete' | 'reset';

export interface CurvePlaneOptions {
  /** the plane's side in viewBox units (default 220) */
  size?: number;
  /** the function drawn through the points (default the shell's monotone cubic); a host passes its engine's own */
  fn?: (pts: readonly CurvePt[]) => (x: number) => number;
  /** the end points keep x = 0 and 1 (default true); false: they move inside their neighbours */
  fixedEnds?: boolean;
  /** at most this many points (default 16) */
  maxPoints?: number;
  /** a new point's id (the caller's ids, e.g. unique in a document) */
  newId?: (pts: readonly CurvePt[]) => string;
  /** the "x → y" readout under the plane (default true) */
  readout?: boolean;
  label?: string;
  /** a drag in progress: the points now */
  preview(pts: CurvePt[]): void;
  /** the gesture's end: one step */
  commit(pts: CurvePt[], what: CurveEdit): void;
  /** Escape during a drag, or a gesture that changed nothing */
  cancel(): void;
  /** an arrow key on the selected point (the caller coalesces a run of them into one step) */
  nudge(pts: CurvePt[]): void;
}

export interface CurvePlane {
  readonly svg: SVGSVGElement;
  readonly read: HTMLElement;
  /** shaded regions behind the curve (the parametric tab's) */
  readonly regions: SVGGElement;
  /** show these points (a value from the store, or the caller's preview coming back) */
  set(pts: readonly CurvePt[]): void;
  /** the curve's colour (a channel's) */
  stroke(css: string): void;
  /** a histogram behind the curve: bins over x = 0…1, or null */
  backdrop(bins: readonly number[] | null): void;
  /** false: the points are hidden and the plane ignores the pointer (the parametric tab draws its own curve) */
  interactive(on: boolean): void;
  /** draw a curve through points that are not editable (the parametric tab) */
  draw(pts: readonly CurvePt[]): void;
}

/** The tone curve widget: click adds a point on the curve (Shift: at the pointer), drag moves it, drag it off the
 *  plane or double-click it to delete, double-click the empty plane to reset, arrows nudge the selected point. */
export function curvePlane(scope: Scope, o: CurvePlaneOptions): CurvePlane {
  const S = o.size ?? 220;
  const fnOf = o.fn ?? ((pts: readonly CurvePt[]) => monotone(pts.slice()));
  const fixedEnds = o.fixedEnds !== false;
  const maxPoints = o.maxPoints ?? 16;
  const svg = svgEl('svg', { viewBox: `0 0 ${S} ${S}`, class: 'ck-curve-g', role: 'img', 'aria-label': o.label ?? 'Tone curve', tabindex: '0' }) as SVGSVGElement;
  const bg = svgEl('g', {});
  const grid = svgEl('g', { class: 'ck-curve-grid' });
  const regions = svgEl('g', { class: 'ck-curve-reg' }) as SVGGElement;
  const path = svgEl('path', { class: 'ck-curve-p' });
  const ident = svgEl('path', { class: 'ck-curve-id', d: `M0 ${S}L${S} 0` });
  const ptsG = svgEl('g', {});
  for (let i = 1; i < 4; i++) grid.append(svgEl('path', { d: `M${(S * i) / 4} 0V${S}M0 ${(S * i) / 4}H${S}` }));
  svg.append(bg, regions, grid, ident, path, ptsG);
  const read = h('div', { class: 'ck-curve-read' });
  let cur: CurvePt[] = IDENT.map(p => ({ ...p }));
  let selIdx = -1;
  let live = true;
  /** the point the last click added (a double-click on the empty plane resets instead of deleting it) */
  let added: { p: CurvePt; t: number } | null = null;

  function drawCurve(list: readonly CurvePt[], points: boolean): void {
    const f = fnOf(list);
    let d = '';
    for (let i = 0; i <= 64; i++) {
      const x = i / 64;
      d += (i ? 'L' : 'M') + (x * S).toFixed(1) + ' ' + ((1 - clamp(f(x), 0, 1)) * S).toFixed(1);
    }
    path.setAttribute('d', d);
    // the points are drawn, never targeted: a redraw during a press would swallow the click and the double-click
    ptsG.replaceChildren(...(points ? list.map((q, i) => svgEl('rect', { x: q.x * S - 3.5, y: (1 - q.y) * S - 3.5, width: 7, height: 7, class: 'ck-curve-pt' + (i === selIdx ? ' is-sel' : ''), ...(q.id ? { 'data-id': q.id } : {}) })) : []));
  }
  const toXY = (e: MouseEvent) => {
    const r = svg.getBoundingClientRect();
    const w = r.width || S;
    const hh = r.height || S;
    return { x: clamp((e.clientX - r.left) / w, 0, 1), y: clamp(1 - (e.clientY - r.top) / hh, 0, 1), out: e.clientY < r.top - 24 || e.clientY > r.top + hh + 24 || e.clientX < r.left - 24 || e.clientX > r.left + w + 24 };
  };
  const isEnd = (i: number, n: number): boolean => i === 0 || i === n - 1;
  const fmt = (v: number): string => `${Math.round(v * 100)}%`;
  listen(scope, svg, 'pointermove', (e: PointerEvent) => {
    const q = toXY(e);
    if (o.readout !== false && live) read.textContent = `${fmt(q.x)} → ${fmt(clamp(fnOf(cur)(q.x), 0, 1))}`;
  });
  listen(scope, svg, 'pointerleave', () => void (read.textContent = ''));
  listen(scope, svg, 'pointerdown', (e: PointerEvent) => {
    if (!live || e.button !== 0) return;
    e.preventDefault();
    (svg as any).focus?.({ preventScroll: true });
    const start = cur.map(p => ({ ...p }));
    let list = cur.map(p => ({ ...p }));
    const q = toXY(e);
    let i = list.findIndex(pt => Math.abs(pt.x - q.x) < 0.035 && Math.abs(pt.y - q.y) < 0.035);
    let what: CurveEdit = 'move';
    if (i < 0) {
      if (list.length >= maxPoints) return;
      const f = fnOf(list);
      const np: CurvePt = { x: q.x, y: e.shiftKey ? q.y : clamp(f(q.x), 0, 1) };
      if (o.newId) np.id = o.newId(list);
      list.push(np);
      list.sort((a, c) => a.x - c.x);
      i = list.indexOf(np);
      what = 'add';
      added = { p: np, t: Date.now() };
      // a point on top of a neighbour would break strictly increasing x
      const lo = i > 0 ? list[i - 1]!.x + 0.01 : 0;
      const hi = i < list.length - 1 ? list[i + 1]!.x - 0.01 : 1;
      if (lo > hi) return;
      list[i] = { ...np, x: clamp(np.x, lo, hi) };
      o.preview(list);
    }
    selIdx = i;
    const n0 = list.length;
    const pinX = fixedEnds && isEnd(i, n0);
    const keepEnd = isEnd(i, n0) || n0 <= 2;
    drawCurve(list, true);
    drag(e, {
      move: ev => {
        const r = toXY(ev);
        const L = list.slice();
        if (r.out && !keepEnd) {
          L.splice(selIdx, 1);
          o.preview(L);
          return;
        }
        const lo = selIdx > 0 ? L[selIdx - 1]!.x + 0.01 : 0;
        const hi = selIdx < L.length - 1 ? L[selIdx + 1]!.x - 0.01 : 1;
        L[selIdx] = { ...L[selIdx]!, x: pinX ? L[selIdx]!.x : clamp(r.x, lo, hi), y: r.y };
        list = L;
        o.preview(L);
      },
      up: ev => {
        if (ev && toXY(ev).out && !keepEnd) {
          list.splice(selIdx, 1);
          selIdx = -1;
          what = what === 'add' ? 'move' : 'delete';
        }
        if (same(list, start)) o.cancel();
        else {
          // a point moved after it was added: a double-click on it now deletes it
          if (what !== 'add') added = null;
          o.commit(list, what);
        }
        drawCurve(cur, live);
      },
      cancel: () => {
        o.cancel();
        selIdx = -1;
      },
    });
  });
  listen(scope, svg, 'dblclick', (e: MouseEvent) => {
    if (!live) return;
    const list = cur.map(p => ({ ...p }));
    const q = toXY(e);
    const i = list.findIndex(pt => Math.abs(pt.x - q.x) < 0.04 && Math.abs(pt.y - q.y) < 0.04);
    const justAdded = i >= 0 && added && Date.now() - added.t < 800 && list[i]!.id === added.p.id && Math.abs(list[i]!.x - added.p.x) < 0.02;
    added = null;
    if (i > 0 && i < list.length - 1 && !justAdded) {
      list.splice(i, 1);
      selIdx = -1;
      o.commit(list, 'delete');
    } else if (i < 0 || justAdded) {
      selIdx = -1;
      const id0 = list[0]?.id;
      const id1 = list[list.length - 1]?.id;
      o.commit([{ x: 0, y: 0, ...(id0 ? { id: id0 } : {}) }, { x: 1, y: 1, ...(id1 ? { id: id1 } : {}) }], 'reset');
    }
  });
  listen(scope, svg, 'keydown', (e: KeyboardEvent) => {
    if (selIdx < 0 || !live) return;
    const d = ARROWS[e.key];
    if (d) {
      e.preventDefault();
      e.stopPropagation();
      const L = cur.map(p => ({ ...p }));
      const k = (e.shiftKey ? 10 : 1) / 255;
      const q = L[selIdx];
      if (!q) return;
      const lo = selIdx > 0 ? L[selIdx - 1]!.x + 0.01 : 0;
      const hi = selIdx < L.length - 1 ? L[selIdx + 1]!.x - 0.01 : 1;
      L[selIdx] = { ...q, x: fixedEnds && isEnd(selIdx, L.length) ? q.x : clamp(q.x + d[0] * k, lo, hi), y: clamp(q.y + d[1] * k, 0, 1) };
      o.nudge(L);
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      const L = cur.map(p => ({ ...p }));
      if (selIdx > 0 && selIdx < L.length - 1) {
        L.splice(selIdx, 1);
        selIdx = -1;
        o.commit(L, 'delete');
      }
    }
  });
  return {
    svg,
    read,
    regions,
    set(pts) {
      cur = pts.length >= 2 ? pts.map(p => ({ ...p })) : IDENT.map(p => ({ ...p }));
      if (selIdx >= cur.length) selIdx = -1;
      if (live) drawCurve(cur, true);
    },
    stroke(css) {
      path.style.stroke = css;
    },
    backdrop(bins) {
      bg.replaceChildren();
      if (!bins || !bins.length) return;
      const n = bins.length;
      const skip = Math.max(1, Math.round(n / 100));
      const mx = Math.max(1e-12, ...bins.slice(skip, n - skip));
      let d = `M0 ${S}`;
      for (let i = 0; i < n; i++) d += `L${(((i + 0.5) / n) * S).toFixed(1)} ${(S - Math.min(S, (bins[i]! / mx) * S * 0.9)).toFixed(1)}`;
      bg.append(svgEl('path', { d: d + `L${S} ${S}Z`, class: 'ck-curve-hist' }));
    },
    interactive(on) {
      live = on;
      svg.classList.toggle('is-static', !on);
      if (on) drawCurve(cur, true);
    },
    draw(pts) {
      drawCurve(pts, false);
    },
  };
}

// ── tone curve: bind is the curve object { master: [{x,y}…], red… }; channels: { RGB: 'master', Red: 'red', … } ──
defineRenderer('curve', (n, m) => {
  const p = n.props as Record<string, any>;
  const b = m.binding(p['bind'], n.at, { label: p['historyLabel'] || 'Tone Curve' });
  const channels: Record<string, string> = p['channels'] || { RGB: 'master' };
  const names = Object.keys(channels);
  const modePath: Key[] = (p['mode'] ? bindingPath(m.store, p['mode']).path : null) || ['workspace', 'curveMode', String(p['id'] || 'curve')];
  if (m.store.peek(modePath) === undefined) m.store.writeView([{ path: modePath, value: p['parametric'] ? 'Parametric' : names[0] }], { init: true });
  const el = h('div', { class: 'ck-curve' });
  const tabs = h('div', { class: 'ck-seg is-small ck-curve-tabs' });
  const tabNames = (p['parametric'] ? ['Parametric'] : []).concat(names);
  const tabBtns = tabNames.map(nm => {
    const bt = h('button', { type: 'button', class: 'ck-seg-b', text: nm === 'RGB' ? 'Point' : nm });
    listen(m.scope, bt, 'click', () => m.store.set(modePath, nm));
    return bt;
  });
  tabs.append(...tabBtns);
  let mode = names[0]!;
  let chan = channels[mode]!;
  let curveObj: Record<string, any> = {};
  const round = (list: CurvePt[]) => list.map(q => ({ x: +q.x.toFixed(4), y: +q.y.toFixed(4) }));
  const plane = curvePlane(m.scope, {
    size: p['size'] || 220,
    readout: p['readout'] !== false,
    preview: list => b.preview({ ...curveObj, [chan]: round(list) }),
    commit: (list, what) => {
      b.preview({ ...curveObj, [chan]: round(list) });
      b.commit(what === 'move' ? b.label : `${b.label}: ${what === 'add' ? 'add point' : what === 'delete' ? 'delete point' : 'reset'}`, { detail: mode === 'RGB' ? 'Point' : mode });
    },
    cancel: () => b.cancel(),
    nudge: list => b.set({ ...curveObj, [chan]: list }, b.label, { coalesce: 'nudge:curve' }),
  });
  const paramBox = h('div', { class: 'ck-curve-param' });
  el.append(tabs, plane.svg, plane.read, paramBox);
  if (p['parametric']) {
    const x = m.child('param').mount(p['parametric']);
    if (x) paramBox.append(x);
  }
  const color: Record<string, string> = { master: 'var(--text)', red: '#e5534b', green: '#3fb950', blue: '#4c8df6' };
  // the parametric tab draws the curve the region sliders make (shadows/darks/lights/highlights at the splits)
  function drawParam(): void {
    const c = curveObj || {};
    const sp = [(c['split_shadows'] ?? 25) / 100, (c['split_mid'] ?? 50) / 100, (c['split_highlights'] ?? 75) / 100] as [number, number, number];
    const amt = [c['shadows'] || 0, c['darks'] || 0, c['lights'] || 0, c['highlights'] || 0].map(v => (v / 100) * 0.18);
    const ctr = [sp[0] / 2, (sp[0] + sp[1]) / 2, (sp[1] + sp[2]) / 2, (sp[2] + 1) / 2];
    plane.draw([{ x: 0, y: 0 }, ...ctr.map((x, i) => ({ x, y: clamp(x + amt[i]!, 0, 1) })), { x: 1, y: 1 }]);
    const ends = [sp[0], sp[1], sp[2], 1];
    const S = p['size'] || 220;
    plane.regions.replaceChildren(...[0, sp[0], sp[1], sp[2]].map((x0, i) => svgEl('rect', { x: x0 * S, y: 0, width: (ends[i]! - x0) * S, height: S, class: 'ck-curve-band' + (i % 2 ? ' is-alt' : '') })));
  }
  function showMode(): void {
    tabBtns.forEach((bt, i) => bt.classList.toggle('is-on', tabNames[i] === mode));
    const param = mode === 'Parametric';
    paramBox.hidden = !param;
    chan = param ? 'master' : channels[mode]!;
    plane.stroke(color[chan] || 'var(--text)');
    plane.interactive(!param);
    if (param) drawParam();
    else {
      plane.regions.replaceChildren();
      plane.set(ptsOf(curveObj?.[chan]));
    }
  }
  m.cell(
    s => at(modePath, s),
    v => {
      mode = tabNames.includes(v) ? v : tabNames[0]!;
      showMode();
    },
  );
  b.watch(v => {
    curveObj = v || {};
    showMode();
  });
  if (p['backdrop'] !== undefined)
    m.val(p['backdrop'], (hist: any) => {
      const arr: number[] | undefined = hist?.l || hist?.luma;
      plane.backdrop(arr ?? null);
    });
  return el;
});

// ── colour wheel: hue around, strength out; Shift = strength only, Mod = hue only, Alt = fine ──

/** A wheel's value: the hue in degrees (0 at the top, clockwise) and the distance from the centre, 0–1. */
export interface WheelValue {
  hue: number;
  r: number;
}
export interface WheelDiscOptions {
  /** the disc's diameter in px (default 120) */
  size?: number;
  label?: string;
  /** the puck's fill for a value (default the shell's hsl preview); '' leaves it clear */
  puck?: (v: WheelValue) => string;
  /** arrow-key steps (default 1° and 0.01) */
  step?: { hue: number; r: number };
  preview(v: WheelValue): void;
  commit(v: WheelValue): void;
  cancel(): void;
  /** an arrow key (the caller coalesces a run of them) */
  nudge(v: WheelValue): void;
  /** a double-click on the puck */
  reset(): void;
}
export interface WheelDisc {
  readonly disc: HTMLElement;
  set(v: WheelValue): void;
}

/** The colour wheel widget: press or drag to set hue and strength (Shift keeps the hue, Mod the strength, Alt is fine). */
export function wheelDisc(scope: Scope, o: WheelDiscOptions): WheelDisc {
  const S = o.size ?? 120;
  const R = S / 2 - 4;
  const disc = h('div', { class: 'ck-wheel-d', tabindex: '0', role: 'slider', 'aria-label': o.label ?? 'wheel' });
  disc.style.width = disc.style.height = S + 'px';
  const puck = h('div', { class: 'ck-wheel-p' });
  disc.append(puck);
  let cur: WheelValue = { hue: 0, r: 0 };
  const fill = o.puck ?? ((v: WheelValue) => (v.r > 0 ? `hsl(${v.hue} ${40 + v.r * 50}% 55%)` : ''));
  const place = (v: WheelValue): void => {
    const a = ((v.hue - 90) * Math.PI) / 180;
    const r = clamp(v.r, 0, 1) * R;
    puck.style.left = S / 2 + Math.cos(a) * r + 'px';
    puck.style.top = S / 2 + Math.sin(a) * r + 'px';
    puck.style.background = fill(v);
  };
  const fromEvent = (e: PointerEvent, start?: WheelValue): WheelValue => {
    const rc = disc.getBoundingClientRect();
    const x = e.clientX - (rc.left + (rc.width || S) / 2);
    const y = e.clientY - (rc.top + (rc.height || S) / 2);
    let hue = ((Math.atan2(y, x) * 180) / Math.PI + 90 + 360) % 360;
    let r = clamp(Math.hypot(x, y) / R, 0, 1);
    if (e.altKey && start) {
      hue = start.hue + (hue - start.hue) * 0.25;
      r = start.r + (r - start.r) * 0.25;
    }
    if (e.shiftKey && start) hue = start.hue;
    if ((e.metaKey || e.ctrlKey) && start) r = start.r;
    return { hue, r };
  };
  listen(scope, disc, 'pointerdown', (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    disc.focus?.();
    const start = { ...cur };
    if (e.target !== puck) o.preview(fromEvent(e));
    drag(e, { move: ev => o.preview(fromEvent(ev, start)), up: () => o.commit(cur), cancel: () => o.cancel() });
  });
  // a double-click on the puck resets (the disc holds the pointer during a press, so the event lands on the disc)
  listen(scope, disc, 'dblclick', (e: MouseEvent) => {
    const p = puck.getBoundingClientRect();
    if (Math.hypot(e.clientX - (p.left + p.width / 2), e.clientY - (p.top + p.height / 2)) > 10) return;
    e.stopPropagation();
    o.reset();
  });
  listen(scope, disc, 'keydown', (e: KeyboardEvent) => {
    const d = ARROWS[e.key];
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    const st = o.step ?? { hue: 1, r: 0.01 };
    const k = e.shiftKey ? 10 : 1;
    o.nudge({ hue: (cur.hue + d[0] * k * st.hue + 360) % 360, r: clamp(cur.r + d[1] * k * st.r, 0, 1) });
  });
  return {
    disc,
    set(v) {
      cur = { hue: v.hue, r: v.r };
      place(cur);
    },
  };
}

defineRenderer('wheel', (n, m) => {
  const p = n.props as Record<string, any>;
  const b = m.binding(p['bind'], n.at, { label: p['historyLabel'] || (typeof p['label'] === 'string' ? p['label'] : 'Color Grading') });
  const el = h('div', { class: 'ck-wheel' });
  const lab = h('div', { class: 'ck-wheel-l' });
  type HSL = { hue: number; sat: number; lum: number };
  let cur: HSL = { hue: 0, sat: 0, lum: 0 };
  const toHsl = (v: WheelValue): HSL => ({ ...cur, hue: Math.round(v.hue) % 360, sat: Math.round(v.r * 100) });
  const w = wheelDisc(m.scope, {
    size: p['size'] || 120,
    step: { hue: 1, r: 0.01 },
    preview: v => b.preview(toHsl(v)),
    commit: () => void b.commit(b.label, { detail: String(p['label'] || '') }),
    cancel: () => b.cancel(),
    nudge: v => b.set(toHsl(v), b.label, { coalesce: 'nudge:' + b.name }),
    reset: () => b.set({ ...cur, hue: 0, sat: 0 }, `${b.label}: reset`),
  });
  const read = h('div', { class: 'ck-wheel-r' });
  el.append(lab, w.disc, read);
  m.val(p['label'], v => {
    lab.textContent = v ? String(v) : '';
    w.disc.setAttribute('aria-label', v ? String(v) : 'wheel');
  });
  b.watch(v => {
    cur = { hue: 0, sat: 0, lum: 0, ...(v || {}) };
    w.set({ hue: cur.hue, r: cur.sat / 100 });
    w.disc.setAttribute('aria-valuetext', `hue ${Math.round(cur.hue)}, saturation ${Math.round(cur.sat)}`);
    if (p['readout'] === undefined) read.textContent = `H ${Math.round(cur.hue)}°  S ${Math.round(cur.sat)}`;
  });
  if (p['readout'] !== undefined)
    m.cell(
      s => {
        const v = { hue: 0, sat: 0, lum: 0, ...((b.fn(s) as object) || {}) };
        return typeof p['readout'] === 'function' ? p['readout'](v) : p['readout'];
      },
      v => void (read.textContent = v ? String(v) : ''),
    );
  if (p['lum']) {
    const base = b.path;
    if (base) {
      const sl = m.child('lum').mount(makeNode('slider', { bind: base.concat(['lum']).join('.'), min: -100, max: 100, label: 'Lum', bipolar: true, reset: 0, compact: true, labelWidth: 30, historyLabel: `${p['label'] || ''} Luminance`.trim(), tip: 'Luminance' }, [], n.at));
      if (sl) el.append(sl);
    }
  }
  return el;
});

// ── histogram: RGB overlap, clipping warnings, regions to drag ──
// data: τ { r, g, b, l } arrays of 256; clip: bind to a boolean (shows/hides warnings)
defineRenderer('histogram', (n, m: MountCtx) => {
  const p = n.props as Record<string, any>;
  const H: number = p['height'] || 110;
  const el = h('div', { class: 'ck-hist' });
  const cv = h('canvas', { class: 'ck-hist-c', height: H * 2, width: 512, role: 'img', 'aria-label': 'Histogram' });
  const tl = h('button', { type: 'button', class: 'ck-hist-clip is-l', 'data-tip': 'Show shadow clipping (J)', 'aria-label': 'Shadow clipping' });
  const tr = h('button', { type: 'button', class: 'ck-hist-clip is-r', 'data-tip': 'Show highlight clipping (J)', 'aria-label': 'Highlight clipping' });
  const info = h('div', { class: 'ck-hist-i' });
  const region = h('div', { class: 'ck-hist-reg' });
  region.hidden = true;
  el.append(cv, tl, tr, region, info);
  let data: Record<string, number[]> | null = null;
  const clipB = p['clip'] ? m.binding(p['clip'], n.at) : null;
  function paint(): void {
    if (!data) return;
    const total = (data as any).total || (data['l'] || []).reduce((a, x) => a + x, 0) || 1;
    const lo = ((data['r']?.[0] ?? 0) + (data['g']?.[0] ?? 0) + (data['b']?.[0] ?? 0)) / 3 / total;
    const hi = ((data['r']?.[255] ?? 0) + (data['g']?.[255] ?? 0) + (data['b']?.[255] ?? 0)) / 3 / total;
    tl.classList.toggle('is-hot', lo > 0.002);
    tr.classList.toggle('is-hot', hi > 0.002);
    let g: CanvasRenderingContext2D | null = null;
    try {
      g = cv.getContext('2d');
    } catch {
      g = null;
    }
    if (!g) return;
    const W = cv.width;
    const HH = cv.height;
    g.clearRect(0, 0, W, HH);
    const ch: [string, string][] = [
      ['r', '#ff3b30'],
      ['g', '#34c759'],
      ['b', '#2f7bff'],
    ];
    const mx = Math.max(1, ...ch.map(([k]) => Math.max(...(data![k] || [0]).slice(1, 255))));
    g.globalCompositeOperation = 'lighter';
    for (const [k, c] of ch) {
      const arr = data[k];
      if (!arr) continue;
      g.beginPath();
      g.moveTo(0, HH);
      for (let i = 0; i < 256; i++) g.lineTo((i / 255) * W, HH - Math.min(1, Math.sqrt((arr[i] ?? 0) / mx)) * HH * 0.94);
      g.lineTo(W, HH);
      g.closePath();
      g.fillStyle = c;
      g.globalAlpha = 0.62;
      g.fill();
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }
  m.val(p['data'], (v: any) => {
    data = v;
    paint();
  });
  if (p['info'] !== undefined) m.val(p['info'], v => void (info.textContent = v ? String(v) : ''));
  if (clipB) {
    clipB.watch(v => void el.classList.toggle('is-clipping', !!v));
    const toggle = (): void => clipB.set(!clipB.get());
    listen(m.scope, tl, 'click', toggle);
    listen(m.scope, tr, 'click', toggle);
  }
  // regions: drag sideways inside the histogram to move the slider of the tones under the pointer
  if (p['regions']) {
    const R = p['regions'] as { name: string; from: number; to: number; bind: unknown; min: number; max: number; step?: number }[];
    const regionAt = (x: number) => R.find(r => x >= r.from && x < r.to) || R[R.length - 1]!;
    listen(m.scope, cv, 'pointermove', (e: PointerEvent) => {
      if (e.buttons) return;
      const r = cv.getBoundingClientRect();
      const g = regionAt((e.clientX - r.left) / (r.width || 1));
      region.style.left = g.from * 100 + '%';
      region.style.width = (g.to - g.from) * 100 + '%';
      region.hidden = false;
      info.dataset['hover'] = g.name;
      info.textContent = g.name;
    });
    listen(m.scope, cv, 'pointerleave', () => {
      region.hidden = true;
      info.textContent = '';
    });
    listen(m.scope, cv, 'pointerdown', (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      const g = regionAt((e.clientX - r.left) / (r.width || 1));
      const bb = m.binding(g.bind, n.at, { label: g.name });
      const v0 = +bb.get() || 0;
      const x0 = e.clientX;
      const step = g.step || 1;
      const dec = step < 1 ? 2 : 0;
      drag(e, {
        cursor: 'ew-resize',
        move: ev => {
          const v = clamp(v0 + ((ev.clientX - x0) / (r.width || 1)) * (g.max - g.min) * 0.8, g.min, g.max);
          bb.preview(Math.round(v / step) * step);
          info.textContent = `${g.name} ${fmtNum(bb.get(), dec, true)}`;
        },
        up: () => void bb.commit(g.name, { detail: fmtNum(bb.get(), dec, true) }),
        cancel: () => bb.cancel(),
      });
    });
  }
  return el;
});
