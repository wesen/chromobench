import { launch, goto, shot, bodyText, readProbe, PHOTOS } from './lib.mjs';
const { ctx, page } = await launch(false, 'fresh');
await goto(page); await page.waitForTimeout(1000);
console.log('library:', (await bodyText(page)).split('\n').filter(l => /NEF|dng/.test(l)).join(' | '));
// open one (so a selected, open frame) then remove it
await page.setInputFiles('#file', PHOTOS + '/DSC_8559.NEF');
for (let i = 0; i < 160; i++) { await page.waitForTimeout(250); const l = (await bodyText(page)).split('\n').slice(-3).join(' | '); if (/rendered \d/.test(l) && i > 8) break; }
await page.waitForTimeout(1500); await readProbe(page);
await page.getByText('Frame', { exact: true }).first().click(); await page.waitForTimeout(300);
await shot(page, '40-frame-menu');
console.log('frame menu:', await page.evaluate(() => [...document.querySelectorAll('[role=menuitem]')].map(e => e.innerText.replace(/\s+/g, ' ')).slice(8).join(' || ')));
await page.getByText('Remove from Library', { exact: true }).click(); await page.waitForTimeout(2500);
await shot(page, '41-after-remove');
const r = await readProbe(page);
console.log('ui after Remove (selected+open frame):', JSON.stringify(r.ui.filter(u => u.kind !== 'menu')));
console.log('body:', (await bodyText(page)).split('\n').slice(-8).join(' | '));
// again: remove a not-open frame via right click
await page.getByText('DSC_8536.NEF', { exact: true }).first().click({ button: 'right' }); await page.waitForTimeout(800);
await shot(page, '42-right-click-thumb');
console.log('ctx menu items:', await page.evaluate(() => [...document.querySelectorAll('[role=menuitem]')].map(e => e.innerText.replace(/\s+/g, ' ')).slice(8).join(' || ')));
console.log('ui after right-click:', JSON.stringify((await readProbe(page)).ui.filter(u => u.kind !== 'menu')));
await page.getByText('Remove from Library', { exact: true }).last().click().catch(e => console.log('no remove item', String(e).slice(0, 100))); await page.waitForTimeout(2500);
await shot(page, '43-after-remove-2');
console.log('ui after 2nd remove:', JSON.stringify((await readProbe(page)).ui.filter(u => u.kind !== 'menu')));
console.log('body:', (await bodyText(page)).split('\n').slice(-8).join(' | '));
await ctx.close();
