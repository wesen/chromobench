import { waitRender, count, history } from './common.mjs';
export default async ({ page, shot, readProbe }) => {
  const r = {};
  // Lighter button once
  let n = await count(page); let t0 = Date.now();
  await page.getByRole('button', { name: 'Lighter' }).click();
  r.lighter = await waitRender(page, n, t0);
  r.timeAfterLighter = await page.locator('text=Main exposure').locator('..').innerText().catch(()=>null);
  // Darker twice
  for (let i = 0; i < 2; i++) { n = await count(page); t0 = Date.now(); await page.getByRole('button', { name: 'Darker' }).click(); r['darker' + i] = await waitRender(page, n, t0); }
  // Drag the Time slider: find the slider under "Time"
  const sliders = page.locator('[role=slider], input[type=range]');
  r.nSliders = await sliders.count();
  const info = [];
  for (let i = 0; i < r.nSliders; i++) info.push([await sliders.nth(i).getAttribute('aria-label'), JSON.stringify(await sliders.nth(i).boundingBox())]);
  r.sliders = info;
  r.probe = await readProbe();
  r.shot = await shot('04-after-lighter-darker');
  r.hist = await history(page);
  return r;
};
