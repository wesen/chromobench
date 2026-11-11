// Print Shop: four art-print workflows from the design, in one module — the eight-page zine (S-01), the photocopier
// look (S-02), two-drum risograph (S-04) and screenprint separations (S-06). A mode switch in the top region drives
// ck.match layouts; each mode has its own panels. Every look is an engine graph recorded once at build; pictures in
// panels render on the background lane, cached by (graph, values); sheets, masters and films that leave the app are
// rendered at full size on the background lane and saved as files (PNG with its print size, a store-only ZIP).
import { ck } from '../shell/index.js';
import { h, icon, svgEl, listen, drag as dragPointer } from '../shell/ui/dom.js';
import { sampleCatalog, primaryOf, selectedIds } from './catalog.js';
import { render, thumb } from './engine-graphs.js';
import { isEdited, fmtSigned } from './develop-model.js';
import { photoCell } from './library.js';

// ── the design's vocabulary ─────────────────────────────────────────────────
const MODES = [
  { id: 'zine', label: 'Zine', icon: 'fold', key: '1', hint: 'One sheet, eight pages: place photos, print, fold, one cut' },
  { id: 'copier', label: 'Copier', icon: 'copier', key: '2', hint: 'A copy of a copy: G copies again, Shift+G starts over' },
  { id: 'riso', label: 'Riso', icon: 'drum', key: '3', hint: 'Two drums, two inks: arrows nudge a drum, V drags its registration' },
  { id: 'screens', label: 'Screens', icon: 'screen', key: '4', hint: 'One film per ink, proofed on paper before the run' },
];
const MODE_IDS = MODES.map(x => x.id);
const PAGE_NAMES = ['Cover', 'Page 2', 'Page 3', 'Page 4', 'Page 5', 'Page 6', 'Page 7', 'Back cover'];
const PAGE_TAGS = ['Cover', '2', '3', '4', '5', '6', '7', 'Back'];
// the one-sheet mini zine on A4 landscape, 4 × 2 panels: the top row is printed upside down (5 4 3 2), the bottom
// row reads 6 7 Back Cover; folded the long way and cut through the middle two panels it becomes the booklet
const IMPO = [[0, 0, 4], [0, 1, 3], [0, 2, 2], [0, 3, 1], [1, 0, 5], [1, 1, 6], [1, 2, 7], [1, 3, 0]].map(([row, col, page]) => ({ row, col, page }));
const SHEET = { w: 297, h: 210 };   // mm
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

export const RISO_INKS = [
  ['fluoPink', 'Fluorescent Pink', '#ff48b0'], ['blue', 'Blue', '#0078bf'], ['yellow', 'Yellow', '#ffe800'], ['teal', 'Teal', '#00838a'],
  ['black', 'Black', '#000000'], ['red', 'Bright Red', '#f15060'], ['green', 'Green', '#00a95c'], ['orange', 'Orange', '#ff6c2f'],
  ['purple', 'Purple', '#765ba7'], ['mediumBlue', 'Medium Blue', '#3255a4'], ['burgundy', 'Burgundy', '#914e72'], ['sunflower', 'Sunflower', '#ffb511'],
  ['aqua', 'Aqua', '#5ec8e5'], ['mint', 'Mint', '#82d8d5'], ['hunterGreen', 'Hunter Green', '#407060'], ['flatGold', 'Flat Gold', '#bb8b41'],
  ['lightGray', 'Light Gray', '#88898a'],
].map(([id, name, hex]) => ({ id, name, hex }));
export const PAPERS = [
  ['natural', 'Natural', '#f4efe1'], ['white', 'Bright White', '#fbfbf8'], ['cream', 'Cream', '#f1e3c2'], ['newsprint', 'Newsprint', '#e3ded0'],
  ['kraft', 'Kraft', '#c4a27a'], ['manila', 'Manila', '#e7d5a6'], ['pink', 'Pale Pink', '#f5d5d3'], ['sky', 'Sky', '#d3e4ee'],
].map(([id, name, hex]) => ({ id, name, hex }));
const TEXTURES = ['grain', 'halftone'];
const ANGLES = [15, 75];                                   // each drum's screen angle, apart so the dots do not beat
const SKEW = [1, -0.6, 0.8, -1, 0.5, -0.8, 1, -0.4];       // which way each generation lands on the glass

// ── state: the document tier is undoable and autosaved; ui and view are not ──
const zinePages = (() => { const c = sampleCatalog().collections.find(x => x.id === 'zine'); const ids = c ? c.ids.slice(0, 8) : []; while (ids.length < 8) ids.push(null); return ids; })();
const COPIER0 = { gens: 3, toner: 0.48, contrast: 12, speckle: 40, skew: 0.6, soft: 1.4, burn: 0.22 };
const drum0 = (ink, texture, dx, dy) => ({ on: true, ink, texture, grain: 0.35, dot: 6, dx, dy });
export const state = {
  doc: {
    printshop: {
      zine: { pages: zinePages, title: 'Coastline', byline: 'Photographs, 1991', look: 'color', fit: 'fill', margin: 5, numbers: true, ppi: 300 },
      copier: COPIER0,
      riso: { drums: [drum0('fluoPink', 'grain', 0, 0), drum0('blue', 'halftone', 4, -3)], paper: 'natural' },
      screens: { n: 4, smooth: 1, paper: 'kraft', ink: 'opaque', copies: 50, perScreen: 25, perPull: 0.4 },
    },
  },
  ui: { printshop: { ready: false, slots: { ids: [], primary: null, anchor: null }, fillFrom: 'zine', busy: null } },
  view: { printshop: { mode: 'zine', labels: true } },
  toolOptions: {},
};

// ── small helpers ────────────────────────────────────────────────────────
const modeOf = s => (s.view.printshop && s.view.printshop.mode) || 'zine';
const isReady = s => !!(s.ui.printshop && s.ui.printshop.ready);
const busyOf = s => s.ui.printshop && s.ui.printshop.busy;
const cp = s => s.printshop.copier;
const drumOf = (s, k) => s.printshop.riso.drums[k];
const sc = s => s.printshop.screens;
const inkOf = id => RISO_INKS.find(x => x.id === id) || RISO_INKS[0];
const paperOf = id => PAPERS.find(x => x.id === id) || PAPERS[0];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pct = v => Math.round(v * 100) + '%';
const money = v => '$' + (Math.round((+v || 0) * 100) / 100).toFixed(2);
const lum601 = hex => { const n = parseInt(String(hex).slice(1), 16) || 0; return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
const slug = t => String(t || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 40) || 'untitled';
const photoById = (s, id) => (id && s.catalog.photos.find(p => p.id === id)) || null;
const dimsOf = s => { const p = primaryOf(s); return p ? [p.w, p.h] : null; };
const selSlot = s => { const k = s.ui.printshop.slots && s.ui.printshop.slots.primary; return k ? +String(k).slice(4) : -1; };
const placed = s => s.printshop.zine.pages.filter(id => photoById(s, id)).length;
const leaveTool = (v, ctx) => { if (ctx.state.ui.tool === 'ps-register' && v !== 'riso') ctx.app.selectTool(null); };
const cost = s => { const x = sc(s), n = x.n, copies = Math.max(0, x.copies), setup = n * x.perScreen, pulls = copies * n, printing = pulls * x.perPull; return { n, pulls, setup, printing, total: setup + printing, each: copies ? (setup + printing) / copies : 0 }; };

// ── engine graphs, recorded once at build ────────────────────────────────
// zine page looks, per item ({ file, dev })
const LOOK = {
  color: thumb,
  bw: thumb.blackWhite().levels({ in: [0.04, 0.96] }),
  copy: thumb.blackWhite().levels({ in: [0.12, 0.88] }).threshold(0.5).noise({ amount: 18, mono: true, seed: 5 }).blur(0.5),
};
// the copier: each generation copies the one before (blackWhite → levels → toner → speckle → blur → skew), lands on
// the paper and burns at the edges; eight are recorded, the state picks one
const COPIES = [];
{
  let prev = render;
  for (let g = 1; g <= 8; g++) {
    const copy = prev.blackWhite()
      .levels({ in: s => { const k = cp(s).contrast / 100; return [k, 1 - k]; } })
      .threshold(s => cp(s).toner)
      .noise({ amount: s => cp(s).speckle, mono: true, seed: g * 7 })
      .blur(s => cp(s).soft)
      .rotate(s => cp(s).skew * SKEW[g - 1]);
    prev = ck.source('stack', ck.solid('#f6f5f0')).layer(copy).vignette({ amount: s => cp(s).burn });
    COPIES.push(prev);
  }
}
const copyOf = s => COPIES[clamp(cp(s).gens | 0, 1, 8) - 1];
// the riso: separate into the two drums' inks, make each drum's master (grey, black = full ink), screen it (grain or
// halftone dots at the drum's angle), ink it (an off drum inks white), offset it, and print both onto the paper.
// A stack does not re-render when only an input inside a layer's options changes, so the on/off switch lives in the
// ink and the screen choice picks one of four recorded stacks.
const PLATES = render.separate(2, { inks: s => [inkOf(drumOf(s, 0).ink).hex, inkOf(drumOf(s, 1).ink).hex] });
const MASTER = [0, 1].map(k => PLATES.at(k).duotone('#000000', '#ffffff').levels({ in: s => [Math.min(0.96, lum601(inkOf(drumOf(s, k).ink).hex)), 1] }));
const SCREENED = [0, 1].map(k => ({
  grain: MASTER[k].grain({ amount: s => drumOf(s, k).grain }),
  halftone: MASTER[k].filter('colorHalftone', { maxRadius: s => drumOf(s, k).dot, channel1: ANGLES[k], channel2: ANGLES[k], channel3: ANGLES[k], channel4: ANGLES[k] }),
}));
const INKED = [0, 1].map(k => Object.fromEntries(TEXTURES.map(t => [t, SCREENED[k][t]
  .duotone(s => (drumOf(s, k).on ? inkOf(drumOf(s, k).ink).hex : '#ffffff'), '#ffffff')
  .translate(s => [drumOf(s, k).dx, drumOf(s, k).dy])])));
const RISO = {};
for (const a of TEXTURES) for (const b of TEXTURES) RISO[a + '|' + b] = ck.source('stack', ck.solid(s => paperOf(s.printshop.riso.paper).hex)).layer(INKED[0][a], { blend: 'multiply' }).layer(INKED[1][b], { blend: 'multiply' });
const risoOf = s => RISO[drumOf(s, 0).texture + '|' + drumOf(s, 1).texture] || RISO['grain|grain'];
const masterOf = (s, k) => SCREENED[k][drumOf(s, k).texture] || SCREENED[k].grain;
// screens: simplify, extract n inks, map every pixel to its ink; films are split from that on the page; the proof
// prints the mapped image on the paper with transparent or opaque inks
const SCR_SRC = render.blur(s => sc(s).smooth);
const SCR_MAPPED = SCR_SRC.mapColors(SCR_SRC.palette(s => sc(s).n));
const PROOF = {
  transparent: ck.source('stack', ck.solid(s => paperOf(sc(s).paper).hex)).layer(SCR_MAPPED, { blend: 'multiply' }),
  opaque: ck.source('stack', ck.solid(s => paperOf(sc(s).paper).hex)).layer(SCR_MAPPED, { blend: 'normal', opacity: 0.85 }).layer(SCR_MAPPED, { blend: 'multiply', opacity: 0.4 }),
};
const proofOf = s => PROOF[sc(s).ink] || PROOF.opaque;

// ── files: greyscale PNGs, a print size in PNGs, a store-only ZIP ─────────
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crcOf = b => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
  dv.setUint32(0, data.length); for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8); dv.setUint32(8 + data.length, crcOf(out.subarray(4, 8 + data.length)));
  return out;
}
function physChunk(ppi) { const d = new Uint8Array(9), dv = new DataView(d.buffer), ppm = Math.round(ppi / 0.0254); dv.setUint32(0, ppm); dv.setUint32(4, ppm); d[8] = 1; return pngChunk('pHYs', d); }
async function deflate(bytes) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer()); }
// an 8-bit greyscale PNG from one byte per pixel
export async function pngGray(w, hgt, gray, ppi) {
  const raw = new Uint8Array((w + 1) * hgt);
  for (let y = 0; y < hgt; y++) raw.set(gray.subarray(y * w, y * w + w), y * (w + 1) + 1);
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer); dv.setUint32(0, w); dv.setUint32(4, hgt); ihdr[8] = 8; ihdr[9] = 0;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr)];
  if (ppi) parts.push(physChunk(ppi));
  parts.push(pngChunk('IDAT', await deflate(raw)), pngChunk('IEND', new Uint8Array(0)));
  return new Blob(parts, { type: 'image/png' });
}
// a canvas PNG with its print size written in, so the sheet prints at A4 (any pHYs the encoder wrote is replaced)
async function withPpi(blob, ppi) {
  const b = new Uint8Array(await blob.arrayBuffer()), dv = new DataView(b.buffer);
  const out = [b.subarray(0, 8)];
  for (let at = 8; at + 12 <= b.length;) {
    const len = dv.getUint32(at), type = String.fromCharCode(...b.subarray(at + 4, at + 8)), end = at + 12 + len;
    if (type !== 'pHYs') out.push(b.subarray(at, end));
    if (type === 'IHDR') out.push(physChunk(ppi));
    at = end;
  }
  return new Blob(out, { type: 'image/png' });
}
// a ZIP that stores its files (PNGs are compressed already): local headers, data, the central directory
export async function zipStore(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  const now = new Date(), time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1), date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = f.data instanceof Uint8Array ? f.data : typeof f.data === 'string' ? enc.encode(f.data) : new Uint8Array(await f.data.arrayBuffer());
    const crc = crcOf(data);
    const lh = new Uint8Array(30 + name.length), l = new DataView(lh.buffer);
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x0800, true); l.setUint16(10, time, true); l.setUint16(12, date, true);
    l.setUint32(14, crc, true); l.setUint32(18, data.length, true); l.setUint32(22, data.length, true); l.setUint16(26, name.length, true); lh.set(name, 30);
    const ch = new Uint8Array(46 + name.length), c = new DataView(ch.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(12, time, true); c.setUint16(14, date, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true); ch.set(name, 46);
    parts.push(lh, data); central.push(ch); offset += lh.length + data.length;
  }
  const size = central.reduce((n, x) => n + x.length, 0);
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
const grayOf = rgba => { const g = new Uint8Array(rgba.length / 4); for (let i = 0; i < g.length; i++) g[i] = rgba[i * 4]; return g; };

