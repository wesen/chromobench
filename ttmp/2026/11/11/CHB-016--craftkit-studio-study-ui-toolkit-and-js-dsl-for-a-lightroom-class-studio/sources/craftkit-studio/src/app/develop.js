// Develop: LightCraft's settings as panels (built at build time from the crate's control specs), the viewport with
// before/after, the histogram you can drag, presets with Amount, snapshots, per-photo history, and the tools
// (crop, spot removal, masks). U-02, U-03, U-04 and U-15 in the design.
import { ck } from '../shell/index.js';
import { h, icon, svgEl } from '../shell/ui/dom.js';
import { spec, controlPath, devOf, primaryId, PRESETS, PROFILES, BANDS, DEFAULTS, scalePreset, merge, sectionOn, fmtSigned, isEdited, SYNC_GROUPS, syncSettings } from './develop-model.js';
import { render, before, uncroppedRender } from './engine-graphs.js';
import { primaryOf, selectedIds, filtered } from './catalog.js';
import { photoCell, histogramPanel, navigatorPanel, step, CULL_KEYS } from './library.js';
import { cropTool, healTool, maskTools, cropOptions, healOptions, masksPanel } from './develop-tools.js';
import { scopesPanel, referenceRender } from './develop-scopes.js';

// a slider bound to the edited photo's setting, from the crate's spec (range, step, default, track colours)
export function devSlider(id, opts = {}) {
  const c = spec(id), path = controlPath(id);
  return ck.ui.slider(c.min, c.max, Object.assign({
    bind: s => path.reduce((o, k) => o[k], devOf(s)),
    label: opts.label || c.label,
    step: c.step, decimals: c.decimals, reset: c.default,
    bipolar: c.min < 0 && c.max > 0,
    track: c.track && c.track.kind !== 'plain' ? c.track : undefined,
    historyLabel: opts.historyLabel || c.label,
    disabled: s => !primaryId(s),
    format: id === 'wb.temp' ? v => Math.round(v) + '' : undefined,
    scale: id === 'wb.temp' ? 'log' : undefined,
  }, opts));
}
const SECTION_TITLE = { curve: 'Tone Curve', mixer: 'HSL / Color', grading: 'Color Grading', detail: 'Detail', optics: 'Lens Corrections', geometry: 'Transform', calibration: 'Calibration' };
const sw = sec => ({ value: s => sectionOn(devOf(s), sec), toggle: ctx => { const id = primaryId(ctx.state); if (!id) return; const d = devOf(ctx.state); const on = sectionOn(d, sec); ctx.tx(`${SECTION_TITLE[sec] || sec}: ${on ? 'Off' : 'On'}`, t => { t.dev[id].disabled_sections = on ? (d.disabled_sections || []).concat([sec]) : (d.disabled_sections || []).filter(x => x !== sec); }); } });
const devBind = path => s => path.reduce((o, k) => o[k], devOf(s));

