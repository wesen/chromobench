// The mask overlay (CHB-039) in the real studio on the WebGPU engine (SwiftShader in CI), on a synthetic negative
// (e2e/scenes.ts): a print layer through a linear mask that covers the lower part of the picture.
//   - O shows a red tint where the mask covers and none elsewhere (the cover canvas, and the viewer as composed);
//   - the mask-only view's grey values are the engine's coverage node at the viewer's resolution;
//   - the overlay shows by itself while a mask setting is dragged and follows the drag; it goes on release.
import { expect, test, type Page } from '@playwright/test';
import { negativeScan, tif } from './scenes.ts';
import { opened } from './support.ts';

// OVERLAY_W: a larger scene for timings (e.g. OVERLAY_W=3000 REAL_GPU=1)
const W = Number(process.env['OVERLAY_W'] ?? 480), H = Math.round((W * 2) / 3);
const VP = '.ck-vp[data-viewport="edit"]';
/** OVERLAY_SHOTS=<dir>: screenshots of the tint and the mask-only view (synthetic scene) */
const shot = (page: Page, name: string) => (process.env['OVERLAY_SHOTS'] ? page.screenshot({ path: `${process.env['OVERLAY_SHOTS']}/${name}.png` }) : Promise.resolve());
const idle = (page: Page) => page.evaluate(() => window.chromobench.idle());
const run = (page: Page, cmd: string, ...a: unknown[]) => page.evaluate(([c, x]) => window.chromobench.run(c as string, ...(x as unknown[])), [cmd, a] as const);

/** RGBA of the cover canvas at document pixels (the shown picture's pixels), read through the viewport's transform */
const coverAt = (page: Page, pts: [number, number][]) =>
  page.evaluate(([sel, p]) => {
    const el = document.querySelector(sel) as HTMLElement;
    const api = window.chromobench.rt.viewports.get('edit') as unknown as { docToScreen(x: number, y: number): [number, number] };
    const cv = el.querySelector('canvas.ck-vp-cover') as HTMLCanvasElement;
    const g = cv.getContext('2d')!;
    const k = cv.width / el.getBoundingClientRect().width;
    return (p as [number, number][]).map(([x, y]) => {
      const [sx, sy] = api.docToScreen(x, y);
      return Array.from(g.getImageData(Math.floor(sx * k), Math.floor(sy * k), 1, 1).data);
    });
  }, [VP, pts] as const);

/** what the viewer shows composed (the presenter's canvas under the cover's), from a screenshot, at document pixels */
async function composedAt(page: Page, pts: [number, number][]): Promise<number[][]> {
  const box = (await page.locator(VP).boundingBox())!;
  const png = await page.locator(VP).screenshot();
  const at = await page.evaluate(([p]) => {
    const api = window.chromobench.rt.viewports.get('edit') as unknown as { docToScreen(x: number, y: number): [number, number] };
    return (p as [number, number][]).map(([x, y]) => api.docToScreen(x, y));
  }, [pts] as const);
  return page.evaluate(async ([b64, xy, w]) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const k = img.width / (w as number);
    return (xy as [number, number][]).map(([x, y]) => Array.from(g.getImageData(Math.floor(x * k), Math.floor(y * k), 1, 1).data).slice(0, 3));
  }, [png.toString('base64'), at, box.width] as const);
}

