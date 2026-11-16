// CHB-049 in the studio on the WebGPU engine (SwiftShader in CI), synthetic negatives only:
// - MASK-4: while the radial tool is dragged the picture already shows the new mask acting (the gesture's draft is
//   rendered, the overlay shows it); the release is one step; render timings during the drag (MASK_W=3000 REAL_GPU=1
//   for the frame budget on a real GPU);
// - MASK-3: the part's handles on the picture (move, turn), a part's invert, the mask's density and expand, the brush
//   options; the panel's own sliders move relative to where the drag began, Alt ten times finer;
// - MASK-2: the selection tools (rectangle with Shift and Alt, lasso, polygonal lasso, magic wand), Select All,
//   Inverse, Deselect by key, Use Selection as Mask; each one step; the print changes inside a selection only.
import { expect, test, type Page } from '@playwright/test';
import { negativeScan, tif } from './scenes.ts';
import { opened } from './support.ts';

const W = Number(process.env['MASK_W'] ?? 480), H = Math.round((W * 2) / 3);
const VP = '.ck-vp[data-viewport="edit"]';
const MASKS = '.ck-panel[data-panel="layer-masks-edit"]';
const idle = (page: Page) => page.evaluate(() => window.chromobench.idle());
const hook = <T>(page: Page, f: string): Promise<T> => page.evaluate(`(() => { const cb = window.chromobench; return ${f}; })()`) as Promise<T>;
const run = (page: Page, cmd: string, ...a: unknown[]) => page.evaluate(([c, x]) => window.chromobench.run(c as string, ...(x as unknown[])), [cmd, a] as const);
const tool = (page: Page) => hook<string | null>(page, 'cb.state().ui.tool ?? null');
const steps = (page: Page) => hook<number>(page, 'cb.entries().length');

/** page coordinates of a document pixel in the Edit viewer */
async function at(page: Page, x: number, y: number): Promise<[number, number]> {
  const box = (await page.locator(VP).boundingBox())!;
  const [sx, sy] = await page.evaluate(([px, py]) => (window.chromobench.rt.viewports.get('edit') as unknown as { docToScreen(x: number, y: number): [number, number] }).docToScreen(px!, py!), [x, y] as const);
  return [box.x + sx, box.y + sy];
}
async function drag(page: Page, from: [number, number], to: [number, number], o: { steps?: number; up?: boolean } = {}): Promise<void> {
  const a = await at(page, ...from), b = await at(page, ...to);
  await page.mouse.move(...a);
  await page.mouse.down();
  await page.mouse.move(...b, { steps: o.steps ?? 6 });
  if (o.up !== false) await page.mouse.up();
}
/** the Edit viewer's last presented picture at a document pixel: the mean of its display values */
const lum = (page: Page, x: number, y: number) =>
  page.evaluate(([px, py]) => {
    const l = (window.chromobench.rt.viewports.get('edit') as unknown as { shown(): { image: { region: { x: number; y: number }; scale: number; width: number; height: number; channels: number; data: Float32Array } | null } }).shown().image;
    if (!l) return NaN;
    const i = (Math.floor((py! - l.region.y) * l.scale) * l.width + Math.floor((px! - l.region.x) * l.scale)) * l.channels;
    return (Number(l.data[i]) + Number(l.data[i + 1]) + Number(l.data[i + 2])) / 3;
  }, [x, y] as const);

async function boot(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/?nosw&canvas2d&fresh&engine=gpu&layout=classic');
  await page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: 60_000 });
  await page.setInputFiles('#file', tif('scene.tif', negativeScan(W, H)));
  await opened(page, 1, 120_000);
  await page.locator('.ck-module[data-module="edit"]').click();
  await expect(page.locator(VP)).toHaveAttribute('data-rendered', /\d+x\d+/);
  // a print layer that darkens by a stop: everywhere while it has no mask, only where its mask acts once it has one
  expect(await run(page, 'layer.add', 'exposure', 'print')).toBe('exposure1');
  await page.evaluate(() => window.chromobench.set('exposure1.params.stops', -1, 'Exposure'));
  await idle(page);
  return errors;
}

