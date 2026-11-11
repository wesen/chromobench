// The viewport (port of CraftKit ui/viewport.js onto the render bridge and the presenter). It shows a τ renderable
// through rt.renders (slots vp:<id>:after / vp:<id>:before; draft while this view previews, screen otherwise,
// refine of the visible region past 1:1), keeps the view (zoom, centre) in the view tier at view.vp[id], compares
// before/after, draws SVG overlays, and routes the pointer to the active tool or a held spring.
//
// Tool handlers get (e, ctx, g): e carries u, v (0..1 across the image), x, y (document pixels), ix, iy (pixels of
// the shown render), sx, sy (screen), the modifiers and pressure; down returns the gesture's state g.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { clamp } from '../core/util.ts';
import type { NodeData } from '../ir/node.ts';
import type { ToolEvent, ToolSpec } from '../build/types.ts';
import type { ViewportApi } from '../app/runtime.ts';
import { chooseTarget } from '../app/render/queue.ts';
import type { Colours, PresentImage, Presenter, Rect, Rendered } from '../app/render/types.ts';
import { h, listen, svgEl, drag as dragPtr } from './h.ts';
import { defineRenderer, type MountCtx } from './mount.ts';
import { Canvas2DPresenter } from './presenter-2d.ts';

export const ZOOMS = [1 / 16, 1 / 12, 1 / 8, 1 / 6, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 1, 2, 3, 4, 8, 11];
type Zoom = 'fit' | 'fill' | number;
type Compare = 'off' | 'before' | 'split' | 'lr' | 'tb';

export interface DomViewport extends ViewportApi {
  readonly el: HTMLElement;
  readonly presenter: Presenter;
  /** document pixels ↔ screen */
  docToScreen(x: number, y: number): [number, number];
  screenToDoc(sx: number, sy: number): [number, number];
  /** what is shown now: the render, its pass and its key */
  shown(): { image: PresentImage | null; pass: string | null; key: string | null };
  flash(text: string, kind?: string): void;
}

