import { launch, goto, shot, bodyText, readProbe, PHOTOS, openFile, meanRGB, luma, rn, settle, panelVals } from './lib.mjs';
const { ctx, page } = await launch(false, 'fresh'); await goto(page);
await openFile(page, PHOTOS + '/DSC_8559.NEF'); await page.waitForTimeout(3000); await readProbe(page);
await page.getByText('View', { exact: true }).first().click(); await page.getByText('Layout…', { exact: true }).click(); await page.waitForTimeout(500); await page.getByRole('dialog').getByRole('button', { name: 'Simple', exact: true }).click(); await page.waitForTimeout(3000); if (await page.getByRole('dialog').count()) await page.keyboard.press('Escape');
await page.getByText('② Print', { exact: true }).click(); await page.waitForTimeout(4000);
await shot(page, '46-simple-print');
const body = await bodyText(page); console.log('simple print body:', body.split('\n').filter(l => !/not open/.test(l)).filter(Boolean).join(' | ').slice(0, 1500));
const sl = () => page.evaluate(() => [...document.querySelectorAll('input')].filter(e => e.offsetParent).map(e => (e.getAttribute('aria-label') || e.type) + '=' + e.value).join(' ; '));
console.log('inputs:', await sl());
console.log('mode select:', await page.evaluate(() => document.querySelector('select[aria-label="Enlarger mode"]')?.value ?? 'none'));
const clip = { x: 250, y: 100, width: 880, height: 600 };
const m0 = await meanRGB(page, clip, '_m'); console.log('base mean', m0, 'luma', luma(m0), 'B/R', (m0[2]/m0[0]).toFixed(3));
for (const name of ['Brightness', 'Warmth', 'Tint']) {
  const box = page.getByLabel(new RegExp('^' + name + ' value'));
  console.log(name, 'inputs found', await box.count());
  if (!(await box.count())) continue;
  const n0 = (await rn(page))[0]; await box.first().click(); await box.first().press('Control+a'); await box.first().type('0.5'); await box.first().press('Enter'); console.log(' settle', await settle(page, n0, 30));
  await shot(page, '47-simple-' + name);
  const m = await meanRGB(page, clip, '_m'); console.log(' ', name, '=0.5 mean', m, 'luma', luma(m), 'B/R', (m[2]/m[0]).toFixed(3), 'value now', await sl());
  const n1 = (await rn(page))[0]; await box.first().click(); await box.first().press('Control+a'); await box.first().type('0'); await box.first().press('Enter'); await settle(page, n1, 30);
}
console.log('ui', JSON.stringify((await readProbe(page)).ui.filter(u => u.kind !== 'menu')));
await ctx.close();
