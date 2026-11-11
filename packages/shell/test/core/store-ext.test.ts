// The store extensions: prefix tiers, named preview layers, routes with adapters, compound history entries.
import { describe, expect, it } from 'vitest';
import { Store, type Patch, type RouteAdapter, type RouteApi } from '../../src/core/store.ts';
import { History, type HistoryPart } from '../../src/core/history.ts';
import { Cell, Scheduler } from '../../src/core/cells.ts';
import { manualClock } from '../../src/testing/index.ts';

describe('tiers by path prefix', () => {
  it('the longest listed prefix wins', () => {
    const s = new Store({ roll: { frames: [1, 2], contact: { cols: 6 } }, ui: {} }, { view: ['ui', 'roll.contact'] });
    const h = new History(s);
    expect(s.tierOf(['roll', 'frames'])).toBe('document');
    expect(s.tierOf(['roll', 'contact', 'cols'])).toBe('view');
    s.set('roll.contact.cols', 8);
    expect(h.entries.length).toBe(0);
    s.tx('Frames', t => void t.roll.frames.push(3));
    expect(h.entries.length).toBe(1);
    expect(s.snapshot('document')).toEqual({ roll: { frames: [1, 2, 3] } });
    expect(s.snapshot('view')).toEqual({ ui: {}, roll: { contact: { cols: 8 } } });
  });
});

describe('named preview layers', () => {
  it('current = doc ⊕ proposal layers ⊕ gesture; a tx overlapping the gesture cancels it, proposals stay', () => {
    const s = new Store({ dev: { a: 1, b: 2 } });
    const h = new History(s);
    const prop = s.layer('proposal:tx42').set('dev.a', 10);
    expect(s.current.dev.a).toBe(10);
    expect(s.doc.dev.a).toBe(1);
    s.preview('dev.a', 20); // the gesture is on top
    expect(s.current.dev.a).toBe(20);
    s.tx('B', t => void (t.dev.b = 3)); // no overlap: the gesture survives
    expect(s.previewing).toBe(true);
    s.tx('A', t => void (t.dev.a = 5)); // overlap: cancelled
    expect(s.previewing).toBe(false);
    expect(s.current.dev.a).toBe(10); // the proposal still shows
    expect(prop.size).toBe(1);
    prop.commit('Approve');
    expect(s.doc.dev.a).toBe(10);
    expect(h.entries.map(e => e.label)).toEqual(['B', 'A', 'Approve']);
    s.layer('p2').set('dev.b', 99);
    s.layer('p2').drop();
    expect(s.current.dev.b).toBe(3);
  });
});

/** a fake EditLog route: recipes.<frame>.<field>; refuses values over 100; undo units with a cursor */
function editLogAdapter() {
  const logs = new Map<string, { units: { field: string; before: unknown; after: unknown }[]; cursor: number }>();
  let api: RouteApi | null = null;
  const log = (f: string) => logs.get(f) || logs.set(f, { units: [], cursor: 0 }).get(f)!;
  const recipe = (s: Store, f: string) => s.doc.recipes[f];
  const adapter: RouteAdapter & { logs: typeof logs; previews: number; api: () => RouteApi } = {
    id: 'recipes',
    logs,
    previews: 0,
    api: () => api!,
    attach(a) {
      api = a;
    },
    preview() {
      adapter.previews++;
    },
    apply(patches: Patch[]) {
      const parts: HistoryPart[] = [];
      const mirror = [];
      for (const p of patches) {
        const [, frame, field] = p.path as string[];
        if (typeof p.after === 'number' && p.after > 100) throw Object.assign(new Error(`${field} ${p.after} is out of range`), { code: 'E_ARG_RANGE' });
        const L = log(frame!);
        L.units = L.units.slice(0, L.cursor);
        L.units.push({ field: field!, before: p.before, after: p.after });
        L.cursor = L.units.length;
        const unit = L.cursor;
        const store = api!.store;
        parts.push({
          source: 'recipes',
          channel: frame!,
          undo: () => {
            if (L.cursor !== unit) return false; // moved elsewhere: no longer applies
            L.cursor--;
            return [{ path: ['recipes', frame!], value: { ...recipe(store, frame!), [field!]: p.before } }];
          },
          redo: () => {
            if (L.cursor !== unit - 1) return false;
            L.cursor++;
            return [{ path: ['recipes', frame!], value: { ...recipe(store, frame!), [field!]: p.after } }];
          },
        });
        mirror.push({ path: ['recipes', frame!], value: { ...recipe(store, frame!), [field!]: p.after } });
      }
      return { parts, mirror };
    },
  };
  return adapter;
}

