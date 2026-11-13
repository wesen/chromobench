// The viewport (port of CraftKit ui/viewport.js onto the render bridge and the presenter). It shows a τ renderable
// through rt.renders (slots vp:<id>:after / vp:<id>:before; draft while this view previews, screen otherwise,
// refine of the visible region past 1:1), keeps the view (zoom, centre) in the view tier at view.vp[id], compares
// before/after, draws SVG overlays, and routes the pointer to the active tool or a held spring.
//
// Tool handlers get (e, ctx, g): e carries u, v (0..1 across the image), x, y (document pixels), ix, iy (pixels of
// the shown render), sx, sy (screen), the modifiers and pressure; down returns the gesture's state g.
//
// The parts live in dom/viewport/: state.ts (zoom levels, DomViewport, the view state V, the parts every module
// gets), colour.ts (the stage colour), geometry.ts (layout, transform, zoom), pointer.ts (the active tool and the
// pointer), paint.ts (the presenter and the SVG overlays), render.ts (render requests and the cells that drive
// them) and thumb.ts (the thumb renderer). This file builds the elements, the view state and the API, then creates
// the parts in the order their cells and listeners were created before: a cell runs once when it is created.

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { NodeData } from '../ir/node.ts';
import type { Colours, Presenter } from '../app/render/types.ts';
import { h, svgEl } from './h.ts';
import { defineRenderer, type MountCtx } from './mount.ts';
import { Canvas2DPresenter } from './presenter-2d.ts';
import { viewState, type DomViewport, type ViewportParts } from './viewport/state.ts';
import { DEFAULT_COLOURS, cssColour } from './viewport/colour.ts';
import { viewGeometry } from './viewport/geometry.ts';
import { viewPointer } from './viewport/pointer.ts';
import { viewPaint } from './viewport/paint.ts';
import { viewRender } from './viewport/render.ts';
import { mountThumb } from './viewport/thumb.ts';

export { ZOOMS, type DomViewport } from './viewport/state.ts';

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
  // the stage around the picture: the program's background, else the theme's --canvas (CHB-025), read at paint time
  const fixedStage = cssColour(p['background']);
  const colours: Colours = { ...DEFAULT_COLOURS, stage: fixedStage ?? DEFAULT_COLOURS.stage };
  const themeStage = (): [number, number, number] =>
    fixedStage ?? (typeof getComputedStyle === 'function' ? cssColour(getComputedStyle(el).getPropertyValue('--canvas')) : null) ?? DEFAULT_COLOURS.stage;
  const presenter: Presenter = rt.services.presenter ? rt.services.presenter(cv) : new Canvas2DPresenter(cv);
  m.scope.onDispose(() => presenter.dispose());
  const viewPath = ['view', 'vp', vid];
  if (st.peek(viewPath) === undefined) st.writeDoc([{ path: viewPath, value: { zoom: p['fit'] || 'fit', cx: 0.5, cy: 0.5 } }], { tier: 'view', init: true });

  // ── local view state ──
  const V = viewState();
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
    setZoom: (z, at) => setZoom(z, at),
    zoomBy: (dir, at) => zoomBy(dir, at),
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

  const vp: ViewportParts = { n, m, p, rt, st, vid, el, cv, ov, lab, busy, msg, presenter, colours, fixedStage, themeStage, viewPath, V, api };
  const geometry = viewGeometry(vp);
  const { setView, setZoom, zoomBy } = geometry;
  // the tool and pointer functions first (no cells): the overlays paint the tool, the renders set the cursor
  const pointer = viewPointer(vp, geometry);
  const paints = viewPaint(vp, pointer);
  const { paint, paintOverlays } = paints;
  const { listenSpring } = viewRender(vp, geometry, paints, pointer);
  pointer.listenPointer();
  listenSpring();
  return el;
}

defineRenderer('viewport', mountViewport);
defineRenderer('thumb', mountThumb);
