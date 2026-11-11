// Export: the batch desk (W-02 "a product-shot line", generalized for photographers). An export set (the selected
// photos, the picks, a collection or the Library view), a recipe that copies chosen groups of settings from one
// photo to the whole set in one step, a review pass (Ready / Review, per photo), export settings with presets and
// a naming template, and a queue that renders each photo on the engine's background lane, packs the files into
// one .zip and records what happened as one undo step. Statuses are document state; pixels and blobs never are.
import { ck } from '../shell/index.js';
import { h, icon } from '../shell/ui/dom.js';
import { hash, stable, deepEq, clamp } from '../shell/core/util.js';
import { strip } from '../shell/core/store.js';
import { primaryOf, selectedIds } from './catalog.js';
import { thumb } from './engine-graphs.js';
import { SYNC_GROUPS, syncSettings, isEdited } from './develop-model.js';

// ── the model ────────────────────────────────────────────────────────────
const GROUPS = Object.keys(SYNC_GROUPS);
const LOCAL_GROUPS = ['Crop', 'Spot Removal', 'Masks'];       // per-photo by nature: off unless asked for
const DEFAULT_GROUPS = Object.fromEntries(GROUPS.map(g => [g, !LOCAL_GROUPS.includes(g)]));
export const EXPORT_PRESETS = [
  { id: 'web', name: 'Web 2048', spec: 'JPEG 85 · 2048 px', set: { format: 'jpeg', quality: 85, resize: true, longEdge: 2048, square: false } },
  { id: 'instagram', name: 'Instagram 1080', spec: 'square · center crop', set: { format: 'jpeg', quality: 90, resize: true, longEdge: 1080, square: true } },
  { id: 'full', name: 'Full size', spec: 'PNG · lossless', set: { format: 'png', resize: false, square: false } },
  { id: 'proof', name: 'Proof 1200', spec: 'JPEG 70 · 1200 px', set: { format: 'jpeg', quality: 70, resize: true, longEdge: 1200, square: false } },
];
const FORMATS = [{ value: 'jpeg', label: 'JPEG' }, { value: 'png', label: 'PNG' }, { value: 'webp', label: 'WebP' }];
const MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const TOKENS = [
  { id: 'seq', tip: 'Position in this export: 01, 02, …' }, { id: 'title', tip: 'The photo’s title' },
  { id: 'name', tip: 'The original file name, without its extension' }, { id: 'date', tip: 'Capture date, YYYY-MM-DD' },
];
const SHOW = [{ value: 'all', label: 'All' }, { value: 'ready', label: 'Ready' }, { value: 'review', label: 'Review' }, { value: 'exported', label: 'Exported' }, { value: 'failed', label: 'Failed' }];
const SEL0 = { ids: [], primary: null, anchor: null };
const RUN0 = { running: false, total: 0, done: 0, failed: 0, bytes: 0, started: 0, items: [], last: null, cancelled: false, note: '' };
const NOCH = { channel: null, snapPath: null, keepPreview: true };   // export steps are not a photo's develop history

export const state = {
  doc: {
    exportDesk: {
      source: 'filter',            // 'selection' | 'picks' | 'filter' | 'collection:<id>'
      chosen: [],                  // the ids taken from the selection when the source is 'selection'
      skip: [],                    // photos left out of this set
      recipe: { from: null, groups: DEFAULT_GROUPS, review: true },   // from: null follows the primary photo
      settings: { format: 'jpeg', quality: 85, resize: true, longEdge: 2048, square: false, naming: '{seq}-{title}' },
      status: {},                  // id → { s: 'ready' | 'review' | 'exported' | 'failed', why?, file?, at?, sig?, w?, h?, bytes? }
    },
  },
  ui: { exportRun: RUN0, exportSheet: { busy: false, done: 0, total: 0 }, exportSrcSel: SEL0, exportColSel: SEL0, exportPresetSel: SEL0, exportQueueSel: SEL0 },
  view: { exportShow: 'all', exportThumb: 160 },
  toolOptions: {},
};

