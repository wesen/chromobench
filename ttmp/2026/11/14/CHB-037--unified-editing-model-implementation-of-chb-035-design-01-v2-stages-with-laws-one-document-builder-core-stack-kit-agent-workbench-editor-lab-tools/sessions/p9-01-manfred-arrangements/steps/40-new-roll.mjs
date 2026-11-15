const { waitRender, count } = await import('./common.mjs?' + Date.now());
const txt = (page) => page.evaluate(() => { const els = [...document.querySelectorAll('*')].filter(e => e.getBoundingClientRect().y > 70 && e.getBoundingClientRect().y < 760 && e.getBoundingClientRect().x > 230 && e.children.length === 0 && e.innerText?.trim()); return els.map(e => e.innerText.trim()).slice(0, 70).join(' | '); });
export default async ({ page, shot, readProbe }) => {
  const r = {};
  await page.locator('button.ck-module', { hasText: /^Roll$/ }).click(); await page.waitForTimeout(1500);
  r.before = await txt(page);
  await page.getByRole('button', { name: /New roll from open frames/i }).click(); await page.waitForTimeout(1000);
  r.dialog = await page.evaluate(() => document.querySelector('.ck-dialog, [role=dialog]')?.innerText);
  await shot('50-new-roll');
  if (r.dialog) {
    r.dialogButtons = await page.locator('.ck-dialog button, [role=dialog] button').allInnerTexts();
  }
  r.after = await txt(page);
  r.probe = await readProbe();
  return r;
};
