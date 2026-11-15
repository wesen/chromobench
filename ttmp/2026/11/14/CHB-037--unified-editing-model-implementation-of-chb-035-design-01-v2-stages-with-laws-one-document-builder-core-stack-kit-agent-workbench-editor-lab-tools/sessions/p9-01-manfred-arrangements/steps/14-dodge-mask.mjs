const { waitRender, count, sample } = await import('./common.mjs?' + Date.now());
export default async ({ page, shot, readProbe }) => {
  const r = {};
  const lin = page.getByRole('button', { name: 'Linear', exact: true }).first();
  r.linBox = await lin.boundingBox();
  await lin.click(); await page.waitForTimeout(800);
  r.pressed = await lin.evaluate(e => [e.className, e.getAttribute('aria-pressed')]);
  r.cursor = await page.evaluate(() => getComputedStyle(document.querySelector('canvas.ck-vp-c')).cursor);
  r.hint = await page.evaluate(() => document.body.innerText.match(/[^\n]*(drag|Drag|Ziehen)[^\n]*/g));
  await shot('20-linear-armed');
  const n = await count(page); const t0 = Date.now();
  await page.mouse.move(670, 740); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(670, 740 - i * 22); await page.waitForTimeout(40); }
  await page.mouse.up();
  r.render = await waitRender(page, n, t0, 15000);
  r.colours = await sample(page);
  r.probe = await readProbe();
  await shot('21-dodge-masked');
  return r;
};
