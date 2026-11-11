// CraftKit's test/core.test.mjs, case for case (store, track, cells, history).
import { describe, expect, it } from 'vitest';
import { Store } from '../../src/core/store.ts';
import { History } from '../../src/core/history.ts';
import { Cell, Scheduler } from '../../src/core/cells.ts';
import { track, bindingPath, missingKey } from '../../src/core/track.ts';
import { manualClock } from '../../src/testing/index.ts';

const init = () => ({
  develop: { light: { exposure: 0, contrast: 0 }, color: { vibrance: 0 } },
  catalog: { photos: [{ id: 'a', flag: null as string | null, rating: 0 }, { id: 'b', flag: 'pick', rating: 3 }, { id: 'c', flag: null, rating: 5 }] },
  ui: { mode: 'grid' },
});
const sched = (s: Store) => new Scheduler(s, manualClock());

describe('core (CraftKit core.test.mjs)', () => {
  it('read sets drop navigation', () => {
    const s = new Store(init());
    const r = track(s, st => st.develop.light.exposure);
    expect(r.reads.map(x => x.path.join('.'))).toEqual(['develop.light.exposure']);
    const r2 = track(s, st => st.catalog.photos.filter((p: any) => p.rating >= 3));
    expect(r2.value.length).toBe(2);
    expect(r2.value[0]).toBe(s.doc.catalog.photos[1]); // result is unwrapped to the real objects
    expect(r2.reads.some(x => x.path.join('.') === 'catalog.photos.1')).toBe(true); // escaped elements are whole reads
  });

  it('binding paths and missing keys', () => {
    const s = new Store(init());
    const key = 'contrast';
    expect(bindingPath(s, st => st.develop.light[key]).path).toEqual(['develop', 'light', 'contrast']);
    const m = missingKey(s.doc, ['develop', 'light', 'exposur'])!;
    expect(m.key).toBe('exposur');
    expect(m.has).toEqual(['exposure', 'contrast']);
  });

  it('cells re-run only when their reads change', () => {
    const s = new Store(init());
    const sch = sched(s);
    new History(s);
    let runs = 0;
    let seen: unknown = null;
    new Cell(s, st => st.develop.light.exposure, v => {
      runs++;
      seen = v;
    });
    expect(runs).toBe(1);
    s.tx('Contrast', tt => {
      tt.develop.light.contrast = 20;
    });
    sch.flushSync();
    expect(runs).toBe(1); // a sibling write does not re-run
    s.tx('Exposure', tt => {
      tt.develop.light.exposure = 0.5;
    });
    sch.flushSync();
    expect(runs).toBe(2);
    expect(seen).toBe(0.5);
  });

  it('preview then commit is one undo step', () => {
    const s = new Store(init());
    const sch = sched(s);
    const h = new History(s);
    const seen: unknown[] = [];
    new Cell(s, st => st.develop.light.exposure, v => seen.push(v));
    for (const v of [0.1, 0.2, 0.3]) {
      s.preview(['develop', 'light', 'exposure'], v);
      sch.flushSync();
    }
    expect(s.doc.develop.light.exposure).toBe(0); // the document is untouched while previewing
    s.commit('Exposure');
    sch.flushSync();
    expect(h.entries.length).toBe(1);
    expect(s.doc.develop.light.exposure).toBe(0.3);
    expect(seen).toEqual([0, 0.1, 0.2, 0.3]);
    h.undo();
    sch.flushSync();
    expect(s.doc.develop.light.exposure).toBe(0);
    expect(seen[seen.length - 1]).toBe(0);
    h.redo();
    expect(s.doc.develop.light.exposure).toBe(0.3);
  });

  it('view tier is not undoable', () => {
    const s = new Store(init());
    const h = new History(s);
    s.set('ui.mode', 'loupe');
    expect(s.doc.ui.mode).toBe('loupe');
    expect(h.entries.length).toBe(0);
    s.setMany({ ui: { mode: 'compare' }, develop: { light: { exposure: 1 } } }, { label: 'Both' });
    expect(s.doc.ui.mode).toBe('compare');
    expect(h.entries.length).toBe(1);
    expect(s.doc.develop.light.exposure).toBe(1);
  });

  it('drafts: arrays and find', () => {
    const s = new Store(init());
    const h = new History(s);
    const before = s.doc.catalog.photos;
    s.tx('Pick', tt => {
      tt.catalog.photos.find((p: any) => p.id === 'a').flag = 'pick';
    });
    expect(s.doc.catalog.photos[0].flag).toBe('pick');
    expect(before[0].flag).toBe(null); // the old state is untouched
    expect(s.doc.catalog.photos[1]).toBe(before[1]); // untouched siblings keep identity
    s.tx('Add', tt => {
      tt.catalog.photos.push({ id: 'd', flag: null, rating: 0 });
    });
    expect(s.doc.catalog.photos.length).toBe(4);
    h.undo();
    expect(s.doc.catalog.photos.length).toBe(3);
    h.undo();
    expect(s.doc.catalog.photos[0].flag).toBe(null);
  });

  it('coalescing nudges', () => {
    const s = new Store(init());
    const h = new History(s);
    for (let i = 1; i <= 5; i++)
      s.tx(
        'Exposure',
        tt => {
          tt.develop.light.exposure = i / 10;
        },
        { coalesce: 'nudge:exposure' },
      );
    expect(h.entries.length).toBe(1);
    expect(h.entries[0]!.patches[0]!.before).toBe(0);
    expect(h.entries[0]!.patches[0]!.after).toBe(0.5);
  });

  it('coalescing stops after 1.5 s (on the injected clock)', () => {
    const s = new Store(init());
    const clock = manualClock();
    const h = new History(s, { clock });
    s.tx('Exposure', tt => void (tt.develop.light.exposure = 0.1), { coalesce: 'n' });
    clock.advance(1000);
    s.tx('Exposure', tt => void (tt.develop.light.exposure = 0.2), { coalesce: 'n' });
    clock.advance(1600);
    s.tx('Exposure', tt => void (tt.develop.light.exposure = 0.3), { coalesce: 'n' });
    expect(h.entries.length).toBe(2);
  });

  it('derived paths', () => {
    const s = new Store(init());
    const sch = sched(s);
    new History(s);
    s.derive('catalog.picks', (st: any) => st.catalog.photos.filter((p: any) => p.flag === 'pick').length);
    const seen: unknown[] = [];
    new Cell(s, st => `${st.catalog.picks} picks`, v => seen.push(v));
    s.tx('Pick', tt => {
      tt.catalog.photos[0].flag = 'pick';
    });
    sch.flushSync();
    s.tx('Mode', tt => {
      tt.develop.light.exposure = 2;
    });
    sch.flushSync();
    expect(seen).toEqual(['1 picks', '2 picks']);
    expect(s.readonly().catalog.picks).toBe(2);
    expect(() => {
      s.readonly().develop.light.exposure = 3;
    }).toThrow(/read-only/);
  });

  it('channels and stepping back', () => {
    const s = new Store(init());
    const h = new History(s);
    h.seedChannel('a', 'Import', ['develop']);
    s.tx('Exposure', tt => void (tt.develop.light.exposure = 1), { channel: 'a', snapPath: ['develop'] });
    s.tx('Contrast', tt => void (tt.develop.light.contrast = 10), { channel: 'a', snapPath: ['develop'] });
    const c = h.channel('a');
    expect(c.list.length).toBe(3);
    h.stepTo('a', 1);
    expect(s.doc.develop.light.contrast).toBe(0);
    expect(s.doc.develop.light.exposure).toBe(1);
    s.tx('Vibrance', tt => void (tt.develop.color.vibrance = 5), { channel: 'a', snapPath: ['develop'] });
    expect(c.list.map(x => x.label)).toEqual(['Import', 'Exposure', 'Vibrance']);
  });

  it('shared objects: one proxy per object, so === holds, and reads subscribe to every path', () => {
    const D = { light: { exposure: 0 } };
    const s = new Store({ dev: { a: D, b: D }, devDefaults: D });
    const sch = sched(s);
    new History(s);
    const r = track(s, (st: any) => st.dev.a === st.devDefaults);
    expect(r.value).toBe(true); // the same object read by two paths compares equal
    const seen: unknown[] = [];
    new Cell(s, (st: any) => st.dev.a !== st.devDefaults, v => seen.push(v));
    s.tx('Edit a', (tt: any) => void (tt.dev.a.light.exposure = 1));
    sch.flushSync();
    expect(seen).toEqual([false, true]);
  });

  it('strip: proxies are stripped on the way in, state stays cloneable', () => {
    const s = new Store({ dev: { spots: [{ x: 1 }] } });
    new History(s);
    const ro = s.readonly();
    s.preview(['dev', 'spots'], ro.dev.spots.concat([{ x: 2 }]));
    const v = s.current.dev.spots;
    expect(v[0]).toBe(s.doc.dev.spots[0]);
    expect(() => structuredClone(s.current)).not.toThrow();
  });

  it('a cell reading a derived list sees a change to a field the derived value never read', () => {
    const s = new Store({ photos: [{ id: 'a', date: 1, flag: null as string | null }, { id: 'b', date: 2, flag: null }], view: { f: 0 } });
    const sch = sched(s);
    new History(s);
    s.derive('filtered', (st: any) => st.photos.slice().sort((x: any, y: any) => x.date - y.date));
    const seen: string[] = [];
    new Cell(s, (st: any) => st.filtered, (v: any) => seen.push(v.map((p: any) => p.flag).join(',')));
    s.tx('Flag', (tt: any) => void (tt.photos[1].flag = 'pick'));
    sch.flushSync();
    expect(seen).toEqual([',', ',pick']);
  });
});

