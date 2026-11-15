export default async ({ page, shot, readProbe }) => {
  await page.getByText('File', { exact: true }).first().click();
  await page.waitForTimeout(300);
  const menu = await page.locator('[role=menu], .ck-menu').first().innerText().catch(() => '(no menu role)');
  const s1 = await shot('02-file-menu');
  await page.keyboard.press('Escape');
  const syn = process.cwd().replace(/ttmp.*/, '') + '.playwright-mcp/p9-synthetic/';
  const t0 = Date.now();
  await page.setInputFiles('#file', syn + 'landscape-negative.tif');
  const marks = [];
  let last = '';
  for (let i = 0; i < 240; i++) {
    const st = await page.evaluate(() => document.querySelector('footer, .ck-status, [class*=status]')?.innerText ?? '').catch(() => '');
    if (st !== last) { marks.push([Date.now() - t0, st.replace(/\s+/g, ' ').slice(0, 200)]); last = st; }
    if (/rendered|ready/.test(st) && i > 3 && Date.now() - t0 > 3000) {
      const busy = await page.evaluate(() => window.chromobench.frames?.length).catch(() => null);
    }
    await page.waitForTimeout(500);
    const done = await page.evaluate(() => { const d = window.chromobench?.doc; return !!d; }).catch(() => false);
    if (done && Date.now() - t0 > 2000 && /rendered/i.test(st)) break;
  }
  const tVisible = Date.now() - t0;
  await page.evaluate(() => window.chromobench.idle?.()).catch(() => {});
  const tIdle = Date.now() - t0;
  const s2 = await shot('03-first-print');
  const text = (await page.locator('body').innerText()).slice(0, 4000);
  return { menu, s1, marks, tVisible, tIdle, s2, text, probe: await readProbe() };
};
