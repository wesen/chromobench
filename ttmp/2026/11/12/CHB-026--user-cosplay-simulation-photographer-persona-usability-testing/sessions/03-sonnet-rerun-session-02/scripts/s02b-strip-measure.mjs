import { launch, goto, shot, bodyText, readProbe, PHOTOS, openFile, uptime, meanRGB, MAIN } from './lib.mjs';
const { ctx, page } = await launch(false, 'fresh');
await goto(page);
await openFile(page, PHOTOS + '/DSC_8559.NEF');
await page.waitForTimeout(2000);
console.log('inputs', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('input,select,button')].filter(e=>e.offsetParent).map(e => `${e.tagName}:${e.type||''}:${e.getAttribute('aria-label')||e.innerText?.slice(0,20)||''}`))));
// baseline plain picture mean, then strip
console.log('no strip mean', await meanRGB(page, MAIN));
await page.getByRole('button', { name: 'Test strip' }).click();
await page.waitForTimeout(15000);
await shot(page, '05-test-strip-settled');
// bands: x from 244..1132 width 888, 5 bands
const bw = 888 / 5;
for (let i = 0; i < 5; i++) {
  const m = await meanRGB(page, { x: Math.round(244 + i * bw + 4), y: 140, width: Math.round(bw - 8), height: 560 }, '_band');
  console.log('band', i + 1, ['6.3','7.94','10.0','12.6','15.87'][i], 'mean RGB', JSON.stringify(m), 'luma', (0.299*m[0]+0.587*m[1]+0.114*m[2]).toFixed(1));
}
console.log(JSON.stringify(await readProbe(page)));
// click band 4
await page.mouse.click(244 + 3.5 * bw, 300);
await page.waitForTimeout(6000);
console.log('after band click: ', (await bodyText(page)).split('\n').filter(l=>/ s$|st$|Expose|rendered/.test(l)).join(' | '));
console.log(JSON.stringify(await readProbe(page)));
await shot(page, '06-after-band-click');
console.log(await page.evaluate(() => (window.chromobench?.rt?.chrome?.log||[]).slice(-5)));
await ctx.close();
