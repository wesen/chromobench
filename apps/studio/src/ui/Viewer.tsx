// The viewer (guide §5.6): a WebGPU canvas in Display P3 (Canvas2D fallback), sized in device
// pixels by a ResizeObserver; wheel zooms around the cursor, drag pans, hover drives the
// densitometer, `p` pins a probe, arrow keys move the probe by one document pixel (Shift: ten).
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactElement } from 'react';
import type { ViewMode } from '../core/frame-session.ts';
import { Canvas2dPresenter } from '../present/presenter-2d.ts';
import { WebGpuPresenter } from '../present/presenter-webgpu.ts';
import { useStudio, useStudioState } from './hooks.ts';
import { MaskOverlay } from './tools/Masks.tsx';
import { ContactSheetView, RingAroundView, StripBands } from './tools/Tools.tsx';

const VIEWS: [ViewMode, string][] = [['print', 'Print'], ['negative', 'Negative'], ['dyes', 'Dyes'], ['classes', 'Base & gamut']];

function cssColour(name: string): [number, number, number] {
  const probe = document.createElement('span');
  probe.style.color = `var(${name})`;
  document.body.append(probe);
  const m = /(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/.exec(getComputedStyle(probe).color);
  probe.remove();
  return m ? [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255] : [1, 1, 1];
}

export function ViewBar(): ReactElement {
  const st = useStudio();
  const view = useStudioState((s) => s.view);
  const split = useStudioState((s) => s.split);
  const fit = useStudioState((s) => s.viewport.fit);
  const status = useStudioState((s) => s.status);
  const error = useStudioState((s) => s.error);
  const engineLabel = useStudioState((s) => s.engineLabel);
  const notes = useStudioState((s) => s.notes);
  return (
    <div className="tools">
      <div className="seg" role="radiogroup" aria-label="View">
        {VIEWS.map(([v, l], i) => <button key={v} role="radio" aria-checked={view === v} className={view === v ? 'on' : ''} title={`${l} (${i + 1})`} onClick={() => st.setView(v)}>{l}</button>)}
      </div>
      <button className={`btn sm${split !== null ? ' primary' : ''}`} id="before-after" aria-pressed={split !== null} title="Before/after (\)" onClick={() => st.setSplit(split === null ? 0.5 : null)}>Before / after</button>
      <div className="seg" aria-label="Zoom">
        <button className={fit ? 'on' : ''} onClick={() => st.zoomPreset('fit')} title="Fit (f)">Fit</button>
        {[1, 2, 4].map((z) => <button key={z} onClick={() => st.zoomPreset(z)}>{z}:1</button>)}
      </div>
      <span className="sp" />
      <span className="pill" id="engine" title={notes.length ? notes.join('\n') : 'engine'}><span>engine</span><b>{engineLabel}</b></span>
      <span className="lbl" id="status" role="status" style={error ? { color: 'var(--accent)' } : undefined}>{status}</span>
    </div>
  );
}

export function Viewer(): ReactElement {
  const st = useStudio();
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const hasFrame = useStudioState((s) => s.frameKey !== null);
  const tool = useStudioState((s) => s.tool);
  const view = useStudioState((s) => s.view);
  const frameName = st.session?.name ?? '';
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  // A lost WebGPU device (driver reset, or headless SwiftShader, which loses it on the first canvas
  // present) falls back to Canvas2D on a fresh canvas element: a canvas keeps its first context.
  const [fallback, setFallback] = useState<string | null>(new URLSearchParams(location.search).has('canvas2d') ? 'requested' : null);

  useEffect(() => {
    const c = canvas.current!;
    let alive = true;
    void (async () => {
      const gpu = fallback ? null : await WebGpuPresenter.create(c).catch(() => null);
      if (!alive) return;
      if (gpu) {
        gpu.onLost = (msg) => {
          st.update({ status: `WebGPU device lost (${msg}); presenting with Canvas2D` });
          setFallback(msg || 'device lost');
        };
      }
      await st.attachPresenter(gpu ?? new Canvas2dPresenter(c));
    })();
    const ro = new ResizeObserver(() => {
      const r = c.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.max(1, Math.round(r.width * dpr));
      c.height = Math.max(1, Math.round(r.height * dpr));
      st.setCanvas(c.width, c.height, dpr);
      st.redraw();
    });
    ro.observe(c);
    const theme = (): void => st.setColours({ stage: cssColour('--stage'), frame: cssColour('--ink') });
    theme();
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', theme);
    const mo = new MutationObserver(theme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      alive = false;
      ro.disconnect();
      mq.removeEventListener('change', theme);
      mo.disconnect();
    };
  }, [st, fallback]);

  useEffect(() => {
    const c = canvas.current!;
    let drag: { x: number; y: number; split: boolean } | null = null;
    const local = (e: PointerEvent | WheelEvent): { x: number; y: number } => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const p = local(e);
      st.zoomAt(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
    };
    const onDown = (e: PointerEvent): void => {
      const p = local(e);
      const sp = st.s.split;
      const onSplit = sp !== null && Math.abs(p.x - sp * c.clientWidth) < 6;
      drag = { ...p, split: onSplit };
      c.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent): void => {
      const p = local(e);
      if (drag) {
        if (drag.split) st.setSplit(Math.min(1, Math.max(0, p.x / c.clientWidth)));
        else if (Math.abs(p.x - drag.x) + Math.abs(p.y - drag.y) > 0) st.panBy(p.x - drag.x, p.y - drag.y);
        drag = { ...drag, ...p };
        return;
      }
      const d = st.toDoc(p.x, p.y);
      if (!d) return;
      setCursor({ x: Math.floor(d.x), y: Math.floor(d.y) });
      st.probeAt({ x: Math.floor(d.x), y: Math.floor(d.y), r: 3 });
    };
    const onUp = (): void => {
      drag = null;
    };
    const onLeave = (): void => {
      if (!drag) st.probeAt(null);
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    c.addEventListener('pointerdown', onDown);
    c.addEventListener('pointermove', onMove);
    c.addEventListener('pointerup', onUp);
    c.addEventListener('pointerleave', onLeave);
    return () => {
      c.removeEventListener('wheel', onWheel);
      c.removeEventListener('pointerdown', onDown);
      c.removeEventListener('pointermove', onMove);
      c.removeEventListener('pointerup', onUp);
      c.removeEventListener('pointerleave', onLeave);
    };
  }, [st, fallback]);

  const onKey = (e: ReactKeyboardEvent): void => {
    const s = st.session;
    if (!s) return;
    const step = e.shiftKey ? 10 : 1;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const mv = d[e.key];
    if (mv) {
      e.preventDefault();
      const c = cursor ?? { x: Math.floor(s.width / 2), y: Math.floor(s.height / 2) };
      const n = { x: Math.min(s.width - 1, Math.max(0, c.x + mv[0])), y: Math.min(s.height - 1, Math.max(0, c.y + mv[1])) };
      setCursor(n);
      st.probeAt({ ...n, r: 3 });
    } else if (e.key === 'p' && cursor) {
      e.preventDefault();
      e.stopPropagation();
      st.pinProbe(`p${Object.keys(s.log.state.probes).length + 1}`, { ...cursor, r: 3 });
    }
  };

  const hideCanvas = tool === 'ringAround' || tool === 'contactSheet';
  return (
    <div className="canvas-wrap" ref={wrap}>
      {!hasFrame && (
        <div className="drop" id="drop"><div><b>Open a scan</b><br />TIFF or PNG (16-bit), DNG or camera RAW<br />with Open files…, or add a folder of scans in the library.</div></div>
      )}
      <canvas key={fallback ?? 'gpu'} id="view" ref={canvas} className="viewer" tabIndex={0} role="img"
        aria-label={hasFrame ? `${frameName}, ${tool ?? view} view` : 'no frame'}
        style={{ visibility: hasFrame && !hideCanvas ? 'visible' : 'hidden' }} onKeyDown={onKey} />
      {hasFrame && tool === 'mask' && <MaskOverlay />}
      {hasFrame && tool === 'testStrip' && <StripBands />}
      {hasFrame && tool === 'ringAround' && <RingAroundView />}
      {hasFrame && tool === 'contactSheet' && <ContactSheetView />}
    </div>
  );
}

const f2 = (x: number): string => x.toFixed(2);

export function Readout(): ReactElement {
  const p = useStudioState((s) => s.probe);
  const pinned = useStudioState((s) => s.pinned);
  const classes = useStudioState((s) => s.classes);
  const view = useStudioState((s) => s.view);
  const notes = useStudioState((s) => s.notes);
  return (
    <div className="sreadout" id="readout" aria-live="off">
      {!p && <span>move over the print to read values · arrows move the probe · p pins it</span>}
      {!p && notes.length > 0 && <span className="mut" id="notes">{notes.join(' · ')}</span>}
      {p && (
        <>
          <span>x <b>{p.at.x}</b> y <b>{p.at.y}</b></span>
          {p.dyes && <span>dyes <b>{p.dyes.map(f2).join(' ')}</b></span>}
          <span>D <b>{p.D.map(f2).join(' ')}</b></span>
          {p.visual !== null && <span>visual D <b id="visual-d">{f2(p.visual)}</b></span>}
        </>
      )}
      {Object.entries(pinned).map(([id, r]) => <span key={id} data-probe={id}>◎ {id} <b>{r.visual !== null ? f2(r.visual) : r.D.map(f2).join(' ')}</b></span>)}
      {view === 'classes' && classes && (
        <span id="classes" title="blank film: no image density; below base: lighter than the rebate, more than the noise explains; out of gamut: dyes the print cannot reach">
          blank <b>{(100 * (classes['blank'] ?? 0)).toFixed(1)} %</b> · below base <b>{(100 * (classes['belowBase'] ?? 0)).toFixed(1)} %</b> · out of gamut <b className={(classes['unreachable'] ?? 0) > 0 ? 'warn' : ''}>{(100 * (classes['unreachable'] ?? 0)).toFixed(1)} %</b>
        </span>
      )}
    </div>
  );
}
