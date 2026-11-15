const { waitRender, count, mainExp } = await import('./common.mjs?' + Date.now());
const times = (page) => page.evaluate(() => { const s = window.chromobench.studio; const out = {}; for (const f of (s.frames.all?.() ?? [])) { const id = f.id ?? f; const d = s.doc(id); const name = s.frames.get(id)?.name; out[name] = d?.stages?.darkroom?.stack?.items?.main?.params?.time_s; } return out; });
export default async ({ page, shot, readProbe }) => {
  const r = {};
  await page.locator('button.ck-module', { hasText: /^Print$/ }).click(); await page.waitForTimeout(1500);
  await page.locator('.ck-coll-row, [class*=film] *', { hasText: 'roll-12-frame-3.tif' }).last().click().catch(async () => page.getByText('roll-12-frame-3.tif', { exact: true }).last().click());
  await page.waitForTimeout(2500);
  r.label = await page.evaluate(() => document.querySelector('.ck-vp-label')?.innerText);
  for (let i = 0; i < 4; i++) { const n = await count(page); const t0 = Date.now(); await page.getByRole('button', { name: 'Darker' }).click(); r['darker' + i] = (await waitRender(page, n, t0, 8000)).doneMs; }
  r.main3 = await mainExp(page);
  await shot('54-frame3-darker');
  // select frame 4 too: shift-click in filmstrip
  await page.getByText('roll-12-frame-4.tif', { exact: true }).last().click({ modifiers: ['Shift'] }); await page.waitForTimeout(1200);
  r.selected = await page.evaluate(() => [...document.querySelectorAll('[class*=is-sel]')].map(e => e.innerText?.split('\n')[0]).filter(Boolean).slice(0, 8));
  r.label2 = await page.evaluate(() => document.querySelector('.ck-vp-label')?.innerText);
  r.timesBefore = await times(page).catch(e => String(e));
  await page.locator('.ck-menubar-t', { hasText: 'Frame' }).click(); await page.waitForTimeout(250);
  r.frameMenu = await page.locator('.ck-menu').allInnerTexts();
  await page.locator('.ck-menu').getByText('Apply Print Settings to Selection').click(); await page.waitForTimeout(3000);
  r.p = await readProbe();
  r.timesAfter = await times(page).catch(e => String(e));
  r.hist = await page.evaluate(() => document.body.innerText.match(/(You|Auto) [^\n]*/g)?.slice(-3));
  await shot('55-applied-to-selection');
  return r;
};
