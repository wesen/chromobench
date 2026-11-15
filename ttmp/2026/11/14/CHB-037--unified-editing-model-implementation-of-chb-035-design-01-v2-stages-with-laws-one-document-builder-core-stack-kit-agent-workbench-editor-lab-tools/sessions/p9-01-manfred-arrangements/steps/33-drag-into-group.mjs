const { waitRender, count, sample } = await import('./common.mjs?' + Date.now());
export default async ({ page, shot, readProbe }) => {
  const r = {};
  const src = await page.locator('.cb-stack-row', { hasText: 'HSL' }).first().locator('text=HSL').first().boundingBox();
  const dst = await page.locator('.cb-stack-row', { hasText: 'Colour grading' }).first().boundingBox();
  r.draggable = await page.evaluate(() => [...document.querySelectorAll('.cb-stack-row')].map(e => e.draggable + ':' + e.innerText.split('\n')[0]));
  await page.mouse.move(src.x + 10, src.y + 6); await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(src.x + 10, src.y + 6 + ((dst.y + dst.height / 2) - (src.y + 6)) * i / 12); await page.waitForTimeout(40); }
  await page.mouse.up(); await page.waitForTimeout(1000);
  r.rows = await page.evaluate(() => [...document.querySelectorAll('.cb-stack-row')].map(e => e.className.replace('cb-stack-row', '').trim() + ':' + e.innerText.split('\n')[0]));
  r.hist = await page.evaluate(() => document.body.innerText.match(/You [^\n]*/g)?.slice(-2));
  // also try the HTML5 drag API the way a real mouse does in Chromium
  if (!/HSL/.test(JSON.stringify(r.hist))) {
    await page.locator('.cb-stack-row', { hasText: 'HSL' }).first().dragTo(page.locator('.cb-stack-row', { hasText: 'Colour grading' }).first()).catch(e => r.dragToErr = String(e).slice(0, 100));
    await page.waitForTimeout(1000);
    r.rows2 = await page.evaluate(() => [...document.querySelectorAll('.cb-stack-row')].map(e => e.className.replace('cb-stack-row', '').trim() + ':' + e.innerText.split('\n')[0]));
    r.hist2 = await page.evaluate(() => document.body.innerText.match(/You [^\n]*/g)?.slice(-2));
  }
  r.probe = await readProbe();
  return r;
};
