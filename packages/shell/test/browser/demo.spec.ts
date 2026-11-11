// The shell demo in Chromium: it mounts, the grid draws thumbnails, a slider drag is one undo step and renders a
// draft then a screen pass, the palette opens, Tab hides the sides.
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', e => console.log('pageerror', e.message));
  await page.goto('/demo/index.html?fresh');
  await page.waitForFunction(() => document.body.dataset['ready'] === '1');
});

test('library: grid with thumbnails, keys move the selection, Enter goes to Develop', async ({ page }) => {
  await expect(page.locator('.ck-gridview .ck-coll-cell').first()).toBeVisible();
  await expect(page.locator('.ck-gridview .ck-thumb[data-rendered]').first()).toBeAttached({ timeout: 10_000 });
  if (process.env['SHELL_DEMO_SHOT']) await page.screenshot({ path: process.env['SHELL_DEMO_SHOT'] + '-library.png' });
  await page.locator('.ck-gridview').focus();
  await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(() => window.demo!.rt.state.ui.selection.primary)).toBe('p1');
  await page.keyboard.press('Enter');
  await expect(page.locator('.ck-work[data-module="develop"]')).toBeVisible();
});

test('develop: the viewport shows the picture; a slider drag is one undo step (draft, then screen)', async ({ page }) => {
  await page.evaluate(() => window.demo!.rt.go('develop'));
  const vp = page.locator('.ck-vp');
  await expect(vp).toHaveAttribute('data-pass', 'screen', { timeout: 10_000 });
  const passes: string[] = [];
  await page.exposeFunction('notePass', (p: string) => passes.push(p));
  await page.evaluate(() => window.demo!.rt.on('rendered', (e: { pass: string }) => (window as unknown as { notePass(p: string): void }).notePass(e.pass)));
  const before = await page.evaluate(() => window.demo!.rt.history.entries.length);
  const track = page.locator('.ck-slider', { hasText: 'Exposure' }).locator('.ck-slider-t');
  const box = (await track.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width / 2 + i * 6, box.y + box.height / 2);
  await page.mouse.up();
  await expect(vp).toHaveAttribute('data-pass', 'screen');
  if (process.env['SHELL_DEMO_SHOT']) await page.screenshot({ path: process.env['SHELL_DEMO_SHOT'] + '-develop.png' });
  const after = await page.evaluate(() => ({ n: window.demo!.rt.history.entries.length, label: window.demo!.rt.history.entries.at(-1)?.label, ev: window.demo!.rt.state.dev['p0']!.light.exposure }));
  expect(after.n).toBe(before + 1);
  expect(after.label).toBe('Exposure');
  expect(after.ev).toBeGreaterThan(0);
  expect(passes).toContain('draft');
  expect(passes.at(-1)).toBe('screen');
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => window.demo!.rt.state.dev['p0']!.light.exposure)).toBe(0);
});

test('chrome: the palette opens on Mod+K, Tab hides the side panels', async ({ page }) => {
  await page.keyboard.press('Control+k');
  await expect(page.locator('.ck-palette input')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.ck-side-left')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.locator('.ck-side-left')).toBeHidden();
  await expect(page.locator('.ck-side-right')).toBeHidden();
});
