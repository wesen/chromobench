// Library: the catalog as a grid, a loupe, compare and survey; flags, stars, labels, collections, keywords,
// metadata and Quick Develop. (U-14 in the design, built with the v1 shell.)
import { ck } from '../shell/index.js';
import { h, icon } from '../shell/ui/dom.js';
import { filtered, primaryOf, selectedIds, LABELS, LABEL_NAMES, importFiles, sourcePhotos } from './catalog.js';
import { render, before, thumb, fileOf } from './engine-graphs.js';
import { devOf, isEdited, DEFAULTS, merge, effective } from './develop-model.js';

const flagIcon = f => (f === 'pick' ? 'pick' : f === 'reject' ? 'reject' : null);

// ── a grid cell: index, picture, flag, stars, label, badges (θ in the design; a per-item function here) ──
export function photoCell(p, i, { compact = false } = {}) {
  return ck.html(m => {
    const el = h('div', { class: ['lib-cell', p.label && 'lb-' + p.label, compact && 'is-compact'], 'data-id': p.id });
    const idx = h('span', { class: 'lib-cell-n', text: String(i + 1) });
    const pic = m.mount(ck.view.thumb({ src: p.thumb, image: thumb, arg: s => ({ file: p.file, dev: s.dev[p.id] || s.devDefaults, w: p.w, h: p.h }), engine: s => isEdited(s, p.id), max: 320 }));
    pic.classList.add('lib-cell-p');
    const foot = h('div', { class: 'lib-cell-f' });
    const flag = h('span', { class: 'lib-flag is-' + (p.flag || 'none'), 'data-tip': p.flag === 'pick' ? 'Flagged as Pick (P)' : p.flag === 'reject' ? 'Rejected (X)' : 'Unflagged (U)' }, flagIcon(p.flag) ? icon(flagIcon(p.flag), 11) : '');
    const stars = h('span', { class: 'lib-stars', 'aria-label': `${p.rating} stars` }, ...[1, 2, 3, 4, 5].map(k => h('i', { class: k <= p.rating ? 'is-on' : '' })));
    const badges = h('span', { class: 'lib-badges' });
    m.cell(s => isEdited(s, p.id), on => { badges.replaceChildren(on ? h('span', { class: 'lib-badge', 'data-tip': 'Has Develop adjustments', text: '±' }) : ''); });
    m.cell(s => (s.catalog.collections.find(c => c.quick) || { ids: [] }).ids.includes(p.id), on => el.classList.toggle('in-quick', on));
    foot.append(flag, stars, badges);
    el.append(idx, pic, foot);
    if (p.flag === 'reject') el.classList.add('is-rejected');
    return el;
  });
}

