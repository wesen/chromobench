const { waitRender, count, sample } = await import('./common.mjs?' + Date.now());
export default async ({ page, shot, readProbe }) => {
  const r = {};
  const wheels = await page.evaluate(() => [...document.querySelectorAll('svg, canvas, [class*=wheel]')].map(e => { const b = e.getBoundingClientRect(); return [e.tagName, e.getAttribute('class'), Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; }).filter(x => x[2] > 1130 && x[4] > 40));
  r.wheels = wheels;
  const w = wheels.find(x => /wheel/.test(x[1] || '')) ?? wheels[0];
  if (w) { // Highlights wheel = the third one if three exist
    const ws = wheels.filter(x => x[4] === w[4] && x[1] === w[1]); const hw = ws[2] ?? ws[0];
    const cx = hw[2] + hw[4] / 2, cy = hw[3] + hw[5] / 2;
    const n = await count(page); const t0 = Date.now();
    // warm highlights: drag from centre toward orange (upper right-ish)
    await page.mouse.move(cx, cy); await page.mouse.down(); for (let i = 1; i <= 8; i++) { await page.mouse.move(cx + i * 2, cy - i * 1.5); await page.waitForTimeout(30); } await page.mouse.up();
    r.wheelRender = await waitRender(page, n, t0, 10000);
  }
  await shot('40-grading-wheel');
  // Group: click HSL row, shift-click Colour grading row, then ⌘G
  const hsl = page.locator('.cb-stack-row', { hasText: 'HSL' }).first();
  const cg = page.locator('.cb-stack-row', { hasText: 'Colour grading' }).first();
  await hsl.locator('text=HSL').first().click(); await page.waitForTimeout(300);
  await cg.locator('text=Colour grading').first().click({ modifiers: ['Shift'] }); await page.waitForTimeout(300);
  r.selected = await page.evaluate(() => [...document.querySelectorAll('.cb-stack-row')].map(e => e.className.includes('is-sel') + ':' + e.innerText.split('\n')[0]));
  const n = await count(page); const t0 = Date.now();
  await page.keyboard.press('Meta+g'); await page.waitForTimeout(1200);
  r.afterGroup = await page.evaluate(() => [...document.querySelectorAll('.cb-stack-row')].map(e => e.className.replace('cb-stack-row', '').trim() + ':' + e.innerText.split('\n')[0]));
  r.hist = await page.evaluate(() => document.body.innerText.match(/You [^\n]*/g)?.slice(-3));
  await shot('41-group');
  r.probe = await readProbe();
  return r;
};