// one export at a time; the file is computed from the state as it was when the command ran, then saved
async function exportRun(ctx, what, label, work) {
  const app = ctx.app, st = app.store;
  if (st.peek(['ui', 'printshop', 'busy'])) { app.chrome.toast('An export is already running', { kind: 'info' }); return null; }
  st.set(['ui', 'printshop', 'busy'], what);
  app.chrome.toast(label, { kind: 'info', ms: 3200 });
  try {
    await app.engineReady;
    const file = await work(st.current, app.engine);
    if (file) await app.save(file);
    return file;
  } catch (e) {
    console.error(e);
    app.chrome.toast('Export failed: ' + (e && e.message || e), { kind: 'error', ms: 6000 });
    return null;
  } finally { st.set(['ui', 'printshop', 'busy'], null); }
}

// ── pictures in panels ───────────────────────────────────────────────────
// The latest of a stream of requests, one at a time. Nothing is sent while a gesture previews: the request goes when
// it ends, so a slider drag costs one background render per picture, not one per frame.
function latest(m, work, show) {
  let want = null, running = false, alive = true;
  m.scope.onDispose(() => { alive = false; });
  const pump = () => {
    if (!alive || running || !want || m.store.previewing) return;
    const v = want; want = null; running = true;
    Promise.resolve().then(() => work(v)).then(r => { running = false; if (alive && !want && r) show(r, v); pump(); }, err => { running = false; console.warn('[printshop]', err); pump(); });
  };
  m.scope.onDispose(m.store.on(() => { if (want && !m.store.previewing) pump(); }));
  return v => { want = v || null; pump(); };
}
const sameJob = (a, b) => a === b || (!!a && !!b && a.x === b.x && JSON.stringify(a.values) === JSON.stringify(b.values));
// an engine picture of an expression (or of what a τ picks), on the background lane, cached by the engine
function engPic(pick, { max = 220, cls = '', alt = '' } = {}) {
  return ck.html(m => {
    const eng = m.app.engine;
    const el = h('div', { class: ['ps-pic', cls], role: 'img', 'aria-label': alt });
    const cv = h('canvas', { class: 'ps-pic-c' }); el.append(cv);
    const run = latest(m,
      v => eng.peekThumb(v.x, v.values, max) || new Promise(res => m.app.scheduler.idle(() => res(eng.thumb(v.x, v.values, max)))),
      r => { if (!r.bmp) return; cv.width = r.w; cv.height = r.h; try { cv.getContext('2d').drawImage(r.bmp, 0, 0); } catch (e) { return; } el.classList.add('is-ready'); el.classList.remove('is-busy'); });
    m.cell(s => { if (!isReady(s) || !primaryOf(s)) return null; const x = ck.isEngine(pick) ? pick : pick(s); return x ? { x, values: eng.values(x, s) } : null; },
      v => { el.classList.toggle('is-busy', !!v); if (!v) el.classList.remove('is-ready'); run(v); }, { equals: sameJob });
    return el;
  });
}
const chip = (hexOf, cls = '') => ck.html(m => { const c = h('span', { class: ['ps-chip', cls] }); m.cell(hexOf, v => { c.style.background = v; c.dataset.tip = v; }); return c; });

