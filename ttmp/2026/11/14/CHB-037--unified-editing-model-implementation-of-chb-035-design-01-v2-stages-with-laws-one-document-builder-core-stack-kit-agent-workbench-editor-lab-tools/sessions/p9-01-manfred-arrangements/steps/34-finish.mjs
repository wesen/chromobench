export default async ({ page, shot, readProbe }) => {
  const r = {};
  const t0 = Date.now();
  await page.locator('button.ck-module', { hasText: /^Finish$/ }).click(); await page.waitForTimeout(2000);
  r.ms = Date.now() - t0;
  r.right = await page.evaluate(() => { const els = [...document.querySelectorAll('*')].filter(e => (e.getBoundingClientRect().x > 1130 || e.getBoundingClientRect().x < 260) && e.getBoundingClientRect().y > 70 && e.children.length === 0 && e.innerText?.trim()); return els.map(e => e.innerText.trim()).slice(0, 90).join(' | '); });
  r.finishMenu = await (async () => { await page.locator('.ck-menubar-t', { hasText: 'Finish' }).click(); await page.waitForTimeout(250); const t = await page.locator('.ck-menu').allInnerTexts(); await page.keyboard.press('Escape'); return t; })();
  await shot('42-finish-module');
  r.probe = await readProbe();
  return r;
};
