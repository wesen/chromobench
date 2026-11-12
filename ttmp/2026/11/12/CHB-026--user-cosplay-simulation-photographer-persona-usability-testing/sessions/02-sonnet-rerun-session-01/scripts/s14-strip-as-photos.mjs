import { launch, goto, shot, bodyText, readProbe, PHOTOS, setOpenAs } from './lib.mjs';
const { ctx, page } = await launch(false);
await goto(page);
const st = async () => (await bodyText(page)).split('\n').slice(-5).join(' | ');
// Frame menu look
await page.getByText('Frame', { exact: true }).first().click(); await page.waitForTimeout(300);
console.log('FRAME MENU', await page.evaluate(() => [...document.querySelectorAll('[role=menuitem]')].map(e=>e.innerText.replace(/\s+/g,' ')).slice(8).join(' || ')));
await shot(page, '24-frame-menu'); await page.keyboard.press('Escape'); await page.mouse.click(700, 300);
// the mistake: Open As Photos, then open the strip
await setOpenAs(page, 'Open as Photos');
await readProbe(page);
const t0 = Date.now();
await page.setInputFiles('#file', PHOTOS + '/raw010.dng');
for (let i = 0; i < 40; i++) { await page.waitForTimeout(1000); const l = await st(); console.log(((Date.now()-t0)/1000).toFixed(0), l); if (i > 3 && /rendered/.test(l) && !/opening/.test(l)) break; }
await page.waitForTimeout(2500);
await shot(page, '25-strip-opened-as-photos');
console.log(JSON.stringify(await readProbe(page)));
console.log('DIALOG', await page.evaluate(() => document.querySelector('[role=dialog],dialog,.ck-dialog')?.innerText));
await ctx.close();
