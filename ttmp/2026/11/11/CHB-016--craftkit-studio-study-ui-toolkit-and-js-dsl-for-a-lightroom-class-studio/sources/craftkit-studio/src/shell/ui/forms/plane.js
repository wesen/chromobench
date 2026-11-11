// Planes: 2-D controls. A tone curve, a colour wheel, an x-y pad, and the histogram (a plane you can read and drag).
import { defineForm } from '../node.js';
import { h, listen, drag, fmtNum, svgEl } from '../dom.js';
import { clamp } from '../../core/util.js';
import { bindingPath } from '../../core/track.js';

// ── monotone cubic interpolation (Fritsch–Carlson): what curve tools draw through their points ──
export function monotone(pts) {
  const P = pts.slice().sort((a, b) => a.x - b.x);
  const n = P.length;
  if (n < 2) return x => x;
  const dx = [], dy = [], m = [];
  for (let i = 0; i < n - 1; i++) { dx.push(P[i + 1].x - P[i].x || 1e-6); dy.push(P[i + 1].y - P[i].y); m.push(dy[i] / dx[i]); }
  const t = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  return x => {
    if (x <= P[0].x) return P[0].y;
    if (x >= P[n - 1].x) return P[n - 1].y;
    let i = 0; while (i < n - 2 && x > P[i + 1].x) i++;
    const hh = dx[i], u = (x - P[i].x) / hh, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * P[i].y + (u3 - 2 * u2 + u) * hh * t[i] + (-2 * u3 + 3 * u2) * P[i + 1].y + (u3 - u2) * hh * t[i + 1];
  };
}
const IDENT = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
const ptsOf = v => (Array.isArray(v) && v.length >= 2 ? v.map(p => (Array.isArray(p) ? { x: p[0], y: p[1] } : p)) : IDENT.slice());

