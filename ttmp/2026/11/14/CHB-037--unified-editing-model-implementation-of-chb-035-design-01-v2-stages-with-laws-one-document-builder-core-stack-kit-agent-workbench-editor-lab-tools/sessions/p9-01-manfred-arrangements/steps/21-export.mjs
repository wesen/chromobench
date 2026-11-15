export default async ({ page, shot, readProbe, S }) => {
  const r = {};
  const t0 = Date.now();
  const dl = page.waitForEvent('download', { timeout: 180000 }).catch(e => 'no download: ' + String(e).slice(0, 120));
  await page.locator('.ck-dialog, [role=dialog]').getByRole('button', { name: 'Export' }).click();
  const marks = []; let last = '';
  const poll = (async () => { for (let i = 0; i < 600; i++) { const s = await page.evaluate(() => document.body.innerText.split('\n').slice(-2).join(' | ')).catch(() => ''); if (s !== last) { marks.push([Date.now() - t0, s.slice(0, 160)]); last = s; } if (r.done) break; await page.waitForTimeout(250); } })();
  await page.waitForTimeout(1500); await shot('29-exporting');
  const d = await dl; r.done = true; await poll;
  r.ms = Date.now() - t0;
  if (typeof d === 'string') r.download = d; else { r.name = d.suggestedFilename(); const p = S + '/exports/' + r.name; await d.saveAs(p); r.saved = p; }
  r.marks = marks; r.probe = await readProbe();
  return r;
};