// ── commands every photo module shares ──
export function libraryCommands(c) {
  const flag = (f, label) => ctx => {
    const ids = selectedIds(ctx.state); if (!ids.length) return;
    ctx.tx(label, t => { for (const p of t.catalog.photos) if (ids.includes(p.id)) p.flag = f; });
    ctx.flash(label, f === 'pick' ? 'pick' : f === 'reject' ? 'reject' : 'info');
    ctx.emit('photo.flagged', f, ids);
  };
  const hasSel = s => selectedIds(s).length > 0;
  c.add('photo.pick', { label: 'Flag as Pick', menu: 'Photo', icon: 'pick', enabled: hasSel, why: 'Select a photo first', run: flag('pick', 'Flag as Pick') })
    .add('photo.reject', { label: 'Set as Rejected', menu: 'Photo', icon: 'reject', enabled: hasSel, why: 'Select a photo first', run: flag('reject', 'Set as Rejected') })
    .add('photo.unflag', { label: 'Unflag', menu: 'Photo', enabled: hasSel, why: 'Select a photo first', run: flag(null, 'Unflag') })
    .add('photo.rate', { label: 'Set Rating', menu: 'Photo', enabled: hasSel, why: 'Select a photo first', palette: false, run: (ctx, n) => { const ids = selectedIds(ctx.state); ctx.tx(n ? `Set Rating: ${'★'.repeat(n)}` : 'Remove Rating', t => { for (const p of t.catalog.photos) if (ids.includes(p.id)) p.rating = n; }); ctx.flash(n ? `Rating ${'★'.repeat(n)}` : 'Rating removed'); ctx.emit('photo.rated', n, ids); } })
    .add('photo.label', { label: 'Set Color Label', menu: 'Photo', enabled: hasSel, why: 'Select a photo first', palette: false, run: (ctx, d) => { const lab = LABELS[d - 6] || null; const ids = selectedIds(ctx.state); const cur = primaryOf(ctx.state); const next = cur && cur.label === lab ? null : lab; ctx.tx(next ? `Color Label: ${LABEL_NAMES[next]}` : 'Remove Color Label', t => { for (const p of t.catalog.photos) if (ids.includes(p.id)) p.label = next; }); ctx.flash(next ? `Label: ${LABEL_NAMES[next]}` : 'Label removed'); ctx.emit('photo.labelled', next, ids); } })
    .add('photo.next', { label: 'Next Photo', menu: 'Photo', run: ctx => step(ctx, 1) })
    .add('photo.previous', { label: 'Previous Photo', menu: 'Photo', run: ctx => step(ctx, -1) })
    .add('photo.first', { label: 'First Photo', palette: false, run: ctx => step(ctx, -1e9) })
    .add('photo.last', { label: 'Last Photo', palette: false, run: ctx => step(ctx, 1e9) })
    .add('collection.addToTarget', { label: s => `Add to ${(s.catalog.collections.find(c2 => c2.id === s.catalog.target) || { name: 'Target Collection' }).name}`, menu: 'Photo', enabled: hasSel, why: 'Select a photo first', run: ctx => {
      const ids = selectedIds(ctx.state), tid = ctx.state.catalog.target;
      const col = ctx.state.catalog.collections.find(x => x.id === tid); if (!col) return;
      const allIn = ids.every(id => col.ids.includes(id));
      ctx.tx(allIn ? `Remove from ${col.name}` : `Add to ${col.name}`, t => { const tc = t.catalog.collections.find(x => x.id === tid); tc.ids = allIn ? tc.ids.filter(id => !ids.includes(id)) : [...new Set(tc.ids.concat(ids))]; });
      ctx.flash(allIn ? `Removed from ${col.name}` : `Added to ${col.name}`);
    } })
    .add('collection.new', { module: 'library', label: 'New Collection…', menu: 'Library', run: ctx => newCollection(ctx) })
    .add('view.grid', { label: 'Grid', menu: 'View', icon: 'grid', checked: s => s.view.module === 'library' && s.view.mode === 'grid', run: ctx => { ctx.go('library'); ctx.set({ view: { mode: 'grid' } }); } })
    .add('view.loupe', { label: 'Loupe', menu: 'View', icon: 'loupe', enabled: s => !!primaryOf(s), why: 'Select a photo first', checked: s => s.view.module === 'library' && s.view.mode === 'loupe', run: ctx => { ctx.go('library'); ctx.set({ view: { mode: 'loupe' } }); } })
    .add('view.compare', { module: 'library', label: 'Compare', menu: 'View', icon: 'compare', enabled: s => selectedIds(s).length >= 2, why: `Select two photos (${/Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘' : 'Ctrl'}-click the second)`, checked: s => s.view.module === 'library' && s.view.mode === 'compare', run: ctx => { ctx.go('library'); ctx.set({ view: { mode: 'compare' } }); } })
    .add('view.survey', { module: 'library', label: 'Survey', menu: 'View', icon: 'survey', enabled: s => selectedIds(s).length >= 2, why: 'Select two or more photos', checked: s => s.view.module === 'library' && s.view.mode === 'survey', run: ctx => { ctx.go('library'); ctx.set({ view: { mode: 'survey' } }); } })
    .add('view.loupeInfo', { module: 'library', label: 'Cycle Info Overlay', menu: 'View', run: ctx => ctx.set({ view: { loupeInfo: ((ctx.state.view.loupeInfo || 0) + 1) % 3 } }) })
    .add('library.filterBar', { module: 'library', label: 'Filter Bar', menu: 'Library', checked: s => s.view.filterBar !== false, run: ctx => ctx.set({ view: { filterBar: ctx.state.view.filterBar === false } }) })
    .add('library.find', { module: 'library', label: 'Find…', menu: 'Library', run: ctx => { ctx.go('library'); ctx.set({ view: { mode: 'grid', filterBar: true } }); requestAnimationFrame(() => { const i = document.querySelector('.lib-filter input'); i && i.focus(); }); } })
    .add('library.clearFilter', { module: 'library', label: 'Clear Filters', menu: 'Library', enabled: s => Object.values(s.view.filter || {}).some(Boolean), why: 'No filter is on', run: ctx => ctx.set({ view: { filter: { ...NO_FILTER } } }) })
    .add('library.import', { label: 'Import Photos…', menu: 'File', icon: 'import', run: ctx => pickFiles(ctx) })
    .add('library.selectAll', { label: 'Select All', menu: 'Edit', run: ctx => { const L = filtered(ctx.state); ctx.set({ ui: { selection: { ids: L.map(p => p.id), primary: (primaryOf(ctx.state) || L[0] || {}).id || null, anchor: null } } }); } })
    .add('library.selectNone', { label: 'Select None', menu: 'Edit', enabled: s => selectedIds(s).length > 1, why: 'Only one photo is selected', run: ctx => { const p = primaryOf(ctx.state); ctx.set({ ui: { selection: { ids: p ? [p.id] : [], primary: p ? p.id : null, anchor: p ? p.id : null } } }); } })
    .add('library.selectFlagged', { label: 'Select Flagged Photos', menu: 'Edit', run: ctx => { const L = filtered(ctx.state).filter(p => p.flag === 'pick'); if (!L.length) { ctx.toast('No picks in this view'); return; } ctx.set({ ui: { selection: { ids: L.map(p => p.id), primary: L[0].id, anchor: L[0].id } } }); } })
    .add('photo.removeRejected', { module: 'library', label: 'Remove Rejected Photos…', menu: 'Library', enabled: s => s.catalog.photos.some(p => p.flag === 'reject'), why: 'No photo is rejected', run: ctx => {
      const n = ctx.state.catalog.photos.filter(p => p.flag === 'reject').length;
      ctx.dialog({ title: 'Remove rejected photos', body: h('p', { text: `Remove ${n} rejected photo${n === 1 ? '' : 's'} from the catalog? Edit ▸ Undo brings them back.` }), buttons: [{ label: 'Cancel' }, { label: 'Remove', primary: true, run: () => {
        const st = ctx.state, gone = new Set(st.catalog.photos.filter(p => p.flag === 'reject').map(p => p.id));
        // the selection moves to the nearest photo that stays, so no view is left on a removed one
        const L = filtered(st), sel = st.ui.selection || { ids: [] }, i = Math.max(0, L.findIndex(p => p.id === sel.primary));
        const next = L.slice(i).concat(L.slice(0, i).reverse()).find(p => !gone.has(p.id));
        ctx.tx(`Remove ${n} Rejected`, t => {
          t.catalog.photos = t.catalog.photos.$value.filter(p => !gone.has(p.id));
          for (const c of t.catalog.collections) if (c.ids.some(id => gone.has(id))) c.ids = c.ids.filter(id => !gone.has(id));
        });
        const keep = sel.ids.filter(id => !gone.has(id)), primary = gone.has(sel.primary) ? (next ? next.id : null) : sel.primary;
        ctx.set({ ui: { selection: { ids: keep.length ? keep : primary ? [primary] : [], primary, anchor: primary }, lastPick: gone.has(st.ui.lastPick) ? null : st.ui.lastPick, reference: gone.has(st.ui.reference) ? null : st.ui.reference } });
      } }] });
    } })
    .add('photo.resetDevelop', { label: 'Reset Develop Settings', menu: 'Photo', enabled: s => selectedIds(s).some(id => isEdited(s, id)), why: 'The selected photos have no adjustments', run: ctx => { const ids = selectedIds(ctx.state); ctx.tx('Reset', t => { for (const id of ids) t.dev[id] = ctx.state.devDefaults; }, { channel: primaryOf(ctx.state) && primaryOf(ctx.state).id, snapPath: ['dev', primaryOf(ctx.state) && primaryOf(ctx.state).id] }); } });
}

