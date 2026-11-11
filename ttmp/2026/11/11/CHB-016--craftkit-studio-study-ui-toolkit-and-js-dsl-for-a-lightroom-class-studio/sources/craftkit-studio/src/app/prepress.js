// Prepress: a prepress approval desk (W-05). A job is the photos of a source (a collection, the Library selection or
// the whole catalog), one page each, developed with its own settings. The engine soft-proofs the page; the module
// separates it in JS with the engine's own grey-component-replacement model (wb/ck-ops-image.js toCmyk), measures it
// (ink per plate, total area coverage, gamut, effective resolution at the print size), and the reviewer approves or
// rejects it and pins notes to it. Approvals, notes and the job's settings are document state (undoable, autosaved);
// what is shown (proof, plates, overlays, the measuring selection) is view state.
//
// Two measurements: every page of the job is measured from an engine render at its own size (up to 1536 px; the
// Preflight, Inks and Pages figures, and the report: a smaller render would average the deepest shadows away and
// understate the maximum ink); the page on screen is measured from the bitmap the viewport shows, for the overlays,
// the densitometer and the measuring selection. Both run on the idle lane and are cached (per page and settings; per
// bitmap).
import { ck } from '../shell/index.js';
import { h, icon, svgEl } from '../shell/ui/dom.js';
import { chordLabel, parseChord } from '../shell/core/keys.js';
import { esc } from '../shell/core/util.js';
import { thumb } from './engine-graphs.js';
import { isEdited, effective } from './develop-model.js';
import { selectedIds } from './catalog.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = v => clamp(+v || 0, 0, 1);
const r4 = v => Math.round(v * 1e4) / 1e4;
const key = chord => chordLabel(parseChord(chord));

// ── the job's choices ───────────────────────────────────────────────────────
// tac: the ink limit printers usually ask for on that stock (a suggestion; the job's limit is its own setting)
export const PAPERS = [
  { value: 'fogra39', label: 'Coated FOGRA39', tac: 330 },
  { value: 'fogra29', label: 'Uncoated FOGRA29', tac: 300 },
  { value: 'gracol', label: 'GRACoL 2013', tac: 320 },
  { value: 'news', label: 'Newsprint', tac: 240 },
];
export const SIZES = [
  { value: 'a4', label: 'A4 · 210 × 297 mm', short: 'A4', w: 210 / 25.4, h: 297 / 25.4 },
  { value: 'a5', label: 'A5 · 148 × 210 mm', short: 'A5', w: 148 / 25.4, h: 210 / 25.4 },
  { value: 'letter', label: 'Letter · 8.5 × 11 in', short: 'Letter', w: 8.5, h: 11 },
  { value: '5x7', label: '5 × 7 in', short: '5 × 7 in', w: 5, h: 7 },
  { value: 'custom', label: 'Custom…', short: 'custom size' },
];
export const STATUS = { open: 'Open', approved: 'Approved', rejected: 'Rejected' };
export const PLATES = [
  { key: 'c', name: 'Cyan', cmd: 'prepress.plateC' },
  { key: 'm', name: 'Magenta', cmd: 'prepress.plateM' },
  { key: 'y', name: 'Yellow', cmd: 'prepress.plateY' },
  { key: 'k', name: 'Black', cmd: 'prepress.plateK' },
];
const OVER_TOL = 1;      // % of a page over the ink limit that still passes (specks in the deepest shadows)
const GAMUT_DE = 0.04;   // OKLab distance between a colour and its proof (lightness counted a third) beyond which it is out of gamut
const GAMUT_TOL = 2;     // % of a page out of gamut that still passes
const VP = 'prepress';   // the viewport's id (its zoom and centre are its own, not Develop's)
const MEASURE_MAX = 1536; // the long side pages are measured at (never more than the photo has)

// ── state: merged into the Studio's initial state by main.js ───────────────
export const state = {
  doc: {
    // the job: its source, paper and size, and per page its status and notes ({ status, notes: [{ id, u, v, text }] })
    prepress: { source: 'collection:zine', paper: 'fogra39', tac: 300, size: 'a5', custom: { w: 200, h: 250 }, minPpi: 300, pages: {} },
  },
  ui: {
    // sel: the page list's selection (its primary is the page on screen) · marquee: the measuring selection
    // stats: per page figures (measured) · rev: bumps when the on-screen analysis is ready · selStats: the selection's figures
    // engine: true once the engine graph has compiled (see service())
    pp: { sel: { ids: [], primary: null, anchor: null }, marquee: null, lastMarquee: null, note: null, stats: {}, rev: 0, selStats: null, engine: false },
  },
  view: { pp: { proof: false, gamut: false, heat: false, plates: [true, true, true, true] } },
  toolOptions: {},
};

// ── queries (traced: they run inside cells and engine holes) ───────────────
export function jobPages(s) {
  const src = s.prepress.source || 'collection:zine', all = s.catalog.photos;
  const byId = id => all.find(p => p.id === id);
  if (src === 'selected') return selectedIds(s).map(byId).filter(Boolean);
  if (src.startsWith('collection:')) { const c = s.catalog.collections.find(x => x.id === src.slice(11)); return c ? c.ids.map(byId).filter(Boolean) : []; }
  return all;
}
export const currentPage = s => { const L = jobPages(s); const id = s.ui.pp.sel.primary; return L.find(p => p.id === id) || L[0] || null; };
const currentId = s => { const p = currentPage(s); return p ? p.id : null; };
const pageIndex = s => { const id = currentId(s); return jobPages(s).findIndex(p => p.id === id); };
const pageState = (s, id) => (id && s.prepress.pages[id]) || null;
export const statusOf = (s, id) => { const ps = pageState(s, id); return (ps && ps.status) || 'open'; };
const notesOf = (s, id) => { const ps = pageState(s, id); return (ps && ps.notes) || []; };
const paperOf = s => PAPERS.find(p => p.value === s.prepress.paper) || PAPERS[0];
const devFor = (s, p) => s.dev[p.id] || s.devDefaults;
const sourceName = s => { const src = s.prepress.source; if (src === 'selected') return 'Selected photos'; if (src === 'all') return 'All photographs'; const c = s.catalog.collections.find(x => 'collection:' + x.id === src); return c ? c.name : 'Missing collection'; };
function sourceOptions(s) {
  return [{ value: 'selected', label: `Selected photos (${selectedIds(s).length})` }]
    .concat(s.catalog.collections.map(c => ({ value: 'collection:' + c.id, label: `${c.name} (${c.ids.length})` })))
    .concat([{ value: 'all', label: `All photographs (${s.catalog.photos.length})` }]);
}

// ── print geometry: the photo (as cropped) fitted inside the page, turned to match ──
export function pixelsOf(s, p) { const r = devFor(s, p).crop.geometry.rect; return [Math.max(1, Math.round((r.x1 - r.x0) * p.w)), Math.max(1, Math.round((r.y1 - r.y0) * p.h))]; }
function sizeOf(s) { const z = SIZES.find(x => x.value === s.prepress.size) || SIZES[1]; if (z.value === 'custom') { const c = s.prepress.custom; return { w: c.w / 25.4, h: c.h / 25.4, short: `${Math.round(c.w)} × ${Math.round(c.h)} mm` }; } return z; }
export function printOf(s, p) {
  const [pw, ph] = pixelsOf(s, p), z = sizeOf(s);
  let W = z.w, H = z.h;
  if ((pw >= ph) !== (W >= H)) [W, H] = [H, W];
  const k = Math.min(W / pw, H / ph);          // inches per pixel
  return { pw, ph, ppi: 1 / k, w: pw * k, h: ph * k, size: z.short };
}
const fmtIn = v => (v >= 10 ? v.toFixed(0) : v.toFixed(1));
const fmtPct = v => (v > 0 && v < 0.1 ? '<0.1 %' : `${v.toFixed(v < 10 ? 1 : 0)} %`);

// ── the engine graphs: the page as developed, and its soft proof (the engine's op; the profile is a hole) ──
const pageFile = s => { const p = currentPage(s); return p ? p.file : null; };
const pageDev = s => { const p = currentPage(s); return p ? devFor(s, p) : s.devDefaults; };
export const pageRender = ck.image(pageFile).develop(s => effective(pageDev(s), currentPage(s)));
export const pageProof = pageRender.softProof(s => paperOf(s).label);