// ── panels ──
function basicPanel() {
  return ck.panel('basic', { title: 'Basic' },
    ck.row({ class: 'dv-treat' }, ck.text('Treatment', { dim: true }), ck.ui.segmented([{ value: 'color', label: 'Color' }, { value: 'bw', label: 'Black & White' }], { bind: devBind(['treatment']), small: true, historyLabel: 'Treatment' })),
    ck.row({ class: 'dv-treat' }, ck.text('Profile', { dim: true }), ck.ui.select(PROFILES.map(p => ({ value: p, label: p.replace(/^lc\./, '').replace(/[.-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) })), { bind: devBind(['profile', 'id']), compact: true, historyLabel: 'Profile', grow: 1 })),
    devSlider('profile.amount', { label: 'Amount' }),
    ck.section('White Balance', { reset: true, aside: ck.row({ gap: 4 }, ck.ui.select([{ value: 'asShot', label: 'As Shot' }, { value: 'auto', label: 'Auto' }, { value: 'custom', label: 'Custom' }], { bind: devBind(['wb', 'mode']), compact: true, historyLabel: 'White Balance' }), ck.ui.iconButton('eyedropper', { run: 'tool.wb', small: true, tip: 'White Balance Selector (W)', checked: s => s.ui.tool === 'wb' })) },
      devSlider('wb.temp'), devSlider('wb.tint')),
    ck.section('Tone', { reset: true, aside: ck.ui.command('develop.auto', { small: true, text: 'Auto' }) },
      ...['light.exposure', 'light.contrast', 'light.highlights', 'light.shadows', 'light.whites', 'light.blacks'].map(id => devSlider(id, { altPreview: ['light.exposure', 'light.whites', 'light.blacks'].includes(id) ? 'clipping' : null }))),
    ck.section('Presence', { reset: true }, ...['effects.texture', 'effects.clarity', 'effects.dehaze', 'color.vibrance', 'color.saturation'].map(id => devSlider(id))));
}
function curvePanel() {
  return ck.panel('tone-curve', { title: 'Tone Curve', switch: sw('curve') },
    ck.ui.curve({
      bind: s => devOf(s).curve,
      channels: { RGB: 'master', Red: 'red', Green: 'green', Blue: 'blue' },
      parametric: ck.column({ gap: 1 }, ...['curve.highlights', 'curve.lights', 'curve.darks', 'curve.shadows'].map(id => devSlider(id)), ck.divider(), ...['curve.splitShadows', 'curve.splitMid', 'curve.splitHighlights'].map(id => devSlider(id, { label: { 'curve.splitShadows': 'Split 1', 'curve.splitMid': 'Split 2', 'curve.splitHighlights': 'Split 3' }[id] }))),
      backdrop: s => s.ui.hist, mode: s => s.workspace.curveMode,
    }),
    devSlider('curve.refineSaturation', { label: 'Refine Sat.' }));
}
function mixerPanel() {
  const tab = attr => ck.column({ gap: 1 }, ...BANDS.map(b => devSlider(`mixer.${b}.${attr}`, { label: b[0].toUpperCase() + b.slice(1), historyLabel: `${b[0].toUpperCase() + b.slice(1)} ${{ hue: 'Hue', sat: 'Saturation', lum: 'Luminance' }[attr]}` })));
  return ck.panel('hsl', { title: 'HSL / Color', switch: sw('mixer') },
    ck.match(s => devOf(s).treatment, {
      bw: ck.column({ gap: 1 }, ck.text('Black & White Mix', { dim: true }), ...BANDS.map(b => devSlider(`bw.${b}`, { label: b[0].toUpperCase() + b.slice(1), historyLabel: `B&W ${b}` }))),
      default: ck.tabs({ Hue: tab('hue'), Saturation: tab('sat'), Luminance: tab('lum') }, { id: 'hsl-tabs', small: true }),
    }));
}
function gradingPanel() {
  const wheel = (region, size) => ck.ui.wheel({ bind: s => devOf(s).grading[region], label: region[0].toUpperCase() + region.slice(1), lum: true, size, historyLabel: `Color Grading` });
  return ck.panel('color-grading', { title: 'Color Grading', switch: sw('grading') },
    ck.ui.segmented([{ value: '3-way', label: '3-Way' }, { value: 'shadows', label: 'Shadows' }, { value: 'midtones', label: 'Midtones' }, { value: 'highlights', label: 'Highlights' }, { value: 'global', label: 'Global' }], { bind: s => s.workspace.gradeView, small: true }),
    ck.match(s => s.workspace.gradeView || '3-way', {
      '3-way': ck.grid({ cols: 2, class: 'dv-wheels' }, ck.cell({ span: 2 }, wheel('midtones', 104)), wheel('shadows', 92), wheel('highlights', 92)),
      shadows: wheel('shadows', 150), midtones: wheel('midtones', 150), highlights: wheel('highlights', 150), global: wheel('global', 150),
    }),
    devSlider('grading.blending'), devSlider('grading.balance'));
}
// inside a section the label drops what the section already says (Noise Reduction ▸ "Color", Defringe ▸ "Purple"),
// as Lightroom's panels do; the history keeps the full name
const SHORT = { 'detail.nrLuminance': 'Luminance', 'detail.nrColor': 'Color', 'detail.nrColorDetail': 'Color Detail', 'detail.nrColorSmoothness': 'Smoothness', 'optics.defringePurple': 'Purple', 'optics.defringeGreen': 'Green', 'calibration.shadowsTint': 'Tint', 'calibration.redHue': 'Red Hue', 'calibration.redSat': 'Red Sat.', 'calibration.greenHue': 'Green Hue', 'calibration.greenSat': 'Green Sat.', 'calibration.blueHue': 'Blue Hue', 'calibration.blueSat': 'Blue Sat.', 'vignette.highlights': 'Highlights' };
const simplePanel = (id, title, sec, groups) => ck.panel(id, { title, switch: sec ? sw(sec) : undefined, open: false },
  ...groups.map(([name, ids]) => ck.section(name, { reset: true }, ...ids.map(x => (typeof x === 'string' ? devSlider(x, SHORT[x] ? { label: SHORT[x] } : {}) : x)))));
function detailPanel() {
  return simplePanel('detail', 'Detail', 'detail', [['Sharpening', ['detail.sharpenAmount', 'detail.sharpenRadius', 'detail.sharpenDetail', 'detail.sharpenMasking']], ['Noise Reduction', ['detail.nrLuminance', 'detail.nrDetail', 'detail.nrContrast', 'detail.nrColor', 'detail.nrColorDetail', 'detail.nrColorSmoothness']]]);
}
function lensPanel() {
  return simplePanel('lens', 'Lens Corrections', 'optics', [['Manual', ['optics.distortion', 'optics.vignetting', 'optics.vignettingMidpoint']], ['Defringe', ['optics.defringePurple', 'optics.defringeGreen', ck.ui.checkbox('Remove Chromatic Aberration', { bind: devBind(['optics', 'remove_ca']) })]]]);
}
function transformPanel() {
  return simplePanel('transform', 'Transform', 'geometry', [['Upright', [ck.ui.segmented(['off', 'auto', 'level', 'vertical', 'full'].map(v => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })), { bind: devBind(['geometry', 'upright']), small: true, historyLabel: 'Upright' })]], ['Manual', ['geometry.vertical', 'geometry.horizontal', 'geometry.rotate', 'geometry.aspect', 'geometry.scale', 'geometry.offsetX', 'geometry.offsetY']]]);
}
function effectsPanel() {
  return simplePanel('effects', 'Effects', null, [['Post-Crop Vignetting', ['vignette.amount', 'vignette.midpoint', 'vignette.roundness', 'vignette.feather', 'vignette.highlights']], ['Grain', ['grain.amount', 'grain.size', 'grain.roughness']]]);
}
function calibrationPanel() {
  return simplePanel('calibration', 'Calibration', 'calibration', [['Shadows', ['calibration.shadowsTint']], ['Primaries', ['calibration.redHue', 'calibration.redSat', 'calibration.greenHue', 'calibration.greenSat', 'calibration.blueHue', 'calibration.blueSat']]]);
}

