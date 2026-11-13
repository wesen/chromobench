// The active tool and the pointer: which tool is active, its gesture state, overlay and cursor, and every pointer,
// wheel, context-menu and drop event on the viewport (pan, the zoom spring, the split handle, tool gestures, a
// click to 1:1). listenPointer() registers the listeners; the entry calls it where they were registered before.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { clamp } from '../../core/util.ts';
import type { ToolEvent, ToolSpec } from '../../build/types.ts';
import { listen, svgEl, drag as dragPtr } from '../h.ts';
import type { ViewportParts } from './state.ts';
import type { Geometry } from './geometry.ts';

export function viewPointer({ m, p, rt, st, vid, el, V, api }: ViewportParts, { fitScale, setView, setZoom, zoomBy }: Geometry) {
  let panning = false;
  const toolG = svgEl('g', { class: 'ck-ov-tool' });

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
  function listenPointer(): void {
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
  }
  return { toolG, activeTool, paintTool, updateCursor, listenPointer };
}
export type Pointer = ReturnType<typeof viewPointer>;
