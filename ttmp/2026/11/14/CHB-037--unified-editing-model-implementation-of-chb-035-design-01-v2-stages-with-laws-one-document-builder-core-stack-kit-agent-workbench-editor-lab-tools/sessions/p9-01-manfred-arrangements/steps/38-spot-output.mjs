const { waitRender, count } = await import('./common.mjs?' + Date.now());
export default async ({ page, shot, readProbe }) => {
  const r = {};
  await page.getByText('Spots (Q)', { exact: true }).click(); await page.waitForTimeout(500);
  let n = await count(page); let t0 = Date.now();
  await page.mouse.click(700, 200); // a "dust spot" in the sky
  r.spot = await waitRender(page, n, t0, 15000);
  r.hist = await page.evaluate(() => document.body.innerText.match(/You [^\n]*/g)?.slice(-2));
  await shot('47-spot');
  await page.keyboard.press('Escape');
  t0 = Date.now();
  await page.locator('button.ck-module', { hasText: /^Output$/ }).click(); await page.waitForTimeout(2000);
  r.outText = await page.evaluate(() => { const els = [...document.querySelectorAll('*')].filter(e => (e.getBoundingClientRect().x > 1130 || e.getBoundingClientRect().x < 260) && e.getBoundingClientRect().y > 70 && e.children.length === 0 && e.innerText?.trim()); return els.map(e => e.innerText.trim()).slice(0, 80).join(' | '); });
  await shot('48-output-module');
  r.probe = await readProbe();
  return r;
};
