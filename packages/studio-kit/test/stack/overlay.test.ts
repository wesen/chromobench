// The mask overlay (CHB-039), headless on MockEngine: its commands are view state (no step of the log); the cover a
// viewer gets is the selected entry's coverage on the document the viewer shows, when it is wanted (O, a mask tool,
// a mask previewed); the render bridge lowers it to output.frame of the contract's coverage node with the display
// cut's geometry, and the engine's pixels are that node's.
import { describe, expect, it } from 'vitest';
import { compile, type Document } from '@chromobench/contract';
import { frameRef } from '../../src/handles.ts';
import { maskCover, overlayOf, overlayReason } from '../../kits/stack/src/overlay.ts';
import { coverRgba } from '../../../shell/src/dom/viewport/paint.ts';
import { at, docOf, shown, started } from '../helpers.ts';

const steps = (rt: any, f: string) => rt.store.log.inEffect(f).length;

async function masked() {
  const s = await started();
  await s.rt.runCommand('layer.add', null, 'dodge', 'darkroom');
  await s.rt.runCommand('mask.new', null, 'linear');
  return s;
}

describe('mask.overlay.* commands', () => {
  it('toggle, mode, colour, opacity are view state: no step of the log', async () => {
    const { rt, f } = await masked();
    const n = steps(rt, f);
    expect(overlayOf(rt.state)).toMatchObject({ on: false, mode: 'tint', colour: 'red', opacity: 0.5 });
    expect(await rt.runCommand('mask.overlay.toggle', null)).toBe(true);
    expect(overlayReason(rt.state)).toBe('on');
    expect(await rt.runCommand('mask.overlay.colour', null)).toBe('green'); // Shift+O: the next colour
    expect(await rt.runCommand('mask.overlay.colour', null, 'white')).toBe('white');
    expect(await rt.runCommand('mask.overlay.opacity', null, 80)).toBe(0.8); // a percentage
    expect(await rt.runCommand('mask.overlay.opacity', null, 0)).toBe(0.05); // held to 5 %
    expect(await rt.runCommand('mask.overlay.toggle', null)).toBe(false);
    // choosing how it shows shows it
    expect(await rt.runCommand('mask.overlay.mode', null, 'mask')).toBe('mask');
    expect(overlayOf(rt.state)).toMatchObject({ on: true, mode: 'mask', colour: 'white', opacity: 0.05 });
    expect(await rt.runCommand('mask.overlay.mode', null)).toBe('tint'); // Alt+O: the next mode
    expect(steps(rt, f)).toBe(n);
  });

  it('a value it does not know is a toast and changes nothing', async () => {
    const { rt } = await masked();
    const toasts: string[] = [];
    const t0 = rt.chrome.toast.bind(rt.chrome);
    (rt.chrome as any).toast = (m: string, o?: unknown) => (toasts.push(m), t0(m, o as never));
    await rt.runCommand('mask.overlay.mode', null, 'quick');
    await rt.runCommand('mask.overlay.colour', null, 'pink');
    expect(toasts).toEqual([expect.stringMatching(/not a mode/), expect.stringMatching(/not a colour/)]);
    expect(overlayOf(rt.state)).toMatchObject({ on: false, mode: 'tint', colour: 'red' });
  });

  it('O, Shift+O and Alt+O are the keys', async () => {
    const { rt } = await masked();
    const text = String(rt.app.explain());
    expect(text).toMatch(/mask\.overlay\.toggle "Show Mask Overlay" O ←/);
    expect(text).toMatch(/mask\.overlay\.mode "Mask Overlay Mode" Alt\+O ←/);
    expect(text).toMatch(/mask\.overlay\.colour "Mask Overlay Colour" Shift\+O ←/);
  });
});

describe('the viewer\'s cover', () => {
  it('is the selected entry\'s coverage when wanted: O, a mask tool, a previewed mask', async () => {
    const { rt, f } = await masked();
    const print = () => frameRef(f, shown(rt, f)).print();
    expect(maskCover(rt.state, print())).toBeNull(); // not wanted
    rt.ctx().set({ ui: { tool: 'mask-paint' } });
    expect(overlayReason(rt.state)).toBe('tool');
    rt.ctx().set({ ui: { tool: null }, stack: { overlay: { live: true } } });
    expect(overlayReason(rt.state)).toBe('drag');
    rt.ctx().set({ stack: { overlay: { live: false } } });
    await rt.runCommand('mask.overlay.toggle', null, true);
    const c = maskCover(rt.state, print())!;
    expect(c.image).toMatchObject({ what: 'mask', frame: f, args: { entry: 'dodge1' } });
    expect(c).toMatchObject({ mode: 'tint', colour: [1, 0, 0], opacity: 0.5 });
    // a view of the negative, or a layer without a mask: nothing
    expect(maskCover(rt.state, frameRef(f, shown(rt, f)).view('dyes'))).toBeNull();
    await rt.runCommand('layer.select', null, 'main');
    expect(maskCover(rt.state, print())).toBeNull();
  });

  it('follows the document the viewer shows (a drag\'s preview)', async () => {
    const { rt, f } = await masked();
    await rt.runCommand('mask.overlay.toggle', null, true);
    const d0 = shown(rt, f);
    rt.store.preview(at(rt, f, 'm1.feather_mm'), 3);
    const d1 = shown(rt, f);
    expect(d1).not.toBe(d0);
    const c = maskCover(rt.state, frameRef(f, d1).print())!;
    expect(c.image.doc).toBe(d1);
    rt.store.cancel();
  });
});

