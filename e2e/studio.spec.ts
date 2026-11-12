// CHB-009 studio flows, ported to the shell-based studio (CHB-019, variant lab, MockEngine): recipes resumed by hash
// after a reload, a folder of scans, the viewer (views, before/after, densitometer and pinned probes), generated
// controls with keyboard bursts and typed units, approvals with E_STALE, the darkroom tools (test strip, ring-around,
// masks and exposures, apply to selection) and the WebGPU presenter pipeline.
// Dropped deliberately in the migration: the OPFS import dialog (folders are read in place) and the
// keyboard-driven probe on the canvas (the probe is the viewer's I tool).
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { opened } from './support.ts';

/** Edit ▸ Undo / Redo from the studio's menu bar (CHB-027: the host's Undo/Redo buttons are gone) */
async function menu(page: Page, title: string, command: string): Promise<void> {
  await page.locator('.ck-menubar-t', { hasText: title }).click();
  await page.locator(`.ck-menu-i[data-command="${command}"]`).click();
}

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

async function boot(page: Page, extra = ''): Promise<void> {
  await page.goto(`/?nosw&engine=mock&variant=lab${extra}`);
  await page.waitForFunction(() => document.body.dataset['ready'] === '1');
}
async function open(page: Page, files: string | { name: string; mimeType: string; buffer: Buffer }[] = FIXTURE): Promise<void> {
  await page.setInputFiles('#file', files);
  await opened(page, Array.isArray(files) ? files.length : 1);
}

let pageErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
});
test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

test('a reload keeps the recipe by hash; opening the file again re-attaches it', async ({ page }) => {
  await boot(page);
  await open(page);
  await expect(page.locator('.ck-side-bottom .ck-thumb[data-rendered]')).toHaveCount(1);
  // keyboard burst on Filtration Y: three steps, one undo unit after the burst pauses
  const y = page.getByRole('slider', { name: 'Filtration Y' });
  await y.focus();
  for (let i = 0; i < 3; i++) await y.press('ArrowRight');
  expect(await units(page)).toBe(0);
  await expect.poll(() => units(page)).toBe(1);
  await expect(y).toHaveAttribute('aria-valuetext', /Y 3 CC/);
  await expect(page.locator('#history')).toContainText('(0, 0, +3) CC');
  const h1 = await hash(page);
  await page.evaluate(() => window.chromobench.studio.flush());

  await boot(page);
  await expect(page.locator('#status')).toContainText('ready');
  await open(page);
  expect(await hash(page)).toBe(h1);
  await expect(page.locator('#history')).toContainText('(0, 0, +3) CC');
});

test('a folder of scans opens every scan in it, the first one selected', async ({ page }) => {
  await boot(page, '&fresh');
  await page.setInputFiles('#folder', FIXTURE_DIR);
  await opened(page);
  const n = await page.evaluate(() => window.chromobench.studio.frames.all().length);
  expect(n).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.chromobench.studio.current)).not.toBeNull();
});

test('viewer: inspection views, before/after, densitometer and pinned probes', async ({ page }) => {
  await boot(page, '&fresh');
  await open(page);
  expect(await page.evaluate(() => window.chromobench.presenter())).toMatch(/webgpu|2d/);
  for (const v of ['Negative', 'Dyes', 'Base & gamut', 'Print']) {
    await page.getByRole('radio', { name: v, exact: true }).click();
    await idle(page);
    await expect(page.getByRole('radio', { name: v, exact: true })).toHaveAttribute('aria-checked', 'true');
  }
  // keys 1–4 switch views on the print module
  await page.locator('.ck-vp').first().click();
  await page.keyboard.press('4');
  await idle(page);
  expect(await page.evaluate(() => window.chromobench.rt.store.peek(['view', 'view']))).toBe('classes');
  await page.keyboard.press('1');

  // before/after: change the print; \ splits the viewer, the left half shows the first print
  await page.evaluate(() => window.chromobench.set('print.lights.logH', [0.2, 0, 0], 'R'));
  await page.keyboard.press('\\');
  await idle(page);
  expect(await page.evaluate(() => window.chromobench.rt.store.peek(['view', 'compare']))).toBe('split');
  await page.keyboard.press('\\');
  await page.keyboard.press('\\');

  // densitometer: the probe tool reads under the pointer; P pins it into the recipe
  await page.evaluate(() => window.chromobench.tool('probe'));
  const box = (await page.locator('.ck-vp').first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('.cb-readout').first()).toContainText('visual D');
  await page.keyboard.press('p');
  await idle(page);
  expect(Object.keys(await page.evaluate(() => window.chromobench.log!.committed.probes))).toEqual(['p1']);
  await expect(page.locator('.cb-visual-d[data-probe="p1"]')).toHaveText(/^\d\.\d\d$/);
});

test('controls: typed units, a burst on Time, why() follows focus, undo and redo', async ({ page }) => {
  await boot(page, '&fresh');
  await open(page);
  const time = page.getByRole('slider', { name: 'Time' });
  await time.focus();
  await time.press('ArrowRight');
  await time.press('ArrowRight');
  await expect.poll(() => units(page)).toBe(1);
  await expect(page.locator('#why')).toContainText('Time');
  const field = page.locator('.cb-arg[data-path="print.enlarger.time_s"] .cb-num').first();
  await field.fill('12');
  await field.press('Enter');
  expect(await page.evaluate(() => window.chromobench.log!.committed.print.enlarger.time_s)).toBe(12);
  await field.fill('+1/3 st');
  await field.press('Enter');
  expect(await page.evaluate(() => window.chromobench.log!.committed.print.enlarger.time_s)).toBeCloseTo(15.119, 2);
  // undo and redo through the bar and the keyboard
  await menu(page, 'Edit', 'edit.undo');
  expect(await page.evaluate(() => window.chromobench.log!.committed.print.enlarger.time_s)).toBe(12);
  await menu(page, 'Edit', 'edit.redo');
  expect(await page.evaluate(() => window.chromobench.log!.committed.print.enlarger.time_s)).toBeCloseTo(15.119, 2);
  await page.locator('.ck-vp').first().click();
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => window.chromobench.log!.committed.print.enlarger.time_s)).toBe(12);
  await page.keyboard.press('Control+Shift+Z');
  expect(await page.evaluate(() => window.chromobench.log!.committed.print.enlarger.time_s)).toBeCloseTo(15.119, 2);
});