// ── presets: grouped, Amount scales them; a click applies to the edited photo ──
let presetCache = new Map();
export async function presetSettings(app, id) {
  if (!presetCache.has(id)) presetCache.set(id, app.engine.wasm('ck_light', 'preset', { name: id }).then(r => r.settings));
  return presetCache.get(id);
}
function presetsPanel() {
  const groups = [...new Set(PRESETS.map(p => p.group))];
  const items = groups.map(g => ({ id: 'g:' + g, name: g, group: true, kids: PRESETS.filter(p => p.group === g).map(p => ({ id: p.id, name: p.name })) }));
  return ck.panel('presets', { title: 'Presets' },
    ck.ui.slider(0, 200, { bind: s => s.ui.presetAmount, label: 'Amount', reset: 100, step: 1, compact: true, labelWidth: 54 }),
    ck.view.tree(() => items, {
      id: 'presets-tree', rowHeight: 22, children: it => it.kids || null,
      row: it => ck.html(() => h('div', { class: ['dv-preset', it.group && 'is-group'] }, h('span', { text: it.name }))),
      select: { mode: 'single' },
      activate: (it, ctx) => { if (!it.group) applyPreset(ctx, it); },
      onSelect: (sel, ctx) => { const it = PRESETS.find(p => p.id === sel.primary); if (it) applyPreset(ctx, it); },
    }));
}
export async function applyPreset(ctx, p) {
  const id = primaryId(ctx.state); if (!id) { ctx.toast('Select a photo first'); return; }
  const settings = await presetSettings(ctx.app, p.id);
  const k = (ctx.state.ui.presetAmount ?? 100) / 100;
  const cur = ctx.state.dev[id] || ctx.state.devDefaults;
  ctx.tx(`Preset: ${p.name}`, t => { t.dev[id] = merge(cur, scalePreset(settings, DEFAULTS, k)); }, { channel: id, snapPath: ['dev', id], detail: k !== 1 ? `${Math.round(k * 100)}%` : undefined });
}
function snapshotsPanel() {
  return ck.panel('snapshots', { title: 'Snapshots', menu: ['develop.snapshot'], open: false },
    ck.view.list(s => { const id = primaryId(s); return (id && s.snapshots[id]) || []; }, {
      rowHeight: 22, select: { mode: 'none' },
      row: sn => ck.html(() => h('div', { class: 'dv-snap' }, icon('history', 11), h('span', { text: sn.name }))),
      activate: (sn, ctx) => { const id = primaryId(ctx.state); ctx.tx(`Snapshot: ${sn.name}`, t => { t.dev[id] = sn.dev; }, { channel: id, snapPath: ['dev', id] }); },
      context: (s, sn) => [{ label: 'Rename Snapshot…', run: (x, ctx) => renameSnapshot(ctx, sn) }, { label: 'Delete Snapshot', run: (x, ctx) => { const id = primaryId(ctx.state); ctx.tx('Delete Snapshot', t => { t.snapshots[id] = (ctx.state.snapshots[id] || []).filter(q => q.name !== sn.name); }); } }],
      empty: 'No snapshots. + saves the current settings',
    }),
    ck.ui.command('develop.snapshot', { small: true, icon: 'plus', text: 'New Snapshot' }));
}
function renameSnapshot(ctx, sn) {
  const input = h('input', { class: 'ck-field-i', value: sn.name, 'aria-label': 'Name' });
  ctx.dialog({ title: 'Rename Snapshot', body: input, buttons: [{ label: 'Cancel' }, { label: 'Rename', primary: true, run: () => { const id = primaryId(ctx.state), name = input.value.trim() || sn.name; ctx.tx('Rename Snapshot', t => { t.snapshots[id] = (ctx.state.snapshots[id] || []).map(q => (q.name === sn.name ? Object.assign({}, q, { name }) : q)); }); } }] });
}
function historyPanel() {
  return ck.panel('history', { title: 'History', menu: ['develop.clearHistory'] }, ck.html(m => {
    const app = m.app;
    const el = h('div', { class: 'dv-hist' });
    const draw = () => {
      const id = primaryId(m.store.readonly());
      const ch = id ? app.history.channels.get(id) : null;
      if (!ch || !ch.list.length) { el.replaceChildren(h('div', { class: 'ck-empty', text: 'No edits yet' })); return; }
      el.replaceChildren(...ch.list.map((it, i) => ({ it, i })).reverse().map(({ it, i }) => {
        const r = h('div', { class: ['dv-hist-r', i === ch.pos && 'is-on', i > ch.pos && 'is-undone'], role: 'button', tabindex: '-1' }, h('span', { text: it.label }), h('span', { class: 'dv-hist-d', text: it.detail || '' }));
        r.onclick = () => app.history.stepTo(id, i);
        return r;
      }));
    };
    const off = app.history.on(() => requestAnimationFrame(draw));
    m.scope.onDispose(off);
    m.cell(s => primaryId(s), draw);
    return el;
  }));
}

