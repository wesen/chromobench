// CHB-023: the studio on the real engines (GpuEngine on SwiftShader, RefEngine), smoke-tested with the M1
// fixture: boot and engine label, the automatic first print, enlarger controls that change the print,
// the four views, the densitometer, the test strip and ring-around on the real chain, undo, export.
// Canvas2D presentation (?canvas2d): presenting a WebGPU canvas loses the device on SwiftShader.
import { expect, test, type Page } from '@playwright/test';

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
  await page.goto(`/?nosw&canvas2d&engine=${engine}`);
  await expect(page.locator('#engine')).toBeVisible({ timeout: 60_000 });
  await page.setInputFiles('#file', FIXTURE);
  await expect(page.locator('#status')).toContainText('rendered', { timeout: 60_000 });
  await idle(page);
}

for (const engine of ['gpu', 'reference'] as const) {
  test(`${engine}: first print, enlarger controls, views, probe, strip, undo, export`, async ({ page }) => {
    test.setTimeout(240_000);
    await open(page, engine);
    await expect(page.locator('#engine')).toContainText(engine === 'gpu' ? 'GPU' : 'reference');
    // the first print: enlarger in 'real' mode, integrated to grey (recorded in print.lights.auto)
    const r0 = await page.evaluate(() => window.chromobench.log!.state.print);
    expect(r0.enlarger.mode).toBe('real');
    expect(r0.lights.auto.method).toBe('integrate');
    expect(r0.lights.auto.applied).toBe(true);
    const p0 = (await centre(page))!;
    expect(p0.every((v) => v >= 0 && v <= 1)).toBe(true);

    // a longer time prints darker
    await page.evaluate(() => window.chromobench.studio.gesture.set('print.enlarger.time_s', window.chromobench.log!.state.print.enlarger.time_s * 2, 'time +1 st'));
    await idle(page);
    const p1 = (await centre(page))!;
    expect(p1[1]!).toBeLessThan(p0[1]!);
    // undo restores the picture exactly
    await page.click('#undo');
    await idle(page);
    expect(await centre(page)).toEqual(p0);

    // views: negative, dyes, base & gamut render; back to print
    for (const v of ['Negative', 'Dyes', 'Base & gamut', 'Print']) {
      await page.getByRole('radio', { name: v, exact: true }).click();
      await expect(page.locator('#status')).toContainText('rendered');
      await idle(page);
    }

    // densitometer
    await page.evaluate(() => window.chromobench.studio.probeAt({ x: 48, y: 32, r: 3 }));
    await idle(page);
    await expect(page.locator('#visual-d')).toHaveText(/^\d\.\d\d$/);

    // test strip: five bands of the real chain, each strip printed with its own time; clicking the
    // last band (+2/3 st) makes the print equal to that band where the band lay
    const t0 = r0.enlarger.time_s;
    await page.evaluate(() => window.chromobench.studio.setTool('testStrip'));
    await idle(page);
    await expect(page.locator('.bands .band')).toHaveCount(5);
    await expect(page.locator('.bands .band .mut').last()).toHaveText(/^D \d\.\d\d$/, { timeout: 120_000 });
    const inBand = await page.evaluate(() => window.chromobench.pixel(88, 32));
    const values = (await page.locator('.bands .band').evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset['value']))));
    expect(values[4]!).toBeCloseTo(t0 * 2 ** (2 / 3), 2);
    await page.locator('.bands .band').nth(4).click();
    await page.evaluate(() => window.chromobench.studio.setTool(null));
    await idle(page);
    expect(await page.evaluate(() => window.chromobench.log!.state.print.enlarger.time_s)).toBeCloseTo(values[4]!, 3);
    expect(await page.evaluate(() => window.chromobench.pixel(88, 32))).toEqual(inBand);
    const darker = (await centre(page))!;
    expect(darker[1]!).toBeLessThan(p0[1]!);

    // ring-around: eleven tiles of the real chain; the centre tile is the main print's node
    await page.evaluate(() => window.chromobench.studio.setTool('ringAround'));
    await expect(page.locator('.ring-tile')).toHaveCount(11);
    await expect(page.locator('.ring-tile[data-tile="current"]')).not.toHaveAttribute('data-node', '', { timeout: 120_000 });
    const main = await page.evaluate(() => window.chromobench.studio.session!.displayNode().id);
    await expect(page.locator('.ring-tile[data-tile="current"]')).toHaveAttribute('data-node', main);
    await page.locator('.ring-tile[data-tile="Y"]').click();
    expect(await page.evaluate(() => window.chromobench.log!.state.print.lights.logH[2])).toBeGreaterThan(r0.lights.logH[2]);
    await page.evaluate(() => window.chromobench.studio.setTool(null));
    await page.click('#undo');
    await idle(page);

    // export: an 8-bit PNG at the working size
    const x = await page.evaluate(() => window.chromobench.exportPng('srgb'));
    expect(x).toMatchObject({ width: 96, height: 64, type: 'image/png' });
    expect(x!.bytes).toBeGreaterThan(100);

    // the frame-time benchmark for a real GPU runs here too (numbers are SwiftShader's / the CPU's)
    const b = await page.evaluate(() => window.chromobench.bench(4));
    console.log(`bench ${engine}: ${JSON.stringify(b)}`);
    expect(b).toMatchObject({ frame: '96×64', exported: '96×64' });
  });
}

test('offline: after one online visit the real engine starts without a network (packs from the service worker)', async ({ page, context }) => {
  test.setTimeout(180_000);
  await page.goto('/?canvas2d&engine=gpu');
  await expect(page.locator('#offline-state')).toHaveText('offline ready', { timeout: 60_000 });
  await page.reload(); // now controlled: modules and packs pass through the worker's caches
  await expect(page.locator('#engine')).toContainText('GPU', { timeout: 60_000 });
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#engine')).toContainText('GPU', { timeout: 60_000 });
  await page.setInputFiles('#file', FIXTURE);
  await expect(page.locator('#status')).toContainText('rendered', { timeout: 60_000 });
  await context.setOffline(false);
});
