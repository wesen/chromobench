// CHB-023: the studio on the real engines (GpuEngine on SwiftShader, RefEngine), smoke-tested with the M1 fixture
// on the default variant (classic) since the CHB-019 migration: boot and engine label, the automatic first print,
// enlarger controls that change the print, the four views, the densitometer, the test strip and ring-around on the
// real chain, undo, export (CHB-011's encoders), the bench hook, and the offline start.
// Canvas2D presentation (?canvas2d): presenting a WebGPU canvas loses the device on SwiftShader.
import { expect, test, type Page } from '@playwright/test';
import { opened } from './support.ts';

/** Edit ▸ Undo / Redo from the studio's menu bar (CHB-027: the host's Undo/Redo buttons are gone) */
async function menu(page: Page, title: string, command: string): Promise<void> {
  await page.locator('.ck-menubar-t', { hasText: title }).click();
  await page.locator(`.ck-menu-i[data-command="${command}"]`).click();
}

const FIXTURE = new URL('../fixtures/synthetic/m1-negative-96x64.tif', import.meta.url).pathname;

const idle = (page: Page) => page.evaluate(() => window.chromobench.idle());
const centre = (page: Page) => page.evaluate(() => window.chromobench.pixel(48, 32));

let pageErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|\[vite\]/.test(m.text())) console.log(`[console] ${m.text()}`); });
});
test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

async function open(page: Page, engine: string): Promise<void> {
  await page.goto(`/?nosw&canvas2d&fresh&engine=${engine}`);
  await page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: 60_000 });
  await page.setInputFiles('#file', FIXTURE);
  await opened(page, 1, 60_000);
}

for (const engine of ['gpu', 'reference'] as const) {
  test(`${engine}: first print, enlarger controls, views, probe, strip, ring-around, undo, export`, async ({ page }) => {
    test.setTimeout(240_000);
    await open(page, engine);
    await expect(page.locator('#engine')).toHaveAttribute('data-engine', engine === 'gpu' ? /GPU/ : /reference/);
    expect(await page.evaluate(() => window.chromobench.variant)).toBe('classic');
    // the first print: enlarger in 'real' mode, integrated to grey (recorded in print.lights.auto)
    const r0 = await page.evaluate(() => window.chromobench.log!.state.print);
    expect(r0.enlarger.mode).toBe('real');
    expect(r0.lights.auto.method).toBe('integrate');
    expect(r0.lights.auto.applied).toBe(true);
    const p0 = (await centre(page))!;
    expect(p0.every((v) => v >= 0 && v <= 1)).toBe(true);

    // a longer time prints darker
    await page.evaluate(() => window.chromobench.set('print.enlarger.time_s', window.chromobench.log!.state.print.enlarger.time_s * 2, 'time +1 st'));
    await idle(page);
    const p1 = (await centre(page))!;
    expect(p1[1]!).toBeLessThan(p0[1]!);
    // undo restores the picture exactly
    await menu(page, 'Edit', 'edit.undo');
    await idle(page);
    expect(await centre(page)).toEqual(p0);

    // views: negative, dyes, base & gamut render; back to print
    for (const v of ['Negative', 'No mask', 'Clipping', 'Print']) {
      const before = await page.locator('.ck-vp').first().getAttribute('data-rendered');
      await page.getByRole('radio', { name: v, exact: true }).click();
      await idle(page);
      await expect(page.getByRole('radio', { name: v, exact: true })).toHaveAttribute('aria-checked', 'true');
      void before;
      await expect(page.locator('#status')).not.toContainText('E_');
    }

    // densitometer: the probe tool's readout over the print, and the panel
    const m = await page.evaluate(() => window.chromobench.measure(48, 32));
    expect(m!.visual).toBeGreaterThan(0);
    await page.evaluate(() => window.chromobench.tool('probe'));
    const vp = page.locator('.ck-vp').first();
    const box = (await vp.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('.cb-readout').first()).toContainText(/visual D \d\.\d\d/, { timeout: 30_000 });
    await expect(page.locator('.cb-visual-d').first()).toHaveText(/^\d\.\d\d$/, { timeout: 30_000 });
    await page.evaluate(() => window.chromobench.tool(null));

    // test strip: five bands of the real chain, each strip printed with its own time; clicking the last band
    // (+2/3 st) makes the print equal to that band where the band lay
    const t0 = r0.enlarger.time_s;
    await page.evaluate(() => window.chromobench.tool('test-strip'));
    await idle(page);
    await expect(page.locator('.cb-band')).toHaveCount(5);
    const values = await page.locator('.cb-band').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-value'))));
    expect(values[4]!).toBeCloseTo(t0 * 2 ** (2 / 3), 2);
    await expect(page.locator('.cb-band').nth(4)).toContainText(' s');
    const inBand = await page.evaluate(() => window.chromobench.pixel(88, 32));
    const band = (await page.locator('.cb-band rect').nth(4).boundingBox())!;
    await page.mouse.click(band.x + band.width / 2, band.y + band.height / 2);
    await idle(page);
    expect(await page.evaluate(() => window.chromobench.rt.store.peek(['ui', 'tool']))).toBeNull();
    expect(await page.evaluate(() => window.chromobench.log!.state.print.enlarger.time_s)).toBeCloseTo(values[4]!, 3);
    expect(await page.evaluate(() => window.chromobench.pixel(88, 32))).toEqual(inBand);
    const darker = (await centre(page))!;
    expect(darker[1]!).toBeLessThan(p0[1]!);

    // ring-around: eleven tiles of the real chain; the centre tile is the main print's node; +Y raises blue light
    await page.evaluate(() => window.chromobench.tool('ring-around'));
    await expect(page.locator('.cb-ring-tile')).toHaveCount(11);
    await expect(page.locator('.cb-ring-tile .ck-thumb[data-rendered]')).toHaveCount(11, { timeout: 120_000 });
    expect(await page.evaluate(() => {
      const cb = window.chromobench;
      const f = cb.studio.current!;
      return cb.studio.bridge.key({ $: 'cb.image', frame: f, recipe: cb.rt.store.peek(['recipes', f]), what: 'ringTile', args: { offset: [0, 0, 0] }, expr: '' } as never) === cb.printNode();
    })).toBe(true);
    const lb = await page.evaluate(() => window.chromobench.log!.state.print.lights.logH[2]);
    await page.locator('.cb-ring-tile').filter({ hasText: '+Y' }).getByRole('button').click();
    expect(await page.evaluate(() => window.chromobench.log!.state.print.lights.logH[2])).toBeGreaterThan(lb);
    await menu(page, 'Edit', 'edit.undo');
    await idle(page);

    // export through packages/output: an 8-bit PNG and a 16-bit TIFF at the working size
    const x = await page.evaluate(() => window.chromobench.exportPng('srgb'));
    expect(x).toMatchObject({ width: 96, height: 64, type: 'image/png', bits: 8 });
    expect(x!.bytes).toBeGreaterThan(100);
    const t = await page.evaluate(() => window.chromobench.exportPng('display-p3', 'tiff16'));
    expect(t).toMatchObject({ width: 96, height: 64, type: 'image/tiff', bits: 16 });
    await expect(page.locator('#status')).toContainText('exported');

    // the frame-time benchmark for a real GPU runs here too (numbers are SwiftShader's / the CPU's)
    const b = await page.evaluate(() => window.chromobench.bench(4));
    console.log(`bench ${engine}: ${JSON.stringify(b)}`);
    expect(b).toMatchObject({ frame: '96×64', exported: '96×64' });
  });
}

