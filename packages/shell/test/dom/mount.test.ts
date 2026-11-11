// @vitest-environment happy-dom
// The DOM half on happy-dom: the mini studio mounted on a headless runtime with a fake bridge and presenter.
import { afterEach, describe, expect, it } from 'vitest';
import { createCk } from '../../src/index.ts';
import { mountRuntime, type Mounted } from '../../src/dom/index.ts';
import { fakeBridge, fakePresenter, manualClock, memoryPersistence } from '../../src/testing/index.ts';
import { miniStudio, type MiniState } from '../fixtures/mini-studio.ts';

const mounted: Mounted[] = [];
afterEach(() => {
  for (const m of mounted.splice(0)) m.dispose();
  document.body.replaceChildren();
});

function setup(services: Record<string, unknown> = {}) {
  const clock = manualClock();
  const bridge = fakeBridge();
  const presenter = fakePresenter();
  const app = miniStudio(createCk<MiniState>()).build();
  const rt = app.start({ clock, bridges: [bridge], presenter: () => presenter, ...services });
  const root = document.createElement('div');
  document.body.append(root);
  const m = mountRuntime(rt, root);
  mounted.push(m);
  rt.flush();
  return { rt, root, bridge, presenter, clock, app };
}
const ptr = (type: string, o: Partial<PointerEventInit> = {}): PointerEvent => new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, ...o });
const key = (k: string, o: Partial<KeyboardEventInit> = {}): KeyboardEvent => new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o });
const sliderNamed = (root: HTMLElement, name: string): HTMLElement => [...root.querySelectorAll<HTMLElement>('.ck-slider')].find(el => el.querySelector('.ck-slider-l')?.textContent === name)!;
/** a slider's track with a 200px layout (happy-dom does no layout); the knob of a centred bipolar slider is at x = 100 */
const trackOf = (root: HTMLElement, name: string): HTMLElement => {
  const t = sliderNamed(root, name).querySelector<HTMLElement>('.ck-slider-t')!;
  t.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 16, width: 200, height: 16, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  return t;
};

describe('mount', () => {
  it('builds the frame: menu bar, module picker, dock, grid cells, panels; no missing renderers', () => {
    const { rt, root } = setup();
    expect(root.classList.contains('ck-app')).toBe(true);
    expect([...root.querySelectorAll('.ck-menubar-t')].map(b => b.textContent)).toContain('Photo');
    expect(root.querySelectorAll('.ck-module').length).toBe(2);
    expect(root.querySelector('[data-panel="filter"]')).not.toBeNull();
    expect(root.querySelectorAll('.ck-gridview .ck-coll-cell').length).toBeGreaterThan(0);
    expect(root.querySelector('.ck-filmstrip')).not.toBeNull();
    expect(rt.diagnostics.codes()).not.toContain('CK-V320');
  });

  it('switching module swaps the frame and disposes the old one', () => {
    const { rt, root } = setup();
    rt.go('develop');
    rt.flush();
    expect(root.querySelector('.ck-work')?.getAttribute('data-module')).toBe('develop');
    expect(root.querySelector('.ck-gridview')).toBeNull();
    expect(root.querySelector('.ck-vp')).not.toBeNull();
    expect(sliderNamed(root, 'Exposure')).toBeTruthy();
  });
});

