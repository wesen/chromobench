const { waitRender, count, sample } = await import('./common.mjs?' + Date.now());
export default async ({ page, shot, readProbe }) => {
  const r = {};
  await page.locator('.ck-menubar-t', { hasText: 'View' }).click(); await page.waitForTimeout(250);
  await page.locator('.ck-menu').getByText('Layout…').click(); await page.waitForTimeout(600);
  r.dialog = await page.evaluate(() => document.querySelector('.ck-dialog, [role=dialog]')?.innerText);
  await shot('31-layout-dialog');
  return r;
};