// ── queries (traced: they run inside cells and command states) ──────────────
const byDate = (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
export function setPhotos(s) {
  const d = s.exportDesk, all = s.catalog.photos, src = d.source || 'filter';
  let list;
  if (src === 'filter') list = s.catalog.filtered;
  else if (src === 'picks') list = all.filter(p => p.flag === 'pick').sort(byDate);
  else if (src === 'selection') { const on = new Set(d.chosen); list = all.filter(p => on.has(p.id)).sort(byDate); }
  else if (src.startsWith('collection:')) { const c = s.catalog.collections.find(x => x.id === src.slice(11)); const on = new Set(c ? c.ids : []); list = all.filter(p => on.has(p.id)).sort(byDate); }
  else list = [];
  if (d.skip.length) { const out = new Set(d.skip); list = list.filter(p => !out.has(p.id)); }
  return list;
}
const items = s => s.ui.exportSet || [];
const SIG = new WeakMap();
// a signature of a photo's settings: an exported photo edited afterwards needs another look
export function sigOf(dev) { const d = strip(dev); if (!d || typeof d !== 'object') return ''; let v = SIG.get(d); if (!v) { v = hash(stable(d)); SIG.set(d, v); } return v; }
export function statusOf(s, p) {
  const rec = s.exportDesk.status[p.id];
  if (rec) {
    if (rec.s === 'exported' && rec.sig && rec.sig !== sigOf(s.dev[p.id] || s.devDefaults)) return { s: 'review', why: `Edited since it was exported as ${rec.file}` };
    return { s: rec.s, why: rec.why || '', rec };
  }
  if (p.flag === 'reject') return { s: 'review', why: 'Flagged as Rejected' };
  return { s: 'ready', why: '' };
}
const toExport = s => items(s).filter(p => statusOf(s, p).s === 'ready');
function tally(s) { const c = { ready: 0, review: 0, exported: 0, failed: 0, total: 0 }; for (const p of items(s)) { c[statusOf(s, p).s]++; c.total++; } return c; }
const inSet = s => { const on = new Set(items(s).map(p => p.id)); return selectedIds(s).filter(id => on.has(id)); };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
export function sourceName(s, id = s.exportDesk.source) {
  if (id === 'selection') return 'Selected photos';
  if (id === 'picks') return 'Picks';
  if (id === 'filter') return 'All in current filter';
  const c = String(id).startsWith('collection:') && s.catalog.collections.find(x => x.id === String(id).slice(11));
  return c ? c.name : 'A missing collection';
}
const recipeSource = s => { const id = s.exportDesk.recipe.from || (s.ui.selection && s.ui.selection.primary); return (id && s.catalog.photos.find(p => p.id === id)) || null; };
const groupsOn = s => GROUPS.filter(g => s.exportDesk.recipe.groups[g]);
const recipeTargets = s => { const src = recipeSource(s); return items(s).filter(p => !src || p.id !== src.id); };
function presetOf(s) { const cur = s.exportDesk.settings; const pr = EXPORT_PRESETS.find(x => Object.entries(x.set).every(([k, v]) => cur[k] === v || (k === 'quality' && cur.format === 'png'))); return pr ? pr.id : null; }
const POS = new WeakMap();
const posOf = (s, id) => { const L = items(s); let m = POS.get(L); if (!m) { m = new Map(L.map((p, i) => [p.id, i])); POS.set(L, m); } return m.has(id) ? m.get(id) + 1 : ''; };
function shown(s) { const f = s.view.exportShow || 'all'; return f === 'all' ? items(s) : items(s).filter(p => statusOf(s, p).s === f); }

// ── naming: {seq}-{title} → 01-Shuttered house.jpg, unique within one export ──
const clean = v => String(v == null ? '' : v).replace(/\s*:\s*/g, ' - ').replace(/[\u0000-\u001f/\\*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 120);
export function baseName(tpl, p, seq, total) {
  const pad = Math.max(2, String(total).length);
  const map = { seq: String(seq).padStart(pad, '0'), title: p.title || '', name: String(p.name || p.id).replace(/\.[^.]+$/, ''), date: String(p.date || '').slice(0, 10) };
  const out = clean(String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (k in map ? map[k] : m)));
  return out || clean(map.name) || 'photo';
}
const unique = (base, ext, used) => { let name = `${base}.${ext}`, k = 2; while (used.has(name.toLowerCase())) name = `${base}-${k++}.${ext}`; used.add(name.toLowerCase()); return name; };
export function plannedNames(list, S) { const used = new Set(); return list.map((p, i) => unique(baseName(S.naming, p, i + 1, list.length), EXT[MIME[S.format]] || 'jpg', used)); }
function naming(s) {
  const S = s.exportDesk.settings, ready = toExport(s), list = ready.length ? ready : items(s);
  const names = plannedNames(list, S);
  const unknown = [...String(S.naming).matchAll(/\{(\w+)\}/g)].map(m => m[1]).filter(k => !TOKENS.some(t => t.id === k));
  const dup = list.filter((p, i) => names[i] !== `${baseName(S.naming, p, i + 1, list.length)}.${EXT[MIME[S.format]]}`).length;
  const warn = [unknown.length ? `Unknown token${unknown.length > 1 ? 's' : ''} {${unknown.join('}, {')}} stay${unknown.length > 1 ? '' : 's'} as typed.` : '', dup ? `${plural(dup, 'name')} repeat${dup === 1 ? 's' : ''}: -2, -3… is added. {seq} keeps names apart.` : ''].filter(Boolean).join(' ');
  return { first: names[0] || '—', warn };
}

// ── commands ──────────────────────────────────────────────────────────────
function mark(ctx, kind) {
  const s = ctx.state, ids = inSet(s);
  const set = new Map(items(s).map(p => [p.id, p]));
  const change = ids.filter(id => statusOf(s, set.get(id)).s !== kind || (kind === 'review' && statusOf(s, set.get(id)).why !== 'Marked for review'));
  if (!change.length) { ctx.toast(kind === 'ready' ? 'Already Ready' : 'Already marked for review'); return; }
  const label = kind === 'ready' ? (change.length === 1 ? 'Mark Ready' : `Mark ${change.length} Ready`) : (change.length === 1 ? 'Mark for Review' : `Mark ${change.length} for Review`);
  ctx.tx(label, t => { for (const id of change) t.exportDesk.status[id] = kind === 'ready' ? { s: 'ready' } : { s: 'review', why: 'Marked for review' }; }, NOCH);
}
function chooseSource(ctx, id) {
  if (!id) return;
  const st = ctx.app.store, d = st.peek(['exportDesk']);
  if (id === 'selection') {
    const ids = selectedIds(st.readonly()).slice();
    if (!ids.length) { ctx.toast('Select photos in Library first'); return; }
    if (d.source === 'selection' && !d.skip.length && ids.length === d.chosen.length && ids.every(x => d.chosen.includes(x))) return;
    ctx.tx(`Export Set: ${plural(ids.length, 'Selected Photo')}`, t => { t.exportDesk.source = 'selection'; t.exportDesk.chosen = ids; t.exportDesk.skip = []; }, NOCH);
  } else {
    if (d.source === id && !d.skip.length) return;
    ctx.tx(`Export Set: ${sourceName(st.readonly(), id)}`, t => { t.exportDesk.source = id; t.exportDesk.skip = []; }, NOCH);
  }
  ctx.set({ view: { exportShow: 'all' } });
}
function applyPreset(ctx, id) {
  const pr = EXPORT_PRESETS.find(x => x.id === id); if (!pr) return;
  const cur = ctx.app.store.peek(['exportDesk', 'settings']);
  if (Object.entries(pr.set).every(([k, v]) => cur[k] === v)) return;
  ctx.tx(`Export Preset: ${pr.name}`, t => { for (const [k, v] of Object.entries(pr.set)) t.exportDesk.settings[k] = v; }, NOCH);
}
function applyRecipe(ctx) {
  const st = ctx.app.store, s = st.readonly();
  const src = recipeSource(s), groups = groupsOn(s), review = s.exportDesk.recipe.review;
  if (!src) return;
  const from = st.peek(['dev', src.id]) || st.peek(['devDefaults']);
  const targets = recipeTargets(s).map(p => p.id);
  const changed = targets.filter(id => { const cur = st.peek(['dev', id]) || st.peek(['devDefaults']); return groups.some(g => SYNC_GROUPS[g].some(k => !deepEq(cur[k], from[k]))); });
  if (!changed.length) { ctx.toast(`The ${plural(targets.length, 'photo')} already match ${src.title}`); return; }
  ctx.tx(`Apply Recipe to ${plural(changed.length, 'Photo')}`, t => {
    for (const id of changed) {
      t.dev[id] = syncSettings(from, st.peek(['dev', id]) || st.peek(['devDefaults']), groups);
      if (review) t.exportDesk.status[id] = { s: 'review', why: `Recipe from ${src.title} applied: have a look` };
    }
  }, Object.assign({ detail: `${groups.length} groups from ${src.title}` }, NOCH));
  ctx.toast(`Copied ${plural(groups.length, 'group')} of settings from ${src.title} to ${plural(changed.length, 'photo')}${review ? '; they are marked for review' : ''}`);
}
function openInDevelop(ctx, id) {
  if (!id) return;
  ctx.set({ ui: { selection: { ids: [id], primary: id, anchor: id } } });
  ctx.go('develop');
}
function addToken(ctx, tk) {
  const cur = ctx.app.store.peek(['exportDesk', 'settings', 'naming']) || '';
  ctx.tx('File Naming', t => { t.exportDesk.settings.naming = cur + (cur && !/[-_ .]$/.test(cur) ? '-' : '') + `{${tk}}`; }, Object.assign({ coalesce: 'type:exportDesk.settings.naming' }, NOCH));
}

// ── the export run: render → encode → crc → zip → save; one transaction records it ──
let RUN = null;     // { cancelled } while a run is going
let LAST = null;    // { blob, filename, results, at, recorded }: the last zip, for Save Again (never in state)
let SHEET = null;   // { cancelled } while a contact sheet is made
const setRun = (app, patch) => app.store.set(['ui', 'exportRun'], Object.assign({}, app.store.peek(['ui', 'exportRun']), patch));
const setRunItem = (app, i, patch) => { const r = app.store.peek(['ui', 'exportRun']); const list = r.items.slice(); list[i] = Object.assign({}, list[i], patch); app.store.set(['ui', 'exportRun'], Object.assign({}, r, { items: list })); };
const stamp = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
export const fmtBytes = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

async function startExport(ctx) {
  if (RUN || SHEET) return;
  const app = ctx.app, st = app.store;
  if (st.peek(['view', 'module']) !== 'export') ctx.go('export');
  const s = st.readonly();
  const list = toExport(s).map(p => strip(p));
  if (!list.length) return;
  const S = Object.assign({}, st.peek(['exportDesk', 'settings']));
  const devs = list.map(p => st.peek(['dev', p.id]) || st.peek(['devDefaults']));   // what is exported is what was there when it started
  const bases = list.map((p, i) => baseName(S.naming, p, i + 1, list.length));
  const planned = plannedNames(list, S);
  const tag = 'export:' + Date.now().toString(36);
  const run = RUN = { tag, cancelled: false };
  const now = new Date(), filename = `${clean(`Export - ${sourceName(s)} - ${stamp(now)}`)}.zip`;
  setRun(app, Object.assign({}, RUN0, { running: true, total: list.length, started: Date.now(), items: list.map((p, i) => ({ id: p.id, name: planned[i], state: 'queued' })) }));
  requestAnimationFrame(() => { const q = document.querySelector('.ck-panel[data-panel="export-queue"]'); if (q) q.scrollIntoView({ block: 'nearest' }); });
  const zip = new ZipWriter(), used = new Set(), results = [];
  let bytes = 0, fallback = 0;
  try {
    await app.engine.ensure();
    for (let i = 0; i < list.length && !run.cancelled; i++) {
      setRunItem(app, i, { state: 'active' });
      const t0 = performance.now();
      try {
        const out = await renderOne(app, list[i], devs[i], S, tag);
        if (run.cancelled || !out) break;
        const data = new Uint8Array(await out.blob.arrayBuffer());
        const mime = out.blob.type || MIME[S.format];
        if (mime !== MIME[S.format]) fallback++;
        const name = unique(bases[i], EXT[mime] || 'bin', used);
        zip.add(name, data, await crc32(data), now);
        bytes += data.length;
        results.push({ id: list[i].id, ok: true, name, w: out.w, h: out.h, bytes: data.length, sig: sigOf(devs[i]) });
        setRunItem(app, i, { state: 'done', name, w: out.w, h: out.h, bytes: data.length, ms: Math.round(performance.now() - t0) });
      } catch (e) {
        results.push({ id: list[i].id, ok: false, err: String(e && e.message || e) });
        setRunItem(app, i, { state: 'failed', err: String(e && e.message || e), ms: Math.round(performance.now() - t0) });
      }
      setRun(app, { done: i + 1, failed: results.filter(x => !x.ok).length, bytes });
    }
  } finally { RUN = null; }
  if (run.cancelled) {
    const r = st.peek(['ui', 'exportRun']);
    setRun(app, { running: false, cancelled: true, items: r.items.map(it => (it.state === 'queued' || it.state === 'active' ? Object.assign({}, it, { state: 'cancelled' }) : it)), note: `Cancelled after ${r.done} of ${r.total}. Nothing was saved.` });
    ctx.toast('Export cancelled. Nothing was saved.');
    return;
  }
  const good = results.filter(x => x.ok).length, bad = results.length - good;
  const note = fallback ? `This browser cannot write ${S.format.toUpperCase()}: ${plural(fallback, 'file')} came out as PNG.` : '';
  if (!good) {
    LAST = null;
    setRun(app, { running: false, note: `Every photo failed. ${results[0] && results[0].err || ''}`.trim() });
    record(ctx, { results, at: now.toISOString(), filename: '', recorded: false });
    return;
  }
  const blob = zip.finish();
  LAST = { blob, filename, results, at: now.toISOString(), recorded: false };
  setRun(app, { running: false, last: { filename, bytes: blob.size, count: good, failed: bad }, note });
  await saveLast(ctx);
}
async function saveLast(ctx) {
  const last = LAST; if (!last) return;
  const ok = await ctx.save({ filename: last.filename, data: last.blob });
  if (ok) record(ctx, last);
  else setRun(ctx.app, { note: 'The zip was not saved. Save Again offers it once more.' });
}
// one undo step per export run: what was written, what failed, and the settings signature it was made from
function record(ctx, run) {
  if (run.recorded) return;
  run.recorded = true;
  const good = run.results.filter(r => r.ok).length, bad = run.results.length - good;
  const label = good ? `Export ${plural(good, 'Photo')}${bad ? ` (${bad} failed)` : ''}` : `Export Failed (${bad})`;
  ctx.tx(label, t => {
    for (const r of run.results) t.exportDesk.status[r.id] = r.ok ? { s: 'exported', file: r.name, at: run.at, sig: r.sig, w: r.w, h: r.h, bytes: r.bytes } : { s: 'failed', why: r.err };
  }, Object.assign({ detail: run.filename || undefined }, NOCH));
}
function cancelRun(ctx) {
  if (RUN) { RUN.cancelled = true; ctx.app.engine.cancel(RUN.tag); setRun(ctx.app, { cancelled: true }); }
  if (SHEET) { SHEET.cancelled = true; ctx.app.engine.cancel(SHEET.tag); }
}

// one photo: the develop graph at the export size, encoded in the worker; a square is cut from the centre here
async function renderOne(app, p, dev, S, tag) {
  const values = app.engine.values(thumb, { file: p.file, dev, w: p.w, h: p.h });
  const mime = MIME[S.format] || 'image/jpeg';
  const quality = S.format === 'png' ? 1 : clamp((+S.quality || 85) / 100, 0.01, 1);
  const L = S.resize ? clamp(Math.round(+S.longEdge || 2048), 64, 4096) : 4096;
  if (!S.square) {
    const r = await app.engine.pixels(thumb, values, { max: L, encode: mime, quality, lane: 'bg', tag });
    if (r.cancelled) return null;
    if (r.error || !r.blob) throw new Error(r.error || 'the engine returned nothing');
    return { blob: r.blob, w: r.w, h: r.h };
  }
  // render big enough that the short side reaches the long edge asked for (never past the photo's own size)
  const g = (dev.crop && dev.crop.geometry && dev.crop.geometry.rect) || { x0: 0, y0: 0, x1: 1, y1: 1 };
  const cw = (g.x1 - g.x0) * p.w, chh = (g.y1 - g.y0) * p.h;
  const k = Math.max(cw, chh) / Math.max(1, Math.min(cw, chh));
  const r = await app.engine.pixels(thumb, values, { max: Math.min(4096, Math.ceil(L * k)), lane: 'bg', tag });
  if (r.cancelled) return null;
  if (r.error || !r.data) throw new Error(r.error || 'the engine returned nothing');
  return squareEncode(r, Math.min(L, r.w, r.h), mime, quality);
}
async function squareEncode({ w, h, data }, side, mime, quality) {
  const s0 = Math.min(w, h), sx = Math.floor((w - s0) / 2), sy = Math.floor((h - s0) / 2);
  const src = new OffscreenCanvas(w, h); src.getContext('2d').putImageData(new ImageData(data, w, h), 0, 0);
  const out = new OffscreenCanvas(side, side); const g = out.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, sx, sy, s0, s0, 0, 0, side, side);
  return { blob: await out.convertToBlob({ type: mime, quality }), w: side, h: side };
}

