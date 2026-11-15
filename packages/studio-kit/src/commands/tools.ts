// cb.core's tools (gestures on the viewer): the densitometer, the test strip, the ring-around, the burn masks (a mask
// in the document's library and a burn layer through it).
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ToolTable } from '@chromobench/shell';
import { frameRef, isImageHandle } from '../handles.ts';
import { sel, type CbState } from '../sel.ts';
import { stripBase, stripLabel, stripMutation, stripValues, type StripVary } from '../model/tools.ts';
import { docOf, maskGesture, setDoc } from './env.ts';

export const coreTools = (): ToolTable<CbState> => ({
  'probe': {
    label: 'Densitometer',
    icon: 'eyedropper',
    key: 'I',
    cursor: 'crosshair',
    on: {
      hover: (e, ctx) => ctx.set({ ui: { probe: [Math.round(e.x), Math.round(e.y)] } }),
      down: (e, ctx) => {
        ctx.set({ ui: { probe: [Math.round(e.x), Math.round(e.y)] } });
        return false;
      },
    },
  },
  'test-strip': {
    label: 'Test Strip',
    icon: 'layers',
    key: 'T',
    cursor: 'pointer',
    image: (r, s: any) => (isImageHandle(r) && r.what === 'print' ? frameRef(r.frame, r.doc).testStrip(s.ui?.toolOptions?.['test-strip']) : r),
    // the bands' edges and values over the print (click a band to use its value)
    overlay: (g: any, vp: any, s: any) => {
      const f = sel.current(s);
      const r = f ? sel.doc(s, f) : undefined;
      const [w, h] = vp.natural();
      if (!r || !w) return;
      const o = s.ui.toolOptions['test-strip'] as { vary: StripVary; step: number; count: number };
      const vals = stripValues(o.vary, stripBase(o.vary, r), o.step, o.count);
      const doc = g.ownerDocument as Document;
      const el = (tag: string, a: Record<string, string | number>) => {
        const x = doc.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const [k, v] of Object.entries(a)) x.setAttribute(k, String(v));
        return x;
      };
      vals.forEach((v, i) => {
        const [x0, y0] = vp.toScreen(i / vals.length, 0);
        const [x1, y1] = vp.toScreen((i + 1) / vals.length, 1);
        const band = el('g', { class: `cb-band${i === (vals.length - 1) / 2 ? ' is-current' : ''}`, 'data-value': v });
        band.append(el('rect', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, class: 'cb-band-r' }));
        const t = el('text', { x: (x0 + x1) / 2, y: y1 - 8, 'text-anchor': 'middle', class: 'cb-band-t' });
        t.textContent = stripLabel(o.vary, v, r);
        band.append(t);
        g.append(band);
      });
      void h;
    },
    on: {
      down: (e, ctx) => {
        const f = sel.current(ctx.state);
        const r = f ? docOf(ctx, f) : undefined;
        if (!f || !r) return false;
        const o = ctx.state.ui.toolOptions['test-strip'] as { vary: StripVary; step: number; count: number };
        const vals = stripValues(o.vary, stripBase(o.vary, r), o.step, o.count);
        const i = Math.max(0, Math.min(vals.length - 1, Math.floor(e.u * vals.length)));
        const m = stripMutation(o.vary, r, vals[i]!);
        setDoc(ctx, f, m.path, m.value, 'Test strip band');
        ctx.set({ ui: { tool: null } });
        return false;
      },
    },
  },
  'ring-around': { label: 'Ring-around', icon: 'grid', key: 'R' },
  'mask-ellipse': {
    label: 'Burn Ellipse',
    key: 'M',
    cursor: 'crosshair',
    on: {
      down: (e, ctx) => ({ x0: e.x, y0: e.y }),
      drag: () => undefined,
      up: (e, ctx, g) => maskGesture(ctx, { kind: 'ellipse', cx: (g.x0 + e.x) / 2, cy: (g.y0 + e.y) / 2, rx: Math.max(2, Math.abs(e.x - g.x0) / 2), ry: Math.max(2, Math.abs(e.y - g.y0) / 2) }),
    },
  },
  'mask-gradient': {
    label: 'Burn Gradient',
    cursor: 'crosshair',
    on: {
      down: (e, ctx) => ({ x0: e.x, y0: e.y }),
      drag: () => undefined,
      up: (e, ctx, g) => maskGesture(ctx, { kind: 'linear', from: [g.x0, g.y0], to: [e.x, e.y] }),
    },
  },
  'mask-brush': {
    label: 'Burn Brush',
    cursor: 'crosshair',
    on: {
      down: (e, ctx) => ({ points: [[e.x, e.y, e.pressure || 1]] }),
      drag: (e, ctx, g) => void g.points.push([e.x, e.y, e.pressure || 1]),
      up: (e, ctx, g) => maskGesture(ctx, { kind: 'stroke', points: g.points, radius: ctx.state.ui.toolOptions['mask-brush']?.radius ?? 6, hardness: 0.5, mode: 'add' }),
    },
  },
});