// ── separations: the engine's model, in JS ──────────────────────────────────
// toCmyk: c = 1 − r … , k = min(c, m, y) × 0.8, c′ = (c − k) / (1 − k); cmykPreview: the engine's coated-paper simulation
const GCR = 0.8;
const INKS = [[0, 0.63, 0.89], [0.93, 0, 0.55], [1, 0.94, 0]];
function sep(r, g, b, o) { const c = 1 - r, m = 1 - g, y = 1 - b; const k = Math.min(c, m, y) * GCR; const d = 1 - k || 1; o[0] = (c - k) / d; o[1] = (m - k) / d; o[2] = (y - k) / d; o[3] = k; return o; }
function proof(C, M, Y, K, o) {
  let r = 0.97, g = 0.96, b = 0.93;
  const ink = (t, a) => { r *= 1 - a * (1 - t[0]); g *= 1 - a * (1 - t[1]); b *= 1 - a * (1 - t[2]); };
  ink(INKS[0], C); ink(INKS[1], M); ink(INKS[2], Y);
  const kk = 1 - K * 0.92; o[0] = r * kk; o[1] = g * kk; o[2] = b * kk; return o;
}
// out of gamut: the proof moves the colour further than GAMUT_DE in OKLab, lightness counted a third (paper white and
// maximum density darken every colour a little: that is tone, not gamut). Cached per colour at 6 bits a channel.
const LIN = new Float32Array(4097);
for (let i = 0; i <= 4096; i++) { const v = i / 4096; LIN[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
function oklab(r, g, b, o) {
  r = LIN[Math.round(clamp01(r) * 4096)]; g = LIN[Math.round(clamp01(g) * 4096)]; b = LIN[Math.round(clamp01(b) * 4096)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  o[0] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s; o[1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s; o[2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s; return o;
}
const GAMUT = new Uint8Array(1 << 18);   // 0 not yet known · 1 in gamut · 2 out
const T4 = [0, 0, 0, 0], P3 = [0, 0, 0], A3 = [0, 0, 0], B3 = [0, 0, 0];
function outOfGamut(R, G, B) {
  const q = ((R >> 2) << 12) | ((G >> 2) << 6) | (B >> 2);
  let v = GAMUT[q];
  if (!v) {
    const r = ((R >> 2) * 4 + 2) / 255, g = ((G >> 2) * 4 + 2) / 255, b = ((B >> 2) * 4 + 2) / 255;
    sep(r, g, b, T4); proof(T4[0], T4[1], T4[2], T4[3], P3); oklab(r, g, b, A3); oklab(P3[0], P3[1], P3[2], B3);
    v = GAMUT[q] = Math.hypot((A3[0] - B3[0]) / 3, A3[1] - B3[1], A3[2] - B3[2]) > GAMUT_DE ? 2 : 1;
  }
  return v === 2;
}
// the total ink read through a 3 × 3 px aperture, like the densitometer (clipped at the edges): out[j] gets the reading
// at each pixel, the result is the highest. Every total-ink figure (the maximum, the share over the limit, the heatmap,
// a selection's figures) is this reading, so that a speck or a scanner's dark edge row does not decide a check that is
// about areas of ink, and the figures agree with what the densitometer shows.
function aperture(t, W, H, out) {
  const rs = new Float32Array(W * H), rc = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0, o = y * W; x < W; x++) { let v = t[o + x], c = 1; if (x > 0) { v += t[o + x - 1]; c++; } if (x < W - 1) { v += t[o + x + 1]; c++; } rs[o + x] = v; rc[o + x] = c; }
  let max = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const j = y * W + x; let v = rs[j], c = rc[j];
    if (y > 0) { v += rs[j - W]; c += rc[j - W]; } if (y < H - 1) { v += rs[j + W]; c += rc[j + W]; }
    v /= c; if (out) out[j] = v; if (v > max) max = v;
  }
  return max;
}
// a page's figures: mean ink per plate, total area coverage (mean; the aperture's maximum and a 5 % histogram of its
// readings), share out of gamut
export function analysePage(d, W, H) {
  const n = W * H, hist = new Array(81).fill(0), tac = new Float32Array(n), t3 = new Float32Array(n); let c = 0, m = 0, y = 0, k = 0, sum = 0, oog = 0;
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    sep(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, T4);
    c += T4[0]; m += T4[1]; y += T4[2]; k += T4[3];
    const t = (T4[0] + T4[1] + T4[2] + T4[3]) * 100; sum += t; tac[j] = t;
    if (outOfGamut(d[i], d[i + 1], d[i + 2])) oog++;
  }
  const max = aperture(tac, W, H, t3);
  for (let j = 0; j < n; j++) hist[Math.min(80, Math.floor(t3[j] / 5))]++;
  return { n, cov: [c / n * 100, m / n * 100, y / n * 100, k / n * 100], tac: sum / n, max, hist, oog: oog / n * 100 };
}
const overShare = (st, lim) => { let o = 0; for (let b = Math.ceil(lim / 5); b < st.hist.length; b++) o += st.hist[b]; return o / st.n * 100; };
// the page on screen, per pixel: ink per plate (0–255), total ink (tenths of a %: tac per pixel, tac3 through the
// aperture), out of gamut
function analyseView(d, W, H) {
  const n = W * H, cmyk = new Uint8Array(n * 4), tac = new Uint16Array(n), oog = new Uint8Array(n);
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    sep(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, T4);
    cmyk[i] = T4[0] * 255 + 0.5; cmyk[i + 1] = T4[1] * 255 + 0.5; cmyk[i + 2] = T4[2] * 255 + 0.5; cmyk[i + 3] = T4[3] * 255 + 0.5;
    tac[j] = Math.round((T4[0] + T4[1] + T4[2] + T4[3]) * 1000);
    oog[j] = outOfGamut(d[i], d[i + 1], d[i + 2]) ? 1 : 0;
  }
  const tac3 = new Uint16Array(n); aperture(tac, W, H, tac3);
  return { W, H, cmyk, tac, tac3, oog, layers: new Map() };
}
function pixelsFrom(bmp) {
  const W = bmp.width, H = bmp.height, c = new OffscreenCanvas(W, H), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  return { W, H, d: g.getImageData(0, 0, W, H).data };
}

// ── page figures for the whole job (an engine render per page and settings, on the background lane) ──
let APP = null;
const DEV_IDS = new WeakMap(); let devSeq = 0;
const devId = d => { let v = DEV_IDS.get(d); if (!v) { v = ++devSeq; DEV_IDS.set(d, v); } return v; };
const sigOf = (p, dev) => `${p.file}#${devId(dev)}`;
const STATS = new Map();   // sig → Promise<figures>
// the graph compiles at mount; engine.values() is empty until then
function engineUp(app) {
  if (app.engine.graph) return Promise.resolve();
  if (app.engineReady) return app.engineReady;
  return new Promise(res => { const off = app.engine.on(k => { if (k === 'compiled') { off(); res(); } }); });
}
function statsFor(app, p, dev) {
  const sig = sigOf(p, dev);
  if (!STATS.has(sig)) {
    const job = (async () => {
      await engineUp(app);   // values need the compiled graph
      const r = await app.engine.render(thumb, app.engine.values(thumb, { file: p.file, dev, w: p.w, h: p.h }), { max: Math.min(MEASURE_MAX, Math.max(p.w, p.h)), lane: 'bg' });
      if (!r || !r.bmp) throw new Error((r && r.error) || 'the engine sent no pixels');
      const px = pixelsFrom(r.bmp); if (r.bmp.close) r.bmp.close();
      return Object.assign(analysePage(px.d, px.W, px.H), { sig, w: px.W, h: px.H });
    })();
    job.catch(() => STATS.delete(sig));
    STATS.set(sig, job);
    if (STATS.size > 120) STATS.delete(STATS.keys().next().value);
  }
  return STATS.get(sig);
}
// one page at a time, the page on screen first (the engine's background lane is first come, first served)
const WAITING = new Map(); let measuring = false;
function measurePage(app, p) { WAITING.set(p.id, p); pump(app); }
async function pump(app) {
  if (measuring) return; measuring = true;
  try {
    while (WAITING.size) {
      const cur = currentId(app.store.current), id = WAITING.has(cur) ? cur : WAITING.keys().next().value, p = WAITING.get(id);
      WAITING.delete(id);
      const s = app.store.current, dev = devFor(s, p), sig = sigOf(p, dev), have = s.ui.pp.stats[p.id];
      if ((have && have.sig === sig) || !jobPages(s).some(x => x.id === p.id)) continue;
      try {
        const st = await statsFor(app, p, dev);
        if (sigOf(p, devFor(app.store.current, p)) === sig) app.store.set(['ui', 'pp', 'stats', p.id], st);
      } catch (e) { console.warn('[prepress] could not measure', p.id, e); }
    }
  } finally { measuring = false; }
}

// ── the page on screen, measured from the bitmap the viewport shows ─────────
let VIEW = null, viewRev = 0;
function liveView() {
  if (!APP || !VIEW) return null;
  const s = APP.store.current, p = currentPage(s);
  return p && VIEW.pageId === p.id && VIEW.file === p.file && VIEW.dev === devFor(s, p) ? VIEW : null;
}
function onViewRender(r, vp, ctx) {
  const bmp = vp.bitmap(), k = vp.view.key, app = ctx.app;
  app.scheduler.idle(() => { analyseOnScreen(app, vp, bmp, k).catch(e => console.warn('[prepress] analysis failed', e)); }, 'pp-view');
}
async function analyseOnScreen(app, vp, bmp, k) {
  if (!bmp || vp.bitmap() !== bmp) return;                 // a newer render replaced it (and queued its own job)
  const s = app.store.current, p = currentPage(s); if (!p) return;
  const dev = devFor(s, p), long = Math.max(bmp.width, bmp.height);
  if (VIEW && VIEW.pageId === p.id && VIEW.file === p.file && VIEW.dev === dev && Math.max(VIEW.W, VIEW.H) >= long) return;   // keep the larger
  const vals = app.engine.values(pageRender, s);
  let px;
  if (k.startsWith(String(pageRender) + JSON.stringify(vals) + '|')) px = pixelsFrom(bmp);   // RGB on screen: measure it
  else if (k.startsWith(String(pageProof) + JSON.stringify(app.engine.values(pageProof, s)) + '|')) {
    // the proof is on screen: separations come from the RGB page, rendered once at the same size on the background lane
    const r = await app.engine.render(pageRender, vals, { max: long, lane: 'bg' });
    if (!r.bmp) return;
    px = pixelsFrom(r.bmp); if (r.bmp.close) r.bmp.close();
    const now = app.store.current, q = currentPage(now);
    if (!q || q.id !== p.id || devFor(now, q) !== dev) return;
  } else return;                                             // a render of a state we have left
  VIEW = Object.assign(analyseView(px.d, px.W, px.H), { pageId: p.id, file: p.file, dev });
  app.store.set(['ui', 'pp', 'rev'], ++viewRev);
}
// the densitometer: a 3 × 3 neighbourhood of the cached separation
function readAt(V, u, v) {
  const x = clamp(Math.floor(u * V.W), 0, V.W - 1), y = clamp(Math.floor(v * V.H), 0, V.H - 1);
  const o = [0, 0, 0, 0]; let n = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= V.W || yy >= V.H) continue;
    const i = (yy * V.W + xx) * 4; o[0] += V.cmyk[i]; o[1] += V.cmyk[i + 1]; o[2] += V.cmyk[i + 2]; o[3] += V.cmyk[i + 3]; n++;
  }
  const c = o.map(t => Math.round(t / n / 2.55));
  return { c, tac: c[0] + c[1] + c[2] + c[3] };
}