export const NO_FILTER = { text: '', flag: null, rating: 0, label: null, edited: false };
// the culling keys, in every view of every photo module (Lightroom's Library and Develop both take them)
export const CULL_KEYS = { P: 'photo.pick', X: 'photo.reject', U: 'photo.unflag', ...ck.digits(0, 5, 'photo.rate'), ...ck.digits(6, 9, 'photo.label'), B: 'collection.addToTarget' };

export function step(ctx, d) {
  const L = filtered(ctx.state); if (!L.length) return;
  const sel = ctx.state.ui.selection || { ids: [] }, mode = ctx.state.view.module === 'library' ? ctx.state.view.mode : null;
  // Survey: the arrows move the active photo within the survey, which keeps its photos
  if (mode === 'survey' && sel.ids.length > 1) {
    const ids = L.filter(p => sel.ids.includes(p.id)).map(p => p.id); const i = ids.indexOf(sel.primary);
    const j = Math.max(0, Math.min(ids.length - 1, i + d)); if (j !== i) ctx.set({ ui: { selection: { ids: sel.ids, primary: ids[j], anchor: sel.anchor } } });
    return;
  }
  // Compare: the select stays, the candidate moves to the next photo
  if (mode === 'compare' && sel.ids.length > 1) {
    const cand = sel.ids.find(id => id !== sel.primary); let i = L.findIndex(p => p.id === cand);
    do { i += d; } while (i >= 0 && i < L.length && L[i].id === sel.primary);
    if (i < 0 || i >= L.length) return;
    ctx.set({ ui: { selection: { ids: [sel.primary, L[i].id], primary: sel.primary, anchor: sel.primary } } });
    return;
  }
  const cur = primaryOf(ctx.state);
  let i = cur ? L.findIndex(p => p.id === cur.id) : -1;
  i = Math.max(0, Math.min(L.length - 1, i + d));
  if (cur && L[i].id === cur.id) return;
  ctx.set({ ui: { selection: { ids: [L[i].id], primary: L[i].id, anchor: L[i].id } } });
}
function newCollection(ctx, ids) {
  const input = h('input', { class: 'ck-field-i', value: 'New collection', 'aria-label': 'Name' });
  const sel = selectedIds(ctx.state);
  const box = h('label', { class: 'ck-check' }, h('input', { type: 'checkbox', checked: sel.length > 0 }), h('span', { text: `Include the ${sel.length} selected photo${sel.length === 1 ? '' : 's'}` }));
  ctx.dialog({ title: 'Create Collection', body: h('div', { class: 'ck-col' }, input, box), buttons: [{ label: 'Cancel' }, { label: 'Create', primary: true, run: () => {
    const name = input.value.trim() || 'Untitled'; const id = 'c' + Date.now().toString(36);
    const with_ = box.querySelector('input').checked ? (ids || sel) : [];
    ctx.tx(`Create Collection "${name}"`, t => { t.catalog.collections.push({ id, name, ids: with_ }); });
    ctx.set({ view: { source: 'collection:' + id } });
  } }] });
}
export function pickFiles(ctx) {
  const inp = h('input', { type: 'file', accept: 'image/*', multiple: true });
  inp.style.display = 'none'; document.body.append(inp);
  inp.onchange = async () => { await addFiles([...inp.files], ctx); inp.remove(); };
  inp.click();
}
export async function addFiles(files, ctx) {
  const photos = await importFiles(files, ctx.app);
  if (!photos.length) { ctx.toast('No images in what was dropped'); return; }
  ctx.tx(`Import ${photos.length} Photo${photos.length === 1 ? '' : 's'}`, t => { for (const p of photos) { t.catalog.photos.push(p); t.dev[p.id] = ctx.state.devDefaults; } });
  ctx.set({ view: { source: 'previous', mode: 'grid' }, ui: { selection: { ids: photos.map(p => p.id), primary: photos[0].id, anchor: photos[0].id } } });
  ctx.toast(`Imported ${photos.length} photo${photos.length === 1 ? '' : 's'}. They stay until you close or reload this page (the browser keeps the sample shoot, not your files).`);
}

