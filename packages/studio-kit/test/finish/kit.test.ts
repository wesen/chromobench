// CHB-022 stages 4–6 headless: the finish kit's tools driven by synthetic events with a fake viewport (no DOM):
// straighten by dragging outside, move, resize with the aspect lock, keep-inside, Esc, one undo step per gesture;
// spots placed, moved, deleted and undone, stored in sensor px so a crop or a turn never moves them; dust mode;
// the passes (CB-F101, CB-F102) and the agent edits (the worked example as mutations).
import { describe, expect, it } from 'vitest';
import { defaultRecipe, type FrameRecipe } from '@chromobench/contract';
import { buildVariant, defineVariant } from '../../src/index.ts';
import { VARIANTS } from '../../variants/index.js';
import { cropProblem, edits, frameValid, nextSpotId, sensorTurn, spotsOf, toShown, toSource, type ProxyImage } from '../../kits/finish/src/index.ts';
import { started } from '../helpers.ts';

const S = 2; // screen px per picture px in the fake viewport

/** a fake viewport over a picture of nw × nh (what the tool's viewer shows) */
function vp(nw: number, nh: number, image: ProxyImage | null = null): any {
  return {
    natural: () => [nw, nh],
    toScreen: (u: number, v: number) => [u * nw * S, v * nh * S],
    docToScreen: (x: number, y: number) => [x * S, y * S],
    scale: () => S,
    shown: () => ({ image }),
  };
}
/** a tool event at picture px (x, y) */
const ev = (x: number, y: number, o: Record<string, unknown> = {}) => ({ x, y, sx: x * S, sy: y * S, u: 0, v: 0, ix: x, iy: y, shift: false, alt: false, mod: false, pressure: 0.5, pen: false, button: 0, inside: true, detail: 1, ...o });

async function finishStudio() {
  const st = await started({ def: (await VARIANTS.finish()).default });
  const { rt, studio, f } = st;
  rt.runCommand('frame.select', null, f);
  const e = studio.frames.get(f)!;
  const W = e.info.width, H = e.info.height;
  const recipe = (): FrameRecipe => studio.frames.get(f)!.log.committed;
  const tool = (id: string) => rt.tools.get(id)!.on!;
  return { ...st, W, H, recipe, tool };
}

