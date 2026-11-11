// DOM helpers (port of CraftKit ui/dom.js): h() builds elements, icon() draws a glyph, listen() ties a listener to
// a scope's lifetime, drag() captures a pointer for a gesture. Nothing runs at module load.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { ICONS } from '../ir/icons.ts';
import type { Scope } from '../core/cells.ts';

const SVGNS = 'http://www.w3.org/2000/svg';
export type Kid = Node | string | number | null | undefined | false | Kid[];

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Record<string, any> | null, ...kids: Kid[]): HTMLElementTagNameMap[K];
export function h(tag: string, attrs?: Record<string, any> | null, ...kids: Kid[]): HTMLElement;
export function h(tag: string, attrs?: Record<string, any> | null, ...kids: Kid[]): Element {
  const el = tag === 'svg' || attrs?.['svg'] ? document.createElementNS(SVGNS, tag) : document.createElement(tag);
  if (attrs)
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false || k === 'svg') continue;
      if (k === 'class') el.setAttribute('class', Array.isArray(v) ? v.filter(Boolean).join(' ') : String(v));
      else if (k === 'style' && typeof v === 'object') Object.assign((el as HTMLElement).style, v);
      else if (k === 'text') el.textContent = String(v);
      else if (k === 'html') el.innerHTML = String(v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign((el as HTMLElement).dataset, v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  append(el, kids);
  return el;
}
export function append(el: Element, kids: Kid[]): Element {
  for (const k of (kids as any[]).flat(Infinity)) {
    if (k == null || k === false) continue;
    el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}
export function svgEl(tag: string, attrs?: Record<string, unknown>): SVGElement {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, String(v));
  return el;
}

/** extra icons a kit installed (set by mount from the IR) */
let extraIcons: Record<string, string> = {};
export const setIcons = (m: Record<string, string>): void => {
  extraIcons = m;
};
export function icon(name: string, size = 14, cls = ''): SVGSVGElement {
  const d = extraIcons[name] || ICONS[name] || ICONS['more'] || '';
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('viewBox', '0 0 12 12');
  s.setAttribute('width', String(size));
  s.setAttribute('height', String(size));
  s.setAttribute('class', 'ck-icon' + (cls ? ' ' + cls : ''));
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVGNS, 'path');
  p.setAttribute('d', d);
  s.appendChild(p);
  return s;
}
export const hasIcon = (name: string): boolean => !!(extraIcons[name] || ICONS[name]);

export function listen(scope: Scope, target: EventTarget, type: string, fn: (e: any) => void, opts?: AddEventListenerOptions | boolean): void {
  target.addEventListener(type, fn, opts);
  scope.onDispose(() => target.removeEventListener(type, fn, opts));
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** capture a pointer for a drag: move/up handlers, Escape cancels; returns a cancel function */
export function drag(e: PointerEvent, o: { move?: (ev: PointerEvent) => void; up?: (ev: PointerEvent | null) => void; cancel?: (ev: KeyboardEvent | null) => void; cursor?: string } = {}): () => void {
  const target = (e.currentTarget || e.target) as Element;
  const id = e.pointerId;
  try {
    (target as any).setPointerCapture?.(id);
  } catch {
    /* synthetic events */
  }
  const root = document.documentElement;
  if (o.cursor) root.style.cursor = o.cursor;
  let done = false;
  const onMove = (ev: Event): void => {
    const p = ev as PointerEvent;
    if (p.pointerId !== id) return;
    o.move?.(p);
  };
  const onUp = (ev: Event): void => {
    const p = ev as PointerEvent;
    if (p.pointerId !== id) return;
    finish();
    o.up?.(p);
  };
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      finish();
      o.cancel?.(ev);
    }
  };
  const onLost = (): void => {
    if (!done) {
      finish();
      o.up?.(null);
    }
  };
  function finish(): void {
    if (done) return;
    done = true;
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerup', onUp);
    target.removeEventListener('pointercancel', onUp);
    target.removeEventListener('lostpointercapture', onLost);
    window.removeEventListener('keydown', onKey, true);
    if (o.cursor) root.style.cursor = '';
    try {
      (target as any).releasePointerCapture?.(id);
    } catch {
      /* already released */
    }
  }
  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', onUp);
  target.addEventListener('pointercancel', onUp);
  target.addEventListener('lostpointercapture', onLost);
  window.addEventListener('keydown', onKey, true);
  return () => {
    finish();
    o.cancel?.(null);
  };
}