// ── panels ──
const count = n => h('span', { class: 'lib-count', text: String(n) });
export function catalogPanel() {
  return ck.panel('catalog', { title: 'Catalog' },
    ck.view.list(s => [
      { id: 'all', name: 'All Photographs', n: s.catalog.photos.length },
      { id: 'collection:quick', name: 'Quick Collection +', n: (s.catalog.collections.find(c => c.quick) || { ids: [] }).ids.length },
      { id: 'previous', name: 'Previous Import', n: s.catalog.photos.filter(p => p.imported).length },
    ], {
      row: it => ck.html(m => { const r = h('div', { class: 'lib-src' }, h('span', { text: it.name }), count(it.n)); m.cell(s => (s.view.source || 'all') === it.id, on => r.classList.toggle('is-on', on)); return r; }),
      select: { mode: 'none' }, rowHeight: 22,
      activate: (it, ctx) => ctx.set({ view: { source: it.id } }),
      onSelect: undefined,
      dnd: { accepts: 'photo', drop: (d, it, ctx) => { if (it.id === 'collection:quick') { ctx.tx('Add to Quick Collection', t => { const q = t.catalog.collections.find(c => c.quick); q.ids = [...new Set(q.ids.concat(d.ids))]; }); ctx.flash('Added to Quick Collection'); } } },
    }));
}
export function foldersPanel() {
  return ck.panel('folders', { title: 'Folders' },
    ck.view.list(s => { const m = new Map(); for (const p of s.catalog.photos) m.set(p.folder, (m.get(p.folder) || 0) + 1); return [...m.entries()].sort().map(([f, n]) => ({ id: 'folder:' + f, name: f, n })); }, {
      row: it => ck.html(m => { const r = h('div', { class: 'lib-src' }, icon('folder', 12), h('span', { text: it.name }), count(it.n)); m.cell(s => s.view.source === it.id, on => r.classList.toggle('is-on', on)); return r; }),
      select: { mode: 'none' }, rowHeight: 22, activate: (it, ctx) => ctx.set({ view: { source: it.id } }),
    }));
}
export function collectionsPanel() {
  return ck.panel('collections', { title: 'Collections', menu: ['collection.new'] },
    ck.view.list(s => s.catalog.collections.filter(c => !c.quick), {
      row: c => ck.html(m => {
        const r = h('div', { class: 'lib-src' }, icon('folder', 12), h('span', { text: c.name }), count(c.ids.length));
        m.cell(s => s.view.source === 'collection:' + c.id, on => r.classList.toggle('is-on', on));
        m.cell(s => s.catalog.target === c.id, on => { r.classList.toggle('is-target', on); r.dataset.tip = on ? 'Target collection: B adds the selection here' : ''; });
        return r;
      }),
      rowHeight: 22,
      activate: (c, ctx) => ctx.set({ view: { source: 'collection:' + c.id } }),
      onSelect: (sel, ctx) => { if (sel.primary) ctx.set({ view: { source: 'collection:' + sel.primary } }); },
      context: (s, c) => [{ label: 'Set as Target Collection', run: (cc, ctx) => ctx.tx('Set Target Collection', t => { t.catalog.target = c.id; }) }, { label: 'Rename…', run: (cc, ctx) => renameCollection(ctx, c) }, '-', { label: 'Delete', run: (cc, ctx) => { ctx.tx(`Delete Collection "${c.name}"`, t => { t.catalog.collections = t.catalog.collections.$value.filter(x => x.id !== c.id); }); if (ctx.state.view.source === 'collection:' + c.id) ctx.set({ view: { source: 'all' } }); } }],
      dnd: { accepts: 'photo', drop: (d, c, ctx) => { ctx.tx(`Add to ${c.name}`, t => { const tc = t.catalog.collections.find(x => x.id === c.id); tc.ids = [...new Set(tc.ids.concat(d.ids))]; }); ctx.flash(`Added ${d.ids.length} to ${c.name}`); },
        reorder: (ids, to, ctx) => ctx.tx('Reorder Collections', t => { const all = t.catalog.collections.$value, quick = all.filter(c => c.quick), list = all.filter(c => !c.quick); const moving = list.filter(c => ids.includes(c.id)), rest = list.filter(c => !ids.includes(c.id)); const anchor = list[to] && !ids.includes(list[to].id) ? list[to].id : null; const at = anchor ? rest.findIndex(c => c.id === anchor) : rest.length; t.catalog.collections = quick.concat(rest.slice(0, at), moving, rest.slice(at)); }) },
      select: { mode: 'single' },
      keys: { Delete: 'collection.delete', Backspace: 'collection.delete', F2: 'collection.rename' },
      empty: 'No collections',
    }));
}
// the collection being shown, for the keys of the Collections list
const shownCollection = s => { const src = s.view.source || ''; return src.startsWith('collection:') ? s.catalog.collections.find(c => c.id === src.slice(11) && !c.quick) || null : null; };
export function collectionCommands(c) {
  c.add('collection.delete', { module: 'library', label: s => { const k = shownCollection(s); return k ? `Delete Collection "${k.name}"` : 'Delete Collection'; }, menu: 'Library', enabled: s => !!shownCollection(s), why: 'Choose a collection first', run: ctx => { const k = shownCollection(ctx.state); ctx.tx(`Delete Collection "${k.name}"`, t => { t.catalog.collections = t.catalog.collections.$value.filter(x => x.id !== k.id); if (t.catalog.target === k.id) t.catalog.target = 'quick'; }); ctx.set({ view: { source: 'all' } }); ctx.toast(`Deleted "${k.name}" (Undo brings it back)`, { kind: 'info' }); } })
    .add('collection.rename', { module: 'library', label: 'Rename Collection…', menu: 'Library', enabled: s => !!shownCollection(s), why: 'Choose a collection first', run: ctx => renameCollection(ctx, shownCollection(ctx.state)) });
}
function renameCollection(ctx, c) {
  const input = h('input', { class: 'ck-field-i', value: c.name, 'aria-label': 'Name' });
  ctx.dialog({ title: 'Rename Collection', body: input, buttons: [{ label: 'Cancel' }, { label: 'Rename', primary: true, run: () => ctx.tx(`Rename Collection`, t => { t.catalog.collections.find(x => x.id === c.id).name = input.value.trim() || c.name; }) }] });
}

