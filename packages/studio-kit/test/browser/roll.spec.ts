// CHB-020 smoke (guide §11): the 'roll' variant on MockEngine with six planted 135 frames in a holder — new roll
// (analysis + automatic first print), the contact sheet's print thumbnails, cull keys, a reference, the match
// previewed on one card, approved, and one Mod+Z taking it off every frame.
import { expect, test, type Page } from '@playwright/test';

const errors: string[] = [];
test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (e) => errors.push(e.message));
});
test.afterEach(() => {
  expect(errors).toEqual([]);
});

const hook = <T>(page: Page, f: string): Promise<T> => page.evaluate(`(() => { const cb = window.chromobench; return ${f}; })()`) as Promise<T>;
const frameAt = (page: Page, i: number): Promise<string> => hook<string>(page, `cb.state().roll.rolls['roll-1'].frames[${i}]`);
/** click a contact cell and wait until it is the primary selection (keys act on it) */
async function select(page: Page, i: number): Promise<void> {
  const id = await frameAt(page, i);
  // by key: the grid recycles its cells, so DOM order is not the sheet's order
  await page.locator(`.ck-coll-cell[data-key="${id}"]`).click();
  await expect.poll(() => hook<string>(page, 'cb.state().ui.selection.primary')).toBe(id);
}
const methods = (page: Page): Promise<string[]> => hook<string[]>(page, `cb.studio.frames.all().map(e => e.log.committed.print.lights.auto.method)`);

test('roll: new roll, first print, cull, reference, match, approve, undo', async ({ page }) => {
  await page.goto('/demo/?variant=roll&fresh');
  await page.waitForFunction(() => document.body.dataset['ready'] === '1');
  await expect(page.locator('#roll-new')).toBeVisible();

  // new roll: analysis and the automatic first print
  await page.locator('#roll-new').click();
  await expect(page.locator('#rolls li')).toContainText('first-printed', { timeout: 30_000 });
  expect(await methods(page)).toEqual(Array(6).fill('roll'));
  await expect(page.locator('.cb-roll-cell .ck-thumb[data-rendered]')).toHaveCount(6);
  await expect(page.locator('.cb-roll-setup [data-row="base"]')).toContainText('median of');
  await expect(page.locator('.cb-roll-setup [data-row="veil (flare)"]')).toContainText('of the open gate');
  await expect(page.locator('#roll-inspector-table tr')).toHaveCount(7);
  // the planted mixed frame (5) is named
  await expect(page.locator('.cb-roll-setup [data-row="base"]')).toContainText('mixed: roll-05.tif');

  // cull with the keys on the contact sheet: reject frame 5, pick frame 1
  await select(page, 4);
  await page.keyboard.press('x');
  await expect.poll(() => hook<string | null>(page, `cb.state().catalog.frames[cb.state().roll.rolls['roll-1'].frames[4]].flag`)).toBe('reject');
  await select(page, 0);
  await page.keyboard.press('p');
  await expect.poll(() => hook<string | null>(page, `cb.state().catalog.frames[cb.state().roll.rolls['roll-1'].frames[0]].flag`)).toBe('pick');

  // reference: frame 3 (R), then match (M): previewed on one card, nothing applied yet
  await select(page, 2);
  await page.keyboard.press('r');
  await expect(page.locator('#roll-reference')).toContainText('roll-03.tif');
  await page.keyboard.press('m');
  await expect(page.locator('#roll-pending')).toBeVisible();
  await expect(page.locator('#roll-skipped')).toContainText('roll-05.tif (rejected)');
  expect(await methods(page)).toEqual(Array(6).fill('roll'));

  await page.locator('#roll-approve').click();
  await expect(page.locator('#roll-pending')).toHaveCount(0);
  expect(await methods(page)).toEqual(['match', 'match', 'roll', 'match', 'roll', 'match']);

  // one undo takes the match off every frame
  await page.locator('#roll-reference').click();
  await page.keyboard.press('Control+z');
  await expect.poll(() => methods(page)).toEqual(Array(6).fill('roll'));
});
