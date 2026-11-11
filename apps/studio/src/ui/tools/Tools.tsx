// Darkroom tool UIs on the mock ops (guide §5.9): test strip, ring-around, contact sheet, exposure
// list. Each click becomes one transaction; the arithmetic lives in core/tools.ts.
import type { Exposure, Vec3 } from '@chromobench/contract';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { FrameSession } from '../../core/frame-session.ts';
import type { Studio, Tool } from '../../core/studio.ts';
import {
  addLights, exposureRows, nextExposureId, printingScript, ringTiles, stripLabel, stripMutation, stripValues, testStripArgs, type StripVary,
} from '../../core/tools.ts';
import type { PresentImage } from '../../present/presenter.ts';
import { useLogVersion, useStore, useStudio, useStudioState } from '../hooks.ts';
import { MaskPanel } from './Masks.tsx';

const TOOLS: [Tool, string, string][] = [
  ['testStrip', 'Test strip', 't'], ['ringAround', 'Ring-around', 'r'], ['contactSheet', 'Contact sheet', ''], ['mask', 'Masks', 'm'], ['exposures', 'Exposures', ''],
];

/** Draws a display image into a small 2D canvas. */
export function Tile({ img, label }: { img: PresentImage | null; label: string }): ReactElement {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !img) return;
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d', { colorSpace: 'display-p3' }) ?? c.getContext('2d')!;
    const id = ctx.createImageData(img.width, img.height);
    const ch = img.channels;
    for (let i = 0; i < img.width * img.height; i++) {
      for (let k = 0; k < 3; k++) id.data[i * 4 + k] = Math.round(Math.min(1, Math.max(0, img.data[i * ch + Math.min(k, ch - 1)]!)) * 255);
      id.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
  }, [img]);
  return <canvas ref={ref} role="img" aria-label={label} className="tile-img" />;
}

// ---- test strip ----------------------------------------------------------------------------

const TIME_STEPS: [number, string][] = [[1 / 6, '1/6'], [1 / 3, '1/3'], [1 / 2, '1/2'], [1, '1 st']];
const CC_STEPS: [number, string][] = [[2, '2'], [5, '5'], [10, '10 CC']];

function stripBase(st: Studio, vary: StripVary): number {
  const r = st.session!.log.committed;
  return vary === 'time' ? r.print.enlarger.time_s : r.print.enlarger.filtration[vary.slice(-1) as 'c' | 'm' | 'y'];
}

function TestStripPanel(): ReactElement {
  const st = useStudio();
  const strip = useStudioState((s) => s.strip);
  const steps = strip.vary === 'time' ? TIME_STEPS : CC_STEPS;
  return (
    <section className="sec">
      <div className="h"><b>Test strip</b><span className="tag op">darkroom.testStrip</span></div>
      <div className="sel-row"><label>Vary</label>
        <div className="seg" role="radiogroup" aria-label="Vary">
          {(['time', 'filtration.y', 'filtration.m', 'filtration.c'] as StripVary[]).map((v) => (
            <button key={v} role="radio" aria-checked={strip.vary === v} className={strip.vary === v ? 'on' : ''}
              onClick={() => st.setStrip({ vary: v, step: v === 'time' ? 1 / 3 : 5 })}>{v === 'time' ? 'time' : v.slice(-1).toUpperCase()}</button>
          ))}
        </div>
      </div>
      <div className="sel-row"><label>Step</label>
        <div className="seg" role="radiogroup" aria-label="Step">
          {steps.map(([v, l]) => <button key={l} role="radio" aria-checked={strip.step === v} className={strip.step === v ? 'on' : ''} onClick={() => st.setStrip({ step: v })}>{l}</button>)}
        </div>
      </div>
      <div className="sel-row"><label htmlFor="strip-count">Count</label>
        <input id="strip-count" type="number" min={3} max={9} value={strip.count} onChange={(e) => st.setStrip({ count: Math.min(9, Math.max(3, Number(e.target.value) || 5)) })} style={{ width: 60 }} />
      </div>
      <p className="about">Click a band under the strip to use its value. The mock engine prints bands around its own reference; densities are illustrative until CHB-010.</p>
    </section>
  );
}

