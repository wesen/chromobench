// Habits: behaviours every professional widget shares, written once and attached to forms.
//   scrub · nudge · reset · units (and arithmetic) · mixed · rename · context · focusKeys · why
// A widget is a form plus the habits it opts into; an app can attach the same habits to its own forms.

import { listen, drag } from './dom.js';
import { chordFromEvent, parseChord } from '../core/keys.js';
import { clamp } from '../core/util.js';

export const MIXED = Symbol('ck.mixed');

// multiplier from modifiers: Shift ×10, Alt ×0.1 (Lightroom and Photoshop agree)
export const modStep = e => (e && e.shiftKey ? 10 : 1) * (e && e.altKey ? 0.1 : 1);

// ── scrub: drag sideways on a label or a track to change a number ────────────
// { get, preview, commit, cancel, step, min, max, pxPerStep, onStart }
export function scrub(scope, el, o) {
  el.classList.add('ck-scrub');
  listen(scope, el, 'pointerdown', e => {
    if (e.button !== 0 || (o.enabled && !o.enabled())) return;
    e.preventDefault();
    const v0 = +o.get() || 0, x0 = e.clientX;
    let moved = false;
    o.onStart && o.onStart(e);
    drag(e, {
      cursor: 'ew-resize',
      move: ev => {
        const dx = ev.clientX - x0;
        if (!moved && Math.abs(dx) < 2) return;
        moved = true;
        const steps = dx / (o.pxPerStep || 2);
        let v = v0 + steps * (o.step || 1) * modStep(ev);
        if (o.min != null) v = Math.max(o.min, v);
        if (o.max != null) v = Math.min(o.max, v);
        o.preview(snap(v, o.step * modStep(ev)));
      },
      up: ev => { if (moved) o.commit(); else o.click && o.click(ev); },
      cancel: () => o.cancel(),
    });
  });
}
export const snap = (v, step) => (step ? Math.round(v / step) * step : v);

// ── nudge: arrow keys on a focused field, Shift ×10, Alt ×0.1; a run of nudges is one undo step ──
export function nudge(scope, el, o) {
  listen(scope, el, 'keydown', e => {
    const dir = { ArrowUp: 1, ArrowRight: o.horizontal ? 1 : 0, ArrowDown: -1, ArrowLeft: o.horizontal ? -1 : 0 }[e.key];
    if (!dir || e.metaKey || e.ctrlKey) return;
    if (o.enabled && !o.enabled()) return;
    e.preventDefault(); e.stopPropagation();
    let v = (+o.get() || 0) + dir * (o.step || 1) * modStep(e);
    if (o.min != null) v = Math.max(o.min, v);
    if (o.max != null) v = Math.min(o.max, v);
    o.set(snap(v, (o.step || 1) * modStep(e)));
  });
}

// ── reset: double-click resets to a value (or a function of state) ──
export function reset(scope, el, o) {
  listen(scope, el, 'dblclick', e => { e.preventDefault(); e.stopPropagation(); o.apply(); });
  el.classList.add('ck-resettable');
}

// ── units and arithmetic: '12mm', '3p6', '1in + 6pt', '*2', '50%' ──
export const UNITS = { px: 1, pt: 1, p: 12, pc: 12, in: 72, mm: 72 / 25.4, cm: 72 / 2.54, '%': null, ev: 1, k: 1, '°': 1 };
export function parseValue(text, { unit = '', current = 0, units = null, min = -Infinity, max = Infinity } = {}) {
  let s = String(text).trim().replace(/−/g, '-').replace(/,/g, '.');
  if (!s) return { ok: false, error: 'empty' };
  // relative: *2, /3, +5, -5 applied to the current value when the field starts with an operator
  const rel = s.match(/^([*/])\s*(-?\d*\.?\d+)$/);
  if (rel) { const k = +rel[2]; return { ok: true, value: clamp(rel[1] === '*' ? current * k : current / k, min, max) }; }
  // percent of the current value
  const pct = s.match(/^(-?\d*\.?\d+)\s*%$/);
  if (pct && unit !== '%') return { ok: true, value: clamp(current * (+pct[1] / 100), min, max) };
  // picas: 3p6 = 3 picas 6 points
  s = s.replace(/(\d+)p(\d+(?:\.\d+)?)/g, (m, a, b) => `${+a * 12 + +b}pt`);
  // terms with units → base units (points) when the field has a length unit; otherwise strip
  const toBase = units && units[unit] != null;
  let bad = false;
  const expr = s.replace(/(\d*\.?\d+)\s*(mm|cm|in|pt|px|pc|p|ev|k|°)?/gi, (m, num, u) => {
    if (!u || !toBase) return num;
    const f = units[u.toLowerCase()]; if (f == null) { bad = true; return num; }
    return `(${num}*${f}/${units[unit]})`;
  });
  if (bad || /[^0-9+\-*/().\s]/.test(expr)) return { ok: false, error: `Can't read '${text}'` };
  let v;
  try { v = Function(`"use strict";return (${expr})`)(); } catch (e) { return { ok: false, error: `Can't read '${text}'` }; }
  if (!Number.isFinite(v)) return { ok: false, error: `'${text}' is not a number` };
  return { ok: true, value: clamp(v, min, max), clamped: v < min || v > max };
}

// ── rename: double-click a label to edit it in place ──
export function rename(scope, el, { get, set }) {
  listen(scope, el, 'dblclick', e => {
    e.preventDefault(); e.stopPropagation();
    const input = document.createElement('input');
    input.className = 'ck-rename'; input.value = get();
    const old = el.textContent; el.textContent = ''; el.appendChild(input); input.focus(); input.select();
    const done = ok => { input.remove(); el.textContent = old; if (ok && input.value.trim() && input.value !== old) set(input.value.trim()); };
    input.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') done(false); });
    input.addEventListener('blur', () => done(true), { once: true });
  });
}

// ── context: right-click (or the menu key) opens a menu built from command ids ──
export function context(scope, el, m, items, argFn) {
  listen(scope, el, 'contextmenu', e => {
    e.preventDefault(); e.stopPropagation();
    const st = m.store.readonly();
    const list = typeof items === 'function' ? items(st, argFn && argFn(e)) : items;
    m.app.chrome.contextMenu(e.clientX, e.clientY, list, argFn ? argFn(e) : undefined, m);
  });
}

// ── focusKeys: keys that apply while this element (or something in it) has focus ──
export function focusKeys(scope, el, m, map) {
  const table = new Map();
  for (const [ch, target] of Object.entries(map || {})) { try { table.set(parseChord(ch), target); } catch (e) { /* reported at build */ } }
  listen(scope, el, 'keydown', e => {
    if (e.target && e.target.matches && e.target.matches('input,textarea,[contenteditable]') && !e.metaKey && !e.ctrlKey) return;
    const ch = chordFromEvent(e); const t = ch && table.get(ch);
    if (!t) return;
    e.preventDefault(); e.stopPropagation();
    m.run(t, e);
  });
}
