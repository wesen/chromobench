// thumb: a small picture of an engine expression for one item (a grid cell, the filmstrip, the navigator).
// src (τ) is shown at once (a file's own thumbnail); when engine (τ) says the item has edits, the engine renders
// it on the background lane and the result replaces the file thumbnail. Results are cached by (graph, values, size).
import { defineForm } from '../node.js';
import { h } from '../dom.js';

defineForm('thumb', {
  slots: { src: 'τ', image: 'β', arg: 'τ', engine: 'τ', max: 'β', fit: 'β', badge: 'τ' },
  mount(n, m) {
    const p = n.props, eng = m.app.engine;
    const el = h('div', { class: ['ck-thumb', p.fit === 'cover' && 'is-cover'] });
    const img = h('img', { class: 'ck-thumb-i', alt: '', draggable: 'false', decoding: 'async' });
    const cv = h('canvas', { class: 'ck-thumb-c' }); cv.hidden = true;
    el.append(img, cv);
    let alive = true, req = 0;
    m.scope.onDispose(() => { alive = false; });
    const show = (r) => {
      if (!r || !r.bmp || !alive) return;
      cv.width = r.w; cv.height = r.h;
      cv.getContext('2d').drawImage(r.bmp, 0, 0);
      cv.hidden = false; img.hidden = true;
    };
    m.cell(s => ({
      src: typeof p.src === 'function' ? p.src(s) : p.src,
      arg: typeof p.arg === 'function' ? p.arg(s) : p.arg,
      use: p.engine === undefined ? !!p.image : typeof p.engine === 'function' ? !!p.engine(s) : !!p.engine,
    }), v => {
      if (v.src && img.getAttribute('src') !== v.src) img.src = v.src;
      if (!v.use || !p.image) { cv.hidden = true; img.hidden = !v.src; return; }
      const values = eng.values(p.image, v.arg);
      const max = p.max || 320;
      const hit = eng.peekThumb(p.image, values, max);
      if (hit) { show(hit); return; }
      const my = ++req;
      m.app.scheduler.idle(() => {
        if (!alive || my !== req) return;
        eng.thumb(p.image, values, max).then(r => { if (my === req) show(r); });
      });
    }, { equals: (a, b) => JSON.stringify(a) === JSON.stringify(b) });
    return el;
  },
});