// ── tone curve ────────────────────────────────────────────────────────────
// bind: the curve object; channels: { RGB: 'master', Red: 'red', … }; parametric: a node shown on its own tab
// backdrop: τ histogram { r, g, b, l }; readout: in/out under the pointer
defineForm('curve', {
  slots: { bind: 'bind', channels: 'β', backdrop: 'τ', parametric: 'β', readout: 'β', size: 'β', regions: 'τ', historyLabel: 'β', mode: 'bind' },
  mount(n, m) {
    const p = n.props;
    const b = m.binding(p.bind, n.at, { label: p.historyLabel || 'Tone Curve' });
    const channels = p.channels || { RGB: 'master' };
    const names = Object.keys(channels);
    const modePath = p.mode ? bindingPath(m.store, p.mode).path : ['workspace', 'curveMode', p.id || 'curve'];
    if (m.store.peek(modePath) === undefined) m.store.writeDoc([{ path: modePath, value: p.parametric ? 'Parametric' : names[0] }], { tier: 'view', init: true });
    const el = h('div', { class: 'ck-curve' });
    const tabs = h('div', { class: 'ck-seg is-small ck-curve-tabs' });
    const tabNames = (p.parametric ? ['Parametric'] : []).concat(names);
    const tabBtns = tabNames.map(nm => { const bt = h('button', { type: 'button', class: 'ck-seg-b', text: nm === 'RGB' ? 'Point' : nm }); listen(m.scope, bt, 'click', () => m.store.set(modePath, nm)); return bt; });
    tabs.append(...tabBtns);
    const S = p.size || 220;
    const svg = svgEl('svg', { viewBox: `0 0 ${S} ${S}`, class: 'ck-curve-g', role: 'img', 'aria-label': 'Tone curve' });
    const bg = svgEl('g', {}), grid = svgEl('g', { class: 'ck-curve-grid' }), regionG = svgEl('g', { class: 'ck-curve-reg' });
    const path = svgEl('path', { class: 'ck-curve-p' }), ident = svgEl('path', { class: 'ck-curve-id', d: `M0 ${S}L${S} 0` });
    const ptsG = svgEl('g', {});
    for (let i = 1; i < 4; i++) { grid.append(svgEl('path', { d: `M${S * i / 4} 0V${S}M0 ${S * i / 4}H${S}` })); }
    svg.append(bg, regionG, grid, ident, path, ptsG);
    const read = h('div', { class: 'ck-curve-read' });
    const paramBox = h('div', { class: 'ck-curve-param' });
    el.append(tabs, svg, read, paramBox);
    if (p.parametric) { const pm = m.child('param'); paramBox.append(pm.mount(p.parametric)); }

    let mode = names[0], chan = channels[names[0]], curveObj = {};
    let selIdx = -1;
    const pts = () => ptsOf(curveObj && curveObj[chan]);
    const color = { master: 'var(--text)', red: '#e5534b', green: '#3fb950', blue: '#4c8df6' };
    function drawCurve(list) {
      const f = monotone(list);
      let d = '';
      for (let i = 0; i <= 64; i++) { const x = i / 64; d += (i ? 'L' : 'M') + (x * S).toFixed(1) + ' ' + ((1 - clamp(f(x), 0, 1)) * S).toFixed(1); }
      path.setAttribute('d', d); path.style.stroke = color[chan] || 'var(--text)';
      ptsG.replaceChildren(...list.map((q, i) => svgEl('rect', { x: q.x * S - 3.5, y: (1 - q.y) * S - 3.5, width: 7, height: 7, class: 'ck-curve-pt' + (i === selIdx ? ' is-sel' : '') })));
    }
    function showMode() {
      tabBtns.forEach((bt, i) => bt.classList.toggle('is-on', tabNames[i] === mode));
      const param = mode === 'Parametric';
      paramBox.hidden = !param; ptsG.style.display = param ? 'none' : '';
      chan = param ? 'master' : channels[mode];
      if (!param) regionG.replaceChildren();
      if (param) drawParam(); else drawCurve(pts());
    }
    // the parametric tab draws the curve the region sliders make (shadows/darks/lights/highlights at the splits)
    function drawParam() {
      const c = curveObj || {};
      const sp = [(c.split_shadows ?? 25) / 100, (c.split_mid ?? 50) / 100, (c.split_highlights ?? 75) / 100];
      const amt = [c.shadows || 0, c.darks || 0, c.lights || 0, c.highlights || 0].map(v => v / 100 * 0.18);
      const ctr = [sp[0] / 2, (sp[0] + sp[1]) / 2, (sp[1] + sp[2]) / 2, (sp[2] + 1) / 2];
      const list = [{ x: 0, y: 0 }].concat(ctr.map((x, i) => ({ x, y: clamp(x + amt[i], 0, 1) }))).concat([{ x: 1, y: 1 }]);
      drawCurve(list);
      regionG.replaceChildren(...[0, sp[0], sp[1], sp[2]].map((x0, i) => svgEl('rect', { x: x0 * S, y: 0, width: (([sp[0], sp[1], sp[2], 1][i]) - x0) * S, height: S, class: 'ck-curve-band' + (i % 2 ? ' is-alt' : '') })));
    }
    m.cell(s => modePath.reduce((o, k) => (o == null ? o : o[k]), s), v => { mode = tabNames.includes(v) ? v : tabNames[0]; selIdx = -1; showMode(); });
    b.watch(v => { curveObj = v || {}; if (mode === 'Parametric') drawParam(); else { regionG.replaceChildren(); drawCurve(pts()); } });
    if (p.backdrop !== undefined) m.val(p.backdrop, hist => {
      bg.replaceChildren();
      if (!hist) return;
      const arr = hist.l || hist.luma; if (!arr) return;
      const mx = Math.max(1, ...arr.slice(2, 254));
      let d = `M0 ${S}`; for (let i = 0; i < 256; i++) d += `L${(i / 255 * S).toFixed(1)} ${(S - Math.min(S, arr[i] / mx * S * 0.9)).toFixed(1)}`;
      bg.append(svgEl('path', { d: d + `L${S} ${S}Z`, class: 'ck-curve-hist' }));
    });

    const write = (list, final, label) => {
      const next = Object.assign({}, curveObj, { [chan]: list.map(q => ({ x: +q.x.toFixed(4), y: +q.y.toFixed(4) })) });
      if (final) { b.preview(next); b.commit(label || `Tone Curve`, { detail: mode === 'RGB' ? 'Point' : mode }); } else b.preview(next);
    };
    const toXY = e => { const r = svg.getBoundingClientRect(); return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp(1 - (e.clientY - r.top) / r.height, 0, 1), out: e.clientY < r.top - 24 || e.clientY > r.bottom + 24 || e.clientX < r.left - 24 || e.clientX > r.right + 24 }; };
    listen(m.scope, svg, 'pointermove', e => { const q = toXY(e); if (p.readout !== false) read.textContent = mode === 'Parametric' ? '' : `${Math.round(q.x * 100)}% → ${Math.round(clamp(monotone(pts())(q.x), 0, 1) * 100)}%`; });
    listen(m.scope, svg, 'pointerleave', () => { read.textContent = ''; });
    listen(m.scope, svg, 'pointerdown', e => {
      if (mode === 'Parametric' || e.button !== 0) return;
      e.preventDefault(); svg.focus && svg.focus();
      let list = pts(); const q = toXY(e);
      let i = list.findIndex(pt => Math.abs(pt.x - q.x) < 0.035 && Math.abs(pt.y - q.y) < 0.035);
      if (i < 0) { const f = monotone(list); list.push({ x: q.x, y: e.shiftKey ? q.y : clamp(f(q.x), 0, 1) }); list.sort((a, c) => a.x - c.x); i = list.findIndex(pt => pt.x === q.x); }
      selIdx = i;
      const fixedEnds = i === 0 || i === list.length - 1;
      write(list, false);
      drag(e, {
        move: ev => {
          const r = toXY(ev);
          const L = list.slice();
          if (r.out && !fixedEnds) { L.splice(selIdx, 1); write(L, false); return; }
          const lo = selIdx > 0 ? L[selIdx - 1].x + 0.01 : 0, hi = selIdx < L.length - 1 ? L[selIdx + 1].x - 0.01 : 1;
          L[selIdx] = { x: fixedEnds ? L[selIdx].x : clamp(r.x, lo, hi), y: r.y };
          list = L; write(L, false);
        },
        up: ev => { const r = ev ? toXY(ev) : { out: false }; if (r.out && !fixedEnds) { list.splice(selIdx, 1); selIdx = -1; } write(list, true); },
        cancel: () => { b.cancel(); selIdx = -1; },
      });
    });
    listen(m.scope, svg, 'dblclick', e => {
      if (mode === 'Parametric') return;
      const list = pts(); const q = toXY(e);
      const i = list.findIndex(pt => Math.abs(pt.x - q.x) < 0.04 && Math.abs(pt.y - q.y) < 0.04);
      if (i > 0 && i < list.length - 1) { list.splice(i, 1); selIdx = -1; write(list, true, 'Tone Curve: delete point'); }
      else if (i < 0) { write(IDENT.slice(), true, 'Tone Curve: reset'); }
    });
    svg.setAttribute('tabindex', '0');
    listen(m.scope, svg, 'keydown', e => {
      if (selIdx < 0 || mode === 'Parametric') return;
      const d = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
      if (d) { e.preventDefault(); const L = pts(); const k = (e.shiftKey ? 10 : 1) / 255; const q = L[selIdx]; if (!q) return; L[selIdx] = { x: selIdx === 0 || selIdx === L.length - 1 ? q.x : clamp(q.x + d[0] * k, 0, 1), y: clamp(q.y + d[1] * k, 0, 1) }; b.set(Object.assign({}, curveObj, { [chan]: L }), 'Tone Curve', { coalesce: 'nudge:curve' }); }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); const L = pts(); if (selIdx > 0 && selIdx < L.length - 1) { L.splice(selIdx, 1); selIdx = -1; write(L, true, 'Tone Curve: delete point'); } }
    });
    return el;
  },
});

