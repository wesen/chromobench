// CraftKit Studio: the v1 shell's acceptance app. One shell, six modules, one engine graph.
import { ck } from '../shell/index.js';
import { sampleCatalog, filtered, primaryOf } from './catalog.js';
import { DEFAULTS } from './develop-model.js';
import { libraryModule, libraryCommands, collectionCommands, addFiles } from './library.js';
import { developModule, developCommands, histogramFrom } from './develop.js';
import { thumb } from './engine-graphs.js';
import { cropCommands, healCommands, maskCommands } from './develop-tools.js';
import { matchCommands } from './develop-scopes.js';
import { cullModule } from './cull.js';
import * as exportMod from './export.js';
import * as prepressMod from './prepress.js';
import * as printMod from './printshop.js';

const EXTRA = [exportMod, prepressMod, printMod];   // modules that bring their own state and install themselves
const extra = key => Object.assign({}, ...EXTRA.map(x => (x.state && x.state[key]) || {}));

const catalog = sampleCatalog();
const dev = Object.fromEntries(catalog.photos.map(p => [p.id, DEFAULTS]));   // every photo starts on the shared defaults
const first = catalog.photos[0].id;

const shell = ck.shell('CraftKit Studio', { plate: 'CraftKit Studio' })
  .state({
    catalog, dev, devDefaults: DEFAULTS, snapshots: {}, ...extra('doc'),
    view: { ...extra('view'), module: 'library', mode: 'grid', source: 'all', filter: { text: '', flag: null, rating: 0, label: null, edited: false }, sort: 'capture', thumbSize: 150, compare: 'off', clipping: false, filterBar: true, vp: {}, split: 0.5, loupeInfo: 0 },
    ui: {
      selection: { ids: [first], primary: first, anchor: first }, reference: null, tool: null, hist: null, presetAmount: 100, clipboard: null, lastPick: null, peek: false, spot: null, mask: null, maskSel: { ids: [], primary: null, anchor: null }, maskOverlay: true,
      ...extra('ui'),
      toolOptions: { crop: { aspect: 'original', locked: true }, heal: { mode: 'heal', size: 0.025, feather: 50, opacity: 100 }, 'mask-brush': { size: 0.04, feather: 50, flow: 100 }, 'mask-radial': { feather: 50 }, ...extra('toolOptions') },
    },
    prefs: { autoAdvance: true, gray: 'auto', welcomed: false },
    workspace: { curveMode: 'Parametric', gradeView: '3-way', scope: 'waveform' },
  }, {
    view: ['ui', 'view', 'prefs', 'workspace'],
    version: 3,
    // autosave keeps edits small: photos on the defaults are written as nothing, imported files are dropped
    transient: ['compare', 'vp', 'split'],   // view keys not kept across a reload
    keepUi: ['selection'],   // the photo you were on comes back after a reload
    currentChannel: s => s.ui.selection && s.ui.selection.primary,
    channelName: (id, s) => { const p = s.catalog.photos.find(x => x.id === id); return p ? p.title : null; },   // "Undo Contrast (on Old pier)"
    persist: doc => Object.assign({}, doc, { dev: Object.fromEntries(Object.entries(doc.dev).filter(([id, d]) => d !== doc.devDefaults && !String(id).startsWith('imp'))), devDefaults: undefined, catalog: Object.assign({}, doc.catalog, { photos: doc.catalog.photos.filter(p => !p.imported) }) }),
    restore: st => {
      const out = Object.assign({}, st, { devDefaults: DEFAULTS }); out.dev = Object.assign({}, Object.fromEntries(out.catalog.photos.map(p => [p.id, DEFAULTS])), st.dev || {});
      // a selection kept from last time may name photos that did not come back (imports live for one session)
      const have = new Set(out.catalog.photos.map(p => p.id)), sel = out.ui && out.ui.selection;
      if (sel) { const ids = (sel.ids || []).filter(id => have.has(id)), primary = have.has(sel.primary) ? sel.primary : ids[0] || (out.catalog.photos[0] || {}).id || null; out.ui = Object.assign({}, out.ui, { selection: { ids: ids.length ? ids : primary ? [primary] : [], primary, anchor: primary } }); }
      return out;
    },
  })
  .derive('catalog.filtered', filtered)
  .commands(c => { libraryCommands(c); collectionCommands(c); developCommands(c); cropCommands(c); healCommands(c); maskCommands(c); matchCommands(c);
    c.add('prefs.autoAdvance', { label: 'Auto Advance', menu: 'Photo', checked: s => s.prefs.autoAdvance, run: ctx => ctx.set({ prefs: { autoAdvance: !ctx.state.prefs.autoAdvance } }) })
     .add('app.reference', { label: 'Shell Reference', menu: 'Help', run: async ctx => { const { DOCS } = await import('./docs.js'); const d = document.createElement('div'); d.className = 'doc'; d.innerHTML = DOCS.SHELL; ctx.dialog({ title: 'CraftKit Shell v1 — reference', wide: true, body: d, buttons: [{ label: 'Close', primary: true }] }); } })
     .add('app.inspector', { label: 'Runtime Inspector', menu: 'Help', run: ctx => inspector(ctx) })
     .add('app.welcome', { label: 'Welcome', menu: 'Help', run: ctx => welcome(ctx) })
     .add('app.about', { label: 'About This Build', menu: 'Help', run: async ctx => { const { DOCS } = await import('./docs.js'); const d = document.createElement('div'); d.className = 'doc'; d.innerHTML = DOCS.README; ctx.dialog({ title: 'CraftKit Studio — about this build', wide: true, body: d, buttons: [{ label: 'Close', primary: true }] }); } })
     .add('app.resetSample', { label: 'Start Over with the Sample Shoot…', menu: 'File', run: ctx => ctx.dialog({ title: 'Start over', body: Object.assign(document.createElement('p'), { textContent: 'Clear every edit, flag and collection saved in this browser and reload the sample shoot?' }), buttons: [{ label: 'Cancel' }, { label: 'Start Over', primary: true, run: () => { ck.clearSaved('CraftKit Studio', 3); location.reload(); } }] }) });
  })
  .menus(m => m
    .menu('File', ['library.import', '-', 'app.resetSample'])
    .menu('Edit', ['edit.undo', 'edit.redo', '-', 'library.selectAll', 'library.selectNone', 'library.selectFlagged', '-', 'app.palette'])
    .menu('Library', ['collection.new', 'collection.rename', 'collection.delete', '-', 'library.find', 'library.filterBar', 'library.clearFilter', '-', 'photo.removeRejected'])
    .menu('Photo', ['photo.pick', 'photo.reject', 'photo.unflag', '-', 'collection.addToTarget', '-', 'prefs.autoAdvance', '-', 'photo.next', 'photo.previous'])
    .menu('Settings', ['develop.auto', 'develop.reset', '-', 'develop.copy', 'develop.paste', 'develop.previous', 'develop.sync', '-', 'develop.snapshot', '-', 'develop.setReference', 'develop.match'])
    .menu('Tools', ['tool.crop', 'tool.heal', 'tool.mask-brush', 'tool.mask-linear', 'tool.mask-radial', 'tool.wb'])
    .menu('View', ['view.grid', 'view.loupe', 'view.compare', 'view.survey', '-', 'view.beforeAfter', 'view.leftRight', 'view.topBottom', 'view.split', 'view.reference', 'view.clipping', '-', 'view.zoomIn', 'view.zoomOut', 'view.fit', 'view.actual', '-', 'view.loupeInfo', 'view.toggleToolbar', 'app.theme'])
    .menu('Window', ['module.library', 'module.cull', 'module.develop', '-', 'view.hideSides', 'view.hideAll', 'view.toggleLeft', 'view.toggleRight', 'view.toggleBottom', 'view.toggleTop', '-', 'view.soloLeft', 'view.soloRight', 'workspace.reset'])
    .menu('Help', ['app.welcome', 'app.palette', 'app.shortcuts', '-', 'app.reference', 'app.diagnostics', 'app.inspector', '-', 'app.about']))
  .tools(t => t.spring('Space', 'hand', { label: 'the Hand' }).spring('Z', 'zoom', { label: 'Zoom (tap: Fit / 1:1)', tap: 'view.toggle-1:1' }))
  .keys('canvas', { '[': 'brush.smaller', ']': 'brush.larger', O: 'mask.overlay' })
  .context('canvas', s => (s.view.module === 'develop'
    ? ['develop.copy', 'develop.paste', 'develop.previous', 'develop.reset', '-', 'develop.snapshot', 'develop.setReference', 'view.reference', '-', 'view.beforeAfter', 'view.split', '-', 'photo.pick', 'photo.reject']
    : ['photo.pick', 'photo.reject', 'photo.unflag', '-', 'collection.addToTarget', '-', 'module.develop', 'view.grid']))
  .keys('tool:crop', { A: 'crop.lock', X: 'crop.swap', Enter: 'crop.done', 'Mod+Alt+R': 'crop.reset' })
  .keys('tool:heal', { Delete: 'heal.delete', Backspace: 'heal.delete' })
  .on('photo.flagged', (flag, ids, ctx) => {
    if (flag === 'pick' && ids.length === 1) ctx.set({ ui: { lastPick: ids[0] } });
    advance(ids, ctx);
  })
  // Auto Advance moves on after a flag, a rating or a label, as Lightroom's does (one photo at a time, not in Develop)
  .on('photo.rated', (n, ids, ctx) => advance(ids, ctx))
  .on('photo.labelled', (l, ids, ctx) => advance(ids, ctx));