describe('gestures', () => {
  it('a slider drag previews, then is one undo step', () => {
    const { rt, root } = setup();
    rt.go('develop');
    rt.flush();
    const before = rt.history.entries.length;
    const track = trackOf(root, 'Exposure');
    track.dispatchEvent(ptr('pointerdown', { clientX: 100 }));
    track.dispatchEvent(ptr('pointermove', { clientX: 110 }));
    track.dispatchEvent(ptr('pointermove', { clientX: 120 }));
    expect(rt.store.previewing).toBe(true);
    expect(rt.history.entries.length).toBe(before);
    track.dispatchEvent(ptr('pointerup', { clientX: 120 }));
    rt.flush();
    expect(rt.store.previewing).toBe(false);
    expect(rt.history.entries.length).toBe(before + 1);
    expect(rt.history.entries.at(-1)!.label).toBe('Exposure');
    expect(rt.state.dev['p0']!.light.exposure).toBeCloseTo(1, 5);
    rt.undo();
    rt.flush();
    expect(rt.state.dev['p0']!.light.exposure).toBe(0);
  });

  it('Escape during a slider drag cancels the preview', () => {
    const { rt, root } = setup();
    rt.go('develop');
    rt.flush();
    const before = rt.history.entries.length;
    const track = trackOf(root, 'Contrast');
    track.dispatchEvent(ptr('pointerdown', { clientX: 100 }));
    track.dispatchEvent(ptr('pointermove', { clientX: 180 }));
    expect(rt.store.previewing).toBe(true);
    window.dispatchEvent(key('Escape'));
    rt.flush();
    expect(rt.store.previewing).toBe(false);
    expect(rt.state.dev['p0']!.light.contrast).toBe(0);
    expect(rt.history.entries.length).toBe(before);
  });

  it('a disabled command button shows why, and says it when clicked', () => {
    const { rt, root } = setup();
    rt.go('develop');
    rt.flush();
    const btn = [...root.querySelectorAll<HTMLElement>('.ck-btn')].find(b => b.textContent?.includes('Reset Develop Settings'))!;
    expect(btn).toBeTruthy();
    expect(btn.classList.contains('is-disabled')).toBe(true);
    expect(btn.dataset['why']).toBe('Nothing to reset');
    btn.click();
    expect(root.querySelector('.ck-toast')?.textContent).toContain('Nothing to reset');
    // change something: it enables
    rt.ctx().tx('Exposure', t => void (t.dev['p0']!.light.exposure = 1));
    rt.flush();
    expect(btn.classList.contains('is-disabled')).toBe(false);
  });

  it('double-clicking a section title resets its sliders in one step', () => {
    const { rt, root } = setup();
    rt.go('develop');
    rt.flush();
    rt.ctx().tx('Edit', t => {
      t.dev['p0']!.light.exposure = 1;
      t.dev['p0']!.light.contrast = 20;
      t.dev['p0']!.color.tint = 5;
    });
    rt.flush();
    const n = rt.history.entries.length;
    const title = [...root.querySelectorAll<HTMLElement>('.ck-section-t')].find(t => t.textContent === 'Light')!;
    title.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    rt.flush();
    expect(rt.state.dev['p0']!.light).toEqual({ exposure: 0, contrast: 0, highlights: 0, shadows: 0 });
    expect(rt.state.dev['p0']!.color.tint).toBe(5);
    expect(rt.history.entries.length).toBe(n + 1);
  });
});

describe('workspace', () => {
  it('Tab hides the side panels, F7 the left one; the edges show it', () => {
    const { rt, root } = setup();
    const left = root.querySelector<HTMLElement>('.ck-side-left')!;
    const right = root.querySelector<HTMLElement>('.ck-side-right')!;
    expect(left.hidden).toBe(false);
    window.dispatchEvent(key('Tab'));
    rt.flush();
    expect(left.hidden).toBe(true);
    expect(right.hidden).toBe(true);
    window.dispatchEvent(key('Tab'));
    rt.flush();
    expect(left.hidden).toBe(false);
    window.dispatchEvent(key('F7'));
    rt.flush();
    expect(left.hidden).toBe(true);
    expect(right.hidden).toBe(false);
    expect(root.querySelector('.ck-edge-left')!.classList.contains('is-closed')).toBe(true);
  });

  it('a collapsed panel survives a reload', async () => {
    const persistence = memoryPersistence();
    const app = miniStudio(createCk<MiniState>()).build();
    const rt = await app.boot({ clock: manualClock(), persistence });
    const root = document.createElement('div');
    document.body.append(root);
    const m1 = mountRuntime(rt, root);
    rt.flush();
    const head = root.querySelector<HTMLElement>('[data-panel="filter"] .ck-panel-h')!;
    head.click();
    rt.flush();
    expect(root.querySelector('[data-panel="filter"]')!.classList.contains('is-closed')).toBe(true);
    await rt.save();
    m1.dispose();

    const rt2 = await app.boot({ clock: manualClock(), persistence });
    const root2 = document.createElement('div');
    document.body.append(root2);
    mounted.push(mountRuntime(rt2, root2));
    rt2.flush();
    expect(root2.querySelector('[data-panel="filter"]')!.classList.contains('is-closed')).toBe(true);
    expect(root2.querySelector('[data-panel="navigator"]')!.classList.contains('is-closed')).toBe(false);
  });
});

