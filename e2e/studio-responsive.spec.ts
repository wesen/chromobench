// CHB-027 WS-B (F4, F10): on the reference engine (no WebGPU) the window never freezes. Decoding, conditioning and
// the engine run in the engine worker; a drag of the Time slider with the mouse shows drafts that compute fewer
// pixels than the screen render, and ends on the final value. Stalls are requestAnimationFrame gaps (the CHB-026
// probe); the bounds are generous for a loaded CI machine — before CHB-027 a 1024 px frame stalled for seconds.
import { expect, test, type Page } from '@playwright/test';
import { writeTiff } from '@chromobench/ingest';

const W = 1500, H = 1000;

/** A smooth synthetic negative: orange mask, density varying over the frame. */
function negative(): Uint8Array {
  const planes = [0, 1, 2].map(() => new Uint16Array(W * H)) as [Uint16Array, Uint16Array, Uint16Array];
  const base = [0.8, 0.45, 0.22];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = 0.2 + 0.9 * (0.5 + 0.5 * Math.sin((6 * x) / W + (3 * y) / H) * Math.cos((5 * y) / H));
    for (let k = 0; k < 3; k++) planes[k]![y * W + x] = Math.round(65535 * 0.9 * base[k]! * 10 ** -(d * [0.9, 1, 1.1][k]!));
  }
  return writeTiff({ images: [{ width: W, height: H, planes, bits: 16, compression: 'deflate', predictor: 2, photometric: 2 }] });
}

const probe = () => {
  const P: number[] = [];
  (window as unknown as { __stalls: number[] }).__stalls = P;
  let last = performance.now();
  const tick = (t: number): void => {
    if (t - last > 100) P.push(Math.round(t - last));
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
const stalls = (page: Page) => page.evaluate(() => (window as unknown as { __stalls: number[] }).__stalls.splice(0));

test('reference engine in the worker: no frozen window on open or drag; drafts compute fewer pixels', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(probe);
  await page.goto('/?nosw&canvas2d&fresh&engine=reference&refLong=1024');
  await page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: 60_000 });
  await expect(page.locator('#engine')).toHaveAttribute('data-engine', /reference · CPU f64 \(worker\) · 1024 px/);
  await page.evaluate(() => {
    const w = window as unknown as { __r: string[]; chromobench: { rt: { on(e: string, f: (x: { viewport: string; pass: string; w: number; h: number }) => void): void } } };
    w.__r = [];
    w.chromobench.rt.on('rendered', (e) => w.__r.push(`${e.viewport}|${e.pass}|${e.w * e.h}`));
  });
  await stalls(page);
  await page.setInputFiles('#file', { name: 'neg.tif', mimeType: 'image/tiff', buffer: Buffer.from(negative()) });
  await expect(page.locator('#status')).toContainText('rendered', { timeout: 240_000 });
  await page.evaluate(() => window.chromobench.idle());
  expect(await page.evaluate(() => window.chromobench.size())).toEqual({ width: 1024, height: 683 });
  const openStalls = await stalls(page);
  expect(Math.max(0, ...openStalls), `open stalls ${openStalls}`).toBeLessThan(2000);

  // drag Time 40 px with the mouse, 20 moves
  const s = page.locator('input[aria-label="Time"]').first();
  const b = (await s.boundingBox())!;
  const v = await s.evaluate((e: HTMLInputElement) => ({ v: Number(e.value), min: Number(e.min), max: Number(e.max) }));
  const x = b.x + 8 + ((v.v - v.min) / (v.max - v.min)) * (b.width - 16), y = b.y + b.height / 2;
  const t0 = Date.now();
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(x + 2 * i, y);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  const dragMs = Date.now() - t0;
  expect(dragMs, 'the mouse moves are answered at once').toBeLessThan(5000);
  const t1 = await page.evaluate(() => window.chromobench.log!.state.print.enlarger.time_s);
  await page.evaluate(() => window.chromobench.idle());
  const dragStalls = await stalls(page);
  expect(Math.max(0, ...dragStalls), `drag stalls ${dragStalls}`).toBeLessThan(1000);
  const r = await page.evaluate(() => (window as unknown as { __r: string[] }).__r.filter((x) => x.startsWith('main|')).map((x) => x.split('|')));
  const drafts = r.filter((x) => x[1] === 'draft').map((x) => Number(x[2]));
  const screen = r.filter((x) => x[1] === 'screen').map((x) => Number(x[2]));
  expect(drafts.length).toBeGreaterThan(0);
  expect(Math.max(...drafts)).toBeLessThan(Math.min(...screen));
  // the last render is a screen render of the final value
  expect(r.at(-1)![1]).toBe('screen');
  expect(await page.evaluate(() => window.chromobench.log!.committed.print.enlarger.time_s)).toBe(t1);
  expect(errors).toEqual([]);
});
