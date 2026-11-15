const { waitRender, count, sample } = await import('./common.mjs?' + Date.now());
const menu = async (page, name) => { await page.locator('.ck-menubar-t', { hasText: name }).first().click(); await page.waitForTimeout(300); const t = await page.locator('.ck-menu').allInnerTexts(); return t; };
export default async ({ page, shot, readProbe }) => {
  const r = {};
  await page.mouse.click(670, 120); // click grey area near picture, away from fields
  const n = await count(page); const t0 = Date.now();
  await page.keyboard.press('Backslash'); await page.waitForTimeout(1500);
  r.ba = { render: await waitRender(page, n, t0, 6000), colours: await sample(page), label: await page.evaluate(() => document.querySelector('.ck-vp-label')?.innerText) };
  await shot('25-before-backslash');
  r.overlay = await page.evaluate(() => document.body.innerText.match(/[^\n]*(Before|before|Vorher|original)[^\n]*/g));
  await page.keyboard.press('Backslash'); await page.waitForTimeout(1000);
  r.back = await sample(page);
  r.view = await menu(page, 'View'); await shot('26-view-menu'); await page.keyboard.press('Escape');
  r.frame = await menu(page, 'Frame'); await page.keyboard.press('Escape');
  r.window = await menu(page, 'Window'); await page.keyboard.press('Escape');
  r.edit = await menu(page, 'Edit'); await page.keyboard.press('Escape');
  r.probe = await readProbe();
  return r;
};
