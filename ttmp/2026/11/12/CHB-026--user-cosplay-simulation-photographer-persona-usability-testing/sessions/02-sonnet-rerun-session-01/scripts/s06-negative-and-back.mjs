import { launch, goto, shot, bodyText, readProbe, PHOTOS, waitRendered, setOpenAs, clickDialog } from './lib.mjs';
const { ctx, page } = await launch(false);
await goto(page);
await page.setInputFiles('#file', PHOTOS + '/DSC_8559.NEF');
console.log('initial relink', await waitRendered(page, 'init'));
await page.waitForTimeout(2000); await readProbe(page);
// open as negative
await setOpenAs(page, 'Open as Negatives');
await page.setInputFiles('#file', PHOTOS + '/DSC_8559.NEF');
await page.waitForTimeout(1200);
await clickDialog(page, 'Re-open as a negative');
console.log('as negative took', await waitRendered(page, 'neg', 120));
await page.waitForTimeout(2500);
await shot(page, '09-nef-as-negative');
console.log(JSON.stringify(await readProbe(page)));
console.log((await bodyText(page)).split('\n').slice(-6).join(' | '));
// and back
await setOpenAs(page, 'Open as Photos');
await page.setInputFiles('#file', PHOTOS + '/DSC_8559.NEF');
await page.waitForTimeout(1200);
await shot(page, '10-dialog-back-to-photo');
console.log('DIALOG', await page.evaluate(() => document.querySelector('[role=dialog],dialog,.ck-dialog')?.innerText));
await clickDialog(page, /Re-open as a photo|photo/i).catch(async (e) => { console.log('btn err', String(e).slice(0,200)); });
console.log('back as photo took', await waitRendered(page, 'photo', 120));
await page.waitForTimeout(2500);
await shot(page, '11-nef-back-as-photo');
console.log(JSON.stringify(await readProbe(page)));
await ctx.close();
