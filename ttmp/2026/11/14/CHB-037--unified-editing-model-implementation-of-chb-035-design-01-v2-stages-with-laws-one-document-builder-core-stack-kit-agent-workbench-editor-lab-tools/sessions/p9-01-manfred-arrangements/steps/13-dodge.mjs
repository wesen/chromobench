const { waitRender, count, sample, typeInto } = await import('./common.mjs?' + Date.now());
export default async ({ page, shot, readProbe }) => {
  const r = {};
  r.labels = await page.evaluate(() => [...document.querySelectorAll('input.cb-num')].map(e => e.getAttribute('aria-label')));
  let n = await count(page); let t0 = Date.now();
  r.stops = await typeInto(page, 'Stops value', '1'); r.stopsRender = await waitRender(page, n, t0, 10000);
  await page.getByRole('button', { name: 'Add a layer to the darkroom stage' }).click(); await page.waitForTimeout(300);
  n = await count(page); t0 = Date.now();
  await page.locator('.ck-menu, .ck-pop').last().getByText('Dodge', { exact: true }).click();
  r.dodgeAdd = await waitRender(page, n, t0, 10000);
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Linear', exact: true }).first().click(); await page.waitForTimeout(300);
  n = await count(page); t0 = Date.now();
  await page.mouse.move(670, 755); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(670, 755 - i * 22); await page.waitForTimeout(40); }
  await page.mouse.up();
  r.dodgeMask = await waitRender(page, n, t0, 15000);
  n = await count(page); t0 = Date.now();
  r.dstops = await typeInto(page, 'Stops value', '1'); r.dstopsRender = await waitRender(page, n, t0, 10000);
  r.colours = await sample(page);
  r.probe = await readProbe();
  await shot('19-dodge-foreground');
  return r;
};
