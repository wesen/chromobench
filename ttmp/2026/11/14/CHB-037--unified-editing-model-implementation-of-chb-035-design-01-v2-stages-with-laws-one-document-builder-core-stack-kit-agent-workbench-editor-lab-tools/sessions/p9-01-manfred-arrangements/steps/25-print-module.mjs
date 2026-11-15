const { waitRender, count, sample } = await import('./common.mjs?' + Date.now());
export default async ({ page, shot, readProbe }) => {
  const r = {};
  const t0 = Date.now();
  await page.locator('.ck-modbar button, [role=tab], .ck-mod', { hasText: /^Print$/ }).first().click().catch(async () => { await page.getByText('Print', { exact: true }).nth(0).click(); });
  await page.waitForTimeout(2500);
  r.ms = Date.now() - t0;
  r.text = (await page.locator('body').innerText()).slice(0, 3000);
  r.strip = await page.evaluate(() => [...document.querySelectorAll('canvas.ck-thumb-c, img.ck-thumb-i')].map(e => { const b = e.getBoundingClientRect(); return [e.tagName, Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; }));
  await shot('33-classic-print');
  r.probe = await readProbe();
  return r;
};
