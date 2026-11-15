// CHB-021 smoke (guide §10 stage 8; CHB-037 P7: looks are links): the 'looks' layout on MockEngine — the looks
// library with print thumbnails, a look previewed, Amount 60 % with what it does in points, apply (a link on the
// frame) and one undo, the frame's look with its own Amount, bake, the survey and the ring-around sweep, an agent's
// look batch approved on one card, and a look over a roll's unedited frames taken off by one undo.
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
  await page.goto('/demo/?layout=looks&fresh');
  await page.waitForFunction(() => document.body.dataset['ready'] === '1');
  await page.keyboard.press('d');
  const lib = page.locator('.ck-panel[data-panel="looks-library"]');
  await expect(lib.locator('.cb-look-cell .ck-thumb[data-rendered]').first()).toBeVisible();
  expect(await lib.locator('.cb-look-cell .ck-thumb[data-rendered]').count()).toBeGreaterThanOrEqual(4);

  // preview warm print: the main viewer shows it, nothing committed
  await lib.locator('.cb-look-cell', { hasText: 'Warm print' }).getByRole('button', { name: 'Preview' }).click();
  await expect(page.locator('#looks-picked')).toContainText('Warm print');
  await expect(page.locator('#looks-result')).toContainText('Warmth R −2.0 pt, B +2.0 pt');
  expect(await hook<number>(page, 'cb.log().steps.length')).toBe(0);

  // Amount 60 %: the result line in points
  await page.locator('#looks-amount').evaluate((el: HTMLInputElement) => {
    el.value = '60';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.locator('#looks-pct')).toHaveText('60 %');
  await expect(page.locator('#looks-result')).toContainText('Warmth R −1.2 pt, B +1.2 pt');

  // apply: one step labelled with the look, a link on the frame (its lights untouched); Mod+Z takes it off
  await page.locator('#looks-apply').click();
  await expect.poll(() => hook<number>(page, 'cb.log().steps.length')).toBe(1);
  expect(await hook<string>(page, 'cb.log().steps[0].label')).toBe('Look: Warm print at 60 %');
  expect(await hook<unknown>(page, `cb.doc().stages.darkroom.stack.items['warm-print1-darkroom']`)).toMatchObject({ kind: 'link', ref: { look: 'warm-print', version: 1 }, amount: 0.6 });
  expect(await hook<number[]>(page, 'cb.doc().stages.darkroom.stack.items.lights.params.logH')).toEqual([0, 0, 0]);
  await expect(page.locator('.cb-hist-i.is-cursor').first()).toContainText('Added the look Warm print');
  // the frame's look has its own Amount: 30 % is one more step, and the print changes
  const applied = page.locator('#looks-applied li[data-look="warm-print1"]');
  await expect(applied).toContainText('Warm print');
  await applied.getByRole('slider', { name: 'Warm print amount' }).evaluate((el: HTMLInputElement) => {
    el.value = '30';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect.poll(() => hook<number>(page, `cb.doc().stages.darkroom.stack.items['warm-print1-darkroom'].amount`)).toBe(0.3);
  // bake: the link becomes its plain layers (one step), undone again
  await applied.getByRole('button', { name: 'Bake Warm print' }).click();
  await expect.poll(() => hook<string>(page, `cb.doc().stages.darkroom.stack.items['warm-print1-darkroom'].kind`)).toBe('group');
  await page.locator('.ck-vp').first().click();
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
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
  await hook(page, `cb.studio.frames.all().slice(0, 3).forEach((e) => cb.studio.propose([{ op: 'set', path: 'stages.darkroom.medium.grade', value: 3 }], { frame: e.id, tx: 'eval-9:' + e.id, batch: 'look:9-1', why: 'Look: grade 3' }))`);
  const card = page.locator('.cb-looks-batch[data-batch="look:9-1"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText('3 frames');
  await expect(card).toContainText('grade 2 → 3 (3 frames)');
  await card.getByRole('button', { name: 'Approve 3' }).click();
  await expect(card).toHaveCount(0);
  const grades3 = () => hook<number[]>(page, 'cb.studio.frames.all().slice(0, 3).map((e) => cb.doc(e.id).stages.darkroom.medium.grade)');
  expect(await grades3()).toEqual([3, 3, 3]);
  await page.locator('.ck-vp').first().click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(grades3).toEqual([2, 2, 2]);
});

test('looks: a look over the roll’s unedited frames on one card, untick a frame, apply, one undo', async ({ page }) => {
  await page.goto('/demo/?layout=looks&fresh');
  await page.waitForFunction(() => document.body.dataset['ready'] === '1');
  await hook(page, `cb.run('roll.fromFrames', { analyse: false })`);
  const ids = await hook<string[]>(page, `cb.state().roll.rolls['roll-1'].frames`);
  expect(ids.length).toBe(6);
  // frame 2 has been worked on: not "unedited"
  await hook(page, `cb.studio.commit(${JSON.stringify(ids[1])}, [{ op: 'set', path: 'stages.darkroom.medium.grade', value: 3 }], 'Grade')`);
  await page.keyboard.press('d');
  // the frames' scans link to the roll (by auto: still unedited)
  expect(await hook<string[]>(page, `cb.state().roll.rolls['roll-1'].frames.map((f) => cb.doc(f).stages.scan.medium.link.roll)`)).toEqual(Array(6).fill('roll-1'));
  await page.locator('.ck-panel[data-panel="looks-library"] .cb-look-cell', { hasText: 'More contrast' }).getByRole('button', { name: 'Preview' }).click();
  await page.locator('#looks-apply-roll').click();
  const card = page.locator('#looks-pending');
  await expect(card).toContainText('Look: More contrast · 5 frames');
  await expect(card).toContainText('Contrast mask γ 0.3 (300 µm, harder) (5 frames)');
  const last = await hook<string>(page, `cb.state().catalog.frames[${JSON.stringify(ids[5])}].name`);
  await card.getByRole('checkbox', { name: `Include ${last}` }).uncheck();
  await expect(card).toContainText('· 4 frames');
  await page.locator('#looks-pending-approve').click();
  await expect(card).toHaveCount(0);
  const looked = () => hook<boolean[]>(page, `cb.state().roll.rolls['roll-1'].frames.map((f) => !!cb.doc(f).stages.darkroom.stack.items['more-contrast1-darkroom'])`);
  expect(await looked()).toEqual([true, false, true, true, true, false]);
  const steps = await hook<number>(page, 'cb.log().cursor');
  // one undo takes the look off the roll: every frame, one step
  await page.locator('.ck-vp').first().click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(looked).toEqual([false, false, false, false, false, false]);
  expect(await hook<number>(page, 'cb.log().cursor')).toBe(steps - 1);
  expect(await hook<number[]>(page, `cb.state().roll.rolls['roll-1'].frames.map((f) => cb.doc(f).stages.darkroom.medium.grade)`)).toEqual([2, 3, 2, 2, 2, 2]);
});
