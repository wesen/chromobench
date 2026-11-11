// Habits (port of CraftKit ui/habits.js): behaviours every professional widget shares, written once and attached to
// forms: scrub · nudge · reset · rename · context · focusKeys. parseValue (units and arithmetic) is headless, in
// core/math.ts, and no longer uses Function().

/* eslint-disable @typescript-eslint/no-explicit-any */
import { listen, drag } from './h.ts';
import { chordFromEvent, parseChord, type KeyTarget } from '../core/keys.ts';
import { modStep, snap } from '../core/math.ts';
import type { Scope } from '../core/cells.ts';
import type { MountCtx } from './mount.ts';

export { parseValue, UNITS, MIXED, modStep, snap } from '../core/math.ts';

export interface ScrubOpts {
  get(): number;
  preview(v: number): void;
  commit(): void;
  cancel(): void;
  step?: number;
  min?: number | undefined;
  max?: number | undefined;
  pxPerStep?: number;
  enabled?: () => boolean;
  onStart?: (e: PointerEvent) => void;
  click?: (e: PointerEvent | null) => void;
}
/** drag sideways on a label or a track to change a number */
export function scrub(scope: Scope, el: HTMLElement, o: ScrubOpts): void {
  el.classList.add('ck-scrub');
  listen(scope, el, 'pointerdown', (e: PointerEvent) => {
    if (e.button !== 0 || (o.enabled && !o.enabled())) return;
    e.preventDefault();
    const v0 = +o.get() || 0;
    const x0 = e.clientX;
    let moved = false;
    o.onStart?.(e);
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
        o.preview(snap(v, (o.step || 1) * modStep(ev)));
      },
      up: ev => {
        if (moved) o.commit();
        else o.click?.(ev);
      },
      cancel: () => o.cancel(),
    });
  });
}

/** arrow keys on a focused field, Shift ×10, Alt ×0.1; a run of nudges is one undo step (coalesced) */
export function nudge(scope: Scope, el: HTMLElement, o: { get(): number; set(v: number): void; step?: number; min?: number | undefined; max?: number | undefined; horizontal?: boolean; enabled?: () => boolean }): void {
  listen(scope, el, 'keydown', (e: KeyboardEvent) => {
    const dir = ({ ArrowUp: 1, ArrowRight: o.horizontal ? 1 : 0, ArrowDown: -1, ArrowLeft: o.horizontal ? -1 : 0 } as Record<string, number>)[e.key];
    if (!dir || e.metaKey || e.ctrlKey) return;
    if (o.enabled && !o.enabled()) return;
    e.preventDefault();
    e.stopPropagation();
    let v = (+o.get() || 0) + dir * (o.step || 1) * modStep(e);
    if (o.min != null) v = Math.max(o.min, v);
    if (o.max != null) v = Math.min(o.max, v);
    o.set(snap(v, (o.step || 1) * modStep(e)));
  });
}

/** double-click resets to a value */
export function reset(scope: Scope, el: HTMLElement, o: { apply(): void }): void {
  listen(scope, el, 'dblclick', (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    o.apply();
  });
  el.classList.add('ck-resettable');
}

/** double-click a label to edit it in place */
export function rename(scope: Scope, el: HTMLElement, o: { get(): string; set(v: string): void }): void {
  listen(scope, el, 'dblclick', (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const input = document.createElement('input');
    input.className = 'ck-rename';
    input.value = o.get();
    const old = el.textContent || '';
    el.textContent = '';
    el.appendChild(input);
    input.focus();
    input.select();
    const done = (ok: boolean): void => {
      input.remove();
      el.textContent = old;
      if (ok && input.value.trim() && input.value !== old) o.set(input.value.trim());
    };
    input.addEventListener('keydown', ev => {
      ev.stopPropagation();
      if (ev.key === 'Enter') done(true);
      if (ev.key === 'Escape') done(false);
    });
    input.addEventListener('blur', () => done(true), { once: true });
  });
}

/** right-click (or the menu key) opens a menu built from command ids */
export function context(scope: Scope, el: HTMLElement, m: MountCtx, items: unknown, argFn?: (e: MouseEvent) => unknown): void {
  listen(scope, el, 'contextmenu', (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const st = m.store.readonly();
    const arg = argFn ? argFn(e) : undefined;
    const list = typeof items === 'function' ? items(st, arg) : items;
    m.rt.chrome.contextMenu(e.clientX, e.clientY, list as any[], arg);
  });
}

/** keys that apply while this element (or something in it) has focus */
export function focusKeys(scope: Scope, el: HTMLElement, m: MountCtx, map: Record<string, KeyTarget> | undefined): void {
  const table = new Map<string, KeyTarget>();
  for (const [ch, target] of Object.entries(map || {})) {
    try {
      table.set(parseChord(ch, m.rt.platform), target);
    } catch {
      /* reported at build */
    }
  }
  listen(scope, el, 'keydown', (e: KeyboardEvent) => {
    const t0 = e.target as HTMLElement | null;
    if (t0?.matches?.('input,textarea,[contenteditable]') && !e.metaKey && !e.ctrlKey) return;
    const ch = chordFromEvent(e, m.rt.platform);
    const t = ch && table.get(ch);
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    m.run(t, e);
  });
}
