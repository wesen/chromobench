// Planes (port of CraftKit ui/forms/plane.js): 2-D controls. A tone curve, a colour wheel and the histogram (a plane
// you can read and drag). Each gesture previews and commits once.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { clamp, type Key } from '../../core/util.ts';
import { bindingPath } from '../../core/track.ts';
import { fmtNum, monotone } from '../../core/math.ts';
import { makeNode } from '../../ir/node.ts';
import { h, listen, drag, svgEl } from '../h.ts';
import { defineRenderer, type MountCtx } from '../mount.ts';

type Pt = { x: number; y: number };
const IDENT: Pt[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];
const ptsOf = (v: unknown): Pt[] => (Array.isArray(v) && v.length >= 2 ? v.map(p => (Array.isArray(p) ? { x: p[0], y: p[1] } : { ...p })) : IDENT.map(p => ({ ...p })));
const ARROWS: Record<string, [number, number]> = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
const at = (path: Key[], s: any): any => path.reduce((o: any, k) => (o == null ? o : o[k]), s);

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
  const S: number = p['size'] || 220;
  const svg = svgEl('svg', { viewBox: `0 0 ${S} ${S}`, class: 'ck-curve-g', role: 'img', 'aria-label': 'Tone curve', tabindex: '0' });
  const bg = svgEl('g', {});
  const grid = svgEl('g', { class: 'ck-curve-grid' });
  const regionG = svgEl('g', { class: 'ck-curve-reg' });
  const path = svgEl('path', { class: 'ck-curve-p' });
  const ident = svgEl('path', { class: 'ck-curve-id', d: `M0 ${S}L${S} 0` });
  const ptsG = svgEl('g', {});
  for (let i = 1; i < 4; i++) grid.append(svgEl('path', { d: `M${(S * i) / 4} 0V${S}M0 ${(S * i) / 4}H${S}` }));
  svg.append(bg, regionG, grid, ident, path, ptsG);
  const read = h('div', { class: 'ck-curve-read' });
  const paramBox = h('div', { class: 'ck-curve-param' });
  el.append(tabs, svg, read, paramBox);
  if (p['parametric']) {
    const x = m.child('param').mount(p['parametric']);
    if (x) paramBox.append(x);
  }

  let mode = names[0]!;
  let chan = channels[mode]!;
  let curveObj: Record<string, any> = {};
  let selIdx = -1;
  const pts = (): Pt[] => ptsOf(curveObj?.[chan]);
  const color: Record<string, string> = { master: 'var(--text)', red: '#e5534b', green: '#3fb950', blue: '#4c8df6' };
  function drawCurve(list: Pt[]): void {
    const f = monotone(list);
    let d = '';
    for (let i = 0; i <= 64; i++) {
      const x = i / 64;
      d += (i ? 'L' : 'M') + (x * S).toFixed(1) + ' ' + ((1 - clamp(f(x), 0, 1)) * S).toFixed(1);
    }
    path.setAttribute('d', d);
    path.style.stroke = color[chan] || 'var(--text)';
    ptsG.replaceChildren(...list.map((q, i) => svgEl('rect', { x: q.x * S - 3.5, y: (1 - q.y) * S - 3.5, width: 7, height: 7, class: 'ck-curve-pt' + (i === selIdx ? ' is-sel' : '') })));
  }
  // the parametric tab draws the curve the region sliders make (shadows/darks/lights/highlights at the splits)
  function drawParam(): void {
    const c = curveObj || {};
    const sp = [(c['split_shadows'] ?? 25) / 100, (c['split_mid'] ?? 50) / 100, (c['split_highlights'] ?? 75) / 100] as [number, number, number];
    const amt = [c['shadows'] || 0, c['darks'] || 0, c['lights'] || 0, c['highlights'] || 0].map(v => (v / 100) * 0.18);
    const ctr = [sp[0] / 2, (sp[0] + sp[1]) / 2, (sp[1] + sp[2]) / 2, (sp[2] + 1) / 2];
    drawCurve([{ x: 0, y: 0 }, ...ctr.map((x, i) => ({ x, y: clamp(x + amt[i]!, 0, 1) })), { x: 1, y: 1 }]);
    const ends = [sp[0], sp[1], sp[2], 1];
    regionG.replaceChildren(...[0, sp[0], sp[1], sp[2]].map((x0, i) => svgEl('rect', { x: x0 * S, y: 0, width: (ends[i]! - x0) * S, height: S, class: 'ck-curve-band' + (i % 2 ? ' is-alt' : '') })));
  }
  function showMode(): void {
    tabBtns.forEach((bt, i) => bt.classList.toggle('is-on', tabNames[i] === mode));
    const param = mode === 'Parametric';
    paramBox.hidden = !param;
    ptsG.style.display = param ? 'none' : '';
    chan = param ? 'master' : channels[mode]!;
    if (param) drawParam();
    else {
      regionG.replaceChildren();
      drawCurve(pts());
    }
  }
  m.cell(
    s => at(modePath, s),
    v => {
      mode = tabNames.includes(v) ? v : tabNames[0]!;
      selIdx = -1;
      showMode();
    },
  );
  b.watch(v => {
    curveObj = v || {};
    showMode();
  });
  if (p['backdrop'] !== undefined)
    m.val(p['backdrop'], (hist: any) => {
      bg.replaceChildren();
      const arr: number[] | undefined = hist?.l || hist?.luma;
      if (!arr) return;
      const mx = Math.max(1, ...arr.slice(2, 254));
      let d = `M0 ${S}`;
      for (let i = 0; i < 256; i++) d += `L${((i / 255) * S).toFixed(1)} ${(S - Math.min(S, (arr[i]! / mx) * S * 0.9)).toFixed(1)}`;
      bg.append(svgEl('path', { d: d + `L${S} ${S}Z`, class: 'ck-curve-hist' }));
    });

  const write = (list: Pt[], final: boolean, label?: string): void => {
    const next = { ...curveObj, [chan]: list.map(q => ({ x: +q.x.toFixed(4), y: +q.y.toFixed(4) })) };
    b.preview(next);
    if (final) b.commit(label || b.label, { detail: mode === 'RGB' ? 'Point' : mode });
  };
  const toXY = (e: MouseEvent) => {
    const r = svg.getBoundingClientRect();
    const w = r.width || S;
    const hh = r.height || S;
    return { x: clamp((e.clientX - r.left) / w, 0, 1), y: clamp(1 - (e.clientY - r.top) / hh, 0, 1), out: e.clientY < r.top - 24 || e.clientY > r.top + hh + 24 || e.clientX < r.left - 24 || e.clientX > r.left + w + 24 };
  };
  listen(m.scope, svg, 'pointermove', (e: PointerEvent) => {
    const q = toXY(e);
    if (p['readout'] !== false) read.textContent = mode === 'Parametric' ? '' : `${Math.round(q.x * 100)}% → ${Math.round(clamp(monotone(pts())(q.x), 0, 1) * 100)}%`;
  });
  listen(m.scope, svg, 'pointerleave', () => void (read.textContent = ''));
  listen(m.scope, svg, 'pointerdown', (e: PointerEvent) => {
    if (mode === 'Parametric' || e.button !== 0) return;
    e.preventDefault();
    let list = pts();
    const q = toXY(e);
    let i = list.findIndex(pt => Math.abs(pt.x - q.x) < 0.035 && Math.abs(pt.y - q.y) < 0.035);
    if (i < 0) {
      const f = monotone(list);
      const np = { x: q.x, y: e.shiftKey ? q.y : clamp(f(q.x), 0, 1) };
      list.push(np);
      list.sort((a, c) => a.x - c.x);
      i = list.indexOf(np);
    }
    selIdx = i;
    const fixedEnds = i === 0 || i === list.length - 1;
    write(list, false);
    drag(e, {
      move: ev => {
        const r = toXY(ev);
        const L = list.slice();
        if (r.out && !fixedEnds) {
          L.splice(selIdx, 1);
          write(L, false);
          return;
        }
        const lo = selIdx > 0 ? L[selIdx - 1]!.x + 0.01 : 0;
        const hi = selIdx < L.length - 1 ? L[selIdx + 1]!.x - 0.01 : 1;
        L[selIdx] = { x: fixedEnds ? L[selIdx]!.x : clamp(r.x, lo, hi), y: r.y };
        list = L;
        write(L, false);
      },
      up: ev => {
        if (ev && toXY(ev).out && !fixedEnds) {
          list.splice(selIdx, 1);
          selIdx = -1;
        }
        write(list, true);
      },
      cancel: () => {
        b.cancel();
        selIdx = -1;
      },
    });
  });
  listen(m.scope, svg, 'dblclick', (e: MouseEvent) => {
    if (mode === 'Parametric') return;
    const list = pts();
    const q = toXY(e);
    const i = list.findIndex(pt => Math.abs(pt.x - q.x) < 0.04 && Math.abs(pt.y - q.y) < 0.04);
    if (i > 0 && i < list.length - 1) {
      list.splice(i, 1);
      selIdx = -1;
      write(list, true, `${b.label}: delete point`);
    } else if (i < 0) write(IDENT.map(x => ({ ...x })), true, `${b.label}: reset`);
  });
  listen(m.scope, svg, 'keydown', (e: KeyboardEvent) => {
    if (selIdx < 0 || mode === 'Parametric') return;
    const d = ARROWS[e.key];
    if (d) {
      e.preventDefault();
      const L = pts();
      const k = (e.shiftKey ? 10 : 1) / 255;
      const q = L[selIdx];
      if (!q) return;
      L[selIdx] = { x: selIdx === 0 || selIdx === L.length - 1 ? q.x : clamp(q.x + d[0] * k, 0, 1), y: clamp(q.y + d[1] * k, 0, 1) };
      b.set({ ...curveObj, [chan]: L }, b.label, { coalesce: 'nudge:curve' });
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      const L = pts();
      if (selIdx > 0 && selIdx < L.length - 1) {
        L.splice(selIdx, 1);
        selIdx = -1;
        write(L, true, `${b.label}: delete point`);
      }
    }
  });
  return el;
});

