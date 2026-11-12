import { launch, goto, shot, bodyText, readProbe, PHOTOS, waitRendered } from './lib.mjs';
const { ctx, page } = await launch(false);
await goto(page);
await page.setInputFiles('#file', PHOTOS + '/DSC_8559.NEF');
await waitRendered(page, 'open', 60);
await page.waitForTimeout(2500);
const box = page.getByLabel('Time value');
await box.click(); await box.press('Control+a'); await box.type('15'); await box.press('Enter'); await page.waitForTimeout(3000);
await box.click(); await box.press('Control+a'); await box.type('30'); await box.press('Enter'); await page.waitForTimeout(3000);
await readProbe(page);
const edit = async (tag) => { await page.getByText('Edit', { exact: true }).first().click(); await page.waitForTimeout(300); const t = await page.evaluate(() => [...document.querySelectorAll('[role=menuitem]')].map(e=>e.innerText.replace(/\s+/g,' ')).join(' || ')); await shot(page, '18-edit-menu-' + tag); await page.keyboard.press('Escape'); await page.mouse.click(700, 760); console.log('EDIT MENU', tag, t); };
await edit('before');
for (let i = 0; i < 3; i++) { await page.mouse.click(700, 760); await page.keyboard.press('Control+z'); await page.waitForTimeout(1500); const p = await readProbe(page); console.log('undo', i, 'time box', await box.inputValue(), JSON.stringify(p.ui.map(u => u.text ?? u.kind))); }
await edit('after-undo');
for (let i = 0; i < 2; i++) { await page.keyboard.press('Control+Shift+z'); await page.waitForTimeout(1500); const p = await readProbe(page); console.log('redo', i, 'time box', await box.inputValue(), JSON.stringify(p.ui.map(u => u.text ?? u.kind))); }
await shot(page, '19-after-redo');
await ctx.close();