// ══ Zine (S-01) ══════════════════════════════════════════════════════════
// the sheet: drawn in millimetres times k (pixels per mm), for the screen and for the file alike
function fitText(g, text, maxW, maxSize, minSize, weight, maxLines) {
  for (let size = maxSize; size >= minSize; size *= 0.92) {
    g.font = `${weight} ${size}px ${FONT}`;
    const lines = wrapText(g, text, maxW);
    if (lines.length <= maxLines && lines.every(l => g.measureText(l).width <= maxW)) return { size, lines };
  }
  g.font = `${weight} ${minSize}px ${FONT}`;
  return { size: minSize, lines: wrapText(g, text, maxW).slice(0, maxLines).map(l => ellipsize(g, l, maxW)) };
}
function wrapText(g, text, maxW) {
  const lines = []; let cur = '';
  for (const w of String(text).split(/\s+/).filter(Boolean)) { const t = cur ? cur + ' ' + w : w; if (cur && g.measureText(t).width > maxW) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  return lines;
}
function ellipsize(g, text, maxW) { if (g.measureText(text).width <= maxW) return text; let t = text; while (t.length > 1 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1); return t + '…'; }
function placePhoto(g, img, b, fit, k, o, waiting) {
  if (b.w < 2 || b.h < 2) return;
  if (!img) {
    if (!o.screen) return;
    g.save();
    g.fillStyle = '#f1f1f1'; g.fillRect(b.x, b.y, b.w, b.h);
    g.strokeStyle = '#c4c4c4'; g.lineWidth = 1; g.setLineDash([1.2 * k, 1 * k]); g.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
    g.fillStyle = '#999'; g.font = `500 ${Math.max(9, 2.6 * k)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(waiting ? 'Rendering…' : 'Drop a photo', b.x + b.w / 2, b.y + b.h / 2);
    g.restore();
    return;
  }
  const iw = img.width, ih = img.height;
  const s = fit === 'fit' ? Math.min(b.w / iw, b.h / ih) : Math.max(b.w / iw, b.h / ih);
  const dw = iw * s, dh = ih * s;
  g.save(); g.beginPath(); g.rect(b.x, b.y, b.w, b.h); g.clip();
  try { g.drawImage(img, b.x + (b.w - dw) / 2, b.y + (b.h - dh) / 2, dw, dh); } catch (e) { /* a cached picture was released; the next frame asks again */ }
  g.restore();
}
function drawPage(g, k, pw, ph, i, img, z, o) {
  const m = Math.max(0, +z.margin || 0) * k, box = { x: m, y: m, w: pw - 2 * m, h: ph - 2 * m };
  const waiting = !!(o.waiting && o.waiting[i]);
  const title = String(z.title || '').trim(), byline = String(z.byline || '').trim();
  g.textAlign = 'left';
  if (i === 0) {   // the cover: the photo, the title under it
    let block = 0, fit = null;
    if (title) { fit = fitText(g, title, box.w, 10 * k, 3.5 * k, 800, 2); block += fit.lines.length * fit.size * 1.04; }
    if (byline) block += 4 * k;
    if (block) block += 3 * k;
    placePhoto(g, img, { x: box.x, y: box.y, w: box.w, h: box.h - block }, z.fit, k, o, waiting);
    let y = box.y + box.h - block + 3 * k;
    g.textBaseline = 'top';
    if (fit) { g.fillStyle = '#111'; g.font = `800 ${fit.size}px ${FONT}`; for (const line of fit.lines) { g.fillText(line, box.x, y); y += fit.size * 1.04; } }
    if (byline) { g.fillStyle = '#444'; g.font = `400 ${2.9 * k}px ${FONT}`; g.fillText(ellipsize(g, byline, box.w), box.x, y + 0.6 * k); }
  } else if (i === 7) {   // the back: a smaller photo, the title and byline at the foot
    placePhoto(g, img, { x: box.x + box.w * 0.16, y: box.y + box.h * 0.1, w: box.w * 0.68, h: box.h * 0.6 }, z.fit, k, o, waiting);
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    if (title) { g.fillStyle = '#111'; g.font = `800 ${3.2 * k}px ${FONT}`; g.fillText(ellipsize(g, title, box.w), pw / 2, box.y + box.h - 4.6 * k); }
    if (byline) { g.fillStyle = '#555'; g.font = `400 ${2.4 * k}px ${FONT}`; g.fillText(ellipsize(g, byline, box.w), pw / 2, box.y + box.h - 1.2 * k); }
  } else {
    const nH = z.numbers ? 5 * k : 0;
    placePhoto(g, img, { x: box.x, y: box.y, w: box.w, h: box.h - nH }, z.fit, k, o, waiting);
    if (z.numbers) { g.fillStyle = '#333'; g.font = `500 ${2.8 * k}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillText(String(i + 1), pw / 2, box.y + box.h - 0.6 * k); }
  }
  g.textAlign = 'left';
}
function scissors(g, x, y, u) {   // a pair of scissors on the cut line, blades pointing along it
  g.save(); g.translate(x, y);
  g.fillStyle = '#fff'; g.fillRect(-2.6 * u, -1.4 * u, 5 * u, 2.8 * u);
  g.strokeStyle = '#111'; g.lineWidth = Math.max(1, 0.3 * u); g.lineCap = 'round'; g.setLineDash([]);
  for (const sy of [-1, 1]) { g.beginPath(); g.ellipse(-1.75 * u, sy * 0.68 * u, 0.62 * u, 0.5 * u, 0, 0, Math.PI * 2); g.stroke(); }
  g.beginPath(); g.moveTo(-1.15 * u, -0.48 * u); g.lineTo(2.2 * u, 0.36 * u); g.moveTo(-1.15 * u, 0.48 * u); g.lineTo(2.2 * u, -0.36 * u); g.stroke();
  g.restore();
}
function drawGuides(g, k, W, H) {
  g.save();
  g.strokeStyle = '#8c8c8c'; g.lineWidth = Math.max(0.6, 0.22 * k); g.setLineDash([1.6 * k, 1.4 * k]);
  g.beginPath();
  for (const x of [W / 4, W / 2, (3 * W) / 4]) { g.moveTo(x, 0); g.lineTo(x, H); }
  g.moveTo(0, H / 2); g.lineTo(W / 4, H / 2); g.moveTo((3 * W) / 4, H / 2); g.lineTo(W, H / 2);
  g.stroke();
  g.setLineDash([]); g.strokeStyle = '#111'; g.lineWidth = Math.max(0.9, 0.35 * k);
  g.beginPath(); g.moveTo(W / 4, H / 2); g.lineTo((3 * W) / 4, H / 2); g.stroke();
  scissors(g, W / 4 + 4.5 * k, H / 2, 1.5 * k);
  g.restore();
}
function pill(g, x, y, text, k, color) {
  g.save();
  g.font = `600 ${Math.max(10, 2.5 * k)}px ${FONT}`;
  const w = g.measureText(text).width + 10, hh = Math.max(14, 3.6 * k);
  g.fillStyle = color; g.globalAlpha = 0.92; g.beginPath(); g.roundRect ? g.roundRect(x, y, w, hh, hh / 2) : g.rect(x, y, w, hh); g.fill();
  g.globalAlpha = 1; g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(text, x + 5, y + hh / 2 + 0.5);
  g.restore();
}
export function drawSheet(g, k, z, imgs, o = {}) {
  const W = SHEET.w * k, H = SHEET.h * k, pw = W / 4, ph = H / 2;
  g.save();
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
  for (const c of IMPO) {
    g.save();
    g.translate((c.col + 0.5) * pw, (c.row + 0.5) * ph);
    if (c.row === 0) g.rotate(Math.PI);
    g.translate(-pw / 2, -ph / 2);
    g.beginPath(); g.rect(0, 0, pw, ph); g.clip();
    drawPage(g, k, pw, ph, c.page, imgs[c.page], z, o);
    g.restore();
  }
  drawGuides(g, k, W, H);
  if (o.screen) {   // on screen only: the page under a drop, the selected page, the page tags
    for (const c of IMPO) {
      const x = c.col * pw, y = c.row * ph;
      if (c.page === o.from) { g.fillStyle = 'rgba(255,255,255,.5)'; g.fillRect(x, y, pw, ph); }
      if (c.page === o.drop) { g.save(); g.globalAlpha = 0.16; g.fillStyle = o.accent; g.fillRect(x, y, pw, ph); g.restore(); }
      if (c.page === o.drop || c.page === o.sel) { g.strokeStyle = o.accent; g.lineWidth = c.page === o.drop ? 3 : 2; g.setLineDash([]); g.strokeRect(x + 1.5, y + 1.5, pw - 3, ph - 3); }
      if (o.labels) pill(g, x + 6, y + 6, PAGE_TAGS[c.page], k, o.accent);
    }
  }
  g.restore();
}

// the zine's state changes, each one undo step
const pagesOf = ctx => ctx.app.store.peek(['printshop', 'zine', 'pages']);
function placePhotos(ctx, at, ids) {
  const s = ctx.app.store.current;
  const list = (ids || []).filter(id => photoById(s, id)).slice(0, 8 - at);
  if (at < 0 || !list.length) return;
  const pages = pagesOf(ctx).slice(); list.forEach((id, j) => { pages[at + j] = id; });
  const label = list.length === 1 ? `Place “${photoById(s, list[0]).title}” on ${PAGE_NAMES[at]}` : `Place ${list.length} Photos in the Zine`;
  ctx.tx(label, t => { t.printshop.zine.pages = pages; });
}
function swapPages(ctx, a, b) {
  if (a === b || a < 0 || b < 0) return;
  const pages = pagesOf(ctx).slice(); [pages[a], pages[b]] = [pages[b], pages[a]];
  ctx.tx(`Swap ${PAGE_NAMES[a]} and ${PAGE_NAMES[b]}`, t => { t.printshop.zine.pages = pages; });
}
function clearPage(ctx, i) {
  if (i < 0 || !pagesOf(ctx)[i]) return;
  const pages = pagesOf(ctx).slice(); pages[i] = null;
  ctx.tx(`Clear ${PAGE_NAMES[i]}`, t => { t.printshop.zine.pages = pages; });
}
function selectSlot(store, i) { const k = i >= 0 ? 'slot' + i : null; store.set(['ui', 'printshop', 'slots'], { ids: k ? [k] : [], primary: k, anchor: k }); }
function developPhoto(ctx, id) { if (!id) return; ctx.set({ ui: { selection: { ids: [id], primary: id, anchor: id } } }); ctx.go('develop'); }

