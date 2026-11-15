export default async ({ page, shot, readProbe }) => {
  const t0 = Date.now();
  await page.goto('http://localhost:5516/?layout=darkroom&nosw');
  await page.waitForFunction(() => window.chromobench, null, { timeout: 60000 });
  const tLoad = Date.now() - t0;
  await page.waitForTimeout(1500);
  const s = await shot('01-darkroom-empty');
  const engine = await page.evaluate(() => window.chromobench.engineLabel ?? null).catch(() => null);
  const text = (await page.locator('body').innerText()).slice(0, 2500);
  return { tLoad, s, engine, text, probe: await readProbe() };
};