test('MASK-4 and MASK-3: the radial gesture shows before release; handles move and turn it; invert, density, expand; the brush options', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = await boot(page);
  const before = await steps(page);
  const centre: [number, number] = [W / 2, H / 2], corner: [number, number] = [0.05 * W, 0.05 * H];
  const [dark, cornerDark] = [await lum(page, ...centre), await lum(page, ...corner)];

  // MASK-4: the radial tool dragged, the hand still down: the gesture's mask is a draft the picture already renders
  await page.evaluate(() => {
    const w = window as unknown as { ms: { print: number[]; cover: number[] } };
    w.ms = { print: [], cover: [] };
    window.chromobench.rt.on('rendered', (e: { cover?: boolean; ms: number }) => void (e.cover ? w.ms.cover : w.ms.print).push(e.ms));
  });
  await run(page, 'tool.mask-radial');
  await drag(page, [0.3 * W, 0.3 * H], [0.7 * W, 0.7 * H], { steps: 12, up: false });
  await page.waitForFunction(() => window.chromobench.rt.store.previewing && !!(window.chromobench.state() as { stack: { overlay: { live: boolean } } }).stack.overlay.live, null, { timeout: 30_000 });
  // outside the radial the layer no longer acts: the corner is lighter already; the centre stays dark
  await expect.poll(() => lum(page, ...corner), { timeout: 30_000 }).toBeGreaterThan(cornerDark + 0.05);
  await expect.poll(async () => Math.abs((await lum(page, ...centre)) - dark), { timeout: 30_000 }).toBeLessThan(0.02);
  // and the overlay shows the draft mask too (red where it acts)
  await expect(page.locator(`${VP} canvas.ck-vp-cover`)).toBeVisible({ timeout: 30_000 });
  expect(await steps(page)).toBe(before); // nothing logged yet
  await page.mouse.up();
  await idle(page);
  expect(await steps(page)).toBe(before + 1);
  expect(await tool(page)).toBeNull(); // one mask, then no tool (CHB-046)
  const ms = await page.evaluate(() => (window as unknown as { ms: { print: number[]; cover: number[] } }).ms);
  expect(ms.print.length).toBeGreaterThan(0);
  console.log(`${await page.evaluate(() => window.chromobench.engineLabel)} · ${W}×${H}: radial drag, picture renders ${ms.print.length} (ms ${ms.print.map((x) => x.toFixed(1)).join(' ')}), cover renders ${ms.cover.length} (ms ${ms.cover.map((x) => x.toFixed(1)).join(' ')})`);
  const comp = 'm1c1';
  const box0 = await hook<{ x: number; y: number; w: number; h: number }>(page, `cb.get('${comp}.params.box')`);

  // MASK-3: its handles (the ✥ of the part): move the middle, then turn it by the knob
  await page.locator(`${MASKS} .cb-stack-comp[data-id="${comp}"] .cb-stack-comp-edit`).click();
  expect(await tool(page)).toBe('mask-edit');
  await expect(page.locator(`${VP} .cb-stack-handle.is-rotate`)).toHaveCount(1);
  const c0: [number, number] = [box0.x + box0.w / 2, box0.y + box0.h / 2];
  await drag(page, c0, [c0[0] + 0.1 * W, c0[1] - 0.05 * H]);
  await idle(page);
  const box1 = await hook<{ x: number; y: number; w: number; h: number }>(page, `cb.get('${comp}.params.box')`);
  expect(box1.x - box0.x).toBeCloseTo(0.1 * W, -0.5);
  expect(box1.y - box0.y).toBeCloseTo(-0.05 * H, -0.5);
  expect(box1.w).toBe(box0.w);
  const knob = await page.locator(`${VP} .cb-stack-handle.is-rotate`).boundingBox();
  const c1: [number, number] = [box1.x + box1.w / 2, box1.y + box1.h / 2];
  const cs = await at(page, ...c1);
  await page.mouse.move(knob!.x + knob!.width / 2, knob!.y + knob!.height / 2);
  await page.mouse.down();
  // to the right of the centre, level with it: a quarter turn
  await page.mouse.move(cs[0] + 80, cs[1], { steps: 6 });
  await page.mouse.up();
  await idle(page);
  // a quarter turn (−90 and 90 are the same shape)
  expect(Math.abs(await hook<number>(page, `cb.get('${comp}.params.angle_deg')`))).toBeCloseTo(90, 0);
  expect(await steps(page)).toBe(before + 3);
  await page.keyboard.press('Escape');

  // a part inverted, then not; the mask's density and expand
  const inv = page.locator(`${MASKS} .cb-stack-comp[data-id="${comp}"] .cb-stack-comp-inv input`);
  await inv.check();
  await idle(page);
  expect(await hook<boolean>(page, `cb.get('${comp}.invert')`)).toBe(true);
  await expect.poll(() => lum(page, ...c1)).toBeGreaterThan(dark + 0.05);
  await inv.uncheck();
  await idle(page);
  // density: the track dragged 60 px left from where it starts (relative, 1/300 of 0…100 % per px): 80 %, Alt: 98 %
  const dens = page.locator(`${MASKS} .cb-stack-num[data-path="m1.density"] input.cb-range`);
  await dens.scrollIntoViewIfNeeded();
  const db = (await dens.boundingBox())!;
  await page.mouse.move(db.x + db.width - 4, db.y + db.height / 2);
  await page.mouse.down();
  await page.mouse.move(db.x + db.width - 64, db.y + db.height / 2, { steps: 5 });
  await page.mouse.up();
  await idle(page);
  expect(await hook<number>(page, `cb.get('m1.density')`)).toBeCloseTo(0.8, 5);
  await page.keyboard.down('Alt');
  await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2);
  await page.mouse.down();
  await page.mouse.move(db.x + db.width / 2 + 60, db.y + db.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await idle(page);
  expect(await hook<number>(page, `cb.get('m1.density')`)).toBeCloseTo(0.82, 5);
  await run(page, 'mask.set', 'm1.grow_mm', 0.5, 'Expand');
  await idle(page);
  expect(await hook<number>(page, `cb.get('m1.grow_mm')`)).toBe(0.5);

  // the brush's options show with the brush
  await run(page, 'tool.mask-paint');
  await expect(page.locator(`${MASKS} .cb-stack-brush`)).toBeVisible();
  expect(await run(page, 'mask.brush', { size: 30, flow: 0.5 })).toMatchObject({ size: 30, flow: 0.5 });
  await drag(page, [0.1 * W, 0.8 * H], [0.9 * W, 0.8 * H]);
  await idle(page);
  const strokes = await hook<{ items: Record<string, { radius: number; flow?: number }> }>(page, `cb.get('m1c2.params.strokes')`);
  expect(Object.values(strokes.items)[0]).toMatchObject({ radius: 30, flow: 0.5 });
  await run(page, 'tool.none');
  expect(errors).toEqual([]);
});