// CHB-020 follow-up: the Roll module of the default (classic) variant on the real reference engine: the host's
// roll physics, a new roll with its automatic first print, the roll badge on the film strip, and the first print
// of the roll as one card with before/after thumbnails, rejected.
test('classic variant: the Roll module makes a roll, badges the strip and shows the first-print card with thumbnails', async ({ page }) => {
  test.setTimeout(240_000);
  await open(page, 'reference');
  expect(await page.evaluate(() => window.chromobench.variant)).toBe('classic');
  await page.evaluate(() => window.chromobench.rt.go('roll'));
  await expect(page.locator('#roll-new')).toBeVisible();
  await page.locator('#roll-new').click();
  await expect(page.locator('#rolls li')).toContainText('first-printed', { timeout: 120_000 });
  // the recipe names the roll
  expect(await page.evaluate(() => window.chromobench.log!.state.roll)).toEqual({ id: 'roll-1' });
  // the film strip's roll badge (the Library module shows the strip)
  await page.evaluate(() => window.chromobench.rt.go('library'));
  await expect(page.locator('.ck-thumb-badge').filter({ hasText: 'roll 1' }).first()).toBeVisible();
  // First print of the roll: one card, before and after thumbnails, reject leaves the frame alone
  await page.evaluate(() => window.chromobench.rt.go('roll'));
  await page.locator('#roll-first-print').click();
  await expect(page.locator('#roll-pending')).toBeVisible();
  await expect(page.locator('#roll-pending .cb-change-thumb')).toHaveCount(2);
  await page.locator('#roll-reject').click();
  await expect(page.locator('#roll-pending')).toHaveCount(0);
});

test('offline: after one online visit the real engine starts without a network (packs from the service worker)', async ({ page, context }) => {
  test.setTimeout(180_000);
  await page.goto('/?canvas2d&engine=gpu&fresh');
  await expect(page.locator('#offline-state')).toHaveText('offline ready', { timeout: 60_000 });
  await page.reload(); // now controlled: modules and packs pass through the worker's caches
  await expect(page.locator('#engine')).toHaveAttribute('data-engine', /GPU/, { timeout: 60_000 });
  await page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: 60_000 });
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#engine')).toHaveAttribute('data-engine', /GPU/, { timeout: 60_000 });
  await page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: 60_000 });
  await page.setInputFiles('#file', FIXTURE);
  await expect(page.locator('#status')).toContainText('rendered', { timeout: 60_000 });
  await context.setOffline(false);
});