function advance(ids, ctx) { if (ctx.state.prefs.autoAdvance && ids.length === 1 && ['library', 'cull'].includes(ctx.state.view.module)) ctx.run('photo.next'); }

libraryModule(shell);
cullModule(shell);
developModule(shell);
for (const x of EXTRA) x.install(shell);

// the machine underneath, live: frames, cells, subscriptions, transactions, renders
function inspector(ctx) {
  const app = ctx.app;
  const box = document.createElement('div'); box.className = 'insp';
  const rows = () => {
    const sc = app.scheduler.stats, en = app.engine.stats, st = app.store;
    return [
      ['Frames', sc.frames], ['Last frame', sc.lastFrameMs.toFixed(1) + ' ms'], ['Slow frames (>24 ms)', sc.slow],
      ['Cells re-checked', sc.cellsRun], ['Subscribed paths', st.index.count], ['Derived paths', st.derived.size],
      ['Store version', st.version], ['Previewing', st.previewing ? 'yes (a gesture is open)' : 'no'],
      ['Undo steps', app.history.entries.length], ['Redo steps', app.history.redoStack.length],
      ['Engine renders', en.renders], ['Last render', `${en.ms} ms in the worker, ${en.last} ms round trip`], ['Stale answers dropped', en.dropped],
      ['Thumbnail cache', app.engine.cache.size], ['Photos sent to the engine', app.engine.sent ? app.engine.sent.size : 0],
      ['Commands', app.commands.map.size], ['Key bindings', app.keymap.bindings.length], ['Engine graph', app.engine.graph ? `${app.engine.graph.nodes.size} nodes, ${app.engine.graph.inputs.size} inputs` : 'not compiled yet'],
    ];
  };
  const draw = () => { box.replaceChildren(...rows().map(([k, v]) => { const r = document.createElement('div'); r.className = 'insp-r'; const a = document.createElement('span'); a.textContent = k; const b = document.createElement('b'); b.textContent = String(v); r.append(a, b); return r; })); };
  draw(); const t = setInterval(draw, 400);
  ctx.dialog({ title: 'Runtime Inspector', body: box, buttons: [{ label: 'Close', primary: true }], onClose: () => clearInterval(t) });
}

