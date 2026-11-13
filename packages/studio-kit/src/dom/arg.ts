// The cb.arg renderer (guide §5.1): native <input type="range"> thumbs (the M1 spec drives them by value and
// synthetic events), a typed-entry field in darkroom units, a second readout (aside), double-click to reset, the
// Strip button from .testStrip(), the lights pad (R, G, B and density) and the two-button nudge.
//
// Writes: a drag is ctx.preview per move and one commit on release; arrow keys, the wheel, steppers and nudges are
// bursts through the route (one EditLog unit per pause); typed values, selects and resets are one transaction.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { getPath } from '@chromobench/contract';
import { h, listen, type MountCtx } from '@chromobench/shell/dom';
import type { NodeData } from '@chromobench/shell';
import { argModel, parseEntry, parseStep, stepValue, trackRange, type ArgModel } from '../kit/args.ts';
import { badEntryText, clampedText, clampEntry, controlTip, entryHint, entryPlaceholder, isRelativeEntry, relativeText } from '../kit/messages.ts';
import { componentOf, withComponent } from '../model/controls.ts';
import { exposureStep, isInert } from '../model/enlarger.ts';
import { printerSeconds, PT } from '../model/units.ts';
import type { Studio } from '../studio.ts';

const studioOf = (m: MountCtx): Studio => m.rt.services['studio'] as Studio;
/** The title of a printer-lights nudge along one colour axis (CHB-031 F25: two rows called "Printer lights" read alike). */
const AXIS_LABEL: Record<string, string> = { 'yellow-blue': 'Warmth', 'magenta-green': 'Tint' };
/** A time nudge in normalised mode moves the three lights together: its row is about brightness, not seconds (F25). */
const NORMALISED_TIME = { label: 'Brightness', tip: 'Lighter and Darker move the three printer lights together: the enlarger is normalised, so the time does not change the print.' };
const cur = (s: any): string | null => s?.ui?.selection?.primary ?? null;

/**
 * The slider's own scale: stops for log2 time, display units otherwise. `hard` is the contract's hard range on the
 * same scale: the track widens towards it to show a value outside the usual range (CHB-027 F13: an automatic first
 * print of 2.23 s sat at the 2 s floor). A dragged time lands on a value a printer sets (printerSeconds).
 */
function scaleOf(a: ArgModel) {
  const m = a.model;
  const isTime = m.storageUnit === 's' && m.scale === 'log2';
  const lo = m.usual?.[0] ?? m.min ?? 0;
  const hi = m.usual?.[1] ?? m.max ?? 1;
  if (isTime) {
    return {
      min: Math.log2(lo), max: Math.log2(hi), step: m.step, to: (v: number) => Math.log2(v), from: (x: number) => printerSeconds(2 ** x),
      hard: { min: m.min !== undefined && m.min > 0 ? Math.log2(m.min) : -Infinity, max: m.max !== undefined ? Math.log2(m.max) : Infinity },
    };
  }
  const dlo = m.toDisplay(m.displayUnit === 'point' ? -0.5 : lo);
  const dhi = m.toDisplay(m.displayUnit === 'point' ? 0.5 : hi);
  const span = m.storageUnit === 'CC' ? { min: -50, max: 100 } : { min: Math.min(dlo, dhi), max: Math.max(dlo, dhi) };
  const hard = m.min !== undefined && m.max !== undefined ? [m.toDisplay(m.min), m.toDisplay(m.max)] : [-Infinity, Infinity];
  return { ...span, step: m.step, to: (v: number) => m.toDisplay(v), from: (x: number) => Number(m.fromDisplay(x).toFixed(6)), hard: { min: Math.min(hard[0]!, hard[1]!), max: Math.max(hard[0]!, hard[1]!) } };
}