// ── a store-only ZIP writer: local headers, the files, a central directory, CRC-32 ──
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export async function crc32(bytes) {
  let c = 0xFFFFFFFF;
  const CH = 1 << 20;   // a megabyte at a time, then let the frame breathe
  for (let i = 0; i < bytes.length; i += CH) {
    const end = Math.min(bytes.length, i + CH);
    for (let j = i; j < end; j++) c = CRC_TABLE[(c ^ bytes[j]) & 0xFF] ^ (c >>> 8);
    if (end < bytes.length) await new Promise(r => setTimeout(r, 0));
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}
export class ZipWriter {
  constructor() { this.parts = []; this.central = []; this.offset = 0; this.count = 0; }
  add(name, data, crc, date = new Date()) {
    const nm = new TextEncoder().encode(name);
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
    const day = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    const loc = new DataView(new ArrayBuffer(30));
    loc.setUint32(0, 0x04034b50, true); loc.setUint16(4, 20, true); loc.setUint16(6, 0x0800, true); loc.setUint16(8, 0, true);
    loc.setUint16(10, time, true); loc.setUint16(12, day, true); loc.setUint32(14, crc, true);
    loc.setUint32(18, data.length, true); loc.setUint32(22, data.length, true); loc.setUint16(26, nm.length, true); loc.setUint16(28, 0, true);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true); cen.setUint16(10, 0, true);
    cen.setUint16(12, time, true); cen.setUint16(14, day, true); cen.setUint32(16, crc, true);
    cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true); cen.setUint16(28, nm.length, true);
    cen.setUint16(30, 0, true); cen.setUint16(32, 0, true); cen.setUint16(34, 0, true); cen.setUint16(36, 0, true); cen.setUint32(38, 0, true);
    cen.setUint32(42, this.offset, true);
    this.parts.push(loc, nm, data);
    this.central.push(cen, nm);
    this.offset += 30 + nm.length + data.length;
    this.count++;
  }
  finish() {
    const size = this.central.reduce((n, p) => n + p.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(4, 0, true); end.setUint16(6, 0, true);
    end.setUint16(8, this.count, true); end.setUint16(10, this.count, true); end.setUint32(12, size, true); end.setUint32(16, this.offset, true); end.setUint16(20, 0, true);
    return new Blob([...this.parts, ...this.central, end], { type: 'application/zip' });
  }
}

