import { launch, goto, shot, bodyText, readProbe, PHOTOS, waitRendered, setOpenAs } from './lib.mjs';
const { ctx, page } = await launch(false);
await goto(page);
await page.setInputFiles('#file', PHOTOS + '/DSC_8559.NEF');
await waitRendered(page, 'relink', 60);
await setOpenAs(page, 'Open as Negatives');
await page.setInputFiles('#file', PHOTOS + '/DSC_8559.NEF');
await page.waitForTimeout(1000);
await page.getByRole('button', { name: 'Re-open as a negative' }).click();
await waitRendered(page, 'neg', 60);
await page.waitForTimeout(1500);
await readProbe(page);
// now Manfred sees the pill and clicks it
const t0 = Date.now();
await page.getByText('Looks like a photo: re-open as photo?').click();
for (let i = 0; i < 16; i++) { await page.waitForTimeout(1500); const l=(await bodyText(page)).split("\n").slice(-5).join(" | "); console.log(((Date.now()-t0)/1000).toFixed(1), l); }
await page.waitForTimeout(1500);
await shot(page, '11-after-pill-click');
console.log(JSON.stringify(await readProbe(page)));
console.log('DIALOG', await page.evaluate(() => document.querySelector('[role=dialog],dialog,.ck-dialog')?.innerText));
await ctx.close();
