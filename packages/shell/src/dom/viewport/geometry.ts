// Layout and transform: the canvas and the overlay sized to the element, the scale and offset that place the
// picture (fit, fill or a zoom factor; centred, clamped so it never drifts off), and the view-state writes behind
// zoom and pan.

import { clamp } from '../../core/util.ts';
import { ZOOMS, type Zoom, type ViewportParts } from './state.ts';

export function viewGeometry({ el, cv, ov, V, st, viewPath, api }: ViewportParts) {
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
  return { layout, fitScale, transform, setView, setZoom, zoomBy };
}
export type Geometry = ReturnType<typeof viewGeometry>;
