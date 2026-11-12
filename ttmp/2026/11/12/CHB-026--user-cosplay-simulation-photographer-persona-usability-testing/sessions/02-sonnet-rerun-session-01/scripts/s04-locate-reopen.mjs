import { launch, goto, shot, bodyText, readProbe, PHOTOS, waitIdle } from './lib.mjs';
const { ctx, page } = await launch(false);
await goto(page);
await page.locator('img').last().click();
await page.waitForTimeout(800);
let chooser = null;
page.once('filechooser', (fc) => { chooser = fc; });
await page.getByRole('button', { name: /Locate DSC_8559/ }).click();
await page.waitForTimeout(2500);
console.log('chooser from Locate?', !!chooser);
await shot(page, '04c-after-locate');
console.log((await bodyText(page)).split('\n').slice(-5).join(' | '));
if (chooser) { await chooser.setFiles(PHOTOS + '/DSC_8559.NEF'); }
else {
  if (await page.getByRole('button', { name: 'Not now' }).count()) await page.getByRole('button', { name: 'Not now' }).click();
  await page.setInputFiles('#file', PHOTOS + '/DSC_8559.NEF');
}
let t = await waitIdle(page, 'relink', 120, 3);
await shot(page, '05-relinked');
console.log('relink took', t, JSON.stringify(await readProbe(page)));
console.log('FRAMES', await page.evaluate(() => window.chromobench?.studio?.frames?.all?.().length));
// F2: open the same file again
await page.evaluate(() => window.__probe.reset());
await page.setInputFiles('#file', PHOTOS + '/DSC_8559.NEF');
const t0 = Date.now();
for (let i = 0; i < 12; i++) { await page.waitForTimeout(500); console.log(((Date.now()-t0)/1000).toFixed(1), (await bodyText(page)).split('\n').slice(-2).join(' | ')); }
await shot(page, '06-reopen-same');
console.log(JSON.stringify(await readProbe(page)));
console.log('FRAMES', await page.evaluate(() => window.chromobench?.studio?.frames?.all?.().length));
await ctx.close();
