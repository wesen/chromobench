// @vitest-environment happy-dom
// CHB-025: themes as data, switchable at runtime. CraftKit is the default; View ▸ Theme and View ▸ Interface Gray
// are checked commands that write prefs (saved with the view tier); the tokens land on the theme root.
import { afterEach, describe, expect, it } from 'vitest';
import { chromogen, craftkit, createCk, lightroom, resolveTheme, themeTokens, THEME_GROUP, GRAY_GROUP } from '../../src/index.ts';
import { mountRuntime, type Mounted } from '../../src/dom/index.ts';
import { fakeBridge, fakePresenter, manualClock } from '../../src/testing/index.ts';
import { miniStudio, type MiniState } from '../fixtures/mini-studio.ts';

const mounted: Mounted[] = [];
afterEach(() => {
  for (const m of mounted.splice(0)) m.dispose();
  document.body.replaceChildren();
});

function setup(o: { theme?: string; themeRoot?: HTMLElement } = {}) {
  const ck = createCk<MiniState>();
  // a shell is a value: .theme() returns a new one
  const b = o.theme ? miniStudio(ck).theme(o.theme) : miniStudio(ck);
  const rt = b.build().start({ clock: manualClock(), bridges: [fakeBridge()], presenter: () => fakePresenter() });
  const root = document.createElement('div');
  document.body.append(root);
  const m = mountRuntime(rt, root, o.themeRoot ? { themeRoot: o.themeRoot } : {});
  mounted.push(m);
  rt.flush();
  return { rt, root };
}
const tok = (el: HTMLElement, t: string): string => el.style.getPropertyValue('--' + t);

describe('theme tokens', () => {
  it('CraftKit: light by default, dark with the system, grays 1–3 over the dark set and 4 over the light one', () => {
    expect(themeTokens(craftkit, { dark: false }).tokens['panel']).toBe('#ececec');
    expect(themeTokens(craftkit, { dark: true }).tokens['panel']).toBe('#2a2a2a');
    expect(themeTokens(craftkit, { dark: false, gray: '1' })).toMatchObject({ dark: true, tokens: { panel: '#1e1e1e', accent2: '#4b9cf5' } });
    expect(themeTokens(craftkit, { dark: false, gray: '2' }).tokens['panel']).toBe('#2a2a2a');
    expect(themeTokens(craftkit, { dark: false, gray: '3' }).tokens['panel']).toBe('#535353');
    expect(themeTokens(craftkit, { dark: true, gray: '4' })).toMatchObject({ dark: false, tokens: { panel: '#ececec' } });
    // every gray fills the same token names as the light set
    for (const g of ['auto', '1', '2', '3', '4']) expect(Object.keys(themeTokens(craftkit, { dark: true, gray: g }).tokens).sort()).toEqual(Object.keys(craftkit.light).sort());
  });
  it('both themes define the same tokens, including the pending (agent approval) colour', () => {
    expect(Object.keys(chromogen.light).sort()).toEqual(Object.keys(craftkit.light).sort());
    expect(Object.keys(chromogen.dark!).sort()).toEqual(Object.keys(craftkit.dark!).sort());
    expect(chromogen.light['pending']).toBe('#e2001a');
    expect(craftkit.light['pending']).toBeTruthy();
  });
  it('a theme without grays shows its dark set for grays 1–3 and its light set for 4', () => {
    expect(themeTokens(chromogen, { dark: false, gray: '2' }).tokens['panel']).toBe('#1a1a1a');
    expect(themeTokens(chromogen, { dark: true, gray: '4' }).tokens['panel']).toBe('#ffffff');
  });
  it("'lightroom' is the old name of CraftKit", () => {
    expect(lightroom).toBe(craftkit);
    const themes = new Map([[craftkit.name, craftkit]]);
    expect(resolveTheme(themes, 'lightroom')).toBe(craftkit);
    expect(resolveTheme(themes, 'nope')).toBeNull();
  });
});

describe('runtime theme switch', () => {
  it('defaults to CraftKit and writes its tokens on the app root', () => {
    const { rt, root } = setup();
    expect(rt.themeName()).toBe('craftkit');
    expect(root.dataset['ckTheme']).toBe('craftkit');
    expect(root.dataset['gray']).toBe('auto');
    expect(tok(root, 'panel')).toBe('#ececec');
    expect(rt.app.explain().split('\n')[0]).toContain('theme craftkit');
  });
  it('View ▸ Theme and View ▸ Interface Gray: checked commands that write prefs', () => {
    const { rt, root } = setup();
    expect(rt.commands.groups.get(THEME_GROUP)).toEqual(['view.theme.craftkit', 'view.theme.chromogen']);
    expect(rt.commands.groups.get(GRAY_GROUP)).toEqual(['view.gray.auto', 'view.gray.1', 'view.gray.2', 'view.gray.3', 'view.gray.4']);
    const st = () => rt.store.readonly();
    expect(rt.commands.checked('view.theme.craftkit', st())).toBe(true);
    rt.runCommand('view.theme.chromogen', null);
    rt.flush();
    expect(rt.store.peek(['prefs', 'theme'])).toBe('chromogen');
    expect(rt.commands.checked('view.theme.chromogen', st())).toBe(true);
    expect(rt.commands.checked('view.theme.craftkit', st())).toBe(false);
    expect(root.dataset['ckTheme']).toBe('chromogen');
    expect(tok(root, 'panel')).toBe('#ffffff');
    expect(tok(root, 'font')).toContain('Arial');
    rt.runCommand('view.gray.1', null);
    rt.flush();
    expect(rt.store.peek(['prefs', 'gray'])).toBe('1');
    expect(root.dataset['gray']).toBe('1');
    expect(tok(root, 'panel')).toBe('#1a1a1a');
    rt.runCommand('view.theme.craftkit', null);
    rt.flush();
    expect(tok(root, 'panel')).toBe('#1e1e1e');
    expect(rt.commands.checked('view.gray.1', st())).toBe(true);
    rt.runCommand('view.gray.auto', null);
    rt.flush();
    expect(tok(root, 'panel')).toBe('#ececec');
  });
  it("a program's theme is the default until prefs choose another; the old name still works", () => {
    const a = setup({ theme: 'chromogen' });
    expect(a.rt.themeName()).toBe('chromogen');
    expect(tok(a.root, 'panel')).toBe('#ffffff');
    a.rt.setTheme('lightroom');
    a.rt.flush();
    expect(a.rt.store.peek(['prefs', 'theme'])).toBe('craftkit');
    expect(tok(a.root, 'panel')).toBe('#ececec');
  });
  it('themeRoot: the tokens go on the host element, the app root keeps the data attributes', () => {
    const host = document.createElement('section');
    document.body.append(host);
    const { rt, root } = setup({ themeRoot: host });
    rt.runCommand('view.gray.3', null);
    rt.flush();
    expect(tok(host, 'panel')).toBe('#535353');
    expect(tok(root, 'panel')).toBe('');
    expect(root.dataset['gray']).toBe('3');
    expect(root.dataset['ckTheme']).toBe('craftkit');
  });
});