// first run: what this is and five things to try
function welcome(ctx) {
  const d = document.createElement('div'); d.className = 'welcome';
  d.innerHTML = `<p>CraftKit Studio is the first working version of the CraftKit Shell: a photo studio whose menus, keys, panels, undo and canvas all come from the shell's grammar, with pixels from the CraftKit engine.</p>
  <ol>
    <li><b>Cull:</b> in the grid press <kbd>P</kbd> to keep, <kbd>X</kbd> to drop, <kbd>1</kbd>–<kbd>5</kbd> for stars. The next photo comes up by itself.</li>
    <li><b>Develop:</b> press <kbd>D</kbd> and drag any slider. A whole drag is one undo step; <kbd>\\</kbd> shows the before, <kbd>Y</kbd> puts them side by side.</li>
    <li><b>Tools:</b> <kbd>R</kbd> crop (drag outside the frame to straighten), <kbd>Q</kbd> spot removal, <kbd>K</kbd> brush a mask, <kbd>Shift</kbd>+<kbd>M</kbd> a radial gradient.</li>
    <li><b>Find anything:</b> <kbd>${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}</kbd>+<kbd>K</kbd> searches every command; <kbd>${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}</kbd>+<kbd>/</kbd> lists every shortcut by scope.</li>
    <li><b>Look underneath:</b> Help ▸ Build Report shows the diagnostics, Help ▸ Runtime Inspector the frames, cells and renders, Help ▸ Shell Reference the API.</li>
  </ol>
  <p class="welcome-n">Your flags, edits and layout stay in this browser. Drop your own photos on the window to import them for this session.</p>`;
  ctx.dialog({ title: 'Welcome to CraftKit Studio', body: d, buttons: [{ label: 'Start', primary: true }], onClose: () => ctx.set({ prefs: { welcomed: true } }) });
}