// the centre: the imposed sheet at screen size, composited from engine renders of each page (background lane)
function zineSheet() {
  return ck.html(m => {
    const app = m.app, eng = app.engine;
    const wrap = h('div', { class: 'ps-sheet-wrap' });
    const cv = h('canvas', { class: 'ps-sheet', tabindex: '0', role: 'img', 'aria-label': 'The zine print sheet, A4 landscape' });
    const hint = h('div', { class: 'ps-sheet-hint', text: 'Drag photos from the filmstrip onto a page · drag a page onto another to swap · Delete clears · double-click develops' });
    wrap.append(cv, hint);
    let st = null, geom = null, queued = false, drop = -1, from = -1;
    const last = new Map(), asked = new Map();
    const queue = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; draw(); }); };
    const maxFor = () => clamp(Math.ceil((SHEET.h / 2) * (geom ? geom.k : 3) * Math.min(2, window.devicePixelRatio || 1) / 64) * 64, 128, 1024);
    // each page's picture: the cached render at this size, or the last one drawn there while a new one renders
    function pictures() {
      const max = maxFor(), look = LOOK[st.z.look] || LOOK.color;
      return st.pages.map((p, i) => {
        if (!p || !p.values) { last.delete(i); return null; }
        const hit = eng.peekThumb(look, p.values, max);
        if (hit) { last.set(i, { key: p.key, bmp: hit.bmp }); return hit.bmp; }
        const want = p.key + '|' + max;
        if (asked.get(i) !== want) {
          asked.set(i, want);
          app.scheduler.idle(() => { if (asked.get(i) !== want) return; eng.thumb(look, p.values, max).then(r => { if (r && r.bmp && asked.get(i) === want) asked.delete(i); queue(); }); }, 'ps-zine-' + i);
        }
        const prev = last.get(i);
        return prev && prev.key === p.key ? prev.bmp : null;
      });
    }
    function draw() {
      if (!st) return;
      const r = wrap.getBoundingClientRect(); if (r.width < 40 || r.height < 40) return;
      const pad = r.width < 520 ? 10 : 28;
      const k = Math.max(0.4, Math.min((r.width - pad * 2) / SHEET.w, (r.height - pad * 2 - 20) / SHEET.h));
      const W = SHEET.w * k, H = SHEET.h * k, dpr = Math.min(2, window.devicePixelRatio || 1);
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
      geom = { k, W, H };
      const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const imgs = pictures();
      drawSheet(g, k, st.z, imgs, { screen: true, labels: st.labels, sel: st.sel, drop, from, waiting: st.pages.map((p, i) => !!p && !imgs[i]), accent: getComputedStyle(cv).getPropertyValue('--accent').trim() || '#1473e6' });
      wrap.dataset.ready = String(imgs.filter(Boolean).length);
    }
    m.cell(s => {
      const z = s.printshop.zine, ok = isReady(s), look = LOOK[z.look] || LOOK.color;
      return {
        z, labels: s.view.printshop.labels !== false, sel: selSlot(s),
        pages: z.pages.map(id => { const p = photoById(s, id); if (!p) return null; const values = ok ? eng.values(look, { file: p.file, dev: s.dev[p.id] || s.devDefaults, w: p.w, h: p.h }) : null; return { id: p.id, values, key: z.look + JSON.stringify(values) }; }),
      };
    }, v => { st = v; queue(); }, { equals: (a, b) => JSON.stringify(a) === JSON.stringify(b) });
    const ro = new ResizeObserver(queue); ro.observe(wrap); m.scope.onDispose(() => ro.disconnect());
    // pointer: which page is under it (the sheet in mm, the imposition gives the page)
    const pageAt = e => {
      if (!geom) return -1;
      const b = cv.getBoundingClientRect(), x = (e.clientX - b.left) / geom.k, y = (e.clientY - b.top) / geom.k;
      if (x < 0 || y < 0 || x >= SHEET.w || y >= SHEET.h) return -1;
      const c = IMPO.find(q => q.row === Math.floor(y / (SHEET.h / 2)) && q.col === Math.floor(x / (SHEET.w / 4)));
      return c ? c.page : -1;
    };
    // photos dragged from the filmstrip land on a page (several fill the pages after it)
    listen(m.scope, cv, 'dragover', e => { const d = app.dragging; if (!d || d.kind !== 'photo') return; e.preventDefault(); const i = pageAt(e); if (i !== drop) { drop = i; queue(); } });
    listen(m.scope, cv, 'dragleave', () => { drop = -1; queue(); });
    listen(m.scope, cv, 'drop', e => { const d = app.dragging, i = pageAt(e); drop = -1; queue(); if (!d || d.kind !== 'photo' || i < 0) return; e.preventDefault(); m.run(ctx => placePhotos(ctx, i, d.ids)); });
    // press a page to select it; drag it onto another to swap them
    listen(m.scope, cv, 'pointerdown', e => {
      if (e.button !== 0) return;
      const i = pageAt(e); selectSlot(m.store, i);
      if (i < 0 || !st || !st.pages[i]) return;
      from = i; let moved = false; const x0 = e.clientX, y0 = e.clientY;
      queue();
      dragPointer(e, {
        move: ev => { if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) > 4) moved = true; if (!moved) return; cv.style.cursor = 'grabbing'; const j = pageAt(ev); if (j !== drop) { drop = j; queue(); } },
        up: () => { const j = drop; from = -1; drop = -1; cv.style.cursor = ''; queue(); if (moved && j >= 0 && j !== i) { m.run(ctx => swapPages(ctx, i, j)); selectSlot(m.store, j); } },
        cancel: () => { from = -1; drop = -1; cv.style.cursor = ''; queue(); },
      });
    });
    listen(m.scope, cv, 'pointermove', e => { if (e.buttons) return; const i = pageAt(e); cv.style.cursor = i >= 0 && st && st.pages[i] ? 'grab' : 'default'; });
    listen(m.scope, cv, 'dblclick', e => { const i = pageAt(e); const p = i >= 0 && st && st.pages[i]; if (p) m.run(ctx => developPhoto(ctx, p.id)); });
    // keys on the focused sheet: ← → walk the pages in reading order, Delete clears one, Enter develops its photo
    listen(m.scope, cv, 'keydown', e => {
      if (!st || e.metaKey || e.ctrlKey || e.altKey) return;
      const i = selSlot(m.store.current), stop = () => { e.preventDefault(); e.stopPropagation(); };
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { stop(); selectSlot(m.store, clamp((i < 0 ? -1 : i) + (e.key === 'ArrowRight' ? 1 : -1), 0, 7)); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && i >= 0) { stop(); m.run(ctx => clearPage(ctx, i)); }
      else if (e.key === 'Enter' && i >= 0 && st.pages[i]) { stop(); m.run(ctx => developPhoto(ctx, st.pages[i].id)); }
    });
    return wrap;
  });
}
async function exportZine(ctx) {
  const z0 = ctx.app.store.peek(['printshop', 'zine']);
  return exportRun(ctx, 'zine', `Rendering the print sheet at ${z0.ppi} ppi…`, async (S, eng) => {
    const z = S.printshop.zine, ppi = z.ppi || 300, k = ppi / 25.4, look = LOOK[z.look] || LOOK.color;
    const need = Math.min(4096, Math.ceil((SHEET.h / 2) * k));
    const bmps = [];
    for (const id of z.pages) {
      const p = photoById(S, id);
      if (!p) { bmps.push(null); continue; }
      const r = await eng.render(look, eng.values(look, { file: p.file, dev: S.dev[p.id] || S.devDefaults, w: p.w, h: p.h }), { max: need, lane: 'bg', tag: 'ps-export' });
      if (r.error) throw new Error(`${p.title}: ${r.error}`);
      bmps.push(r.bmp || null);
    }
    const W = Math.round(SHEET.w * k), H = Math.round(SHEET.h * k);
    const c = new OffscreenCanvas(W, H), g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    drawSheet(g, k, z, bmps, { screen: false });
    for (const b of bmps) if (b && b.close) b.close();
    const blob = await withPpi(await c.convertToBlob({ type: 'image/png' }), ppi);
    return { filename: `zine-${slug(z.title)}-a4-${ppi}ppi.png`, data: blob };
  });
}

// the Pages panel: eight slots in reading order, each a drop target; the list is a drag source for swapping
const slotMemo = [];
const zineSlots = s => s.printshop.zine.pages.map((id, i) => {
  const pid = photoById(s, id) ? id : null;
  let it = slotMemo[i];
  if (!it || it.photoId !== pid) it = slotMemo[i] = { id: 'slot' + i, i, photoId: pid };
  return it;
});
function slotRow(slot) {
  return ck.html(m => {
    const r = h('div', { class: ['ps-slot', !slot.photoId && 'is-empty'] });
    const pic = h('div', { class: 'ps-slot-p' });
    const name = h('span', { class: 'ps-slot-l', text: PAGE_NAMES[slot.i] });
    const sub = h('span', { class: 'ps-slot-d' });
    r.append(h('span', { class: 'ps-slot-n', text: PAGE_TAGS[slot.i] }), pic, h('span', { class: 'ps-slot-t' }, name, sub));
    if (slot.i >= 1 && slot.i <= 4) r.dataset.tip = `${PAGE_NAMES[slot.i]} is printed upside down on the top row`;
    const p = photoById(m.store.current, slot.photoId);
    if (p) {
      pic.append(m.mount(ck.view.thumb({ src: p.thumb, image: thumb, arg: s => ({ file: p.file, dev: s.dev[p.id] || s.devDefaults }), engine: s => isEdited(s, p.id), max: 160 })));
      m.cell(s => { const q = photoById(s, slot.photoId); return q ? q.title : ''; }, t => { sub.textContent = t; });
    } else sub.textContent = 'Drop a photo here';
    return r;
  });
}
function pagesPanel() {
  return ck.panel('ps-pages', { title: 'Pages', menu: ['printshop.zine.fill', 'printshop.zine.place', 'printshop.zine.clearPage', '-', 'printshop.zine.clearAll'] },
    ck.row({ class: 'ps-fill' },
      ck.ui.select(s => s.catalog.collections.filter(c => c.ids.length).map(c => ({ value: c.id, label: `${c.name} (${c.ids.length})` })), { bind: s => s.ui.printshop.fillFrom, compact: true, grow: 1 }),
      ck.ui.command('printshop.zine.fill', { small: true, text: 'Fill' })),
    ck.view.list(s => zineSlots(s), {
      id: 'ps-slots', rowHeight: 44, row: slot => slotRow(slot),
      select: { bind: s => s.ui.printshop.slots, mode: 'single' },
      dnd: { source: slot => ({ kind: 'zine-page', index: slot.i }), accepts: ['photo', 'zine-page'], drop: (d, slot, ctx) => (d.kind === 'zine-page' ? swapPages(ctx, d.index, slot.i) : placePhotos(ctx, slot.i, d.ids)) },
      keys: { Delete: 'printshop.zine.clearPage', Backspace: 'printshop.zine.clearPage' },
      activate: (slot, ctx) => developPhoto(ctx, slot.photoId),
      context: (s, slot) => [
        { label: 'Place Selected Photos Here', run: (it, ctx) => placePhotos(ctx, slot.i, selectedIds(ctx.state)) },
        { label: 'Clear Page', disabled: !slot.photoId, why: 'This page is empty', run: (it, ctx) => clearPage(ctx, slot.i) },
        '-',
        { label: 'Develop This Photo', disabled: !slot.photoId, why: 'This page is empty', run: (it, ctx) => developPhoto(ctx, slot.photoId) },
      ],
    }),
    ck.row(ck.ui.command('printshop.zine.place', { small: true, text: 'Place selection' }), ck.spacer(), ck.ui.command('printshop.zine.clearPage', { small: true, text: 'Clear' })));
}
const FOLD_STEPS = [
  ['fold', 'Fold the sheet in half the long way, then in half twice the other way. Crease every fold and open it flat.'],
  ['scissors', 'Fold it in half the short way and cut along the solid line from the fold to the middle: only the centre two panels.'],
  ['fold', 'Open it, fold it the long way again and push the ends together, so the cut opens into a diamond.'],
  ['check', 'Flatten it into a booklet with the cover on top and crease the spine. Eight pages from one sheet.'],
];
function foldPanel() {
  return ck.panel('ps-fold', { title: 'Fold & Cut' },
    ck.html(() => h('ol', { class: 'ps-steps' }, ...FOLD_STEPS.map(([ic, text], i) => h('li', { class: 'ps-step' }, h('span', { class: 'ps-step-n' }, String(i + 1)), icon(ic, 14, 'ps-step-i'), h('span', { text }))))));
}
function zinePanel() {
  const zb = key => s => s.printshop.zine[key];
  return ck.panel('ps-zine', { title: 'Zine' },
    ck.column({ class: 'ps-form' },
      ck.ui.textField({ bind: zb('title'), label: 'Title', placeholder: 'Untitled', historyLabel: 'Zine Title' }),
      ck.ui.textField({ bind: zb('byline'), label: 'Byline', placeholder: 'Your name, a date', historyLabel: 'Zine Byline' })),
    ck.row({ class: 'ps-field' }, ck.text('Look', { dim: true, class: 'ps-lab' }), ck.ui.segmented([{ value: 'color', label: 'Color' }, { value: 'bw', label: 'B&W' }, { value: 'copy', label: 'Photocopy' }], { bind: zb('look'), small: true, historyLabel: 'Zine Look' })),
    ck.row({ class: 'ps-field' }, ck.text('Photos', { dim: true, class: 'ps-lab' }), ck.ui.segmented([{ value: 'fill', label: 'Fill' }, { value: 'fit', label: 'Fit' }], { bind: zb('fit'), small: true, historyLabel: 'Photo Fit' })),
    ck.ui.slider(0, 12, { bind: zb('margin'), label: 'Margin', step: 0.5, decimals: 1, reset: 5, unit: 'mm', historyLabel: 'Page Margin' }),
    ck.ui.checkbox('Page numbers', { bind: zb('numbers'), historyLabel: 'Page Numbers' }),
    ck.ui.checkbox('Page labels on screen', { bind: s => s.view.printshop.labels }));
}
function zineOutPanel() {
  return ck.panel('ps-zine-out', { title: 'Print Sheet' },
    ck.row({ class: 'ps-field' }, ck.text('Resolution', { dim: true, class: 'ps-lab' }), ck.ui.segmented([150, 200, 300].map(v => ({ value: v, label: v + ' ppi' })), { bind: s => s.printshop.zine.ppi, small: true, historyLabel: 'Sheet Resolution' })),
    ck.stat(s => { const k = s.printshop.zine.ppi / 25.4; return `${Math.round(SHEET.w * k)} × ${Math.round(SHEET.h * k)} px`; }, { label: 'A4 landscape' }),
    ck.stat(s => `${placed(s)} of 8`, { label: 'Pages placed' }),
    ck.ui.command('printshop.zine.export', { primary: true, icon: 'export', text: 'Export print sheet…' }));
}

