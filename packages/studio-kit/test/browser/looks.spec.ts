// CHB-021 smoke (guide §10 stage 8): the 'looks' variant on MockEngine — the looks library with print thumbnails, a
// look previewed, Amount 60 % with its result in points, apply and one undo, the survey and the ring-around sweep,
// and an agent's look batch approved on one card.
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

test('looks: library thumbnails, preview, Amount, apply, undo, survey, ring, agent batch', async ({ page }) => {
  await page.goto('/demo/?variant=looks&fresh');
  await page.waitForFunction(() => document.body.dataset['ready'] === '1');
  await page.keyboard.press('d');
  const lib = page.locator('.ck-panel[data-panel="looks-library"]');
  await expect(lib.locator('.cb-look-cell .ck-thumb[data-rendered]').first()).toBeVisible();
  expect(await lib.locator('.cb-look-cell .ck-thumb[data-rendered]').count()).toBeGreaterThanOrEqual(4);

  // preview warm print: the main viewer shows it, nothing committed
  await lib.locator('.cb-look-cell', { hasText: 'warm print' }).getByRole('button', { name: 'Preview' }).click();
  await expect(page.locator('#looks-picked')).toContainText('warm print');
  await expect(page.locator('#looks-result')).toContainText('lights R −2.0 pt, B +2.0 pt');
  expect(await hook<number>(page, 'cb.log().units.length')).toBe(0);

  // Amount 60 %: the result line in points
  await page.locator('#looks-amount').evaluate((el: HTMLInputElement) => {
    el.value = '60';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.locator('#looks-pct')).toHaveText('60 %');
  await expect(page.locator('#looks-result')).toContainText('lights R −1.2 pt, B +1.2 pt');

  // apply: one unit labelled with the look; Mod+Z takes it off
  await page.locator('#looks-apply').click();
  await expect.poll(() => hook<number>(page, 'cb.log().units.length')).toBe(1);
  expect(await hook<string>(page, 'cb.log().units[0].label')).toBe('Look: warm print at 60 %');
  expect(await hook<number>(page, 'cb.log().committed.print.lights.logH[2]')).toBeCloseTo(0.03, 6);
  await expect(page.locator('.cb-hist-i.is-cursor').first()).toContainText('Printer lights R 0 → −1, B 0 → +1 pt');
  await page.locator('.ck-vp').first().click();
  await page.keyboard.press('Control+z');
  await expect.poll(() => hook<number>(page, 'cb.log().cursor')).toBe(0);

  // survey (N): tiles of the chosen looks, then the ring-around sweep (nine prints)
  await page.keyboard.press('n');
  const survey = page.locator('.cb-looks-survey');
  await expect(survey).toBeVisible();
  await expect(survey.locator('.ck-thumb[data-rendered]').first()).toBeVisible();
  await survey.getByRole('radio', { name: 'Ring-around' }).click();
  await expect(survey.locator('.cb-look-cell')).toHaveCount(9);
  await expect(survey.locator('.ck-thumb[data-rendered]')).toHaveCount(9, { timeout: 15_000 });
  await survey.locator('button', { hasText: 'Back to the print' }).click();
  await expect(survey).toHaveCount(0);

  // an agent's look batch over three frames: one card, approve, one undo step
  await hook(page, `cb.studio.frames.all().slice(0, 3).forEach((e) => e.log.propose([{ op: 'set', path: 'print.grade', value: 3 }], { tx: 'eval-9', batch: 'look:9-1', why: 'Look: grade 3' }))`);
  const card = page.locator('.cb-looks-batch[data-batch="look:9-1"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText('3 frames');
  await expect(card).toContainText('grade 2 → 3 (3 frames)');
  await card.getByRole('button', { name: 'Approve 3' }).click();
  await expect(card).toHaveCount(0);
  expect(await hook<number[]>(page, 'cb.studio.frames.all().slice(0, 3).map((e) => e.log.committed.print.grade)')).toEqual([3, 3, 3]);
  await page.locator('.ck-vp').first().click();
  await page.keyboard.press('Control+z');
  await expect.poll(() => hook<number[]>(page, 'cb.studio.frames.all().slice(0, 3).map((e) => e.log.committed.print.grade)')).toEqual([2, 2, 2]);
});

test('looks: apply to the roll’s unedited frames on one card, untick a frame, apply, one undo', async ({ page }) => {
  await page.goto('/demo/?variant=looks&fresh');
  await page.waitForFunction(() => document.body.dataset['ready'] === '1');
  await hook(page, `cb.run('roll.fromFrames', { analyse: false })`);
  const ids = await hook<string[]>(page, `cb.state().roll.rolls['roll-1'].frames`);
  expect(ids.length).toBe(6);
  // frame 2 has been worked on: not "unedited"
  await hook(page, `cb.studio.route.applyMutations(${JSON.stringify(ids[1])}, [{ op: 'set', path: 'print.grade', value: 3 }], 'Grade')`);
  await page.keyboard.press('d');
  await page.locator('.ck-panel[data-panel="looks-library"] .cb-look-cell', { hasText: 'strong grade 4' }).getByRole('button', { name: 'Preview' }).click();
  await page.locator('#looks-apply-roll').click();
  const card = page.locator('#looks-pending');
  await expect(card).toContainText('Look: strong grade 4 · 5 frames');
  await expect(card).toContainText('grade 2 → 4 (5 frames)');
  const last = await hook<string>(page, `cb.state().catalog.frames[${JSON.stringify(ids[5])}].name`);
  await card.getByRole('checkbox', { name: `Include ${last}` }).uncheck();
  await expect(card).toContainText('· 4 frames');
  await page.locator('#looks-pending-approve').click();
  await expect(card).toHaveCount(0);
  const grades = () => hook<number[]>(page, `cb.state().roll.rolls['roll-1'].frames.map((f) => cb.studio.frames.get(f).log.committed.print.grade)`);
  expect(await grades()).toEqual([4, 3, 4, 4, 4, 2]);
  await page.locator('.ck-vp').first().click();
  await page.keyboard.press('Control+z');
  await expect.poll(grades).toEqual([2, 3, 2, 2, 2, 2]);
});
