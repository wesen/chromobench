// The stack kit in Chromium (studio-kit dev host, MockEngine): the classic Print module's Exposures panel is the
// darkroom stack — add a burn from + Layer, fade it with its amount, turn it off and on, group it, drag a dodge into
// the group, give the burn a mask from its chip, reorder by drag, rename; provenance chips say who changed an entry
// (an approved agent proposal says Agent); every step is one undo. The Edit module holds the print stage.
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
const order = (page: Page, stage = 'darkroom') => hook<string[]>(page, `cb.doc().stages.${stage}.stack.order`);
const entry = (page: Page, id: string) => hook<Record<string, any>>(page, `(() => { const d = cb.doc(); const find = (c) => { for (const k of c.order) { const e = c.items[k]; if (k === '${id}') return e; if (e.kind === 'group') { const x = find(e.stack); if (x) return x; } } return null; }; for (const s of ['darkroom', 'print']) { const x = find(d.stages[s].stack); if (x) return x; } return null; })()`);
const steps = (page: Page) => hook<number>(page, 'cb.log().inEffect(cb.studio.current).length');
const panel = (page: Page, id: string) => page.locator(`.ck-panel[data-panel="${id}"]`).first();
const row = (page: Page, id: string) => page.locator(`.ck-panel:visible .cb-stack-row[data-id="${id}"]`).first();

async function addLayer(page: Page, panelId: string, word: string): Promise<void> {
  await panel(page, panelId).locator('.cb-stack-add').click();
  await page.getByRole('menuitem', { name: word, exact: true }).click();
}

test('classic Print: the Exposures panel is the darkroom stack — add, fade, toggle, group, drag into the group, mask, undo', async ({ page }) => {
  await open(page, 'classic');
  await page.keyboard.press('d');
  const exp = panel(page, 'exposures');
  await expect(exp.locator('.cb-stack-row')).toHaveCount(2);
  await expect(row(page, 'main')).toContainText('Main exposure');
  await expect(exp).toContainText('the order does not change the print');
  // + Layer from the catalogue: a burn after the selection (nothing selected: at the end)
  await addLayer(page, 'exposures', 'Burn');
  await expect(row(page, 'burn1')).toBeVisible();
  await expect(row(page, 'burn1')).toHaveClass(/is-sel/);
  expect(await order(page)).toEqual(['main', 'lights', 'burn1']);
  // the params panel shows the burn's controls from the catalogue
  const params = panel(page, 'layer-params-print');
  await expect(params).toContainText('Burn');
  await expect(params.locator('.cb-arg[data-path="burn1.params.stops"]')).toBeVisible();
  // fade: the amount typed in the row (the light law scales its time)
  const amt = row(page, 'burn1').locator('.cb-stack-amount .cb-num');
  await amt.fill('50');
  await amt.press('Enter');
  expect((await entry(page, 'burn1')).amount).toBe(0.5);
  await expect(row(page, 'burn1').locator('.cb-stack-detail')).toContainText('+');
  // off and on
  await row(page, 'burn1').locator('.cb-stack-on').uncheck();
  expect((await entry(page, 'burn1')).enabled).toBe(false);
  await expect(row(page, 'burn1')).toHaveClass(/is-off/);
  await row(page, 'burn1').locator('.cb-stack-on').check();
  // a dodge, then the burn in a group (Mod+G), the dodge dragged into it
  await addLayer(page, 'exposures', 'Dodge');
  await row(page, 'burn1').locator('.cb-stack-name').click();
  await params.locator('.cb-stack-group').click();
  await expect(row(page, 'g1')).toBeVisible();
  expect((await entry(page, 'g1')).stack.order).toEqual(['burn1']);
  await row(page, 'dodge1').dragTo(row(page, 'g1'));
  expect((await entry(page, 'g1')).stack.order).toEqual(['burn1', 'dodge1']);
  await expect(row(page, 'dodge1')).toHaveCSS('--depth', '1');
  // a mask from the burn's chip: a luminance range, shown in the mask panel
  await row(page, 'burn1').locator('.cb-stack-mask').click();
  await page.getByRole('menuitem', { name: 'New mask: Luminance range' }).click();
  expect((await entry(page, 'burn1')).mask).toBe('m1');
  await expect(row(page, 'burn1').locator('.cb-stack-mask')).toContainText('Mask 1');
  const masks = panel(page, 'layer-masks-print');
  await expect(masks.locator('.cb-stack-comp')).toHaveCount(1);
  await masks.locator('input[aria-label="Invert the mask"]').check();
  expect(await hook<boolean>(page, 'cb.doc().masks.items.m1.invert')).toBe(true);
  // reorder by drag: the main exposure after the group
  await row(page, 'main').dragTo(row(page, 'g1'), { targetPosition: { x: 20, y: 2 } });
  expect(await order(page)).toEqual(['lights', 'main', 'g1']);
  // rename by double-click
  await row(page, 'g1').locator('.cb-stack-name').dblclick();
  await page.locator('.cb-stack-rename').fill('Sky');
  await page.locator('.cb-stack-rename').press('Enter');
  expect((await entry(page, 'g1')).name).toBe('Sky');
  // every change was one step; undo walks them back to the two entries the frame opened with
  const n = await steps(page);
  expect(n).toBe(11);
  await page.locator('.cb-hist').first().click();
  for (let i = 0; i < n; i++) await page.keyboard.press('ControlOrMeta+z');
  expect(await order(page)).toEqual(['main', 'lights']);
  await expect(exp.locator('.cb-stack-row')).toHaveCount(2);
});

