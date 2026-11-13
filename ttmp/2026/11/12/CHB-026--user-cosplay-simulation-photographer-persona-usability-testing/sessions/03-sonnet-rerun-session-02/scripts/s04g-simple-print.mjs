import { launch, goto, shot, bodyText, readProbe, PHOTOS, meanRGB, luma, rn, settle, panelVals } from './lib.mjs';
const { ctx, page } = await launch(false, 'fresh');
await goto(page);
const modeSel = () => page.evaluate(() => document.querySelector('select[aria-label="Enlarger mode"]')?.value ?? null);
const lay = async (name) => { await page.getByText('View', { exact: true }).first().click(); await page.getByText('Layout…', { exact: true }).click(); await page.waitForTimeout(500); await page.getByRole('button', { name, exact: true }).click(); await page.waitForTimeout(2500); };
// start: classic, open frame, note state
await page.setInputFiles('#file', PHOTOS + '/DSC_8559.NEF'); await page.waitForTimeout(12000);
console.log('classic: mode', await modeSel(), (await panelVals(page)).Time);
await lay('Simple');
await page.setInputFiles('#file', PHOTOS + '/DSC_8559.NEF'); await page.waitForTimeout(8000);
await readProbe(page);
await page.getByText('Print', { exact: false }).filter({ hasText: /②/ }).first().click(); await page.waitForTimeout(6000);
await shot(page, '15d-simple-print-step');
console.log('--- SIMPLE print step ---\n' + (await bodyText(page)).split('\n').join(' | '));
console.log('ui', JSON.stringify((await readProbe(page)).ui));
const pic = { x: 50, y: 90, width: 1100, height: 650 };
const m0 = await meanRGB(page, pic); console.log('simple picture', JSON.stringify(m0), luma(m0));
for (let i = 0; i < 3; i++) {
  const n0 = (await rn(page))[0];
  await page.getByRole('button', { name: /Lighter/ }).first().click();
  const t = await settle(page, n0, 25); const m = await meanRGB(page, pic); console.log('lighter', i + 1, JSON.stringify(m), luma(m), 'settle', t);
  if (i === 2) await shot(page, '16-simple-lighter-x3');
}
console.log('body after', (await bodyText(page)).split('\n').join(' | '));
console.log('ui', JSON.stringify((await readProbe(page)).ui));
await ctx.close();