describe('collections', () => {
  it('arrows move the selection; Enter runs the key command; clicks select, Shift extends', () => {
    const { rt, root } = setup();
    const grid = root.querySelector<HTMLElement>('.ck-gridview')!;
    grid.dispatchEvent(key('ArrowRight'));
    rt.flush();
    expect(rt.state.ui.selection.primary).toBe('p1');
    const cell = (id: string) => grid.querySelector<HTMLElement>(`.ck-coll-cell[data-key="${id}"]`)!;
    cell('p3').dispatchEvent(ptr('pointerdown'));
    rt.flush();
    expect(rt.state.ui.selection).toEqual({ ids: ['p3'], primary: 'p3', anchor: 'p3' });
    cell('p5').dispatchEvent(ptr('pointerdown', { shiftKey: true }));
    rt.flush();
    expect(rt.state.ui.selection.ids).toEqual(['p3', 'p4', 'p5']);
    expect(cell('p4').classList.contains('is-sel')).toBe(true);
    grid.dispatchEvent(key('Enter'));
    rt.flush();
    expect(rt.state.view.module).toBe('develop');
  });

  it('grid cells draw thumbnails through the bridge on the background lane, cached by key', async () => {
    const { rt, root, bridge } = setup();
    await rt.settle();
    const bg = bridge.calls.filter(c => c.t.lane === 'bg');
    expect(bg.length).toBeGreaterThan(0);
    expect(bg.every(c => c.t.maxSide === 160)).toBe(true);
    expect(root.querySelector('.ck-gridview .ck-thumb[data-rendered]')).not.toBeNull();
    expect(rt.renders.thumbs.size).toBe(bg.length);
    // a develop edit changes one picture: only its thumbnail renders again
    rt.ctx().tx('Exposure', t => void (t.dev['p0']!.light.exposure = 1));
    rt.flush();
    await rt.settle();
    expect(bridge.calls.filter(c => c.t.lane === 'bg').length).toBe(bg.length + 1);
  });

  it('items follow state: the filter slider narrows the grid', () => {
    const { rt, root } = setup();
    const count = () => root.querySelectorAll('.ck-gridview .ck-coll-cell').length;
    const all = count();
    rt.ctx().set({ view: { filter: { minRating: 5 } } });
    rt.flush();
    expect(count()).toBeLessThan(all);
    expect([...root.querySelectorAll<HTMLElement>('.ck-gridview .ck-coll-cell')].map(c => c.dataset['key'])).toEqual(['p5', 'p11']);
  });
});

describe('viewport', () => {
  it('renders through the bridge and shows through the presenter; zoom commands move the view', async () => {
    const { rt, root, bridge, presenter } = setup();
    rt.go('develop');
    rt.flush();
    await rt.settle();
    const vpCalls = () => bridge.calls.filter(c => c.t.slot.startsWith('vp:'));
    expect(vpCalls().length).toBeGreaterThan(0);
    expect(vpCalls()[0]!.t.slot).toBe('vp:main:after');
    expect(presenter.images.length).toBeGreaterThan(0);
    const vp = root.querySelector<HTMLElement>('.ck-vp')!;
    expect(vp.dataset['rendered']).toBeTruthy();
    expect(rt.viewport()!.natural()).toEqual([600, 400]);
    const v = presenter.draws.at(-1)!;
    expect(v.docW).toBe(600);
    expect(v.cx).toBeCloseTo(300, 5);
    rt.run('view.actual');
    rt.flush();
    await rt.settle();
    expect((rt.store.peek(['view', 'vp', 'main']) as { zoom: unknown }).zoom).toBe(1);
    expect(presenter.draws.at(-1)!.zoom).toBe(1);
    expect(vpCalls().at(-1)!.t.pass).toBe('refine');
  });

  it('a slider drag asks for a draft, then a screen render when it ends', async () => {
    const { rt, root, bridge } = setup();
    rt.go('develop');
    rt.flush();
    await rt.settle();
    const n0 = bridge.calls.length;
    const track = trackOf(root, 'Exposure');
    track.dispatchEvent(ptr('pointerdown', { clientX: 100 }));
    track.dispatchEvent(ptr('pointermove', { clientX: 130 }));
    rt.flush();
    await rt.settle();
    expect(bridge.calls.at(-1)!.t.pass).toBe('draft');
    track.dispatchEvent(ptr('pointerup', { clientX: 130 }));
    rt.flush();
    await rt.settle();
    expect(bridge.calls.length).toBeGreaterThan(n0 + 1);
    expect(bridge.calls.at(-1)!.t.pass).toBe('screen');
  });

  it('a tool gets document pixels', async () => {
    const { rt, root } = setup();
    rt.go('develop');
    rt.flush();
    await rt.settle();
    rt.press('I');
    rt.flush();
    expect(rt.state.ui.tool).toBe('probe');
    const vp = root.querySelector<HTMLElement>('.ck-vp')!;
    // 600×400 view, 600×400 picture fit with 8px margins: the centre of the view is the centre of the picture
    vp.dispatchEvent(ptr('pointerdown', { clientX: 300, clientY: 200 }));
    rt.flush();
    expect(rt.state.ui.probe).toEqual([300, 200]);
  });
});
