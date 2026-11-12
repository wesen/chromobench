import { launch, goto, shot, bodyText, readProbe, PHOTOS, waitRendered } from './lib.mjs';
const { ctx, page } = await launch(false);
await goto(page);
await page.setInputFiles('#file', PHOTOS + '/DSC_8559.NEF');
await waitRendered(page, 'open', 60); await page.waitForTimeout(3000);
await readProbe(page);
await page.mouse.click(700, 400);
for (let i = 0; i < 3; i++) { await page.keyboard.press('Control+='); await page.waitForTimeout(5000); }
await shot(page, '30-zoomed-in');
console.log('status', (await bodyText(page)).split('\n').slice(-4).join(' | '));
console.log('CANVAS', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('canvas')].slice(0,3).map(c => [c.width, c.height, Math.round(c.getBoundingClientRect().width), Math.round(c.getBoundingClientRect().height)]))));
console.log(JSON.stringify(await readProbe(page)));
await ctx.close();
