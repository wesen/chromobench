// ── thumb: a small picture; src at once, a renderable on the background lane through the thumbnail cache ──

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Rendered } from '../../app/render/types.ts';
import { h } from '../h.ts';
import type { Renderer } from '../mount.ts';
import { Canvas2DPresenter } from '../presenter-2d.ts';

export const mountThumb: Renderer = (n, m) => {
  const p = n.props as Record<string, any>;
  const el = h('div', { class: ['ck-thumb', p['fit'] === 'cover' && 'is-cover'] });
  const max: number = p['max'] || 256;
  const cv = h('canvas', { class: 'ck-thumb-c' });
  const img = h('img', { class: 'ck-thumb-i', alt: '', draggable: 'false' });
  img.hidden = true;
  const badge = h('span', { class: 'ck-thumb-badge' });
  badge.hidden = true;
  el.append(cv, img, badge);
  let live = true;
  m.scope.onDispose(() => void (live = false));
  const show = (r: Rendered): void => {
    if (!live) return;
    const pres = new Canvas2DPresenter(cv);
    cv.width = r.image.width;
    cv.height = r.image.height;
    pres.setImages(r.image, null);
    const reg = r.image.region;
    const zoom = r.image.width / (reg.w || 1);
    pres.draw({ docW: reg.w, docH: reg.h, cx: reg.x + reg.w / 2, cy: reg.y + reg.h / 2, zoom, dpr: 1, split: null }, { stage: [0, 0, 0], frame: [0, 0, 0] });
    el.dataset['rendered'] = `${r.image.width}x${r.image.height}`;
  };
  if (p['src'] !== undefined)
    m.val(p['src'], v => {
      img.hidden = !v;
      if (v) img.src = String(v);
    });
  if (p['image'] !== undefined)
    m.val(p['image'], r => {
      if (r == null) return;
      m.rt.renders.thumb(r, max, show);
    });
  if (p['badge'] !== undefined)
    m.val(p['badge'], v => {
      badge.textContent = v ? String(v) : '';
      badge.hidden = !v;
    });
  return el;
};