export function StripBands(): ReactElement {
  const st = useStudio();
  useLogVersion();
  const strip = useStudioState((s) => s.strip);
  const [readings, setReadings] = useState<number[]>([]);
  const s = st.session;
  const values = s ? stripValues(strip.vary, stripBase(st, strip.vary), strip.step, strip.count) : [];
  useEffect(() => {
    if (!s) return;
    let alive = true;
    void (async () => {
      const dyes = s.chainNode('invert.dyes') ?? s.chainNode('film.grain')!;
      const node = s.graph.intern('darkroom.testStrip', [dyes.id], testStripArgs(strip.vary, strip.step, strip.count)).node;
      const m = s.graph.intern('measure.patches', [node.id], { cols: strip.count, rows: 1 }).node;
      st.engine.adopt(s.graph.closure(m.id));
      const r = await st.engine.measure(m, { precision: 'preview' });
      const cells = r.value['cells'] as { D: number[] }[];
      if (alive) setReadings(cells.map((c) => -Math.log10(Math.max(c.D[1]!, 1e-6))));
    })().catch((e) => st.report(e));
    return () => {
      alive = false;
    };
  }, [st, s, strip.vary, strip.step, strip.count]);
  if (!s) return <></>;
  const base = stripBase(st, strip.vary);
  return (
    <div className="bands" role="group" aria-label="Test strip bands">
      {values.map((v, i) => (
        <button key={i} className={`band${Math.abs(v - base) < 1e-9 ? ' now' : ''}`} data-value={v}
          onClick={() => st.gesture.apply([stripMutation(strip.vary, s.log.committed, v)], `test strip ${stripLabel(strip.vary, v)}`, `strip-${Date.now().toString(36)}`)}>
          <b>{stripLabel(strip.vary, v)}</b>
          <span>{Math.abs(v - base) < 1e-9 ? 'now' : `use`}</span>
          <span className="mut">D {readings[i] !== undefined ? readings[i]!.toFixed(2) : '…'}</span>
        </button>
      ))}
    </div>
  );
}

// ---- ring-around ---------------------------------------------------------------------------

function useRender<T>(fn: () => Promise<T>, deps: unknown[]): T | null {
  const [v, setV] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    void fn().then((x) => { if (alive) setV(x); });
    return () => {
      alive = false;
    };
  }, deps);
  return v;
}

function RingAroundPanel(): ReactElement {
  const st = useStudio();
  const step = useStudioState((s) => s.ringStep);
  return (
    <section className="sec">
      <div className="h"><b>Ring-around</b><span className="tag op">print.lights</span></div>
      <div className="sel-row"><label>Step</label>
        <div className="seg" role="radiogroup" aria-label="Ring-around step">
          {[2, 4, 8].map((p) => <button key={p} role="radio" aria-checked={step === p} className={step === p ? 'on' : ''} onClick={() => st.update({ ringStep: p })}>{p} pt</button>)}
        </div>
      </div>
      <p className="about">Each tile is the current print with a printer-lights offset. Labels name the colour the print moves towards; the change is in light, so a greener print gets less green light. Click a tile to use it.</p>
    </section>
  );
}

