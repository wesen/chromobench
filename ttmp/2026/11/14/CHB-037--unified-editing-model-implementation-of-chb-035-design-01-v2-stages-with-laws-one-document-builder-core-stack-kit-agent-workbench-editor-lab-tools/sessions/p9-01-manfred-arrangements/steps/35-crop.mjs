const { waitRender, count } = await import('./common.mjs?' + Date.now());
export default async ({ page, shot, readProbe }) => {
  const r = {};
  await page.getByRole('button', { name: /^Crop/ }).first().click(); await page.waitForTimeout(800);
  const vp = await page.locator('canvas.ck-vp-c').boundingBox(); r.vp = vp;
  await shot('43-crop-on');
  // the print occupies roughly x 267..1133, y 124..702 (from screenshots). Drag the left edge midpoint inward ~25 px.
  const n = await count(page); const t0 = Date.now();
  await page.mouse.move(268, 413); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(268 + i * 2.6, 413); await page.waitForTimeout(40); }
  await page.mouse.up(); await page.waitForTimeout(500);
  r.cropLabel = await page.evaluate(() => document.body.innerText.match(/[^\n]*°[^\n]*/)?.[0]);
  await page.getByRole('button', { name: 'Done' }).click(); await page.waitForTimeout(300);
  r.render = await waitRender(page, n, t0, 10000);
  r.crop = await page.evaluate(() => { const d = window.chromobench.doc; return d.geometry; });
  r.hist = await page.evaluate(() => document.body.innerText.match(/You [^\n]*/g)?.slice(-2));
  await shot('44-cropped');
  r.probe = await readProbe();
  return r;
};
