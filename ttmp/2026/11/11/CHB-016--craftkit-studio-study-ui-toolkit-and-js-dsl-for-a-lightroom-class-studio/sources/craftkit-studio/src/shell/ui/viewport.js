// The viewport: the canvas form. It shows an engine expression (or a τ that picks one), renders it at the size it
// is shown (a screen-sized proxy while a gesture previews, full size after), keeps the view (zoom, centre) in the
// view tier, compares before/after, draws overlays, and routes the pointer to the active tool or a held spring.
//
//   ck.viewport(render, { id, before, dims: s => [w, h], tools: ['crop', 'heal'], overlays: [ck.overlay.thirds()],
//                         click: 'toggle-1:1', label: s => …, drop: (files, ctx) => … })
//
// Tool handlers get (e, ctx, g): e carries u, v (0..1 across the shown image), ix, iy (its pixels), sx, sy (screen),
// the modifiers and pressure; down returns the gesture's state g; drag and up receive it.

import { defineForm, node } from './node.js';
import { h, listen, svgEl, drag as dragPtr } from './dom.js';
import { clamp } from '../core/util.js';
import { isExpr } from '../core/engine.js';

const ZOOMS = [1 / 16, 1 / 12, 1 / 8, 1 / 6, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 1, 2, 3, 4, 8, 11];