// ══ Copier (S-02) ════════════════════════════════════════════════════════
function generationsPanel() {
  return ck.panel('ps-generations', { title: 'Generations' },
    ck.html(m => {
      const el = h('div', { class: 'ps-gens' });
      COPIES.forEach((x, i) => {
        const g = i + 1;
        const b = h('button', { type: 'button', class: 'ps-gen', 'data-gen': String(g), 'aria-label': `Generation ${g}`, 'data-tip': g === 1 ? 'A copy of the photo' : `A copy of copy ${g - 1}` });
        b.append(m.mount(engPic(x, { max: 200, cls: 'ps-gen-p', alt: `Generation ${g}` })), h('span', { class: 'ps-gen-n', text: String(g) }));
        listen(m.scope, b, 'click', () => m.run(ctx => setGens(ctx, g)));
        m.cell(s => cp(s).gens === g, on => b.classList.toggle('is-on', on));
        el.append(b);
      });
      return el;
    }));
}
function setGens(ctx, g) {
  g = clamp(g, 1, 8);
  if (cp(ctx.state).gens === g) return;
  ctx.tx(g === 1 ? 'Start Over: One Copy' : `Generations: ${g}`, t => { t.printshop.copier.gens = g; });
}
function copierPanel() {
  const cb = key => s => s.printshop.copier[key];
  return ck.panel('ps-copier', { title: 'Copier', reset: true },
    ck.row({ class: 'ps-field' }, ck.ui.stepper({ bind: cb('gens'), min: 1, max: 8, label: 'Generations', historyLabel: 'Generations' }), ck.spacer(), ck.ui.command('printshop.copier.more', { small: true, text: 'Copy again' })),
    ck.ui.slider(0.3, 0.7, { bind: cb('toner'), label: 'Toner', step: 0.01, decimals: 2, reset: COPIER0.toner, format: pct }),
    ck.ui.slider(0, 40, { bind: cb('contrast'), label: 'Contrast', step: 1, reset: COPIER0.contrast }),
    ck.ui.slider(0, 80, { bind: cb('speckle'), label: 'Speckle', step: 1, reset: COPIER0.speckle }),
    ck.ui.slider(0, 2, { bind: cb('skew'), label: 'Skew', step: 0.05, decimals: 2, reset: COPIER0.skew, unit: '°' }),
    ck.ui.slider(0, 2.5, { bind: cb('soft'), label: 'Softness', step: 0.05, decimals: 2, reset: COPIER0.soft, unit: 'px' }),
    ck.ui.slider(0, 0.8, { bind: cb('burn'), label: 'Edge burn', step: 0.01, decimals: 2, reset: COPIER0.burn, format: pct }),
    ck.row(ck.ui.command('printshop.copier.first', { small: true, text: 'Start over' }), ck.spacer(), ck.ui.command('printshop.copier.export', { small: true, icon: 'export', text: 'Export copy…' })));
}
function copierView() {
  return ck.row({ class: 'ps-pair' },
    ck.viewport(s => (isReady(s) && primaryOf(s) ? render : null), { id: 'ps-original', label: 'Original', compare: false, dims: dimsOf, click: 'toggle-1:1', hud: noPhotoHud() }),
    ck.viewport(s => (isReady(s) && primaryOf(s) ? copyOf(s) : null), { id: 'ps-copy', label: s => (cp(s).gens === 1 ? 'Copy' : `Copy of a copy · generation ${cp(s).gens}`), compare: false, dims: dimsOf, click: 'toggle-1:1' }));
}
const noPhotoHud = () => ck.hud({ at: 'top-right' }, s => (primaryOf(s) ? '' : 'Select a photo in the filmstrip'));
async function exportCopy(ctx) {
  return exportRun(ctx, 'copier', 'Rendering the copy…', async (S, eng) => {
    const p = primaryOf(S), x = copyOf(S);
    const r = await eng.pixels(x, eng.values(x, S), { max: Math.max(p.w, p.h), lane: 'bg', encode: 'image/png', tag: 'ps-export' });
    if (!r.blob) throw new Error(r.error || 'the engine returned nothing');
    return { filename: `copy-${slug(p.title)}-generation-${cp(S).gens}.png`, data: r.blob };
  });
}

