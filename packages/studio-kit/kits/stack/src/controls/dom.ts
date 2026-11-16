// The stack kit's low-level controls (DOM): the one number control (a slim track and a typed value) every panel and
// editor of the kit uses, and the small helpers they share (the frame a node shows, a document path's value, a
// command run). The rows, panels and editors are built from these, so they look and behave alike.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { h, listen, type MountCtx } from '@chromobench/shell/dom';
import type { NodeData } from '@chromobench/shell';
import { getPath } from '@chromobench/values';
import type { Document } from '@chromobench/contract';
import { storePath } from '../../../../src/model/doc.ts';
import { dragTo, FINE_DRAG, type Feel } from '../../../../src/kit/args.ts';
import { sel } from '../../../../src/sel.ts';

export const frameOf = (n: NodeData, s: any): string | null => (typeof n.props['frame'] === 'function' ? (n.props['frame'] as (s: any) => string | null)(s) : ((n.props['frame'] as string | undefined) ?? sel.current(s)));
export const btn = (text: string, cls: string, attrs: Record<string, unknown> = {}) => h('button', { type: 'button', class: `ck-btn is-small ${cls}`, text, ...attrs });
export const run = (m: MountCtx, id: string, ...a: unknown[]): unknown => m.rt.runCommand(id, null, ...a);
export const peekDoc = (m: MountCtx, f: string): Document | undefined => m.store.peek(['docs', f]) as Document | undefined;

// ── the one number control: a slim track and a typed value (amounts, mask settings, arguments without ui hints) ──

export interface NumberSpec {
  label: string;
  /** the value now (the state with a gesture's preview), or undefined: hidden */
  read: (s: any) => number | undefined;
  /** the document path it writes, on the frame */
  path: string;
  frame: (s: any) => string | null;
  min: number;
  max: number;
  /** the hard range typed values are held to (default min…max) */
  hard?: [number, number];
  step: number;
  show: (v: number) => string;
  /** a typed text → a value (default: a number) */
  parse?: (text: string) => number | null;
  stepLabel: string;
  cls?: string;
  tip?: string;
  /** write through this instead of the store (a link's Amount moves its siblings in other stages: a command) */
  commit?: (v: number) => void;
  /** an element before the label (an HSL band's swatch) */
  lead?: HTMLElement;
  /** a CSS background for the track: what the value does (a hue band's colours) */
  track?: string;
}
/**
 * How the kit's sliders answer the hand (CHB-049, CHB-046's rule for the darkroom controls): a drag moves the value
 * relative to where it started, the slider's usual range over 300 px, in whole steps; Alt ten times finer. The arrow
 * keys step by the slider's step, Shift ten steps, Alt a tenth.
 */
export const numberFeel = (o: Pick<NumberSpec, 'min' | 'max' | 'step'>): Feel => ({ perPx: Math.abs(o.max - o.min) / 300 || o.step, key: o.step, bigKey: o.step * 10, smallKey: o.step * FINE_DRAG, unit: null });