const photoIndex = s => { const id = s.ui.selection && s.ui.selection.primary; return Math.max(0, s.catalog.photos.findIndex(p => p.id === id)); };
export function metadataPanel() {
  // typing applies to every selected photo, as Lightroom's Grid does (the selection as it was when typing began)
  const field = (key, label, multiline) => ck.ui.textField({
    bind: s => s.catalog.photos[photoIndex(s)][key], label, multiline, disabled: s => !primaryOf(s),
    set: (v, at, ctx) => { const ids = selectedIds(at.state); if (!ids.length) return; ctx.tx(ids.length > 1 ? `Edit ${label} (${ids.length} photos)` : `Edit ${label}`, t => { for (const p of t.catalog.photos) if (ids.includes(p.id)) p[key] = v; }, { coalesce: 'meta:' + key + ':' + ids.join(',') }); },
  });
  const info = (label, f) => ck.stat(s => { const p = primaryOf(s); return p ? f(p, s) : '—'; }, { label });
  return ck.panel('metadata', { title: 'Metadata' },
    ck.column({ class: 'lib-meta' },
      field('title', 'Title'), field('caption', 'Caption', true), field('copyright', 'Copyright'),
      ck.divider(),
      info('File Name', p => p.name), info('Folder', p => p.folder), info('Dimensions', p => `${p.w} × ${p.h}`),
      info('Cropped', (p, s) => { const r = (s.dev[p.id] || s.devDefaults).crop.geometry.rect; return `${Math.round((r.x1 - r.x0) * p.w)} × ${Math.round((r.y1 - r.y0) * p.h)}`; }),
      info('Capture Time', p => p.date.replace('T', ' ')), info('Camera', p => p.camera),
      info('Rating', p => (p.rating ? '★'.repeat(p.rating) : 'none')), info('Label', p => (p.label ? LABEL_NAMES[p.label] : 'none')),
    ));
}
export function keywordPanel() {
  return ck.panel('keywording', { title: 'Keywording' }, ck.html(m => {
    const el = h('div', { class: 'lib-kw' });
    const tags = h('div', { class: 'lib-kw-tags' });
    const input = h('input', { class: 'ck-field-i', placeholder: 'Add keywords (comma separated), Enter', 'aria-label': 'Add keywords' });
    const sug = h('div', { class: 'lib-kw-sug' });
    el.append(tags, input, h('div', { class: 'lib-kw-h', text: 'Suggestions' }), sug);
    const apply = (words, remove) => {
      const ids = selectedIds(m.store.readonly()); if (!ids.length) return;
      m.store.tx(remove ? `Remove Keyword "${words[0]}"` : `Add Keyword${words.length > 1 ? 's' : ''}`, t => { for (const p of t.catalog.photos) if (ids.includes(p.id)) p.keywords = remove ? p.keywords.$value.filter(k => !words.includes(k)) : [...new Set(p.keywords.$value.concat(words))]; });
    };
    input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { const w = input.value.split(',').map(x => x.trim().replace(/\s+/g, ' ').toLowerCase()).filter(Boolean); if (w.length) apply(w); input.value = ''; } });
    m.cell(s => { const p = primaryOf(s); const all = new Map(); for (const q of s.catalog.photos) for (const k of q.keywords) all.set(k, (all.get(k) || 0) + 1); return { mine: p ? p.keywords : [], top: [...all.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(x => x[0]) }; }, v => {
      tags.replaceChildren(...(v.mine.length ? v.mine.map(k => { const t = h('button', { type: 'button', class: 'lib-tag', 'data-tip': 'Remove from the selected photos' }, h('span', { text: k }), icon('close', 9)); t.onclick = () => apply([k], true); return t; }) : [h('span', { class: 'ck-text is-dim', text: 'No keywords' })]));
      sug.replaceChildren(...v.top.filter(k => !v.mine.includes(k)).slice(0, 9).map(k => { const t = h('button', { type: 'button', class: 'lib-sug', text: k }); t.onclick = () => apply([k]); return t; }));
    });
    return el;
  }));
}
export function quickDevelopPanel() {
  const nudge = (label, path, d, scale = 1) => ck.ui.button({ text: label, small: true, run: ctx => {
    const ids = selectedIds(ctx.state); if (!ids.length) return;
    ctx.tx(`Quick Develop: ${path[path.length - 1].replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())} ${d > 0 ? '+' : '−'}${Math.abs(d)}`, t => { for (const id of ids) { const cur = ctx.state.dev[id] || ctx.state.devDefaults; let v = cur; for (const k of path) v = v[k]; t.dev[id] = merge(cur, path.reduceRight((o, k) => ({ [k]: o }), +(v + d * scale).toFixed(3))); } }, { channel: ids[0], snapPath: ['dev', ids[0]] });
  } });
  const row = (name, path, small, big) => ck.row({ class: 'lib-qd' }, ck.text(name, { dim: true }), nudge('◀◀', path, -big), nudge('◀', path, -small), nudge('▶', path, small), nudge('▶▶', path, big));
  return ck.panel('quick-develop', { title: 'Quick Develop', open: false },
    ck.column({ gap: 3 },
      row('Exposure', ['light', 'exposure'], 0.33, 1), row('Contrast', ['light', 'contrast'], 5, 20), row('Highlights', ['light', 'highlights'], 5, 20),
      row('Shadows', ['light', 'shadows'], 5, 20), row('Clarity', ['effects', 'clarity'], 5, 20), row('Vibrance', ['color', 'vibrance'], 5, 20),
      ck.row(ck.ui.command('develop.auto', { small: true, text: 'Auto Tone' }), ck.ui.command('photo.resetDevelop', { small: true, text: 'Reset All' }))));
}
export function histogramPanel(id = 'histogram') {
  return ck.panel(id, { title: 'Histogram', fixed: true },
    ck.view.histogram(s => s.ui.hist, { clip: s => s.view.clipping, info: s => { const p = primaryOf(s); return p ? `${p.w} × ${p.h}` : ''; } }));
}
export function navigatorPanel() {
  return ck.panel('navigator', { title: 'Navigator', fixed: false }, ck.html(m => navigator(m)));
}
// the navigator: the photo small, the visible part outlined; click or drag to move there; zoom presets
function navigator(m) {
  const app = m.app;
  const el = h('div', { class: 'nav' });
  const zooms = h('div', { class: 'nav-z' }, ...[['FIT', 'fit'], ['FILL', 'fill'], ['1:1', 1], ['2:1', 2]].map(([t, z]) => { const b = h('button', { type: 'button', class: 'nav-zb', text: t }); b.onclick = () => { const v = app.viewport('main'); v && v.setZoom(z); }; b.dataset.z = String(z); return b; }));
  const box = h('div', { class: 'nav-b' });
  const cv = h('canvas', { class: 'nav-c' });
  const rect = h('div', { class: 'nav-r' });
  box.append(cv, rect);
  el.append(zooms, box);
  const thumbImg = new Image(); thumbImg.onload = () => draw();
  const draw = () => {
    const v = app.viewport('main');
    let bmp = v && v.bitmap();
    if (!bmp) {
      rect.hidden = true;
      const p = primaryOf(app.store.readonly()); if (!p) return;
      if (thumbImg.getAttribute('src') !== p.thumb) { thumbImg.src = p.thumb; return; }
      if (!thumbImg.complete || !thumbImg.naturalWidth) return;
      const W = box.clientWidth || 220, Hh = Math.round(W * thumbImg.naturalHeight / thumbImg.naturalWidth);
      cv.width = W * 2; cv.height = Hh * 2; cv.style.height = Hh + 'px';
      cv.getContext('2d').drawImage(thumbImg, 0, 0, cv.width, cv.height);
      return;
    }
    const W = box.clientWidth || 220, Hh = Math.round(W * bmp.height / bmp.width);
    cv.width = W * 2; cv.height = Hh * 2; cv.style.height = Hh + 'px';
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    const V = v.view;
    const iw = V.nw * V.s, ih = V.nh * V.s;
    const fx = Math.max(0, -V.ox / iw), fy = Math.max(0, -V.oy / ih), fw = Math.min(1, V.W / iw), fh = Math.min(1, V.H / ih);
    rect.hidden = fw >= 0.999 && fh >= 0.999;
    Object.assign(rect.style, { left: fx * 100 + '%', top: fy * 100 + '%', width: fw * 100 + '%', height: fh * 100 + '%' });
    for (const b of zooms.children) b.classList.toggle('is-on', String(V.zoom) === b.dataset.z);
  };
  const off = app.on('rendered', () => requestAnimationFrame(draw));
  m.scope.onDispose(off);
  m.cell(s => [s.view.vp && s.view.vp.main, s.ui.selection && s.ui.selection.primary, s.view.mode], () => requestAnimationFrame(draw));
  const go = e => { const v = app.viewport('main'); if (!v) return; const r = box.getBoundingClientRect(); const zoom = v.view.zoom === 'fit' ? 1 : v.view.zoom; app.store.set(['view', 'vp', 'main'], { zoom, cx: (e.clientX - r.left) / r.width, cy: (e.clientY - r.top) / r.height }); };
  box.addEventListener('pointerdown', e => { go(e); box.setPointerCapture(e.pointerId); const mv = ev => go(ev); box.addEventListener('pointermove', mv); box.addEventListener('pointerup', () => box.removeEventListener('pointermove', mv), { once: true }); });
  return el;
}

