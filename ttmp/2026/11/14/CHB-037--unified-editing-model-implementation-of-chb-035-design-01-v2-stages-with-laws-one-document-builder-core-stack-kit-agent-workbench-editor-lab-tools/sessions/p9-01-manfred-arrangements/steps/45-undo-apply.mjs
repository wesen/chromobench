const times = (page) => page.evaluate(() => { const s = window.chromobench.studio; const out = {}; for (const f of (s.frames.all?.() ?? [])) { const id = f.id ?? f; const d = s.doc(id); out[s.frames.get(id)?.name] = d?.stages?.darkroom?.stack?.items?.main?.params?.time_s; } return out; });
export default async ({ page, shot, readProbe }) => {
  const r = {};
  await page.locator('.ck-menubar-t', { hasText: 'Edit' }).click(); await page.waitForTimeout(250);
  r.editMenu = await page.locator('.ck-menu').allInnerTexts(); await page.keyboard.press('Escape');
  await page.mouse.click(700, 800); // empty area of the filmstrip? no: a neutral spot below thumbnails
  await page.keyboard.press('Meta+z'); await page.waitForTimeout(2500);
  r.p = await readProbe();
  r.times = await times(page);
  await shot('56-after-one-undo');
  return r;
};
