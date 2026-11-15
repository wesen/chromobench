const { waitRender, count, sample } = await import('./common.mjs?' + Date.now());
export default async ({ page, shot, readProbe }) => {
  const r = {};
  // colour grading layer
  await page.getByRole('button', { name: 'Add a layer to the print stage' }).click(); await page.waitForTimeout(300);
  await page.locator('.ck-menu, .ck-pop').last().getByText('Colour grading', { exact: true }).click(); await page.waitForTimeout(800);
  r.cgRanges = await page.evaluate(() => [...document.querySelectorAll('input[type=range]')].filter(e => e.getBoundingClientRect().x > 1130 && e.offsetParent).map(e => e.getAttribute('aria-label')));
  r.cgText = await page.evaluate(() => { const els = [...document.querySelectorAll('*')].filter(e => e.getBoundingClientRect().x > 1130 && e.getBoundingClientRect().y < 880 && e.children.length === 0 && e.innerText?.trim()); return els.map(e => e.innerText.trim()).slice(0, 60).join(' | '); });
  // move a shadows/highlights control: drag the first visible slider after Amount a bit
  const sl = page.locator('input[type=range]').filter({ visible: true });
  const labels = await sl.evaluateAll(es => es.map(e => [e.getAttribute('aria-label'), Math.round(e.getBoundingClientRect().x)]));
  const idx = labels.findIndex(([l, x]) => x > 1130 && l && l !== 'Amount');
  r.dragged = labels[idx];
  if (idx >= 0) { const b = await sl.nth(idx).boundingBox(); const n = await count(page); const t0 = Date.now();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); for (let i = 1; i <= 8; i++) { await page.mouse.move(b.x + b.width / 2 + i * 6, b.y + b.height / 2); await page.waitForTimeout(30); } await page.mouse.up();
    r.cgRender = await waitRender(page, n, t0, 10000); }
  await shot('39-colour-grading');
  // blend mode on this layer via the Layer panel's Blend select
  let n = await count(page); let t0 = Date.now();
  await page.getByLabel('Blend', { exact: true }).selectOption({ label: 'Soft Light' });
  r.blendRender = await waitRender(page, n, t0, 10000);
  // group: select HSL row with shift-click, then Layer ▸ Group Layer (⌘G)
  const rows = page.locator('.cb-stack-row, [class*=stack] [class*=row]');
  r.rowTexts = await page.evaluate(() => [...document.querySelectorAll('[class*=stack-row], [class*=layer-row]')].map(e => e.className + ' :: ' + e.innerText.split('\n')[0]).slice(0, 10));
  r.hist = await page.evaluate(() => document.body.innerText.match(/You [^\n]*/g)?.slice(-4));
  r.probe = await readProbe();
  return r;
};