// ── contact sheet: the set as one PNG, a grid of pictures with the names they export under ──
async function contactSheet(ctx) {
  if (RUN || SHEET) return;
  const app = ctx.app, st = app.store, s = st.readonly();
  const all = items(s).map(p => strip(p)), list = all.slice(0, 240);
  if (!list.length) return;
  const S = st.peek(['exportDesk', 'settings']), names = plannedNames(list, S);
  const tag = 'sheet:' + Date.now().toString(36);
  const job = SHEET = { tag, cancelled: false };
  const setSheet = patch => st.set(['ui', 'exportSheet'], Object.assign({}, st.peek(['ui', 'exportSheet']), patch));
  setSheet({ busy: true, done: 0, total: list.length });
  try {
    await app.engine.ensure();
    const n = list.length, cols = n <= 2 ? n : n <= 4 ? 2 : n <= 9 ? 3 : n <= 16 ? 4 : n <= 30 ? 5 : 6;
    const CW = 300, PH = 225, CAP = 44, GAP = 20, M = 48, HEAD = 84, rows = Math.ceil(n / cols);
    const W = M * 2 + cols * CW + (cols - 1) * GAP, H = M + HEAD + rows * (PH + CAP) + (rows - 1) * GAP + M / 2;
    const cv = new OffscreenCanvas(W, H), g = cv.getContext('2d');
    const font = (w, px) => `${w} ${px}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, Arial, sans-serif`;
    const fit = (text, max) => { let t = String(text); if (g.measureText(t).width <= max) return t; while (t.length > 1 && g.measureText(t + '…').width > max) t = t.slice(0, -1); return t + '…'; };
    g.fillStyle = '#fafaf8'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#1d1d1d'; g.font = font(600, 26); g.textBaseline = 'alphabetic';
    g.fillText(fit(`${sourceName(s)} · contact sheet`, W - M * 2), M, M + 28);
    g.fillStyle = '#6a6a6a'; g.font = font(400, 14);
    g.fillText(fit(`${plural(all.length, 'photo')}${all.length > list.length ? ` (the first ${list.length} shown)` : ''} · named with ${S.naming} · ${new Date().toLocaleDateString()} · CraftKit Studio`, W - M * 2), M, M + 54);
    g.fillStyle = '#d9d9d6'; g.fillRect(M, M + HEAD - 14, W - M * 2, 1);
    for (let i = 0; i < n && !job.cancelled; i++) {
      const p = list[i], x = M + (i % cols) * (CW + GAP), y = M + HEAD + Math.floor(i / cols) * (PH + CAP + GAP);
      g.fillStyle = '#ecebe8'; g.fillRect(x, y, CW, PH);
      const dev = st.peek(['dev', p.id]) || st.peek(['devDefaults']);
      const r = await app.engine.render(thumb, app.engine.values(thumb, { file: p.file, dev, w: p.w, h: p.h }), { max: Math.round(CW * 1.5), lane: 'bg', tag });
      if (job.cancelled) { r.bmp && r.bmp.close && r.bmp.close(); break; }
      if (r.bmp) {
        const k = Math.min((CW - 16) / r.w, (PH - 16) / r.h), w = Math.round(r.w * k), hh = Math.round(r.h * k);
        g.save(); g.shadowColor = 'rgba(0,0,0,.25)'; g.shadowBlur = 6; g.shadowOffsetY = 2;
        g.drawImage(r.bmp, x + (CW - w) / 2, y + (PH - hh) / 2, w, hh); g.restore();
        r.bmp.close && r.bmp.close();
      } else { g.fillStyle = '#b3261e'; g.font = font(400, 13); g.fillText(fit(`Could not render: ${r.error || 'unknown'}`, CW - 20), x + 10, y + PH / 2); }
      g.fillStyle = '#1d1d1d'; g.font = font(600, 13); g.fillText(fit(names[i], CW), x, y + PH + 18);
      g.fillStyle = '#6a6a6a'; g.font = font(400, 12);
      g.fillText(fit(`${p.title}${p.rating ? '  ' + '★'.repeat(p.rating) : ''}${p.flag === 'pick' ? '  · pick' : p.flag === 'reject' ? '  · rejected' : ''}`, CW), x, y + PH + 35);
      setSheet({ done: i + 1 });
    }
    if (job.cancelled) { ctx.toast('Contact sheet cancelled'); return; }
    const blob = await cv.convertToBlob({ type: 'image/png' });
    await ctx.save({ filename: `${clean(`Contact Sheet - ${sourceName(s)} - ${stamp(new Date())}`)}.png`, data: blob });
  } catch (e) { ctx.toast('The contact sheet failed: ' + (e && e.message || e), { kind: 'error' }); }
  finally { SHEET = null; setSheet({ busy: false }); }
}

