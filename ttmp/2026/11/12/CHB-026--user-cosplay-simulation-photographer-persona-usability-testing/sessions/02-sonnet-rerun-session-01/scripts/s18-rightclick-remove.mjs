import { launch, goto, shot, bodyText, readProbe, PHOTOS, waitRendered } from './lib.mjs';
const { ctx, page } = await launch(false);
await goto(page);
const st = async () => (await bodyText(page)).split('\n').slice(-3).join(' | ');
await page.getByText('DSC_8559.NEF', { exact: true }).last().click({ button: 'right' });
await page.waitForTimeout(600);
const m = await page.evaluate(() => [...document.querySelectorAll('[role=menu] [role=menuitem], .ck-menu *')].map(e=>e.innerText?.replace(/\s+/g,' ')).filter(Boolean).slice(0,30));
console.log('CONTEXT MENU items', JSON.stringify(m));
await shot(page, '31-right-click-thumb');
await page.keyboard.press('Escape'); await page.mouse.click(700, 300);
await page.waitForTimeout(500);
// Not-now any dialog
if (await page.getByRole('button', { name: 'Not now' }).count()) await page.getByRole('button', { name: 'Not now' }).click();
// Frame > Remove from Library on the NEF
await page.getByText('DSC_8559.NEF', { exact: true }).last().click(); await page.waitForTimeout(600);
if (await page.getByRole('button', { name: 'Not now' }).count()) await page.getByRole('button', { name: 'Not now' }).click();
await page.getByText('Frame', { exact: true }).first().click();
await page.getByText('Remove from Library', { exact: true }).click(); await page.waitForTimeout(1000);
await shot(page, '32-after-remove-click');
console.log('after remove:', await st(), JSON.stringify((await readProbe(page)).ui));
console.log('DIALOG', await page.evaluate(() => document.querySelector('[role=dialog],dialog,.ck-dialog')?.innerText));
await ctx.close();