defineForm('viewport', {
  slots: { image: 'τ', before: 'τ', arg: 'τ', dims: 'τ', tools: 'β', overlays: 'β', click: 'β', label: 'τ', drop: 'ρ', lock: 'β', checker: 'β', compare: 'β', hud: 'β', fit: 'β', background: 'β', maxSide: 'β', proxy: 'β', onRender: 'ρ', cursor: 'τ', viewId: 'β', small: 'β', context: 'τ' },
  mount(n, m) {
    const p = n.props, app = m.app, st = app.store;
    const vid = p.viewId || p.id || 'main';
    const el = h('div', { class: ['ck-vp', p.small && 'is-small'], tabindex: '0', 'data-viewport': vid, role: 'img' });
    const cv = h('canvas', { class: 'ck-vp-c' });
    const ov = svgEl('svg', { class: 'ck-vp-o' });
    const hud = h('div', { class: 'ck-vp-hud' });
    const lab = h('div', { class: 'ck-vp-label' });
    const busy = h('div', { class: 'ck-vp-busy' }); busy.hidden = true;
    const msg = h('div', { class: 'ck-vp-msg' }); msg.hidden = true;
    el.append(cv, ov, lab, hud, busy, msg);
    if (p.hud) hud.append(m.mount(p.hud));
    if (p.background) el.style.background = p.background;
    const viewPath = ['view', 'vp', vid];
    if (st.peek(viewPath) === undefined) st.writeDoc([{ path: viewPath, value: { zoom: p.fit || 'fit', cx: 0.5, cy: 0.5 } }], { tier: 'view', init: true });

    // ── local view state ──
    let panning = false;
    const V = { W: 0, H: 0, dpr: 1, nw: 0, nh: 0, s: 1, ox: 0, oy: 0, after: null, before: null, zoom: 'fit', cx: 0.5, cy: 0.5, compare: 'off', split: 0.5, key: '', beforeKey: '', srcLong: 0, tool: null };
    const api = {
      el, id: vid,
      get view() { return V; },
      toScreen: (u, v) => [V.ox + u * V.nw * V.s, V.oy + v * V.nh * V.s],
      toImage: (sx, sy) => [(sx - V.ox) / (V.nw * V.s), (sy - V.oy) / (V.nh * V.s)],
      scale: () => V.s,
      natural: () => [V.nw, V.nh],
      bitmap: () => V.after,
      setZoom, zoomBy, fit: () => setView({ zoom: 'fit', cx: 0.5, cy: 0.5 }),
      redraw: () => { paint(); paintOverlays(); },
      setCursor: c => { el.style.cursor = c || ''; },
      flash: (t, k) => app.chrome.flash(el, t, k),
    };
    app.viewports.set(vid, api);
    m.scope.onDispose(() => { if (app.viewports.get(vid) === api) app.viewports.delete(vid); });

    // ── layout & transform ──
    function layout() {
      const r = el.getBoundingClientRect();
      V.W = Math.max(1, r.width); V.H = Math.max(1, r.height); V.dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(V.W * V.dpr); cv.height = Math.round(V.H * V.dpr);
      cv.style.width = V.W + 'px'; cv.style.height = V.H + 'px';
      ov.setAttribute('viewBox', `0 0 ${V.W} ${V.H}`); ov.setAttribute('width', V.W); ov.setAttribute('height', V.H);
      transform();
    }
    function pane() {   // the area one image occupies (half the view when comparing side by side)
      if (V.compare === 'lr') return { x: 0, y: 0, w: V.W / 2, h: V.H };
      if (V.compare === 'tb') return { x: 0, y: 0, w: V.W, h: V.H / 2 };
      return { x: 0, y: 0, w: V.W, h: V.H };
    }
    function fitScale() { const P = pane(); if (!V.nw) return 1; return Math.min((P.w - 16) / V.nw, (P.h - 16) / V.nh); }
    function transform() {
      const P = pane();
      if (!V.nw) { V.s = 1; return; }
      const f = fitScale();
      V.s = V.zoom === 'fit' ? f : V.zoom === 'fill' ? Math.max(P.w / V.nw, P.h / V.nh) : +V.zoom;
      const iw = V.nw * V.s, ih = V.nh * V.s;
      // centre: clamp so the image never drifts off the pane
      let cx = V.cx, cy = V.cy;
      if (iw <= P.w) cx = 0.5; else cx = clamp(cx, P.w / 2 / iw, 1 - P.w / 2 / iw);
      if (ih <= P.h) cy = 0.5; else cy = clamp(cy, P.h / 2 / ih, 1 - P.h / 2 / ih);
      V.cx = cx; V.cy = cy;
      V.ox = P.x + P.w / 2 - cx * iw; V.oy = P.y + P.h / 2 - cy * ih;
    }
    function setView(patch) { st.set(viewPath, Object.assign({}, st.peek(viewPath) || {}, patch)); }
    function setZoom(z, at) {   // at: screen point that stays put
      const [u, v] = at ? api.toImage(at[0], at[1]) : [V.cx, V.cy];
      const P = pane();
      const ns = z === 'fit' ? fitScale() : z === 'fill' ? Math.max(P.w / V.nw, P.h / V.nh) : z;
      if (!at || z === 'fit') { setView({ zoom: z, cx: z === 'fit' ? 0.5 : V.cx, cy: z === 'fit' ? 0.5 : V.cy }); return; }
      // keep (u, v) under the pointer: new centre so that ox + u*nw*ns = at.x
      const cx = (P.x + P.w / 2 - (at[0] - u * V.nw * ns)) / (V.nw * ns), cy = (P.y + P.h / 2 - (at[1] - v * V.nh * ns)) / (V.nh * ns);
      setView({ zoom: z, cx, cy });
    }
    function zoomBy(dir, at) {
      const cur = V.s;
      let z = dir > 0 ? ZOOMS.find(x => x > cur * 1.01) : [...ZOOMS].reverse().find(x => x < cur * 0.99);
      if (!z) z = dir > 0 ? ZOOMS[ZOOMS.length - 1] : ZOOMS[0];
      if (dir < 0 && z < fitScale()) z = 'fit';   // zooming out stops at Fit, as Lightroom's does
      setZoom(z, at);
    }

    // ── painting ──
    const g = cv.getContext('2d');
    function drawImg(bmp, x, y, w, hh) {
      if (!bmp) return;
      g.imageSmoothingEnabled = V.s * V.dpr < 2.5; g.imageSmoothingQuality = 'high';
      g.drawImage(bmp, x, y, w, hh);
    }
    function paint() {
      g.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
      g.clearRect(0, 0, V.W, V.H);
      if (!V.after) return;
      const iw = V.nw * V.s, ih = V.nh * V.s;
      if (V.compare === 'lr' || V.compare === 'tb') {
        const P = pane();
        const off = V.compare === 'lr' ? [P.w, 0] : [0, P.h];
        drawImg(V.before || V.after, V.ox, V.oy, iw, ih);
        drawImg(V.after, V.ox + off[0], V.oy + off[1], iw, ih);
        g.fillStyle = 'rgba(0,0,0,.35)';
        if (V.compare === 'lr') g.fillRect(P.w - 0.5, 0, 1, V.H); else g.fillRect(0, P.h - 0.5, V.W, 1);
        return;
      }
      if (V.compare === 'before') { drawImg(V.before || V.after, V.ox, V.oy, iw, ih); return; }
      drawImg(V.after, V.ox, V.oy, iw, ih);
      if (V.compare === 'split' && V.before) {
        const sx = V.ox + iw * V.split;
        g.save(); g.beginPath(); g.rect(V.ox, V.oy, sx - V.ox, ih); g.clip();
        drawImg(V.before, V.ox, V.oy, iw, ih);
        g.restore();
        g.fillStyle = '#fff'; g.fillRect(sx - 0.5, V.oy, 1, ih);
      }
    }

    // ── overlays: each is { read: τ, paint(svg, api, value, state) }; repainted on their state or a view change ──
    const ovs = (p.overlays || []).map((o, i) => ({ o, g: svgEl('g', { class: 'ck-ov ck-ov-' + (o.kind || i) }), value: undefined }));
    for (const x of ovs) ov.append(x.g);
    const toolG = svgEl('g', { class: 'ck-ov-tool' }); ov.append(toolG);
    const compareG = svgEl('g', { class: 'ck-ov-compare' }); ov.append(compareG);
    function paintOverlays() {
      const sv = st.readonly();
      for (const x of ovs) { x.g.replaceChildren(); try { x.o.paint(x.g, api, x.value, sv); } catch (e) { console.error(e); } }
      paintTool();
      compareG.replaceChildren();
      if (V.after && (V.compare === 'lr' || V.compare === 'tb' || V.compare === 'before' || V.compare === 'split')) {
        const P = pane();
        const tag = (x, y, t) => { const r = svgEl('g', { class: 'ck-vp-tag' }); const w = t.length * 6.4 + 14; r.append(svgEl('rect', { x, y, width: w, height: 18, rx: 3 })); const tx = svgEl('text', { x: x + 7, y: y + 13 }); tx.textContent = t; r.append(tx); compareG.append(r); };
        if (V.compare === 'lr') { tag(8, 8, 'Before'); tag(P.w + 8, 8, 'After'); }
        else if (V.compare === 'tb') { tag(8, 8, 'Before'); tag(8, P.h + 8, 'After'); }
        else if (V.compare === 'before') tag(8, 8, 'Before');
        else if (V.compare === 'split') { const sx = V.ox + V.nw * V.s * V.split; tag(Math.max(8, sx - 64), 8, 'Before'); tag(sx + 8, 8, 'After'); compareG.append(svgEl('circle', { cx: sx, cy: V.oy + V.nh * V.s / 2, r: 7, class: 'ck-vp-splitk' })); }
      }
    }
    for (const x of ovs) if (x.o.read) m.cell(x.o.read, v => { x.value = v; x.g.replaceChildren(); try { x.o.paint(x.g, api, v, st.readonly()); } catch (e) { console.error(e); } });

    // ── the active tool ──
    const toolIds = p.tools || [];
    let toolState = null;
    function activeTool() {
      if (app.spring) return app.tools.get(app.spring) || null;
      const t = V.tool && toolIds.includes(V.tool) ? app.tools.get(V.tool) : null;
      return t || null;
    }
    function paintTool() {
      toolG.replaceChildren();
      const t = activeTool();
      if (t && t.overlay) { try { t.overlay(toolG, api, st.readonly(), toolState); } catch (e) { console.error(e); } }
    }
    function cursorFor() {
      if (app.spring === 'hand' || panning) return panning ? 'grabbing' : 'grab';
      if (app.spring === 'zoom') return 'zoom-in';
      const t = activeTool();
      if (t && t.cursor) return typeof t.cursor === 'function' ? t.cursor(st.readonly(), api) : t.cursor;
      if (p.click === 'toggle-1:1' && V.after) return V.zoom === 'fit' ? 'zoom-in' : 'zoom-out';
      return V.s > fitScale() * 1.01 ? 'grab' : 'default';
    }
    const updateCursor = () => { el.style.cursor = cursorFor(); };

    // ── renders: values from state (a cell), sent on the render lane; stale answers are dropped ──
    let want = null;
    const eng = app.engine;
    function resolveExpr(x, s) { if (!x) return null; if (isExpr(x)) return x; if (typeof x === 'function') return x(s); return x; }
    function sizeFor(previewing) {
      const P = pane();
      const need = Math.ceil(Math.max(V.nw ? V.nw * V.s : P.w, V.nh ? V.nh * V.s : P.h) * V.dpr);
      const cap = V.srcLong || p.maxSide || 2048;
      const full = Math.max(64, Math.min(cap, Math.ceil(need / 128) * 128));
      return previewing ? Math.min(full, p.proxy || 384) : full;
    }
    function request() {
      if (!want || !want.expr) return;
      app.scheduler.render(async () => {
        const job = want; if (!job) return;
        const epoch = eng.nextEpoch();   // global: a remounted viewport on the same slot must not look stale
        const max = sizeFor(job.previewing);
        const key = job.key + '|' + max;
        const jobs = [];
        if (key !== V.key) jobs.push(['after', job.expr, job.values, key]);
        const wantBefore = (V.compare !== 'off') && job.before;
        if (wantBefore) { const bk = job.beforeKey + '|' + max; if (bk !== V.beforeKey) jobs.push(['before', job.before, job.beforeValues, bk]); }
        if (!jobs.length) return;
        busy.hidden = false;
        for (const [which, expr, values, k] of jobs) {
          const r = await eng.render(expr, values, { max, slot: 'vp:' + vid + ':' + which, epoch, lane: 'live' });
          if (r.stale || r.superseded) continue;
          if (r.error) { msg.textContent = r.error; msg.hidden = false; continue; }
          msg.hidden = true;
          if (which === 'after') {
            if (V.after && V.after !== r.bmp && V.after.close) { const old = V.after; setTimeout(() => old.close && old.close(), 0); }
            V.after = r.bmp; V.key = k; el.dataset.rendered = r.w + 'x' + r.h;   // for tests and the inspector
            if (!job.previewing) V.fullKey = job.key;
            // natural size: what a full-size render would be (the render was made from a source loaded at `max`)
            const nat = V.srcLong && max < V.srcLong ? [r.w * V.srcLong / max, r.h * V.srcLong / max] : [r.w, r.h];
            if (!V.nw || Math.abs(nat[0] / nat[1] - V.nw / V.nh) > 0.002 || !job.previewing) { const changed = !V.nw || Math.abs(nat[0] - V.nw) > 2; V.nw = nat[0]; V.nh = nat[1]; if (changed) transform(); }
            app.emit('rendered', { viewport: vid, ms: r.ms, w: r.w, h: r.h, previewing: job.previewing });
            if (p.onRender) m.run(p.onRender, r, api);
          } else { if (V.before && V.before.close) V.before.close(); V.before = r.bmp; V.beforeKey = k; }
          transform(); paint(); paintOverlays();
        }
        busy.hidden = true;
        // a fuller render after a proxy: when the gesture ends the cell changes previewing → false and asks again
      });
    }
    m.cell(s => {
      const expr = resolveExpr(p.image, s);
      const arg = p.arg !== undefined ? (typeof p.arg === 'function' ? p.arg(s) : p.arg) : s;
      const values = expr ? eng.values(expr, arg) : null;
      const before = p.before ? resolveExpr(p.before, s) : null;
      const beforeValues = before ? eng.values(before, arg) : null;
      const dims = p.dims ? (typeof p.dims === 'function' ? p.dims(s) : p.dims) : null;
      return { expr, values, before, beforeValues, dims };
    }, v => {
      V.srcLong = v.dims ? Math.max(v.dims[0], v.dims[1]) : 0;
      if (!v.expr) { want = null; V.after = null; V.key = ''; paint(); paintOverlays(); return; }
      const key = String(v.expr) + JSON.stringify(v.values);
      const beforeKey = v.before ? String(v.before) + JSON.stringify(v.beforeValues) : '';
      // a proxy only while this view's own values move: a preview elsewhere (an ink limit, a mask name) keeps it sharp
      want = { expr: v.expr, values: v.values, before: v.before, beforeValues: v.beforeValues, key, beforeKey, previewing: st.previewing && key !== V.fullKey };
      request();
    }, { equals: () => false });
    // preview → full: when a gesture ends, render at full size
    const offStore = st.on(() => { if (!want) return; const pv = st.previewing && want.key !== V.fullKey; if (want.previewing !== pv) { want = Object.assign({}, want, { previewing: pv }); request(); } });
    m.scope.onDispose(offStore);

    // view state (zoom, centre) and compare mode
    m.cell(s => { const v = s.view && s.view.vp && s.view.vp[vid]; return { zoom: v ? v.zoom : 'fit', cx: v ? v.cx : 0.5, cy: v ? v.cy : 0.5, compare: p.compare === false ? 'off' : (s.view && s.view.compare) || 'off', split: (s.view && s.view.split) || 0.5, tool: s.ui && s.ui.tool }; }, v => {
      const cmpChanged = v.compare !== V.compare;
      Object.assign(V, { zoom: v.zoom, cx: v.cx, cy: v.cy, compare: v.compare, split: v.split, tool: v.tool });
      transform(); paint(); paintOverlays(); updateCursor();
      if (V.after && (V.zoom !== 'fit' || cmpChanged)) request();
      el.dataset.tool = V.tool || '';
    }, { equals: (a, b) => JSON.stringify(a) === JSON.stringify(b) });
    if (p.label !== undefined) m.val(p.label, v => { lab.textContent = v || ''; lab.hidden = !v; });
    else lab.hidden = true;

    const ro = new ResizeObserver(() => { layout(); paint(); paintOverlays(); if (want) request(); });
    ro.observe(el); m.scope.onDispose(() => ro.disconnect());
    requestAnimationFrame(layout);

    // ── pointer ──
    const evAt = e => {
      const r = el.getBoundingClientRect(); const sx = e.clientX - r.left, sy = e.clientY - r.top;
      const [u, v] = api.toImage(sx, sy);
      return { sx, sy, u, v, ix: u * V.nw, iy: v * V.nh, shift: e.shiftKey, alt: e.altKey, mod: e.metaKey || e.ctrlKey, pressure: e.pointerType === 'pen' ? e.pressure : e.pressure || 0.5, pen: e.pointerType === 'pen', button: e.button, raw: e, inside: u >= 0 && u <= 1 && v >= 0 && v <= 1, detail: e.detail };
    };
    function pan(e) {
      panning = true; updateCursor();
      const x0 = e.clientX, y0 = e.clientY, cx0 = V.cx, cy0 = V.cy;
      const iw = V.nw * V.s, ih = V.nh * V.s;
      dragPtr(e, {
        move: ev => setView({ zoom: V.zoom === 'fit' ? V.s : V.zoom === 'fill' ? V.s : V.zoom, cx: cx0 - (ev.clientX - x0) / iw, cy: cy0 - (ev.clientY - y0) / ih }),
        up: () => { panning = false; updateCursor(); },
        cancel: () => { panning = false; setView({ cx: cx0, cy: cy0 }); updateCursor(); },
      });
    }
    function zoomGesture(e) {
      const at = [evAt(e).sx, evAt(e).sy];
      const x0 = e.clientX, s0 = V.s; let moved = false;
      dragPtr(e, {
        move: ev => { const dx = ev.clientX - x0; if (Math.abs(dx) > 3) moved = true; if (moved) setZoom(clamp(s0 * Math.pow(2, dx / 120), 1 / 16, 11), at); },
        up: () => { if (!moved) zoomBy(e.altKey ? -1 : 1, at); },
      });
    }
    listen(m.scope, el, 'pointerdown', e => {
      el.focus({ preventScroll: true });
      if (e.button === 1 || (e.button === 0 && app.spring === 'hand')) { e.preventDefault(); app.keyRouter && app.keyRouter.markUsed(); pan(e); return; }
      if (e.button !== 0) return;
      if (app.spring === 'zoom') { e.preventDefault(); app.keyRouter && app.keyRouter.markUsed(); zoomGesture(e); return; }
      // the split handle
      if (V.compare === 'split' && V.after) {
        const sx = V.ox + V.nw * V.s * V.split, a = evAt(e);
        if (Math.abs(a.sx - sx) < 10) { e.preventDefault(); dragPtr(e, { move: ev => st.set(['view', 'split'], clamp((evAt(ev).sx - V.ox) / (V.nw * V.s), 0.02, 0.98)) }); return; }
      }
      const t = activeTool();
      if (t && t.on && t.on.down) {
        e.preventDefault();
        const ctx = m.rctx({ vp: api, tool: t });
        const a = evAt(e);
        let gst;
        try { gst = t.on.down(a, ctx); } catch (err) { app.handlerError(err, t); return; }
        if (gst === false) return;
        toolState = gst; paintTool();
        dragPtr(e, {
          move: ev => { const b = evAt(ev); try { const r = t.on.drag && t.on.drag(b, ctx, toolState); if (r !== undefined) toolState = r; } catch (err) { app.handlerError(err, t); } paintTool(); },
          up: ev => { const b = ev ? evAt(ev) : a; try { t.on.up && t.on.up(b, ctx, toolState); } catch (err) { app.handlerError(err, t); } if (st.previewing && t.on.up) { app.diagnostics.warn({ code: 'T420', title: `Tool '${t.id}' left a preview open`, at: t.at, runtime: true, lines: ['on.up returned without ctx.commit() or ctx.cancel(); the preview was committed for it.'], fix: "End the gesture with ctx.commit('Label') or ctx.cancel()." }); st.commit(t.label || t.id); } toolState = null; paintTool(); },
          cancel: () => { try { t.on.cancel && t.on.cancel(ctx, toolState); } catch (err) { app.handlerError(err, t); } st.cancel(); toolState = null; paintTool(); },
        });
        return;
      }
      // no tool: drag pans when zoomed in, a click toggles fit / 1:1
      if (V.after && V.s > fitScale() * 1.01) {
        const x0 = e.clientX, y0 = e.clientY; let moved = false;
        e.preventDefault();
        const cx0 = V.cx, cy0 = V.cy, iw = V.nw * V.s, ih = V.nh * V.s;
        panning = true; updateCursor();
        dragPtr(e, { move: ev => { if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) > 3) moved = true; if (moved) setView({ zoom: V.zoom === 'fit' ? V.s : V.zoom, cx: cx0 - (ev.clientX - x0) / iw, cy: cy0 - (ev.clientY - y0) / ih }); }, up: () => { panning = false; updateCursor(); if (!moved && p.click === 'toggle-1:1') setZoom('fit'); } });
        return;
      }
      if (p.click === 'toggle-1:1' && V.after) { const a = evAt(e); if (a.inside) setZoom(1, [a.sx, a.sy]); }
    });
    listen(m.scope, el, 'pointermove', e => {
      const t = activeTool();
      if (t && t.on && t.on.hover && !e.buttons) { const ctx = m.rctx({ vp: api, tool: t }); try { toolState = t.on.hover(evAt(e), ctx, toolState) ?? toolState; } catch (err) { app.handlerError(err, t); } paintTool(); }
      app.pointer = { viewport: vid, ...evAt(e) };
      app.emit('pointer', app.pointer);
    });
    listen(m.scope, el, 'pointerleave', () => { app.pointer = null; app.emit('pointer', null); const t = activeTool(); if (t && t.on && t.on.leave) { t.on.leave(m.rctx({ vp: api })); paintTool(); } });
    listen(m.scope, el, 'pointerenter', () => { app.focus.canvas = vid; });
    listen(m.scope, el, 'wheel', e => {
      if (p.lock) return;
      e.preventDefault();
      const a = evAt(e);
      if (e.ctrlKey || e.metaKey || e.altKey) {   // pinch arrives as ctrl+wheel; Alt+wheel zooms (Photoshop)
        const k = Math.exp(-e.deltaY * (e.ctrlKey && !e.metaKey ? 0.01 : 0.0025));
        const ns = clamp(V.s * k, fitScale(), 11);
        if (ns <= fitScale() * 1.001) { if (V.zoom !== 'fit') setZoom('fit'); } else setZoom(ns, [a.sx, a.sy]);
        return;
      }
      if (V.s <= fitScale() * 1.01) return;
      const iw = V.nw * V.s, ih = V.nh * V.s;
      setView({ zoom: V.zoom === 'fit' ? V.s : V.zoom, cx: V.cx + (e.shiftKey ? e.deltaY : e.deltaX) / iw, cy: V.cy + (e.shiftKey ? 0 : e.deltaY) / ih });
    }, { passive: false });
    // right-click: the viewport's own menu, else the shell's .context('canvas', …)
    listen(m.scope, el, 'contextmenu', e => {
      const items = p.context !== undefined ? p.context : app.def.contexts.get('canvas');
      if (!items) return;
      e.preventDefault();
      const list = typeof items === 'function' ? items(st.readonly(), app.pointer) : items;
      app.chrome.contextMenu(e.clientX, e.clientY, list, app.pointer);
    });
    // files dropped on the photo
    if (p.drop) {
      listen(m.scope, el, 'dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); el.classList.add('is-drop'); } });
      listen(m.scope, el, 'dragleave', () => el.classList.remove('is-drop'));
      listen(m.scope, el, 'drop', e => { el.classList.remove('is-drop'); if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); m.run(p.drop, [...e.dataTransfer.files]); } });
    }
    const offSpring = app.on((k) => { if (k === 'spring') { updateCursor(); paintTool(); } });
    m.scope.onDispose(offSpring);
    return el;
  },
});

// ── overlays ─────────────────────────────────────────────────────────────
// { kind, read: τ, paint(g, vp, value, state) } — plain objects the viewport repaints
export const overlay = {
  // rule of thirds / grid over the shown image
  grid: ({ when, divisions = 3 } = {}) => ({ kind: 'grid', read: when, paint(g, vp, on) { if (when && !on) return; const [x0, y0] = vp.toScreen(0, 0), [x1, y1] = vp.toScreen(1, 1); for (let i = 1; i < divisions; i++) { const x = x0 + (x1 - x0) * i / divisions, y = y0 + (y1 - y0) * i / divisions; g.append(svgEl('path', { d: `M${x} ${y0}V${y1}M${x0} ${y}H${x1}`, class: 'ck-ov-line' })); } } }),
  // clipping: hot pixels from a mask of the current render, computed by the app (value: { lo, hi } image bitmaps)
  custom: (kind, read, paint) => ({ kind, read, paint }),
};

export const viewportNode = (image, props = {}, at) => node('viewport', Object.assign({ image }, props), [], at);
