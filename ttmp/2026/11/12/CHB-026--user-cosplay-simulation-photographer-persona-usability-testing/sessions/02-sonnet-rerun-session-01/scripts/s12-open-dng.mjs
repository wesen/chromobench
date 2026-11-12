import { launch, goto, shot, bodyText, readProbe, PHOTOS } from './lib.mjs';
const { ctx, page } = await launch(false);
await goto(page);
await readProbe(page);
const t0 = Date.now(); let last = '';
await page.setInputFiles('#file', PHOTOS + '/raw010.dng');
for (let i = 0; i < 160; i++) {
  await page.waitForTimeout(500);
  const l = (await bodyText(page)).split('\n').slice(-4).join(' | ');
  if (l !== last) { console.log(((Date.now()-t0)/1000).toFixed(1)+'s', l); last = l; }
  if (i > 6 && /rendered/.test(l) && !/opening/.test(l)) { await page.waitForTimeout(4000); break; }
}
await shot(page, '20-dng-opened');
console.log(JSON.stringify(await readProbe(page)));
console.log('FRAMES', await page.evaluate(() => window.chromobench?.studio?.frames?.all?.().map(f=>f.name ?? f.id)));
console.log((await bodyText(page)).split('\n').slice(-12).join(' | '));
await ctx.close();