// ── overlay layers: canvases made once per analysis (and per plate set / ink limit), placed over the photo ──
function canvasOf(V, fill) {
  const c = document.createElement('canvas'); c.width = V.W; c.height = V.H;
  const g = c.getContext('2d'); const id = g.createImageData(V.W, V.H); fill(id.data, V.W * V.H); g.putImageData(id, 0, 0);
  return c;
}
function layer(V, k, make) { let c = V.layers.get(k); if (!c) { c = make(); V.layers.set(k, c); } return c; }
function platesLayer(V, on) {
  return layer(V, 'plates:' + on.join(''), () => canvasOf(V, (o, n) => {
    const cm = V.cmyk, solo = on.filter(Boolean).length === 1 ? on.indexOf(true) : -1, P = [0, 0, 0];
    for (let j = 0, i = 0; j < n; j++, i += 4) {
      if (solo >= 0) { const v = 255 - cm[i + solo]; o[i] = o[i + 1] = o[i + 2] = v; }     // one plate: its ink as grey
      else { proof(on[0] ? cm[i] / 255 : 0, on[1] ? cm[i + 1] / 255 : 0, on[2] ? cm[i + 2] / 255 : 0, on[3] ? cm[i + 3] / 255 : 0, P); o[i] = P[0] * 255; o[i + 1] = P[1] * 255; o[i + 2] = P[2] * 255; }
      o[i + 3] = 255;
    }
  }));
}
function gamutLayer(V) {
  return layer(V, 'gamut', () => canvasOf(V, (o, n) => { for (let j = 0, i = 0; j < n; j++, i += 4) if (V.oog[j]) { o[i] = o[i + 1] = o[i + 2] = 128; o[i + 3] = 255; } }));
}
// the heatmap: under the limit dims the photo, the last 40 % below it warms to magenta, over it glows
function heatLayers(V, limit) {
  const k = 'heat:' + limit;
  if (!V.layers.has(k)) for (const x of [...V.layers.keys()]) if (x.startsWith('heat:')) V.layers.delete(x);
  return layer(V, k, () => {
    const lim = limit * 10, lo = (limit - 40) * 10, tac = V.tac3;
    const dim = canvasOf(V, (o, n) => {
      for (let j = 0, i = 0; j < n; j++, i += 4) {
        const t = tac[j]; if (t > lim) continue;
        if (t <= lo) { o[i + 3] = 115; continue; }
        const f = (t - lo) / (lim - lo); o[i] = 110 + 145 * f; o[i + 1] = 0; o[i + 2] = 150 + 50 * f; o[i + 3] = 110 + 60 * f;
      }
    });
    const over = canvasOf(V, (o, n) => { for (let j = 0, i = 0; j < n; j++, i += 4) if (tac[j] > lim) { o[i] = 255; o[i + 1] = 30; o[i + 2] = 220; o[i + 3] = 255; } });
    return { dim, over };
  });
}
// a canvas over the shown image, in the overlay's SVG (a foreignObject: no encoding, the canvas is reused as is)
function place(g, vp, canvas, cls) {
  const [x0, y0] = vp.toScreen(0, 0), [x1, y1] = vp.toScreen(1, 1);
  const fo = svgEl('foreignObject', { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0), class: 'pp-fo' });
  canvas.className = 'pp-layer' + (cls ? ' ' + cls : '');
  canvas.style.imageRendering = (x1 - x0) / canvas.width > 2.5 ? 'pixelated' : 'auto';
  fo.append(canvas); g.append(fo);
}
const analysisOverlay = ck.overlay.custom('pp-analysis',
  s => ({ rev: s.ui.pp.rev, id: currentId(s), plates: s.view.pp.plates.map(Boolean), heat: !!s.view.pp.heat, gamut: !!s.view.pp.gamut, tac: s.prepress.tac }),
  (g, vp, v) => {
    const V = liveView(); if (!V || !v) return;
    if (v.plates.some(x => !x)) place(g, vp, platesLayer(V, v.plates));
    if (v.gamut) place(g, vp, gamutLayer(V));
    if (v.heat) { const L = heatLayers(V, v.tac); place(g, vp, L.dim); place(g, vp, L.over, 'is-glow'); }
  });

