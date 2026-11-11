// Shot matching (W-04 on stills): a reference photo beside the active one, scopes that overlay both, and Match.
// Scopes are drawn from the bitmaps the viewports show (the engine renders at screen size), on the idle lane.
import { ck } from '../shell/index.js';
import { h } from '../shell/ui/dom.js';
import { devOf, primaryId, merge, fmtSigned, effective } from './develop-model.js';
import { render } from './engine-graphs.js';

// the reference photo, developed with its own settings
export const referenceRender = ck.image(s => { const id = s.ui.reference; const p = id && s.catalog.photos.find(x => x.id === id); return p ? p.file : null; })
  .develop(s => effective((s.ui.reference && s.dev[s.ui.reference]) || s.devDefaults, s.ui.reference && s.catalog.photos.find(x => x.id === s.ui.reference)));

// pixels of a bitmap at a working size (cached per bitmap)
const cache = new WeakMap();
export function pixelsOf(bmp, W = 256) {
  if (!bmp) return null;
  const hit = cache.get(bmp); if (hit && hit.W === W) return hit;
  const H = Math.max(1, Math.round(W * bmp.height / bmp.width));
  const c = new OffscreenCanvas(W, H); const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, W, H);
  const out = { W, H, d: g.getImageData(0, 0, W, H).data };
  cache.set(bmp, out); return out;
}

// statistics for matching: log-average luminance, mean opponent colour (yellow–blue, magenta–green), chroma
export function stats(px) {
  let n = 0, logL = 0, by = 0, gm = 0, chroma = 0;
  const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  for (let i = 0; i < px.d.length; i += 4) {
    const r = lin(px.d[i]), g = lin(px.d[i + 1]), b = lin(px.d[i + 2]);
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (L < 0.002 || L > 0.98) continue;   // clipped pixels say nothing about the light
    logL += Math.log(L); by += Math.log((r + g) / 2 + 1e-4) - Math.log(b + 1e-4); gm += Math.log(g + 1e-4) - Math.log((r + b) / 2 + 1e-4);
    chroma += Math.hypot(r - g, g - b, b - r) / (L + 0.05); n++;
  }
  if (!n) return null;
  return { L: Math.exp(logL / n), by: by / n, gm: gm / n, chroma: chroma / n };
}

function drawScope(cv, kind, sets) {
  const g = cv.getContext('2d'); const W = cv.width, H = cv.height;
  g.fillStyle = '#0b0b0b'; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 1;
  if (kind === 'vectorscope') {
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 6;
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(cx, cy, R * 0.5, 0, Math.PI * 2); g.stroke();
    // skin tone line (about 123° on a vectorscope)
    g.strokeStyle = 'rgba(255,190,140,.45)'; g.beginPath(); g.moveTo(cx, cy); const a = -123 * Math.PI / 180 + Math.PI / 2; g.lineTo(cx + Math.cos(a) * R, cy - Math.sin(a) * R); g.stroke();
    for (const [lbl, ang] of [['R', 103], ['Y', 167], ['G', 241], ['C', 283], ['B', 347], ['M', 61]]) { const t = ang * Math.PI / 180; g.fillStyle = 'rgba(255,255,255,.35)'; g.font = '9px system-ui'; g.fillText(lbl, cx + Math.cos(t) * (R - 8) - 3, cy - Math.sin(t) * (R - 8) + 3); }
  } else {
    for (let i = 1; i < 4; i++) { const y = H * i / 4; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  }
  g.globalCompositeOperation = 'lighter';
  for (const { px, color, alpha } of sets) {
    if (!px) continue;
    const { W: pw, H: ph, d } = px;
    g.globalAlpha = alpha;
    if (kind === 'waveform' || kind === 'parade') {
      const lanes = kind === 'parade' ? 3 : 1, lw = Math.floor(W / lanes);
      const img = g.createImageData(W, H), o = img.data;
      const tint = kind === 'parade' ? [[255, 77, 77], [77, 255, 106], [77, 140, 255]] : [hexRgb(color)];
      for (let lane = 0; lane < lanes; lane++) {
        const acc = new Float32Array(lw * H);
        for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
          const i = (y * pw + x) * 4;
          const v = kind === 'parade' ? d[i + lane] : 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          const sx = Math.min(lw - 1, Math.floor(x / pw * lw)), sy = Math.round((H - 2) - v / 255 * (H - 3));
          acc[sy * lw + sx] += 1;
        }
        let mx = 0; for (let q = 0; q < acc.length; q++) if (acc[q] > mx) mx = acc[q];
        for (let y = 0; y < H; y++) for (let x = 0; x < lw; x++) {
          const v0 = acc[y * lw + x]; if (!v0) continue;
          const a = Math.min(255, 70 + Math.sqrt(v0 / Math.max(1, mx * 0.25)) * 185);
          const j = (y * W + lane * lw + x) * 4, c = tint[lane];
          o[j] = c[0]; o[j + 1] = c[1]; o[j + 2] = c[2]; o[j + 3] = a * alpha * 2;
        }
      }
      const tmp = new OffscreenCanvas(W, H); tmp.getContext('2d').putImageData(img, 0, 0);
      g.globalAlpha = 1; g.drawImage(tmp, 0, 0);
    } else {
      g.fillStyle = color;
      const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 6;
      for (let i = 0; i < d.length; i += 8) {
        const r = d[i], gg = d[i + 1], b = d[i + 2];
        const cb = (-0.1146 * r - 0.3854 * gg + 0.5 * b) / 255, cr = (0.5 * r - 0.4542 * gg - 0.0458 * b) / 255;
        g.fillRect(cx + cb * R * 1.9, cy - cr * R * 1.9, 1, 1);
      }
    }
  }
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
}