// ══ Riso (S-04) ══════════════════════════════════════════════════════════
function setInk(ctx, k, id) {
  if (drumOf(ctx.state, k).ink === id) return;
  ctx.tx(`Drum ${k + 1} Ink: ${inkOf(id).name}`, t => { t.printshop.riso.drums[k].ink = id; });
}
function nudge(ctx, k, dx, dy) {
  const d = drumOf(ctx.app.store.current, k), x = clamp(d.dx + dx, -40, 40), y = clamp(d.dy + dy, -40, 40);
  if (x === d.dx && y === d.dy) return;
  ctx.tx(`Drum ${k + 1} Registration`, t => { t.printshop.riso.drums[k].dx = x; t.printshop.riso.drums[k].dy = y; }, { coalesce: 'ps-nudge-' + k, detail: `${fmtSigned(x)}, ${fmtSigned(y)} px` });
}
// the registration pad: the drum's offset as a dot; drag it (one undo step), or focus it and use the arrows
function regPad(k) {
  return ck.html(m => {
    const R = 40;
    const pad = h('div', { class: 'ps-pad', tabindex: '0', role: 'group', 'aria-label': `Drum ${k + 1} registration`, 'data-tip': 'Registration: drag, or click and use the arrow keys (Shift ×10)' });
    const dot = h('span', { class: 'ps-pad-d' });
    pad.append(h('span', { class: 'ps-pad-h' }), h('span', { class: 'ps-pad-v' }), dot);
    m.cell(s => [drumOf(s, k).dx, drumOf(s, k).dy, inkOf(drumOf(s, k).ink).hex], ([dx, dy, hex]) => { dot.style.left = 50 + (dx / R) * 50 + '%'; dot.style.top = 50 + (dy / R) * 50 + '%'; dot.style.background = hex; });
    listen(m.scope, pad, 'pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault(); pad.focus();
      const r = pad.getBoundingClientRect(), base = ['printshop', 'riso', 'drums', k];
      const set = ev => { m.store.preview(base.concat(['dx']), clamp(Math.round(((ev.clientX - r.left) / r.width - 0.5) * 2 * R), -R, R)); m.store.preview(base.concat(['dy']), clamp(Math.round(((ev.clientY - r.top) / r.height - 0.5) * 2 * R), -R, R)); };
      set(e);
      dragPointer(e, { move: set, up: () => { const d = drumOf(m.store.current, k); m.store.commit(`Drum ${k + 1} Registration`, { detail: `${fmtSigned(d.dx)}, ${fmtSigned(d.dy)} px` }); }, cancel: () => m.store.cancel() });
    });
    return pad;
  });
}
function drumPanel(k) {
  const db = key => s => s.printshop.riso.drums[k][key], n = k + 1;
  // (the switch takes the { value, toggle } form: the shell checks switch as β, so a bare s => s.path is refused)
  const toggle = ctx => { const on = !drumOf(ctx.state, k).on; ctx.tx(`Drum ${n}: ${on ? 'On' : 'Off'}`, t => { t.printshop.riso.drums[k].on = on; }); };
  return ck.panel('ps-drum-' + n, { title: `Drum ${n}`, switch: { value: s => drumOf(s, k).on, toggle }, aside: chip(s => inkOf(drumOf(s, k).ink).hex) },
    ck.row({ class: 'ps-field' }, ck.text('Ink', { dim: true, class: 'ps-lab' }), ck.ui.select(RISO_INKS.map(x => ({ value: x.id, label: x.name })), { bind: db('ink'), compact: true, grow: 1, historyLabel: `Drum ${n} Ink` })),
    ck.row({ class: 'ps-field' }, ck.text('Screen', { dim: true, class: 'ps-lab' }), ck.ui.segmented([{ value: 'grain', label: 'Grain' }, { value: 'halftone', label: 'Halftone' }], { bind: db('texture'), small: true, historyLabel: `Drum ${n} Screen` })),
    ck.match(s => drumOf(s, k).texture, {
      grain: ck.ui.slider(0, 1, { bind: db('grain'), label: 'Grain', step: 0.01, decimals: 2, reset: 0.35, format: pct, historyLabel: `Drum ${n} Grain` }),
      halftone: ck.ui.slider(4, 16, { bind: db('dot'), label: 'Dot size', step: 1, reset: 6, unit: 'px', historyLabel: `Drum ${n} Dot Size` }),
    }, { of: TEXTURES }),
    ck.row({ class: 'ps-reg' },
      regPad(k),
      ck.column({ gap: 3, class: 'ps-reg-f' },
        ck.ui.number({ bind: db('dx'), label: 'X', unit: 'px', step: 1, min: -40, max: 40, decimals: 0, reset: 0, compact: true, historyLabel: `Drum ${n} Offset X` }),
        ck.ui.number({ bind: db('dy'), label: 'Y', unit: 'px', step: 1, min: -40, max: 40, decimals: 0, reset: 0, compact: true, historyLabel: `Drum ${n} Offset Y` }),
        ck.text('Arrows nudge · Shift ×10', { dim: true, size: 'small' }))),
    ck.row({ class: 'ps-master' },
      engPic(s => masterOf(s, k), { max: 240, cls: 'ps-master-p', alt: `Drum ${n} master` }),
      ck.column({ gap: 2, class: 'ps-master-t' }, ck.text('Master', { strong: true }), ck.text(s => (drumOf(s, k).texture === 'grain' ? `Grain ${pct(drumOf(s, k).grain)}` : `Dots ${drumOf(s, k).dot} px at ${ANGLES[k]}°`), { dim: true, size: 'small' }), ck.text(s => (drumOf(s, k).on ? 'Prints' : 'Off: this drum is skipped'), { dim: true, size: 'small' }))));
}
function inkDrawerPanel() {
  return ck.panel('ps-inks', { title: 'Ink Drawer' },
    ck.text('Click loads drum 1 · Shift-click loads drum 2', { dim: true, size: 'small' }),
    ck.html(m => {
      const el = h('div', { class: 'ps-inks' });
      for (const ink of RISO_INKS) {
        const badge = h('span', { class: 'ps-ink-d' });
        const b = h('button', { type: 'button', class: 'ps-ink', 'data-ink': ink.id, 'data-tip': `${ink.name} ${ink.hex}` }, h('span', { class: 'ps-chip', style: { background: ink.hex } }), h('span', { class: 'ps-ink-n', text: ink.name }), badge);
        listen(m.scope, b, 'click', e => { const k = e.shiftKey || e.altKey ? 1 : 0; m.run(ctx => setInk(ctx, k, ink.id)); });
        m.cell(s => [0, 1].filter(k => drumOf(s, k).ink === ink.id).map(k => k + 1).join(' '), v => { badge.textContent = v; b.classList.toggle('is-on', !!v); });
        el.append(b);
      }
      return el;
    }));
}
function paperPanel() {
  return ck.panel('ps-paper', { title: 'Paper', aside: chip(s => paperOf(s.printshop.riso.paper).hex) },
    ck.ui.select(PAPERS.map(p => ({ value: p.id, label: p.name })), { bind: s => s.printshop.riso.paper, label: 'Stock', historyLabel: 'Paper' }),
    ck.row(ck.ui.command('printshop.riso.swap', { small: true, icon: 'swap', text: 'Swap inks' }), ck.spacer(), ck.ui.command('printshop.riso.resetRegistration', { small: true, text: 'Reset registration' })));
}
function mastersPanel() {
  return ck.panel('ps-masters', { title: 'Masters' },
    ck.text('One greyscale master per drum that prints (black is full ink), at the photo’s size, with a run sheet, in a ZIP.', { dim: true, wrap: true, size: 'small' }),
    ck.ui.command('printshop.riso.export', { primary: true, icon: 'export', text: 'Export masters…' }));
}
const risoLabel = s => { const on = [0, 1].filter(k => drumOf(s, k).on).map(k => inkOf(drumOf(s, k).ink).name); return `${on.length ? on.join(' + ') : 'No ink'} on ${paperOf(s.printshop.riso.paper).name}`; };
const regHud = s => { const d = drumOf(s, 1), a = drumOf(s, 0); return primaryOf(s) ? `Drum 1 ${fmtSigned(a.dx)}, ${fmtSigned(a.dy)} px · Drum 2 ${fmtSigned(d.dx)}, ${fmtSigned(d.dy)} px` : 'Select a photo in the filmstrip'; };
function risoView() {
  return ck.viewport(s => (isReady(s) && primaryOf(s) ? risoOf(s) : null), {
    id: 'ps-riso', dims: dimsOf, compare: false, click: 'toggle-1:1', tools: ['ps-register'], label: risoLabel,
    hud: ck.column(ck.hud({ at: 'bottom-left' }, regHud), ck.hud({ at: 'top-right' }, s => (s.ui.tool === 'ps-register' ? 'Registration · drag moves drum 2, Alt-drag drum 1 · Esc' : ''))),
  });
}
// the Registration tool (V): drag on the print to move drum 2 (Alt: drum 1); one undo step per drag
function registerTool(t) {
  t.tool('ps-register', {
    label: 'Registration', icon: 'move', key: 'V', scope: 'module:printshop', cursor: 'move',
    enabled: s => modeOf(s) === 'riso' && !!primaryOf(s), why: s => (modeOf(s) !== 'riso' ? 'Switch Print Shop to Riso (3) first' : 'Select a photo first'),
    on: {
      down: (e, ctx) => { const k = e.alt ? 0 : 1, d = drumOf(ctx.state, k); return { k, x0: e.ix, y0: e.iy, dx0: d.dx, dy0: d.dy, base: ['printshop', 'riso', 'drums', k] }; },
      drag: (e, ctx, g) => {
        const dx = clamp(Math.round(g.dx0 + e.ix - g.x0), -40, 40), dy = clamp(Math.round(g.dy0 + e.iy - g.y0), -40, 40);
        ctx.preview(g.base.concat(['dx']), dx); ctx.preview(g.base.concat(['dy']), dy);
        return Object.assign({}, g, { dx, dy });
      },
      up: (e, ctx, g) => (g.dx === undefined ? ctx.cancel() : ctx.commit(`Drum ${g.k + 1} Registration`, { detail: `${fmtSigned(g.dx)}, ${fmtSigned(g.dy)} px` })),
    },
    overlay(g, vp, s) {   // a registration target per drum, printed where that drum lands
      if (!primaryOf(s)) return;
      const [nw, nh] = vp.natural(); if (!nw) return;
      [0, 1].forEach(k => {
        const d = drumOf(s, k); if (!d.on) return;
        const [x, y] = vp.toScreen(0.5 + d.dx / nw, 0.08 + d.dy / nh), r = 9;
        const col = inkOf(d.ink).hex;
        g.append(svgEl('circle', { cx: x, cy: y, r: r * 0.6, fill: 'none', stroke: col, 'stroke-width': 1.6 }));
        g.append(svgEl('path', { d: `M${x - r} ${y}H${x + r}M${x} ${y - r}V${y + r}`, stroke: col, 'stroke-width': 1.6 }));
      });
    },
  });
}
function runSheet(S) {
  const p = primaryOf(S), r = S.printshop.riso;
  const lines = [`Riso run sheet · ${p.title} (${p.name})`, `Paper: ${paperOf(r.paper).name} ${paperOf(r.paper).hex}`, ''];
  r.drums.forEach((d, k) => lines.push(`Drum ${k + 1}: ${inkOf(d.ink).name} ${inkOf(d.ink).hex} · ${d.texture === 'grain' ? `grain ${pct(d.grain)}` : `halftone ${d.dot} px at ${ANGLES[k]}°`} · registration ${fmtSigned(d.dx)}, ${fmtSigned(d.dy)} px${d.on ? '' : ' · OFF (no master)'}`));
  lines.push('', 'Masters are greyscale at the photo’s size: black prints full ink, white prints nothing. Print drum 1 first.');
  return lines.join('\n') + '\n';
}
async function exportMasters(ctx) {
  return exportRun(ctx, 'riso', 'Rendering the masters…', async (S, eng) => {
    const p = primaryOf(S), max = Math.max(p.w, p.h), files = [];
    for (const k of [0, 1]) {
      const d = drumOf(S, k); if (!d.on) continue;
      const x = masterOf(S, k), r = await eng.pixels(x, eng.values(x, S), { max, lane: 'bg', tag: 'ps-export' });
      if (!r.data) throw new Error(r.error || 'the engine returned nothing');
      files.push({ name: `drum-${k + 1}-${slug(inkOf(d.ink).name)}.png`, data: await pngGray(r.w, r.h, grayOf(r.data)) });
    }
    files.push({ name: 'run-sheet.txt', data: runSheet(S) });
    return { filename: `riso-masters-${slug(p.title)}.zip`, data: await zipStore(files) };
  });
}

