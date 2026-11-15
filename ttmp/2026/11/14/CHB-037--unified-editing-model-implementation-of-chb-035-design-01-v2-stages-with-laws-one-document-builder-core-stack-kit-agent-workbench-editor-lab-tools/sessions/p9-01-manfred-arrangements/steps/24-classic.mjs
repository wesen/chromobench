const { waitRender, count, sample } = await import('./common.mjs?' + Date.now());
export default async ({ page, shot, readProbe }) => {
  const r = {};
  const t0 = Date.now();
  await page.locator('.ck-dialog, [role=dialog]').getByRole('button', { name: 'Classic' }).click();
  await page.waitForTimeout(2500);
  r.ms = Date.now() - t0;
  r.url = page.url();
  r.text = (await page.locator('body').innerText()).slice(0, 2500);
  r.colours = await sample(page);
  await shot('32-classic-after-switch');
  r.probe = await readProbe();
  return r;
};
