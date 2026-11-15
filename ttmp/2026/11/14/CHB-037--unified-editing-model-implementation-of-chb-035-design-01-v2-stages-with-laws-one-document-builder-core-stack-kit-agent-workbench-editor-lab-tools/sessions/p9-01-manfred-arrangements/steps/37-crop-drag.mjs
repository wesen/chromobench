const { waitRender, count } = await import('./common.mjs?' + Date.now());
export default async ({ page, shot, readProbe }) => {
  const r = {};
  const n = await count(page); const t0 = Date.now();
  await page.mouse.move(244, 413); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(244 + i * 2.8, 413); await page.waitForTimeout(40); }
  await page.mouse.up(); await page.waitForTimeout(500);
  r.size = await page.evaluate(() => document.body.innerText.match(/\d+ × \d+/g));
  await page.keyboard.press('Enter'); await page.waitForTimeout(500);
  r.render = await waitRender(page, n, t0, 10000);
  r.geometry = await page.evaluate(() => window.chromobench.doc.geometry);
  r.hist = await page.evaluate(() => document.body.innerText.match(/You [^\n]*/g)?.slice(-2));
  await shot('46-cropped');
  r.probe = await readProbe();
  return r;
};
