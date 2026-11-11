// Generated controls in Chromogen Studio's slider style (.ctl). Range inputs are wired with native
// listeners: a drag updates the preview overlay and the readout through the DOM, never through a
// React render; release (or the end of a keyboard burst) logs one `set`.
import { getPath } from '@chromobench/contract';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { DARKROOM, allParameters, auditArrangement, type Arrangement } from '../core/arrangement.ts';
import { componentOf, fstopStep, withComponent, type ControlModel } from '../core/controls.ts';
import type { Studio } from '../core/studio.ts';
import { useLogVersion, useStudio, useStudioState } from './hooks.ts';

const SWATCH = ['var(--pR)', 'var(--pG)', 'var(--pB)'];
const NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'End']);

const tidy = (x: number): string => String(Math.round(x * 1e6) / 1e6);

/** Slider position ↔ stored value. Time (log2) slides in stops: position = log2(t). */
function sliderMap(m: ControlModel): { lo: number; hi: number; step: number; toPos(v: number): number; fromPos(p: number): number } {
  if (m.scale === 'log2' && m.storageUnit === 's') {
    // The grid of 1/6-stop steps is anchored at the default time, so 10 s → 11.22 → 12.6 s …
    const base = Math.log2(m.defaultValue as number);
    const lo = base - Math.floor((base - Math.log2(m.min ?? 0.1)) / m.step) * m.step;
    const hi = base + Math.floor((Math.log2(m.max ?? 600) - base) / m.step) * m.step;
    return { lo, hi, step: m.step, toPos: (v) => Math.log2(v), fromPos: (p) => Number((2 ** p).toFixed(3)) };
  }
  const lo = m.toDisplay(m.min ?? 0);
  const hi = m.toDisplay(m.max ?? 1);
  return { lo: Math.round(lo * 1e6) / 1e6, hi: Math.round(hi * 1e6) / 1e6, step: m.step, toPos: m.toDisplay, fromPos: (p) => Number(m.fromDisplay(p).toPrecision(12)) };
}

function RangeControl({ model, k }: { model: ControlModel; k?: number }): ReactElement {
  const st = useStudio();
  const input = useRef<HTMLInputElement>(null);
  const val = useRef<HTMLOutputElement>(null);
  const aside = useRef<HTMLSpanElement>(null);
  const fill = useRef<HTMLSpanElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const map = sliderMap(model);
  const name = k !== undefined && model.components ? `${model.label} ${model.components[k]}` : model.label;
  const zeroPos = Math.min(map.hi, Math.max(map.lo, model.scale === 'log2' ? map.toPos(model.defaultValue as number) : 0));
  const frac = (p: number): number => (p - map.lo) / (map.hi - map.lo || 1);

  useEffect(() => {
    const el = input.current!;
    let keyboard = false;
    const current = (): unknown => getPath(st.session?.log.state, model.path);
    const paint = (): void => {
      const log = st.session?.log;
      if (!log) return;
      const v = current();
      if (v === undefined) return;
      const x = componentOf(model.type, v, k);
      if (st.gesture.activePath !== model.path || document.activeElement !== el) el.value = tidy(map.toPos(x));
      el.setAttribute('aria-valuetext', model.valueText(v, k));
      val.current!.textContent = model.format(v, k);
      const base = getPath(log.toJSON().initial, model.path);
      aside.current!.textContent = model.aside ? model.aside(v, base, k) : '';
      const p = Number(el.value);
      const a = frac(Math.min(zeroPos, p));
      const b = frac(Math.max(zeroPos, p));
      fill.current!.style.left = `calc(${a * 100}% + ${4 - 8 * a}px)`;
      fill.current!.style.width = `calc(${(b - a) * 100}% - ${8 * (b - a)}px)`;
      const changed = getPath(log.committed, model.path);
      box.current!.classList.toggle('changed', JSON.stringify(componentOf(model.type, changed, k)) !== JSON.stringify(componentOf(model.type, base, k)));
      const unusual = model.usual && (x < model.usual[0] || x > model.usual[1]);
      box.current!.classList.toggle('unusual', !!unusual);
      box.current!.title = unusual && model.usualHint ? model.usualHint : model.doc;
    };
    const valueFrom = (): unknown => {
      const x = map.fromPos(Number(el.value));
      return k === undefined ? x : withComponent(model.type, st.session!.log.state === undefined ? model.defaultValue : getPath(st.session!.log.state, model.path), k, x);
    };
    const onInput = (): void => {
      if (!st.session) return;
      st.gesture.drag(model.path, valueFrom(), name);
      paint();
    };
    const onChange = (): void => {
      if (!st.session) return;
      if (keyboard) st.gesture.step(model.path, valueFrom(), name);
      else st.gesture.commit();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (NAV_KEYS.has(e.key)) keyboard = true;
      if (e.key === 'Home') {
        e.preventDefault();
        const d = model.defaultValue;
        st.gesture.set(model.path, k === undefined ? d : withComponent(model.type, getPath(st.session!.log.state, model.path), k, componentOf(model.type, d, k)), `${name} reset`);
      } else if (e.key === 'Escape') {
        st.gesture.cancel();
        paint();
      } else if (e.key === 'i') st.update({ focusPath: model.path });
    };
    const onPointer = (): void => {
      keyboard = false;
    };
    const onFocus = (): void => st.update({ focusPath: model.path });
    const onBlur = (): void => {
      if (st.gesture.activePath === model.path) st.gesture.commit();
    };
    el.addEventListener('input', onInput);
    el.addEventListener('change', onChange);
    el.addEventListener('keydown', onKey);
    el.addEventListener('pointerdown', onPointer);
    el.addEventListener('focus', onFocus);
    el.addEventListener('blur', onBlur);
    const unsub = st.logSignal.subscribe(paint);
    paint();
    return () => {
      el.removeEventListener('input', onInput);
      el.removeEventListener('change', onChange);
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('pointerdown', onPointer);
      el.removeEventListener('focus', onFocus);
      el.removeEventListener('blur', onBlur);
      unsub();
    };
  }, [st, model, k]);

  const reset = (): void => {
    const d = model.defaultValue;
    st.gesture.set(model.path, k === undefined ? d : withComponent(model.type, getPath(st.session!.log.state, model.path), k, componentOf(model.type, d, k)), `${name} reset`);
  };

  return (
    <div className="ctl" ref={box} data-path={model.path}>
      <div className="row">
        <label onDoubleClick={reset} onContextMenu={(e) => { e.preventDefault(); st.update({ focusPath: model.path }); }} title="double-click: reset · right-click: why">
          {k !== undefined && <i style={{ background: SWATCH[k] ?? 'var(--ink)' }} />}{name}
        </label>
        <span className="aside" ref={aside} />
        <output className="val" ref={val} />
      </div>
      <div className="track">
        <span className="fillbar" ref={fill} />
        <span className="zero" style={{ left: `calc(${frac(zeroPos) * 100}% + ${4 - 8 * frac(zeroPos)}px)` }} />
        <input ref={input} type="range" min={map.lo} max={map.hi} step={map.step} defaultValue={tidy(zeroPos)} aria-label={name} data-path={model.path} data-component={k} />
      </div>
    </div>
  );
}

