const { waitRender, count, sample } = await import('./common.mjs?' + Date.now());
export default async ({ page, shot, readProbe }) => {
  const r = {};
  await page.getByRole('radio', { name: 'Saturation' }).click(); await page.waitForTimeout(400);
  const vis = await page.evaluate(() => [...document.querySelectorAll('input[type=range]')].map((e, i) => [i, e.getAttribute('aria-label'), e.offsetParent !== null, Math.round(e.getBoundingClientRect().y)]).filter(x => x[2] && x[3] > 0));
  r.vis = vis;
  const blue = page.locator('input[type=range][aria-label=Blue]').filter({ visible: true }).first();
  const b = await blue.boundingBox(); r.blueBox = b;
  const before = await sample(page, { sky: [350, 200, 400, 60] });
  const n = await count(page); const t0 = Date.now();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(b.x + b.width / 2 + i * 5, b.y + b.height / 2); await page.waitForTimeout(30); }
  await page.mouse.up();
  r.render = await waitRender(page, n, t0, 10000);
  r.before = before; r.after = await sample(page, { sky: [350, 200, 400, 60] });
  r.hist = await page.evaluate(() => document.body.innerText.match(/You [^\n]*/g)?.slice(-2));
  await shot('38-hsl-blue-sat');
  r.probe = await readProbe();
  return r;
};