test('mask overlay on the GPU engine: tint where the mask covers, the engine\'s mask alone, it follows a drag', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?nosw&canvas2d&fresh&engine=gpu&layout=classic');
  await page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: 60_000 });
  expect(await page.evaluate(() => window.chromobench.engineLabel)).toMatch(/GPU|graphics|WebGPU/i);
  await page.setInputFiles('#file', tif('scene.tif', negativeScan(W, H)));
  await opened(page, 1, 120_000);
  await page.locator('.ck-module[data-module="edit"]').click();
  await expect(page.locator(VP)).toHaveAttribute('data-rendered', /\d+x\d+/);

  // a print layer through a linear mask: full below y = 0.6 H, none above y = 0.4 H
  expect(await run(page, 'layer.add', 'exposure', 'print')).toBe('exposure1');
  expect(await run(page, 'mask.new', 'linear')).toBe('m1');
  await run(page, 'mask.set', 'm1c1.params.from', { x: 0, y: 0.6 * H }, 'Gradient');
  await run(page, 'mask.set', 'm1c1.params.to', { x: 0, y: 0.4 * H }, 'Gradient');
  await page.evaluate(() => window.chromobench.set('exposure1.params.stops', 1, 'Exposure'));
  await idle(page);
  await expect(page.locator(`${VP} canvas.ck-vp-cover`)).toBeHidden();
  const above: [number, number][] = [[0.5 * W, 0.15 * H], [0.8 * W, 0.3 * H]];
  const below: [number, number][] = [[0.5 * W, 0.85 * H], [0.15 * W, 0.7 * H]];
  const before = await composedAt(page, [...above, ...below]);

  // O on the picture: the overlay
  await page.locator(VP).focus();
  await page.keyboard.press('o');
  await expect(page.locator(VP)).toHaveAttribute('data-cover', /\d+x\d+/);
  await idle(page);
  await expect(page.locator(`${VP} canvas.ck-vp-cover`)).toBeVisible();
  expect(await page.evaluate(() => (window.chromobench.state() as { stack: { overlay: { on: boolean } } }).stack.overlay.on)).toBe(true);
  const cov = await coverAt(page, [...above, ...below]);
  for (const c of cov.slice(0, 2)) expect(c[3]).toBe(0); // no tint where the mask does not act
  for (const c of cov.slice(2)) expect(c).toEqual([255, 0, 0, 128]); // red at 50 % where it does
  const after = await composedAt(page, [...above, ...below]);
  await shot(page, '01-tint');
  for (let i = 0; i < 2; i++) for (let k = 0; k < 3; k++) expect(Math.abs(after[i]![k]! - before[i]![k]!)).toBeLessThanOrEqual(2);
  for (let i = 2; i < 4; i++) {
    // composed: half way to red
    expect(Math.abs(after[i]![0]! - Math.round(before[i]![0]! / 2 + 127.5))).toBeLessThanOrEqual(3);
    expect(Math.abs(after[i]![1]! - Math.round(before[i]![1]! / 2))).toBeLessThanOrEqual(3);
  }

  // inverse: the tint moves to where the mask does not act
  await run(page, 'mask.overlay.mode', 'inverse');
  await expect.poll(async () => (await coverAt(page, [...above, ...below])).map((c) => c[3])).toEqual([128, 128, 0, 0]);

  // the mask alone: grey values are the engine's coverage node, evaluated at the viewer's resolution
  await run(page, 'mask.overlay.mode', 'mask');
  await idle(page);
  const cmp = await page.evaluate(async () => {
    const cb = window.chromobench;
    const vp = cb.rt.viewports.get('edit') as unknown as { cover(): { image: { width: number; height: number; scale: number; region: { x: number; y: number; w: number; h: number }; data: Float32Array; channels: number } | null } };
    const img = vp.cover().image!;
    const f = cb.studio.frames.all()[0]!.id;
    const h = { $: 'cb.image', frame: f, doc: cb.doc, what: 'mask', args: { entry: 'exposure1' }, expr: '' };
    const node = cb.studio.bridge.lower(h as never).named;
    const r = await cb.engine.evaluate(node, { scale: img.scale >= 1 ? 'full' : img.scale, precision: 'preview', region: img.region });
    const ref = await r.read();
    let max = 0, lo = Infinity, hi = -Infinity;
    for (let i = 0; i < img.width * img.height; i++) {
      const v = img.data[i * img.channels]!;
      max = Math.max(max, Math.abs(v - ref[i * r.info.channels]!));
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    return { op: node.op, w: img.width, h: img.height, rw: r.width, rh: r.height, channels: img.channels, max, lo, hi };
  });
  expect(cmp).toMatchObject({ op: 'mask.linear', channels: 1, rw: cmp.w, rh: cmp.h });
  expect(cmp.max).toBeLessThan(1e-6);
  expect(cmp.lo).toBe(0);
  expect(cmp.hi).toBe(1);
  await expect.poll(async () => (await coverAt(page, above))[0]![3]).toBe(255);
  const grey = await coverAt(page, [...above, ...below, [0.5 * W, 0.5 * H]]);
  await shot(page, '02-mask-only');
  for (const c of grey.slice(0, 2)) expect(c).toEqual([0, 0, 0, 255]);
  for (const c of grey.slice(2, 4)) expect(c).toEqual([255, 255, 255, 255]);
  expect(grey[4]![0]).toBeGreaterThan(100); // the gradient's middle
  expect(grey[4]![0]).toBeLessThan(155);

  // off (O again); then a drag of the component's amount shows it by itself and it follows the drag
  await run(page, 'mask.overlay.mode', 'tint');
  await page.locator(VP).focus();
  await page.keyboard.press('o');
  await expect(page.locator(`${VP} canvas.ck-vp-cover`)).toBeHidden();
  const timings = await page.evaluate(() => {
    const w = window as unknown as { coverMs: number[]; printMs: number[] };
    w.coverMs = [];
    w.printMs = [];
    window.chromobench.rt.on('rendered', (e: { cover?: boolean; ms: number; w: number; h: number }) => void (e.cover ? w.coverMs : w.printMs).push(e.ms));
    return true;
  });
  expect(timings).toBe(true);
  const range = page.locator('.ck-panel[data-panel="layer-masks-edit"] .cb-stack-comp[data-id="m1c1"] .cb-stack-num[data-path="m1c1.amount"] input.cb-range');
  await range.scrollIntoViewIfNeeded();
  const rb = (await range.boundingBox())!;
  await page.mouse.move(rb.x + rb.width - 3, rb.y + rb.height / 2);
  await page.mouse.down();
  const seen: number[] = [];
  for (const f of [0.8, 0.6, 0.45]) {
    await page.mouse.move(rb.x + rb.width * f, rb.y + rb.height / 2, { steps: 3 });
    // while the hand is down: the overlay shows, at the amount the drag has reached
    await page.waitForFunction(([sel, at]) => {
      const api = window.chromobench.rt.viewports.get('edit') as unknown as { cover(): { image: { data: Float32Array; width: number; scale: number; region: { x: number; y: number } } | null } };
      const im = api.cover().image;
      const v = (window.chromobench.state() as { docs: Record<string, { masks: { items: Record<string, { components: { items: Record<string, { amount: number }> } }> } }> }).docs;
      const amount = Object.values(v)[0]!.masks.items['m1']!.components.items['m1c1']!.amount;
      if (!im || !document.querySelector(`${sel} canvas.ck-vp-cover:not([hidden])`)) return false;
      const ix = Math.floor((at[0]! - im.region.x) * im.scale), iy = Math.floor((at[1]! - im.region.y) * im.scale);
      return Math.abs(im.data[iy * im.width + ix]! - amount) < 0.02 && amount < 0.99;
    }, [VP, below[0]!] as const, { timeout: 20_000 });
    seen.push(await page.evaluate(() => Object.values((window.chromobench.state() as { docs: Record<string, { masks: { items: Record<string, { components: { items: Record<string, { amount: number }> } }> } }> }).docs)[0]!.masks.items['m1']!.components.items['m1c1']!.amount));
  }
  expect(new Set(seen).size).toBe(3);
  expect(await page.evaluate(() => (window.chromobench.state() as { stack: { overlay: { live: boolean } } }).stack.overlay.live)).toBe(true);
  await page.mouse.up();
  await idle(page);
  await expect(page.locator(`${VP} canvas.ck-vp-cover`)).toBeHidden();
  const { coverMs: ms, printMs } = await page.evaluate(() => {
    const w = window as unknown as { coverMs: number[]; printMs: number[] };
    return { coverMs: w.coverMs, printMs: w.printMs };
  });
  expect(ms.length).toBeGreaterThan(0);
  const engine = await page.evaluate(() => window.chromobench.engineLabel);
  console.log(`${engine}: cover renders during the drag ${ms.length}, ms ${ms.map((x) => x.toFixed(1)).join(' ')}; picture renders ${printMs.length}, ms ${printMs.map((x) => x.toFixed(1)).join(' ')}`);
  expect(errors).toEqual([]);
});
