// The catalog: photos and their metadata as document state, plus the queries the modules share.
// The sample shoot is the Kodak Lossless True Color Image Suite (24 film scans, released by Kodak for unrestricted
// use); imported files join it and live for the session (their pixels are not kept by autosave).

const SHOOT = [
  ['kodim01', 'Shuttered house', ['architecture', 'stone', 'windows'], 'Suite A'],
  ['kodim02', 'Red door', ['architecture', 'red', 'detail'], 'Suite A'],
  ['kodim03', 'Hats on a wall', ['still life', 'color'], 'Suite A'],
  ['kodim04', 'Red hat portrait', ['portrait', 'red'], 'Suite A'],
  ['kodim05', 'Motocross start', ['sport', 'action'], 'Suite A'],
  ['kodim06', 'Moored boat', ['water', 'boat'], 'Suite A'],
  ['kodim07', 'Hibiscus window', ['flowers', 'architecture'], 'Suite A'],
  ['kodim08', 'Half-timbered street', ['architecture', 'town'], 'Suite A'],
  ['kodim09', 'Regatta', ['water', 'sailing'], 'Suite A'],
  ['kodim10', 'Regatta, close', ['water', 'sailing'], 'Suite A'],
  ['kodim11', 'Old pier', ['water', 'boat'], 'Suite A'],
  ['kodim12', 'Beach walk', ['water', 'people', 'beach'], 'Suite A'],
  ['kodim13', 'Mountain stream', ['landscape', 'water'], 'Suite B'],
  ['kodim14', 'White water', ['sport', 'water', 'people'], 'Suite B'],
  ['kodim15', 'Face paint', ['portrait', 'child'], 'Suite B'],
  ['kodim16', 'Island', ['landscape', 'water', 'sky'], 'Suite B'],
  ['kodim17', 'Gilded statue', ['sculpture', 'detail'], 'Suite B'],
  ['kodim18', 'Garden portrait', ['portrait', 'garden'], 'Suite B'],
  ['kodim19', 'Lighthouse and fence', ['architecture', 'lighthouse'], 'Suite B'],
  ['kodim20', 'Mustang', ['aircraft', 'sport'], 'Suite B'],
  ['kodim21', 'Lighthouse point', ['landscape', 'lighthouse', 'water'], 'Suite B'],
  ['kodim22', 'Red barn', ['landscape', 'architecture', 'red'], 'Suite B'],
  ['kodim23', 'Macaws', ['birds', 'color'], 'Suite B'],
  ['kodim24', 'Painted house', ['architecture', 'mural'], 'Suite B'],
];
const PORTRAIT = new Set(['kodim04', 'kodim09', 'kodim10', 'kodim17', 'kodim18', 'kodim19']);

export function sampleCatalog() {
  const photos = SHOOT.map(([id, title, keywords, folder], i) => {
    const tall = PORTRAIT.has(id);
    return {
      id, file: id + '.jpg', thumb: 'photos/thumbs/' + id + '.jpg', url: 'photos/' + id + '.jpg',
      name: id.toUpperCase() + '.JPG', title, keywords, folder: '1991/' + folder,
      w: tall ? 512 : 768, h: tall ? 768 : 512,
      date: `1991-0${1 + (i % 9)}-${String(3 + (i * 7) % 25).padStart(2, '0')}T${String(9 + (i % 8)).padStart(2, '0')}:${String((i * 13) % 60).padStart(2, '0')}`,
      camera: 'Kodak Photo CD scan', lens: '—', iso: null, shutter: null, aperture: null, focal: null,
      flag: null, rating: 0, label: null, caption: '', copyright: '', imported: false,
    };
  });
  return {
    name: 'Kodak Suite',
    photos,
    collections: [
      { id: 'quick', name: 'Quick Collection', ids: [], quick: true },
      { id: 'portraits', name: 'Portraits', ids: ['kodim04', 'kodim15', 'kodim18'] },
      { id: 'water', name: 'On the water', ids: ['kodim06', 'kodim09', 'kodim10', 'kodim11', 'kodim14', 'kodim21'] },
      { id: 'zine', name: 'Zine: Coastline', ids: ['kodim06', 'kodim11', 'kodim12', 'kodim16', 'kodim19', 'kodim21', 'kodim22', 'kodim13'] },
    ],
    target: 'quick',
  };
}

