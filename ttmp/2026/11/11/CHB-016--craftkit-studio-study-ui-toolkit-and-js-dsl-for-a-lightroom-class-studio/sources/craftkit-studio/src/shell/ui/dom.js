// DOM helpers: h() builds elements, icon() draws a glyph, listen() ties a listener to a scope's lifetime.
import { ICONS } from './icons.js';

const SVGNS = 'http://www.w3.org/2000/svg';
export function h(tag, attrs, ...kids) {
  const el = tag === 'svg' || attrs && attrs.svg ? document.createElementNS(SVGNS, tag) : document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false || k === 'svg') continue;
    if (k === 'class') el.setAttribute('class', Array.isArray(v) ? v.filter(Boolean).join(' ') : v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}
export function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}
export function svgEl(tag, attrs) { const el = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v); return el; }

export function icon(name, size = 14, cls = '') {
  const d = ICONS[name] || ICONS.dots;
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('viewBox', '0 0 12 12'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('class', 'ck-icon' + (cls ? ' ' + cls : '')); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', d);
  s.appendChild(p);
  return s;
}
export const hasIcon = name => !!ICONS[name];

export function listen(scope, target, type, fn, opts) {
  target.addEventListener(type, fn, opts);
  scope.onDispose(() => target.removeEventListener(type, fn, opts));
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

// capture a pointer for a drag: move/up handlers, Escape cancels, returns a cancel function
export function drag(e, { move, up, cancel, cursor } = {}) {
  const target = e.currentTarget || e.target;
  const id = e.pointerId;
  try { target.setPointerCapture && target.setPointerCapture(id); } catch (err) { /* synthetic events */ }
  if (cursor) document.documentElement.style.cursor = cursor;
  let done = false;
  const onMove = ev => { if (ev.pointerId !== id) return; move && move(ev); };
  const onUp = ev => { if (ev.pointerId !== id) return; finish(); up && up(ev); };
  const onKey = ev => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(); cancel && cancel(ev); } };
  const onLost = () => { if (!done) { finish(); up && up(null); } };
  function finish() {
    if (done) return; done = true;
    target.removeEventListener('pointermove', onMove); target.removeEventListener('pointerup', onUp); target.removeEventListener('pointercancel', onUp);
    target.removeEventListener('lostpointercapture', onLost);
    window.removeEventListener('keydown', onKey, true);
    if (cursor) document.documentElement.style.cursor = '';
    try { target.releasePointerCapture && target.releasePointerCapture(id); } catch (err) { /* already released */ }
  }
  target.addEventListener('pointermove', onMove); target.addEventListener('pointerup', onUp); target.addEventListener('pointercancel', onUp);
  target.addEventListener('lostpointercapture', onLost);
  window.addEventListener('keydown', onKey, true);
  return () => { finish(); cancel && cancel(null); };
}

export const fmtNum = (v, decimals = 0, signed = false) => {
  if (v == null || Number.isNaN(v)) return '—';
  const s = (+v).toFixed(decimals);
  const z = +s === 0 ? (0).toFixed(decimals) : s;
  return (signed && +z > 0 ? '+' : '') + z.replace('-', '−');
};
