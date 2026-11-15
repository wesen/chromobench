// MEASUREMENT ONLY: the button's export is cancelled by headless Chromium's save picker; time the same pipeline into memory.
export default async ({ page, shot, readProbe }) => {
  const t0 = Date.now();
  const x = await page.evaluate(async () => { const x = await window.chromobench.exportPng('srgb', 'tiff16'); return x && { keys: Object.keys(x), w: x.width, h: x.height, bits: x.bits, name: x.name, bytes: x.bytes?.length ?? x.blob?.size ?? x.size }; });
  const ms = Date.now() - t0;
  const st = await page.evaluate(() => document.body.innerText.split('\n').slice(-1)[0]);
  await shot('30-exported-status');
  return { ms, x, st, probe: await readProbe() };
};
