const { waitRender, count, sample, drag } = await import('./common.mjs?' + Date.now());
export default async ({ page, shot, readProbe }) => {
  const r = {};
  let n = await count(page); let t0 = Date.now();
  r.grade = await drag(page, 'Grade', 40);
  r.gradeRender = await waitRender(page, n, t0, 10000);
  r.colours = await sample(page);
  // Paper dropdown options as he sees them
  r.papers = await page.locator('select').evaluateAll(ss => ss.map(s => [s.getAttribute('aria-label'), [...s.options].map(o => o.text).join(' | ')]));
  // the darkroom's "Density mask" -- what is it? Look at it in + Layer
  await page.getByText('Digital (after the print)').click(); await page.waitForTimeout(600);
  r.digital = await page.evaluate(() => document.body.innerText.split('Digital (after the print)')[1]?.slice(0, 600));
  await shot('22-grade3-digital-open');
  r.probe = await readProbe();
  return r;
};