describe('the crop tool (guide §5.2–5.3)', () => {
  it('drag outside the frame straightens; the crop shrinks to stay inside; one undo step; undo restores', async () => {
    const { rt, f, W, H, recipe, tool } = await finishStudio();
    expect(W).toBe(96);
    const ctx = rt.ctx({ vp: vp(W, H) });
    const before = rt.history.entries.length;
    // the pointer starts left of the picture, at its height, and turns clockwise by 3° about the centre
    const c = { x: W / 2, y: H / 2 };
    const at = (deg: number) => ({ x: c.x + 60 * Math.cos(Math.PI + (deg * Math.PI) / 180), y: c.y + 60 * Math.sin(Math.PI + (deg * Math.PI) / 180) });
    const g = tool('crop').down!(ev(at(0).x, at(0).y), ctx);
    expect(g.mode).toBe('rotate');
    let gs = g;
    for (const d of [1, 2, 3]) gs = tool('crop').drag!(ev(at(d).x, at(d).y), ctx, gs) ?? gs;
    // the preview is drawn, not logged
    expect(recipe().view.frame.angle_deg).toBe(0);
    expect((rt.state as any).recipes[f].view.frame.angle_deg).toBeCloseTo(-3, 6);
    tool('crop').up!(ev(at(3).x, at(3).y), ctx, gs);
    const fr = recipe().view.frame;
    expect(fr.angle_deg).toBeCloseTo(-3, 6);
    expect(fr.crop!.w).toBeLessThan(W);
    expect(frameValid(fr, W, H)).toBe(true);
    expect(rt.history.entries.length).toBe(before + 1);
    expect(rt.history.entries.at(-1)!.label).toBe('Straighten');
    rt.run('edit.undo');
    expect(recipe().view.frame).toEqual({ orientation: 'none', angle_deg: 0, crop: null });
  });

  it('Esc cancels: nothing logged; a click without a move is no edit', async () => {
    const { rt, f, W, H, recipe, tool } = await finishStudio();
    const ctx = rt.ctx({ vp: vp(W, H) });
    const n = rt.history.entries.length;
    const g = tool('crop').down!(ev(-10, H / 2), ctx);
    tool('crop').drag!(ev(-10, H / 2 + 20), ctx, g);
    expect((rt.state as any).recipes[f].view.frame.angle_deg).not.toBe(0);
    (tool('crop').escape as (c: unknown) => void)(ctx);
    expect((rt.state as any).recipes[f].view.frame.angle_deg).toBe(0);
    const g2 = tool('crop').down!(ev(40, 30), ctx);
    tool('crop').up!(ev(40, 30), ctx, g2);
    expect(rt.history.entries.length).toBe(n);
    expect(recipe().view.frame.crop).toBeNull();
  });

  it('aspect 4:5 is exact; a corner drag with the lock keeps it; a move sticks at the edge', async () => {
    const { rt, W, H, recipe, tool } = await finishStudio();
    await rt.runCommand('crop.aspect', null, '4:5');
    const b0 = recipe().view.frame.crop!;
    expect(b0.w / b0.h).toBe(0.8);
    expect(b0.h).toBe(60); // 4k × 5k inside 96 × 64: k = 12
    const ctx = rt.ctx({ vp: vp(W, H) });
    // the bottom-right handle, dragged up and left
    const g = tool('crop').down!(ev(b0.x + b0.w, b0.y + b0.h), ctx);
    expect([g.mode, g.hx, g.hy]).toEqual(['resize', 1, 1]);
    tool('crop').up!(ev(b0.x + b0.w - 12, b0.y + b0.h - 20), ctx, tool('crop').drag!(ev(b0.x + b0.w - 12, b0.y + b0.h - 20), ctx, g));
    const b1 = recipe().view.frame.crop!;
    expect(b1.w / b1.h).toBe(0.8);
    expect(b1.w).toBeLessThan(b0.w);
    expect([b1.x, b1.y]).toEqual([b0.x, b0.y]);
    // move far right: it stops at the frame's edge
    const m = tool('crop').down!(ev(b1.x + 5, b1.y + 5), ctx);
    expect(m.mode).toBe('move');
    tool('crop').up!(ev(b1.x + 500, b1.y + 5), ctx, tool('crop').drag!(ev(b1.x + 500, b1.y + 5), ctx, m));
    const b2 = recipe().view.frame.crop!;
    expect(b2.x + b2.w).toBe(W);
    expect(b2.w).toBe(b1.w);
    expect(rt.history.entries.slice(-3).map((e) => e.label)).toEqual(['Crop Aspect 4:5', 'Crop', 'Move Crop']);
  });

  it('orientation commands keep the crop box (sensor px); straighten buttons keep it inside', async () => {
    const { rt, W, H, recipe } = await finishStudio();
    await rt.runCommand('crop.aspect', null, '1:1');
    const b = recipe().view.frame.crop;
    await rt.runCommand('orient.cw', null);
    expect(recipe().view.frame).toEqual({ orientation: 'cw90', angle_deg: 0, crop: b });
    await rt.runCommand('crop.straighten', null, 5);
    expect(recipe().view.frame.angle_deg).toBe(5);
    expect(frameValid(recipe().view.frame, W, H)).toBe(true);
    await rt.runCommand('crop.reset', null);
    expect(recipe().view.frame).toEqual({ orientation: 'cw90', angle_deg: 0, crop: null });
  });
});

describe('the render bridge with a frame (CHB-022)', () => {
  it('the viewer\'s natural size is the shown picture: the crop, oriented; the crop tool shows the whole frame', async () => {
    const { rt, f, recipe, studio } = await finishStudio();
    const { frameRef } = await import('../../src/handles.ts');
    await rt.runCommand('crop.aspect', null, '4:5');
    await rt.runCommand('orient.cw', null);
    const b = recipe().view.frame.crop!;
    const bridge = (studio as any).bridge;
    const h = frameRef(f, recipe()).print();
    expect(bridge.naturalSize(h)).toEqual([b.h, b.w]);
    const out = await bridge.render(h, { maxSide: 1000, signal: new AbortController().signal });
    expect([out.srcW, out.srcH, out.image.width, out.image.height]).toEqual([b.h, b.w, b.h, b.w]);
    const canvas = (rt.tools.get('crop')!.image as (x: unknown) => any)(h);
    expect(bridge.naturalSize(canvas)).toEqual([64, 96]);
  });
});

