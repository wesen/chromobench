import { launch, goto, shot, bodyText, readProbe, PHOTOS } from './lib.mjs';
let { ctx, page } = await launch(false, 'fresh');
await goto(page);
const openAs = async () => { await page.getByText('File', { exact: true }).first().click(); await page.getByText('Open As', { exact: true }).first().hover(); await page.waitForTimeout(300); };
await openAs(); await page.getByText('Open as Negatives', { exact: true }).click(); await page.waitForTimeout(500);
await openAs(); await page.getByText('Keep This Choice After Restart', { exact: true }).click(); await page.waitForTimeout(500);
await openAs(); await shot(page, '34-open-as-keep-menu'); await page.keyboard.press('Escape'); await page.mouse.click(700, 300);
console.log('status:', (await bodyText(page)).split('\n').slice(-3).join(' | '));
console.log('ui', JSON.stringify((await readProbe(page)).ui.filter(u=>u.kind!=='menu')));
await ctx.close();
({ ctx, page } = await launch(false, 'fresh'));
await goto(page); await page.waitForTimeout(1500);
await shot(page, '35-restart-kept-negatives');
console.log('after restart status:', (await bodyText(page)).split('\n').slice(-4).join(' | '));
await page.getByText('DSC_8541.NEF', { exact: true }).first().click(); await page.waitForTimeout(1000);
await page.setInputFiles('#file', PHOTOS + '/DSC_8541.NEF');
for (let i = 0; i < 160; i++) { await page.waitForTimeout(250); const l = (await bodyText(page)).split('\n').slice(-3).join(' | '); if (/rendered \d/.test(l) && i > 8) break; }
await page.waitForTimeout(2500);
await shot(page, '36-relink-with-kept-negatives');
console.log('after relink:', (await bodyText(page)).split('\n').slice(-5).join(' | '));
console.log('ui', JSON.stringify((await readProbe(page)).ui.filter(u=>u.kind!=='menu')));
// put back to Guess
await openAs(); await page.getByText('Photo or Negative: Guess', { exact: true }).click(); await page.waitForTimeout(500);
await openAs(); await page.getByText('Keep This Choice After Restart', { exact: true }).click(); await page.waitForTimeout(500);
await openAs(); await shot(page, '37-open-as-reset'); await page.keyboard.press('Escape');
await ctx.close();
