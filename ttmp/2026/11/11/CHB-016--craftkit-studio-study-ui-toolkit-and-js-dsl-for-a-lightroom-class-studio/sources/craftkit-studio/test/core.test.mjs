import assert from 'node:assert/strict';
import { Store } from '../src/shell/core/store.js';
import { History } from '../src/shell/core/history.js';
import { Cell, Scheduler } from '../src/shell/core/cells.js';
import { track, bindingPath, missingKey } from '../src/shell/core/track.js';

let n = 0; const t = (name, f) => { try { f(); n++; } catch (e) { console.error('FAIL', name); throw e; } };

const init = () => ({
  develop: { light: { exposure: 0, contrast: 0 }, color: { vibrance: 0 } },
  catalog: { photos: [{ id: 'a', flag: null, rating: 0 }, { id: 'b', flag: 'pick', rating: 3 }, { id: 'c', flag: null, rating: 5 }] },
  ui: { mode: 'grid' },
});

t('read sets drop navigation', () => {
  const s = new Store(init());
  const r = track(s, st => st.develop.light.exposure);
  assert.deepEqual(r.reads.map(x => x.path.join('.')), ['develop.light.exposure']);
  const r2 = track(s, st => st.catalog.photos.filter(p => p.rating >= 3));
  assert.equal(r2.value.length, 2);
  assert.equal(r2.value[0], s.doc.catalog.photos[1], 'result is unwrapped to the real objects');
  assert.ok(r2.reads.some(x => x.path.join('.') === 'catalog.photos.1'), 'escaped elements are whole reads');
});

t('binding paths and missing keys', () => {
  const s = new Store(init());
  const key = 'contrast';
  assert.deepEqual(bindingPath(s, st => st.develop.light[key]).path, ['develop', 'light', 'contrast']);
  const m = missingKey(s.doc, ['develop', 'light', 'exposur']);
  assert.equal(m.key, 'exposur'); assert.deepEqual(m.has, ['exposure', 'contrast']);
});

t('cells re-run only when their reads change', () => {
  const s = new Store(init()); const sch = new Scheduler(s); new History(s);
  let runs = 0, seen = null;
  new Cell(s, st => st.develop.light.exposure, v => { runs++; seen = v; });
  assert.equal(runs, 1);
  s.tx('Contrast', tt => { tt.develop.light.contrast = 20; }); sch.flushSync();
  assert.equal(runs, 1, 'a sibling write does not re-run');
  s.tx('Exposure', tt => { tt.develop.light.exposure = 0.5; }); sch.flushSync();
  assert.equal(runs, 2); assert.equal(seen, 0.5);
});

t('preview then commit is one undo step', () => {
  const s = new Store(init()); const sch = new Scheduler(s); const h = new History(s);
  let seen = [];
  new Cell(s, st => st.develop.light.exposure, v => seen.push(v));
  for (const v of [0.1, 0.2, 0.3]) { s.preview(['develop', 'light', 'exposure'], v); sch.flushSync(); }
  assert.equal(s.doc.develop.light.exposure, 0, 'the document is untouched while previewing');
  s.commit('Exposure'); sch.flushSync();
  assert.equal(h.entries.length, 1); assert.equal(s.doc.develop.light.exposure, 0.3);
  assert.deepEqual(seen, [0, 0.1, 0.2, 0.3]);
  h.undo(); sch.flushSync();
  assert.equal(s.doc.develop.light.exposure, 0); assert.equal(seen[seen.length - 1], 0);
  h.redo(); assert.equal(s.doc.develop.light.exposure, 0.3);
});

t('view tier is not undoable', () => {
  const s = new Store(init()); const h = new History(s);
  s.set('ui.mode', 'loupe');
  assert.equal(s.doc.ui.mode, 'loupe'); assert.equal(h.entries.length, 0);
  s.setMany({ ui: { mode: 'compare' }, develop: { light: { exposure: 1 } } }, { label: 'Both' });
  assert.equal(s.doc.ui.mode, 'compare'); assert.equal(h.entries.length, 1); assert.equal(s.doc.develop.light.exposure, 1);
});