describe('the spot tool (guide §5.5, §6.2)', () => {
  it('click places a heal spot in sensor px with an explicit source; drag sets the source; delete and undo', async () => {
    const { rt, f, W, H, recipe, tool, studio } = await finishStudio();
    // a crop and a turn first: the tool works on the finished print
    await rt.runCommand('crop.aspect', null, '1:1');
    await rt.runCommand('crop.straighten', null, 4);
    const fs = recipe().view.frame;
    const ctx = rt.ctx({ vp: vp(fs.crop!.w, fs.crop!.h) });
    const g = tool('spot').down!(ev(20, 25), ctx);
    tool('spot').up!(ev(20, 25), ctx, g);
    const s1 = recipe().retouch.spots['s1']!;
    const p = toSource(fs, W, H, 20, 25);
    expect(s1.x).toBeCloseTo(p.x, 1);
    expect(s1.y).toBeCloseTo(p.y, 1);
    expect(s1.mode).toBe('heal');
    expect(Math.hypot(s1.src.x - s1.x, s1.src.y - s1.y)).toBeGreaterThan(s1.r);
    expect(rt.history.entries.at(-1)!.label).toBe('Remove Spot');
    // a second spot, the source dragged to a place
    rt.runCommand('spot.mode', null, 'clone');
    const g2 = tool('spot').down!(ev(40, 40), ctx);
    tool('spot').up!(ev(10, 12), ctx, tool('spot').drag!(ev(10, 12), ctx, g2));
    const s2 = recipe().retouch.spots['s2']!;
    expect(s2.mode).toBe('clone');
    const q = toSource(fs, W, H, 10, 12);
    expect(s2.src.x).toBeCloseTo(Math.min(W - s2.r, Math.max(s2.r, q.x)), 1);
    // the print renders through retouch.heal
    const top = (studio as any).bridge.lower((await import('../../src/handles.ts')).frameRef(f, recipe()).print()).shown;
    expect(studio.frames.get(f)!.graph.closure(top.id).some((d) => d.op === 'retouch.heal')).toBe(true);
    // crop and turn again: the spots stay where they are on the film
    await rt.runCommand('orient.ccw', null);
    await rt.runCommand('crop.straighten', null, { to: -7 });
    expect(recipe().retouch.spots['s1']).toEqual(s1);
    expect(recipe().retouch.spots['s2']).toEqual(s2);
    const shown = toShown(recipe().view.frame, W, H, s1.x, s1.y);
    expect(Math.hypot(shown.x - 20, shown.y - 25)).toBeGreaterThan(1);
    // select s1 on the screen, delete it (set null deletes), undo brings it back
    const ctx2 = rt.ctx({ vp: vp(recipe().view.frame.crop!.h, recipe().view.frame.crop!.w) });
    const sel = tool('spot').down!(ev(shown.x, shown.y), ctx2);
    expect(sel.kind).toBe('target');
    tool('spot').up!(ev(shown.x, shown.y), ctx2, sel);
    expect((rt.state as any).finish.selected).toBe('s1');
    await rt.runCommand('spot.delete', null);
    expect(recipe().retouch.spots['s1']).toBeUndefined();
    rt.run('edit.undo');
    expect(recipe().retouch.spots['s1']).toEqual(s1);
    await rt.runCommand('spot.clear', null);
    expect(spotsOf(recipe())).toEqual([]);
    expect(nextSpotId(recipe(), 'retouch')).toBe('s1');
  });

  it('suggestSource picks the matching surroundings on the shown proxy', async () => {
    const { rt, W, H, recipe, tool } = await finishStudio();
    // a proxy that is dark everywhere except a bright band, the target sits in the band
    const data = new Float32Array(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let k = 0; k < 3; k++) data[(y * W + x) * 3 + k] = y >= 20 && y < 44 ? 0.9 : 0.1;
    const img: ProxyImage = { width: W, height: H, channels: 3, data, region: { x: 0, y: 0, w: W, h: H }, scale: 1 };
    rt.runCommand('spot.size', null, -1);
    const r = (rt.state as any).finish.spot.r;
    const ctx = rt.ctx({ vp: vp(W, H, img) });
    tool('spot').up!(ev(20, 32), ctx, tool('spot').down!(ev(20, 32), ctx));
    const s = recipe().retouch.spots['s1']!;
    expect(s.r).toBe(r);
    // the same surroundings are along the band (the rings above and below it are dark)
    expect(Math.abs(s.src.y - 32)).toBeLessThan(3);
    expect(Math.abs(s.src.x - 20)).toBeGreaterThan(2 * r);
  });

  it('dust mode (an engine with scan.heal, a negative frame) appends to scan.dust.spots', async () => {
    const { rt, W, H, recipe, tool } = await finishStudio();
    rt.runCommand('spot.mode', null, 'dust');
    const ctx = rt.ctx({ vp: vp(W, H) });
    tool('spot').up!(ev(30, 30), ctx, tool('spot').down!(ev(30, 30), ctx));
    expect(recipe().scan!.dust.spots).toEqual([{ id: 'd1', x: 30, y: 30, r: 12 }]);
    expect(rt.history.entries.at(-1)!.label).toBe('Remove Dust');
    expect(Object.keys(recipe().retouch.spots)).toEqual([]);
  });
});