export function numberControl(m: MountCtx, o: NumberSpec): HTMLElement {
  const st = m.store;
  const input = h('input', { type: 'range', class: 'cb-range', min: String(o.min), max: String(o.max), step: String(o.step), 'aria-label': o.label }) as HTMLInputElement;
  const field = h('input', { type: 'text', class: 'cb-num', 'aria-label': `${o.label} value`, spellcheck: 'false' }) as HTMLInputElement;
  const el = h('div', { class: ['cb-stack-num', o.cls, o.track && 'has-track'], 'data-path': o.path, ...(o.tip ? { title: o.tip } : {}) }, o.lead ?? null, h('span', { class: 'cb-stack-num-l', text: o.label }), input, field);
  if (o.track) el.style.setProperty('--cb-track', o.track);
  let f: string | null = null;
  let v: number | undefined;
  let dragging = false;
  const where = (): (string | number)[] | null => {
    const d = f ? peekDoc(m, f) : undefined;
    try {
      return f && d ? storePath(f, d, o.path) : null;
    } catch {
      return null;
    }
  };
  const [lo, hi] = o.hard ?? [o.min, o.max];
  const hold = (x: number): number => Number(Math.min(hi, Math.max(lo, x)).toFixed(6));
  const write = (x: number, coalesce = false): void => {
    if (o.commit) return o.commit(hold(x));
    const p = where();
    if (!p) return;
    m.rctx().tx(`${o.stepLabel} ${o.show(hold(x))}`, (t: any) => t.$set(p, hold(x)), { ...m.txOpts(), ...(coalesce ? { coalesce: `${f}:${o.path}` } : {}), source: { kind: 'control', control: o.path } });
  };
  const feel = numberFeel(o);
  // a drag moves the value from where it started by the feel per pixel (Alt ten times finer); a click without a
  // drag puts the thumb where it was clicked, as the native track does
  listen(m.scope, input, 'pointerdown', (e: PointerEvent) => {
    if (e.button !== 0 || v === undefined) return;
    e.preventDefault();
    input.focus({ preventScroll: true });
    const x0 = v;
    const cx = e.clientX;
    let moved = false;
    let last = x0;
    dragging = true;
    try {
      input.setPointerCapture(e.pointerId);
    } catch {
      /* a synthetic event has no active pointer */
    }
    const show = (x: number): void => {
      last = hold(x);
      input.value = String(Math.min(o.max, Math.max(o.min, last)));
      if (o.commit) return;
      const p = where();
      if (p) st.preview(p, last);
    };
    const move = (ev: PointerEvent): void => {
      const dx = ev.clientX - cx;
      if (!moved && Math.abs(dx) < 3) return;
      moved = true;
      show(dragTo(feel, x0, dx, { fine: ev.altKey, step: o.step, hard: { min: lo, max: hi } }));
    };
    const end = (): void => {
      input.removeEventListener('pointermove', move);
      input.removeEventListener('pointerup', up);
      input.removeEventListener('pointercancel', cancel);
      dragging = false;
    };
    const up = (ev: PointerEvent): void => {
      end();
      if (!moved) {
        const b = input.getBoundingClientRect();
        const at = o.min + (o.max - o.min) * Math.min(1, Math.max(0, (ev.clientX - b.left) / Math.max(1, b.width)));
        show(Math.round(at / o.step) * o.step);
      }
      if (o.commit) return write(last);
      if (st.previewing) st.commit(`${o.stepLabel} ${o.show(last)}`, m.txOpts());
    };
    const cancel = (): void => {
      end();
      if (!o.commit) st.cancel();
    };
    input.addEventListener('pointermove', move);
    input.addEventListener('pointerup', up);
    input.addEventListener('pointercancel', cancel);
  });
  listen(m.scope, input, 'input', () => {
    // a value set by script or assistive tech (the pointer is handled above): commit at once
    if (dragging) return;
    if (o.commit) return write(Number(input.value));
    const p = where();
    if (!p) return;
    st.preview(p, hold(Number(input.value)));
    st.commit(`${o.stepLabel} ${o.show(hold(Number(input.value)))}`, m.txOpts());
  });
  listen(m.scope, input, 'change', () => {
    if (dragging || o.commit) return;
    if (st.previewing) st.commit(`${o.stepLabel} ${o.show(hold(Number(input.value)))}`, m.txOpts());
  });
  listen(m.scope, input, 'keydown', (e: KeyboardEvent) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (!dir || v === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    // the store's value, not the cell's: a second press before the cell has seen the first must not repeat it
    const p = o.commit ? null : where();
    const now = p ? st.peek(p) : undefined;
    write((typeof now === 'number' ? now : v) + dir * (e.shiftKey ? feel.bigKey : e.altKey ? feel.smallKey : feel.key), true);
  });
  listen(m.scope, field, 'keydown', (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      const x = (o.parse ?? ((t: string) => (Number.isFinite(Number(t.replace(',', '.'))) && t.trim() !== '' ? Number(t.replace(',', '.')) : null)))(field.value);
      if (x === null) {
        field.classList.add('is-bad');
        m.rt.chrome.toast(`${o.label}: "${field.value}" is not a value`, { kind: 'warn', ms: 3000 });
        return;
      }
      field.classList.remove('is-bad');
      write(x);
      field.blur();
    } else if (e.key === 'Escape') {
      field.value = v === undefined ? '' : o.show(v);
      field.blur();
    }
  });
  listen(m.scope, field, 'blur', () => void (field.value = v === undefined ? '' : o.show(v)));
  m.cell((s) => ({ f: o.frame(s), v: o.read(s) }), (x) => {
    f = x.f;
    v = x.v;
    el.hidden = v === undefined;
    if (v === undefined) return;
    if (!dragging) input.value = String(Math.min(o.max, Math.max(o.min, v)));
    if (document.activeElement !== field) field.value = o.show(v);
    input.setAttribute('aria-valuetext', `${o.label} ${o.show(v)}`);
  }, { equals: (a: any, b: any) => !!a && a.f === b.f && a.v === b.v });
  return el;
}

/** typed percent: '60', '60 %', '0.6' (a fraction below 1.5 when no % is given is read as a fraction only if it has a point) */
export const parsePercent = (t: string): number | null => {
  const s = t.trim().replace(',', '.').replace(/\s*%$/, '');
  if (!s || !Number.isFinite(Number(s))) return null;
  return Number(s) / 100;
};

export const words = (k: string): string => k.replace(/_([a-z]+)$/, (_m, u: string) => ` (${u})`).replace(/^\w/, (c) => c.toUpperCase());
/** a document path's value: an id path anywhere in the document (an entry's argument, a mask, a list item's field) */
export const readPath = (d: Document, path: string): unknown => {
  try {
    return getPath(d, path);
  } catch {
    return undefined;
  }
};
export const numAt = (s: any, frame: (s: any) => string | null, path: string): number | undefined => {
  const d = sel.doc(s, frame(s));
  const v = d ? readPath(d, path) : undefined;
  return typeof v === 'number' ? v : undefined;
};

