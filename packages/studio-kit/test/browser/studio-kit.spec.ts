// The studio-kit dev host in Chromium: each layout mounts on MockEngine with the M1 fixture and five more frames;
// the film strip, grid and navigator show print thumbnails; a keyboard burst is one EditLog unit and Mod+Z undoes
// it; typed darkroom units; an agent proposal is shown, refused as stale and applied anyway; an unknown layout
// shows the Build Report with a did-you-mean.
import { expect, test, type Page } from '@playwright/test';

const errors: string[] = [];
test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', e => errors.push(e.message));
});
test.afterEach(() => {
  expect(errors).toEqual([]);
});

async function open(page: Page, layout: string): Promise<void> {
  await page.goto(`/demo/?layout=${layout}&fresh`);
  await page.waitForFunction(() => document.body.dataset['ready'] === '1');
}
const hook = <T>(page: Page, f: string): Promise<T> => page.evaluate(`(() => { const cb = window.chromobench; return ${f}; })()`) as Promise<T>;

test('classic: strip, grid and navigator show print thumbnails; the bottom region is visible', async ({ page }) => {
  await open(page, 'classic');
  const bottom = page.locator('.ck-side-bottom');
  await expect(bottom).toBeVisible();
  expect((await bottom.boundingBox())!.height).toBeGreaterThan(80);
  await expect(bottom.locator('.ck-thumb[data-rendered]')).toHaveCount(6);
  await expect(page.locator('.ck-center-main .ck-thumb[data-rendered]')).toHaveCount(6);
  await expect(page.locator('.ck-panel[data-panel="navigator"] .ck-thumb[data-rendered]')).toHaveCount(1);
});

test('classic print: a keyboard burst is one unit, Mod+Z undoes it, typed +1/3 st is 12.599 s', async ({ page }) => {
  await open(page, 'classic');
  await page.keyboard.press('d');
  await expect(page.locator('.ck-vp[data-rendered]').first()).toBeVisible();
  const time = page.locator('.cb-arg[data-path="print.enlarger.time_s"]');
  await time.locator('input[type=range]').focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(1100);
  expect(await hook<number>(page, 'cb.log().units.length')).toBe(1);
  expect(await hook<number>(page, 'cb.log().committed.print.enlarger.time_s')).toBeCloseTo(14.142, 2);
  await page.locator('.cb-hist').click();
  await page.keyboard.press('ControlOrMeta+z');
  expect(await hook<number>(page, 'cb.log().cursor')).toBe(0);
  await time.locator('.cb-num').fill('+1/3 st');
  await time.locator('.cb-num').press('Enter');
  expect(await hook<number>(page, 'cb.log().committed.print.enlarger.time_s')).toBeCloseTo(12.599, 3);
  await expect(page.locator('.cb-hist-i.is-cursor')).toContainText('Time 10.0 → 12.6 s (+⅓ stop)');
});

test('classic print: an agent proposal is shown, refused as stale, applied anyway', async ({ page }) => {
  await open(page, 'classic');
  await page.keyboard.press('d');
  await hook(page, `cb.propose([{ op: 'set', path: 'print.lights.logH', value: [0.1, 0, 0] }], 'warmer')`);
  const card = page.locator('#pending li');
  await expect(card).toHaveCount(1);
  await card.locator('.show').click();
  await expect(page.locator('.cb-ribbon').first()).toContainText('Agent proposal, not applied');
  const g = page.locator('.cb-arg[data-path="print.lights.logH"] input[aria-label="Printer lights G"]');
  await g.focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(1000);
  await card.locator('.approve').click();
  await expect(card.locator('.cb-stale')).toContainText('E_STALE');
  await card.locator('.force').click();
  await expect(page.locator('#pending li')).toHaveCount(0);
  expect(await hook<number[]>(page, 'cb.log().committed.print.lights.logH')).toEqual([0.1, 0, 0]);
});

for (const v of ['darkroom', 'simple', 'lab', 'tiny']) {
  test(`${v}: mounts and renders the print, explain names the layout's parts`, async ({ page }) => {
    await open(page, v);
    if (v === 'simple') {
      await expect(page.locator('.ck-center-main .ck-thumb[data-rendered]')).toHaveCount(6);
      await page.locator('.cb-steps-next').click();
      await page.getByRole('button', { name: 'Darker' }).click();
      await page.getByRole('button', { name: 'Darker' }).click();
      await page.waitForTimeout(1000);
      expect(await hook<number>(page, 'cb.log().units.length')).toBe(1);
      await page.locator('button', { hasText: 'Which looks best?' }).click();
      await expect(page.locator('.cb-ring-tile .ck-thumb[data-rendered]')).toHaveCount(11);
    } else if (v === 'lab') {
      await page.keyboard.press('l');
      await expect(page.locator('.ck-vp[data-rendered]').first()).toBeVisible();
      await expect(page.locator('.cb-journal')).toBeVisible();
    } else await expect(page.locator('.ck-vp[data-rendered]').first()).toBeVisible();
    const text = await hook<string>(page, 'cb.explain()');
    expect(text).toMatch(/kits: cb\.core@1/);
  });
}

test('an unknown layout shows the Build Report with a did-you-mean', async ({ page }) => {
  await page.goto('/demo/?layout=clasic');
  await expect(page.locator('#build-report')).toContainText('Did you mean ?layout=classic?');
});