// ── the filter bar ──
function filterBar() {
  const flagOpt = [{ value: '', label: 'All' }, { value: 'picks', label: 'Picks', icon: 'pick' }, { value: 'unflagged', label: 'Unflagged' }, { value: 'rejects', label: 'Rejected', icon: 'reject' }];
  return ck.bar({ class: 'lib-filter' },
    ck.ui.search({ bind: s => s.view.filter.text, placeholder: 'Search titles, keywords, captions' }),
    ck.text('Flag', { dim: true }), ck.ui.segmented(flagOpt.map(o => ({ value: o.value || null, label: o.label })), { bind: s => s.view.filter.flag, small: true }),
    ck.text('Rating', { dim: true }), ck.ui.select([{ value: 0, label: 'Any' }, 1, 2, 3, 4, 5].map(v => (typeof v === 'number' ? { value: v, label: '≥ ' + '★'.repeat(v) } : v)), { bind: s => s.view.filter.rating, compact: true }),
    ck.text('Label', { dim: true }), ck.ui.select([{ value: null, label: 'Any' }].concat(LABELS.map(l => ({ value: l, label: LABEL_NAMES[l] }))), { bind: s => s.view.filter.label, compact: true }),
    ck.ui.checkbox('Edited', { bind: s => s.view.filter.edited }),
    ck.spacer(),
    ck.stat(s => { const n = filtered(s).length, all = sourcePhotos(s).length; return n === all ? `${n} photos` : `${n} of ${all}`; }),
    ck.ui.command('library.clearFilter', { small: true, quiet: true, text: 'Clear' }));
}

