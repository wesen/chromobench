// What the viewport shows: the renderable read from state (a cell) goes through rt.renders, as a draft while this
// view previews, at screen size otherwise, and as a refine of the visible region past 1:1; stale answers never
// show. Also the view state read from state (zoom, centre, compare), the label, layout on resize, and the spring
// listener (a spring tool may replace the picture), which the entry registers last with listenSpring().

/* eslint-disable @typescript-eslint/no-explicit-any */
import { chooseTarget } from '../../app/render/queue.ts';
import type { Rect, Rendered } from '../../app/render/types.ts';
import { Canvas2DPresenter } from '../presenter-2d.ts';
import type { Compare, Cover, ViewportParts } from './state.ts';
import type { Geometry } from './geometry.ts';
import type { Paint } from './paint.ts';
import type { Pointer } from './pointer.ts';

export function viewRender(
  { m, p, rt, st, vid, el, lab, busy, msg, presenter, V, api }: ViewportParts,
  { layout, transform }: Geometry,
  { paint, paintCover, paintOverlays }: Paint,
  { activeTool, paintTool, updateCursor }: Pointer,
) {
  // ── renders: the renderable from state (a cell), through rt.renders; stale answers never show ──
  interface Want {
    r: unknown;
    key: string;
    before: unknown;
    beforeKey: string | null;
    previewing: boolean;
  }
  let want: Want | null = null;
  /** the cover's renderable and key (a mask overlay), requested with the picture's target */
  let cover: { r: unknown; key: string } | null = null;
  const requested = { after: '', before: '', cover: '' };
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
    const go = (which: 'after' | 'before' | 'cover', r: unknown, k: string): void => {
      if (requested[which] === sig(k)) return;
      requested[which] = sig(k);
      if (which === 'cover') {
        // the cover never blocks or replaces the picture: no busy mark, no message; a failure hides it
        rt.renders.request('vp:' + vid + ':cover', r, {
          pass: t.pass,
          maxSide: t.maxSide,
          ...(region ? { region } : {}),
          present: (res: Rendered) => {
            if (!cover) return; // turned off meanwhile (the queue drops answers a newer request replaced)
            V.cover = res.image;
            V.coverKey = k;
            el.dataset['cover'] = `${res.image.width}x${res.image.height}`;
            paintCover();
            rt.emit('rendered', { viewport: vid, cover: true, ms: res.ms, w: res.image.width, h: res.image.height, pass: t.pass, previewing: job.previewing });
          },
          onError: (e: unknown) => {
            requested.cover = '';
            V.cover = null;
            V.coverKey = null;
            paintCover();
            rt.emit('renderError', { viewport: vid, cover: true, error: e });
          },
        });
        return;
      }
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
          // in words (the app's explainError, else the message without its leading code); the code in the tooltip
          const raw = String((e as Error)?.message ?? e);
          msg.textContent = rt.explainError?.(e, {})?.text ?? raw.replace(/^[A-Z][A-Z0-9]*[_-][A-Z0-9_-]*:\s*/, '');
          msg.title = `Technical: ${raw}`;
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
    if (cover) go('cover', cover.r, cover.key);
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
  // the cover (a mask overlay): its renderable goes with the picture's target; its style repaints without a render
  if (p['cover'] !== undefined)
    m.cell(
      s => (resolve(p['cover'], s) as Cover | null | undefined) ?? null,
      c => {
        if (!c || c.image == null) {
          if (cover) rt.renders.cancel('vp:' + vid + ':cover');
          cover = null;
          requested.cover = '';
          V.cover = null;
          V.coverKey = null;
          V.coverStyle = null;
          delete el.dataset['cover'];
          paintCover();
          return;
        }
        V.coverStyle = { mode: c.mode ?? 'tint', colour: c.colour ?? [1, 0, 0], opacity: c.opacity ?? 0.5 };
        const key = rt.renders.keyOf(c.image) ?? '';
        cover = { r: c.image, key };
        if (V.coverKey !== key) request();
        paintCover();
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
  function listenSpring(): void {
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
  }
  return { listenSpring };
}