describe('the render bridge lowers a mask handle to the engine\'s coverage node in the picture\'s geometry', () => {
  it('output.frame(coverage) with the display\'s geometry; the engine\'s pixels are the node\'s', async () => {
    const { rt, f, studio } = await masked();
    await rt.runCommand('mask.set', null, 'm1c1.params.to', { x: 0, y: 40 }, 'Gradient');
    const d: Document = docOf(rt, f);
    const h = frameRef(f, d).mask('dodge1');
    const l = studio.bridge.lower(h);
    const e = studio.frames.get(f)!;
    const c = compile(d, e.graph, { displaySpace: studio.bridge.displaySpace });
    expect(l.named.id).toBe(c.coverage('dodge1')!.id);
    expect(l.shown.op).toBe('output.frame');
    expect(l.shown.inputs[0]).toBe(l.named.id);
    expect(l.shown.args).toEqual(c.display.args);
    expect(l.shown.info).toMatchObject({ domain: 'mask', channels: 1 });
    expect(studio.bridge.naturalSize(h)).toEqual(studio.bridge.naturalSize(frameRef(f, d).print()));
    // rendered through the bridge: one channel, the coverage node's values (no crop: the same grid)
    const r = await studio.bridge.render(h, { slot: 't', epoch: 0, lane: 'live', pass: 'screen', maxSide: 4096, signal: new AbortController().signal });
    expect(r.image.channels).toBe(1);
    studio.engine.adopt(e.graph.closure(l.named.id));
    const ref = await (await studio.engine.evaluate(l.named, { scale: 'full', precision: 'preview' })).read();
    expect(Array.from(r.image.data)).toEqual(Array.from(ref));
    const vals = Array.from(r.image.data);
    expect(Math.min(...vals)).toBeLessThan(0.05);
    expect(Math.max(...vals)).toBeGreaterThan(0.95);
  });

  it('a crop and a quarter turn act on the mask as on the picture', async () => {
    const { rt, f, studio } = await masked();
    await rt.runCommand('mask.set', null, 'm1c1.params.to', { x: 0, y: 40 }, 'Gradient');
    const d0 = docOf(rt, f);
    const h0 = frameRef(f, d0).mask('dodge1');
    const r0 = await studio.bridge.render(h0, { slot: 't', epoch: 0, lane: 'live', pass: 'screen', maxSide: 4096, signal: new AbortController().signal });
    rt.ctx().tx('Crop', (t: any) => {
      t.$set(at(rt, f, 'geometry.crop'), { x: 4, y: 6, w: 20, h: 10 });
      t.$set(at(rt, f, 'geometry.orientation'), 'cw90');
    });
    const d = docOf(rt, f);
    const h = frameRef(f, d).mask('dodge1');
    expect(studio.bridge.naturalSize(h)).toEqual([10, 20]);
    const r = await studio.bridge.render(h, { slot: 't', epoch: 0, lane: 'live', pass: 'screen', maxSide: 4096, signal: new AbortController().signal });
    expect([r.image.width, r.image.height]).toEqual([10, 20]);
    // cw90: output (x′, y′) reads input (y′, h − 1 − x′) of the crop
    const W0 = r0.image.width;
    for (const [x, y] of [[0, 0], [9, 0], [3, 7], [9, 19]] as const) {
      const sx = 4 + y, sy = 6 + (10 - 1 - x);
      expect(r.image.data[y * 10 + x]).toBeCloseTo(r0.image.data[sy * W0 + sx]!, 6);
    }
  });
});

describe('the cover\'s paint', () => {
  const img = { width: 3, height: 1, channels: 1, data: new Float32Array([0, 0.5, 1]) };
  it('tint: the colour at opacity × coverage; inverse: × (1 − coverage); mask: opaque grey', () => {
    expect(Array.from(coverRgba(img, { mode: 'tint', colour: [1, 0, 0], opacity: 0.5 }))).toEqual([255, 0, 0, 0, 255, 0, 0, 64, 255, 0, 0, 128]);
    expect(Array.from(coverRgba(img, { mode: 'inverse', colour: [0, 1, 0], opacity: 1 }))).toEqual([0, 255, 0, 255, 0, 255, 0, 128, 0, 255, 0, 0]);
    expect(Array.from(coverRgba(img, { mode: 'mask' }))).toEqual([0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255]);
  });
});
