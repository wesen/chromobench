const { waitRender, count, sample } = await import('./common.mjs?' + Date.now());
export default async ({ page, shot, readProbe }) => {
  const r = {};
  const add = page.getByRole('button', { name: 'Add a layer to the print stage' });
  await add.scrollIntoViewIfNeeded(); await add.click(); await page.waitForTimeout(300);
  let n = await count(page); let t0 = Date.now();
  await page.locator('.ck-menu, .ck-pop').last().getByText('Curve', { exact: true }).click();
  r.add = await waitRender(page, n, t0, 10000);
  await page.waitForTimeout(500);
  r.panel = await page.evaluate(() => document.body.innerText.split('Digital (after the print)')[1]?.slice(0, 900));
  r.canvases = await page.evaluate(() => [...document.querySelectorAll('canvas, svg')].map(e => { const b = e.getBoundingClientRect(); return [e.tagName, e.getAttribute('class'), Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; }).filter(x => x[4] > 60 && x[2] > 1100));
  await shot('23-curve-added');
  r.hist = await page.evaluate(() => document.body.innerText.match(/You Added[^\n]*/g));
  r.probe = await readProbe();
  return r;
};