test('provenance: an approved agent proposal makes the row chip say Agent; a user change says You', async ({ page }) => {
  await open(page, 'classic');
  await page.keyboard.press('d');
  await addLayer(page, 'exposures', 'Flash');
  await expect(row(page, 'flash1').locator('.cb-stack-prov')).toHaveText('You');
  await hook(page, `cb.propose([{ op: 'set', path: 'flash1.amount', value: 0.4 }], 'less flash')`);
  await page.locator('#pending li .approve').first().click();
  await expect(row(page, 'flash1').locator('.cb-stack-prov')).toHaveText('Agent');
  await expect(row(page, 'flash1').locator('.cb-stack-prov')).toHaveAttribute('data-tip', /last changed by Agent/);
  expect((await entry(page, 'flash1')).amount).toBe(0.4);
});

test('classic Edit: the print stage — + Layer clarity, its controls, a mask drawn with the linear tool, undo', async ({ page }) => {
  await open(page, 'classic');
  await page.locator('.ck-module[data-module="edit"]').click();
  const layers = panel(page, 'layers-edit');
  await expect(layers).toContainText('No layers yet');
  await addLayer(page, 'layers-edit', 'Clarity');
  await expect(row(page, 'clarity1')).toBeVisible();
  const params = panel(page, 'layer-params-edit');
  await expect(params.locator('.cb-arg[data-path="clarity1.params.strength"]')).toBeVisible();
  await expect(params.locator('.cb-arg[data-path="clarity1.params.radius_mm"]')).toBeVisible();
  // the amount is opacity on the print
  await expect(row(page, 'clarity1').locator('.cb-stack-amount')).toHaveAttribute('title', /opacity/);
  // the linear gradient tool draws a component into the selected layer's mask
  await panel(page, 'layer-masks-edit').locator('.cb-stack-tool-mask-linear').click();
  const vp = page.locator('.ck-vp:visible').first();
  const b = (await vp.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height * 0.6, { steps: 4 });
  await page.mouse.up();
  expect((await entry(page, 'clarity1')).mask).toBe('m1');
  expect(await hook<string>(page, `cb.doc().masks.items.m1.components.items.m1c1.kind`)).toBe('linear');
  await page.keyboard.press('ControlOrMeta+z');
  expect((await entry(page, 'clarity1')).mask).toBe(null);
  await page.keyboard.press('ControlOrMeta+z');
  expect(await order(page, 'print')).toEqual([]);
});