// the Scopes panel: reference in grey, the active photo in colour
const hexRgb = c => { const n = parseInt(c.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };

export function scopesPanel() {
  return ck.panel('scopes', { title: 'Scopes', open: false },
    ck.ui.segmented([{ value: 'waveform', label: 'Waveform' }, { value: 'parade', label: 'Parade' }, { value: 'vectorscope', label: 'Vectorscope' }], { bind: s => s.workspace.scope, small: true }),
    ck.html(m => {
      const cv = h('canvas', { class: 'dv-scope', width: 520, height: 300, role: 'img', 'aria-label': 'Scope' });
      const note = h('div', { class: 'dv-scope-n' });
      const el = h('div', { class: 'dv-scope-w' }, cv, note);
      const app = m.app;
      let kind = 'waveform';
      const redraw = () => app.scheduler.idle(() => {
        const main = app.viewport('main'), ref = app.viewport('ref');
        const a = main && pixelsOf(main.bitmap(), kind === 'vectorscope' ? 200 : 260), r = ref && pixelsOf(ref.bitmap(), kind === 'vectorscope' ? 200 : 260);
        drawScope(cv, kind, [{ px: r, color: '#9a9a9a', alpha: 0.35 }, { px: a, color: '#7dff9a', alpha: 0.5 }]);
        note.textContent = r ? 'Grey: reference · colour: active' : 'Set a reference photo to compare (Shift+R)';
      }, 'scope');
      m.cell(s => s.workspace.scope || 'waveform', v => { kind = v; redraw(); });
      const off = app.on('rendered', redraw); m.scope.onDispose(off);
      return el;
    }),
    ck.row(ck.ui.command('develop.setReference', { small: true, text: 'Set Reference' }), ck.ui.command('develop.match', { small: true, text: 'Match to Reference', primary: true })));
}

export function matchCommands(c) {
  c.add('develop.setReference', { module: 'develop', label: 'Set as Reference Photo', menu: 'Settings', enabled: s => !!primaryId(s), why: 'Select a photo first', run: ctx => { ctx.set({ ui: { reference: primaryId(ctx.state) } }); ctx.toast('Reference set: pick another photo and press Shift+R to compare'); } })
    .add('view.reference', { module: 'develop', label: 'Reference View', menu: 'View', icon: 'compare', enabled: s => !!s.ui.reference, why: 'Set a reference photo first (Settings ▸ Set as Reference Photo)', checked: s => s.view.compare === 'reference', run: ctx => ctx.set({ view: { compare: ctx.state.view.compare === 'reference' ? 'off' : 'reference' } }) })
    .add('develop.match', { module: 'develop', label: 'Match to Reference', menu: 'Settings', enabled: s => !!s.ui.reference && !!primaryId(s) && s.ui.reference !== primaryId(s), why: 'Set a reference photo, then select a different one to match', run: async ctx => {
      const app = ctx.app;
      // measure both on the background lane at a small size, with the active photo's settings as they are
      const st = ctx.state, id = primaryId(st);
      const [ra, rr] = await Promise.all([
        app.engine.render(render, app.engine.values(render, st), { max: 256, lane: 'bg' }),
        app.engine.render(referenceRender, app.engine.values(referenceRender, st), { max: 256, lane: 'bg' }),
      ]);
      if (!ra.bmp || !rr.bmp) { ctx.toast('Could not measure the photos', { kind: 'error' }); return; }
      const a = stats(pixelsOf(ra.bmp)), r = stats(pixelsOf(rr.bmp));
      if (!a || !r) { ctx.toast('Not enough unclipped pixels to match', { kind: 'error' }); return; }
      const d = devOf(ctx.state);
      const ev = Math.max(-2, Math.min(2, Math.log2(r.L / a.L)));
      const temp = Math.round(Math.max(2000, Math.min(50000, d.wb.temp * Math.exp((r.by - a.by) * 1.1))) / 50) * 50;
      const tint = Math.round(Math.max(-150, Math.min(150, d.wb.tint - (r.gm - a.gm) * 140)));
      const sat = Math.round(Math.max(-60, Math.min(60, (r.chroma / Math.max(1e-3, a.chroma) - 1) * 70)));
      ctx.tx('Match to Reference', t => { t.dev[id] = merge(d, { light: { exposure: +(d.light.exposure + ev).toFixed(2) }, wb: { mode: 'custom', temp, tint }, color: { saturation: Math.max(-100, Math.min(100, d.color.saturation + sat)) } }); }, { channel: id, snapPath: ['dev', id], detail: `${fmtSigned(ev, 2)} EV` });
      ctx.toast(`Matched: exposure ${fmtSigned(ev, 2)}, temp ${temp}, tint ${fmtSigned(tint)}, saturation ${fmtSigned(sat)}`);
    } });
}
