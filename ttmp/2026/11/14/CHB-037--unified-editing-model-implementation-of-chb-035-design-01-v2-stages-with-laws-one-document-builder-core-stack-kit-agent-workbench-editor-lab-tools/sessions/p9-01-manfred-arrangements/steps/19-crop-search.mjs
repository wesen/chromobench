const { waitRender, count, sample } = await import('./common.mjs?' + Date.now());
export default async ({ page, shot, readProbe }) => {
  const r = {};
  await page.keyboard.press('Backslash'); await page.waitForTimeout(300); // back from before/after? check
  r.ba = await page.evaluate(() => document.body.innerText.includes('Before'));
  if (r.ba) { await page.keyboard.press('Backslash'); await page.waitForTimeout(300); r.ba2 = await page.evaluate(() => document.body.innerText.includes('Before')); }
  const n = await count(page); const t0 = Date.now();
  await page.keyboard.press('Meta+z');
  r.undo = await waitRender(page, n, t0, 8000);
  r.cursorBefore = await page.evaluate(() => getComputedStyle(document.querySelector('canvas.ck-vp-c')).cursor);
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  r.cursorAfterEsc = await page.evaluate(() => getComputedStyle(document.querySelector('canvas.ck-vp-c')).cursor);
  await page.keyboard.press('Meta+k'); await page.waitForTimeout(400);
  await page.keyboard.type('crop'); await page.waitForTimeout(500);
  r.cmdCrop = await page.evaluate(() => document.querySelector('.ck-dialog, [role=dialog]')?.innerText);
  await shot('27-find-command-crop');
  await page.keyboard.press('Control+a'); await page.keyboard.press('Meta+a');
  await page.keyboard.press('Backspace'); await page.keyboard.type('spot'); await page.waitForTimeout(500);
  r.cmdSpot = await page.evaluate(() => document.querySelector('.ck-dialog, [role=dialog]')?.innerText);
  await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
  await page.keyboard.type('dust'); await page.waitForTimeout(500);
  r.cmdDust = await page.evaluate(() => document.querySelector('.ck-dialog, [role=dialog]')?.innerText);
  await page.keyboard.press('Escape');
  r.probe = await readProbe();
  return r;
};
