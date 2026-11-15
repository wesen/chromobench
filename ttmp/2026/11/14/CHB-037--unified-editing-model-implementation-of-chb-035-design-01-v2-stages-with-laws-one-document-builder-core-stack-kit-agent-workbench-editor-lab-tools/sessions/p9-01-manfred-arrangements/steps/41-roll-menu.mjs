export default async ({ page, shot, readProbe }) => {
  const r = {};
  await page.locator('.ck-menubar-t', { hasText: 'Roll' }).click(); await page.waitForTimeout(250);
  r.rollMenu = await page.locator('.ck-menu').allInnerTexts();
  const item = page.locator('.ck-menu').getByText(/New Roll/i).first();
  if (await item.count()) { await item.click(); await page.waitForTimeout(1200); } else await page.keyboard.press('Escape');
  r.dialog1 = await page.evaluate(() => document.querySelector('.ck-dialog, [role=dialog]')?.innerText);
  r.p1 = await readProbe();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /First print/ }).click(); await page.waitForTimeout(1500);
  r.dialog2 = await page.evaluate(() => document.querySelector('.ck-dialog, [role=dialog]')?.innerText);
  await shot('51-first-print-roll');
  r.p2 = await readProbe();
  return r;
};
