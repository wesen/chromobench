export default async ({ page, shot, readProbe }) => {
  const r = {};
  await page.locator('.ck-menubar-t', { hasText: 'File' }).click(); await page.waitForTimeout(250);
  await page.locator('.ck-menu').getByText('Export…').click(); await page.waitForTimeout(800);
  r.dialog = await page.evaluate(() => document.querySelector('.ck-dialog, [role=dialog]')?.innerText);
  r.selects = await page.evaluate(() => [...document.querySelectorAll('.ck-dialog select, [role=dialog] select')].map(s => [s.getAttribute('aria-label') ?? s.name, [...s.options].map(o => o.text), s.value]));
  await shot('28-export-dialog');
  return r;
};
