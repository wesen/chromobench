const times = (page) => page.evaluate(() => { const s = window.chromobench.studio; const out = {}; for (const f of (s.frames.all?.() ?? [])) { const id = f.id ?? f; const d = s.doc(id); out[s.frames.get(id)?.name] = d?.stages?.darkroom?.stack?.items?.main?.params?.time_s; } return out; });
export default async ({ page, shot, readProbe }) => {
  const r = {};
  await page.getByText('roll-12-frame-3.tif', { exact: true }).last().click(); await page.waitForTimeout(1500);
  for (const k of [1, 2, 4]) { await page.getByText(`roll-12-frame-${k}.tif`, { exact: true }).last().click({ modifiers: ['Meta'] }); await page.waitForTimeout(600); }
  r.label = await page.evaluate(() => document.querySelector('.ck-vp-label')?.innerText);
  await page.locator('.ck-menubar-t', { hasText: 'Frame' }).click(); await page.waitForTimeout(250);
  await page.locator('.ck-menu').getByText('Apply Print Settings to Selection').click();
  const t0 = Date.now(); await page.waitForTimeout(4000);
  r.p1 = await readProbe();
  r.times1 = await times(page);
  await shot('57-applied-roll');
  await page.locator('.ck-menubar-t', { hasText: 'Edit' }).click(); await page.waitForTimeout(250);
  r.editMenu = await page.locator('.ck-menu').allInnerTexts(); await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+z'); await page.waitForTimeout(3000);
  r.p2 = await readProbe();
  r.times2 = await times(page);
  await page.keyboard.press('Meta+Shift+z'); await page.waitForTimeout(3000);
  r.times3 = await times(page);
  r.p3 = await readProbe();
  return r;
};