const DEFAULT_COLOURS: Colours = { stage: [0.18, 0.18, 0.18], frame: [0, 0, 0] };
const hexColour = (s: unknown): [number, number, number] | null => {
  const m = typeof s === 'string' ? /^#([0-9a-f]{6})$/i.exec(s) : null;
  if (!m) return null;
  const v = parseInt(m[1]!, 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
};

export function mountViewport(n: NodeData, m: MountCtx): HTMLElement {
  const p = n.props as Record<string, any>;
  const rt = m.rt;
  const st = rt.store;
  const vid: string = p['viewId'] || p['id'] || 'main';
  const el = h('div', { class: ['ck-vp', p['small'] && 'is-small'], tabindex: '0', 'data-viewport': vid, role: 'img' });
  const cv = h('canvas', { class: 'ck-vp-c' });
  const ov = svgEl('svg', { class: 'ck-vp-o' });
  const hud = h('div', { class: 'ck-vp-hud' });
  const lab = h('div', { class: 'ck-vp-label' });
  const busy = h('div', { class: 'ck-vp-busy' });
  busy.hidden = true;
  const msg = h('div', { class: 'ck-vp-msg' });
  msg.hidden = true;
  el.append(cv, ov, lab, hud, busy, msg);
  if (p['hud']) {
    const x = m.mount(p['hud']);
    if (x) hud.append(x);
  }
  if (p['background']) el.style.background = p['background'];
  const colours: Colours = { ...DEFAULT_COLOURS, stage: hexColour(p['background']) ?? DEFAULT_COLOURS.stage };
  const presenter: Presenter = rt.services.presenter ? rt.services.presenter(cv) : new Canvas2DPresenter(cv);
  m.scope.onDispose(() => presenter.dispose());
  const viewPath = ['view', 'vp', vid];
  if (st.peek(viewPath) === undefined) st.writeDoc([{ path: viewPath, value: { zoom: p['fit'] || 'fit', cx: 0.5, cy: 0.5 } }], { tier: 'view', init: true });

  // ── local view state ──
  let panning = false;
  const V = {
    W: 0,
    H: 0,
    dpr: 1,
    nw: 0,
    nh: 0,
    s: 1,
    ox: 0,
    oy: 0,
    after: null as PresentImage | null,
    before: null as PresentImage | null,
    pass: null as string | null,
    zoom: 'fit' as Zoom,
    cx: 0.5,
    cy: 0.5,
    compare: 'off' as Compare,
    split: 0.5,
    key: null as string | null,
    fullKey: null as string | null,
    tool: null as string | null,
    dims: null as [number, number] | null,
  };
  const api: DomViewport = {
    el,
    id: vid,
    presenter,
    get view() {
      return V as any;
    },
    toScreen: (u, v) => [V.ox + u * V.nw * V.s, V.oy + v * V.nh * V.s],
    toImage: (sx, sy) => [(sx - V.ox) / (V.nw * V.s || 1), (sy - V.oy) / (V.nh * V.s || 1)],
    docToScreen: (x, y) => [V.ox + x * V.s, V.oy + y * V.s],
    screenToDoc: (sx, sy) => [(sx - V.ox) / V.s, (sy - V.oy) / V.s],
    scale: () => V.s,
    natural: () => [V.nw, V.nh],
    shown: () => ({ image: V.after, pass: V.pass, key: V.key }),
    setZoom,
    zoomBy,
    fit: () => setView({ zoom: 'fit', cx: 0.5, cy: 0.5 }),
    redraw: () => {
      paint();
      paintOverlays();
    },
    setCursor: c => void (el.style.cursor = c || ''),
    flash: (t, k) => rt.chrome.flash(el, t, k),
  };
  rt.viewports.set(vid, api);
  m.scope.onDispose(() => {
    if (rt.viewports.get(vid) === api) rt.viewports.delete(vid);
    rt.renders.cancel('vp:' + vid + ':after');
    rt.renders.cancel('vp:' + vid + ':before');
  });

  // ── layout & transform ──
  function layout(): void {
    const r = el.getBoundingClientRect();
    V.W = Math.max(1, r.width || el.clientWidth || 600);
    V.H = Math.max(1, r.height || el.clientHeight || 400);
    V.dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    cv.width = Math.round(V.W * V.dpr);
    cv.height = Math.round(V.H * V.dpr);
    cv.style.width = V.W + 'px';
    cv.style.height = V.H + 'px';
    ov.setAttribute('viewBox', `0 0 ${V.W} ${V.H}`);
    ov.setAttribute('width', String(V.W));
    ov.setAttribute('height', String(V.H));
    transform();
  }
  function fitScale(): number {
    if (!V.nw) return 1;
    return Math.min((V.W - 16) / V.nw, (V.H - 16) / V.nh);
  }
  function transform(): void {
    if (!V.nw) {
      V.s = 1;
      return;
    }
    V.s = V.zoom === 'fit' ? fitScale() : V.zoom === 'fill' ? Math.max(V.W / V.nw, V.H / V.nh) : +V.zoom;
    const iw = V.nw * V.s;
    const ih = V.nh * V.s;
    // centre: clamp so the image never drifts off the view
    V.cx = iw <= V.W ? 0.5 : clamp(V.cx, V.W / 2 / iw, 1 - V.W / 2 / iw);
    V.cy = ih <= V.H ? 0.5 : clamp(V.cy, V.H / 2 / ih, 1 - V.H / 2 / ih);
    V.ox = V.W / 2 - V.cx * iw;
    V.oy = V.H / 2 - V.cy * ih;
  }
  function setView(patch: Record<string, unknown>): void {
    st.set(viewPath, Object.assign({}, st.peek(viewPath) || {}, patch));
  }
  function setZoom(z: Zoom, at?: [number, number]): void {
    if (!at || z === 'fit') {
      setView({ zoom: z, cx: z === 'fit' ? 0.5 : V.cx, cy: z === 'fit' ? 0.5 : V.cy });
      return;
    }
    // keep (u, v) under the pointer
    const [u, v] = api.toImage(at[0], at[1]);
    const ns = z === 'fill' ? Math.max(V.W / V.nw, V.H / V.nh) : z;
    const cx = (V.W / 2 - (at[0] - u * V.nw * ns)) / (V.nw * ns);
    const cy = (V.H / 2 - (at[1] - v * V.nh * ns)) / (V.nh * ns);
    setView({ zoom: z, cx, cy });
  }
  function zoomBy(dir: number, at?: [number, number]): void {
    const cur = V.s;
    let z: Zoom | undefined = dir > 0 ? ZOOMS.find(x => x > cur * 1.01) : [...ZOOMS].reverse().find(x => x < cur * 0.99);
    if (z === undefined) z = dir > 0 ? ZOOMS[ZOOMS.length - 1]! : ZOOMS[0]!;
    if (dir < 0 && z < fitScale()) z = 'fit'; // zooming out stops at Fit, as Lightroom's does
    setZoom(z, at);
  }

  // ── painting (the presenter) ──
  function paint(): void {
    if (!V.after) return;
    const showBefore = V.compare === 'before' && V.before;
    presenter.setImages(showBefore ? V.before! : V.after, V.compare !== 'off' && V.compare !== 'before' ? V.before : null);
    const splitAt = V.compare === 'split' || V.compare === 'lr' || V.compare === 'tb' ? (V.ox + V.nw * V.s * V.split) / V.W : null;
    presenter.draw({ docW: V.nw, docH: V.nh, cx: (V.W / 2 - V.ox) / V.s, cy: (V.H / 2 - V.oy) / V.s, zoom: V.s, dpr: V.dpr, split: V.before ? splitAt : null }, colours);
  }

  // ── overlays: each is { read: τ, paint(svg, api, value, state) }; repainted on their state or a view change ──
  const ovs = ((p['overlays'] as any[]) || []).map((o, i) => ({ o, g: svgEl('g', { class: 'ck-ov ck-ov-' + (o.kind || i) }), value: undefined as unknown }));
  for (const x of ovs) ov.append(x.g);
  const toolG = svgEl('g', { class: 'ck-ov-tool' });
  const compareG = svgEl('g', { class: 'ck-ov-compare' });
  ov.append(toolG, compareG);
  const paintOne = (x: (typeof ovs)[number]): void => {
    x.g.replaceChildren();
    if (!V.nw) return;
    try {
      x.o.paint(x.g, api, x.value, st.readonly());
    } catch (e) {
      rt.handlerError(e, { at: n.at });
    }
  };
  function paintOverlays(): void {
    for (const x of ovs) paintOne(x);
    paintTool();
    compareG.replaceChildren();
    if (V.after && V.compare !== 'off') {
      const tag = (x: number, y: number, t: string): void => {
        const r = svgEl('g', { class: 'ck-vp-tag' });
        r.append(svgEl('rect', { x, y, width: t.length * 6.4 + 14, height: 18, rx: 3 }));
        const tx = svgEl('text', { x: x + 7, y: y + 13 });
        tx.textContent = t;
        r.append(tx);
        compareG.append(r);
      };
      if (V.compare === 'before') tag(8, 8, 'Before');
      else {
        const sx = V.ox + V.nw * V.s * V.split;
        tag(Math.max(8, sx - 64), 8, 'Before');
        tag(sx + 8, 8, 'After');
        compareG.append(svgEl('circle', { cx: sx, cy: V.oy + (V.nh * V.s) / 2, r: 7, class: 'ck-vp-splitk' }));
      }
    }
  }
  for (const x of ovs)
    if (x.o.read)
      m.cell(x.o.read, v => {
        x.value = v;
        paintOne(x);
      });

  // ── the active tool ──
  const toolIds: string[] = p['tools'] || [];
  let toolState: unknown = null;
  const activeTool = (): ToolSpec | null => rt.activeTool(toolIds);
  function paintTool(): void {
    toolG.replaceChildren();
    const t = activeTool();
    if (t?.overlay && V.nw)
      try {
        t.overlay(toolG, api, st.readonly(), toolState);
      } catch (e) {
        rt.handlerError(e, t);
      }
  }
  function cursorFor(): string {
    if (rt.spring === 'hand' || panning) return panning ? 'grabbing' : 'grab';
    if (rt.spring === 'zoom') return 'zoom-in';
    const t = activeTool();
    if (t?.cursor) return typeof t.cursor === 'function' ? t.cursor(st.readonly(), api) : t.cursor;
    if (p['click'] === 'toggle-1:1' && V.after) return V.zoom === 'fit' ? 'zoom-in' : 'zoom-out';
    return V.s > fitScale() * 1.01 ? 'grab' : 'default';
  }
  const updateCursor = (): void => void (el.style.cursor = cursorFor());

  // ── renders: the renderable from state (a cell), through rt.renders; stale answers never show ──
  interface Want {
    r: unknown;
    key: string;
    before: unknown;
    beforeKey: string | null;
    previewing: boolean;
  }
  let want: Want | null = null;
  const requested = { after: '', before: '' };
  const resolve = (x: unknown, s: any): unknown => (typeof x === 'function' ? (x as (s: any) => unknown)(s) : x);
  function visibleRegion(): Rect {
    const [x0, y0] = api.screenToDoc(0, 0);
    const [x1, y1] = api.screenToDoc(V.W, V.H);
    const x = Math.max(0, Math.floor(x0));
    const y = Math.max(0, Math.floor(y0));
    return { x, y, w: Math.min(V.nw, Math.ceil(x1)) - x, h: Math.min(V.nh, Math.ceil(y1)) - y };
  }
  function request(): void {
    if (!want) return;
    const job = want;
    const t = chooseTarget({ previewing: job.previewing, shownW: V.nw ? V.nw * V.s : V.W, shownH: V.nh ? V.nh * V.s : V.H, dpr: V.dpr, srcW: V.nw || undefined, srcH: V.nh || undefined, zoom: V.zoom, maxSide: p['maxSide'] });
    const region = t.pass === 'refine' && V.nw ? visibleRegion() : undefined;
    const sig = (k: string): string => `${k}|${t.pass}|${t.maxSide}|${region ? `${region.x},${region.y},${region.w},${region.h}` : ''}`;
    const go = (which: 'after' | 'before', r: unknown, k: string): void => {
      if (requested[which] === sig(k)) return;
      requested[which] = sig(k);
      busy.hidden = false;
      const gen = rt.renders.request('vp:' + vid + ':' + which, r, {
        pass: t.pass,
        maxSide: t.maxSide,
        ...(region ? { region } : {}),
        present: (res: Rendered, info) => {
          msg.hidden = true;
          if (which === 'after') {
            V.after = res.image;
            V.pass = info.pass;
            V.key = k;
            if (!job.previewing) V.fullKey = k;
            el.dataset['rendered'] = `${res.image.width}x${res.image.height}`;
            el.dataset['pass'] = info.pass;
            if (!V.dims && (Math.abs(res.srcW - V.nw) > 0.5 || Math.abs(res.srcH - V.nh) > 0.5)) {
              V.nw = res.srcW;
              V.nh = res.srcH;
            }
            transform();
            rt.emit('rendered', { viewport: vid, ms: res.ms, w: res.image.width, h: res.image.height, pass: info.pass, previewing: job.previewing });
            if (p['onRender']) m.run(p['onRender'], res, api);
          } else V.before = res.image;
          paint();
          paintOverlays();
          updateCursor();
          if (!rt.renders.busy('vp:' + vid + ':after')) busy.hidden = true;
        },
        onError: (e: unknown) => {
          busy.hidden = true;
          msg.textContent = String((e as Error)?.message ?? e);
          msg.hidden = false;
          rt.emit('renderError', { viewport: vid, error: e });
        },
      });
      if (gen == null) {
        busy.hidden = true;
        requested[which] = '';
        msg.textContent = 'Nothing can show this picture (no render bridge accepts it)';
        msg.hidden = false;
      }
    };
    go('after', job.r, job.key);
    if (V.compare !== 'off' && job.before != null && job.beforeKey) go('before', job.before, job.beforeKey);
  }
  m.cell(
    s => {
      let r = resolve(p['image'], s);
      const t = activeTool();
      if (t?.image && r != null) r = t.image(r, s);
      const before = p['before'] !== undefined ? resolve(p['before'], s) : null;
      const dims = p['dims'] !== undefined ? (resolve(p['dims'], s) as [number, number] | null) : null;
      return { r, before, dims, tool: s.ui?.tool };
    },
    v => {
      V.dims = v.dims ?? null;
      const nat = v.dims ?? (v.r != null ? (rt.renders.bridgeFor(v.r)?.naturalSize?.(v.r) ?? null) : null);
      if (nat && (nat[0] !== V.nw || nat[1] !== V.nh)) {
        V.nw = nat[0];
        V.nh = nat[1];
        transform();
      }
      if (v.r == null) {
        want = null;
        V.after = null;
        V.key = null;
        requested.after = '';
        if (presenter instanceof Canvas2DPresenter) presenter.clear();
        paintOverlays();
        return;
      }
      const key = rt.renders.keyOf(v.r) ?? '';
      const beforeKey = v.before != null ? rt.renders.keyOf(v.before) : null;
      // a draft only while this view's own picture moves: a preview elsewhere keeps it sharp
      want = { r: v.r, key, before: v.before, beforeKey, previewing: st.previewing && key !== V.fullKey };
      request();
    },
    { equals: () => false },
  );
  // draft → screen: when a gesture ends, render at full size
  const offStore = st.on(() => {
    if (!want) return;
    const pv = st.previewing && want.key !== V.fullKey;
    if (want.previewing !== pv) {
      want = { ...want, previewing: pv };
      request();
    }
  });
  m.scope.onDispose(offStore);

  // view state (zoom, centre) and compare mode
  m.cell(
    s => {
      const v = s.view?.vp?.[vid];
      return { zoom: v ? v.zoom : 'fit', cx: v ? v.cx : 0.5, cy: v ? v.cy : 0.5, compare: (p['compare'] === false ? 'off' : s.view?.compare || 'off') as Compare, split: s.view?.split || 0.5, tool: (s.ui?.tool as string) ?? null };
    },
    v => {
      const cmpChanged = v.compare !== V.compare;
      Object.assign(V, v);
      transform();
      paint();
      paintOverlays();
      updateCursor();
      if (want && (V.zoom !== 'fit' || cmpChanged)) request();
      el.dataset['tool'] = V.tool || '';
      el.dataset['zoom'] = String(V.zoom);
    },
    { equals: (a, b) => !!a && a.zoom === b.zoom && a.cx === b.cx && a.cy === b.cy && a.compare === b.compare && a.split === b.split && a.tool === b.tool },
  );
  const label = (p as any)['label'];
  if (label !== undefined)
    m.val(label, v => {
      lab.textContent = v ? String(v) : '';
      lab.hidden = !v;
    });
  else lab.hidden = true;

  layout();
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => {
      layout();
      paint();
      paintOverlays();
      if (want) request();
    });
    ro.observe(el);
    m.scope.onDispose(() => ro.disconnect());
  }

  // ── pointer ──
  const evAt = (e: PointerEvent | MouseEvent): ToolEvent => {
    const r = el.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const [u, v] = api.toImage(sx, sy);
    const pe = e as PointerEvent;
    const img = V.after;
    return {
      sx,
      sy,
      u,
      v,
      x: u * V.nw,
      y: v * V.nh,
      ix: img ? (u * V.nw - img.region.x) * img.scale : u * V.nw,
      iy: img ? (v * V.nh - img.region.y) * img.scale : v * V.nh,
      shift: e.shiftKey,
      alt: e.altKey,
      mod: rt.platform.mac ? e.metaKey : e.ctrlKey,
      pressure: pe.pointerType === 'pen' ? pe.pressure : pe.pressure || 0.5,
      pen: pe.pointerType === 'pen',
      button: e.button,
      raw: e,
      inside: u >= 0 && u <= 1 && v >= 0 && v <= 1,
      detail: e.detail,
    };
  };
  function panDrag(e: PointerEvent, clickToFit = false): void {
    const x0 = e.clientX;
    const y0 = e.clientY;
    const cx0 = V.cx;
    const cy0 = V.cy;
    const iw = V.nw * V.s;
    const ih = V.nh * V.s;
    let moved = false;
    panning = true;
    updateCursor();
    dragPtr(e, {
      move: ev => {
        if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) > 3) moved = true;
        if (moved) setView({ zoom: typeof V.zoom === 'number' ? V.zoom : V.s, cx: cx0 - (ev.clientX - x0) / iw, cy: cy0 - (ev.clientY - y0) / ih });
      },
      up: () => {
        panning = false;
        updateCursor();
        if (clickToFit && !moved && p['click'] === 'toggle-1:1') setZoom('fit');
      },
      cancel: () => {
        panning = false;
        setView({ cx: cx0, cy: cy0 });
        updateCursor();
      },
    });
  }
  function zoomGesture(e: PointerEvent): void {
    const a = evAt(e);
    const at: [number, number] = [a.sx, a.sy];
    const x0 = e.clientX;
    const s0 = V.s;
    let moved = false;
    dragPtr(e, {
      move: ev => {
        const dx = ev.clientX - x0;
        if (Math.abs(dx) > 3) moved = true;
        if (moved) setZoom(clamp(s0 * Math.pow(2, dx / 120), 1 / 16, 11), at);
      },
      up: () => {
        if (!moved) zoomBy(e.altKey ? -1 : 1, at);
      },
    });
  }
  listen(m.scope, el, 'pointerdown', (e: PointerEvent) => {
    el.focus?.({ preventScroll: true });
    rt.focus.canvas = vid;
    if (e.button === 1 || (e.button === 0 && rt.spring === 'hand')) {
      e.preventDefault();
      rt.keys.markUsed();
      panDrag(e);
      return;
    }
    if (e.button !== 0) return;
    if (rt.spring === 'zoom') {
      e.preventDefault();
      rt.keys.markUsed();
      zoomGesture(e);
      return;
    }
    // the split handle
    if ((V.compare === 'split' || V.compare === 'lr' || V.compare === 'tb') && V.after) {
      const sx = V.ox + V.nw * V.s * V.split;
      const a = evAt(e);
      if (Math.abs(a.sx - sx) < 10) {
        e.preventDefault();
        dragPtr(e, { move: ev => st.set(['view', 'split'], clamp((evAt(ev).sx - V.ox) / (V.nw * V.s), 0.02, 0.98)) });
        return;
      }
    }
    const t = activeTool();
    if (t?.on?.down) {
      e.preventDefault();
      if (rt.spring) rt.keys.markUsed();
      const on = t.on;
      const ctx = m.rctx({ vp: api, tool: t });
      const a = evAt(e);
      let g: unknown;
      try {
        g = on.down!(a, ctx);
      } catch (err) {
        rt.handlerError(err, t);
        return;
      }
      if (g === false) return;
      toolState = g;
      paintTool();
      dragPtr(e, {
        move: ev => {
          try {
            const r = on.drag?.(evAt(ev), ctx, toolState);
            if (r !== undefined) toolState = r;
          } catch (err) {
            rt.handlerError(err, t);
          }
          paintTool();
        },
        up: ev => {
          try {
            on.up?.(ev ? evAt(ev) : a, ctx, toolState);
          } catch (err) {
            rt.handlerError(err, t);
          }
          if (st.previewing) {
            rt.diagnostics.warn('CK-T420', `Tool '${t.id}' left a preview open`, { at: t.at ?? null, runtime: true, facts: ['The gesture ended without ctx.commit() or ctx.cancel(); the preview was committed for it.'], fix: "End the gesture with ctx.commit('Label') or ctx.cancel()." });
            st.commit(t.label || t.id, rt.txOptsNow(m.env));
          }
          toolState = null;
          paintTool();
        },
        cancel: () => {
          try {
            on.cancel?.(ctx, toolState);
          } catch (err) {
            rt.handlerError(err, t);
          }
          st.cancel();
          toolState = null;
          paintTool();
        },
      });
      return;
    }
    // no tool: drag pans when zoomed in, a click toggles fit / 1:1
    if (V.after && V.s > fitScale() * 1.01) {
      e.preventDefault();
      panDrag(e, true);
      return;
    }
    if (p['click'] === 'toggle-1:1' && V.after) {
      const a = evAt(e);
      if (a.inside) setZoom(1, [a.sx, a.sy]);
    }
  });
  listen(m.scope, el, 'pointermove', (e: PointerEvent) => {
    const t = activeTool();
    if (t?.on?.hover && !e.buttons) {
      const ctx = m.rctx({ vp: api, tool: t });
      try {
        toolState = t.on.hover(evAt(e), ctx, toolState) ?? toolState;
      } catch (err) {
        rt.handlerError(err, t);
      }
      paintTool();
    }
    rt.pointer = { viewport: vid, ...evAt(e), raw: undefined };
    rt.emit('pointer', rt.pointer);
  });
  listen(m.scope, el, 'pointerleave', () => {
    rt.pointer = null;
    rt.emit('pointer', null);
    const t = activeTool();
    if (t?.on?.leave) {
      t.on.leave(m.rctx({ vp: api }));
      paintTool();
    }
  });
  listen(m.scope, el, 'pointerenter', () => void (rt.focus.canvas = vid));
  listen(
    m.scope,
    el,
    'wheel',
    (e: WheelEvent) => {
      if (p['lock'] || !V.nw) return;
      e.preventDefault();
      const a = evAt(e);
      if (e.ctrlKey || e.metaKey || e.altKey) {
        // pinch arrives as ctrl+wheel; Alt+wheel zooms (Photoshop)
        const k = Math.exp(-e.deltaY * (e.ctrlKey && !e.metaKey ? 0.01 : 0.0025));
        const ns = clamp(V.s * k, fitScale(), 11);
        if (ns <= fitScale() * 1.001) {
          if (V.zoom !== 'fit') setZoom('fit');
        } else setZoom(ns, [a.sx, a.sy]);
        return;
      }
      if (V.s <= fitScale() * 1.01) return;
      const iw = V.nw * V.s;
      const ih = V.nh * V.s;
      setView({ zoom: typeof V.zoom === 'number' ? V.zoom : V.s, cx: V.cx + (e.shiftKey ? e.deltaY : e.deltaX) / iw, cy: V.cy + (e.shiftKey ? 0 : e.deltaY) / ih });
    },
    { passive: false },
  );
  // right-click: the viewport's own menu, else the shell's .context('canvas', …)
  listen(m.scope, el, 'contextmenu', (e: MouseEvent) => {
    const items = p['context'] !== undefined ? p['context'] : rt.app.ir.contexts.get('canvas');
    if (!items) return;
    e.preventDefault();
    const list = typeof items === 'function' ? (items as any)(st.readonly(), rt.pointer) : items;
    rt.chrome.contextMenu(e.clientX, e.clientY, list, rt.pointer);
  });
  // files dropped on the photo
  if (p['drop']) {
    listen(m.scope, el, 'dragover', (e: DragEvent) => {
      if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) {
        e.preventDefault();
        el.classList.add('is-drop');
      }
    });
    listen(m.scope, el, 'dragleave', () => el.classList.remove('is-drop'));
    listen(m.scope, el, 'drop', (e: DragEvent) => {
      el.classList.remove('is-drop');
      if (e.dataTransfer && e.dataTransfer.files.length) {
        e.preventDefault();
        m.run(p['drop'], [...e.dataTransfer.files]);
      }
    });
  }
  const offSpring = rt.on('spring', () => {
    updateCursor();
    paintTool();
    // a spring tool may replace the picture (its image hook)
    const t = activeTool();
    if (want && (t?.image || V.key !== want.key)) {
      const s = st.readonly();
      let r = resolve(p['image'], s);
      if (t?.image && r != null) r = t.image(r, s);
      if (r != null) {
        want = { ...want, r, key: rt.renders.keyOf(r) ?? '' };
        request();
      }
    }
  });
  m.scope.onDispose(offSpring);
  return el;
}

