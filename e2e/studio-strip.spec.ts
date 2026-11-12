// CHB-027 WS-D (F16): a scan of a strip of film opens as one frame per frame on the strip, each cropped to its frame
// and printed on its own (automatic first print); removing one keeps the others, opening the file again brings it
// back. Synthetic strip only (ingest's plantedFrames: three 645 frames on 120 film, the first 0.5 D denser).
import { expect, test, type Page } from '@playwright/test';
import { plantedFrames, writeTiff16 } from '@chromobench/ingest';

function stripTiff(): Buffer {
  const p = plantedFrames({ frames: 3, pxPerMm: 2.5, exposureD: [0.5, 0, 0] });
  const codes = new Uint16Array(p.rgb.length);
  for (let i = 0; i < p.rgb.length; i++) codes[i] = Math.round(65535 * Math.min(1, Math.max(0, p.rgb[i]!)));
  return Buffer.from(writeTiff16(p.w, p.h, codes));
}
const STRIP = { name: 'strip-07.tif', mimeType: 'image/tiff', buffer: stripTiff() };

const idle = (page: Page) => page.evaluate(() => window.chromobench.idle());
const state = (page: Page) => page.evaluate(() => {
  const s = window.chromobench.state() as any;
  return s.catalog.order.map((id: string) => ({ id, name: s.catalog.frames[id].name, crop: s.recipes[id]?.view.frame.crop ?? null, time: s.recipes[id]?.print.enlarger.time_s ?? null }));
});

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
});
test.afterEach(() => expect(errors).toEqual([]));

test('a strip opens as three frames, each cropped and printed on its own; remove one, open the file again', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/?nosw&canvas2d&fresh&engine=reference');
  await page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: 60_000 });
  await page.setInputFiles('#file', STRIP);
  await page.waitForFunction(() => window.chromobench.studio.frames.all().length === 3 && !/opening/.test(document.querySelector('#status')?.textContent ?? ''), null, { timeout: 120_000 });
  await idle(page);
  const s = await state(page);
  expect(s.map((f: { name: string }) => f.name)).toEqual(['strip-07.tif · 1/3', 'strip-07.tif · 2/3', 'strip-07.tif · 3/3']);
  // one source: all three frames read the same file
  expect(new Set(await page.evaluate(() => window.chromobench.studio.frames.all().map((e) => e.sha))).size).toBe(1);
  for (const f of s) expect(f.crop).toBeTruthy();
  // frames follow each other down the strip
  expect(s[0].crop.y).toBeLessThan(s[1].crop.y);
  expect(s[1].crop.y).toBeLessThan(s[2].crop.y);
  // each printed for itself: the dense first frame takes a longer time than the two alike
  expect(s[0].time).toBeGreaterThan(s[1].time * 1.4);
  expect(Math.abs(Math.log2(s[1].time / s[2].time))).toBeLessThan(0.5);

  // the second frame, picked in the filmstrip as he would
  await page.getByText('strip-07.tif · 2/3', { exact: true }).first().click();
  await idle(page);
  expect(await page.evaluate(() => window.chromobench.studio.current)).toBe(s[1].id);
  await page.screenshot({ path: 'ttmp/2026/11/12/CHB-027--fix-cosplay-session-01-findings-open-mode-responsiveness-library-wording-strips/various/ws-d/01-synthetic-strip-frame2.png' });

  // remove it: the others stay
  await page.evaluate(() => window.chromobench.run('frame.remove'));
  await idle(page);
  expect((await state(page)).map((f: { id: string }) => f.id)).toEqual([s[0].id, s[2].id]);
  // the same file again brings it back, with its recipe
  await page.setInputFiles('#file', STRIP);
  await page.waitForFunction(() => window.chromobench.studio.frames.all().length === 3, null, { timeout: 60_000 });
  await idle(page);
  expect((await state(page)).map((f: { id: string }) => f.id).sort()).toEqual(s.map((f: { id: string }) => f.id).sort());
});