// ── the measuring selection: rectangles, ellipses and lassos in image u, v; Shift adds, Alt subtracts ──
function shapePath(sh, P) {
  if (sh.kind === 'lasso') return 'M' + sh.pts.map(q => P(q[0], q[1]).map(n => n.toFixed(1)).join(' ')).join('L') + 'Z';
  const [x0, y0] = P(sh.x0, sh.y0), [x1, y1] = P(sh.x1, sh.y1);
  if (sh.kind === 'rect') return `M${x0} ${y0}H${x1}V${y1}H${x0}Z`;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
  return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
}
// marching ants along the outline of (adds − subtracts): each outline is masked by the other shapes
let maskSeq = 0;
function drawAnts(g, vp, shapes, live) {
  const P = (u, v) => vp.toScreen(u, v), ds = shapes.map(sh => shapePath(sh, P));
  const defs = svgEl('defs', {}); g.append(defs);
  const all = 'M-100000 -100000H100000V100000H-100000Z';
  shapes.forEach((sh, i) => {
    let mid = null;
    if (shapes.length > 1) {
      mid = 'pp-ants-m' + (++maskSeq);
      const mask = svgEl('mask', { id: mid, maskUnits: 'userSpaceOnUse', x: -100000, y: -100000, width: 200000, height: 200000 });
      const sub = sh.op === 'sub';
      mask.append(svgEl('path', { d: all, fill: sub ? '#000' : '#fff' }));
      shapes.forEach((o, j) => { if (j !== i && sub && o.op !== 'sub') mask.append(svgEl('path', { d: ds[j], fill: '#fff' })); });
      shapes.forEach((o, j) => { if (j !== i && (!sub || o.op === 'sub')) mask.append(svgEl('path', { d: ds[j], fill: '#000' })); });
      defs.append(mask);
    }
    const grp = svgEl('g', { class: 'pp-ants' + (live ? ' is-live' : ''), mask: mid ? `url(#${mid})` : null });
    grp.append(svgEl('path', { d: ds[i], class: 'pp-ants-w' }), svgEl('path', { d: ds[i], class: 'pp-ants-b' }));
    g.append(grp);
  });
}
const selectionOverlay = ck.overlay.custom('pp-marquee', s => { const m = s.ui.pp.marquee; return m && m.page === currentId(s) ? m : null; }, (g, vp, m) => { if (m && m.shapes.length) drawAnts(g, vp, m.shapes, false); });
function rasterize(shapes, W, H) {
  const c = new OffscreenCanvas(W, H), g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff';
  for (const sh of shapes) { g.globalCompositeOperation = sh.op === 'sub' ? 'destination-out' : 'source-over'; g.fill(new Path2D(shapePath(sh, (u, v) => [u * W, v * H]))); }
  return g.getImageData(0, 0, W, H).data;
}
function measureSelection(app) {
  const s = app.store.current, p = currentPage(s), m = s.ui.pp.marquee, V = liveView();
  if (!p || !m || m.page !== p.id || !V) { if (s.ui.pp.selStats) app.store.set(['ui', 'pp', 'selStats'], null); return; }
  const mask = rasterize(m.shapes, V.W, V.H), lim = s.prepress.tac * 10;
  let n = 0, c = 0, mm = 0, y = 0, k = 0, sum = 0, max = 0, over = 0;
  for (let j = 0, i = 0; j < V.W * V.H; j++, i += 4) {
    if (mask[i + 3] < 128) continue;
    n++; c += V.cmyk[i]; mm += V.cmyk[i + 1]; y += V.cmyk[i + 2]; k += V.cmyk[i + 3];
    const t = V.tac3[j]; sum += V.tac[j]; if (t > lim) over++; if (t > max) max = t;
  }
  app.store.set(['ui', 'pp', 'selStats'], n ? { page: p.id, n, area: n / (V.W * V.H) * 100, cmyk: [c, mm, y, k].map(x => x / n / 2.55), tac: sum / n / 10, max: max / 10, over: over / n * 100, limit: s.prepress.tac } : { page: p.id, n: 0 });
}
const shapeTool = kind => ({
  down: (e, ctx) => {
    const p = currentPage(ctx.state); if (!p) return false;
    const u = clamp01(e.u), v = clamp01(e.v);
    return { kind, op: e.alt ? 'sub' : e.shift ? 'add' : 'new', page: p.id, x0: u, y0: v, x1: u, y1: v, pts: [[u, v]], sx: e.sx, sy: e.sy, moved: false };
  },
  drag: (e, ctx, g) => {
    const u = clamp01(e.u), v = clamp01(e.v), moved = g.moved || Math.hypot(e.sx - g.sx, e.sy - g.sy) > 3;
    if (kind !== 'lasso') return Object.assign({}, g, { moved, x1: u, y1: v });
    const last = g.pts[g.pts.length - 1], [lx, ly] = ctx.vp.toScreen(last[0], last[1]);
    return Object.assign({}, g, { moved, pts: Math.hypot(e.sx - lx, e.sy - ly) < 2 ? g.pts : g.pts.concat([[u, v]]) });
  },
  // the shape lives in the gesture's state while it is drawn (a store preview would drop the photo to its proxy
  // size); the finished selection is view state, so it is set, not committed: no preview is ever left open
  up: (e, ctx, g) => finishShape(ctx, g),
});
function finishShape(ctx, g) {
  const cur = ctx.state.ui.pp.marquee, same = cur && cur.page === g.page;
  const shape = g.kind === 'lasso'
    ? { kind: 'lasso', op: g.op === 'sub' ? 'sub' : 'add', pts: g.pts.map(q => [r4(q[0]), r4(q[1])]) }
    : { kind: g.kind, op: g.op === 'sub' ? 'sub' : 'add', x0: r4(Math.min(g.x0, g.x1)), y0: r4(Math.min(g.y0, g.y1)), x1: r4(Math.max(g.x0, g.x1)), y1: r4(Math.max(g.y0, g.y1)) };
  const tiny = !g.moved || (g.kind === 'lasso' ? g.pts.length < 3 : shape.x1 - shape.x0 < 1e-3 || shape.y1 - shape.y0 < 1e-3);
  if (tiny) { if (g.op === 'new' && same) ctx.run('prepress.deselect'); return; }   // a click deselects (Photoshop)
  const base = g.op !== 'new' && same ? cur.shapes : [];
  if (g.op === 'sub' && !base.length) return;                                       // nothing to subtract from
  ctx.set({ ui: { pp: { marquee: { page: g.page, shapes: base.concat([shape]).slice(-16) } } } });
}