if (window.STUDIO) throw new Error('CraftKit Studio is already running');   // the module and the fallback bundle never both start
const app = shell.build();
window.STUDIO = app;
for (const p of app.store.peek(['catalog', 'photos'])) if (!p.imported) app.engine.declareAsset(p.file, p.url);
const root = document.getElementById('app');
root.replaceChildren();
app.mount(root);
if (app.diagnostics.errors.length) { console.warn(app.diagnostics.errors.map(d => d.format()).join('\n\n')); app.chrome.toast(`${app.diagnostics.errors.length} build errors: Help ▸ Build Report`, { kind: 'error', ms: 6000 }); }
if (window.innerWidth < 760) app.store.set(['workspace', 'hide'], { sides: true });
// the histogram follows the primary photo everywhere; Develop's viewport replaces it with the full render
app.rootMount.cell(s => { const p = primaryOf(s); return p ? { file: p.file, dev: s.dev[p.id] || s.devDefaults, w: p.w, h: p.h, mod: s.view.module } : null; }, v => {
  if (!v) { app.store.set(['ui', 'hist'], null); return; }
  if (v.mod === 'develop') return;
  app.scheduler.idle(async () => { const r = await app.engine.render(thumb, app.engine.values(thumb, v), { max: 256, lane: 'bg' }); if (r.bmp) app.store.set(['ui', 'hist'], histogramFrom(r.bmp)); }, 'lib-hist');
});
// files dropped anywhere in the window are imported
root.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
root.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files.length && !e.defaultPrevented) { e.preventDefault(); addFiles([...e.dataTransfer.files], app.ctx()); } });
if (!app.store.peek(['prefs', 'welcomed']) && !navigator.webdriver) setTimeout(() => welcome(app.ctx()), 600);
app.engine.start().catch(e => app.chrome.toast('The engine did not start: ' + e.message, { kind: 'error', ms: 8000 }));