export function renderArg(n: NodeData, m: MountCtx): HTMLElement {
  const p = n.props as Record<string, any>;
  const a = argModel(String(p['path']));
  if (!a) return h('div', { class: 'cb-arg is-bad', text: `cb.arg('${p['path']}'): no such control` });
  const model = a.model;
  const label: string = p['label'] ?? (p['widget'] === 'nudge' ? AXIS_LABEL[String(p['axis'])] : undefined) ?? model.label;
  const step = parseStep(p['step']);
  const rt = m.rt;
  const st = rt.store;
  const frameOf = (s: any): string | null => (typeof p['frame'] === 'function' ? p['frame'](s) : (p['frame'] ?? cur(s)));
  const pathOf = (f: string): (string | number)[] => ['recipes', f, ...model.path.split('.')];
  const read = (s: any) => {
    const f = frameOf(s);
    const r = f ? s.recipes?.[f] : undefined;
    // inert: time, aperture and magnification while the enlarger is normalised (CHB-031 F17); na: a path this
    // frame's kind does not have (a scanner for a photo, F23)
    const v = r ? getPath(r, model.path) : undefined;
    return { f, v, inert: isInert(r, model.path), na: !!r && v === undefined };
  };
  /** the frame's recipe as it is now (with a drag's preview) */
  const recipeNow = (f: string): any => st.peek(['recipes', f]);
  const initialOf = (f: string): unknown => {
    const e = studioOf(m).frames.get(f);
    return e ? getPath(e.initial, model.path) : undefined;
  };
  const txOpts = () => m.txOpts();
  // an inert control never writes (it is hidden; this also holds for a key or script reaching it)
  const commitSet = (f: string, v: unknown, lab = label) => {
    if (now.inert) return;
    studioOf(m).route.endBurst();
    m.rctx().tx(lab, (t: any) => t.$set(pathOf(f), v));
  };
  const burst = (f: string, v: unknown) => {
    if (!now.inert) studioOf(m).route.step(st, rt.clock, pathOf(f), v, label, txOpts());
  };
  /** Lighter / Darker by stops (CHB-031): the time in real mode, the printer lights in normalised mode */
  const exposeBy = (f: string, stops: number, o: { lightsPoints?: number } = {}) => {
    const r = recipeNow(f);
    if (!r) return;
    const mu = exposureStep(r, stops, o);
    studioOf(m).route.step(st, rt.clock, ['recipes', f, ...mu.path.split('.')], mu.value, mu.path === 'print.lights.logH' ? 'Printer lights' : 'Time', txOpts());
  };
  const widget: string = p['widget'] ?? model.widget;
  const el = h('div', { class: ['cb-arg', `is-${widget}`, p['big'] && 'is-big'], 'data-path': p['path'] });
  const head = h('div', { class: 'cb-arg-h' });
  const lab = h('label', { class: 'cb-arg-l', text: label, title: controlTip(model) });
  const out = h('span', { class: 'cb-arg-v' });
  const aside = h('span', { class: 'cb-arg-a' });
  head.append(lab, out, aside);
  el.append(head);
  let now: { f: string | null; v: unknown; inert: boolean; na: boolean } = { f: null, v: undefined, inert: false, na: false };
  const focus = () => m.rctx().set({ ui: { focusPath: model.path } });
  listen(m.scope, el, 'focusin', focus);
  listen(m.scope, lab, 'dblclick', () => {
    if (now.f && model.defaultValue !== undefined) commitSet(now.f, a.component === null ? model.defaultValue : withComponent(model.type, now.v, a.component, componentOf(model.type, model.defaultValue, a.component)), `Reset ${label}`);
  });

  // ── one numeric track (a component, or the number) ──
  const track = (k: number | null, name: string): { el: HTMLElement; set(v: unknown, force?: boolean): void; reset(): void } => {
    const sc = scaleOf(a);
    const input = h('input', { type: 'range', class: 'cb-range', min: String(sc.min), max: String(sc.max), step: String(sc.step), 'aria-label': name }) as HTMLInputElement;
    const hint = entryHint(model);
    const field = h('input', { type: 'text', class: 'cb-num', 'aria-label': `${name} value`, spellcheck: 'false', title: hint, placeholder: entryPlaceholder(model), 'aria-description': hint }) as HTMLInputElement;
    const row = h('div', { class: 'cb-arg-row' }, k !== null ? h('span', { class: 'cb-arg-c', text: model.components?.[k] ?? String(k) }) : null, input, field);
    const valueOf = (x: number): unknown => {
      const y = sc.from(x);
      return k === null ? y : withComponent(model.type, now.v, k, y);
    };
    let dragging = false;
    listen(m.scope, input, 'pointerdown', () => {
      studioOf(m).route.endBurst();
      dragging = true;
    });
    listen(m.scope, input, 'input', () => {
      if (!now.f) return;
      st.preview(pathOf(now.f), valueOf(Number(input.value)));
      if (!dragging) {
        // a value set by script (the M1 spec) or assistive tech: commit at once
        st.commit(label, txOpts());
      }
    });
    listen(m.scope, input, 'change', () => {
      dragging = false;
      if (st.previewing) st.commit(label, txOpts());
    });
    listen(m.scope, input, 'keydown', (e: KeyboardEvent) => {
      const dir = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
      if (!dir || !now.f) return;
      e.preventDefault();
      e.stopPropagation();
      const base = st.peek(pathOf(now.f)) ?? now.v;
      const kk = { ...a, component: k };
      burst(now.f, stepValue(kk, k === null ? base : base, dir * (e.shiftKey ? 3 : e.altKey ? 1 / 3 : 1), step));
    });
    // typed values (CHB-027 F8): a bad entry says why and stays red only while the box has the focus; out of
    // range is held to the limit and said; a relative entry (+, −) says what it did
    listen(m.scope, field, 'keydown', (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Enter' && now.f) {
        const text = field.value;
        const kk = { ...a, component: k };
        const parsed = parseEntry(kk, text, now.v);
        if (parsed === null) {
          field.classList.add('is-bad');
          rt.chrome.toast(badEntryText(model, text), { kind: 'warn', ms: 4000 });
          return;
        }
        field.classList.remove('is-bad');
        const c = clampEntry(kk, parsed, k);
        if (c.hit) rt.chrome.toast(clampedText(model, c.hit, k), { kind: 'warn', ms: 4000 });
        else if (isRelativeEntry(text)) rt.chrome.toast(relativeText(model, text, c.value, k), { kind: 'info', ms: 2400 });
        commitSet(now.f, c.value);
        field.blur();
      } else if (e.key === 'Escape') {
        set(now.v, true);
        field.blur();
      }
    });
    listen(m.scope, field, 'blur', () => set(now.v, true));
    /** show v; `force` also resets the typed box (blur, Escape, another frame) */
    const set = (v: unknown, force = false): void => {
      if (force) field.classList.remove('is-bad');
      if (v === undefined) return;
      const x = k === null ? (v as number) : componentOf(model.type, v, k);
      if (!dragging) {
        const r = trackRange(sc, sc.to(x));
        if (input.min !== String(r.min)) input.min = String(r.min);
        if (input.max !== String(r.max)) input.max = String(r.max);
        input.value = String(sc.to(x));
      }
      if (force || document.activeElement !== field) field.value = model.format(v, k ?? undefined);
      input.setAttribute('aria-valuetext', model.valueText(v, k ?? undefined));
    };
    const reset = (): void => {
      field.classList.remove('is-bad');
      field.value = '';
    };
    return { el: row, set, reset };
  };

  const tracks: { set(v: unknown, force?: boolean): void; reset?(): void }[] = [];
  const body = h('div', { class: 'cb-arg-b' });
  el.append(body);

  if (widget === 'select' || model.type === 'enum' || model.type === 'string') {
    const sel = h('select', { class: 'cb-select', 'aria-label': label }) as HTMLSelectElement;
    for (const v of model.values ?? []) sel.append(h('option', { value: v, text: model.valueLabel(v) }));
    listen(m.scope, sel, 'change', () => now.f && commitSet(now.f, sel.value));
    body.append(sel);
    tracks.push({ set: v => void (sel.value = String(v)) });
  } else if (widget === 'stepper' || model.storageUnit === 'fstop') {
    const minus = h('button', { type: 'button', class: 'ck-btn is-small', 'aria-label': `${label} down`, text: '−' });
    const val = h('span', { class: 'cb-step-v' });
    const plus = h('button', { type: 'button', class: 'ck-btn is-small', 'aria-label': `${label} up`, text: '+' });
    for (const [b, d] of [[minus, -1], [plus, 1]] as const) listen(m.scope, b, 'click', () => now.f && burst(now.f, stepValue(a, st.peek(pathOf(now.f)) ?? now.v, d, step)));
    body.append(h('div', { class: 'cb-arg-row' }, minus, val, plus));
    tracks.push({ set: v => void (val.textContent = model.format(v)) });
  } else if (widget === 'nudge') {
    const [dec, inc] = (p['labels'] as [string, string]) ?? ['Less', 'More'];
    const axis = p['axis'] as string | undefined;
    const move = (dir: number) => {
      if (!now.f) return;
      // a time nudge (simple's Lighter / Darker) is an exposure step: in normalised mode it moves the lights
      if (model.path === 'print.enlarger.time_s') return exposeBy(now.f, dir * (step?.unit === 'st' ? step.value : 1 / 3));
      const base = st.peek(pathOf(now.f)) ?? now.v;
      let v: unknown;
      if (model.type === 'vec3' && axis) {
        const pt = step?.value ?? 2;
        const l = [...(base as number[])];
        // more light of a colour makes more of its complementary dye: warmer (yellower) = more blue light
        if (axis === 'yellow-blue') l[2] = Number((l[2]! - dir * pt * PT).toFixed(6));
        else l[1] = Number((l[1]! + dir * pt * PT).toFixed(6));
        v = l;
      } else v = stepValue(a, base, dir, step);
      burst(now.f, v);
    };
    const bd = h('button', { type: 'button', class: 'ck-btn cb-nudge-b', text: `◀ ${dec}`, 'aria-label': dec });
    const bi = h('button', { type: 'button', class: 'ck-btn cb-nudge-b', text: `${inc} ▶`, 'aria-label': inc });
    listen(m.scope, bd, 'click', () => move(-1));
    listen(m.scope, bi, 'click', () => move(1));
    body.append(h('div', { class: 'cb-arg-row cb-nudge' }, bd, bi));
    tracks.push({ set: () => undefined });
  } else if (model.type === 'vec3' || model.type === 'cmy') {
    const comps = a.component !== null ? [a.component] : [0, 1, 2];
    for (const k of comps) {
      const t = track(k, `${label} ${model.components?.[k] ?? k}`);
      body.append(t.el);
      tracks.push(t);
    }
    if (widget === 'pad' && a.component === null) {
      // density: Lighter / Darker. Real mode: the time by 1/3 stop, as at an enlarger (CHB-031); normalised mode:
      // all three lights together by the pad's step in points (more light prints darker)
      const dens = h('div', { class: 'cb-arg-row' }, h('span', { class: 'cb-arg-c', text: 'D' }));
      for (const [txt, d] of [['Lighter', -1], ['Darker', 1]] as const) {
        const b = h('button', { type: 'button', class: 'ck-btn is-small', text: txt, 'aria-label': `${label} density ${txt.toLowerCase()}` });
        listen(m.scope, b, 'click', () => {
          if (now.f) exposeBy(now.f, d / 3, { lightsPoints: step?.value ?? 1 });
        });
        dens.append(b);
      }
      body.append(dens);
    }
  } else {
    const t = track(null, label);
    body.append(t.el);
    tracks.push(t);
  }
  if (p['strip']) {
    const b = h('button', { type: 'button', class: 'ck-btn is-small cb-strip-b', text: 'Strip', 'data-tip': 'Test strip around this value (T)' });
    listen(m.scope, b, 'click', () => {
      const s = parseStep((p['strip'] as { step?: string }).step ?? '1/3 st');
      const vary = model.path === 'print.enlarger.time_s' ? 'time' : `filtration.${a.component !== null ? 'cmy'[a.component] : 'y'}`;
      m.rctx().set({ ui: { toolOptions: { 'test-strip': { vary, step: s?.value ?? 1 / 3, count: (p['strip'] as { count?: number }).count ?? 5 } } } });
      rt.runCommand('tool.test-strip', null);
    });
    head.append(b);
  }

  const isSelect = widget === 'select' || model.type === 'enum' || model.type === 'string';
  m.cell(read, v => {
    // another frame: what was typed (and its red mark) belongs to the old one
    const other = v.f !== now.f;
    now = v;
    // a select shows its value itself (by name); the readout above it would repeat it
    out.textContent = isSelect ? '' : v.v === undefined ? '—' : a.component !== null ? model.format(v.v, a.component) : model.type === 'vec3' || model.type === 'cmy' ? '' : model.format(v.v);
    const base = v.f ? initialOf(v.f) : undefined;
    aside.textContent = model.aside && v.v !== undefined && base !== undefined && model.type === 'number' ? model.aside(v.v, base) : '';
    if (v.v !== undefined) for (const t of tracks) t.set(v.v, other);
    else if (other) for (const t of tracks) t.reset?.();
    el.classList.toggle('is-empty', v.v === undefined);
    // nothing to set: no frame, a path this kind of frame does not have, or a control the enlarger mode ignores
    // (a time nudge stays: it moves the printer lights in normalised mode, under a brightness title with no seconds)
    el.hidden = !v.f || v.na || (v.inert && widget !== 'nudge');
    if (widget === 'nudge' && model.path === 'print.enlarger.time_s') {
      lab.textContent = v.inert ? NORMALISED_TIME.label : label;
      lab.title = v.inert ? NORMALISED_TIME.tip : controlTip(model);
      if (v.inert) out.textContent = aside.textContent = '';
    }
    el.classList.toggle('is-inert', v.inert);
  });
  return el;
}