// ── notes: pins on the page, numbered ─────────────────────────────────────
let noteSeq = 0;
function focusNote(app, id) {
  app.store.set(['workspace', 'panels', 'pp-notes', 'open'], true);
  const go = tries => { const i = app.root.querySelector(`.pp-note[data-id="${id}"] input`); if (i && i.offsetParent) { i.focus(); i.select(); } else if (tries) setTimeout(() => go(tries - 1), 60); };
  requestAnimationFrame(() => go(8));
}
const notesOverlay = ck.overlay.custom('pp-notes', s => ({ notes: notesOf(s, currentId(s)), sel: s.ui.pp.note }), (g, vp, v) => {
  if (!v) return;
  v.notes.forEach((n, i) => {
    const [x, y] = vp.toScreen(n.u, n.v);
    const pin = svgEl('g', { class: 'pp-pin' + (n.id === v.sel ? ' is-sel' : ''), transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})`, 'data-note': n.id });
    pin.append(svgEl('path', { d: 'M0 0L-5 -9A8 8 0 1 1 5 -9Z' }));
    const t = svgEl('text', { x: 0, y: -12.5, 'text-anchor': 'middle' }); t.textContent = String(i + 1); pin.append(t);
    const tip = svgEl('title', {}); tip.textContent = `${i + 1}. ${n.text || 'Empty note'}`; pin.append(tip);
    pin.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); if (APP) { APP.store.set(['ui', 'pp', 'note'], n.id); focusNote(APP, n.id); } });
    g.append(pin);
  });
});

// ── preflight ───────────────────────────────────────────────────────────────
// each check: { id, title, state: ok | fail | wait | info, reason, fix } — fix: what clicking a failing check shows
export function checksFor(s, p) {
  const st = s.ui.pp.stats[p.id], lim = s.prepress.tac, min = s.prepress.minPpi, pr = printOf(s, p), paper = paperOf(s);
  const out = [];
  const ppiOk = pr.ppi >= min - 0.5;
  out.push({ id: 'ppi', title: 'Resolution', state: ppiOk ? 'ok' : 'fail', fix: ppiOk ? null : 'size',
    reason: ppiOk ? `${Math.round(pr.ppi)} ppi at ${pr.size} (${fmtIn(pr.w)} × ${fmtIn(pr.h)} in); minimum ${min}` : `${Math.round(pr.ppi)} ppi at ${pr.size}, under ${min}: prints ${fmtIn(pr.pw / min)} × ${fmtIn(pr.ph / min)} in at most` });
  if (!st) for (const [id, title] of [['tac', 'Total ink'], ['over', 'Area over the limit'], ['gamut', 'Gamut']]) out.push({ id, title, state: 'wait', reason: 'Measuring…', fix: null });
  else {
    const maxOk = st.max <= lim + 0.05, over = overShare(st, lim), overOk = over <= OVER_TOL, gOk = st.oog <= GAMUT_TOL;
    out.push({ id: 'tac', title: 'Total ink', state: maxOk ? 'ok' : 'fail', fix: maxOk ? null : 'heat', reason: `max ${Math.round(st.max)} % (3 × 3 px reading), ${maxOk ? 'within' : 'over'} the ${lim} % limit` });
    out.push({ id: 'over', title: 'Area over the limit', state: overOk ? 'ok' : 'fail', fix: overOk ? null : 'heat', reason: `${fmtPct(over)} of the page reads over ${lim} % (${OVER_TOL} % allowed)` });
    out.push({ id: 'gamut', title: 'Gamut', state: gOk ? 'ok' : 'fail', fix: gOk ? null : 'gamut', reason: `${fmtPct(st.oog)} of the page out of gamut (${GAMUT_TOL} % allowed)` });
  }
  out.push({ id: 'mode', title: 'Colour', state: 'info', fix: null, reason: `RGB, separated for ${paper.label} with a GCR model; no ICC profile in this build` });
  return out;
}
const failuresOf = (s, p) => checksFor(s, p).filter(c => c.state === 'fail').length;
const passes = (s, p) => checksFor(s, p).every(c => c.state === 'ok' || c.state === 'info');
const FIX = { size: 'Click: view at print size', heat: 'Click: show the ink heatmap', gamut: 'Click: show the gamut warning' };

// ── actions ─────────────────────────────────────────────────────────────────
const targets = s => { const L = jobPages(s), ids = s.ui.pp.sel.ids.filter(id => L.some(p => p.id === id)); const cur = currentId(s); return ids.length > 1 && ids.includes(cur) ? ids : cur ? [cur] : []; };
function setStatus(ctx, status) {
  const s = ctx.state, ids = targets(s); if (!ids.length) return;
  const p = currentPage(s), verb = { approved: 'Approve', rejected: 'Reject', open: 'Reopen' }[status];
  const label = ids.length > 1 ? `${verb} ${ids.length} Pages` : `${verb} Page ${pageIndex(s) + 1}`;
  ctx.tx(label, t => { for (const id of ids) { const cur = s.prepress.pages[id]; t.prepress.pages[id] = Object.assign({ notes: [] }, cur || {}, { status }); } }, { detail: ids.length > 1 ? undefined : p.title });
  ctx.flash(ids.length > 1 ? `${STATUS[status]} · ${ids.length} pages` : STATUS[status], status === 'approved' ? 'pick' : status === 'rejected' ? 'reject' : 'info');
  if (ids.length === 1 && status !== 'open' && s.prefs.autoAdvance) step(ctx, 1);
}
function step(ctx, d) {
  const L = jobPages(ctx.state); if (!L.length) return;
  const i = clamp(pageIndex(ctx.state) + d, 0, L.length - 1), id = L[i].id;
  if (id === currentId(ctx.state) && ctx.state.ui.pp.sel.ids.length <= 1) return;
  ctx.set({ ui: { pp: { sel: { ids: [id], primary: id, anchor: id } } } });
}
function toggleView(ctx, k) { ctx.set({ view: { pp: { [k]: !ctx.state.view.pp[k] } } }); }
function showOverlay(ctx, k) {
  if (k === 'size') { ctx.run('prepress.printSize'); return; }
  ctx.set({ view: { pp: { [k]: true } } });
}
function setPlates(ctx, on) { ctx.set({ view: { pp: { plates: on } } }); }
function plateClick(ctx, k) {
  const cur = ctx.state.view.pp.plates.map(Boolean);
  if (ctx.mods.alt) { const solo = cur.filter(Boolean).length === 1 && cur[k]; setPlates(ctx, solo ? [true, true, true, true] : cur.map((x, i) => i === k)); return; }   // Alt-click solos
  setPlates(ctx, cur.map((x, i) => (i === k ? !x : x)));
}
function addNote(ctx) {
  const s = ctx.state, p = currentPage(s); if (!p) return;
  const pt = ctx.app.pointer; let u = 0.5, v = 0.5;
  if (pt && pt.viewport === VP && pt.inside) { u = pt.u; v = pt.v; } else ctx.toast(`Point at the page and press ${key('N')} to pin a note there; this one went in the middle`);
  const id = 'n' + Date.now().toString(36) + (++noteSeq);
  ctx.tx('Add Note', t => { const cur = s.prepress.pages[p.id]; t.prepress.pages[p.id] = Object.assign({ status: 'open' }, cur || {}, { notes: notesOf(s, p.id).concat([{ id, u: r4(u), v: r4(v), text: '' }]) }); }, { detail: p.title });
  ctx.set({ ui: { pp: { note: id } } });
  focusNote(ctx.app, id);
}
function deleteNote(ctx, id) {
  const s = ctx.state, pid = currentId(s); if (!pid) return;
  ctx.tx('Delete Note', t => { t.prepress.pages[pid].notes = notesOf(s, pid).filter(n => n.id !== id); });
  if (s.ui.pp.note === id) ctx.set({ ui: { pp: { note: null } } });
}
function printSize(ctx) {
  const s = ctx.state, p = currentPage(s), vp = ctx.app.viewport(VP); if (!p || !vp) return;
  const pr = printOf(s, p), [nw] = vp.natural(); if (!nw) return;
  vp.setZoom(clamp(pr.w * 96 / nw, 1 / 16, 11));   // CSS pixels are 1/96 in
  ctx.toast(`Print size: ${fmtIn(pr.w)} × ${fmtIn(pr.h)} in at ${Math.round(pr.ppi)} ppi (on a 96 ppi screen)`);
}

// the approval report: a self-contained HTML page
async function report(ctx) {
  const app = ctx.app, s = app.store.current, pages = jobPages(s); if (!pages.length) return;
  if (pages.some(p => !(s.ui.pp.stats[p.id] && s.ui.pp.stats[p.id].sig === sigOf(p, devFor(s, p))))) ctx.toast(`Measuring ${pages.length} pages…`);
  const figs = await Promise.all(pages.map(p => statsFor(app, p, devFor(s, p)).catch(() => null)));
  const st = Object.assign({}, s, { ui: Object.assign({}, s.ui, { pp: Object.assign({}, s.ui.pp, { stats: Object.fromEntries(pages.map((p, i) => [p.id, figs[i]]).filter(x => x[1])) }) }) });
  const date = new Date().toISOString().slice(0, 10), paper = paperOf(s), size = sizeOf(s);
  const count = k => pages.filter(p => statusOf(s, p.id) === k).length;
  const rows = pages.map((p, i) => {
    const checks = checksFor(st, p), ps = statusOf(s, p.id), notes = notesOf(s, p.id), pr = printOf(s, p), f = figs[i];
    return `<section class="page is-${ps}"><h2><span>${i + 1}</span> ${esc(p.title)} <em>${STATUS[ps]}</em></h2>
<p class="meta">${esc(p.name)} · ${pr.pw} × ${pr.ph} px · ${Math.round(pr.ppi)} ppi at ${esc(pr.size)}${f ? ` · mean ink ${f.cov.map(Math.round).join(' / ')} % (C / M / Y / K), ${Math.round(f.tac)} % in all` : ''}</p>
<ul class="checks">${checks.map(c => `<li class="${c.state}"><b>${c.state === 'ok' ? '✓' : c.state === 'fail' ? '✕' : c.state === 'info' ? 'i' : '…'}</b> ${esc(c.title)}: ${esc(c.reason)}</li>`).join('')}</ul>
${notes.length ? `<ol class="notes">${notes.map(n => `<li>${esc(n.text || '(empty note)')} <small>at ${Math.round(n.u * 100)} % across, ${Math.round(n.v * 100)} % down</small></li>`).join('')}</ol>` : '<p class="none">No notes</p>'}</section>`;
  }).join('\n');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Approval report · ${esc(sourceName(s))}</title>
<style>body{font:14px/1.45 system-ui,sans-serif;margin:24px auto;max-width:820px;padding:0 16px;color:#1d1d1d;background:#fff}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:0 0 4px}h2 span{color:#888;margin-right:4px}h2 em{font-style:normal;font-size:12px;border:1px solid #bbb;border-radius:9px;padding:1px 8px;margin-left:6px;vertical-align:2px}.is-approved h2 em{background:#dff3e4;border-color:#2d9d48}.is-rejected h2 em{background:#fbe1e2;border-color:#d7373f}.job,.meta,.none,small{color:#666}section{border-top:1px solid #ddd;padding:12px 0}ul,ol{margin:6px 0;padding-left:22px}.checks{list-style:none;padding:0}.checks b{display:inline-block;width:18px}.fail b{color:#d7373f}.ok b{color:#2d9d48}.info b,.wait b{color:#888}.summary{font-weight:600}</style></head><body>
<h1>Approval report · ${esc(sourceName(s))}</h1>
<p class="job">${date} · ${pages.length} pages · paper ${esc(paper.label)} · ink limit ${s.prepress.tac} % · print size ${esc(size.short)} · minimum ${s.prepress.minPpi} ppi</p>
<p class="summary">${count('approved')} approved · ${count('rejected')} rejected · ${count('open')} open</p>
<p class="job">Separations use a grey-component-replacement model (K = 80 % of the grey component) without ICC profiles in this build; the profile name is recorded. Figures are measured on each page at its own size (up to 1536 px).</p>
${rows}
</body></html>`;
  const slug = sourceName(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'job';
  await ctx.save({ filename: `approval-${slug}-${date}.html`, data: new Blob([html], { type: 'text/html' }) });
}

// ── panels ──────────────────────────────────────────────────────────────────
function pageRow(p) {
  return ck.html(m => {
    const el = h('div', { class: 'pp-page', 'data-id': p.id });
    const num = h('span', { class: 'pp-page-n' });
    const pic = m.mount(ck.view.thumb({ src: p.thumb, image: thumb, arg: s => ({ file: p.file, dev: s.dev[p.id] || s.devDefaults }), engine: s => isEdited(s, p.id), max: 160 }));
    pic.classList.add('pp-page-p');
    const sub = h('span', { class: 'pp-page-s' }), chip = h('span', { class: 'pp-chip' });
    el.append(num, pic, h('span', { class: 'pp-page-b' }, h('span', { class: 'pp-page-t', text: p.title }), sub), chip);
    m.cell(s => jobPages(s).findIndex(x => x.id === p.id), i => { num.textContent = String(i + 1); });
    m.cell(s => statusOf(s, p.id), st => { chip.textContent = STATUS[st]; chip.className = 'pp-chip is-' + st; });
    m.cell(s => { const pr = printOf(s, p); const st = s.ui.pp.stats[p.id]; return { ppi: Math.round(pr.ppi), fails: st ? failuresOf(s, p) : -1, notes: notesOf(s, p.id).length }; }, v => {
      sub.textContent = [`${v.ppi} ppi`, v.fails < 0 ? 'measuring…' : v.fails ? `${v.fails} failing` : 'passes', v.notes ? `${v.notes} note${v.notes > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ');
      sub.classList.toggle('is-fail', v.fails > 0);
    }, { equals: (a, b) => a && b && a.ppi === b.ppi && a.fails === b.fails && a.notes === b.notes });
    return el;
  });
}
function pagesPanel() {
  return ck.panel('pp-pages', { title: 'Pages', menu: ['prepress.report', 'prepress.approvePassing', '-', 'prepress.develop'] },
    ck.ui.select(s => sourceOptions(s), { bind: s => s.prepress.source, label: 'Source', historyLabel: 'Job Source', compact: true }),
    ck.text(s => { const L = jobPages(s); const n = k => L.filter(p => statusOf(s, p.id) === k).length; return L.length ? `${L.length} pages · ${n('approved')} approved · ${n('rejected')} rejected · ${n('open')} open` : 'No pages'; }, { dim: true, size: 'small', class: 'pp-sum' }),
    ck.view.list(s => jobPages(s), {
      id: 'pp-pages-list', class: 'pp-pages-list', rowHeight: 50,
      select: { bind: s => s.ui.pp.sel, mode: 'multi' },
      row: p => pageRow(p),
      keys: { A: 'prepress.approve', R: 'prepress.reject', U: 'prepress.reopen', J: 'prepress.next', K: 'prepress.prev' },
      activate: (p, ctx) => { const vp = ctx.app.viewport(VP); if (vp) vp.fit(); },
      context: ['prepress.approve', 'prepress.reject', 'prepress.reopen', '-', 'prepress.develop'],
      empty: 'No photos in this source',
    }),
    ck.row({ class: 'pp-pages-f' }, ck.ui.command('prepress.report', { small: true, icon: 'export', text: 'Approval Report…' })));
}
// the densitometer: what is under the pointer, read from the cached separation (no state writes per move)
function densitometer(cls, idle) {
  return ck.html(m => {
    const app = m.app, el = h('div', { class: cls });
    let raf = 0, last = null;
    const draw = () => {
      raf = 0;
      const pt = app.pointer, V = liveView(), s = app.store.current;
      const r = pt && pt.viewport === VP && pt.inside && V ? readAt(V, pt.u, pt.v) : null;
      const sig = r ? r.c.join(',') + '|' + s.prepress.tac : '';
      if (sig === last) return; last = sig;
      el.classList.toggle('is-idle', !r);
      if (!r) { if (idle) el.replaceChildren(h('span', { class: 'pp-dens-idle', text: idle })); else { el.replaceChildren(); el.hidden = true; } return; }
      el.hidden = false;
      el.replaceChildren(...['C', 'M', 'Y', 'K'].map((n, i) => h('span', { class: 'pp-d is-' + n.toLowerCase() }, h('i', { text: n }), `${r.c[i]} `)),
        h('span', { class: ['pp-d', 'is-tac', r.tac > s.prepress.tac && 'is-over'], 'data-tip': r.tac > s.prepress.tac ? `Over the ${s.prepress.tac} % ink limit` : null }, `= ${r.tac} %`));
    };
    const off = app.on('pointer', () => { if (!raf) raf = requestAnimationFrame(draw); });
    m.scope.onDispose(() => { off(); if (raf) cancelAnimationFrame(raf); });
    m.cell(s => [s.ui.pp.rev, s.prepress.tac], () => { last = null; draw(); });
    return el;
  });
}
function infoPanel() {
  const sel = s => { const x = s.ui.pp.selStats; return x && x.page === currentId(s) && s.ui.pp.marquee ? x : null; };
  return ck.panel('pp-info', { title: 'Info' },
    densitometer('pp-dens-row', 'Point at the page to read C M Y K'),
    ck.when(s => !!sel(s),
      ck.column({ gap: 2, class: 'pp-selinfo' },
        ck.stat(s => { const x = sel(s); return x && x.n ? `${fmtPct(x.area)} of the page` : 'empty'; }, { label: 'Selection' }),
        ck.stat(s => { const x = sel(s); return x && x.n ? x.cmyk.map((v, i) => 'CMYK'[i] + ' ' + Math.round(v)).join('  ') : '—'; }, { label: 'Average', mono: true }),
        ck.stat(s => { const x = sel(s); return x && x.n ? `${Math.round(x.tac)} % mean · ${Math.round(x.max)} % max` : '—'; }, { label: 'Total ink' }),
        ck.stat(s => { const x = sel(s); return x && x.n ? fmtPct(x.over) : '—'; }, { label: s => `Over ${s.prepress.tac} %` })),
      ck.text(s => `Drag with the Marquee (${key('M')}) or the Lasso (${key('L')}) to measure an area`, { dim: true, wrap: true, size: 'small' })));
}
function inksPanel() {
  const st = s => { const p = currentPage(s); return p ? s.ui.pp.stats[p.id] : null; };
  const row = (pl, k) => ck.row({ class: 'pp-ink is-' + pl.key },
    ck.ui.iconButton('eye', { run: pl.cmd, small: true, class: 'pp-eye' }),
    ck.html(() => h('span', { class: 'pp-sw is-' + pl.key })),
    ck.text(pl.name, { class: 'pp-ink-n' }),
    ck.html(m => { const bar = h('span', { class: 'pp-bar' }, h('i')); m.cell(s => { const x = st(s); return x ? x.cov[k] : 0; }, v => { bar.firstChild.style.width = clamp(v, 0, 100) + '%'; }); return bar; }),
    ck.text(s => { const x = st(s); return x ? `${Math.round(x.cov[k])} %` : '…'; }, { mono: true, class: 'pp-ink-v' }));
  return ck.panel('pp-inks', { title: 'Inks' },
    ...PLATES.map(row),
    ck.divider(),
    ck.stat(s => { const x = st(s); return x ? `${Math.round(x.tac)} % · max ${Math.round(x.max)} %` : 'measuring…'; }, { label: 'Total ink' }),
    ck.row(ck.text(s => `Alt-click an eye for one plate alone · ${key('1')}–${key('4')} solo, ${key('0')} all`, { dim: true, size: 'small', wrap: true, grow: 1 }), ck.ui.command('prepress.allPlates', { small: true, text: 'All' })));
}
function preflightPanel() {
  return ck.panel('pp-preflight', { title: 'Preflight' },
    ck.html(m => {
      const el = h('div', { class: 'pp-checks' });
      m.cell(s => { const p = currentPage(s); return p ? checksFor(s, p) : []; }, list => {
        if (!list.length) { el.replaceChildren(h('div', { class: 'ck-empty', text: 'No page' })); return; }
        el.replaceChildren(...list.map(c => {
          const b = h(c.fix ? 'button' : 'div', { type: c.fix ? 'button' : null, class: ['pp-check', 'is-' + c.state], 'data-check': c.id, 'data-tip': c.fix ? FIX[c.fix] : null },
            h('span', { class: 'pp-check-i' }, c.state === 'ok' ? icon('check', 11) : c.state === 'fail' ? icon('close', 11) : c.state === 'info' ? icon('info', 11) : icon('clock', 11)),
            h('span', { class: 'pp-check-b' }, h('b', { text: c.title }), h('span', { text: c.reason })));
          if (c.fix) b.addEventListener('click', e => m.run('prepress.showOverlay', c.fix, e));
          return b;
        }));
      }, { equals: (a, b) => JSON.stringify(a) === JSON.stringify(b) });
      return el;
    }),
    ck.text(s => { const p = currentPage(s); if (!p) return ''; const L = checksFor(s, p); if (L.some(c => c.state === 'wait')) return 'Measuring the page…'; const f = L.filter(c => c.state === 'fail').length; return f ? `${f} check${f > 1 ? 's' : ''} fail · click one to see where` : 'Every check passes'; }, { dim: true, size: 'small', class: 'pp-verdict' }));
}
function paperPanel() {
  return ck.panel('pp-paper', { title: 'Paper' },
    ck.ui.select(PAPERS.map(p => ({ value: p.value, label: p.label })), { bind: s => s.prepress.paper, label: 'Profile', historyLabel: 'Paper', compact: true }),
    ck.ui.slider(240, 340, { bind: s => s.prepress.tac, label: 'Ink limit', step: 5, reset: 300, unit: '%', labelWidth: 62 }),
    ck.row({ class: 'pp-hint' }, ck.text(s => `Usual for ${paperOf(s).label}: ${paperOf(s).tac} %`, { dim: true, size: 'small', grow: 1 }), ck.ui.command('prepress.useTac', { small: true, quiet: true, text: 'Use' })),
    ck.ui.select(SIZES.map(z => ({ value: z.value, label: z.label })), { bind: s => s.prepress.size, label: 'Print size', historyLabel: 'Print Size', compact: true }),
    ck.when(s => s.prepress.size === 'custom', ck.row({ class: 'pp-custom' },
      ck.ui.number({ bind: s => s.prepress.custom.w, label: 'W', unit: 'mm', min: 20, max: 2000, step: 1, historyLabel: 'Custom Width', compact: true }),
      ck.ui.number({ bind: s => s.prepress.custom.h, label: 'H', unit: 'mm', min: 20, max: 2000, step: 1, historyLabel: 'Custom Height', compact: true }))),
    ck.ui.number({ bind: s => s.prepress.minPpi, label: 'Minimum', unit: 'ppi', min: 72, max: 1200, step: 10, historyLabel: 'Minimum Resolution' }),
    ck.stat(s => { const p = currentPage(s); if (!p) return '—'; const pr = printOf(s, p); return `${Math.round(pr.ppi)} ppi · ${fmtIn(pr.w)} × ${fmtIn(pr.h)} in`; }, { label: 'This page' }),
    ck.text('Separations use a GCR model (K = 80 % of the grey) without ICC profiles in this build; the profile name is recorded with the job.', { dim: true, wrap: true, size: 'small', class: 'pp-note-gcr' }));
}
function noteRow(n) {
  return ck.html(m => {
    const el = h('div', { class: 'pp-note', 'data-id': n.id });
    const num = h('span', { class: 'pp-note-n' });
    m.cell(s => notesOf(s, currentId(s)).findIndex(x => x.id === n.id), i => { num.textContent = String(i + 1); });
    m.cell(s => s.ui.pp.note === n.id, on => el.classList.toggle('is-on', on));
    const field = m.mount(ck.ui.textField({
      bind: s => { const pid = currentId(s), i = notesOf(s, pid).findIndex(x => x.id === n.id); return s.prepress.pages[pid]?.notes?.[i]?.text; },
      placeholder: 'Type the note, Enter', historyLabel: 'Edit Note', onEnter: () => { const a = document.activeElement; if (a && a.blur) a.blur(); },
    }));
    const del = m.mount(ck.ui.iconButton('trash', { small: true, tip: 'Delete this note', run: ctx => deleteNote(ctx, n.id) }));
    el.append(num, field, del);
    el.addEventListener('pointerdown', () => { if (m.store.peek(['ui', 'pp', 'note']) !== n.id) m.store.set(['ui', 'pp', 'note'], n.id); });
    return el;
  });
}
function notesPanel() {
  return ck.panel('pp-notes', { title: s => { const k = notesOf(s, currentId(s)).length; return k ? `Notes (${k})` : 'Notes'; } },
    ck.view.list(s => notesOf(s, currentId(s)), { id: 'pp-notes-list', class: 'pp-notes-list', rowHeight: 28, key: n => n.id, select: { mode: 'none' }, row: n => noteRow(n), empty: () => `Press ${key('N')} over the page to pin a note` }),
    ck.row(ck.ui.command('prepress.note', { small: true, icon: 'pin', text: 'Add Note' }), ck.spacer(), ck.ui.command('prepress.deleteNote', { small: true, text: 'Delete' })));
}

// ── the centre: the page, its overlays, the readouts ──────────────────────
function service() {
  // the figures of every page follow the job; the selection's figures follow the selection, the limit and the page;
  // the list's selection always names a page of the job
  return ck.html(m => {
    APP = m.app;
    // Workaround: a viewport mounted before the graph compiles asks for its first render with no input values and
    // never asks again; the viewport's dims read this flag, so it asks again once the engine is up.
    if (!m.store.peek(['ui', 'pp', 'engine'])) engineUp(m.app).then(() => m.store.set(['ui', 'pp', 'engine'], true));
    m.cell(s => jobPages(s).map(p => [p, devFor(s, p)]), list => { for (const [p] of list) measurePage(m.app, p); },
      { equals: (a, b) => a.length === b.length && a.every((x, i) => x[0] === b[i][0] && x[1] === b[i][1]) });
    m.cell(s => [s.ui.pp.marquee, s.prepress.tac, s.ui.pp.rev, currentId(s)], () => m.app.scheduler.idle(() => measureSelection(m.app), 'pp-selstats'));
    m.cell(s => { const L = jobPages(s), sel = s.ui.pp.sel; return { ok: L.some(p => p.id === sel.primary), first: L.length ? L[0].id : null }; }, v => {
      if (!v.ok && v.first) m.store.set(['ui', 'pp', 'sel'], { ids: [v.first], primary: v.first, anchor: v.first });
    }, { equals: (a, b) => a.ok === b.ok && a.first === b.first });
    const el = h('div', { class: 'pp-service' }); el.hidden = true;
    return el;
  });
}
function modeLine(s) {
  const pl = s.view.pp.plates.map(Boolean), on = PLATES.filter((x, i) => pl[i]);
  return [s.view.pp.proof ? `Proof · ${paperOf(s).label} · GCR, no ICC` : '',
    on.length === 4 ? '' : on.length === 1 ? `${on[0].name} plate` : on.length ? `Plates ${on.map(x => x.key.toUpperCase()).join('+')}` : 'No plates',
    s.view.pp.heat ? `Ink over ${s.prepress.tac} %` : '', s.view.pp.gamut ? 'Gamut warning' : ''].filter(Boolean).join(' · ');
}
const TOOL_HINT = { 'pp-rect': 'Rectangular Marquee', 'pp-ellipse': 'Elliptical Marquee', 'pp-lasso': 'Lasso' };
function centre() {
  return ck.column({ class: 'pp-center', grow: 1 },
    service(),
    ck.viewport(s => (!currentPage(s) ? null : s.view.pp.proof ? pageProof : pageRender), {
      id: VP, dims: s => { void s.ui.pp.engine; /* asks again once the engine is up: see service() */ const p = currentPage(s); return p ? [p.w, p.h] : null; }, click: 'toggle-1:1', compare: false,
      tools: ['pp-rect', 'pp-ellipse', 'pp-lasso'],
      overlays: [analysisOverlay, selectionOverlay, notesOverlay],
      onRender: onViewRender,
      hud: ck.column({ class: 'pp-hud' },
        ck.hud({ at: 'top-left' }, s => { const p = currentPage(s); return p ? `${pageIndex(s) + 1} / ${jobPages(s).length} · ${p.title} · ${STATUS[statusOf(s, p.id)]}` : 'No pages: choose a source in the Pages panel'; }),
        ck.hud({ at: 'top-right' }, modeLine),
        densitometer('ck-hud at-bottom-left pp-dens'),
        ck.hud({ at: 'bottom-right' }, s => (TOOL_HINT[s.ui.tool] ? `${TOOL_HINT[s.ui.tool]} · Shift adds · Alt subtracts · ${key('Mod+D')} deselects` : ''))),
    }));
}
function toolbar() {
  return ck.bar({ class: 'pp-tb' },
    ck.ui.command('prepress.proof', { small: true, icon: 'softproof', text: 'Proof' }),
    ck.ui.command('prepress.gamut', { small: true, icon: 'warn', text: 'Gamut' }),
    ck.ui.command('prepress.heat', { small: true, icon: 'ink', text: 'Ink' }),
    ck.row({ gap: 1, class: 'pp-chips' }, ...PLATES.map(pl => ck.ui.command(pl.cmd, { small: true, text: pl.key.toUpperCase(), class: 'pp-chipb is-' + pl.key }))),
    ck.toolbar(['tool.pp-rect', 'tool.pp-ellipse', 'tool.pp-lasso', 'prepress.note'], { small: true }),
    ck.spacer(),
    ck.row({ gap: 2, class: 'pp-nav' },
      ck.ui.command('prepress.prev', { small: true, quiet: true, icon: 'left' }),
      ck.text(s => { const L = jobPages(s); return L.length ? `${pageIndex(s) + 1} of ${L.length}` : '—'; }, { class: 'pp-nav-t' }),
      ck.ui.command('prepress.next', { small: true, quiet: true, icon: 'right' })),
    ck.ui.command('prepress.reject', { small: true, text: 'Reject' }),
    ck.ui.command('prepress.approve', { small: true, primary: true, text: 'Approve' }));
}

// ── install: the module, its commands, menus, keys and tools ───────────────
export function install(shell) {
  const has = s => !!currentPage(s);
  const NO_PAGE = 'The job has no pages: choose a source in the Pages panel';
  shell.module('prepress', m => m.label('Prepress').key('Alt+P').icon('proof')
    .left(ck.dock.column({ width: 250 }, pagesPanel()))
    .center(centre())
    .right(ck.dock.column({ width: 286 }, infoPanel(), inksPanel(), preflightPanel(), paperPanel(), notesPanel()))
    .toolbar(toolbar())
    .keys({
      A: 'prepress.approve', R: 'prepress.reject', U: 'prepress.reopen', J: 'prepress.next', K: 'prepress.prev', ArrowRight: 'prepress.next', ArrowLeft: 'prepress.prev',
      'Mod+Y': 'prepress.proof', 'Mod+Shift+Y': 'prepress.gamut', H: 'prepress.heat', N: 'prepress.note',
      'Mod+D': 'prepress.deselect', 'Mod+Shift+D': 'prepress.reselect',
      ...ck.digits(0, 4, 'prepress.solo'), 'Shift+1': 'prepress.plateC', 'Shift+2': 'prepress.plateM', 'Shift+3': 'prepress.plateY', 'Shift+4': 'prepress.plateK',
    }));
  shell.tools(t => {
    const common = { scope: 'module:prepress', cursor: 'crosshair', enabled: has, why: NO_PAGE };
    const live = (g, vp, s, gs) => { if (gs && gs.moved) drawAnts(g, vp, [gs.kind === 'lasso' ? { kind: 'lasso', op: 'add', pts: gs.pts } : { kind: gs.kind, op: 'add', x0: gs.x0, y0: gs.y0, x1: gs.x1, y1: gs.y1 }], true); };
    t.tool('pp-rect', Object.assign({ label: 'Rectangular Marquee', icon: 'marquee', key: 'M', on: shapeTool('rect'), overlay: live }, common));
    t.tool('pp-ellipse', Object.assign({ label: 'Elliptical Marquee', icon: 'ellipse', key: 'Shift+M', on: shapeTool('ellipse'), overlay: live }, common));
    t.tool('pp-lasso', Object.assign({ label: 'Lasso', icon: 'lasso', key: 'L', on: shapeTool('lasso'), overlay: live }, common));
  });
  // Shift+M cycles the marquee's shape, as in Photoshop
  shell.keys('tool:pp-ellipse', { 'Shift+M': 'tool.pp-rect' });
  shell.keys('panel:pp-notes', { Delete: 'prepress.deleteNote', Backspace: 'prepress.deleteNote' });
  // every Prepress command shows in the menus and the palette only in Prepress (module: 'prepress')
  shell.commands(c => {
    c.add('prepress.approve', { module: 'prepress', label: 'Approve Page', menu: 'Photo', icon: 'check', enabled: has, why: NO_PAGE, run: ctx => setStatus(ctx, 'approved') })
      .add('prepress.reject', { module: 'prepress', label: 'Reject Page', menu: 'Photo', icon: 'close', enabled: has, why: NO_PAGE, run: ctx => setStatus(ctx, 'rejected') })
      .add('prepress.reopen', { module: 'prepress', label: 'Reopen Page', menu: 'Photo', enabled: s => has(s) && statusOf(s, currentId(s)) !== 'open', why: s => (has(s) ? 'This page is open already' : NO_PAGE), run: ctx => setStatus(ctx, 'open') })
      .add('prepress.approvePassing', { module: 'prepress', label: 'Approve Every Passing Page', menu: 'Photo', enabled: s => jobPages(s).some(p => statusOf(s, p.id) === 'open' && s.ui.pp.stats[p.id] && passes(s, p)), why: 'No open page passes every check', run: ctx => {
        const s = ctx.state, ids = jobPages(s).filter(p => statusOf(s, p.id) === 'open' && s.ui.pp.stats[p.id] && passes(s, p)).map(p => p.id);
        ctx.tx(`Approve ${ids.length} Passing Page${ids.length > 1 ? 's' : ''}`, t => { for (const id of ids) t.prepress.pages[id] = Object.assign({ notes: [] }, s.prepress.pages[id] || {}, { status: 'approved' }); });
      } })
      .add('prepress.next', { module: 'prepress', label: 'Next Page', menu: 'Photo', icon: 'right', enabled: s => has(s) && pageIndex(s) < jobPages(s).length - 1, why: s => (has(s) ? 'This is the last page' : NO_PAGE), run: ctx => step(ctx, 1) })
      .add('prepress.prev', { module: 'prepress', label: 'Previous Page', menu: 'Photo', icon: 'left', enabled: s => has(s) && pageIndex(s) > 0, why: s => (has(s) ? 'This is the first page' : NO_PAGE), run: ctx => step(ctx, -1) })
      .add('prepress.develop', { module: 'prepress', label: 'Edit Page in Develop', menu: 'Photo', enabled: has, why: NO_PAGE, run: ctx => { const id = currentId(ctx.state); ctx.set({ ui: { selection: { ids: [id], primary: id, anchor: id } } }); ctx.go('develop'); } })
      .add('prepress.proof', { module: 'prepress', label: 'Proof Colors', menu: 'View', icon: 'softproof', checked: s => !!s.view.pp.proof, run: ctx => toggleView(ctx, 'proof') })
      .add('prepress.gamut', { module: 'prepress', label: 'Gamut Warning', menu: 'View', icon: 'warn', checked: s => !!s.view.pp.gamut, run: ctx => toggleView(ctx, 'gamut') })
      .add('prepress.heat', { module: 'prepress', label: 'Ink Coverage Heatmap', menu: 'View', icon: 'ink', checked: s => !!s.view.pp.heat, run: ctx => toggleView(ctx, 'heat') })
      .add('prepress.showOverlay', { module: 'prepress', label: 'Show a Preflight Overlay', palette: false, run: (ctx, k) => showOverlay(ctx, k) })
      .add('prepress.printSize', { module: 'prepress', label: 'View at Print Size', menu: 'View', enabled: has, why: NO_PAGE, run: printSize })
      .add('prepress.allPlates', { module: 'prepress', label: 'All Plates', menu: 'View', checked: s => s.view.pp.plates.every(Boolean), run: ctx => setPlates(ctx, [true, true, true, true]) })
      .add('prepress.solo', { module: 'prepress', label: 'Show One Plate', palette: false, run: (ctx, d) => setPlates(ctx, d ? [0, 1, 2, 3].map(i => i === d - 1) : [true, true, true, true]) });
    PLATES.forEach((pl, k) => c.add(pl.cmd, { module: 'prepress', label: `${pl.name} Plate`, menu: 'View', checked: s => !!s.view.pp.plates[k], run: ctx => plateClick(ctx, k) }));
    c.add('prepress.deselect', { module: 'prepress', label: 'Deselect', menu: 'Edit', enabled: s => { const m = s.ui.pp.marquee; return !!m && m.page === currentId(s); }, why: 'Nothing is selected: drag with the Marquee (M) or the Lasso (L)', run: ctx => { const m = ctx.state.ui.pp.marquee; ctx.set({ ui: { pp: { marquee: null, lastMarquee: m } } }); } })
      .add('prepress.reselect', { module: 'prepress', label: 'Reselect', menu: 'Edit', enabled: s => { const m = s.ui.pp.lastMarquee; return !!m && m.page === currentId(s) && !s.ui.pp.marquee; }, why: 'No earlier selection on this page to bring back', run: ctx => ctx.set({ ui: { pp: { marquee: ctx.state.ui.pp.lastMarquee } } }) })
      .add('prepress.note', { module: 'prepress', label: 'Add Note at Pointer', menu: 'Tools', icon: 'pin', enabled: has, why: NO_PAGE, run: addNote })
      .add('prepress.deleteNote', { module: 'prepress', label: 'Delete Note', enabled: s => !!s.ui.pp.note && notesOf(s, currentId(s)).some(n => n.id === s.ui.pp.note), why: 'Select a note first (click its pin or its row)', run: ctx => deleteNote(ctx, ctx.state.ui.pp.note) })
      .add('prepress.useTac', { module: 'prepress', label: 'Use the Paper’s Usual Ink Limit', enabled: s => s.prepress.tac !== paperOf(s).tac, why: 'The ink limit is the usual one for this paper already', run: ctx => { const p = paperOf(ctx.state); ctx.tx('Ink Limit', t => { t.prepress.tac = p.tac; }, { detail: `${p.tac} % (${p.label})` }); } })
      .add('prepress.report', { module: 'prepress', label: 'Approval Report…', menu: 'File', icon: 'export', enabled: s => jobPages(s).length > 0, why: NO_PAGE, run: report });
  });
  shell.menus(m => m
    .menu('File', ['prepress.report'])
    .menu('Edit', ['prepress.deselect', 'prepress.reselect'])
    .menu('Photo', ['prepress.approve', 'prepress.reject', 'prepress.reopen', 'prepress.approvePassing', 'prepress.next', 'prepress.prev', 'prepress.develop'])
    .menu('Tools', ['tool.pp-rect', 'tool.pp-ellipse', 'tool.pp-lasso', 'prepress.note'])
    // the Plates submenu is a function of state: a { label, items } entry would stay in other modules' View menus as
    // an empty submenu (the shell hides module commands, not a submenu whose commands are all hidden)
    .menu('View', ['prepress.proof', 'prepress.gamut', 'prepress.heat', s => (s.view.module === 'prepress' ? [{ label: 'Plates', items: ['prepress.allPlates', '-', ...PLATES.map(pl => pl.cmd)] }] : []), 'prepress.printSize'])
    .menu('Window', ['module.prepress']));
}