// ── survey: the selection, sized to fit, no scrolling ──
function survey() {
  return ck.html(m => {
    const el = h('div', { class: 'lib-survey' });
    m.cell(s => selectedIds(s).map(id => s.catalog.photos.find(p => p.id === id)).filter(Boolean), list => {
      const n = list.length, cols = Math.ceil(Math.sqrt(n * 1.5));
      el.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
      el.replaceChildren(...list.map(p => {
        const c = h('div', { class: 'lib-sv', 'data-id': p.id });
        const sm = m.child('sv');
        c.append(sm.mount(ck.view.thumb({ src: p.thumb, image: thumb, arg: s => ({ file: p.file, dev: s.dev[p.id] || s.devDefaults }), engine: s => isEdited(s, p.id), max: 640 })));
        const x = h('button', { type: 'button', class: 'lib-sv-x', 'aria-label': 'Drop from the survey', 'data-tip': 'Drop from the survey' }, icon('close', 10));
        x.onclick = e => { e.stopPropagation(); const sel = m.store.peek(['ui', 'selection']); const ids = sel.ids.filter(i => i !== p.id); m.store.set(['ui', 'selection'], { ids, primary: sel.primary === p.id ? ids[0] : sel.primary, anchor: sel.anchor }); };
        c.append(x, h('span', { class: 'lib-sv-f' }, p.flag ? icon(flagIcon(p.flag), 11) : '', p.rating ? '★'.repeat(p.rating) : ''));
        c.onclick = () => { const sel = m.store.peek(['ui', 'selection']); m.store.set(['ui', 'selection'], Object.assign({}, sel, { primary: p.id })); };
        m.cell(s => s.ui.selection.primary === p.id, on => c.classList.toggle('is-primary', on));
        return c;
      }));
    });
    return el;
  });
}

// the second photo of a compare: the first selected photo that is not the primary
const candidateId = s => { const sel = s.ui.selection || { ids: [] }; return sel.ids.find(id => id !== sel.primary) || null; };
const candidate = ck.image(s => { const id = candidateId(s); const p = id && s.catalog.photos.find(x => x.id === id); return p ? p.file : null; }).develop(s => { const id = candidateId(s); return effective((id && s.dev[id]) || s.devDefaults, id && s.catalog.photos.find(x => x.id === id)); });

