export default async ({ page, shot, readProbe }) => {
  const r = {};
  await page.getByText('landscape-camera.dng', { exact: true }).first().click(); await page.waitForTimeout(1500);
  r.dialog = await page.evaluate(() => document.querySelector('.ck-dialog, [role=dialog]')?.innerText?.slice(0, 300));
  const syn = process.cwd().replace(/ttmp.*/, '') + '.playwright-mcp/p9-synthetic/';
  const t0 = Date.now();
  await page.setInputFiles('#file', syn + 'landscape-camera.dng');
  const marks = []; let last = '';
  for (let i = 0; i < 400; i++) { const s = await page.evaluate(() => document.body.innerText.split('\n').slice(-1)[0]).catch(() => ''); if (s !== last) { marks.push([Date.now() - t0, s.slice(0, 120)]); last = s; } if (/rendered \d+ · done|could not/.test(s)) break; await page.waitForTimeout(300); }
  r.marks = marks; r.ms = Date.now() - t0;
  await page.waitForTimeout(1500);
  r.dialog2 = await page.evaluate(() => document.querySelector('.ck-dialog, [role=dialog]')?.innerText?.slice(0, 300));
  r.status = await page.evaluate(() => document.body.innerText.split('\n').slice(-3));
  await shot('61-dng-opened');
  r.probe = await readProbe();
  return r;
};
