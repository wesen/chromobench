// Mask editor (guide §5.9): brush, eraser, gradient and ellipse over the viewer. Strokes preview on
// a 2-D overlay without an engine round trip; on release the vector MaskSpec is written with one
// `mask.set` and the print re-renders. Strokes are simplified (Ramer–Douglas–Peucker, 0.5 px).
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Store } from '../../core/store.ts';
import type { Studio } from '../../core/studio.ts';
import { maskSpec, parseMask, simplify, type MaskDoc, type MaskShape, type Pt3 } from '../../core/tools.ts';
import { useLogVersion, useStore, useStudio } from '../hooks.ts';

export interface MaskUi { id: string; tool: 'brush' | 'erase' | 'gradient' | 'ellipse'; radius: number; hardness: number; overlay: boolean }
export const maskUi = new Store<MaskUi>({ id: 'mask1', tool: 'ellipse', radius: 6, hardness: 0.5, overlay: true });

function docOf(st: Studio, id: string): MaskDoc {
  const spec = st.session?.log.committed.masks[id];
  return spec ? parseMask(spec) : { shapes: [], feather: 0, invert: false };
}

function writeMask(st: Studio, id: string, doc: MaskDoc, label: string): void {
  const s = st.session;
  if (!s) return;
  const src = s.chainNode('source.open', s.log.committed)!;
  st.gesture.apply([{ op: 'mask.set', id, mask: maskSpec(s.graph, src.id, doc) }], label);
}