test('MASK-2: rectangle (Shift adds, Alt subtracts), lasso, polygonal lasso, wand; Select All, Inverse, Deselect by key; Use Selection as Mask', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = await boot(page);
  const inside: [number, number] = [0.25 * W, 0.3 * H], outside: [number, number] = [0.75 * W, 0.8 * H];
  const [li0, lo0] = [await lum(page, ...inside), await lum(page, ...outside)];
  const comps = () => hook<string[]>(page, `(() => { const m = cb.doc.stages.print.stack.items['exposure1'].mask; return m ? cb.doc.masks.items[m].components.order.map((c) => cb.doc.masks.items[m].components.items[c].kind + ':' + cb.doc.masks.items[m].components.items[c].combine) : []; })()`);

  // the rectangle from the Mask panel's Select row: the layer acts inside it only (outside the print is lighter again)
  await page.locator(`${MASKS} .cb-select-tool-select-rect`).click();
  expect(await tool(page)).toBe('select-rect');
  await drag(page, [0.1 * W, 0.1 * H], [0.5 * W, 0.5 * H]);
  await idle(page);
  expect(await tool(page)).toBeNull();
  expect(await comps()).toEqual(['rect:add']);
  await expect.poll(() => lum(page, ...outside)).toBeGreaterThan(lo0 + 0.05);
  expect(Math.abs((await lum(page, ...inside)) - li0)).toBeLessThan(0.01);

  // Alt subtracts an ellipse; Shift adds a lasso; the polygonal lasso by clicks; the wand
  await run(page, 'tool.select-ellipse');
  await page.keyboard.down('Alt');
  await drag(page, [0.2 * W, 0.2 * H], [0.3 * W, 0.4 * H]);
  await page.keyboard.up('Alt');
  await idle(page);
  await run(page, 'tool.select-lasso');
  await page.keyboard.down('Shift');
  const pts: [number, number][] = [[0.6 * W, 0.6 * H], [0.9 * W, 0.6 * H], [0.9 * W, 0.9 * H], [0.6 * W, 0.9 * H]];
  const p0 = await at(page, ...pts[0]!);
  await page.mouse.move(...p0);
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(...(await at(page, ...p)), { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await idle(page);
  await run(page, 'tool.select-polygon');
  for (const p of [[0.05 * W, 0.6 * H], [0.2 * W, 0.6 * H], [0.12 * W, 0.9 * H]] as [number, number][]) await page.mouse.click(...(await at(page, ...p)));
  expect(await hook<number>(page, `cb.state().select.poly.points.length`)).toBe(3);
  await page.mouse.click(...(await at(page, 0.05 * W, 0.6 * H))); // the first corner: closes it
  await idle(page);
  await run(page, 'tool.select-wand');
  await page.mouse.click(...(await at(page, 0.95 * W, 0.05 * H)));
  await idle(page);
  expect(await comps()).toEqual(['rect:add', 'ellipse:subtract', 'polygon:add', 'polygon:add', 'wand:add']);
  expect(await tool(page)).toBeNull();
  const n = await steps(page);

  // Select All (Mod+A) with the picture focused; Inverse (Mod+Shift+I); Deselect (Mod+D): one step each
  await page.locator(VP).focus();
  await page.keyboard.press('ControlOrMeta+A');
  await idle(page);
  expect(await comps()).toEqual(['rect:add']);
  await page.keyboard.press('ControlOrMeta+Shift+I');
  await idle(page);
  expect(await hook<boolean>(page, `cb.doc.masks.items[cb.doc.stages.print.stack.items['exposure1'].mask].invert`)).toBe(true);
  await expect.poll(() => lum(page, ...inside)).toBeGreaterThan(li0 + 0.05); // all, inverted: the layer acts nowhere
  await page.keyboard.press('ControlOrMeta+D');
  await idle(page);
  expect(await hook(page, `cb.doc.stages.print.stack.items['exposure1'].mask`)).toBeNull();
  expect(await steps(page)).toBe(n + 3);
  await run(page, 'edit.undo');
  await run(page, 'edit.undo');
  await idle(page);
  expect(await comps()).toEqual(['rect:add']);

  // Use Selection as Mask: a second layer gets a copy of the selection last made
  await run(page, 'select.rect', { x: 0, y: 0, w: W / 2, h: H }, { combine: 'intersect' });
  expect(await run(page, 'layer.add', 'vibrance', 'print')).toBe('vibrance1');
  await run(page, 'select.toLayer');
  await idle(page);
  const m2 = await hook<string>(page, `cb.doc.stages.print.stack.items['vibrance1'].mask`);
  expect(m2).not.toBe(await hook<string>(page, `cb.doc.stages.print.stack.items['exposure1'].mask`));
  expect(await hook<string[]>(page, `cb.doc.masks.items['${m2}'].components.order.map((c) => cb.doc.masks.items['${m2}'].components.items[c].kind)`)).toEqual(['rect', 'rect']);
  expect(errors).toEqual([]);
});