defineRenderer('viewport', mountViewport);

// ── thumb: a small picture; src at once, a renderable on the background lane through the thumbnail cache ──
defineRenderer('thumb', (n, m) => {
  const p = n.props as Record<string, any>;
  const el = h('div', { class: ['ck-thumb', p['fit'] === 'cover' && 'is-cover'] });
  const max: number = p['max'] || 256;
  const cv = h('canvas', { class: 'ck-thumb-c' });
  const img = h('img', { class: 'ck-thumb-i', alt: '', draggable: 'false' });
  img.hidden = true;
  const badge = h('span', { class: 'ck-thumb-badge' });
  badge.hidden = true;
  el.append(cv, img, badge);
  let live = true;
  m.scope.onDispose(() => void (live = false));
  const show = (r: Rendered): void => {
    if (!live) return;
    const pres = new Canvas2DPresenter(cv);
    cv.width = r.image.width;
    cv.height = r.image.height;
    pres.setImages(r.image, null);
    const reg = r.image.region;
    const zoom = r.image.width / (reg.w || 1);
    pres.draw({ docW: reg.w, docH: reg.h, cx: reg.x + reg.w / 2, cy: reg.y + reg.h / 2, zoom, dpr: 1, split: null }, { stage: [0, 0, 0], frame: [0, 0, 0] });
    el.dataset['rendered'] = `${r.image.width}x${r.image.height}`;
  };
  if (p['src'] !== undefined)
    m.val(p['src'], v => {
      img.hidden = !v;
      if (v) img.src = String(v);
    });
  if (p['image'] !== undefined)
    m.val(p['image'], r => {
      if (r == null) return;
      m.rt.renders.thumb(r, max, show);
    });
  if (p['badge'] !== undefined)
    m.val(p['badge'], v => {
      badge.textContent = v ? String(v) : '';
      badge.hidden = !v;
    });
  return el;
});