test('approvals: reject, approve all, and E_STALE with apply anyway', async ({ page }) => {
  await boot(page, '&fresh');
  await open(page);
  await page.evaluate(() => window.chromobench.propose({ 'print.grade': 3 }, 'more contrast'));
  await expect(page.locator('#pending li')).toHaveCount(1);
  await expect(page.locator('#pending li')).toContainText('Grade 2.0 → 3.0');
  await page.locator('#pending .reject').click();
  await expect(page.locator('#pending li')).toHaveCount(0);
  await expect(page.locator('#history')).toContainText('rejected');

  await page.evaluate(() => window.chromobench.propose({ 'print.enlarger.time_s': 12 }, 'longer'));
  await page.evaluate(() => window.chromobench.set('print.enlarger.time_s', 11, 'Time'));
  await page.locator('#pending .approve').click();
  await expect(page.locator('#pending li')).toContainText('E_STALE');
  await page.locator('#pending .force').click();
  await expect(page.locator('#pending li')).toHaveCount(0);
  expect(await page.evaluate(() => window.chromobench.log!.committed.print.enlarger.time_s)).toBe(12);

  await page.evaluate(() => { window.chromobench.propose({ 'print.grade': 3 }); window.chromobench.propose({ 'print.preflash': 0.01 }); });
  await page.getByRole('button', { name: 'Approve all' }).click();
  await expect(page.locator('#pending li')).toHaveCount(0);
});

test('tools: test strip band, ring-around tile, masks and exposures, apply to selection', async ({ page }) => {
  await boot(page, '&fresh');
  await open(page, [variant(0), variant(1), variant(2)]);
  await page.evaluate(() => window.chromobench.set('print.enlarger.time_s', 12, 'Time'));

  // test strip: 1/3-stop bands around 12.0 s; clicking 15.12 s writes one set
  await page.locator('.ck-vp').first().click();
  await page.keyboard.press('t');
  await idle(page);
  await expect(page.locator('.cb-band text')).toHaveText(['7.56 s', '9.52 s', '12.0 s', '15.12 s', '19.05 s']);
  const u0 = await page.evaluate(() => window.chromobench.log!.units.length);
  const band = (await page.locator('.cb-band rect').nth(3).boundingBox())!;
  await page.mouse.click(band.x + band.width / 2, band.y + band.height / 2);
  await idle(page);
  expect(await page.evaluate(() => window.chromobench.log!.units.length)).toBe(u0 + 1);
  expect(await page.evaluate(() => window.chromobench.log!.committed.print.enlarger.time_s)).toBeCloseTo(15.12, 2);

  // ring-around: "+G (−M)" writes (+2, −4, +2) pt
  await page.keyboard.press('r');
  await expect(page.locator('.cb-ring-tile')).toHaveCount(11);
  await page.locator('.cb-ring-tile').filter({ hasText: '+G' }).getByRole('button').click();
  const lights = await page.evaluate(() => window.chromobench.log!.committed.print.lights.logH);
  [0.05, -0.1, 0.05].forEach((v, i) => expect(lights[i]).toBeCloseTo(v, 9));
  await expect(page.locator('#history')).toContainText('(+2, −4, +2) pt');

  // masks: drag an ellipse → mask.set plus a burn through it; a dodge from the exposure list
  await page.evaluate(() => window.chromobench.tool('mask-ellipse'));
  const box = (await page.locator('.ck-vp').first().boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.55, { steps: 5 });
  await page.mouse.up();
  await idle(page);
  const masks = await page.evaluate(() => Object.values(window.chromobench.log!.committed.masks).flatMap((m) => m.nodes.map((n) => n.op)));
  expect(masks).toContain('mask.ellipse');
  await page.getByRole('button', { name: '+ dodge' }).click();
  await idle(page);
  expect(await page.evaluate(() => window.chromobench.log!.committed.print.exposures.map((e) => e.kind))).toContain('dodge');
  await expect(page.locator('.cb-script')).not.toBeEmpty();
  await page.evaluate(() => window.chromobench.tool(null));

  // apply to selection: the current print settings to the two other frames, one undo step
  await page.evaluate(() => {
    const cb = window.chromobench;
    const ids = cb.studio.frames.ids();
    const primary = cb.studio.current!;
    cb.rt.ctx().set({ ui: { selection: { ids, primary, anchor: primary } } });
    cb.run('print.applyToSelection');
  });
  await idle(page);
  const others = await page.evaluate(() => {
    const cb = window.chromobench;
    return cb.studio.frames.all().filter((e) => e.id !== cb.studio.current).map((e) => e.log.committed.print.enlarger.time_s);
  });
  expect(others).toHaveLength(2);
  for (const t of others) expect(t).toBeCloseTo(15.12, 2);
});

test('WebGPU presenter pipeline (offscreen, Display P3): exact pixels', async ({ page }) => {
  await boot(page, '&fresh');
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
