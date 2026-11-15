const { waitRender, count } = await import('./common.mjs?' + Date.now());
export default async ({ page, shot, readProbe }) => {
  const r = {};
  r.hist0 = await page.evaluate(() => document.body.innerText.match(/You [^\n]*/g)?.slice(-1));
  await page.locator('.ck-menubar-t', { hasText: 'Finish' }).click(); await page.waitForTimeout(250);
  await page.locator('.ck-menu').getByText('Crop & Straighten').click(); await page.waitForTimeout(1200);
  r.hint = await page.evaluate(() => document.body.innerText.match(/[^\n]*(crop|Crop)[^\n]*/g)?.slice(0, 8));
  await shot('45-crop-mode');
  return r;
};
