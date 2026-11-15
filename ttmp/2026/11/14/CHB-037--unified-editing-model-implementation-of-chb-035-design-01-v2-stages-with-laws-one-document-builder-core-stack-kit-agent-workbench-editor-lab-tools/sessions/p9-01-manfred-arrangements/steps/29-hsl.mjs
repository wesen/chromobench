const { waitRender, count, sample } = await import('./common.mjs?' + Date.now());
export default async ({ page, shot, readProbe }) => {
  const r = {};
  await page.getByRole('button', { name: 'Add a layer to the print stage' }).click(); await page.waitForTimeout(300);
  let n = await count(page); let t0 = Date.now();
  await page.locator('.ck-menu, .ck-pop').last().getByText('HSL', { exact: true }).click();
  r.add = await waitRender(page, n, t0, 6000);
  await page.waitForTimeout(500);
  r.hist = await page.evaluate(() => document.body.innerText.match(/You [^\n]*/g)?.slice(-2));
  r.ranges = await page.evaluate(() => [...document.querySelectorAll('input[type=range]')].filter(e => e.getBoundingClientRect().x > 1130).map(e => e.getAttribute('aria-label')));
  r.buttons = await page.evaluate(() => [...document.querySelectorAll('button')].filter(e => e.getBoundingClientRect().x > 1130 && e.getBoundingClientRect().y < 900).map(e => e.innerText).join(' | '));
  await shot('37-hsl-added');
  r.probe = await readProbe();
  return r;
};
