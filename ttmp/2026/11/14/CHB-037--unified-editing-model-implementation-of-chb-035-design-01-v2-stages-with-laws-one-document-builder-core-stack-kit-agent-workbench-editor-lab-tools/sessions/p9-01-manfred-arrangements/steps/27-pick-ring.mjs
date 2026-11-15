const { waitRender, count, sample } = await import('./common.mjs?' + Date.now());
export default async ({ page, shot, readProbe }) => {
  const r = {};
  const n = await count(page); const t0 = Date.now();
  await page.getByRole('button', { name: '+Y (−B)' }).click();
  r.render = await waitRender(page, n, t0, 15000);
  await page.waitForTimeout(800);
  r.filtr = await page.evaluate(() => [...document.querySelectorAll('input.cb-num')].filter(e => /Filtration|Printer/.test(e.getAttribute('aria-label'))).map(e => e.getAttribute('aria-label') + '=' + e.value));
  r.hist = await page.evaluate(() => document.body.innerText.match(/You [^\n]*/g)?.slice(-3));
  r.view = await page.evaluate(() => !!document.body.innerText.match(/Keep this one/));
  r.colours = await sample(page, { sky: [350, 200, 400, 60], wall: [440, 520, 40, 40] });
  await shot('35-ring-picked');
  r.probe = await readProbe();
  return r;
};
