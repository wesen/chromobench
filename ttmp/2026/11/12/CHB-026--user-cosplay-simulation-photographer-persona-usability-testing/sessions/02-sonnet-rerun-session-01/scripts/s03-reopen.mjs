import { launch, goto, shot, bodyText, readProbe, PHOTOS, waitIdle } from './lib.mjs';
const { ctx, page } = await launch(false);
await goto(page);
// Step 3a: the thumbnail says "not open": click it (F5)
await page.locator('img').last().click().catch(()=>{});
await page.waitForTimeout(1500);
await shot(page, '04b-click-thumb');
console.log('AFTER THUMB CLICK:', (await bodyText(page)).split('\n').slice(-8).join(' | '));
console.log('UI', JSON.stringify((await readProbe(page)).ui));
const dlg = await page.evaluate(() => [...document.querySelectorAll('dialog,[role=dialog],.ck-dialog')].map(d=>d.innerText));
console.log('DIALOGS', JSON.stringify(dlg));
await ctx.close();