export function libraryModule(shell) {
  shell.module('library', m => m.label('Library').key('G').icon('grid')
    .left(ck.dock.column({ width: 236, solo: false }, navigatorPanel(), catalogPanel(), foldersPanel(), collectionsPanel()))
    .center(ck.column({ class: 'lib-center', grow: 1 },
      ck.when(s => s.view.filterBar !== false && s.view.mode === 'grid', filterBar()),
      ck.match(s => s.view.mode, {
        grid: ck.view.grid(s => s.catalog.filtered, {
          id: 'library-grid',
          cell: (p, i) => photoCell(p, i),
          size: s => s.view.thumbSize, caption: true, aspect: 1 / 1.14,
          select: { bind: s => s.ui.selection, mode: 'multi' },
          keys: { E: 'view.loupe', Enter: 'view.loupe' },
          activate: (p, ctx) => ctx.set({ view: { mode: 'loupe' } }),
          context: ['photo.pick', 'photo.reject', 'photo.unflag', '-', 'collection.addToTarget', 'collection.new', '-', 'photo.resetDevelop', '-', 'module.develop'],
          dnd: { source: 'photo', reorder: (ids, to, ctx) => {
            if (ctx.state.view.sort !== 'custom') { ctx.toast('Choose Sort ▸ User Order to arrange photos by hand'); return; }
            const L = filtered(ctx.state), anchor = L[to] && !ids.includes(L[to].id) ? L[to].id : null;
            ctx.tx(`Move ${ids.length} Photo${ids.length === 1 ? '' : 's'}`, t => {
              const all = t.catalog.photos.$value, moving = all.filter(p => ids.includes(p.id)), rest = all.filter(p => !ids.includes(p.id));
              const at = anchor ? rest.findIndex(p => p.id === anchor) : rest.length;
              t.catalog.photos = rest.slice(0, at).concat(moving, rest.slice(at));
            });
          } },
          empty: s => (s.catalog.photos.length ? 'No photos match the filter' : 'Import photos to begin (File ▸ Import, or drop files here)'),
        }),
        loupe: ck.viewport(render, { id: 'main', dims: s => { const p = primaryOf(s); return p ? [p.w, p.h] : null; }, click: 'toggle-1:1', before, drop: (files, ctx) => addFiles(files, ctx),
          hud: ck.html(m2 => { const el = h('div', { class: 'lib-info' }); m2.cell(s => { const p = primaryOf(s); const lvl = s.view.loupeInfo || 0; if (!p || !lvl) return ''; return lvl === 1 ? `${p.title}\n${p.name} · ${p.w} × ${p.h}` : `${p.title}\n${p.date.replace('T', ' ')} · ${p.camera}\n${p.keywords.join(', ')}`; }, v => { el.textContent = v; el.hidden = !v; }); return el; }) }),
        compare: ck.row({ class: 'lib-compare', grow: 1 },
          ck.viewport(render, { id: 'main', label: 'Select', dims: s => { const p = primaryOf(s); return p ? [p.w, p.h] : null; }, compare: false }),
          ck.viewport(candidate, { id: 'candidate', label: 'Candidate', compare: false })),
        survey: survey(),
      }, { of: ['grid', 'loupe', 'compare', 'survey'] })))
    .right(ck.dock.column({ width: 260 }, histogramPanel('lib-histogram'), quickDevelopPanel(), keywordPanel(), metadataPanel()))
    .bottom(ck.view.filmstrip(s => s.catalog.filtered, { id: 'filmstrip', cell: (p, i) => photoCell(p, i, { compact: true }), select: { bind: s => s.ui.selection, mode: 'multi' }, dnd: { source: 'photo' }, activate: (p, ctx) => ctx.set({ view: { mode: 'loupe' } }), aspect: 1.15 }))
    .toolbar(ck.bar({ class: 'lib-tb' },
      ck.toolbar(['view.grid', 'view.loupe', 'view.compare', 'view.survey']),
      ck.text('Sort', { dim: true }), ck.ui.select([{ value: 'capture', label: 'Capture Time' }, { value: 'name', label: 'File Name' }, { value: 'rating', label: 'Rating' }, { value: 'flag', label: 'Pick' }, { value: 'custom', label: 'User Order' }], { bind: s => s.view.sort, compact: true }),
      ck.toolbar(['photo.pick', 'photo.reject']),
      ck.spacer(),
      ck.ui.button({ icon: 'import', text: 'Import…', run: 'library.import', small: true }),
      ck.when(s => s.view.mode === 'grid', ck.row({ style: { width: '210px' } }, ck.ui.slider(90, 320, { bind: s => s.view.thumbSize, label: 'Thumbnails', compact: true, labelWidth: 70, format: v => Math.round(v) + '' }))),
    ))
    .keys({ ...CULL_KEYS, G: 'view.grid', E: 'view.loupe', C: 'view.compare', N: 'view.survey', I: 'view.loupeInfo', '\\': 'library.filterBar', 'Mod+F': 'library.find', ArrowRight: 'photo.next', ArrowLeft: 'photo.previous', 'Mod+Shift+I': 'library.import', 'Mod+Alt+N': 'collection.new', 'Mod+A': 'library.selectAll', 'Mod+D': 'library.selectNone' }));
}
