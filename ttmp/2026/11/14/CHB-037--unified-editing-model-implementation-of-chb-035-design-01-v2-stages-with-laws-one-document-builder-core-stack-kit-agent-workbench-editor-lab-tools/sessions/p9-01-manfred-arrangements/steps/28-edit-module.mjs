export default async ({ page, shot, readProbe }) => {
  const r = {};
  const mods = page.locator('.ck-modbar button, .ck-modules button, [class*=mod] button');
  r.modTexts = await page.evaluate(() => [...document.querySelectorAll('button, a, [role=tab]')].filter(b => b.getBoundingClientRect().y > 35 && b.getBoundingClientRect().y < 65).map(b => [b.innerText, b.className]));
  const t0 = Date.now();
  await page.locator('button', { hasText: /^Edit$/ }).filter({ has: page.locator(':scope') }).last().click().catch(e => r.err = String(e).slice(0, 200));
  await page.waitForTimeout(2000);
  r.ms = Date.now() - t0;
  r.right = await page.evaluate(() => { const els = [...document.querySelectorAll('*')].filter(e => e.getBoundingClientRect().x > 1130 && e.children.length === 0 && e.innerText?.trim()); return els.map(e => e.innerText.trim()).slice(0, 120).join(' | '); });
  await shot('36-edit-module');
  r.probe = await readProbe();
  return r;
};
