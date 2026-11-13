import { launch, goto, shot, bodyText, readProbe, PHOTOS, ROOT, openFile, meanRGB, luma, rn, settle, panelVals } from './lib.mjs';
const { ctx, page } = await launch(false, 'fresh'); await goto(page);
await openFile(page, PHOTOS + '/DSC_8559.NEF'); await openFile(page, PHOTOS + '/DSC_8541.NEF');
await openFile(page, ROOT + '/.playwright-mcp/scans/2025-08-09_raw013.dng'); await page.waitForTimeout(4000);
await readProbe(page);
const openDlg = async () => { await page.getByText('View', { exact: true }).first().click(); await page.getByText('Layout…', { exact: true }).click(); await page.waitForTimeout(600); };
await openDlg();
const names = await page.evaluate(() => [...document.querySelectorAll('.ck-modal button, [role=dialog] button')].map(b => b.innerText.trim()).filter(Boolean));
console.log('dialog buttons:', JSON.stringify(names));
await shot(page, '40-layout-dialog');
await page.keyboard.press('Escape'); await page.waitForTimeout(500);
const skip = /close|cancel|done|^ok$/i;
for (const nm of names.filter(n => !skip.test(n))) {
  await openDlg();
  const btn = page.getByRole('dialog').getByRole('button', { name: nm, exact: true }); if (!(await btn.count())) { console.log('no button', nm); continue; }
  await btn.first().click(); await page.waitForTimeout(3500);
  const dlgLeft = await page.getByRole('dialog').count(); if (dlgLeft) await page.keyboard.press('Escape'); await page.waitForTimeout(1500);
  const bt = await bodyText(page);
  const frames = [...new Set(bt.split('\n').filter(l => /DSC_85|raw013/.test(l)))];
  const m = await meanRGB(page, { x: 100, y: 100, width: 900, height: 600 }, '_m');
  const pr = await readProbe(page);
  console.log('##', nm, '| frame labels:', frames.length, JSON.stringify(frames.slice(0,6)), '| dialog left open after pick:', dlgLeft, '| centre luma', luma(m), '| reopen-text:', /select one to open|Where is/i.test(bt), '| ui', JSON.stringify(pr.ui.filter(u => u.kind !== 'menu')), '| status', bt.split('\n').slice(-1)[0]);
  await shot(page, '41-layout-' + nm.replace(/\W+/g, '-'));
}
await ctx.close();
