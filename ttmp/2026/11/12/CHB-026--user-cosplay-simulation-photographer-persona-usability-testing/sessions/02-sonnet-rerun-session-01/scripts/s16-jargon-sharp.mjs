import { launch, goto, shot, bodyText, readProbe, PHOTOS, waitRendered } from './lib.mjs';
const { ctx, page } = await launch(false);
await goto(page);
await page.setInputFiles('#file', PHOTOS + '/DSC_8559.NEF');
await waitRendered(page, 'open', 60); await page.waitForTimeout(3000);
const titles = await page.evaluate(() => [...document.querySelectorAll('[title],[aria-label]')].map(e => (e.getAttribute('title') || '') ).filter(Boolean));
console.log('TITLES', JSON.stringify([...new Set(titles)], null, 0));
const sel = await page.evaluate(() => [...document.querySelectorAll('select')].map(s => ({ label: s.getAttribute('aria-label') || s.id, opts: [...s.options].map(o => o.text + '{' + o.value + '}') })));
console.log('SELECTS', JSON.stringify(sel));
// canvas size
console.log('CANVAS', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('canvas')].map(c => [c.width, c.height, Math.round(c.getBoundingClientRect().width), Math.round(c.getBoundingClientRect().height)]))));
// View menu
await page.getByText('View', { exact: true }).first().click(); await page.waitForTimeout(300);
console.log('VIEW MENU', await page.evaluate(() => [...document.querySelectorAll('[role=menuitem]')].map(e=>e.innerText.replace(/\s+/g,' ')).slice(8).join(' || ')));
await shot(page, '28-view-menu'); await page.keyboard.press('Escape'); await page.mouse.click(700, 760);
// try zoom 100% via double click on image and key '1'
await page.mouse.dblclick(700, 400); await page.waitForTimeout(3000);
await shot(page, '29-after-dblclick-image');
console.log('after dblclick', (await bodyText(page)).split('\n').slice(-4).join(' | '));
console.log('CANVAS2', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('canvas')].map(c => [c.width, c.height, Math.round(c.getBoundingClientRect().width), Math.round(c.getBoundingClientRect().height)]))));
console.log('ui', JSON.stringify((await readProbe(page)).ui));
console.log('RIGHT PANEL TEXT:\n' + (await bodyText(page)));
await ctx.close();