export function MaskPanel(): ReactElement {
  const st = useStudio();
  useLogVersion();
  const ui = useStore(maskUi, (u) => u);
  const [name, setName] = useState('');
  const masks = Object.keys(st.session?.log.committed.masks ?? {});
  const doc = docOf(st, ui.id);
  return (
    <section className="sec" id="mask-panel">
      <div className="h"><b>Masks</b><span className="tag op">mask.set</span></div>
      <div className="sel-row"><label htmlFor="mask-id">Mask</label>
        <select id="mask-id" value={ui.id} onChange={(e) => maskUi.update({ id: e.target.value })}>
          {[...new Set([ui.id, ...masks])].map((m) => <option key={m} value={m}>{m}{masks.includes(m) ? '' : ' (new)'}</option>)}
        </select>
      </div>
      <form className="sel-row" onSubmit={(e) => { e.preventDefault(); const id = name.trim().replace(/[^A-Za-z0-9_-]/g, '_'); if (id) maskUi.update({ id }); setName(''); }}>
        <label htmlFor="mask-new">New mask</label>
        <input id="mask-new" value={name} placeholder="sky, face…" onChange={(e) => setName(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
        <button className="btn sm" type="submit">Name</button>
      </form>
      <div className="sel-row"><label>Tool</label>
        <div className="seg" role="radiogroup" aria-label="Mask tool">
          {(['brush', 'erase', 'gradient', 'ellipse'] as const).map((t) => <button key={t} role="radio" aria-checked={ui.tool === t} className={ui.tool === t ? 'on' : ''} onClick={() => maskUi.update({ tool: t })}>{t}</button>)}
        </div>
      </div>
      <div className="sel-row"><label htmlFor="mask-size">Brush size</label>
        <input id="mask-size" type="range" min={1} max={200} value={ui.radius} onChange={(e) => maskUi.update({ radius: Number(e.target.value) })} style={{ flex: 1 }} /><span className="small">{ui.radius} px</span>
      </div>
      <div className="sel-row"><label htmlFor="mask-hard">Hardness</label>
        <input id="mask-hard" type="range" min={0} max={1} step={0.05} value={ui.hardness} onChange={(e) => maskUi.update({ hardness: Number(e.target.value) })} style={{ flex: 1 }} />
      </div>
      <div className="sel-row"><label htmlFor="mask-feather">Feather</label>
        <input id="mask-feather" type="number" min={0} max={500} value={doc.feather} disabled={!doc.shapes.length}
          onChange={(e) => writeMask(st, ui.id, { ...doc, feather: Math.max(0, Number(e.target.value) || 0) }, `Mask ${ui.id} feather`)} style={{ width: 64 }} /><span className="small">px</span>
      </div>
      <div className="row-btns">
        <label className="small"><input type="checkbox" checked={doc.invert} disabled={!doc.shapes.length} onChange={(e) => writeMask(st, ui.id, { ...doc, invert: e.target.checked }, `Mask ${ui.id} invert`)} /> invert</label>
        <label className="small"><input type="checkbox" checked={ui.overlay} onChange={(e) => maskUi.update({ overlay: e.target.checked })} /> overlay (o)</label>
        <button className="btn sm" disabled={!doc.shapes.length} onClick={() => writeMask(st, ui.id, { ...doc, shapes: doc.shapes.slice(0, -1) }, `Mask ${ui.id} remove last shape`)}>Remove last</button>
      </div>
      <p className="about" id="mask-summary">{doc.shapes.length} shape{doc.shapes.length === 1 ? '' : 's'} in {ui.id}: {doc.shapes.map((s) => s.kind).join(', ') || 'none'}. Drag on the picture: the gradient goes from the area to keep to the area to leave. [ and ] change the brush size.</p>
    </section>
  );
}

function drawShapes(ctx: CanvasRenderingContext2D, st: Studio, doc: MaskDoc, extra: MaskShape | null, w: number, h: number): void {
  ctx.clearRect(0, 0, w, h);
  const v = st.viewTransform();
  if (!v) return;
  const z = st.zoom();
  const P = (x: number, y: number): [number, number] => {
    const c = st.toCanvas(x, y)!;
    return [c.x, c.y];
  };
  const shapes = extra ? [...doc.shapes, extra] : doc.shapes;
  const layer = document.createElement('canvas');
  layer.width = w;
  layer.height = h;
  const l = layer.getContext('2d')!;
  l.fillStyle = l.strokeStyle = 'rgb(226 0 26)';
  l.lineCap = l.lineJoin = 'round';
  for (const s of shapes) {
    l.globalCompositeOperation = s.kind === 'stroke' && s.mode === 'erase' ? 'destination-out' : 'source-over';
    if (s.kind === 'ellipse') {
      const [cx, cy] = P(s.cx, s.cy);
      l.beginPath();
      l.ellipse(cx, cy, Math.max(0.5, s.rx * z), Math.max(0.5, s.ry * z), 0, 0, 2 * Math.PI);
      l.fill();
    } else if (s.kind === 'gradient') {
      const [ax, ay] = P(...s.from);
      const [bx, by] = P(...s.to);
      const g = l.createLinearGradient(ax, ay, bx, by);
      g.addColorStop(0, 'rgb(226 0 26 / 1)');
      g.addColorStop(1, 'rgb(226 0 26 / 0)');
      const [x0, y0] = P(0, 0);
      l.fillStyle = g;
      l.fillRect(x0, y0, v.docW * z, v.docH * z);
      l.fillStyle = 'rgb(226 0 26)';
    } else {
      l.lineWidth = Math.max(1, 2 * s.radius * z);
      l.beginPath();
      s.points.forEach(([x, y], i) => {
        const [px, py] = P(x, y);
        if (i === 0) l.moveTo(px, py);
        else l.lineTo(px, py);
      });
      if (s.points.length === 1) l.lineTo(...P(s.points[0]![0] + 0.01, s.points[0]![1]));
      l.stroke();
    }
  }
  if (doc.invert) {
    l.globalCompositeOperation = 'xor';
    const [x0, y0] = P(0, 0);
    l.fillRect(x0, y0, v.docW * z, v.docH * z);
  }
  ctx.globalAlpha = 0.5;
  ctx.drawImage(layer, 0, 0);
  ctx.globalAlpha = 1;
}

export function MaskOverlay(): ReactElement {
  const st = useStudio();
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    let draft: MaskShape | null = null;
    let start: [number, number] | null = null;
    const size = (): void => {
      const r = c.getBoundingClientRect();
      c.width = Math.max(1, Math.round(r.width));
      c.height = Math.max(1, Math.round(r.height));
    };
    const redraw = (): void => {
      const ui = maskUi.get();
      if (!ui.overlay) {
        ctx.clearRect(0, 0, c.width, c.height);
        return;
      }
      drawShapes(ctx, st, docOf(st, ui.id), draft, c.width, c.height);
    };
    const doc = (e: PointerEvent): [number, number] => {
      const r = c.getBoundingClientRect();
      const d = st.toDoc(e.clientX - r.left, e.clientY - r.top)!;
      return [Number(d.x.toFixed(1)), Number(d.y.toFixed(1))];
    };
    const onDown = (e: PointerEvent): void => {
      const ui = maskUi.get();
      c.setPointerCapture(e.pointerId);
      start = doc(e);
      if (ui.tool === 'brush' || ui.tool === 'erase') draft = { kind: 'stroke', points: [[...start, e.pressure || 0.5] as Pt3], radius: ui.radius, hardness: ui.hardness, mode: ui.tool === 'erase' ? 'erase' : 'add' };
      else if (ui.tool === 'gradient') draft = { kind: 'gradient', from: start, to: start };
      else draft = { kind: 'ellipse', cx: start[0], cy: start[1], rx: 0, ry: 0 };
      redraw();
    };
    const onMove = (e: PointerEvent): void => {
      if (!draft || !start) return;
      const p = doc(e);
      if (draft.kind === 'stroke') draft.points.push([...p, e.pressure || 0.5]);
      else if (draft.kind === 'gradient') draft = { ...draft, to: p };
      else draft = { kind: 'ellipse', cx: (start[0] + p[0]) / 2, cy: (start[1] + p[1]) / 2, rx: Math.abs(p[0] - start[0]) / 2, ry: Math.abs(p[1] - start[1]) / 2 };
      redraw();
    };
    const onUp = (): void => {
      const d = draft;
      draft = null;
      start = null;
      if (!d) return;
      const ui = maskUi.get();
      const shape: MaskShape = d.kind === 'stroke' ? { ...d, points: simplify(d.points, 0.5) } : d;
      const tiny = (shape.kind === 'ellipse' && (shape.rx < 0.5 || shape.ry < 0.5)) || (shape.kind === 'gradient' && shape.from[0] === shape.to[0] && shape.from[1] === shape.to[1]);
      if (!tiny) {
        const cur = docOf(st, ui.id);
        writeMask(st, ui.id, { ...cur, shapes: [...cur.shapes, shape] }, `Mask ${ui.id}: ${shape.kind}`);
      }
      redraw();
    };
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'range') return;
      const ui = maskUi.get();
      if (e.key === '[') maskUi.update({ radius: Math.max(1, Math.round(ui.radius / 1.25)) });
      else if (e.key === ']') maskUi.update({ radius: Math.min(200, Math.round(ui.radius * 1.25)) });
      else if (e.key === 'o') maskUi.update({ overlay: !ui.overlay });
      else if (e.key === 'b') maskUi.update({ tool: 'brush' });
    };
    size();
    redraw();
    const ro = new ResizeObserver(() => {
      size();
      redraw();
    });
    ro.observe(c);
    const subs = [st.logSignal.subscribe(redraw), st.state.subscribe(redraw), maskUi.subscribe(redraw)];
    c.addEventListener('pointerdown', onDown);
    c.addEventListener('pointermove', onMove);
    c.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      ro.disconnect();
      subs.forEach((u) => u());
      c.removeEventListener('pointerdown', onDown);
      c.removeEventListener('pointermove', onMove);
      c.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [st]);
  return <canvas ref={ref} className="mask-overlay" id="mask-overlay" aria-label="Mask editor: drag to draw" />;
}
