export default async ({ page, shot, readProbe }) => {
  const r = {};
  const t0 = Date.now();
  await page.reload();
  await page.waitForFunction(() => window.chromobench, null, { timeout: 90000 });
  r.tHook = Date.now() - t0;
  await page.waitForTimeout(3000);
  r.text = (await page.locator('body').innerText()).slice(0, 600);
  await shot('60-after-reload');
  r.probe = await readProbe();
  return r;
};