export const LABELS = ['red', 'yellow', 'green', 'blue', 'purple'];
export const LABEL_NAMES = { red: 'Red', yellow: 'Yellow', green: 'Green', blue: 'Blue', purple: 'Purple' };

// ── queries (used by derived paths, so they run traced) ──
export function sourcePhotos(s) {
  const src = s.view.source || 'all';
  const all = s.catalog.photos;
  if (src === 'all') return all;
  if (src === 'previous') return all.filter(p => p.imported);
  if (src.startsWith('folder:')) return all.filter(p => p.folder === src.slice(7));
  if (src.startsWith('collection:')) { const c = s.catalog.collections.find(x => x.id === src.slice(11)); if (!c) return []; const set = new Set(c.ids); return all.filter(p => set.has(p.id)); }
  return all;
}
export function filtered(s) {
  const f = s.view.filter || {};
  let list = sourcePhotos(s);
  if (f.flag === 'picks') list = list.filter(p => p.flag === 'pick');
  else if (f.flag === 'rejects') list = list.filter(p => p.flag === 'reject');
  else if (f.flag === 'unflagged') list = list.filter(p => !p.flag);
  else if (f.flag === 'hide-rejects') list = list.filter(p => p.flag !== 'reject');
  if (f.rating) list = list.filter(p => p.rating >= f.rating);
  if (f.label) list = list.filter(p => p.label === f.label);
  if (f.text) { const q = f.text.toLowerCase(); list = list.filter(p => (p.title + ' ' + p.name + ' ' + p.keywords.join(' ') + ' ' + p.caption).toLowerCase().includes(q)); }
  if (f.edited) list = list.filter(p => s.dev[p.id] !== s.devDefaults);
  const sort = s.view.sort || 'capture';
  if (sort === 'capture') list = list.slice().sort((a, b) => a.date.localeCompare(b.date));
  else if (sort === 'name') list = list.slice().sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === 'rating') list = list.slice().sort((a, b) => b.rating - a.rating || a.date.localeCompare(b.date));
  else if (sort === 'custom') { /* user order: the catalog's own order */ }
  else if (sort === 'flag') { const o = { pick: 0, null: 1, reject: 2 }; list = list.slice().sort((a, b) => o[a.flag] - o[b.flag]); }
  return list;
}
export const primaryOf = s => { const id = s.ui.selection && s.ui.selection.primary; return (id && s.catalog.photos.find(p => p.id === id)) || null; };
export const selectedIds = s => (s.ui.selection && s.ui.selection.ids.length ? s.ui.selection.ids : s.ui.selection && s.ui.selection.primary ? [s.ui.selection.primary] : []);

// capture times are shown as written, in local time (an ISO string would be UTC)
const localStamp = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

// ── imports: files dropped or chosen become photos (thumbnails made here, pixels sent to the engine on use) ──
let importSeq = 0;
export async function importFiles(files, app) {
  const out = [];
  for (const f of files) {
    if (!/^image\//.test(f.type)) continue;
    let bmp;
    try { bmp = await createImageBitmap(f); } catch (e) { app.chrome.toast(`Could not read ${f.name}`, { kind: 'error' }); continue; }
    const id = 'imp' + Date.now().toString(36) + (++importSeq);
    const k = Math.min(1, 320 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const thumb = await new Promise(r => c.toBlob(b => r(URL.createObjectURL(b)), 'image/jpeg', 0.86));
    const file = id + '-' + f.name.replace(/[^\w.-]+/g, '_');
    app.engine.declareAsset(file, f);
    out.push({ id, file, thumb, url: URL.createObjectURL(f), name: f.name, title: f.name.replace(/\.[^.]+$/, ''), keywords: [], folder: 'Imported', w: bmp.width, h: bmp.height, date: localStamp(new Date(f.lastModified || Date.now())), camera: '—', lens: '—', iso: null, shutter: null, aperture: null, focal: null, flag: null, rating: 0, label: null, caption: '', copyright: '', imported: true });
    bmp.close && bmp.close();
  }
  return out;
}
