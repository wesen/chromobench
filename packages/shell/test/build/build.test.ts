// Headless build: the grammar records, .build() checks, app.start() runs commands and undo without a DOM.
import { describe, expect, it } from 'vitest';
import { createCk, type Ck, type BuiltApp } from '../../src/index.ts';
import { manualClock } from '../../src/testing/index.ts';
import { miniStudio, type MiniState } from '../fixtures/mini-studio.ts';

describe('the counter (guide §5.2)', () => {
  it('builds, runs and undoes headless', () => {
    const ck = createCk();
    const app = ck
      .shell('Counter')
      .state({ count: 0, ui: {} })
      .commands(c => c.add('count.up', { label: 'Count Up', menu: 'Edit', run: ctx => ctx.tx('Count', t => void t.count++) }))
      .keys('global', { 'Mod+ArrowUp': 'count.up' })
      .center(ck.column({}, ck.text(s => `Count: ${s.count}`), ck.ui.command('count.up')))
      .build();
    expect(app.errors).toEqual([]);
    const rt = app.start({ clock: manualClock() });
    rt.run('count.up');
    rt.flush();
    expect(rt.state.count).toBe(1);
    expect(rt.press('Mod+ArrowUp')).toBe(true);
    expect(rt.state.count).toBe(2);
    rt.history.undo();
    expect(rt.state.count).toBe(1);
    expect(rt.press('Mod+Z')).toBe(true);
    expect(rt.state.count).toBe(0);
    expect((rt.chrome as any).lastToast).toBe('Undo Count');
  });
});

describe('the binding typo (guide §2.1)', () => {
  it('CK-B110 at the program line, with the fix', () => {
    const ck = createCk();
    const app = ck
      .shell('Develop demo')
      .state({ dev: { light: { exposure: 0, contrast: 0 } }, ui: {} })
      .right(ck.panel('basic', { title: 'Basic' }, ck.ui.slider(-5, 5, { label: 'Exposure', bind: s => s.dev.light.exposur, step: 0.05, reset: 0 })))
      .center(ck.text('x'))
      .build();
    const d = app.diagnostics.list.find(x => x.code === 'CK-B110')!;
    expect(d).toBeDefined();
    expect(d.facts).toEqual(['s.dev.light.exposur does not exist.', 'dev.light has: exposure, contrast']);
    expect(d.fix).toBe('Did you mean s.dev.light.exposure?');
    expect(d.at?.file).toMatch(/build\.test\.ts$/);
    expect(d.at?.line).toBe(38); // the ck.ui.slider(...) line above
  });
});

describe('the mini studio', () => {
  const make = () => {
    const ck = createCk<MiniState>();
    return { ck, app: miniStudio(ck).build() };
  };
  it('builds in Node with zero errors', () => {
    const { app } = make();
    expect(app.errors.map(d => `${d.code} ${d.message} ${d.facts?.join(' ')}`)).toEqual([]);
    expect(app.warnings.map(d => d.code)).toEqual([]);
    expect(app.codes('info')).toContain('CK-I001');
  });
  it('runs commands, keys, preview/commit and undo headless', () => {
    const { app } = make();
    const rt = app.start({ clock: manualClock() });
    expect(rt.module).toBe('library');
    expect(rt.press('P')).toBe(true);
    expect(rt.state.catalog.photos[0]!.flag).toBe('pick');
    rt.press('3');
    expect(rt.state.catalog.photos[0]!.rating).toBe(3);
    rt.press('D'); // module key
    expect(rt.module).toBe('develop');
    // a slider drag: many previews, one commit, one undo step with the photo as channel
    const ctx = rt.ctx();
    for (const v of [0.1, 0.2, 0.35]) ctx.preview((s: MiniState) => s.dev['p0']!.light.exposure, v);
    expect(rt.store.doc.dev.p0.light.exposure).toBe(0);
    expect(rt.state.dev['p0']!.light.exposure).toBe(0.35);
    ctx.commit('Exposure');
    expect(rt.history.entries.length).toBe(3);
    expect(rt.history.entries[2]!.channel).toBe('p0');
    expect(rt.history.channel('p0').list.map(x => x.label)).toEqual(['Import', 'Exposure']);
    rt.press('Mod+Z');
    expect(rt.state.dev['p0']!.light.exposure).toBe(0);
  });
  it('a disabled command reports why (recording chrome)', () => {
    const { app } = make();
    const rt = app.start({ clock: manualClock() });
    rt.go('develop');
    expect(rt.run('dev.reset')).toBe(false);
    const chrome = rt.chrome as any;
    expect(chrome.toasts.at(-1)).toEqual({ text: 'Nothing to reset', kind: 'why', title: 'Reset Develop Settings' });
  });
  it('undo says where it happened when that is not on screen', () => {
    const { app } = make();
    const rt = app.start({ clock: manualClock() });
    rt.go('develop');
    rt.ctx().tx('Exposure', t => void (t.dev['p0']!.light.exposure = 1));
    rt.store.set('ui.selection', { ids: ['p2'], primary: 'p2', anchor: 'p2' });
    rt.undo();
    expect((rt.chrome as any).lastToast).toBe('Undo Exposure (on Photo 1)');
  });
  it('module commands are hidden elsewhere; Tab hides the sides', () => {
    const { app } = make();
    const rt = app.start({ clock: manualClock() });
    expect(rt.commands.hidden('dev.reset', rt.state)).toBe(true);
    rt.go('develop');
    expect(rt.commands.hidden('dev.reset', rt.state)).toBe(false);
    rt.press('Tab');
    expect(rt.workspace.sideHidden(rt.state, 'left')).toBe(true);
    rt.press('F7');
    expect(rt.workspace.sideHidden(rt.state, 'left')).toBe(false);
    expect(rt.workspace.sideHidden(rt.state, 'right')).toBe(true);
  });
  it('tools: the key selects the tool only in modules whose viewport lists it', () => {
    const { app } = make();
    const rt = app.start({ clock: manualClock() });
    expect(rt.press('I')).toBe(false);
    rt.go('develop');
    expect(rt.press('I')).toBe(true);
    expect(rt.state.ui.tool).toBe('probe');
    rt.press('Escape');
    expect(rt.state.ui.tool).toBe(null);
  });
  it('a preview step re-checks only the cells that read what changed', () => {
    const { app } = make();
    const rt = app.start({ clock: manualClock() });
    const ids = rt.state.catalog.photos.map(p => p.id);
    // one cell per slider-like reader, as the DOM would make
    for (const id of ids) for (const k of ['exposure', 'contrast', 'highlights', 'shadows'] as const) rt.cell(s => s.dev[id].light[k], null);
    rt.flush();
    const before = rt.inspect().cellsRerun;
    rt.ctx().preview((s: MiniState) => s.dev['p3']!.light.exposure, 0.5);
    rt.flush();
    expect(rt.inspect().cellsRerun - before).toBe(1);
  });
});

