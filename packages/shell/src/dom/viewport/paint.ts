// Painting: the picture through the presenter (the compare split, the stage colour, repainted on a theme or gray
// change), and the SVG overlays: the program's overlays, each repainted on its own state, the tool's group and the
// compare tags.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { svgEl } from '../h.ts';
import type { ViewportParts } from './state.ts';
import type { Pointer } from './pointer.ts';

export function viewPaint(
  { n, m, p, rt, st, ov, presenter, colours, fixedStage, themeStage, V, api }: ViewportParts,
  { toolG, paintTool }: Pick<Pointer, 'toolG' | 'paintTool'>,
) {
  // ── painting (the presenter) ──
  function paint(): void {
    if (!V.after) return;
    const showBefore = V.compare === 'before' && V.before;
    presenter.setImages(showBefore ? V.before! : V.after, V.compare !== 'off' && V.compare !== 'before' ? V.before : null);
    const splitAt = V.compare === 'split' || V.compare === 'lr' || V.compare === 'tb' ? (V.ox + V.nw * V.s * V.split) / V.W : null;
    colours.stage = themeStage();
    presenter.draw({ docW: V.nw, docH: V.nh, cx: (V.W / 2 - V.ox) / V.s, cy: (V.H / 2 - V.oy) / V.s, zoom: V.s, dpr: V.dpr, split: V.before ? splitAt : null }, colours);
  }
  // a theme or interface gray change repaints the stage
  if (!fixedStage) m.cell((s: any) => `${s.prefs?.theme ?? ''}|${s.prefs?.gray ?? ''}`, () => paint());

  // ── overlays: each is { read: τ, paint(svg, api, value, state) }; repainted on their state or a view change ──
  const ovs = ((p['overlays'] as any[]) || []).map((o, i) => ({ o, g: svgEl('g', { class: 'ck-ov ck-ov-' + (o.kind || i) }), value: undefined as unknown }));
  for (const x of ovs) ov.append(x.g);
  const compareG = svgEl('g', { class: 'ck-ov-compare' });
  ov.append(toolG, compareG);
  const paintOne = (x: (typeof ovs)[number]): void => {
    x.g.replaceChildren();
    if (!V.nw) return;
    try {
      x.o.paint(x.g, api, x.value, st.readonly());
    } catch (e) {
      rt.handlerError(e, { at: n.at });
    }
  };
  function paintOverlays(): void {
    for (const x of ovs) paintOne(x);
    paintTool();
    compareG.replaceChildren();
    if (V.after && V.compare !== 'off') {
      const tag = (x: number, y: number, t: string): void => {
        const r = svgEl('g', { class: 'ck-vp-tag' });
        r.append(svgEl('rect', { x, y, width: t.length * 6.4 + 14, height: 18, rx: 3 }));
        const tx = svgEl('text', { x: x + 7, y: y + 13 });
        tx.textContent = t;
        r.append(tx);
        compareG.append(r);
      };
      if (V.compare === 'before') tag(8, 8, 'Before');
      else {
        const sx = V.ox + V.nw * V.s * V.split;
        tag(Math.max(8, sx - 64), 8, 'Before');
        tag(sx + 8, 8, 'After');
        compareG.append(svgEl('circle', { cx: sx, cy: V.oy + (V.nh * V.s) / 2, r: 7, class: 'ck-vp-splitk' }));
      }
    }
  }
  for (const x of ovs)
    if (x.o.read)
      m.cell(x.o.read, v => {
        x.value = v;
        paintOne(x);
      });
  return { paint, paintOverlays };
}
export type Paint = ReturnType<typeof viewPaint>;
