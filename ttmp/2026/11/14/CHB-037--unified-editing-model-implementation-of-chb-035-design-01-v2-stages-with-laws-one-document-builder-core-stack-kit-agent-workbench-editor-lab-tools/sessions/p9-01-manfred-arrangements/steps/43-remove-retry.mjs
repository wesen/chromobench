export default async ({ page, shot, readProbe }) => {
  const r = {};
  await page.locator('button.ck-module', { hasText: /^Library$/ }).click(); await page.waitForTimeout(1500); await page.getByText('landscape-negative.tif', { exact: true }).first().click(); await page.waitForTimeout(800);
  await page.locator('.ck-menubar-t', { hasText: 'Frame' }).click(); await page.waitForTimeout(250);
  await page.locator('.ck-menu').getByText('Remove from Library').click(); await page.waitForTimeout(1200);
  r.dialog = await page.evaluate(() => document.querySelector('.ck-dialog, [role=dialog]')?.innerText);
  if (r.dialog) { const b = page.locator('.ck-dialog button, [role=dialog] button'); r.buttons = await b.allInnerTexts(); const ok = b.filter({ hasText: /Remove/ }); if (await ok.count()) await ok.first().click(); await page.waitForTimeout(1000); }
  r.p0 = await readProbe();
  r.panel0 = await page.evaluate(() => document.body.innerText.match(/\d+ open frames[^\n]*/)?.[0]);
  await page.locator('button.ck-module', { hasText: /^Roll$/ }).click(); await page.waitForTimeout(1200); await page.getByRole('button', { name: /New roll from open frames/i }).click(); await page.waitForTimeout(1500);
  r.p1 = await readProbe();
  r.panel = await page.evaluate(() => { const els = [...document.querySelectorAll('*')].filter(e => e.getBoundingClientRect().y > 70 && e.getBoundingClientRect().y < 880 && e.children.length === 0 && e.innerText?.trim()); return els.map(e => e.innerText.trim()).slice(0, 60).join(' | '); });
  await shot('53-roll-retry');
  return r;
};
