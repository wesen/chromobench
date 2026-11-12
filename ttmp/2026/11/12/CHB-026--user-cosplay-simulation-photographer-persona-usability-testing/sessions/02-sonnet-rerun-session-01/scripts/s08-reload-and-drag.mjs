import { launch, goto, shot, bodyText, readProbe, PHOTOS, waitRendered, setOpenAs } from './lib.mjs';
const { ctx, page } = await launch(false);
await goto(page);
await setOpenAs(page, 'Photo or Negative: Guess');
await page.setInputFiles('#file', PHOTOS + '/DSC_8559.NEF');
await waitRendered(page, 'open', 60);
await page.waitForTimeout(3000);
// real reload
await page.reload(); await page.waitForTimeout(2500);
console.log('AFTER RELOAD:', (await bodyText(page)).split('\n').slice(-6).join(' | '));
await shot(page, '12-after-reload');
// click thumbnail -> dialog; (no file handle in headless) -> Not now; use Open to relink
await page.locator('img').last().click(); await page.waitForTimeout(800);
await shot(page, '13-thumb-click-dialog');
await page.getByRole('button', { name: 'Not now' }).click();
await page.setInputFiles('#file', PHOTOS + '/DSC_8559.NEF');
await waitRendered(page, 'relink', 60);
await page.waitForTimeout(3000);
await readProbe(page);
// drag Time slider
const slider = page.locator('input[type=range]').first();
const box = await slider.boundingBox();
console.log('slider box', JSON.stringify(box), 'val', await slider.inputValue(), await slider.getAttribute('min'), await slider.getAttribute('max'), await slider.getAttribute('step'));
const before = (await bodyText(page)).match(/rendered (\d+)/)?.[1];
const x0 = box.x + box.width * ((Number(await slider.inputValue()) - Number(await slider.getAttribute('min'))) / (Number(await slider.getAttribute('max')) - Number(await slider.getAttribute('min'))));
const y = box.y + box.height / 2;
await page.mouse.move(x0, y); await page.mouse.down();
const t0 = Date.now();
for (let i = 1; i <= 20; i++) { await page.mouse.move(x0 + i * 2, y); await page.waitForTimeout(30); }
await page.mouse.up();
const tDrag = Date.now() - t0;
console.log('drag itself took ms', tDrag);
let tFinal = -1, lastN = before;
for (let i = 0; i < 120; i++) { await page.waitForTimeout(250); const n = (await bodyText(page)).match(/rendered (\d+)/)?.[1]; if (n !== lastN) { lastN = n; tFinal = Date.now() - t0; } if (Date.now() - t0 - tFinal > 3000 && tFinal > 0) break; }
console.log('last render change at ms', tFinal, 'counter', before, '->', lastN);
await shot(page, '14-after-slider-drag');
console.log('TIME', await page.evaluate(() => document.body.innerText.match(/Time\s*\n?([^\n]*)/)?.[0]));
console.log(JSON.stringify(await readProbe(page)));
console.log((await bodyText(page)).split('History')[1]?.slice(0, 200));
await ctx.close();