function ChoiceControl({ model }: { model: ControlModel }): ReactElement {
  const st = useStudio();
  useLogVersion();
  const v = st.session ? getPath(st.session.log.state, model.path) : model.defaultValue;
  const values = model.values ?? [];
  const opts = values.includes(String(v)) ? values : [String(v), ...values];
  const set = (x: string): void => {
    const value = model.storageUnit === 'fstop' ? Number(x) : x;
    st.gesture.set(model.path, value, model.label);
  };
  if (model.storageUnit === 'fstop') {
    return (
      <div className="sel-row" data-path={model.path}>
        <label htmlFor={`c-${model.path}`}>{model.label}</label>
        <button className="btn sm" aria-label={`${model.label} one third stop smaller`} onClick={() => set(String(fstopStep(v as number, 1)))}>−</button>
        <select id={`c-${model.path}`} value={String(v)} onChange={(e) => set(e.target.value)} onFocus={() => st.update({ focusPath: model.path })}>
          {opts.map((o) => <option key={o} value={o}>{`f/${o}`}</option>)}
        </select>
        <button className="btn sm" aria-label={`${model.label} one third stop larger`} onClick={() => set(String(fstopStep(v as number, -1)))}>+</button>
        <span className="aside small mut">{model.aside?.(v, getPath(st.session?.log.toJSON().initial, model.path) ?? v) ?? ''}</span>
      </div>
    );
  }
  if (model.widget === 'segmented' && values.length <= 4) {
    return (
      <div className="sel-row" data-path={model.path}>
        <label>{model.label}</label>
        <div className="seg" role="radiogroup" aria-label={model.label}>
          {values.map((o) => <button key={o} role="radio" aria-checked={v === o} className={v === o ? 'on' : ''} onClick={() => set(o)}>{o}</button>)}
        </div>
      </div>
    );
  }
  return (
    <div className="sel-row" data-path={model.path}>
      <label htmlFor={`c-${model.path}`}>{model.label}</label>
      <select id={`c-${model.path}`} value={String(v)} onChange={(e) => set(e.target.value)} onFocus={() => st.update({ focusPath: model.path })}>
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

export function Control({ model }: { model: ControlModel }): ReactElement {
  if (model.type === 'enum' || model.type === 'string' || model.storageUnit === 'fstop') return <ChoiceControl model={model} />;
  if (model.type === 'vec3' || model.type === 'cmy') return <>{[0, 1, 2].map((k) => <RangeControl key={k} model={model} k={k} />)}</>;
  return <RangeControl model={model} />;
}

function arrangementFor(st: Studio, name: string): Arrangement {
  return name === 'all' ? allParameters(st.models) : DARKROOM;
}

export function ControlPanel(): ReactElement {
  const st = useStudio();
  const [which, setWhich] = useState('darkroom');
  const hasFrame = useStudioState((s) => s.frameKey !== null);
  const a = arrangementFor(st, which);
  const missing = auditArrangement(a, st.models);
  return (
    <div>
      <div className="sec">
        <div className="seg" style={{ marginTop: 12 }}>
          <button className={which === 'darkroom' ? 'on' : ''} onClick={() => setWhich('darkroom')}>Darkroom</button>
          <button className={which === 'all' ? 'on' : ''} onClick={() => setWhich('all')}>All parameters</button>
        </div>
        {!hasFrame && <p className="empty" style={{ marginTop: 10 }}>Open a frame to edit its print.</p>}
        {missing.length > 0 && <p className="small" style={{ color: 'var(--accent)' }}>Arrangement paths without a control: {missing.join(', ')}</p>}
      </div>
      {a.groups.map((g) => (
        <section className="sec" key={g.title}>
          <div className="h"><b>{g.title}</b></div>
          {g.paths.map((p) => {
            const m = st.model(p);
            if (!m || (st.session && getPath(st.session.log.committed, p) === undefined)) return null;
            return <Control key={p} model={m} />;
          })}
        </section>
      ))}
    </div>
  );
}
