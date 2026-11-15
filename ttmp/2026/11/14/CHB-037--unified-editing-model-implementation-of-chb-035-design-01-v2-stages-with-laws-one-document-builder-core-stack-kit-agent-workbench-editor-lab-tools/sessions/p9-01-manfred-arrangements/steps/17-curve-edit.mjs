const { waitRender, count, sample } = await import('./common.mjs?' + Date.now());
export default async ({ page, shot, readProbe }) => {
  const r = {};
  const g = page.locator('svg.ck-curve-g');
  await g.scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
  const b = await g.boundingBox(); r.box = b;
  const at = (fx, fy) => [b.x + fx * b.width, b.y + (1 - fy) * b.height];
  const before = await sample(page);
  for (const [fx, fy, dy] of [[0.25, 0.25, 0.06], [0.75, 0.75, -0.06]]) {
    const [x, y] = at(fx, fy);
    const n = await count(page); const t0 = Date.now();
    await page.mouse.move(x, y); await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(x, y + (dy * b.height * i) / 8); await page.waitForTimeout(30); }
    await page.mouse.up();
    r['pt' + fx] = await waitRender(page, n, t0, 10000);
  }
  r.before = before; r.after = await sample(page);
  r.hist = await page.evaluate(() => document.body.innerText.match(/You [^\n]*curve[^\n]*|You Curve[^\n]*/gi));
  r.probe = await readProbe();
  await shot('24-s-curve');
  return r;
};