// ── overlays ──
// clipping (J, or Alt while dragging Exposure, Whites, Blacks): computed from the bitmap on screen
let clipCache = { bmp: null, canvas: null, mode: '' };
function clipCanvas(bmp, mode) {
  if (clipCache.bmp === bmp && clipCache.mode === mode) return clipCache.canvas;
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0);
  const id = g.getImageData(0, 0, c.width, c.height), d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], gg = d[i + 1], b = d[i + 2];
    const hi = r >= 254 || gg >= 254 || b >= 254, lo = r <= 1 && gg <= 1 && b <= 1;
    if (mode === 'whites') { d[i] = r >= 254 ? 255 : 0; d[i + 1] = gg >= 254 ? 255 : 0; d[i + 2] = b >= 254 ? 255 : 0; d[i + 3] = 255; }
    else if (mode === 'blacks') { d[i] = r <= 1 ? 0 : 255; d[i + 1] = gg <= 1 ? 0 : 255; d[i + 2] = b <= 1 ? 0 : 255; d[i + 3] = 255; }
    else if (hi) { d[i] = 255; d[i + 1] = 40; d[i + 2] = 40; d[i + 3] = 230; }
    else if (lo) { d[i] = 40; d[i + 1] = 110; d[i + 2] = 255; d[i + 3] = 230; }
    else d[i + 3] = 0;
  }
  g.putImageData(id, 0, 0);
  clipCache = { bmp, canvas: c, mode };
  return c;
}
const clippingOverlay = ck.overlay.custom('clipping', s => ({ on: !!s.view.clipping, alt: s.view.altPreview }), (g, vp, v) => {
  const bmp = vp.bitmap(); if (!bmp || !v) return;
  const mode = v.alt ? (/black/i.test(v.alt.label) ? 'blacks' : 'whites') : v.on ? 'both' : '';
  if (!mode) return;
  const c = clipCanvas(bmp, mode);
  const [x0, y0] = vp.toScreen(0, 0), [x1, y1] = vp.toScreen(1, 1);
  const im = svgEl('image', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, preserveAspectRatio: 'none', href: c.toDataURL() });
  g.append(im);
});

