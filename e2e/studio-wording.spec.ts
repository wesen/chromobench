// CHB-027 WS-C: the studio talks to a photographer (CHB-026 findings F7, F8, F9, F12, F13). Typed values out of
// range are held to the limit and said, a relative entry says what it did, a bad entry says why and leaves no red
// mark on the next frame, stock ids read as names, the engine label is a short sentence with the technical text
// in the tooltip, Edit ▸ Undo names the frame it acts on, and a slider drag lands on a time a printer sets.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { opened } from './support.ts';

const FIXTURE = new URL('../fixtures/synthetic/m1-negative-96x64.tif', import.meta.url).pathname;
const bytes = readFileSync(FIXTURE);
const file = (name: string, n: number): { name: string; mimeType: string; buffer: Buffer } => {
  const b = Buffer.from(bytes);
  b[b.length - 2] = (b[b.length - 2]! + n) & 0xff;
  return { name, mimeType: 'image/tiff', buffer: b };
};
const idle = (page: Page) => page.evaluate(() => window.chromobench.idle());
const time = (page: Page) => page.evaluate(() => window.chromobench.log!.committed.print.enlarger.time_s);

test('typed values, names, undo naming and round drags', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?nosw&engine=mock&fresh');
  await page.waitForFunction(() => document.body.dataset['ready'] === '1');
  await expect(page.locator('#engine')).toHaveText('Preview only (no film physics)');
  await expect(page.locator('#engine')).toHaveAttribute('data-engine', /mock/);
  await page.setInputFiles('#file', [file('first.tif', 1), file('second.tif', 2)]);
  await opened(page, 2);

  const arg = page.locator('.cb-arg[data-path="print.enlarger.time_s"]').first();
  const field = arg.locator('.cb-num');
  const toast = page.locator('.ck-toast').last();
  await expect(field).toHaveAttribute('title', /7,5.*\+1\/3 st/);

  // F7: out of range is held to the limit, in words
  await field.fill('0');
  await field.press('Enter');
  await expect(toast).toContainText("Time can't go below 0.1 s: set to 0.1 s");
  expect(await time(page)).toBe(0.1);
  await field.fill('1000');
  await field.press('Enter');
  await expect(toast).toContainText('Time can be at most 600 s');
  expect(await time(page)).toBe(600);
  // F8: a relative entry (a sign and a unit) says what it did; a bare '-5' is refused with both spellings
  // (CHB-031); a German comma works
  await field.fill('-5 s');
  await field.press('Enter');
  await expect(toast).toContainText('Time −5 s → 595.0 s');
  await field.fill('-5');
  await field.press('Enter');
  await expect(toast).toContainText('to change the time, add a unit (−5 s or −1/3 st); to set it, type 5');
  expect(await time(page)).toBe(595);
  await field.press('Escape');
  await field.fill('7,5');
  await field.press('Enter');
  expect(await time(page)).toBe(7.5);
  // a bad entry says why, and its red mark does not survive a frame switch
  await field.fill('abc');
  await field.press('Enter');
  await expect(toast).toContainText('“abc” is not a value');
  await expect(field).toHaveClass(/is-bad/);
  await page.locator('.ck-side-bottom .ck-thumb').nth(1).click();
  await idle(page);
  await expect(field).not.toHaveClass(/is-bad/);
  await expect(field).not.toHaveValue('abc');

  // F12: Edit ▸ Undo names the frame the change was made on
  await page.locator('.ck-menubar-t', { hasText: 'Edit' }).dispatchEvent('pointerdown');
  await expect(page.locator('.ck-menu .ck-menu-l').first()).toHaveText('Undo Time (on first.tif)');
  await page.keyboard.press('Escape');

  // F9: stock ids read as names, without a raw id above the menu
  const paper = page.locator('.cb-arg[data-path="print.paper"]').first();
  await expect(paper.locator('select option:checked')).toHaveText('Kodak Portra Endura');
  await expect(paper.locator('.cb-arg-v')).toHaveText('');

  // F13: a drag lands on a time a printer sets (whole seconds from 10 s, tenths below)
  const range = arg.locator('input[type=range]');
  await range.scrollIntoViewIfNeeded();
  const box = (await range.boundingBox())!;
  const x0 = await range.evaluate((el: HTMLInputElement) => {
    const r = el.getBoundingClientRect();
    return r.left + ((Number(el.value) - Number(el.min)) / (Number(el.max) - Number(el.min))) * r.width;
  });
  await page.mouse.move(x0, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(x0 + i * 4, box.y + box.height / 2);
  await page.mouse.up();
  await idle(page);
  const t = await time(page);
  expect(t).not.toBe(10);
  expect(t).toBe(t >= 10 ? Math.round(t) : Math.round(t * 10) / 10);
  expect(errors).toEqual([]);
});