describe('build checks', () => {
  const ck = createCk();
  const build = (f: (ck: Ck) => { build(): BuiltApp }): BuiltApp => f(ck).build();
  it('B130 unknown option with a suggestion, B140 lambda in a β slot', () => {
    const app = build(ck => ck.shell('x').state({ v: 0 }).center(ck.ui.slider(0, 1, { bind: (s: any) => s.v, stpe: 0.1 } as any)).right(ck.ui.slider((() => 0) as any, 1, { bind: s => s.v })));
    const b130 = app.diagnostics.list.find(d => d.code === 'CK-B130')!;
    expect(b130.fix).toBe("Did you mean 'step'?");
    expect(app.codes('error')).toContain('CK-B140');
  });
  it('B111 for a selection-dependent path with no selection; B112 a binding that throws', () => {
    const app = build(ck =>
      ck
        .shell('x')
        .state({ dev: {} as Record<string, { e: number }>, ui: { sel: null as string | null } })
        .center(ck.column({}, ck.ui.slider(0, 1, { bind: s => s.dev[s.ui.sel!]!.e }), ck.ui.slider(0, 1, { bind: () => { throw new Error('boom'); } }))),
    );
    expect(app.codes('warning')).toContain('CK-B111');
    expect(app.codes('error')).toContain('CK-B112');
  });
  it('D301 placed twice, D302 unknown panel, D303 no centre, M201 match, V302 unknown tool, B150 menu', () => {
    const app = build(ck =>
      ck
        .shell('x')
        .state({ mode: 'a' })
        .menus(m => m.menu('Edit', ['edit.undoo']))
        .module('m', m =>
          m
            .left(ck.dock.column({}, ck.panel('p1', { title: 'P' }), ck.panel('p2x')))
            .right(ck.dock.column({}, ck.panel('p1'), ck.match(s => s.mode, { a: ck.text('a') }, { of: ['a', 'b'] }), ck.viewport(() => null, { tools: ['crpo'] }))),
        ),
    );
    const codes = app.codes();
    for (const c of ['CK-D301', 'CK-D302', 'CK-D303', 'CK-M201', 'CK-V302', 'CK-B150']) expect(codes).toContain(c);
    expect(app.diagnostics.list.find(d => d.code === 'CK-B150')!.fix).toBe("Did you mean 'edit.undo'?");
  });
  it('B160 unknown form, B170 unknown icon, B180 unlabelled icon button', () => {
    const app = build(ck => ck.shell('x').center(ck.column({}, ck.node('sliderr', {}), ck.ui.iconButton('flg'), ck.icon('flag'))));
    expect(app.codes()).toEqual(expect.arrayContaining(['CK-B160', 'CK-B170', 'CK-B180']));
    expect(app.diagnostics.list.find(d => d.code === 'CK-B170')!.fix).toBe("Did you mean 'flag'?");
  });
  it('builds of several variants in one process do not leak', () => {
    const a = createCk();
    const b = createCk();
    a.form('only.a', { slots: {} });
    const appB = b.shell('b').center(b.node('only.a', {})).build();
    expect(appB.codes()).toContain('CK-B160');
    const appA = a.shell('a').center(a.node('only.a', {})).build();
    expect(appA.codes()).not.toContain('CK-B160');
  });
});
