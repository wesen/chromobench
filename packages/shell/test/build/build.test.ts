// Headless build: the grammar records, .build() checks, app.start() runs commands and undo without a DOM.
import { describe, expect, it } from 'vitest';
import { createCk, type Ck, type BuiltApp } from '../../src/index.ts';
import { manualClock } from '../../src/testing/index.ts';
import { miniStudio, type MiniState } from '../fixtures/mini-studio.ts';

describe('the counter (guide §5.2)', () => {
  it('builds, runs and undoes headless', () => {
    const ck = createCk();
    const counter = ck.kit('counter').commands({ 'count.up': { label: 'Count Up', run: ctx => ctx.tx('Count', (t: any) => void t.count++) } });
    const app = ck
      .shell('Counter')
      .state({ count: 0, ui: {} })
      .use(counter)
      .menus(ck.menu('Edit', ['count.up']))
      .keys({ 'Mod+ArrowUp': 'count.up' })
      .module(ck.module('main').center(ck.column({}, ck.text(s => `Count: ${s.count}`), ck.ui.button({ run: 'count.up' }))))
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
      .module(ck.module('main').right(ck.panel.define('basic', { title: 'Basic' }, ck.ui.slider({ min: -5, max: 5, label: 'Exposure', bind: s => s.dev.light.exposur, step: 0.05, reset: 0 }))).center(ck.text('x')))
      .build();
    const d = app.diagnostics.list.find(x => x.code === 'CK-B110')!;
    expect(d).toBeDefined();
    expect(d.facts).toEqual(['s.dev.light.exposur does not exist.', 'dev.light has: exposure, contrast']);
    expect(d.fix).toBe('Did you mean s.dev.light.exposure?');
    expect(d.at?.file).toMatch(/build\.test\.ts$/);
    expect(d.at?.line).toBe(40); // the ck.ui.slider({ min: ... }) line above
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
  const main = (ck: Ck, center: unknown, right?: unknown) => (right ? ck.module('main').center(center as any).right(right as any) : ck.module('main').center(center as any));
  it('B130 unknown option with a suggestion, B140 lambda in a β slot', () => {
    const app = build(ck => ck.shell('x').state({ v: 0 }).module(main(ck, ck.ui.slider({ min: 0, max: 1, bind: (s: any) => s.v, stpe: 0.1 } as any), ck.ui.slider({ min: (() => 0) as any, max: 1, bind: (s: any) => s.v }))));
    const b130 = app.diagnostics.list.find(d => d.code === 'CK-B130')!;
    expect(b130.fix).toBe("Did you mean 'step'?");
    expect(app.codes('error')).toContain('CK-B140');
  });
  it('B111 for a selection-dependent path with no selection; B112 a binding that throws', () => {
    const app = build(ck =>
      ck
        .shell('x')
        .state({ dev: {} as Record<string, { e: number }>, ui: { sel: null as string | null } })
        .module(main(ck, ck.column({}, ck.ui.slider({ min: 0, max: 1, bind: (s: any) => s.dev[s.ui.sel!]!.e }), ck.ui.slider({ min: 0, max: 1, bind: () => { throw new Error('boom'); } })))),
    );
    expect(app.codes('warning')).toContain('CK-B111');
    expect(app.codes('error')).toContain('CK-B112');
  });
  it('D301 placed twice, D302 unknown panel, D303 no centre, M201 match, V302 unknown tool, B150 menu', () => {
    const app = build(ck =>
      ck
        .shell('x')
        .state({ mode: 'a' })
        .menus(ck.menu('Edit', ['edit.undoo']))
        .module(
          ck
            .module('m')
            .left(ck.dock.column({}, ck.panel.define('p1', { title: 'P' }), ck.panel('p2x')))
            .right(ck.dock.column({}, ck.panel('p1'), ck.match((s: any) => s.mode, { a: ck.text('a') }, { of: ['a', 'b'] }), ck.viewport(() => null, { tools: ['crpo'] }))),
        ),
    );
    const codes = app.codes();
    for (const c of ['CK-D301', 'CK-D302', 'CK-D303', 'CK-M201', 'CK-V302', 'CK-B150']) expect(codes).toContain(c);
    expect(app.diagnostics.list.find(d => d.code === 'CK-B150')!.fix).toBe("Did you mean 'edit.undo'?");
  });
  it('B160 unknown form, B170 unknown icon, B180 unlabelled icon button', () => {
    const app = build(ck => ck.shell('x').module(main(ck, ck.column({}, ck.node('sliderr', {}), ck.ui.button({ icon: 'flg', quiet: true }), ck.icon('flag')))));
    expect(app.codes()).toEqual(expect.arrayContaining(['CK-B160', 'CK-B170', 'CK-B180']));
    expect(app.diagnostics.list.find(d => d.code === 'CK-B170')!.fix).toBe("Did you mean 'flag'?");
  });
  it('builds of several layouts in one process do not leak', () => {
    const a = createCk();
    const b = createCk();
    const onlyA = a.kit('a').forms({ name: 'only.a', slots: {} });
    const appB = b.shell('b').module(b.module('main').center(b.node('only.a', {}))).build();
    expect(appB.codes()).toContain('CK-B160');
    const appA = a.shell('a').use(onlyA).module(a.module('main').center(a.node('only.a', {}))).build();
    expect(appA.codes()).not.toContain('CK-B160');
  });
  it('uniform signatures: containers (props?, ...kids), leaves (value, props?), controls one props object; when and pick are interaction forms', () => {
    const sec = ck.section({ title: 'Light', reset: true }, ck.text('a'));
    expect([sec.props['title'], sec.kids.length]).toEqual(['Light', 1]);
    expect(ck.hud(s => String(s), { id: 'h' }).props).toEqual({ value: expect.any(Function), id: 'h' });
    expect(ck.ui.slider({ min: 0, max: 5, step: 1 }).props).toEqual({ min: 0, max: 5, step: 1 });
    expect(ck.ui.button({ run: 'edit.undo' }).props).toEqual({ run: 'edit.undo' });
    const off = ck.ui.button({ run: 'edit.undo' }).enabled(() => false, 'Nothing to undo');
    expect([typeof off.props['enabled'], off.props['why']]).toEqual(['function', 'Nothing to undo']);
    expect(ck.when((s: any) => !!s.x, ck.text('a'), ck.text('b')).$).toBe('when');
    expect(() => ck.when(true as any, ck.text('a'))).toThrow(/CK-L120/);
    // a build-time choice is plain JavaScript, or a modifier chosen with ck.mod.when
    const compact = ck.mod.props({ density: 'compact' });
    expect(ck.text('x').with(ck.mod.when(true, compact)).props['density']).toBe('compact');
    expect(ck.text('x').with(ck.mod.when(false, compact)).props['density']).toBeUndefined();
    const pick = ck.pick((s: any) => s.mode, { a: 1, b: 2 });
    expect(pick({ mode: 'b' } as any)).toBe(2);
    expect(() => ck.pick('a' as any, { a: 1 })).toThrow(/CK-L121/);
  });
  it('host capabilities: a command that requires one is hidden and refused without it, and runs with it', () => {
    const calls: string[] = [];
    const kit = ck.kit('host').commands({ 'file.open': { label: 'Open…', requires: 'host.openFiles', run: (ctx: any) => ctx.host.openFiles() } });
    const app = ck.shell('x').use(kit).menus(ck.menu('File', ['file.open'])).module(main(ck, ck.text('x'))).build();
    const bare = app.start({ clock: manualClock() });
    expect(bare.commands.hidden('file.open', bare.state)).toBe(true);
    expect(bare.run('file.open')).toBe(false);
    expect((bare.chrome as any).toasts.at(-1)).toEqual({ text: 'Not available in this window', kind: 'why', title: 'Open…' });
    const rt = app.start({ clock: manualClock(), host: { openFiles: () => calls.push('open') } });
    expect(rt.commands.hidden('file.open', rt.state)).toBe(false);
    rt.run('file.open');
    expect(calls).toEqual(['open']);
    rt.setHost(null);
    expect(rt.commands.hidden('file.open', rt.state)).toBe(true);
  });
  it('builders are immutable values: every chain method returns a new one; unknown methods throw CK-X120', () => {
    const ck = createCk();
    const s0 = ck.shell('x');
    const s1 = s0.theme('chromogen');
    expect(s1).not.toBe(s0);
    expect(s0.data.theme).toBe(null);
    expect(s1.data.theme).toBe('chromogen');
    expect(Object.isFrozen(s1) && Object.isFrozen(s1.data) && Object.isFrozen(s1.data.modules)).toBe(true);
    const m0 = ck.module('lib', { label: 'Library', key: 'G' });
    const m1 = m0.center(ck.text('x'));
    expect(m0.data.regions.center).toBeUndefined();
    expect(m1.data.regions.center!.$).toBe('text');
    expect(m1.trail.map(t => t.name)).toEqual(['center']);
    expect(() => (s1 as any).moduel(m1)).toThrow(/CK-X120[\s\S]*Did you mean \.module\(\)\?/);
    const k0 = ck.kit('k');
    const k1 = k0.commands({ 'k.x': { label: 'X', run: () => 1 } });
    expect(k0.def.commands).toEqual([]);
    expect(k1.def.commands.map(c => c.id)).toEqual(['k.x']);
    // a modifier is a value: build once, apply to many
    const dark = ck.shell('y').with((s: any) => s.theme('chromogen'));
    expect(dark.data.theme).toBe('chromogen');
  });
});