// ── colour wheel: hue around, saturation out; Shift = saturation only, Mod = hue only, Alt = fine ──
defineForm('wheel', {
  slots: { bind: 'bind', lum: 'β', readout: 'ƒ', reset: 'β', size: 'β', historyLabel: 'β' },
  mount(n, m) {
    const p = n.props, S = p.size || 120, R = S / 2 - 4;
    const b = m.binding(p.bind, n.at, { label: p.historyLabel || (typeof p.label === 'string' ? p.label : 'Color Grading') });
    const el = h('div', { class: 'ck-wheel' });
    const lab = h('div', { class: 'ck-wheel-l' });
    const disc = h('div', { class: 'ck-wheel-d', tabindex: '0', role: 'slider' }); disc.style.width = disc.style.height = S + 'px';
    const puck = h('div', { class: 'ck-wheel-p' });
    disc.append(puck);
    const read = h('div', { class: 'ck-wheel-r' });
    el.append(lab, disc, read);
    m.val(p.label, v => { lab.textContent = v || ''; disc.setAttribute('aria-label', v || 'wheel'); });
    let cur = { hue: 0, sat: 0, lum: 0 };
    const place = v => { const a = (v.hue - 90) * Math.PI / 180, r = (v.sat / 100) * R; puck.style.left = (S / 2 + Math.cos(a) * r) + 'px'; puck.style.top = (S / 2 + Math.sin(a) * r) + 'px'; puck.style.background = v.sat > 0 ? `hsl(${v.hue} ${40 + v.sat * 0.5}% 55%)` : ''; };
    b.watch(v => { cur = Object.assign({ hue: 0, sat: 0, lum: 0 }, v || {}); place(cur); if (p.readout === undefined) read.textContent = `H ${Math.round(cur.hue)}°  S ${Math.round(cur.sat)}`; });
    if (p.readout !== undefined) m.cell(s => { const v = b.fn(s) || {}; return typeof p.readout === 'function' ? p.readout(Object.assign({ hue: 0, sat: 0, lum: 0 }, v)) : p.readout; }, v => { read.textContent = v || ''; });
    const fromEvent = (e, start) => {
      const r = disc.getBoundingClientRect();
      const x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
      let hue = (Math.atan2(y, x) * 180 / Math.PI + 90 + 360) % 360, sat = clamp(Math.hypot(x, y) / R * 100, 0, 100);
      if (e.altKey && start) { hue = start.hue + (hue - start.hue) * 0.25; sat = start.sat + (sat - start.sat) * 0.25; }
      if (e.shiftKey && start) hue = start.hue;
      if ((e.metaKey || e.ctrlKey) && start) sat = start.sat;
      return Object.assign({}, cur, { hue: Math.round(hue), sat: Math.round(sat) });
    };
    listen(m.scope, disc, 'pointerdown', e => {
      if (e.button !== 0) return; e.preventDefault(); disc.focus();
      const start = Object.assign({}, cur);
      const onPuck = e.target === puck;
      if (!onPuck) b.preview(fromEvent(e));
      drag(e, { move: ev => b.preview(fromEvent(ev, start)), up: () => b.commit(b.label, { detail: `${p.label || ''}` }), cancel: () => b.cancel() });
    });
    listen(m.scope, puck, 'dblclick', e => { e.stopPropagation(); b.set(Object.assign({}, cur, { hue: 0, sat: 0 }), `${b.label}: reset`); });
    listen(m.scope, disc, 'keydown', e => {
      const d = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key]; if (!d) return;
      e.preventDefault(); const k = e.shiftKey ? 10 : 1;
      b.set(Object.assign({}, cur, { hue: (cur.hue + d[0] * k + 360) % 360, sat: clamp(cur.sat + d[1] * k, 0, 100) }), b.label, { coalesce: 'nudge:' + b.name });
    });
    if (p.lum) {
      const lumPath = b.path.concat(['lum']);
      const lm = m.child('lum');
      const sl = lm.mount(nodeOf('slider', { bind: lumPath.join('.'), min: -100, max: 100, label: 'Lum', bipolar: true, reset: 0, compact: true, labelWidth: 30, historyLabel: `${p.label || ''} Luminance`.trim(), tip: 'Luminance' }, n.at));
      el.append(sl);
    }
    return el;
  },
});
import { node as mkNode } from '../node.js';
const nodeOf = (form, props, at) => mkNode(form, props, [], at);

