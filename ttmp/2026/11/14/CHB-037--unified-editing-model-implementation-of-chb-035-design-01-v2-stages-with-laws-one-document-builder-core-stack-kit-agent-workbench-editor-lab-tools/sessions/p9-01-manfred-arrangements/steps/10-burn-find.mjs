export default async ({ page, shot, readProbe }) => {
  const r = {};
  r.menuOpen = await page.locator('.ck-menu').count();
  if (!r.menuOpen) { await page.getByText('Layer', { exact: true }).first().click(); await page.waitForTimeout(300); }
  await page.getByText('Add to Darkroom').hover(); await page.waitForTimeout(400);
  r.sub = await page.locator('.ck-menu').allInnerTexts();
  await shot('13-add-to-darkroom');
  await page.getByText('Add to Print').hover(); await page.waitForTimeout(400);
  r.sub2 = await page.locator('.ck-menu').allInnerTexts();
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await page.mouse.click(1300, 860);
  r.plus = await page.evaluate(() => [...document.querySelectorAll('button')].filter(b => /Layer/.test(b.innerText)).map(b => [b.innerText, b.getAttribute('aria-label'), b.className]));
  return r;
};
