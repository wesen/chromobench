// Painting: the picture through the presenter (the compare split, the stage colour, repainted on a theme or gray
// change), the cover over it (a one-channel render tinted on its own canvas: the mask overlay), and the SVG overlays:
// the program's overlays, each repainted on its own state, the tool's group and the compare tags.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { svgEl } from '../h.ts';
import type { PresentImage } from '../../app/render/types.ts';
import type { Cover, ViewportParts } from './state.ts';
import type { Pointer } from './pointer.ts';

/** sRGB 0…1 → 0…255 */
const byte = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)));

/**
 * A cover's pixels as RGBA: the first channel is the coverage (clamped to 0…1). `tint`: the colour at opacity ×
 * coverage; `inverse`: at opacity × (1 − coverage); `mask`: the coverage as opaque grey.
 */
export function coverRgba(img: Pick<PresentImage, 'width' | 'height' | 'channels' | 'data'>, style: Omit<Cover, 'image'>): Uint8ClampedArray {
  const n = img.width * img.height;
  const ch = img.channels;
  const d = img.data;
  const scale = d instanceof Uint16Array ? 1 / 65535 : d instanceof Uint8ClampedArray ? 1 / 255 : 1;
  const out = new Uint8ClampedArray(n * 4);
  const [r, g, b] = (style.colour ?? [1, 0, 0]).map(byte) as [number, number, number];
  const op = Math.max(0, Math.min(1, style.opacity ?? 0.5));
  const mode = style.mode ?? 'tint';
  for (let i = 0; i < n; i++) {
    const c = Math.max(0, Math.min(1, Number(d[i * ch]) * scale));
    const o = i * 4;
    if (mode === 'mask') {
      const v = byte(c);
      out[o] = v;
      out[o + 1] = v;
      out[o + 2] = v;
      out[o + 3] = 255;
    } else {
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = byte(op * (mode === 'inverse' ? 1 - c : c));
    }
  }
  return out;
}

export function viewPaint(
  { n, m, p, rt, st, cc, ov, presenter, colours, fixedStage, themeStage, V, api }: ViewportParts,
  { toolG, paintTool }: Pick<Pointer, 'toolG' | 'paintTool'>,
) {
  // ── the cover: prepared once per render and style, placed by its region like the picture ──
  let g2: CanvasRenderingContext2D | null | undefined;
  let prepared: { img: PresentImage; style: string; src: HTMLCanvasElement | null } | null = null;
  function prepareCover(img: PresentImage, style: Omit<Cover, 'image'>): HTMLCanvasElement | null {
    if (typeof document === 'undefined' || typeof ImageData === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext?.('2d');
    if (!g) return null;
    g.putImageData(new ImageData(coverRgba(img, style) as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0);
    return c;
  }
  function paintCover(): void {
    const img = V.cover;
    const style = V.coverStyle;
    const on = !!(img && style && V.nw);
    cc.hidden = !on;
    if (g2 === undefined) {
      try {
        g2 = cc.getContext('2d');
      } catch {
        g2 = null;
      }
    }
    const g = g2;
    if (!g) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cc.width, cc.height);
    if (!on) return;
    const key = JSON.stringify(style);
    if (!prepared || prepared.img !== img || prepared.style !== key) prepared = { img: img!, style: key, src: prepareCover(img!, style!) };
    if (!prepared.src) return;
    g.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
    const r = img!.region;
    const [x, y] = api.docToScreen(r.x, r.y);
    g.imageSmoothingEnabled = V.s * V.dpr < 2.5;
    g.drawImage(prepared.src, x, y, r.w * V.s, r.h * V.s);
  }

  // ── painting (the presenter) ──
  function paint(): void {
    paintCover();
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
  /** No picture (CHB-041): the presenter lets its images go and the stage is drawn without one. */
  function blank(): void {
    V.after = null;
    V.before = null;
    presenter.clear?.();
    colours.stage = themeStage();
    presenter.draw({ docW: V.nw, docH: V.nh, cx: (V.W / 2 - V.ox) / V.s, cy: (V.H / 2 - V.oy) / V.s, zoom: V.s, dpr: V.dpr, split: null }, colours);
    paintCover();
  }
  return { paint, paintCover, paintOverlays, blank };
}
export type Paint = ReturnType<typeof viewPaint>;