// ── histogram: RGB overlap, clipping warnings (the J overlay), the value under the pointer, regions to drag ──
// data: τ { r, g, b, l } arrays of 256; clip: bind to a boolean (shows/hides warnings)
defineForm('histogram', {
  slots: { data: 'τ', clip: 'bind', regions: 'β', info: 'τ', height: 'β' },
  mount(n, m) {
    const p = n.props, H = p.height || 110;
    const el = h('div', { class: 'ck-hist' });
    const cv = h('canvas', { class: 'ck-hist-c', height: H * 2, width: 512, role: 'img', 'aria-label': 'Histogram' });
    const tl = h('button', { type: 'button', class: 'ck-hist-clip is-l', 'data-tip': 'Show shadow clipping (J)' }), tr = h('button', { type: 'button', class: 'ck-hist-clip is-r', 'data-tip': 'Show highlight clipping (J)' });
    const info = h('div', { class: 'ck-hist-i' });
    const region = h('div', { class: 'ck-hist-reg' });
    el.append(cv, tl, tr, region, info);
    let data = null, clipB = p.clip ? m.binding(p.clip, n.at) : null;
    function paint() {
      const g = cv.getContext('2d'); const W = cv.width, HH = cv.height;
      g.clearRect(0, 0, W, HH);
      if (!data) return;
      const ch = [['r', '#ff3b30'], ['g', '#34c759'], ['b', '#2f7bff']];
      const mx = Math.max(1, ...['r', 'g', 'b'].map(k => Math.max(...data[k].slice(1, 255))));
      g.globalCompositeOperation = 'lighter';
      for (const [k, c] of ch) {
        g.beginPath(); g.moveTo(0, HH);
        for (let i = 0; i < 256; i++) g.lineTo(i / 255 * W, HH - Math.min(1, Math.sqrt(data[k][i] / mx)) * HH * 0.94);
        g.lineTo(W, HH); g.closePath(); g.fillStyle = c; g.globalAlpha = 0.62; g.fill();
      }
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      const total = data.total || data.l.reduce((a, x) => a + x, 0) || 1;
      const lo = (data.r[0] + data.g[0] + data.b[0]) / 3 / total, hi = (data.r[255] + data.g[255] + data.b[255]) / 3 / total;
      tl.classList.toggle('is-hot', lo > 0.002); tr.classList.toggle('is-hot', hi > 0.002);
    }
    m.val(p.data, v => { data = v; paint(); });
    if (p.info !== undefined) m.val(p.info, v => { info.textContent = v || ''; });
    if (clipB) {
      clipB.watch(v => { el.classList.toggle('is-clipping', !!v); });
      const toggle = () => clipB.set(!clipB.get());
      listen(m.scope, tl, 'click', toggle); listen(m.scope, tr, 'click', toggle);
    }
    // regions: drag sideways inside the histogram to move the slider of the tones under the pointer
    if (p.regions) {
      const R = p.regions; // [{ name, from, to, bind, min, max, step }]
      const at = x => R.find(r => x >= r.from && x < r.to) || R[R.length - 1];
      listen(m.scope, cv, 'pointermove', e => {
        if (e.buttons) return;
        const r = cv.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width; const g = at(x);
        region.style.left = g.from * 100 + '%'; region.style.width = (g.to - g.from) * 100 + '%'; region.hidden = false;
        info.dataset.hover = g.name; info.textContent = g.name;
      });
      listen(m.scope, cv, 'pointerleave', () => { region.hidden = true; info.textContent = ''; });
      listen(m.scope, cv, 'pointerdown', e => {
        if (e.button !== 0) return; e.preventDefault();
        const r = cv.getBoundingClientRect(); const g = at((e.clientX - r.left) / r.width);
        const bb = m.binding(g.bind, n.at, { label: g.name });
        const v0 = +bb.get() || 0, x0 = e.clientX;
        drag(e, {
          cursor: 'ew-resize',
          move: ev => { const v = clamp(v0 + (ev.clientX - x0) / r.width * (g.max - g.min) * 0.8, g.min, g.max); bb.preview(Math.round(v / (g.step || 1)) * (g.step || 1)); info.textContent = `${g.name} ${fmtNum(bb.get(), g.step < 1 ? 2 : 0, true)}`; },
          up: () => bb.commit(g.name, { detail: fmtNum(bb.get(), g.step < 1 ? 2 : 0, true) }),
          cancel: () => bb.cancel(),
        });
      });
    }
    return el;
  },
});