// ══ Screens (S-06) ═══════════════════════════════════════════════════════
// films from the mapped image: one per ink, lightest first (the order they print), black where that ink prints
function splitFilms({ w, h: hgt, data }, n) {
  const N = w * hgt, key = new Uint32Array(N), count = new Map();
  for (let i = 0; i < N; i++) { const k = (data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2]; key[i] = k; count.set(k, (count.get(k) || 0) + 1); }
  const inks = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => ({ k, rgb: [k >> 16, (k >> 8) & 255, k & 255] }))
    .sort((a, b) => lum601(hexOf(b.rgb)) - lum601(hexOf(a.rgb)));
  const index = new Map(inks.map((x, i) => [x.k, i]));
  const masks = inks.map(() => new Uint8Array(N).fill(255)), cover = inks.map(() => 0);
  for (let i = 0; i < N; i++) {
    let j = index.get(key[i]);
    if (j === undefined) { const c = [key[i] >> 16, (key[i] >> 8) & 255, key[i] & 255]; let best = 1e9; inks.forEach((x, q) => { const dd = (x.rgb[0] - c[0]) ** 2 + (x.rgb[1] - c[1]) ** 2 + (x.rgb[2] - c[2]) ** 2; if (dd < best) { best = dd; j = q; } }); }
    masks[j][i] = 0; cover[j]++;
  }
  return { w, h: hgt, films: inks.map((x, i) => ({ hex: hexOf(x.rgb), cover: cover[i] / N, mask: masks[i] })) };
}
const hexOf = rgb => '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');
function regMark(g, x, y, r) {
  g.save(); g.strokeStyle = '#000'; g.lineWidth = Math.max(1, r * 0.12);
  g.beginPath(); g.arc(x, y, r * 0.6, 0, Math.PI * 2); g.moveTo(x - r, y); g.lineTo(x + r, y); g.moveTo(x, y - r); g.lineTo(x, y + r); g.stroke();
  g.restore();
}
// a film positive: the image in black on clear film (white here), a registration mark in the middle of each margin
function paintFilm(g, w, hgt, mask, label) {
  const M = Math.round(Math.max(w, hgt) * 0.08), W = w + 2 * M, H = hgt + 2 * M;
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  const id = new ImageData(w, hgt), d = id.data;
  for (let i = 0; i < mask.length; i++) { const v = mask[i]; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
  g.putImageData(id, M, M);
  for (const [x, y] of [[W / 2, M / 2], [W / 2, H - M / 2], [M / 2, H / 2], [W - M / 2, H / 2]]) regMark(g, x, y, M * 0.3);
  if (label) { g.fillStyle = '#000'; g.font = `500 ${Math.max(9, Math.round(M * 0.2))}px ${FONT}`; g.textBaseline = 'middle'; g.fillText(ellipsize(g, label, W / 2 - M * 0.5 - M), M, H - M / 2); }
  return [W, H];
}
const filmSize = (w, hgt) => { const M = Math.round(Math.max(w, hgt) * 0.08); return [w + 2 * M, hgt + 2 * M]; };
function filmsPanel() {
  return ck.panel('ps-films', { title: 'Films', menu: ['printshop.screens.export'] },
    ck.html(m => {
      const eng = m.app.engine;
      const el = h('div', { class: 'ps-films' });
      const run = latest(m, async v => { const r = await eng.pixels(SCR_MAPPED, v.values, { max: 300, lane: 'bg' }); return r.data ? splitFilms(r, v.n) : null; }, f => {
        el.classList.remove('is-busy');
        el.replaceChildren(...f.films.map((film, i) => {
          const [W, H] = filmSize(f.w, f.h);
          const c = h('canvas', { class: 'ps-film-c', width: W, height: H });
          paintFilm(c.getContext('2d'), f.w, f.h, film.mask, null);
          return h('figure', { class: 'ps-film', 'data-ink': film.hex }, c, h('figcaption', { class: 'ps-film-f' }, h('span', { class: 'ps-chip', style: { background: film.hex } }), h('span', { class: 'ps-film-n', text: `${i + 1} · ${film.hex}` }), h('span', { class: 'ps-film-v', text: pct(film.cover) })));
        }));
      });
      m.cell(s => (isReady(s) && primaryOf(s) ? { values: eng.values(SCR_MAPPED, s), n: sc(s).n } : null), v => {
        el.classList.toggle('is-busy', !!v);
        if (!v) el.replaceChildren(h('div', { class: 'ck-empty', text: 'Select a photo in the filmstrip' }));
        run(v);
      }, { equals: (a, b) => JSON.stringify(a) === JSON.stringify(b) });
      return el;
    }),
    ck.text('Lightest ink first: that is the order they print.', { dim: true, size: 'small', wrap: true }),
    ck.ui.command('printshop.screens.export', { small: true, icon: 'export', text: 'Export films…' }));
}
function separationPanel() {
  const sb = key => s => s.printshop.screens[key];
  return ck.panel('ps-separation', { title: 'Separation', aside: chip(s => paperOf(sc(s).paper).hex) },
    ck.row({ class: 'ps-field' }, ck.ui.stepper({ bind: sb('n'), min: 2, max: 6, label: 'Screens', historyLabel: 'Screens' })),
    ck.ui.slider(0, 4, { bind: sb('smooth'), label: 'Simplify', step: 0.1, decimals: 1, reset: 1, unit: 'px', historyLabel: 'Simplify' }),
    ck.row({ class: 'ps-field' }, ck.text('Inks', { dim: true, class: 'ps-lab' }), ck.ui.segmented([{ value: 'opaque', label: 'Opaque' }, { value: 'transparent', label: 'Transparent' }], { bind: sb('ink'), small: true, historyLabel: 'Ink Type' })),
    ck.row({ class: 'ps-field' }, ck.text('Paper', { dim: true, class: 'ps-lab' }), ck.ui.select(PAPERS.map(p => ({ value: p.id, label: p.name })), { bind: sb('paper'), compact: true, grow: 1, historyLabel: 'Proof Paper' })));
}
function runPanel() {
  const sb = key => s => s.printshop.screens[key];
  return ck.panel('ps-run', { title: 'Run' },
    ck.column({ class: 'ps-money' },
      ck.ui.number({ bind: sb('copies'), label: 'Copies', step: 1, min: 1, max: 10000, decimals: 0, historyLabel: 'Copies' }),
      ck.ui.number({ bind: sb('perScreen'), label: 'Price per screen', suffix: '$', step: 1, min: 0, max: 1000, decimals: 2, historyLabel: 'Price per Screen' }),
      ck.ui.number({ bind: sb('perPull'), label: 'Price per pull', suffix: '$', step: 0.05, min: 0, max: 100, decimals: 2, historyLabel: 'Price per Pull' })),
    ck.divider(),
    ck.stat(s => { const c = cost(s); return `${c.n} × ${money(sc(s).perScreen)} = ${money(c.setup)}`; }, { label: 'Screens' }),
    ck.stat(s => { const c = cost(s); return `${c.pulls} × ${money(sc(s).perPull)} = ${money(c.printing)}`; }, { label: 'Pulls' }),
    ck.stat(s => money(cost(s).total), { label: 'Estimate', class: 'ps-total' }),
    ck.stat(s => `${money(cost(s).each)} a copy`, { label: 'Per copy' }));
}
function screensView() {
  return ck.viewport(s => (isReady(s) && primaryOf(s) ? proofOf(s) : null), {
    id: 'ps-proof', dims: dimsOf, compare: false, click: 'toggle-1:1',
    label: s => `Overprint proof · ${sc(s).n} ${sc(s).ink} inks on ${paperOf(sc(s).paper).name}`, hud: noPhotoHud(),
  });
}
async function exportFilms(ctx) {
  return exportRun(ctx, 'screens', 'Separating the films…', async (S, eng) => {
    const p = primaryOf(S), max = Math.max(p.w, p.h), n = sc(S).n;
    const r = await eng.pixels(SCR_MAPPED, eng.values(SCR_MAPPED, S), { max, lane: 'bg', tag: 'ps-export' });
    if (!r.data) throw new Error(r.error || 'the engine returned nothing');
    const f = splitFilms(r, n), files = [];
    for (const [i, film] of f.films.entries()) {
      const [W, H] = filmSize(f.w, f.h), c = new OffscreenCanvas(W, H), g = c.getContext('2d');
      paintFilm(g, f.w, f.h, film.mask, `Film ${i + 1} of ${f.films.length} · ink ${film.hex} · ${pct(film.cover)} · ${p.title}`);
      files.push({ name: `film-${i + 1}-of-${f.films.length}-${film.hex.slice(1)}.png`, data: await pngGray(W, H, grayOf(g.getImageData(0, 0, W, H).data)) });
    }
    const pr = await eng.pixels(proofOf(S), eng.values(proofOf(S), S), { max, lane: 'bg', encode: 'image/jpeg', quality: 0.9, tag: 'ps-export' });
    if (pr.blob) files.push({ name: 'proof.jpg', data: pr.blob });
    const c = cost(S);
    files.push({ name: 'inks.txt', data: [`Screens · ${p.title}`, `Paper: ${paperOf(sc(S).paper).name}`, ...f.films.map((x, i) => `Film ${i + 1}: ink ${x.hex} · ${pct(x.cover)} of the image`), '', `${sc(S).copies} copies · ${c.pulls} pulls · estimate ${money(c.total)} (${money(c.each)} a copy)`].join('\n') + '\n' });
    return { filename: `screens-${slug(p.title)}-${f.films.length}-films.zip`, data: await zipStore(files) };
  });
}

// ── commands, menus, keys ────────────────────────────────────────────────
const inMode = id => s => modeOf(s) === id;
const notBusy = s => !busyOf(s);
function commands(builder) {
  // every Print Shop command is the module's own: menus and the palette show it only while Print Shop is open
  const c = { add(id, spec) { builder.add(id, Object.assign({ module: 'printshop' }, spec)); return c; } };
  for (const x of MODES) c.add('printshop.mode.' + x.id, { label: `Print Shop: ${x.label}`, menu: 'Print Shop', icon: x.icon, checked: s => s.view.module === 'printshop' && modeOf(s) === x.id, run: ctx => { ctx.go('printshop'); leaveTool(x.id, ctx); ctx.set({ view: { printshop: { mode: x.id } } }); } });
  c.add('printshop.export', { label: s => ({ zine: 'Export Print Sheet…', copier: 'Export Copy…', riso: 'Export Masters…', screens: 'Export Films…' })[modeOf(s)], menu: 'Print Shop', icon: 'export', enabled: notBusy, why: 'An export is running', run: ctx => ctx.run({ zine: 'printshop.zine.export', copier: 'printshop.copier.export', riso: 'printshop.riso.export', screens: 'printshop.screens.export' }[modeOf(ctx.state)]) });
  // zine
  c.add('printshop.zine.export', { label: 'Export Zine Print Sheet…', menu: 'File', icon: 'export', enabled: s => notBusy(s) && placed(s) > 0, why: s => (busyOf(s) ? 'An export is running' : 'Place at least one photo in the zine'), run: ctx => exportZine(ctx) })
    .add('printshop.zine.fill', { label: s => { const col = s.catalog.collections.find(x => x.id === s.ui.printshop.fillFrom); return col ? `Fill Zine from “${col.name}”` : 'Fill Zine from Collection'; }, menu: 'Print Shop', enabled: s => { const col = s.catalog.collections.find(x => x.id === s.ui.printshop.fillFrom); return !!col && col.ids.length > 0; }, why: 'Choose a collection with photos', run: ctx => {
      const s = ctx.app.store.current, col = s.catalog.collections.find(x => x.id === s.ui.printshop.fillFrom);
      const ids = col.ids.filter(id => photoById(s, id)).slice(0, 8); while (ids.length < 8) ids.push(null);
      ctx.tx(`Fill Zine from “${col.name}”`, t => { t.printshop.zine.pages = ids; });
    } })
    .add('printshop.zine.place', { label: 'Place Selected Photos in the Zine', menu: 'Print Shop', enabled: s => selectedIds(s).length > 0, why: 'Select photos in the filmstrip first', run: ctx => { const at = Math.max(0, selSlot(ctx.state)); placePhotos(ctx, at, selectedIds(ctx.state)); } })
    .add('printshop.zine.clearPage', { label: 'Clear Zine Page', menu: 'Print Shop', enabled: s => { const i = selSlot(s); return modeOf(s) === 'zine' && i >= 0 && !!photoById(s, s.printshop.zine.pages[i]); }, why: s => (modeOf(s) !== 'zine' ? 'Switch Print Shop to Zine (1) first' : 'Select a page with a photo first'), run: ctx => clearPage(ctx, selSlot(ctx.state)) })
    .add('printshop.zine.clearAll', { label: 'Clear All Zine Pages', menu: 'Print Shop', enabled: s => placed(s) > 0, why: 'The zine has no photos', run: ctx => ctx.tx('Clear All Pages', t => { t.printshop.zine.pages = new Array(8).fill(null); }) })
    .add('printshop.zine.numbers', { label: 'Zine Page Numbers', menu: 'Print Shop', checked: s => !!s.printshop.zine.numbers, run: ctx => { const on = !ctx.state.printshop.zine.numbers; ctx.tx(`Page Numbers: ${on ? 'On' : 'Off'}`, t => { t.printshop.zine.numbers = on; }); } });
  // copier
  const copierWhy = (s, end) => (modeOf(s) !== 'copier' ? 'Switch Print Shop to Copier (2) first' : end);
  c.add('printshop.copier.more', { label: 'Copy Again (One More Generation)', menu: 'Print Shop', icon: 'add', enabled: s => modeOf(s) === 'copier' && cp(s).gens < 8, why: s => copierWhy(s, 'Eight generations is as far as the copier goes'), run: ctx => setGens(ctx, cp(ctx.state).gens + 1) })
    .add('printshop.copier.less', { label: 'One Generation Back', menu: 'Print Shop', icon: 'minus', enabled: s => modeOf(s) === 'copier' && cp(s).gens > 1, why: s => copierWhy(s, 'This is the first copy'), run: ctx => setGens(ctx, cp(ctx.state).gens - 1) })
    .add('printshop.copier.first', { label: 'Start Over (One Copy)', menu: 'Print Shop', enabled: s => modeOf(s) === 'copier' && cp(s).gens > 1, why: s => copierWhy(s, 'This is the first copy'), run: ctx => setGens(ctx, 1) })
    .add('printshop.copier.export', { label: 'Export Copy…', menu: 'File', icon: 'export', enabled: s => notBusy(s) && !!primaryOf(s), why: s => (busyOf(s) ? 'An export is running' : 'Select a photo first'), run: ctx => exportCopy(ctx) });
  // riso
  c.add('printshop.riso.swap', { label: 'Swap Drum Inks', menu: 'Print Shop', icon: 'swap', enabled: inMode('riso'), why: 'Switch Print Shop to Riso (3) first', run: ctx => { const a = drumOf(ctx.state, 0).ink, b = drumOf(ctx.state, 1).ink; ctx.tx('Swap Drum Inks', t => { t.printshop.riso.drums[0].ink = b; t.printshop.riso.drums[1].ink = a; }); } })
    .add('printshop.riso.resetRegistration', { label: 'Reset Registration', menu: 'Print Shop', enabled: s => [0, 1].some(k => drumOf(s, k).dx || drumOf(s, k).dy), why: 'Both drums are in register', run: ctx => ctx.tx('Reset Registration', t => { for (const k of [0, 1]) { t.printshop.riso.drums[k].dx = 0; t.printshop.riso.drums[k].dy = 0; } }) })
    .add('printshop.riso.export', { label: 'Export Riso Masters…', menu: 'File', icon: 'export', enabled: s => notBusy(s) && !!primaryOf(s) && [0, 1].some(k => drumOf(s, k).on), why: s => (busyOf(s) ? 'An export is running' : !primaryOf(s) ? 'Select a photo first' : 'Turn on at least one drum'), run: ctx => exportMasters(ctx) });
  for (const k of [0, 1]) for (const [dir, dx, dy] of [['Left', -1, 0], ['Right', 1, 0], ['Up', 0, -1], ['Down', 0, 1]]) for (const step of [1, 10]) {
    c.add(`printshop.riso.d${k + 1}.${dir.toLowerCase()}${step === 10 ? '10' : ''}`, { label: `Drum ${k + 1}: Nudge ${dir}${step === 10 ? ' ×10' : ''}`, palette: false, run: ctx => nudge(ctx, k, dx * step, dy * step) });
  }
  // screens
  c.add('printshop.screens.more', { label: 'Add a Screen', menu: 'Print Shop', icon: 'add', enabled: s => sc(s).n < 6, why: 'Six screens is the most', run: ctx => ctx.tx(`Screens: ${sc(ctx.state).n + 1}`, t => { t.printshop.screens.n = sc(ctx.state).n + 1; }) })
    .add('printshop.screens.fewer', { label: 'Remove a Screen', menu: 'Print Shop', icon: 'minus', enabled: s => sc(s).n > 2, why: 'Two screens is the fewest', run: ctx => ctx.tx(`Screens: ${sc(ctx.state).n - 1}`, t => { t.printshop.screens.n = sc(ctx.state).n - 1; }) })
    .add('printshop.screens.export', { label: 'Export Screen Films…', menu: 'File', icon: 'export', enabled: s => notBusy(s) && !!primaryOf(s), why: s => (busyOf(s) ? 'An export is running' : 'Select a photo first'), run: ctx => exportFilms(ctx) });
}
const drumKeys = k => Object.fromEntries([['ArrowLeft', 'left'], ['ArrowRight', 'right'], ['ArrowUp', 'up'], ['ArrowDown', 'down']].flatMap(([key, d]) => [[key, `printshop.riso.d${k + 1}.${d}`], ['Shift+' + key, `printshop.riso.d${k + 1}.${d}10`]]));

// ── the module ───────────────────────────────────────────────────────────
// Engine inputs are computed from state only once the graph is compiled; until then a view would ask with no values
// and never ask again, so the views wait for ui.printshop.ready, set when the engine has the graph.
function whenReady(app) {
  const mark = () => { if (!app.store.peek(['ui', 'printshop', 'ready'])) app.store.set(['ui', 'printshop', 'ready'], true); };
  if (app.engine.graph) { mark(); return; }
  Promise.resolve().then(() => app.engineReady || app.engine.ensure()).then(mark, mark);
}
const byMode = cases => ck.match(modeOf, cases, { of: MODE_IDS });
export function install(shell) {
  shell.tools(t => registerTool(t));
  shell.commands(c => commands(c));
  shell.module('printshop', m => m.label('Print Shop').key('Alt+S').icon('print')
    .top(ck.bar({ class: 'ps-top' },
      ck.ui.segmented(MODES.map(x => ({ value: x.id, label: x.label, icon: x.icon })), { bind: s => s.view.printshop.mode, run: leaveTool }),
      ck.spacer(),
      ck.text(s => (MODES.find(x => x.id === modeOf(s)) || MODES[0]).hint, { dim: true, class: 'ps-hint' })))
    .left(ck.dock.column({ width: 252 }, byMode({ zine: ck.column({ gap: 0 }, pagesPanel(), foldPanel()), copier: generationsPanel(), riso: inkDrawerPanel(), screens: filmsPanel() })))
    .center(byMode({ zine: zineSheet(), copier: copierView(), riso: risoView(), screens: screensView() }))
    .right(ck.dock.column({ width: 286 }, byMode({
      zine: ck.column({ gap: 0 }, zinePanel(), zineOutPanel()),
      copier: copierPanel(),
      riso: ck.column({ gap: 0 }, drumPanel(0), drumPanel(1), paperPanel(), mastersPanel()),
      screens: ck.column({ gap: 0 }, separationPanel(), runPanel()),
    })))
    .bottom(ck.view.filmstrip(s => s.catalog.filtered, { id: 'ps-filmstrip', cell: (p, i) => photoCell(p, i, { compact: true }), select: { bind: s => s.ui.selection, mode: 'multi' }, dnd: { source: 'photo' }, aspect: 1.15 }))
    .toolbar(byMode({
      zine: ck.bar({ class: 'ps-tb' }, ck.ui.command('printshop.zine.fill', { small: true, text: 'Fill from collection' }), ck.ui.command('printshop.zine.place', { small: true, text: 'Place selection' }), ck.spacer(), ck.text(s => `${placed(s)} of 8 pages`, { dim: true }), ck.ui.command('printshop.zine.export', { small: true, primary: true, icon: 'export', text: 'Export print sheet…' })),
      copier: ck.bar({ class: 'ps-tb' }, ck.ui.command('printshop.copier.less', { small: true, quiet: true, icon: 'minus' }), ck.text(s => `Generation ${cp(s).gens} of 8`, { class: 'ps-gen-read' }), ck.ui.command('printshop.copier.more', { small: true, quiet: true, icon: 'add' }), ck.ui.command('printshop.copier.first', { small: true, text: 'Start over' }), ck.spacer(), ck.ui.command('printshop.copier.export', { small: true, icon: 'export', text: 'Export copy…' })),
      riso: ck.bar({ class: 'ps-tb' }, ck.toolbar(['tool.ps-register']), ck.ui.command('printshop.riso.swap', { small: true, text: 'Swap inks' }), ck.ui.command('printshop.riso.resetRegistration', { small: true, text: 'Reset registration' }), ck.spacer(), ck.ui.command('printshop.riso.export', { small: true, primary: true, icon: 'export', text: 'Export masters…' })),
      screens: ck.bar({ class: 'ps-tb' }, ck.ui.command('printshop.screens.fewer', { small: true, quiet: true, icon: 'minus' }), ck.text(s => `${sc(s).n} screens`, { class: 'ps-gen-read' }), ck.ui.command('printshop.screens.more', { small: true, quiet: true, icon: 'add' }), ck.spacer(), ck.text(s => `Estimate ${money(cost(s).total)}`, { dim: true }), ck.ui.command('printshop.screens.export', { small: true, primary: true, icon: 'export', text: 'Export films…' })),
    }))
    .keys(Object.assign(
      Object.fromEntries(MODES.map(x => [x.key, 'printshop.mode.' + x.id])),
      { G: 'printshop.copier.more', 'Shift+G': 'printshop.copier.first', E: 'printshop.export', X: 'printshop.riso.swap' }))
    .onEnter(ctx => whenReady(ctx.app)));
  shell.keys('panel:ps-drum-1', drumKeys(0));
  shell.keys('panel:ps-drum-2', drumKeys(1));
  shell.menus(m => m
    .menu('Print Shop', [...MODES.map(x => 'printshop.mode.' + x.id), '-', 'printshop.export', '-', 'printshop.zine.fill', 'printshop.zine.place', 'printshop.zine.clearPage', 'printshop.zine.clearAll', 'printshop.zine.numbers', '-', 'printshop.copier.more', 'printshop.copier.less', 'printshop.copier.first', '-', 'tool.ps-register', 'printshop.riso.swap', 'printshop.riso.resetRegistration', '-', 'printshop.screens.more', 'printshop.screens.fewer'])
    .menu('File', ['printshop.zine.export', 'printshop.copier.export', 'printshop.riso.export', 'printshop.screens.export']));
}
