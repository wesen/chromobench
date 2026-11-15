// The stack kit's editors in the real studio on the WebGPU engine (SwiftShader in CI), with the host's editorMath
// (core's curve and encodings): the Edit module adds a curve, the stage input's histogram is measured on the GPU and
// drawn behind it, a point dragged up brightens the print (one step); a colour range on a vibrance layer takes its
// colour from the print with the eyedropper (one step, the print changes); undo gives the earlier prints back.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { opened } from './support.ts';

const NEG = { name: 'neg.tif', mimeType: 'image/tiff', buffer: readFileSync(new URL('../fixtures/synthetic/m1-negative-96x64.tif', import.meta.url).pathname) };
const idle = (page: Page) => page.evaluate(() => window.chromobench.idle());
const rendered = (page: Page) => page.locator('.ck-vp:visible').first();
const shown = (page: Page) => page.evaluate(() => window.chromobench.printNode());
const panel = (page: Page, id: string) => page.locator(`.ck-panel[data-panel="${id}"]`).first();
const items = (page: Page) => page.evaluate(() => window.chromobench.doc!.stages.print.stack.items as Record<string, any>);

test('editors on the GPU engine: a curve point dragged up, a colour range sampled with the eyedropper, undo', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/?nosw&canvas2d&fresh&engine=gpu&layout=classic');
  await page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: 60_000 });
  await page.setInputFiles('#file', NEG);
  await opened(page, 1, 120_000);
  await page.locator('.ck-module[data-module="edit"]').click();
  await expect(rendered(page)).toHaveAttribute('data-rendered', /\d+x\d+/);
  const n0 = await shown(page);
  // + Layer → Curve: an identity curve changes nothing; its editor shows the stage input's histogram
  await panel(page, 'layers-edit').locator('.cb-stack-add').click();
  await page.getByRole('menuitem', { name: 'Curve', exact: true }).click();
  await idle(page);
  const plane = panel(page, 'layer-params-edit').locator('.cb-ed-curve .ck-curve-g');
  await expect(plane.locator('.ck-curve-hist')).toHaveAttribute('d', /^M0 /, { timeout: 30_000 });
  expect(await shown(page)).toBe(n0);
  // a point at the midtones, dragged up: one step, a brighter print
  const b = (await plane.boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.32, { steps: 6 });
  await page.mouse.up();
  await idle(page);
  const pts = (await items(page))['curve1'].params.points;
  expect(pts.order).toEqual(['curve1p1', 'curve1p3', 'curve1p2']);
  expect(pts.items.curve1p3.y).toBeGreaterThan(0.6);
  await expect(rendered(page)).toHaveAttribute('data-rendered', /\d+x\d+/);
  const n1 = await shown(page);
  expect(n1).not.toBe(n0);
  // + Layer → Vibrance, a colour range from the masks panel, Sample, a click on the print
  await panel(page, 'layers-edit').locator('.cb-stack-add').click();
  await page.getByRole('menuitem', { name: 'Vibrance', exact: true }).click();
  await idle(page);
  const masks = panel(page, 'layer-masks-edit');
  await masks.locator('.cb-stack-new-colour').click();
  await idle(page);
  const n2 = await shown(page);
  await masks.locator('.cb-ed-colour .cb-stack-sample').click();
  const vp = (await rendered(page).boundingBox())!;
  await page.mouse.click(vp.x + vp.width / 2, vp.y + vp.height / 2);
  await expect.poll(async () => (await page.evaluate(() => (window.chromobench.doc!.masks.items['m1'] as any).components.items['m1c1'].params.colour)) as number[]).not.toEqual([0.7, 0, 0]);
  await idle(page);
  await expect(rendered(page)).toHaveAttribute('data-rendered', /\d+x\d+/);
  const n3 = await shown(page);
  expect(n3).not.toBe(n2);
  // five steps (curve, its point, vibrance, the colour range, its sample); undo the last four: the print without the point
  expect(await page.evaluate(() => window.chromobench.units())).toBe(5);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < 4; i++) await page.keyboard.press('ControlOrMeta+z');
  await idle(page);
  expect(await shown(page)).toBe(n0);
  expect(errors).toEqual([]);
});