export function RingAroundView(): ReactElement {
  const st = useStudio();
  const v = useLogVersion();
  const step = useStudioState((s) => s.ringStep);
  const s = st.session!;
  const tiles = ringTiles(step);
  const imgs = useRender(async () => {
    const r = s.log.state;
    const out: Record<string, { img: PresentImage; node: string }> = {};
    for (const t of tiles) {
      const node = s.displayNode({ ...r, print: { ...r.print, lights: { ...r.print.lights, logH: addLights(r.print.lights.logH, t.offset) } } });
      out[t.id] = { img: await st.renderSmall(s, node, 220), node: node.id };
    }
    return out;
  }, [s, v, step]);
  const lights = s.log.committed.print.lights.logH;
  return (
    <div className="ring" role="group" aria-label="Ring-around">
      {tiles.map((t) => (
        <button key={t.id} className={`ring-tile${t.id === 'current' ? ' now' : ''}`} style={{ gridRow: t.row + 1, gridColumn: t.row === 3 ? t.col + 1 : t.col + 2 }}
          data-tile={t.id} data-node={imgs?.[t.id]?.node ?? ''} aria-label={`${t.label}${t.id === 'current' ? '' : `: lights ${t.offset.map((x) => (x / 0.025).toFixed(0)).join(', ')} pt`}`}
          onClick={() => { if (t.id !== 'current') st.setLights(addLights(lights, t.offset) as Vec3, `ring-around ${t.label}`); }}>
          <Tile img={imgs?.[t.id]?.img ?? null} label={t.label} />
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

// ---- contact sheet -------------------------------------------------------------------------

export function ContactSheetView(): ReactElement {
  const st = useStudio();
  const v = useLogVersion();
  const lib = useStore(st.library.state, (x) => x);
  const [mode, setMode] = useState<'own' | 'current'>('own');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const frames = st.library.framesOf(lib.currentRoll);
  const cur = st.session!;
  const imgs = useRender(async () => {
    const out: Record<string, PresentImage | null> = {};
    for (const f of frames) {
      const s: FrameSession | null = await st.sessionFor(f).catch(() => null);
      if (!s) {
        out[f.key] = null;
        continue;
      }
      const own = s.log.committed;
      const r = mode === 'own' ? own : { ...own, print: { ...cur.log.committed.print, exposures: own.print.exposures } };
      out[f.key] = await st.renderSmall(s, s.displayNode(r), 200);
    }
    return out;
  }, [frames.length, mode, v, lib.currentRoll]);
  const toggle = (k: string): void => {
    const n = new Set(sel);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    setSel(n);
  };
  return (
    <div className="sheet-wrap">
      <div className="tools">
        <div className="seg" role="radiogroup" aria-label="Print frames with">
          <button role="radio" aria-checked={mode === 'own'} className={mode === 'own' ? 'on' : ''} onClick={() => setMode('own')}>Own settings</button>
          <button role="radio" aria-checked={mode === 'current'} className={mode === 'current' ? 'on' : ''} onClick={() => setMode('current')}>Current settings</button>
        </div>
        <span className="sp" />
        <button className="btn sm primary" id="apply-selected" disabled={sel.size === 0} onClick={() => void st.applyToFrames([...sel]).then(() => setSel(new Set()))}>
          Apply these settings to {sel.size} selected
        </button>
      </div>
      <div className="sheet" role="list" aria-label="Contact sheet">
        {frames.map((f, i) => (
          <label key={f.key} role="listitem" className={`sheet-cell${f.sha256 === cur.sha ? ' now' : ''}`} data-frame={f.name}>
            <Tile img={imgs?.[f.key] ?? null} label={f.name} />
            <span><input type="checkbox" checked={sel.has(f.key)} disabled={f.sha256 === cur.sha} onChange={() => toggle(f.key)} aria-label={`Select ${f.name}`} /> {String(i + 1).padStart(2, '0')} {f.name}{f.badges.edited ? ' ●' : ''}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

// ---- exposure list -------------------------------------------------------------------------

function ExposureList(): ReactElement {
  const st = useStudio();
  useLogVersion();
  const s = st.session;
  if (!s) return <p className="empty">No frame open.</p>;
  const r = s.log.committed;
  const rows = exposureRows(r);
  const masks = Object.keys(r.masks);
  const add = (kind: Exposure['kind']): void => {
    const id = nextExposureId(r, kind);
    const base = { id, kind, mask: kind === 'flash' ? null : masks[0] ?? null };
    const e = kind === 'dodge' ? { ...base, stops: 0.25 } : kind === 'burn' ? { ...base, stops: 0.5 } : kind === 'flash' ? { ...base, time_s: 2, through: 'base' as const } : { ...base, time_s: r.print.enlarger.time_s / 2, filtration: { ...r.print.enlarger.filtration } };
    st.gesture.apply([{ op: 'exposure.add', exposure: e }], `Add ${kind} ${id}`);
  };
  return (
    <section className="sec">
      <div className="h"><b>Exposures</b><span className="tag op">print.exposures</span></div>
      <table className="exp" id="exposures">
        <thead><tr><th>#</th><th>kind</th><th>mask</th><th>change</th><th>time</th><th>C/M/Y</th><th /></tr></thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id} data-exposure={row.id} className={row.enabled ? '' : 'off'}>
              <td>{i + 1}</td>
              <td>{row.kind === 'main' ? 'main' : <label><input type="checkbox" checked={row.enabled} aria-label={`${row.id} enabled`} onChange={(e) => st.gesture.set(`print.exposures.${row.id}.enabled`, e.target.checked, `${row.id} ${e.target.checked ? 'on' : 'off'}`)} /> {row.kind}</label>}</td>
              <td>{row.kind === 'main' || row.kind === 'flash' ? '—' : (
                <select aria-label={`${row.id} mask`} value={row.mask ?? ''} onChange={(e) => st.gesture.set(`print.exposures.${row.id}.mask`, e.target.value || null, `${row.id} mask`)}>
                  <option value="">none</option>
                  {masks.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              )}</td>
              <td>{row.kind === 'dodge' || row.kind === 'burn' ? (
                <input type="number" step={0.25} min={0} max={6} aria-label={`${row.id} stops`} defaultValue={r.print.exposures.find((e) => e.id === row.id)?.stops ?? 0} key={`${row.id}-${row.change}`}
                  onChange={(e) => { const x = Number(e.target.value); if (Number.isFinite(x) && x > 0) st.gesture.set(`print.exposures.${row.id}.stops`, x, `${row.id} stops`); }} style={{ width: 52 }} />
              ) : row.change}<span className="mut small"> {row.kind === 'dodge' || row.kind === 'burn' ? row.change : ''}</span></td>
              <td className="num">{row.seconds}</td>
              <td className="small">{row.filtration}</td>
              <td>{row.kind !== 'main' && <button className="btn sm" aria-label={`Remove ${row.id}`} onClick={() => st.gesture.apply([{ op: 'exposure.remove', id: row.id }], `Remove ${row.id}`)}>×</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row-btns">
        {(['dodge', 'burn', 'flash', 'split'] as const).map((k) => <button key={k} className="btn sm" onClick={() => add(k)}>+ {k}</button>)}
      </div>
      <p className="small" id="printing-script"><b>Printing script:</b> {printingScript(r)}</p>
    </section>
  );
}

export function ToolsPanel(): ReactElement {
  const st = useStudio();
  const tool = useStudioState((s) => s.tool);
  return (
    <div>
      <section className="sec">
        <div className="h"><b>Darkroom tools</b></div>
        <div className="tool-grid">
          {TOOLS.map(([t, l, key]) => (
            <button key={t} className={`btn sm${tool === t ? ' primary' : ''}`} aria-pressed={tool === t} onClick={() => st.setTool(t)} title={key ? `${l} (${key})` : l} disabled={!st.session}>{l}</button>
          ))}
        </div>
      </section>
      {tool === 'testStrip' && <TestStripPanel />}
      {tool === 'ringAround' && <RingAroundPanel />}
      {tool === 'contactSheet' && <section className="sec"><div className="h"><b>Contact sheet</b><span className="tag op">darkroom.contactSheet</span></div><p className="about">The roll in a grid, each frame with its own settings or with the current ones. Select frames and apply the current print settings to them: one transaction per frame, all sharing one id.</p></section>}
      {tool === 'mask' && <MaskPanel />}
      {tool === 'exposures' && <ExposureList />}
    </div>
  );
}