// ── colour wheel: hue around, saturation out; Shift = saturation only, Mod = hue only, Alt = fine ──
defineRenderer('wheel', (n, m) => {
  const p = n.props as Record<string, any>;
  const S: number = p['size'] || 120;
  const R = S / 2 - 4;
  const b = m.binding(p['bind'], n.at, { label: p['historyLabel'] || (typeof p['label'] === 'string' ? p['label'] : 'Color Grading') });
  const el = h('div', { class: 'ck-wheel' });
  const lab = h('div', { class: 'ck-wheel-l' });
  const disc = h('div', { class: 'ck-wheel-d', tabindex: '0', role: 'slider' });
  disc.style.width = disc.style.height = S + 'px';
  const puck = h('div', { class: 'ck-wheel-p' });
  disc.append(puck);
  const read = h('div', { class: 'ck-wheel-r' });
  el.append(lab, disc, read);
  m.val(p['label'], v => {
    lab.textContent = v ? String(v) : '';
    disc.setAttribute('aria-label', v ? String(v) : 'wheel');
  });
  type HSL = { hue: number; sat: number; lum: number };
  let cur: HSL = { hue: 0, sat: 0, lum: 0 };
  const place = (v: HSL): void => {
    const a = ((v.hue - 90) * Math.PI) / 180;
    const r = (v.sat / 100) * R;
    puck.style.left = S / 2 + Math.cos(a) * r + 'px';
    puck.style.top = S / 2 + Math.sin(a) * r + 'px';
    puck.style.background = v.sat > 0 ? `hsl(${v.hue} ${40 + v.sat * 0.5}% 55%)` : '';
  };
  b.watch(v => {
    cur = { hue: 0, sat: 0, lum: 0, ...(v || {}) };
    place(cur);
    disc.setAttribute('aria-valuetext', `hue ${Math.round(cur.hue)}, saturation ${Math.round(cur.sat)}`);
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
  const fromEvent = (e: PointerEvent, start?: HSL): HSL => {
    const r = disc.getBoundingClientRect();
    const x = e.clientX - (r.left + (r.width || S) / 2);
    const y = e.clientY - (r.top + (r.height || S) / 2);
    let hue = ((Math.atan2(y, x) * 180) / Math.PI + 90 + 360) % 360;
    let sat = clamp((Math.hypot(x, y) / R) * 100, 0, 100);
    if (e.altKey && start) {
      hue = start.hue + (hue - start.hue) * 0.25;
      sat = start.sat + (sat - start.sat) * 0.25;
    }
    if (e.shiftKey && start) hue = start.hue;
    if ((e.metaKey || e.ctrlKey) && start) sat = start.sat;
    return { ...cur, hue: Math.round(hue), sat: Math.round(sat) };
  };
  listen(m.scope, disc, 'pointerdown', (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    disc.focus?.();
    const start = { ...cur };
    if (e.target !== puck) b.preview(fromEvent(e));
    drag(e, { move: ev => b.preview(fromEvent(ev, start)), up: () => void b.commit(b.label, { detail: String(p['label'] || '') }), cancel: () => b.cancel() });
  });
  listen(m.scope, puck, 'dblclick', (e: MouseEvent) => {
    e.stopPropagation();
    b.set({ ...cur, hue: 0, sat: 0 }, `${b.label}: reset`);
  });
  listen(m.scope, disc, 'keydown', (e: KeyboardEvent) => {
    const d = ARROWS[e.key];
    if (!d) return;
    e.preventDefault();
    const k = e.shiftKey ? 10 : 1;
    b.set({ ...cur, hue: (cur.hue + d[0] * k + 360) % 360, sat: clamp(cur.sat + d[1] * k, 0, 100) }, b.label, { coalesce: 'nudge:' + b.name });
  });
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
