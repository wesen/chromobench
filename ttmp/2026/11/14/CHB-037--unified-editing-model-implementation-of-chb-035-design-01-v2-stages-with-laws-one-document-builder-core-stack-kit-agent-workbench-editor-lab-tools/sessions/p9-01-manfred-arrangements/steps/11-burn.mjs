const { waitRender, count, sample } = await import('./common.mjs?' + Date.now());
export default async ({ page, shot, readProbe }) => {
  const r = {};
  await page.getByRole('button', { name: 'Add a layer to the darkroom stage' }).click(); await page.waitForTimeout(400);
  r.pop = await page.locator('.ck-menu, .ck-pop').allInnerTexts();
  await shot('14-plus-layer');
  const n = await count(page); const t0 = Date.now();
  await page.locator('.ck-menu, .ck-pop').last().getByText('Burn', { exact: true }).click();
  r.render = await waitRender(page, n, t0, 10000);
  await page.waitForTimeout(500);
  r.enlarger = (await page.locator('text=Enlarger').first().locator('xpath=ancestor::*[contains(@class,"ck-panel") or contains(@class,"ck-dock")][1]').innerText().catch(() => '')).slice(0, 1500);
  r.layerPanel = await page.evaluate(() => document.body.innerText.split('Digital (after the print)')[1]?.slice(0, 1200));
  r.colours = await sample(page);
  r.probe = await readProbe();
  await shot('15-burn-added');
  return r;
};
