// CHB-009 studio flows on the mock engine: library and persistence by hash, the import fallback
// and offline start, the viewer (views, before/after, probe), generated controls with keyboard
// bursts, approvals with E_STALE, the darkroom tools, and the WebGPU presenter pipeline.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const FIXTURE = new URL('../fixtures/synthetic/m1-negative-96x64.tif', import.meta.url).pathname;
const FIXTURE_DIR = new URL('../fixtures/synthetic/', import.meta.url).pathname;
const bytes = readFileSync(FIXTURE);
/** A second frame: the fixture with one sample changed (another hash, same decoder path). */
const variant = (n: number): { name: string; mimeType: string; buffer: Buffer } => {
  const b = Buffer.from(bytes);
  b[b.length - 2] = (b[b.length - 2]! + n) & 0xff;
  return { name: `frame-${n}.tif`, mimeType: 'image/tiff', buffer: b };
};

const idle = (page: Page) => page.evaluate(() => window.chromobench.idle());
const hash = (page: Page) => page.evaluate(() => window.chromobench.log!.stateHash);
const units = (page: Page) => page.evaluate(() => window.chromobench.log!.units.length);

async function open(page: Page, files: string | { name: string; mimeType: string; buffer: Buffer }[] = FIXTURE): Promise<void> {
  await page.setInputFiles('#file', files);
  await expect(page.locator('#status')).toContainText('rendered');
  await idle(page);
}

let pageErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
});
test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

test('library: a reload keeps the recipe by hash; re-picking re-attaches it', async ({ page }) => {
  await page.goto('/?nosw');
  await open(page);
  await expect(page.locator('.strip .cell')).toHaveCount(1);
  // keyboard burst on Filtration Y: three steps, one undo unit after the burst pauses
  const y = page.getByRole('slider', { name: 'Filtration Y' });
  await y.focus();
  for (let i = 0; i < 3; i++) await y.press('ArrowRight');
  expect(await units(page)).toBe(0);
  await expect.poll(() => units(page)).toBe(1);
  await expect(y).toHaveAttribute('aria-valuetext', 'Filtration Y 3 CC');
  await expect(page.locator('#history')).toContainText('Filtration (0, 0, 0) → (0, 0, 3) CC');
  await expect(page.locator('.strip .cell .badges')).toContainText('●');
  const h1 = await hash(page);

  await page.reload();
  await expect(page.locator('[data-roll]')).toHaveCount(1);
  await expect(page.locator('[data-roll]')).toContainText('disconnected');
  await open(page);
  expect(await hash(page)).toBe(h1);
  await expect(page.locator('#history')).toContainText('(0, 0, 3) CC');
});

test('import fallback into OPFS, then an offline start opens the imported frame', async ({ page, context }) => {
  await page.goto('/');
  await page.setInputFiles('#folder', FIXTURE_DIR);
  await expect(page.getByRole('dialog', { name: 'Use or import' })).toContainText('1 scans');
  await page.click('#import');
  await expect(page.locator('#status')).toContainText('rendered');
  await expect(page.locator('#storage-usage')).toContainText('imported');
  await expect(page.locator('#offline-state')).toHaveText('offline ready', { timeout: 20_000 });
  // let the service worker see every module once while online
  await page.reload();
  await expect(page.locator('#offline-state')).toHaveText('offline ready');
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('[data-roll]')).toContainText('import');
  await page.locator('.strip .cell').first().click();
  await expect(page.locator('#status')).toContainText('rendered');
  await context.setOffline(false);
});

test('viewer: inspection views, before/after, densitometer and pinned probes', async ({ page }) => {
  await page.goto('/?nosw');
  await open(page);
  await page.locator('#view').focus();
  const presenter = await page.evaluate(() => window.chromobench.studio.s.presenter);
  expect(presenter).toMatch(/webgpu|2d/);
  for (const v of ['Negative', 'Dyes', 'Base & gamut', 'Print']) {
    await page.getByRole('radio', { name: v, exact: true }).click();
    await idle(page);
    await expect(page.getByRole('radio', { name: v, exact: true })).toHaveAttribute('aria-checked', 'true');
  }
  await page.keyboard.press('4');
  await idle(page);
  await expect(page.locator('#classes')).toContainText('out of gamut');
  await page.keyboard.press('1');

  // before/after: change the print, the left half shows the initial recipe
  await page.evaluate(() => window.chromobench.studio.gesture.set('print.lights.logH', [0.2, 0, 0], 'R'));
  await page.click('#before-after');
  await idle(page);
  const split = await page.evaluate(() => ({ s: window.chromobench.studio.s.split, before: window.chromobench.studio.last !== null }));
  expect(split.s).toBe(0.5);

  // densitometer: keyboard-driven probe on the focused canvas, then pin it
  await page.locator('#view').focus();
  await page.keyboard.press('ArrowRight');
  await idle(page);
  await expect(page.locator('#readout')).toContainText('visual D');
  await page.keyboard.press('p');
  await idle(page);
  await expect(page.locator('[data-probe="p1"]')).toBeVisible();
  expect(await page.evaluate(() => window.chromobench.log!.committed.probes['p1'])).toEqual({ x: 49, y: 32, r: 3 });
});

