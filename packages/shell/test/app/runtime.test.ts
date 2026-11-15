// The headless runtime: persistence, document rules at start, inspect, effect loops, every file imports in Node.
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ValueError } from '@chromobench/values';
import { createCk } from '../../src/index.ts';
import { manualClock, memoryPersistence } from '../../src/testing/index.ts';
import { miniStudio, type MiniState } from '../fixtures/mini-studio.ts';

describe('persistence', () => {
  it('autosave: the document tier, the workspace; a collapsed panel survives a reload', async () => {
    const store = memoryPersistence();
    const clock = manualClock();
    const app = miniStudio(createCk<MiniState>()).build();
    const rt = await app.boot({ clock, persistence: store });
    rt.press('P');
    rt.workspace.setOpen('filter', false);
    rt.store.set('ui.selection', { ids: ['p2'], primary: 'p2', anchor: 'p2' });
    rt.store.set('ui.tool', 'probe'); // ui is not kept unless listed in keepUi
    clock.advance(700);
    rt.scheduler.runIdle();
    await rt.save();
    expect(store.saves).toBe(2);
    const rt2 = await app.boot({ clock: manualClock(), persistence: store });
    expect(rt2.restored).toBe(true);
    expect(rt2.state.catalog.photos[0]!.flag).toBe('pick');
    expect(rt2.workspace.isOpen('filter')).toBe(false);
    expect(rt2.state.ui.selection.primary).toBe('p2');
    expect(rt2.state.ui.tool).toBe(null);
  });
  it('a version bump starts fresh', async () => {
    const store = memoryPersistence();
    const ck = createCk();
    const v1 = ck.shell('A').state({ n: 0 }, { version: 1 }).module(ck.module('main').center(ck.text('x'))).build();
    const rt = await v1.boot({ clock: manualClock(), persistence: store });
    rt.ctx().tx('N', t => void (t.n = 5));
    await rt.save();
    const v2 = ck.shell('A').state({ n: 0 }, { version: 2 }).module(ck.module('main').center(ck.text('x'))).build();
    expect((await v2.boot({ clock: manualClock(), persistence: store })).state.n).toBe(0);
    expect((await v1.boot({ clock: manualClock(), persistence: store })).state.n).toBe(5);
  });
});

describe('runtime', () => {
  it("a document's rules supplied at start: a refusal is a toast and a runtime diagnostic", () => {
    const ck = createCk();
    const kit = ck.kit('cb').state('recipes', { init: { f1: { t: 1 } } }).mount('recipes', { keyDepth: 1, kind: 'frame' });
    const app = ck
      .shell('x')
      .use(kit)
      .module(ck.module('main').center(ck.text('x')))
      .build();
    const rt = app.start({
      clock: manualClock(),
      rules: {
        frame: {
          validate: (c: any) => {
            if (c.after.t > 9) throw new ValueError({ code: 'E_ARG_RANGE', message: 't must be at most 9' });
          },
        },
      },
    });
    expect(rt.store.log.ids()).toEqual(['main', 'f1']);
    rt.ctx().tx('T', (t: any) => void (t.recipes.f1.t = 5));
    expect(rt.state.recipes.f1.t).toBe(5);
    rt.ctx().tx('T', (t: any) => void (t.recipes.f1.t = 50));
    expect(rt.state.recipes.f1.t).toBe(5);
    expect((rt.chrome as any).lastToast).toBe('t must be at most 9');
    const d = rt.diagnostics.list.find(x => x.code === 'CK-T430')!;
    expect(d.facts).toContain('code E_ARG_RANGE');
    rt.undo();
    expect(rt.state.recipes.f1.t).toBe(1);
    expect(rt.store.log.canRedo).toBe(true);
  });
  it('a handler writing outside a transaction is CK-T410', () => {
    const ck = createCk();
    const app = ck
      .shell('x')
      .state({ n: 0 })
      .use(ck.kit('bad').commands({ bad: { run: (ctx: any) => void (ctx.state.n = 1) } }))
      .module(ck.module('main').center(ck.text('x')))
      .build();
    const rt = app.start({ clock: manualClock() });
    rt.run('bad');
    expect(rt.diagnostics.codes()).toContain('CK-T410');
    expect(rt.state.n).toBe(0);
  });
  it('an effect loop is CK-P510 with the cells', () => {
    const ck = createCk();
    const rt = ck.shell('x').state({ n: 0, view: { m: 0 } }).module(ck.module('main').center(ck.text('x'))).build().start({ clock: manualClock() });
    rt.cell(s => s.n, v => rt.store.set('view.m', v));
    rt.cell(s => s.view.m, v => rt.store.tx('n', (t: any) => void (t.n = (v as number) + 1)));
    rt.store.tx('n', (t: any) => void (t.n = 1));
    rt.flush();
    expect(rt.diagnostics.codes()).toContain('CK-P510');
  });
  it('inspect() reports frames, cells, undo depth', () => {
    const rt = miniStudio(createCk<MiniState>()).build().start({ clock: manualClock() });
    rt.press('P');
    rt.flush();
    const i = rt.inspect();
    expect(i.undo).toBe(1);
    expect(i.commands).toBeGreaterThan(20);
    expect(i.previewing).toBe(false);
  });
  it('two runtimes of one app do not share state', () => {
    const app = miniStudio(createCk<MiniState>()).build();
    const a = app.start({ clock: manualClock() });
    const b = app.start({ clock: manualClock() });
    a.press('P');
    expect(b.state.catalog.photos[0]!.flag).toBe(null);
  });
});

describe('headless-safe', () => {
  it('every file under src/ imports in Node (nothing touches document, window or navigator at load)', async () => {
    const root = fileURLToPath(new URL('../../src/', import.meta.url));
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(20);
    expect((globalThis as any).document).toBeUndefined();
    for (const f of files) await expect(import(f), relative(root, f)).resolves.toBeDefined();
  });
});