describe('cells: exact run counts (so the tests can fail)', () => {
  it('a write to one of 200 sliders re-runs exactly one cell', () => {
    const vals: Record<string, number> = {};
    for (let i = 0; i < 200; i++) vals['s' + i] = 0;
    const s = new Store({ dev: vals });
    const sch = sched(s);
    new History(s);
    const runs = new Array(200).fill(0);
    for (let i = 0; i < 200; i++) new Cell(s, (st: any) => st.dev['s' + i], () => void runs[i]++);
    const before = sch.stats.cellsRerun;
    s.preview(['dev', 's42'], 1);
    sch.flushSync();
    expect(sch.stats.cellsRerun - before).toBe(1);
    expect(runs[42]).toBe(2);
    expect(runs.reduce((a, b) => a + b, 0)).toBe(201);
  });
  it('an effect that writes what it reads is reported as a loop', () => {
    const s = new Store({ n: 0, view: {} });
    const sch = sched(s);
    let loops = 0;
    sch.onLoop = () => void loops++;
    new Cell(s, (st: any) => st.n, v => s.set('view.n', v));
    new Cell(s, (st: any) => st.view.n, v => s.writeDoc([{ path: ['n'], value: (v as number) + 1 }]));
    s.writeDoc([{ path: ['n'], value: 1 }]);
    sch.flushSync();
    expect(loops).toBe(1);
  });
});