describe('routes', () => {
  const setup = () => {
    const s = new Store({ recipes: { f1: { time: 10, grade: 2 }, f2: { time: 12, grade: 2 } }, catalog: { f1: { flag: null as string | null } }, ui: {} }, { routes: [{ prefix: 'recipes', keyDepth: 1 }] });
    const h = new History(s);
    const sch = new Scheduler(s, manualClock());
    const a = editLogAdapter();
    s.route('recipes', a);
    return { s, h, sch, a };
  };
  it('a compound transaction: plain patches and the mirror land in one notify; one undo undoes both', () => {
    const { s, h, sch, a } = setup();
    let runs = 0;
    new Cell(s, (st: any) => `${st.catalog.f1.flag}/${st.recipes.f1.time}`, () => void runs++);
    let notifies = 0;
    s.on(() => void notifies++);
    s.tx('Pick and time', (t: any) => {
      t.catalog.f1.flag = 'pick';
      t.recipes.f1.time = 14;
    });
    expect(notifies).toBe(1);
    sch.flushSync();
    expect(runs).toBe(2);
    expect(s.doc.recipes.f1.time).toBe(14);
    const e = h.entries[0]!;
    expect(e.patches.map(p => p.path.join('.'))).toEqual(['catalog.f1.flag']); // recipes are the adapter's
    expect(e.parts.length).toBe(1);
    expect(e.channel).toBe('f1');
    h.undo();
    expect(s.doc.catalog.f1.flag).toBe(null);
    expect(s.doc.recipes.f1.time).toBe(10);
    expect(a.logs.get('f1')!.cursor).toBe(0);
    h.redo();
    expect(s.doc.recipes.f1.time).toBe(14);
  });
  it('an adapter refusal aborts the whole transaction and drops the preview', () => {
    const { s, h } = setup();
    const refused: string[] = [];
    s.onRefused(e => void refused.push(e.message));
    s.preview('recipes.f1.time', 50);
    s.tx('Bad', (t: any) => {
      t.catalog.f1.flag = 'pick';
      t.recipes.f1.time = 500;
    });
    expect(s.doc.catalog.f1.flag).toBe(null);
    expect(s.doc.recipes.f1.time).toBe(10);
    expect(s.previewing).toBe(false);
    expect(h.entries.length).toBe(0);
    expect(refused[0]).toMatch(/out of range/);
  });
  it('gesture previews under a route are overlaid for readers and told to the adapter; commit goes to apply', () => {
    const { s, h, a } = setup();
    s.preview('recipes.f2.time', 13);
    expect(s.current.recipes.f2.time).toBe(13);
    expect(a.previews).toBe(1);
    s.commit('Time');
    expect(a.logs.get('f2')!.units.length).toBe(1);
    expect(h.entries[0]!.source).toBe('recipes');
  });
  it('a roll balance: one entry holding many units, undone by one undo', () => {
    const { s, h, a } = setup();
    s.tx('Roll balance', (t: any) => {
      t.recipes.f1.grade = 3;
      t.recipes.f2.grade = 3;
    });
    expect(h.entries.length).toBe(1);
    expect(h.entries[0]!.parts.length).toBe(2);
    h.undo();
    expect([s.doc.recipes.f1.grade, s.doc.recipes.f2.grade]).toEqual([2, 2]);
    expect([a.logs.get('f1')!.cursor, a.logs.get('f2')!.cursor]).toEqual([0, 0]);
  });
  it('interleaved undo: a part that no longer applies is skipped; an entry with nothing left is passed over', () => {
    const { s, h, a } = setup();
    const skips: unknown[] = [];
    h.on((k, e) => void (k === 'skip' && skips.push(e)));
    s.tx('Flag', (t: any) => void (t.catalog.f1.flag = 'pick'));
    s.tx('Time', (t: any) => void (t.recipes.f1.time = 20));
    a.logs.get('f1')!.cursor = 0; // the frame's History panel stepped back on its own
    const e = h.undo();
    expect(e!.label).toBe('Flag'); // 'Time' was passed over
    expect(skips.length).toBe(1);
  });
  it('history.push files a change that did not come through a transaction (an approved proposal)', () => {
    const { s, h, a } = setup();
    const api = a.api();
    let undone = false;
    api.publish([{ path: ['recipes', 'f1'], value: { time: 30, grade: 2 } }]);
    api.push({ label: 'Approved agent change', channel: 'f1', parts: [{ source: 'recipes', undo: () => ((undone = true), [{ path: ['recipes', 'f1'], value: { time: 10, grade: 2 } }]), redo: () => true }] });
    expect(s.doc.recipes.f1.time).toBe(30);
    expect(h.entries.at(-1)!.label).toBe('Approved agent change');
    h.undo();
    expect(undone).toBe(true);
    expect(s.doc.recipes.f1.time).toBe(10);
  });
  it('routed prefixes are never in the document snapshot (the shell does not persist them)', () => {
    const { s } = setup();
    expect(Object.keys(s.snapshot('document'))).toEqual(['catalog']);
  });
});