t('drafts: arrays and find', () => {
  const s = new Store(init()); const h = new History(s);
  const before = s.doc.catalog.photos;
  s.tx('Pick', tt => { tt.catalog.photos.find(p => p.id === 'a').flag = 'pick'; });
  assert.equal(s.doc.catalog.photos[0].flag, 'pick');
  assert.equal(before[0].flag, null, 'the old state is untouched');
  assert.equal(s.doc.catalog.photos[1], before[1], 'untouched siblings keep identity');
  s.tx('Add', tt => { tt.catalog.photos.push({ id: 'd', flag: null, rating: 0 }); });
  assert.equal(s.doc.catalog.photos.length, 4);
  h.undo(); assert.equal(s.doc.catalog.photos.length, 3);
  h.undo(); assert.equal(s.doc.catalog.photos[0].flag, null);
});

t('coalescing nudges', () => {
  const s = new Store(init()); const h = new History(s);
  for (let i = 1; i <= 5; i++) s.tx('Exposure', tt => { tt.develop.light.exposure = i / 10; }, { coalesce: 'nudge:exposure' });
  assert.equal(h.entries.length, 1); assert.equal(h.entries[0].patches[0].before, 0); assert.equal(h.entries[0].patches[0].after, 0.5);
});

t('derived paths', () => {
  const s = new Store(init()); const sch = new Scheduler(s); new History(s);
  s.derive('catalog.picks', st => st.catalog.photos.filter(p => p.flag === 'pick').length);
  let seen = [];
  new Cell(s, st => `${st.catalog.picks} picks`, v => seen.push(v));
  s.tx('Pick', tt => { tt.catalog.photos[0].flag = 'pick'; }); sch.flushSync();
  s.tx('Mode', tt => { tt.develop.light.exposure = 2; }); sch.flushSync();
  assert.deepEqual(seen, ['1 picks', '2 picks']);
  assert.equal(s.readonly().catalog.picks, 2);
  assert.throws(() => { s.readonly().develop.light.exposure = 3; }, /read-only/);
});

t('channels and stepping back', () => {
  const s = new Store(init()); const h = new History(s);
  h.seedChannel('a', 'Import', ['develop']);
  s.tx('Exposure', tt => { tt.develop.light.exposure = 1; }, { channel: 'a', snapPath: ['develop'] });
  s.tx('Contrast', tt => { tt.develop.light.contrast = 10; }, { channel: 'a', snapPath: ['develop'] });
  const c = h.channel('a'); assert.equal(c.list.length, 3);
  h.stepTo('a', 1);
  assert.equal(s.doc.develop.light.contrast, 0); assert.equal(s.doc.develop.light.exposure, 1);
  s.tx('Vibrance', tt => { tt.develop.color.vibrance = 5; }, { channel: 'a', snapPath: ['develop'] });
  assert.deepEqual(c.list.map(x => x.label), ['Import', 'Exposure', 'Vibrance']);
});

console.log(`core: ${n} tests passed`);

// shared objects: one proxy per object, so === holds, and reads subscribe to every path
{
  const D = { light: { exposure: 0 } };
  const s = new Store({ dev: { a: D, b: D }, devDefaults: D }); const sch = new Scheduler(s); new History(s);
  const r = track(s, st => st.dev.a === st.devDefaults);
  assert.equal(r.value, true, 'the same object read by two paths compares equal');
  let seen = [];
  new Cell(s, st => st.dev.a !== st.devDefaults, v => seen.push(v));
  s.tx('Edit a', tt => { tt.dev.a.light.exposure = 1; }); sch.flushSync();
  assert.deepEqual(seen, [false, true]);
  console.log('core: shared-object test passed');
}
{
  const s = new Store({ dev: { spots: [{ x: 1 }] } }); new History(s);
  const ro = s.readonly();
  s.preview(['dev', 'spots'], ro.dev.spots.concat([{ x: 2 }]));
  const v = s.current.dev.spots;
  assert.equal(v[0], s.doc.dev.spots[0], 'proxies are stripped on the way in');
  assert.doesNotThrow(() => structuredClone(s.current), 'state stays cloneable');
  console.log('core: strip test passed');
}
{
  // a cell reading a derived list sees a change to a field the derived value never read (it returned the objects)
  const s = new Store({ photos: [{ id: 'a', date: 1, flag: null }, { id: 'b', date: 2, flag: null }], view: { f: 0 } }); const sch = new Scheduler(s); new History(s);
  s.derive('filtered', st => st.photos.slice().sort((x, y) => x.date - y.date));
  let seen = [];
  new Cell(s, st => st.filtered, v => seen.push(v.map(p => p.flag).join(',')));
  s.tx('Flag', tt => { tt.photos[1].flag = 'pick'; }); sch.flushSync();
  assert.deepEqual(seen, [',', ',pick'], 'a reader of a derived list re-runs when an item it returned changes');
  console.log('core: derived-escape test passed');
}