// ── histogram from what is on screen (idle lane) ──
export function histogramFrom(bmp) {
  const W = 256, H = Math.max(1, Math.round(256 * bmp.height / bmp.width));
  const c = new OffscreenCanvas(W, H); const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, W, H);
  const d = g.getImageData(0, 0, W, H).data;
  const r = new Array(256).fill(0), gg = new Array(256).fill(0), b = new Array(256).fill(0), l = new Array(256).fill(0);
  for (let i = 0; i < d.length; i += 4) { r[d[i]]++; gg[d[i + 1]]++; b[d[i + 2]]++; l[Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])]++; }
  return { r, g: gg, b, l, total: W * H };
}

// ── commands ──
export function developCommands(c) {
  const has = s => !!primaryId(s);
  c.add('develop.auto', { label: 'Auto Settings', menu: 'Settings', enabled: has, why: 'Select a photo first', run: async ctx => {
    const id = primaryId(ctx.state); const st = ctx.state; const cur = st.dev[id] || st.devDefaults;
    try {
      const a = await ctx.engine.auto(render, ctx.engine.values(render, st), {});
      ctx.tx('Auto Settings', t => { t.dev[id] = merge(cur, { light: a.settings.light, color: a.settings.color, wb: { mode: 'auto', temp: Math.round(a.wb.temp), tint: Math.round(a.wb.tint) } }); }, { channel: id, snapPath: ['dev', id] });
    } catch (e) { ctx.toast('Auto failed: ' + e.message, { kind: 'error' }); }
  } })
    .add('develop.reset', { label: 'Reset All Settings', menu: 'Settings', enabled: s => has(s) && isEdited(s, primaryId(s)), why: 'This photo has no adjustments', run: ctx => { const id = primaryId(ctx.state); ctx.tx('Reset', t => { t.dev[id] = ctx.state.devDefaults; }, { channel: id, snapPath: ['dev', id] }); } })
    .add('develop.copy', { label: 'Copy Settings', menu: 'Settings', enabled: has, why: 'Select a photo first', run: ctx => { ctx.set({ ui: { clipboard: devOf(ctx.state) } }); ctx.toast('Settings copied'); } })
    .add('develop.paste', { label: 'Paste Settings', menu: 'Settings', enabled: s => has(s) && !!s.ui.clipboard, why: `Copy settings from a photo first (${ck.keyLabel('Mod+Shift+C')})`, run: ctx => { const ids = selectedIds(ctx.state); const src = ctx.state.ui.clipboard; ctx.tx(`Paste Settings`, t => { for (const id of ids) t.dev[id] = syncSettings(src, ctx.state.dev[id] || ctx.state.devDefaults, Object.keys(SYNC_GROUPS).filter(g => g !== 'Crop' && g !== 'Spot Removal' && g !== 'Masks')); }, { channel: ids[0], snapPath: ['dev', ids[0]] }); } })
    .add('develop.previous', { label: 'Paste Settings from Previous', menu: 'Settings', enabled: has, why: 'Select a photo first', run: ctx => { const L = filtered(ctx.state); const id = primaryId(ctx.state); const i = L.findIndex(p => p.id === id); const prev = L[i - 1]; if (!prev) { ctx.toast('No previous photo'); return; } ctx.tx('Paste from Previous', t => { t.dev[id] = ctx.state.dev[prev.id] || ctx.state.devDefaults; }, { channel: id, snapPath: ['dev', id] }); } })
    .add('develop.sync', { label: 'Sync Settings…', menu: 'Settings', enabled: s => selectedIds(s).length > 1, why: 'Select more than one photo; the primary one is the source', run: ctx => syncDialog(ctx) })
    .add('develop.snapshot', { module: 'develop', label: 'New Snapshot', menu: 'Settings', enabled: has, why: 'Select a photo first', run: ctx => { const id = primaryId(ctx.state); const n = ((ctx.state.snapshots[id] || []).length + 1); ctx.tx('New Snapshot', t => { t.snapshots[id] = (ctx.state.snapshots[id] || []).concat([{ name: `Snapshot ${n} · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, dev: devOf(ctx.state) }]); }); ctx.toast(`Snapshot ${n} saved`); } })
    .add('develop.clearHistory', { module: 'develop', label: 'Clear History', menu: 'Settings', run: ctx => { const id = primaryId(ctx.state); const ch = ctx.app.history.channels.get(id); if (ch) { ch.list = ch.list.slice(ch.pos, ch.pos + 1); ch.pos = 0; ctx.app.history.emit('change'); } } })
    .add('view.beforeAfter', { module: 'develop', label: 'Before / After', menu: 'View', icon: 'beforeafter', checked: s => s.view.compare === 'before', run: ctx => ctx.set({ view: { compare: ctx.state.view.compare === 'before' ? 'off' : 'before' } }) })
    .add('view.leftRight', { module: 'develop', label: 'Before / After Left-Right', menu: 'View', icon: 'compare', checked: s => s.view.compare === 'lr', run: ctx => ctx.set({ view: { compare: ctx.state.view.compare === 'lr' ? 'off' : 'lr' } }) })
    .add('view.topBottom', { module: 'develop', label: 'Before / After Top-Bottom', menu: 'View', icon: 'topbottom', checked: s => s.view.compare === 'tb', run: ctx => ctx.set({ view: { compare: ctx.state.view.compare === 'tb' ? 'off' : 'tb' } }) })
    .add('view.split', { module: 'develop', label: 'Before / After Split', menu: 'View', icon: 'split', checked: s => s.view.compare === 'split', run: ctx => ctx.set({ view: { compare: ctx.state.view.compare === 'split' ? 'off' : 'split' } }) })
    .add('view.clipping', { module: 'develop', label: 'Show Clipping', menu: 'View', checked: s => !!s.view.clipping, run: ctx => ctx.set({ view: { clipping: !ctx.state.view.clipping } }) });
}
function syncDialog(ctx) {
  const groups = Object.keys(SYNC_GROUPS);
  const boxes = groups.map(g => { const l = h('label', { class: 'ck-check' }, h('input', { type: 'checkbox', checked: !['Crop', 'Spot Removal', 'Masks'].includes(g) }), h('span', { text: g })); l.dataset.group = g; return l; });
  const ids = selectedIds(ctx.state), src = devOf(ctx.state);
  const all = on => () => boxes.forEach(bx => { bx.querySelector('input').checked = on; });
  const pick = h('div', { class: 'dv-sync-all' }, h('button', { type: 'button', class: 'ck-btn is-small', text: 'Check All', onclick: all(true) }), h('button', { type: 'button', class: 'ck-btn is-small', text: 'Check None', onclick: all(false) }));
  ctx.dialog({ title: `Synchronize Settings to ${ids.length - 1} photo${ids.length > 2 ? 's' : ''}`, body: h('div', {}, pick, h('div', { class: 'dv-sync' }, ...boxes)), buttons: [{ label: 'Cancel' }, { label: 'Synchronize', primary: true, run: () => {
    const chosen = boxes.filter(b => b.querySelector('input').checked).map(b => b.dataset.group);
    const target = ids.filter(id => id !== primaryId(ctx.state));
    ctx.tx(`Sync Settings (${target.length})`, t => { for (const id of target) t.dev[id] = syncSettings(src, ctx.state.dev[id] || ctx.state.devDefaults, chosen); });
  } }] });
}

// ── the module ──
export function developModule(shell) {
  shell.module('develop', m => m.label('Develop').key('D').icon('adj')
    .txOpts(s => { const id = primaryId(s); return id ? { channel: id, snapPath: ['dev', id] } : {}; })
    .left(ck.dock.column({ width: 236 }, navigatorPanel(), presetsPanel(), ck.dock.tabs([snapshotsPanel().props.id, historyPanel().props.id])))
    .center(ck.match(s => (s.view.compare === 'reference' && s.ui.reference ? 'reference' : 'one'), {
      reference: ck.row({ class: 'dv-ref', grow: 1 },
        ck.viewport(referenceRender, { id: 'ref', label: s => { const p = s.catalog.photos.find(x => x.id === s.ui.reference); return p ? `Reference · ${p.title}` : 'Reference'; }, compare: false, dims: s => { const p = s.catalog.photos.find(x => x.id === s.ui.reference); return p ? [p.w, p.h] : null; } }),
        ck.viewport(render, { id: 'main', label: s => { const p = primaryOf(s); return p ? `Active · ${p.title}` : 'Active'; }, compare: false, dims: s => { const p = primaryOf(s); return p ? [p.w, p.h] : null; }, onRender: (r, vp, ctx) => ctx.app.scheduler.idle(() => { const b = vp.bitmap(); if (b) ctx.app.store.set(['ui', 'hist'], histogramFrom(b)); }, 'hist') })),
      one: ck.viewport(s => (s.ui.tool === 'crop' ? uncroppedRender : render), {
      id: 'main', before, dims: s => { const p = primaryOf(s); return p ? [p.w, p.h] : null; },
      tools: ['crop', 'heal', 'mask-brush', 'mask-linear', 'mask-radial', 'wb'],
      overlays: [clippingOverlay],
      onRender: (r, vp, ctx) => ctx.app.scheduler.idle(() => { const b = vp.bitmap(); if (b) ctx.app.store.set(['ui', 'hist'], histogramFrom(b)); }, 'hist'),
      hud: ck.hud({ at: 'top-right' }, s => (s.ui.tool ? { crop: 'Crop · Enter to apply, Esc to cancel', heal: 'Spot Removal · click a spot', 'mask-brush': 'Brush · Alt erases', 'mask-linear': 'Linear Gradient · drag', 'mask-radial': 'Radial Gradient · drag from the centre', wb: 'White Balance · click something neutral' }[s.ui.tool] : '')),
    }) }, { of: ['reference', 'one'] }))
    .right(ck.dock.column({ width: 300, solo: false },
      histogramPanelDevelop(),
      ck.toolbar(['tool.crop', 'tool.heal', 'tool.mask-brush', 'tool.mask-linear', 'tool.mask-radial'], { class: 'dv-tools' }),
      ck.when(s => s.ui.tool === 'crop', cropOptions()),
      ck.when(s => s.ui.tool === 'heal', healOptions()),
      ck.when(s => /^mask-/.test(s.ui.tool || ''), masksPanel()),
      basicPanel(), curvePanel(), mixerPanel(), gradingPanel(), detailPanel(), lensPanel(), transformPanel(), effectsPanel(), calibrationPanel(), scopesPanel()))
    .bottom(ck.view.filmstrip(s => s.catalog.filtered, { id: 'filmstrip', cell: (p, i) => photoCell(p, i, { compact: true }), select: { bind: s => s.ui.selection, mode: 'multi' }, dnd: { source: 'photo' }, aspect: 1.15 }))
    .toolbar(ck.bar({ class: 'dv-tb' },
      ck.toolbar(['view.loupeDev', 'view.beforeAfter', 'view.leftRight', 'view.topBottom', 'view.split', '-', 'view.reference']),
      ck.ui.checkbox('Show clipping (J)', { bind: s => s.view.clipping }),
      ck.spacer(),
      ck.ui.command('develop.previous', { small: true, text: 'Previous' }),
      ck.ui.command('develop.reset', { small: true, text: 'Reset' })))
    .keys({ ...CULL_KEYS, E: 'view.loupe', C: 'view.compare', N: 'view.survey', '\\': 'view.beforeAfter', Y: 'view.leftRight', 'Alt+Y': 'view.topBottom', 'Shift+Y': 'view.split', J: 'view.clipping', 'Mod+Shift+C': 'develop.copy', 'Mod+Shift+V': 'develop.paste', 'Mod+Alt+V': 'develop.previous', 'Mod+Shift+R': 'develop.reset', 'Mod+Alt+N': 'develop.snapshot', 'Mod+Shift+U': 'develop.auto', 'Mod+Shift+S': 'develop.sync', 'Shift+R': 'view.reference', 'Alt+M': 'develop.match', ArrowRight: 'photo.next', ArrowLeft: 'photo.previous', ',': 'develop.focusPrev', '.': 'develop.focusNext', '=': 'develop.nudgeUp', '-': 'develop.nudgeDown', P: 'photo.pick', X: 'photo.reject', U: 'photo.unflag', ...ck.digits(0, 5, 'photo.rate') }));
  shell.tools(t => { cropTool(t); healTool(t); maskTools(t); t.tool('wb', { label: 'White Balance Selector', icon: 'eyedropper', key: 'W', cursor: 'crosshair', on: { down: (e, ctx) => { wbPick(e, ctx); return false; } } }); });
  shell.commands(c => c
    .add('view.loupeDev', { module: 'develop', label: 'Loupe', icon: 'loupe', run: ctx => ctx.set({ view: { compare: 'off' } }), checked: s => s.view.compare === 'off', palette: false })
    .add('develop.focusNext', { label: 'Next Slider', palette: false, run: () => focusSlider(1) })
    .add('develop.focusPrev', { label: 'Previous Slider', palette: false, run: () => focusSlider(-1) })
    .add('develop.nudgeUp', { label: 'Increase Slider', palette: false, run: () => nudgeSlider(1) })
    .add('develop.nudgeDown', { label: 'Decrease Slider', palette: false, run: () => nudgeSlider(-1) }));
}
function histogramPanelDevelop() {
  const R = [['Blacks', 'light.blacks', 0, 0.1], ['Shadows', 'light.shadows', 0.1, 0.35], ['Exposure', 'light.exposure', 0.35, 0.65], ['Highlights', 'light.highlights', 0.65, 0.9], ['Whites', 'light.whites', 0.9, 1.01]]
    .map(([name, id, from, to]) => { const c = spec(id), path = controlPath(id); return { name, from, to, bind: s => path.reduce((o, k) => o[k], devOf(s)), min: c.min, max: c.max, step: c.step }; });
  return ck.panel('histogram', { title: 'Histogram', fixed: true },
    ck.view.histogram(s => s.ui.hist, { clip: s => s.view.clipping, regions: R, info: s => { const p = primaryOf(s); if (!p) return ''; const d = devOf(s); return `${p.w} × ${p.h}${d.crop.geometry.rect.x1 - d.crop.geometry.rect.x0 < 0.999 || d.crop.geometry.rect.y1 - d.crop.geometry.rect.y0 < 0.999 ? ' · cropped' : ''}`; } }));
}
// , and . walk the sliders of the open panels; = and - nudge the one with focus (Lightroom's Develop keys)
let lastSlider = null;
function sliders() { return [...document.querySelectorAll('.ck-side-right .ck-panel:not(.is-closed) .ck-slider-t')].filter(el => el.offsetParent); }
function focusSlider(d) {
  const L = sliders(); if (!L.length) return;
  const cur = L.indexOf(document.activeElement) >= 0 ? L.indexOf(document.activeElement) : L.indexOf(lastSlider);
  const el = L[(cur + d + L.length) % L.length] || L[0];
  lastSlider = el; el.focus(); el.scrollIntoView({ block: 'nearest' });
}
function nudgeSlider(d) {
  const el = document.activeElement && document.activeElement.classList.contains('ck-slider-t') ? document.activeElement : lastSlider;
  if (!el) { focusSlider(1); return; }
  el.dispatchEvent(new KeyboardEvent('keydown', { key: d > 0 ? 'ArrowRight' : 'ArrowLeft', bubbles: true }));
}
// white balance: sample the original under the pointer, set Temp/Tint so that grey comes out neutral
async function wbPick(e, ctx) {
  if (!e.inside) return;
  const id = primaryId(ctx.state); if (!id) return;
  const vp = ctx.vp, bmp = vp.bitmap(); if (!bmp) return;
  const c = new OffscreenCanvas(bmp.width, bmp.height); const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
  const x = Math.round(e.u * bmp.width), y = Math.round(e.v * bmp.height);
  const d = g.getImageData(Math.max(0, x - 2), Math.max(0, y - 2), 5, 5).data;
  let r = 0, gg = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
  const cur = devOf(ctx.state);
  // blue–yellow imbalance moves Temp, green–magenta moves Tint (a first-order neutral point)
  const by = Math.log((r + gg) / 2 / Math.max(1, b)), gm = Math.log(gg / Math.max(1, (r + b) / 2));
  const temp = Math.round(Math.max(2000, Math.min(50000, cur.wb.temp * Math.exp(-by * 0.9))) / 50) * 50;
  const tint = Math.round(Math.max(-150, Math.min(150, cur.wb.tint + gm * 120)));
  ctx.tx('White Balance', t => { t.dev[id].wb = Object.assign({}, cur.wb, { mode: 'custom', temp, tint }); }, { channel: id, snapPath: ['dev', id], detail: `${temp} / ${fmtSigned(tint)}` });
  ctx.app.selectTool(null);
}
