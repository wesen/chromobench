// CHB-041: GPU memory in the studio. Ten large frames open and switch without E_GPU_OOM under the floor budget (512 MiB,
// as on SwiftShader before CHB-041: the persona session ran out after ~6 frames); an out-of-memory recovers on the
// retry; when it cannot, the viewer says so for that frame and never leaves the previous frame's picture up under the
// new name (CHB-037 P9-11). Synthetic files only (e2e/scenes.ts).
import { expect, test, type Page } from '@playwright/test';
import { negativeScan, tif } from './scenes.ts';
import { opened } from './support.ts';

const ready = (page: Page) => page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: 90_000 });
const idle = (page: Page) => page.evaluate(() => window.chromobench.idle());
type Row = { level: string; source: string; code?: string; message: string; count: number; data?: Record<string, unknown> };
const rows = (page: Page, f: Record<string, unknown> = {}) => page.evaluate((x) => window.chromobench.diagnostics.journal.rows(x as never) as Row[], f);
const OOM = new Set(['E_GPU_OOM', 'GPU_OOM', 'GPU_OUT_OF_MEMORY']);
interface Mem { limit: number; live: number; peak: number; rule: string; resident: { bytes: number; pinnedBytes: number; frames: number; textures: number }; pinned: string[] }
// the GPU engine behind the studio's engine (the hook's engine is the StudioEngine; its primary is the GpuEngine)
const memory = (page: Page) => page.evaluate(() => (window.chromobench.engine as unknown as { primary: { memory(o: object): Mem } }).primary.memory({ reset: true }));
const inject = (page: Page, n: number) => page.evaluate((k) => (window.chromobench.engine as unknown as { primary: { runtime: { budget: { inject(n: number): void } } } }).primary.runtime.budget.inject(k), n);
const VP = '.ck-vp[data-viewport="main"]';
const MB = (x: number) => Math.round(x / 2 ** 20);

let pageErrors: string[] = [];
test.beforeEach(({ page }) => {
  pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
});
test.afterEach(() => expect(pageErrors).toEqual([]));

test('ten large frames open and switch without E_GPU_OOM in the floor budget; frames not on screen keep nothing', async ({ page }) => {
  test.setTimeout(900_000);
  // 2400 × 1600 scans: the full-size working texture is 61 MB each, ten of them 614 MB — more than the budget
  await page.goto('/?nosw&fresh&layout=classic&gpuBudget=512');
  await ready(page);
  const files = Array.from({ length: 10 }, (_, i) => tif(`large-${String(i + 1).padStart(2, '0')}.tif`, negativeScan(2400, 1600, { exposure: (i - 5) * 0.15 })));
  const times: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const t0 = Date.now();
    await page.setInputFiles('#file', [files[i]!]);
    await opened(page, i + 1, 180_000);
    const m = await memory(page);
    times.push(`open ${i + 1}: ${Date.now() - t0} ms, peak ${MB(m.peak)} MB, live ${MB(m.live)} of ${MB(m.limit)} MB, kept ${MB(m.resident.bytes)} MB in ${m.resident.frames} frames`);
    expect(m.limit).toBe(512 * 2 ** 20);
    expect(m.peak).toBeLessThanOrEqual(m.limit);
  }
  await expect(page.locator(VP)).toHaveAttribute('data-rendered', /\d+x\d+/);
  for (let i = 0; i < 12; i++) {
    const t0 = Date.now();
    await page.evaluate((c) => window.chromobench.run(c), i < 6 ? 'frame.previous' : 'frame.next');
    await idle(page);
    const m = await memory(page);
    times.push(`switch ${i + 1}: ${Date.now() - t0} ms, peak ${MB(m.peak)} MB, live ${MB(m.live)} MB, kept ${MB(m.resident.bytes)} MB (${MB(m.resident.pinnedBytes)} on screen) in ${m.resident.frames} frames`);
    await expect(page.locator(VP)).toHaveAttribute('data-rendered', /\d+x\d+/);
    await expect(page.locator(VP)).not.toHaveAttribute('data-error', /.*/);
    // the viewer's frame is the one on screen
    const sha = await page.evaluate(() => window.chromobench.doc!.source.sha256);
    expect(m.pinned).toContain(sha);
  }
  console.log(times.join('\n'));
  const bad = (await rows(page, { level: 'warn' })).filter((r) => OOM.has(r.code ?? '') || /E_GPU_OOM/.test(r.message));
  expect(bad).toEqual([]);
  // the journal has each render's high-water mark
  const mem = (await rows(page, { source: 'gpu' })).find((r) => r.code === 'GPU_MEMORY');
  expect(mem?.count).toBeGreaterThan(10);
  expect(mem?.data?.['limitMB']).toBe(512);
});

