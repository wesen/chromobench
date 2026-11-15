const { waitRender, count, sample } = await import('./common.mjs?' + Date.now());
export default async ({ page, shot, readProbe }) => {
  const r = {};
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Ring-around' }).click();
  // wait until the picture area settles
  let last = ''; for (let i = 0; i < 120; i++) { const s = await page.evaluate(() => document.body.innerText.split('\n').slice(-1)[0]); if (s !== last) { last = s; } if (/done/.test(s) && Date.now() - t0 > 2000) break; await page.waitForTimeout(500); }
  r.ms = Date.now() - t0; r.status = last;
  await page.waitForTimeout(1000);
  r.text = await page.evaluate(() => document.querySelector('.ck-vp, main')?.innerText?.slice(0, 600));
  await shot('34-ring-around');
  r.probe = await readProbe();
  return r;
};
