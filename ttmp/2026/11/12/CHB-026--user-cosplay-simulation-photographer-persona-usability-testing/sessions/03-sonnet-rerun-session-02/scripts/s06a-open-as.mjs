import { launch, goto, shot, bodyText, readProbe, PHOTOS, menuState, setOpenAs } from './lib.mjs';
let { ctx, page } = await launch(false, 'fresh');
await goto(page);
console.log('menu before:', await menuState(page));
const items = await (async () => { await page.getByText('File', { exact: true }).first().click(); await page.getByText('Open As', { exact: true }).first().hover(); await page.waitForTimeout(300); const t = await page.evaluate(() => [...document.querySelectorAll('[role=menuitem],[role=menuitemradio],[role=menuitemcheckbox]')].map(e => e.innerText.replace(/\s+/g, ' ')).join(' || ')); await page.keyboard.press('Escape'); await page.mouse.click(700, 300); return t; })();
console.log('items', items);
await page.getByText('File', { exact: true }).first().click();
await page.getByText('Open As', { exact: true }).first().hover(); await page.waitForTimeout(300);
await shot(page, '30-open-as-menu');
await page.getByText(/Negatives/).first().click(); await page.waitForTimeout(1000);
await shot(page, '31-after-pick-negatives');
console.log('status now:', (await bodyText(page)).split('\n').slice(-4).join(' | '));
console.log('ui', JSON.stringify((await readProbe(page)).ui));
console.log('menu after pick:', await menuState(page));
await ctx.close();
// restart
({ ctx, page } = await launch(false, 'fresh'));
await goto(page);
await page.waitForTimeout(1500);
await shot(page, '32-restart-open-as');
console.log('after restart body bottom:', (await bodyText(page)).split('\n').slice(-6).join(' | '));
console.log('menu after restart:', await menuState(page));
console.log('ui', JSON.stringify((await readProbe(page)).ui));
// relink a NEF
await page.getByText('DSC_8541.NEF', { exact: true }).first().click(); await page.waitForTimeout(1000);
await page.setInputFiles('#file', PHOTOS + '/DSC_8541.NEF');
for (let i = 0; i < 160; i++) { await page.waitForTimeout(250); const l = (await bodyText(page)).split('\n').slice(-3).join(' | '); if (/rendered \d/.test(l) && i > 8) break; }
await page.waitForTimeout(2500);
await shot(page, '33-relinked-nef-after-open-as');
console.log('after relink:', (await bodyText(page)).split('\n').slice(-6).join(' | '));
console.log('ui', JSON.stringify((await readProbe(page)).ui));
await ctx.close();