test('an out-of-memory recovers on the retry; when it cannot, the viewer says so for that frame, never with the previous picture', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?nosw&fresh&layout=classic');
  await ready(page);
  await page.setInputFiles('#file', [tif('first.tif', negativeScan(2000, 1333))]);
  await opened(page, 1, 120_000);
  await page.setInputFiles('#file', [tif('second.tif', negativeScan(2000, 1333, { exposure: 0.7 }))]);
  await opened(page, 2, 120_000);
  const vp = page.locator(VP);
  await expect(vp).toHaveAttribute('data-rendered', /\d+x\d+/);
  const [first, second] = await page.evaluate(() => window.chromobench.studio.frames.all().map((e) => e.id));
  expect(await page.evaluate(() => window.chromobench.studio.current)).toBe(second);

  // one failure: the engine lets go of what it keeps, tries again, and the picture comes (journal: recovered)
  await inject(page, 1);
  await page.evaluate(() => window.chromobench.set('main.params.time_s', 13, 'Time'));
  await idle(page);
  await expect(vp).toHaveAttribute('data-rendered', /\d+x\d+/);
  await expect(vp).not.toHaveAttribute('data-error', /.*/);
  const recovered = (await rows(page, { source: 'gpu' })).filter((r) => r.code === 'GPU_OOM_RECOVERED');
  expect(recovered).toHaveLength(1);

  // nothing fits any more: a new size (the scans are larger than the viewer: a new render) fails after its retry
  await inject(page, 1_000_000);
  await page.setViewportSize({ width: 1500, height: 900 });
  await idle(page);
  // the same frame's picture may stay (it is this frame's), with the message
  await expect(vp.locator('.ck-vp-msg')).toBeVisible();
  await expect(vp).toHaveAttribute('data-error', 'E_GPU_OOM');
  // switching to the other frame: its render fails too — the picture of the frame before goes, the message stays
  await page.evaluate(() => window.chromobench.run('frame.previous'));
  await idle(page);
  expect(await page.evaluate(() => window.chromobench.studio.current)).toBe(first);
  await expect(vp).toHaveAttribute('data-error', 'E_GPU_OOM');
  await expect(vp).not.toHaveAttribute('data-rendered', /.*/);
  expect(await page.evaluate(() => window.chromobench.pixel(10, 10))).toBeNull();
  await expect(vp.locator('.ck-vp-msg')).toBeVisible();
  await expect(vp.locator('.ck-vp-msg')).toHaveText(/Not enough graphics memory/);
  await expect(vp.locator('.ck-vp-label')).toHaveText(/first/);
  const failed = (await rows(page, { level: 'error' })).filter((r) => r.code === 'E_GPU_OOM' || r.code === 'GPU_OOM');
  expect(failed.length).toBeGreaterThan(0);

  // memory again: the next render shows the picture and the message goes
  await inject(page, 0);
  await page.evaluate(() => window.chromobench.set('main.params.time_s', 12, 'Time'));
  await idle(page);
  await expect(vp).toHaveAttribute('data-rendered', /\d+x\d+/);
  await expect(vp).not.toHaveAttribute('data-error', /.*/);
  await expect(vp.locator('.ck-vp-msg')).toBeHidden();
});
