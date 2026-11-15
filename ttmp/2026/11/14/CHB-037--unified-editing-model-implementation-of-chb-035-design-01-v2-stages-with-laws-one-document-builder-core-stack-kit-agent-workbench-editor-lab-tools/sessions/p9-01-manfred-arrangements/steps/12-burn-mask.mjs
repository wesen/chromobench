const { waitRender, count, sample } = await import('./common.mjs?' + Date.now());
export default async ({ page, shot, readProbe }) => {
  const r = {};
  const lin = page.getByRole('button', { name: 'Linear', exact: true });
  r.linCount = await lin.count();
  await lin.first().scrollIntoViewIfNeeded();
  await shot('16-layer-panel-burn');
  await lin.first().click(); await page.waitForTimeout(400);
  r.after = await page.evaluate(() => document.body.innerText.match(/(Burn acts[^\n]*|[^\n]*drag[^\n]*|[^\n]*Drag[^\n]*)/g));
  r.status = await page.evaluate(() => document.body.innerText.split('\n').slice(-4));
  await shot('17-linear-chosen');
  // drag on the print: from the top of the sky (y=160) down to just above the hills (y=420), in the middle
  const n = await count(page); const t0 = Date.now();
  await page.mouse.move(670, 170); await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(670, 170 + i * 25); await page.waitForTimeout(40); }
  await page.mouse.up();
  r.render = await waitRender(page, n, t0, 15000);
  await page.waitForTimeout(500);
  r.colours = await sample(page);
  r.probe = await readProbe();
  await shot('18-burn-gradient');
  return r;
};