// ── the grid: one cell per photo with its status ──────────────────────────────
const RUN_BADGE = { queued: ['queued', 'Queued', 'Waiting its turn in this export'], active: ['active', 'Exporting', 'Rendering now'], done: ['done', 'Done', 'Written to the zip'], failed: ['failed', 'Failed', ''], cancelled: ['queued', 'Cancelled', 'The export was cancelled'] };
function badgeOf(s, p) {
  const r = s.ui.exportRun;
  if (r.running) { const it = r.items.find(x => x.id === p.id); if (it) { const [kind, text, tip] = RUN_BADGE[it.state] || RUN_BADGE.queued; return { kind, text, tip: it.err || tip }; } }
  const st = statusOf(s, p);
  if (st.s === 'exported') return { kind: 'exported', text: 'Exported', tip: `Exported as ${st.rec.file}${st.rec.w ? ` · ${st.rec.w} × ${st.rec.h}` : ''}${st.rec.bytes ? ` · ${fmtBytes(st.rec.bytes)}` : ''}. Enter marks it Ready to export again.` };
  if (st.s === 'failed') return { kind: 'failed', text: 'Failed', tip: `${st.why || 'The export failed'}. Enter marks it Ready to try again.` };
  if (st.s === 'review') return { kind: 'review', text: 'Review', tip: `${st.why || 'Needs a look'}. Enter marks it Ready; double-click opens it in Develop.` };
  return { kind: 'ready', text: 'Ready', tip: 'Goes out with the next export. R marks it for review.' };
}
function exportCell(p) {
  return ck.html(m => {
    const el = h('div', { class: ['exp-cell', p.flag === 'reject' && 'is-rejected'], 'data-id': p.id });
    const badge = h('span', { class: 'exp-badge' });
    const pic = m.mount(ck.view.thumb({ src: p.thumb, image: thumb, arg: s => ({ file: p.file, dev: s.dev[p.id] || s.devDefaults, w: p.w, h: p.h }), engine: s => isEdited(s, p.id), max: 320 }));
    pic.classList.add('exp-cell-p');
    const ed = h('span', { class: 'exp-cell-e', text: '±', 'data-tip': 'Has Develop adjustments' });
    const foot = h('div', { class: 'exp-cell-f' }, h('span', { class: 'exp-cell-t', text: p.title }), ed);
    m.cell(s => isEdited(s, p.id), on => { ed.hidden = !on; });
    m.cell(s => badgeOf(s, p), b => { badge.className = 'exp-badge is-' + b.kind; badge.textContent = b.text; badge.dataset.tip = b.tip; }, { equals: (a, b) => !!a && !!b && a.kind === b.kind && a.text === b.text && a.tip === b.tip });
    const n = h('span', { class: 'exp-cell-n' });
    m.cell(s => posOf(s, p.id), v => { n.textContent = String(v); });
    el.append(n, badge, pic, foot);
    return el;
  });
}
function emptyText(s) {
  const d = s.exportDesk;
  if (items(s).length) return 'No photo in the set has this status';
  if (d.skip.length) return 'Every photo was left out: Restore in the Export Set panel brings them back';
  if (d.source === 'picks') return 'No picks yet: flag photos with P in Library or Cull';
  if (d.source === 'selection') return 'No photos chosen: select some, then click Selected photos';
  if (String(d.source).startsWith('collection:')) return 'This collection is empty';
  return 'The Library filter shows no photos';
}
function countsText(s) {
  const r = s.ui.exportRun, sh = s.ui.exportSheet;
  if (r.running) return `Exporting ${Math.min(r.done + 1, r.total)} of ${r.total}…`;
  if (sh.busy) return `Contact sheet: ${sh.done} of ${sh.total}…`;
  const c = tally(s);
  if (!c.total) return 'The export set is empty';
  return [`${c.ready} to export`, c.review && `${c.review} need${c.review === 1 ? 's' : ''} review`, c.exported && `${c.exported} exported`, c.failed && `${c.failed} failed`].filter(Boolean).join(' · ');
}

