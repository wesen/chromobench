// The stack kit in the real studio on the WebGPU engine (SwiftShader in CI): the classic Print module's Exposures
// panel adds a burn through a radial mask drawn on the print and renders it; the Edit module adds a clarity layer on
// the print stage, fades it, and the print changes and comes back with Undo. Every edit is one step of the log.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { opened } from './support.ts';

const NEG = { name: 'neg.tif', mimeType: 'image/tiff', buffer: readFileSync(new URL('../fixtures/synthetic/m1-negative-96x64.tif', import.meta.url).pathname) };
const idle = (page: Page) => page.evaluate(() => window.chromobench.idle());
const rendered = (page: Page) => page.locator('.ck-vp:visible').first();
const shown = (page: Page) => page.evaluate(() => window.chromobench.printNode());
const panel = (page: Page, id: string) => page.locator(`.ck-panel[data-panel="${id}"]`).first();

test('stack on the GPU engine: a burn through a radial mask in the darkroom, clarity faded on the print, undo', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?nosw&canvas2d&fresh&engine=gpu&layout=classic');
  await page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: 60_000 });
  await page.setInputFiles('#file', NEG);
  await opened(page, 1, 120_000);
  await page.locator('.ck-module[data-module="print"]').click();
  await expect(rendered(page)).toHaveAttribute('data-rendered', /\d+x\d+/);
  const n0 = await shown(page);
  // a burn through a radial mask: the tool with no layer selected makes both, one step
  await page.evaluate(() => window.chromobench.tool('mask-radial'));
  const b = (await rendered(page).boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.4, b.y + b.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.6, { steps: 4 });
  await page.mouse.up();
  await idle(page);
  await expect(panel(page, 'exposures').locator('.cb-stack-row[data-id="burn1"]')).toBeVisible();
  await expect(panel(page, 'exposures').locator('.cb-stack-row[data-id="burn1"] .cb-stack-mask')).toContainText('Mask 1');
  const n1 = await shown(page);
  expect(n1).not.toBe(n0);
  await page.evaluate(() => window.chromobench.tool(null));
  // Edit: + Layer → Clarity on the print stage, faded to 40 %
  await page.locator('.ck-module[data-module="edit"]').click();
  await panel(page, 'layers-edit').locator('.cb-stack-add').click();
  await page.getByRole('menuitem', { name: 'Clarity', exact: true }).click();
  await idle(page);
  const amt = panel(page, 'layers-edit').locator('.cb-stack-row[data-id="clarity1"] .cb-stack-amount .cb-num');
  await amt.fill('40');
  await amt.press('Enter');
  await idle(page);
  expect(await page.evaluate(() => (window.chromobench.doc!.stages.print.stack.items['clarity1'] as { amount: number }).amount)).toBe(0.4);
  await expect(rendered(page)).toHaveAttribute('data-rendered', /\d+x\d+/);
  const n2 = await shown(page);
  expect(n2).not.toBe(n1);
  // three steps: the burn with its mask, the clarity layer, its amount; undo two of them: the print as after the burn
  expect(await page.evaluate(() => window.chromobench.units())).toBe(3);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  await idle(page);
  expect(await shown(page)).toBe(n1);
  expect(errors).toEqual([]);
});
