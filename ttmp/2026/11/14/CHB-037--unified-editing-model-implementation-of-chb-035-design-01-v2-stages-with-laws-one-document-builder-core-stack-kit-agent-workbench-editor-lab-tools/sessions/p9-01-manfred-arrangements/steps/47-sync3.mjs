const times = (page) => page.evaluate(() => { const s = window.chromobench.studio; const out = {}; for (const f of (s.frames.all?.() ?? [])) { const id = f.id ?? f; const d = s.doc(id); out[s.frames.get(id)?.name] = d?.stages?.darkroom?.stack?.items?.main?.params?.time_s; } return out; });
export default async ({ page, shot, readProbe }) => {
  const r = {};
  await page.keyboard.press('Meta+z'); await page.waitForTimeout(2500);
  r.t0 = await times(page);
  await page.getByText('roll-12-frame-1.tif', { exact: true }).last().click(); await page.waitForTimeout(1200);
  for (const k of [2, 4, 3]) { await page.getByText(`roll-12-frame-${k}.tif`, { exact: true }).last().click({ modifiers: ['Meta'] }); await page.waitForTimeout(600); }
  r.label = await page.evaluate(() => document.querySelector('.ck-vp-label')?.innerText);
  await page.locator('.ck-menubar-t', { hasText: 'Frame' }).click(); await page.waitForTimeout(250);
  await page.locator('.ck-menu').getByText('Apply Print Settings to Selection').click();
  await page.waitForTimeout(5000);
  r.t1 = await times(page);
  r.p = await readProbe();
  await shot('58-applied-from-frame3');
  return r;
};
