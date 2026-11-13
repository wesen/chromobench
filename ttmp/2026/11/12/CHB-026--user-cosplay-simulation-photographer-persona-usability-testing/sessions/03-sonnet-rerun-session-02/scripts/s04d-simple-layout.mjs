import { launch, goto, shot, bodyText, readProbe, PHOTOS, openFile, meanRGB, luma, rn, settle, panelVals, relink } from './lib.mjs';
const { ctx, page } = await launch(false, 'fresh');
await goto(page);
await page.waitForTimeout(1500);
console.log('start layout body:', (await bodyText(page)).split('\n').slice(0, 20).join(' | '));
// select the truck
const ok = await relink(page, 'DSC_8559.NEF', PHOTOS + '/DSC_8559.NEF');
console.log('relinked', ok); await page.waitForTimeout(6000);
await shot(page, '15b-simple-after-select');
console.log('--- SIMPLE ---\n' + (await bodyText(page)).split('\n').join(' | '));
console.log('ui', JSON.stringify((await readProbe(page)).ui));
await ctx.close();
