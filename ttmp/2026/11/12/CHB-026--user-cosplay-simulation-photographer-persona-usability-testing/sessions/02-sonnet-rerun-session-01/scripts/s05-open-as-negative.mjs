import { launch, goto, shot, bodyText, readProbe, PHOTOS, waitIdle, setOpenAs, menuState } from './lib.mjs';
const { ctx, page } = await launch(false);
await goto(page);
// bring file back first (select thumbnail -> Not now), open normally (Guess)
await page.setInputFiles('#file', PHOTOS + '/DSC_8559.NEF');
await waitIdle(page, 'open guess', 120, 3);
await page.waitForTimeout(3000);
await readProbe(page);
// Mistake: open it "as negatives"
await setOpenAs(page, 'Open as Negatives');
console.log('MENU after pick:', await menuState(page));
await shot(page, '07-after-open-as-negatives-menu');
console.log('STATUS', (await bodyText(page)).split('\n').slice(-3).join(' | '));
await page.setInputFiles('#file', PHOTOS + '/DSC_8559.NEF');
const t0 = Date.now();
for (let i = 0; i < 40; i++) { await page.waitForTimeout(1000); const l=(await bodyText(page)).split('\n').slice(-4).join(' | '); console.log(((Date.now()-t0)/1000).toFixed(0), l); if (/rendered/.test(l) && i>4) break; }
await shot(page, '08-reopen-as-negative');
console.log(JSON.stringify(await readProbe(page)));
console.log('FRAMES', await page.evaluate(() => window.chromobench?.studio?.frames?.all?.().length));
await ctx.close();