test('controls: Home resets, Esc cancels a drag, aperture steps in thirds; why() follows focus', async ({ page }) => {
  await page.goto('/?nosw');
  await open(page);
  const time = page.getByRole('slider', { name: 'Time' });
  await time.focus();
  await time.press('ArrowRight');
  await time.press('ArrowRight');
  await expect.poll(() => units(page)).toBe(1);
  await expect(page.locator('[data-path="print.enlarger.time_s"] .aside')).toHaveText('+1/3 st');
  await expect(page.locator('#why')).toContainText('Why is Time 12.6 s?');
  await time.press('Home');
  await expect.poll(() => units(page)).toBe(2);
  expect(await page.evaluate(() => window.chromobench.log!.committed.print.enlarger.time_s)).toBe(10);
  // a drag cancelled with Esc logs nothing
  const grade = page.getByRole('slider', { name: 'Grade' });
  await grade.evaluate((el: HTMLInputElement) => { el.value = '3'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(await page.evaluate(() => window.chromobench.log!.state.print.grade)).toBe(3);
  await grade.press('Escape');
  expect(await page.evaluate(() => window.chromobench.log!.state.print.grade)).toBe(2);
  expect(await units(page)).toBe(2);
  // aperture stepper: third stops
  await page.getByRole('button', { name: 'Aperture one third stop smaller' }).click();
  expect(await page.evaluate(() => window.chromobench.log!.committed.print.enlarger.fstop)).toBe(9);
  // undo and redo through the bar
  await page.click('#undo');
  expect(await page.evaluate(() => window.chromobench.log!.committed.print.enlarger.fstop)).toBe(8);
  await page.keyboard.press('Control+Shift+Z');
  expect(await page.evaluate(() => window.chromobench.log!.committed.print.enlarger.fstop)).toBe(9);
});

test('approvals: reject, approve all, and E_STALE with apply anyway', async ({ page }) => {
  await page.goto('/?nosw');
  await open(page);
  await page.evaluate(() => window.chromobench.propose({ 'print.grade': 3 }, 'more contrast'));
  await expect(page.locator('#pending li')).toHaveCount(1);
  await expect(page.locator('#pending li')).toContainText('Grade 2.0 → 3.0');
  await page.locator('#pending .reject').click();
  await expect(page.locator('#pending li')).toHaveCount(0);
  await expect(page.locator('#history')).toContainText('rejected');

  await page.evaluate(() => window.chromobench.propose({ 'print.enlarger.time_s': 12 }, 'longer'));
  await page.evaluate(() => window.chromobench.studio.gesture.set('print.enlarger.time_s', 11, 'Time'));
  await page.locator('#pending .approve').click();
  await expect(page.locator('#pending li')).toContainText('E_STALE');
  await page.locator('#pending .force').click();
  await expect(page.locator('#pending li')).toHaveCount(0);
  expect(await page.evaluate(() => window.chromobench.log!.committed.print.enlarger.time_s)).toBe(12);

  await page.evaluate(() => { window.chromobench.propose({ 'print.grade': 3 }); window.chromobench.propose({ 'print.preflash': 0.01 }); });
  await page.getByRole('button', { name: 'Approve all' }).click();
  await expect(page.locator('#pending li')).toHaveCount(0);
  await expect(page.locator('.strip .badges .pend')).toHaveCount(0);
});

test('tools: test strip band, ring-around tile, masks and exposures, contact sheet', async ({ page }) => {
  await page.goto('/?nosw');
  await open(page, [variant(0), variant(1), variant(2)]);
  await page.evaluate(() => window.chromobench.studio.gesture.set('print.enlarger.time_s', 12, 'Time'));

  // test strip: 1/3-stop bands around 12.0 s; clicking 15.12 s writes one set
  await page.locator('#view').focus();
  await page.keyboard.press('t');
  await idle(page);
  const bands = page.locator('.bands .band b');
  await expect(bands).toHaveText(['7.56 s', '9.52 s', '12.0 s', '15.12 s', '19.05 s']);
  const u0 = await units(page);
  await page.locator('.bands .band').nth(3).click();
  expect(await units(page)).toBe(u0 + 1);
  expect(await page.evaluate(() => window.chromobench.log!.committed.print.enlarger.time_s)).toBeCloseTo(15.12, 2);

  // ring-around: the centre tile is the main view's node; "+G (−M)" writes (+2, −4, +2) pt
  await page.keyboard.press('r');
  await idle(page);
  const main = await page.evaluate(() => window.chromobench.studio.session!.displayNode().id);
  await expect(page.locator('[data-tile="current"]')).toHaveAttribute('data-node', main);
  await page.locator('[data-tile="G"]').click();
  const lights = await page.evaluate(() => window.chromobench.log!.committed.print.lights.logH);
  [0.05, -0.1, 0.05].forEach((v, i) => expect(lights[i]).toBeCloseTo(v, 9));
  await expect(page.locator('#history')).toContainText('(+2, −4, +2) pt');

  // masks: drag an ellipse → one mask.set; then a dodge through it in the exposure list
  await page.keyboard.press('m');
  const box = (await page.locator('#mask-overlay').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.55, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('#mask-summary')).toContainText('1 shape in mask1: ellipse');
  const mask = await page.evaluate(() => window.chromobench.log!.committed.masks['mask1']!.nodes.at(-1)!.op);
  expect(mask).toBe('mask.ellipse');
  await page.getByRole('button', { name: 'Exposures' }).click();
  await page.getByRole('button', { name: '+ dodge' }).click();
  await expect(page.locator('[data-exposure="dodge1"]')).toContainText('−1/4 st');
  await expect(page.locator('#printing-script')).toContainText('hold back mask1 for 2.41 s');
  await idle(page);
  await expect(page.locator('#status')).not.toContainText('E_');

  // contact sheet: apply the current settings to the two other frames, one tx shared
  await page.getByRole('button', { name: 'Contact sheet' }).click();
  await page.getByRole('checkbox', { name: 'Select frame-1.tif' }).check();
  await page.getByRole('checkbox', { name: 'Select frame-2.tif' }).check();
  await page.click('#apply-selected');
  await expect(page.locator('#status')).toContainText('applied to 2 frames');
  await page.keyboard.press('Escape');
  await page.locator('.strip [data-frame="frame-2.tif"]').click();
  await idle(page);
  const r2 = await page.evaluate(() => ({ t: window.chromobench.log!.committed.print.enlarger.time_s, tx: window.chromobench.log!.units[0]!.tx }));
  expect(r2.t).toBeCloseTo(15.12, 2);
  expect(r2.tx).toMatch(/^sheet-/);
});

test('WebGPU presenter pipeline (offscreen, Display P3): exact pixels', async ({ page }) => {
  await page.goto('/?nosw');
  const r = await page.evaluate(async () => {
    const { WebGpuPresenter } = await import('/src/present/presenter-webgpu.ts' as string);
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 32;
    const p = await WebGpuPresenter.create(c, { offscreen: true });
    if (!p) return null;
    const mk = (v: number[]) => ({ width: 4, height: 2, channels: 3, data: new Float64Array(Array.from({ length: 8 }, (_, i) => [v[0]! + i / 255, v[1]!, v[2]!]).flat()), region: { x: 0, y: 0, w: 4, h: 2 }, scale: 1 });
    p.setImages(mk([0.3703, 0.4340, 0.5484]), mk([0.1, 0.2, 0.3]));
    p.draw({ docW: 4, docH: 2, cx: 2, cy: 1, zoom: 8, dpr: 1, split: null }, { stage: [1, 1, 1], frame: [0, 0, 0] });
    return { colorSpace: p.colorSpace, px0: await p.readDocPixel(0, 0), px5: await p.readDocPixel(1, 1) };
  });
  test.skip(r === null, 'no WebGPU adapter');
  expect(r!.colorSpace).toBe('display-p3');
  expect(r!.px0).toEqual([94, 111, 140]); // round(0.3703·255), round(0.4340·255), round(0.5484·255)
  expect(r!.px5).toEqual([99, 111, 140]); // pixel index 5 adds 5/255 to red
});