// ── panels ────────────────────────────────────────────────────────────────
const count = n => h('span', { class: 'exp-count', text: String(n) });
function sourceRow(it) {
  return ck.html(m => {
    const r = h('div', { class: 'exp-src', 'data-tip': it.tip || '' }, icon(it.icon, 12), h('span', { class: 'exp-src-n', text: it.name }), count(it.n));
    m.cell(s => (s.exportDesk.source || 'filter') === it.id, on => r.classList.toggle('is-on', on));
    return r;
  });
}
function setPanel() {
  return ck.panel('export-set', { title: 'Export Set' },
    ck.view.list(s => {
      const d = s.exportDesk, sel = selectedIds(s).length;
      return [
        { id: 'selection', name: 'Selected photos', icon: 'target', n: d.source === 'selection' ? s.catalog.photos.filter(p => d.chosen.includes(p.id)).length : sel, tip: d.source === 'selection' ? `Taken from the selection. Click to take the current selection (${sel}) instead.` : `Take the ${plural(sel, 'selected photo')} as the set` },
        { id: 'picks', name: 'Picks', icon: 'pick', n: s.catalog.photos.filter(p => p.flag === 'pick').length, tip: 'Every photo flagged as a pick (P); follows the flags' },
        { id: 'filter', name: 'All in current filter', icon: 'filter', n: s.catalog.filtered.length, tip: 'What the Library grid shows; follows its source and filter' },
      ];
    }, { id: 'export-sources', class: 'exp-srcs', rowHeight: 22, select: { bind: s => s.ui.exportSrcSel, mode: 'single' }, onSelect: (sel, ctx) => chooseSource(ctx, sel.primary), row: sourceRow }),
    ck.section('Collections', {},
      ck.view.list(s => s.catalog.collections.map(c => ({ id: 'collection:' + c.id, name: c.name, icon: 'folder', n: c.ids.length, tip: `The ${c.name} collection; follows it as it changes` })),
        { id: 'export-collections', class: 'exp-srcs', rowHeight: 22, select: { bind: s => s.ui.exportColSel, mode: 'single' }, onSelect: (sel, ctx) => chooseSource(ctx, sel.primary), row: sourceRow, empty: 'No collections' })),
    ck.divider(),
    ck.text(s => `${plural(items(s).length, 'photo')} in the set${s.exportDesk.skip.length ? ` · ${s.exportDesk.skip.length} left out` : ''}`, { dim: true }),
    ck.ui.command('export.restore', { small: true, hidden: s => !s.exportDesk.skip.length }));
}
function recipePanel() {
  const quick = (text, tip, groups) => ck.ui.button(text, { small: true, quiet: true, tip, run: ctx => {
    const next = Object.fromEntries(GROUPS.map(g => [g, groups.includes(g)]));
    if (GROUPS.every(g => !!ctx.app.store.peek(['exportDesk', 'recipe', 'groups', g]) === next[g])) return;
    ctx.tx(`Recipe: ${text} Groups`, t => { t.exportDesk.recipe.groups = next; }, NOCH);
  } });
  return ck.panel('export-recipe', { title: 'Recipe' },
    ck.row({ class: 'exp-recipe' },
      ck.view.thumb({ class: 'exp-recipe-p', src: s => { const p = recipeSource(s); return p ? p.thumb : ''; }, image: thumb, arg: s => { const p = recipeSource(s); return p ? { file: p.file, dev: s.dev[p.id] || s.devDefaults } : null; }, engine: s => { const p = recipeSource(s); return !!p && isEdited(s, p.id); }, max: 160 }),
      ck.column({ gap: 2, grow: 1 },
        ck.text(s => { const p = recipeSource(s); return p ? p.title : 'No photo to copy from'; }, { strong: true }),
        ck.text(s => { const p = recipeSource(s); return p ? `${isEdited(s, p.id) ? 'Edited' : 'Not edited'} · copies ${groupsOn(s).length} of ${GROUPS.length} groups` : 'Select a photo'; }, { dim: true }))),
    ck.ui.select(s => {
      const prim = primaryOf(s), from = s.exportDesk.recipe.from;
      const out = [{ value: null, label: prim ? `The primary photo (${prim.title})` : 'The primary photo' }].concat(items(s).map(p => ({ value: p.id, label: p.title })));
      if (from && !out.some(o => o.value === from)) { const p = s.catalog.photos.find(x => x.id === from); out.push({ value: from, label: `${p ? p.title : from} (not in the set)` }); }
      return out;
    }, { bind: s => s.exportDesk.recipe.from, label: 'Copy from', compact: true, historyLabel: 'Recipe Source', class: 'exp-from' }),
    ck.section('Settings to copy', { aside: ck.row({ gap: 0 }, quick('Usual', 'Everything but Crop, Spot Removal and Masks', GROUPS.filter(g => !LOCAL_GROUPS.includes(g))), quick('All', 'Every group', GROUPS), quick('None', 'No group', [])) },
      ck.grid({ cols: 2, gap: 0, class: 'exp-groups' }, ...GROUPS.map(g => ck.ui.checkbox(g, { bind: s => s.exportDesk.recipe.groups[g], historyLabel: `Recipe ${g}` })))),
    ck.ui.checkbox('Mark changed photos for review', { bind: s => s.exportDesk.recipe.review, historyLabel: 'Recipe Marks for Review' }),
    ck.ui.command('export.applyRecipe', { primary: true, class: 'exp-wide' }));
}
function settingsPanel() {
  return ck.panel('export-settings', { title: 'Export Settings', aside: ck.text(s => { const id = presetOf(s); return id ? EXPORT_PRESETS.find(p => p.id === id).name : 'Custom'; }, { dim: true }) },
    ck.view.list(() => EXPORT_PRESETS, {
      id: 'export-presets', class: 'exp-presets', rowHeight: 22, select: { bind: s => s.ui.exportPresetSel, mode: 'single' },
      onSelect: (sel, ctx) => applyPreset(ctx, sel.primary),
      row: pr => ck.html(m => { const r = h('div', { class: 'exp-preset' }, h('span', { class: 'exp-preset-c' }, icon('check', 10)), h('span', { class: 'exp-preset-n', text: pr.name }), h('span', { class: 'exp-preset-s', text: pr.spec })); m.cell(s => presetOf(s) === pr.id, on => r.classList.toggle('is-on', on)); return r; }),
    }),
    ck.row({ class: 'exp-field' }, ck.text('Format', { dim: true }), ck.ui.segmented(FORMATS, { bind: s => s.exportDesk.settings.format, small: true, historyLabel: 'Format' })),
    ck.ui.slider(1, 100, { bind: s => s.exportDesk.settings.quality, label: 'Quality', step: 1, reset: 85, labelWidth: 62, historyLabel: 'Quality', disabled: s => s.exportDesk.settings.format === 'png', why: 'PNG is lossless: quality does not apply' }),
    ck.row({ class: 'exp-field' }, ck.text('Size', { dim: true }), ck.ui.checkbox('Resize to fit the long edge', { bind: s => s.exportDesk.settings.resize, historyLabel: 'Resize to Fit' })),
    ck.row({ class: 'exp-field exp-num' }, ck.ui.number({ bind: s => s.exportDesk.settings.longEdge, label: 'Long edge', unit: 'px', min: 64, max: 4096, step: 1, decimals: 0, historyLabel: 'Long Edge', disabled: s => !s.exportDesk.settings.resize, why: 'Tick Resize to choose a size; off, photos keep their own size' }),
      ck.text(s => (s.exportDesk.settings.resize ? 'never enlarged' : 'own size'), { dim: true, size: 'small' })),
    ck.row({ class: 'exp-field' }, ck.text('Crop', { dim: true }), ck.ui.toggle('Square, from the centre', { bind: s => s.exportDesk.settings.square, historyLabel: 'Square Crop' })),
    ck.divider(),
    ck.row({ class: 'exp-field exp-name' }, ck.ui.textField({ bind: s => s.exportDesk.settings.naming, label: 'Name', placeholder: '{seq}-{title}', commit: 'live', historyLabel: 'File Naming' })),
    ck.row({ class: 'exp-field exp-tokens' }, ck.text('', { dim: true }), ...TOKENS.map(tk => ck.ui.button(`{${tk.id}}`, { small: true, quiet: true, tip: `Add {${tk.id}}: ${tk.tip}`, run: ctx => addToken(ctx, tk.id) }))),
    ck.row({ class: 'exp-field exp-first' }, ck.text('First file', { dim: true }), ck.text(s => naming(s).first, { mono: true, strong: true })),
    ck.text(s => naming(s).warn, { dim: true, wrap: true, class: 'exp-warn', hidden: s => !naming(s).warn }),
    ck.text('sRGB, 8-bit, no metadata, never enlarged. No TIFF writer in the browser: PNG is the lossless choice.', { dim: true, wrap: true, class: 'exp-note' }));
}
function queueRow(it) {
  return ck.html(() => {
    const meta = it.state === 'done' ? `${it.w} × ${it.h} · ${fmtBytes(it.bytes)}` : it.state === 'failed' ? 'failed' : it.state === 'active' ? 'rendering…' : it.state === 'cancelled' ? 'cancelled' : it.state === 'queued' ? 'queued' : '';
    return h('div', { class: ['exp-qr', 'is-' + it.state], 'data-tip': it.err || '' }, h('span', { class: 'exp-qs' }), h('span', { class: 'exp-qr-n', text: it.name }), h('span', { class: 'exp-qr-m', text: meta }));
  });
}
function progress() {
  return ck.html(m => {
    const el = h('div', { class: 'exp-prog-w' });
    const bar = h('div', { class: 'exp-prog', role: 'progressbar', 'aria-label': 'Export progress', 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('div', { class: 'exp-prog-f' }));
    const txt = h('div', { class: 'exp-prog-t' });
    el.append(bar, txt);
    m.cell(s => {
      const r = s.ui.exportRun, sh = s.ui.exportSheet;
      if (sh.busy) return { on: true, k: sh.total ? sh.done / sh.total : 0, cls: '', text: `Contact sheet: ${sh.done} of ${sh.total}` };
      if (!r.total) return { on: false };
      const k = r.total ? r.done / r.total : 0;
      if (r.running) {
        const left = r.done ? Math.round((Date.now() - r.started) / r.done * (r.total - r.done) / 1000) : null;
        return { on: true, k, cls: '', text: `${r.done} of ${r.total} · ${fmtBytes(r.bytes)}${left == null ? '' : left < 1 ? ' · almost done' : ` · about ${left < 60 ? left + ' s' : Math.round(left / 60) + ' min'} left`}` };
      }
      if (r.cancelled) return { on: true, k, cls: 'is-cancelled', text: r.note || 'Cancelled' };
      if (r.last) return { on: true, k: 1, cls: r.last.failed ? 'is-partial' : 'is-done', text: `${plural(r.last.count, 'photo')}${r.last.failed ? `, ${r.last.failed} failed` : ''} · ${fmtBytes(r.last.bytes)} · ${r.last.filename}${r.note ? '. ' + r.note : ''}` };
      return { on: true, k, cls: 'is-partial', text: r.note || '' };
    }, v => {
      el.hidden = !v.on; if (!v.on) return;
      bar.className = 'exp-prog ' + (v.cls || '');
      bar.firstChild.style.width = Math.round(v.k * 100) + '%';
      bar.setAttribute('aria-valuenow', String(Math.round(v.k * 100)));
      txt.textContent = v.text;
    }, { equals: (a, b) => JSON.stringify(a) === JSON.stringify(b) });
    return el;
  });
}
function queueItems(s) {
  const r = s.ui.exportRun;
  if (r.items.length) return r.items;
  const list = toExport(s), names = plannedNames(list, s.exportDesk.settings);
  return list.map((p, i) => ({ id: p.id, name: names[i], state: 'planned' }));
}
function queuePanel() {
  return ck.panel('export-queue', { title: 'Queue', aside: ck.text(s => { const r = s.ui.exportRun; return r.running ? `${r.done} / ${r.total}` : `${toExport(s).length} ready`; }, { dim: true }) },
    ck.row({ class: 'exp-q-act' },
      ck.ui.command('export.start', { primary: true, grow: 1, hidden: s => s.ui.exportRun.running || s.ui.exportSheet.busy }),
      ck.ui.command('export.cancel', { grow: 1, text: 'Cancel', hidden: s => !s.ui.exportRun.running && !s.ui.exportSheet.busy })),
    progress(),
    ck.text(s => (s.ui.exportRun.items.length ? (s.ui.exportRun.running ? 'This export' : 'Last export') : 'Up next, with the names they get'), { dim: true, size: 'small' }),
    ck.view.list(s => queueItems(s), {
      id: 'export-queue-list', class: 'exp-q', rowHeight: 22, select: { bind: s => s.ui.exportQueueSel, mode: 'single' },
      onSelect: (sel, ctx) => { const id = sel.primary; if (id && items(ctx.state).some(p => p.id === id)) ctx.set({ ui: { selection: { ids: [id], primary: id, anchor: id } } }); },
      row: it => queueRow(it),
      empty: s => (items(s).length ? 'Nothing is Ready. Select photos and press Enter.' : 'The export set is empty'),
    }),
    ck.row({ class: 'exp-q-more' }, ck.ui.command('export.saveAgain', { small: true, hidden: s => !s.ui.exportRun.last }), ck.ui.command('export.contactSheet', { small: true }), ck.spacer(), ck.ui.command('export.clearQueue', { small: true, quiet: true, text: 'Clear', hidden: s => !s.ui.exportRun.items.length || s.ui.exportRun.running })));
}

// ── commands, menus, keys, the module ──────────────────────────────────────
export function install(shell) {
  const busy = s => s.ui.exportRun.running || s.ui.exportSheet.busy;
  const notHere = s => s.view.module !== 'export';   // review marks belong to the desk; Library's Photo menu stays about photos
  shell.derive('ui.exportSet', setPhotos);
  shell.commands(c => c
    .add('export.start', {
      label: s => { const n = toExport(s).length; return n ? `Export ${plural(n, 'Photo')}` : 'Export'; }, menu: 'File', icon: 'export',
      enabled: s => !busy(s) && toExport(s).length > 0,
      why: s => (busy(s) ? `An export is running (${ck.keyLabel('Mod+.')} cancels it)` : !items(s).length ? 'The export set is empty: choose a source in the Export Set panel' : 'No photo is Ready: select some and press Enter'),
      run: ctx => startExport(ctx),
    })
    .add('export.cancel', { label: 'Cancel Export', menu: 'File', icon: 'stop', enabled: busy, why: 'No export is running', run: ctx => cancelRun(ctx) })
    .add('export.useSelection', { label: s => `Export Set from Selection (${selectedIds(s).length})`, menu: 'File', icon: 'target', enabled: s => selectedIds(s).length > 0 && !busy(s), why: s => (busy(s) ? 'An export is running' : 'Select photos first'), run: ctx => { chooseSource(ctx, 'selection'); ctx.go('export'); } })
    .add('export.saveAgain', { module: 'export', label: 'Save the Zip Again', menu: 'File', enabled: s => !!s.ui.exportRun.last && !s.ui.exportRun.running, why: 'Nothing exported in this session yet', run: ctx => saveLast(ctx) })
    .add('export.contactSheet', { module: 'export', label: 'Contact Sheet (PNG)…', menu: 'File', icon: 'grid', enabled: s => items(s).length > 0 && !busy(s), why: s => (busy(s) ? 'An export is running' : 'The export set is empty'), run: ctx => contactSheet(ctx) })
    .add('export.clearQueue', { module: 'export', label: 'Clear the Export Queue', enabled: s => !!s.ui.exportRun.items.length && !s.ui.exportRun.running, why: 'Nothing to clear', run: ctx => ctx.set({ ui: { exportRun: RUN0 } }) })
    .add('export.approve', { module: 'export', label: s => { const n = inSet(s).length; return n > 1 ? `Mark ${n} Ready for Export` : 'Mark Ready for Export'; }, menu: 'Photo', icon: 'check', hidden: notHere, enabled: s => inSet(s).length > 0, why: 'Select photos in the export set first', run: ctx => mark(ctx, 'ready') })
    .add('export.review', { module: 'export', label: s => { const n = inSet(s).length; return n > 1 ? `Mark ${n} for Review` : 'Mark for Review'; }, menu: 'Photo', icon: 'warn', hidden: notHere, enabled: s => inSet(s).length > 0, why: 'Select photos in the export set first', run: ctx => mark(ctx, 'review') })
    .add('export.exclude', { module: 'export', label: s => { const n = inSet(s).length; return n > 1 ? `Leave ${n} Out of the Export` : 'Leave Out of the Export'; }, menu: 'Photo', icon: 'minus', hidden: notHere, enabled: s => inSet(s).length > 0, why: 'Select photos in the export set first', run: ctx => { const ids = inSet(ctx.state).slice(); const cur = ctx.app.store.peek(['exportDesk', 'skip']); ctx.tx(ids.length > 1 ? `Leave ${ids.length} Out` : 'Leave Out', t => { t.exportDesk.skip = [...new Set(cur.concat(ids))]; }, NOCH); } })
    .add('export.restore', { module: 'export', label: s => `Bring Back ${plural(s.exportDesk.skip.length, 'Photo')}`, enabled: s => s.exportDesk.skip.length > 0, why: 'No photo was left out', run: ctx => ctx.tx('Bring Back Left-Out Photos', t => { t.exportDesk.skip = []; }, NOCH) })
    .add('export.applyRecipe', { module: 'export',
      label: s => `Apply Recipe to ${plural(recipeTargets(s).length, 'Photo')}`, menu: 'Settings', icon: 'sync',
      enabled: s => !busy(s) && !!recipeSource(s) && groupsOn(s).length > 0 && recipeTargets(s).length > 0,
      why: s => (busy(s) ? 'Wait for the export to finish' : !recipeSource(s) ? 'Select the photo to copy from' : !groupsOn(s).length ? 'Tick at least one group of settings to copy' : 'The export set has no other photos'),
      run: ctx => applyRecipe(ctx),
    })
    .add('export.recipeFrom', { module: 'export', label: 'Use as Recipe Source', menu: 'Settings', enabled: s => !!primaryOf(s), why: 'Select a photo first', checked: s => !!s.exportDesk.recipe.from && s.exportDesk.recipe.from === (s.ui.selection && s.ui.selection.primary), run: ctx => { const p = primaryOf(ctx.state); ctx.tx(`Recipe Source: ${p.title}`, t => { t.exportDesk.recipe.from = p.id; }, NOCH); } })
    .add('export.openInDevelop', { module: 'export', label: 'Edit in Develop', icon: 'adj', enabled: s => !!primaryOf(s), why: 'Select a photo first', run: ctx => openInDevelop(ctx, primaryOf(ctx.state).id) })
    .add('export.selectAll', { module: 'export', label: 'Select the Whole Export Set', palette: false, run: ctx => { const L = shown(ctx.state); if (!L.length) return; const prim = ctx.state.ui.selection.primary; ctx.set({ ui: { selection: { ids: L.map(p => p.id), primary: L.some(p => p.id === prim) ? prim : L[0].id, anchor: null } } }); } }));
  shell.menus(m => m
    .menu('File', ['export.useSelection', 'export.start', 'export.cancel', 'export.saveAgain', 'export.contactSheet'])
    .menu('Photo', ['export.approve', 'export.review', 'export.exclude'])
    .menu('Settings', ['export.applyRecipe', 'export.recipeFrom'])
    .menu('Window', ['module.export']));

  shell.module('export', m => m.label('Export').key('Mod+Shift+E').icon('export')
    .left(ck.dock.column({ width: 220 }, setPanel()))
    .center(ck.column({ class: 'exp-center', grow: 1 },
      ck.bar({ class: 'exp-head' },
        ck.text(s => sourceName(s), { strong: true, class: 'exp-head-t' }),
        ck.text(s => plural(items(s).length, 'photo'), { dim: true }),
        ck.spacer(),
        ck.ui.segmented(SHOW, { bind: s => s.view.exportShow, small: true })),
      ck.view.grid(s => shown(s), {
        id: 'export-grid', class: 'exp-grid',
        cell: p => exportCell(p),
        size: s => s.view.exportThumb, caption: true, aspect: 1 / 1.08,
        select: { bind: s => s.ui.selection, mode: 'multi' },
        keys: { Enter: 'export.approve', A: 'export.approve', R: 'export.review', Delete: 'export.exclude', Backspace: 'export.exclude' },
        activate: (p, ctx) => openInDevelop(ctx, p.id),
        context: ['export.approve', 'export.review', 'export.exclude', '-', 'export.openInDevelop', 'export.recipeFrom', '-', 'export.applyRecipe'],
        empty: s => emptyText(s),
      })))
    .right(ck.dock.column({ width: 290 }, recipePanel(), settingsPanel(), queuePanel()))
    .toolbar(ck.bar({ class: 'exp-tb' },
      ck.toolbar(['export.approve', 'export.review', 'export.exclude']),
      ck.text(s => countsText(s), { class: 'exp-counts' }),
      ck.html(m => { const bar = h('div', { class: 'exp-prog exp-tb-prog', role: 'progressbar', 'aria-label': 'Export progress' }, h('div', { class: 'exp-prog-f' })); m.cell(s => { const r = s.ui.exportRun, sh = s.ui.exportSheet; return r.running ? r.done / Math.max(1, r.total) : sh.busy ? sh.done / Math.max(1, sh.total) : -1; }, k => { bar.hidden = k < 0; bar.firstChild.style.width = Math.round(Math.max(0, k) * 100) + '%'; bar.setAttribute('aria-valuenow', String(Math.round(Math.max(0, k) * 100))); }); return bar; }),
      ck.spacer(),
      ck.row({ class: 'exp-tb-size' }, ck.ui.slider(90, 320, { bind: s => s.view.exportThumb, label: 'Size', compact: true, labelWidth: 30, format: v => Math.round(v) + '' })),
      ck.ui.command('export.cancel', { small: true, text: 'Cancel', hidden: s => !busy(s) }),
      ck.ui.command('export.start', { primary: true, small: true, icon: 'export', label: s => (toExport(s).length ? `Export ${toExport(s).length}` : 'Export'), hidden: busy })))
    .keys({ 'Mod+E': 'export.start', 'Mod+.': 'export.cancel', A: 'export.approve', R: 'export.review', 'Mod+Shift+S': 'export.applyRecipe', 'Mod+A': 'export.selectAll' })
    .onEnter(() => requestAnimationFrame(() => { const g = document.querySelector('.exp-grid'), a = document.activeElement || document.body; if (g && !a.closest('.ck-side')) g.focus({ preventScroll: true }); })));
}
