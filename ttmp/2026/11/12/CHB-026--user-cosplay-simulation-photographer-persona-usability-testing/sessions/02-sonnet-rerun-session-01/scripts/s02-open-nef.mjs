import { launch, goto, shot, bodyText, readProbe, PHOTOS } from './lib.mjs';
const { ctx, page } = await launch(false);
await goto(page);
const t0 = Date.now();
await page.setInputFiles('#file', PHOTOS + '/DSC_8559.NEF');
let last = '';
for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(1000);
  const t = await page.evaluate(() => document.querySelector('footer, [class*=status]')?.innerText ?? '');
  const bt = await bodyText(page); const line = bt.split('\n').slice(-3).join(' | ');
  if (line !== last) { console.log(((Date.now()-t0)/1000).toFixed(1)+'s', line); last = line; }
  if (/rendered \d/.test(bt) && i > 2) break;
}
await page.waitForTimeout(1500);
await shot(page, '03-nef-opened');
console.log(JSON.stringify(await readProbe(page), null, 1));
console.log((await bodyText(page)).slice(0, 1800));
await ctx.close();