describe('passes and agent edits (guide §9.4–9.5)', () => {
  const warn = (def: unknown, code: string) => buildVariant(def).app.diagnostics.list.filter((d) => d.code === code).map((d) => `${d.level} ${d.fix ?? ''}`);
  it('CB-F101: a finishing control in a module labelled Print; CB-F102: finish tools without the kit', () => {
    const bad = defineVariant({ id: 'x', label: 'x', build: (ck, cb) => cb.studio('X').use(cb.kits['finish'].kit).module(ck.module('print', { label: 'Print' }).right(ck.panel.define('p', {}, cb.arg('finishing.values.clarity')))) });
    expect(warn(bad, 'CB-F101')).toEqual(['warning move it to a Finish module (cb.kits.finish.tonesPanel()) or relabel the module']);
    const ok = defineVariant({ id: 'x', label: 'x', build: (ck, cb) => cb.studio('X').use(cb.kits['finish'].kit).module(ck.module('finish', { label: 'Finish' }).right(cb.kits['finish'].tonesPanel())) });
    expect(warn(ok, 'CB-F101')).toEqual([]);
    const nokit = defineVariant({ id: 'x', label: 'x', build: (ck, cb) => cb.studio('X').module(ck.module('m', { label: 'M' }).center(cb.viewer((s: any) => cb.sel.frame(s)?.print() ?? null, { tools: ['crop'] }))) });
    expect(warn(nokit, 'CB-F102')).toEqual(['error .use(cb.kits.finish.kit) on the studio']);
  });
  it('the worked example as the agent writes it: edits.crop → 1568 × 1960 at (716, 20); cropProblem fixes a bad crop', () => {
    const r = defaultRecipe('negative-scan', { sha256: '0'.repeat(64), name: 'x' });
    expect(edits.crop(r, 3000, 2000, { aspect: '4:5', angle_deg: 1.3 })).toEqual([
      { op: 'set', path: 'view.frame.angle_deg', value: 1.3 },
      { op: 'set', path: 'view.frame.crop', value: { x: 716, y: 20, w: 1568, h: 1960 } },
    ]);
    const bad: FrameRecipe = { ...r, view: { ...r.view, frame: { orientation: 'none', angle_deg: 10, crop: { x: 0, y: 0, w: 3000, h: 2000 } } } };
    const p = cropProblem(bad, 3000, 2000)!;
    expect(p.code).toBe('CB-F110');
    expect(frameValid(p.fix, 3000, 2000)).toBe(true);
    expect(sensorTurn(p.fix)).toBe(-10);
    expect(cropProblem(r, 3000, 2000)).toBeNull();
    expect(edits.spot(r, { mode: 'heal', x: 1204, y: 733, r: 14, src: { x: 1250, y: 700 } })).toEqual([{ op: 'set', path: 'retouch.spots.s1', value: { feather: 0.5, opacity: 1, enabled: true, mode: 'heal', x: 1204, y: 733, r: 14, src: { x: 1250, y: 700 } } }]);
  });
});
