import { launch, goto, shot, bodyText, PHOTOS, openFile, meanRGB, rn, settle, luma } from './lib.mjs';
const { ctx, page } = await launch(false, 'fresh');
await goto(page);
await openFile(page, PHOTOS + '/DSC_8559.NEF');
await page.waitForTimeout(2500);
const time = page.getByLabel('Time value');
const setTime = async (v) => { const n0 = (await rn(page))[0]; await time.click(); await time.press('Control+a'); await time.type(v); await time.press('Enter'); await settle(page, n0); };
await setTime('10');
const bw = 888 / 5; const cols = (i) => ({ x: Math.round(244 + i * bw + 4), y: 140, width: Math.round(bw - 8), height: 560 });
await page.getByRole('button', { name: 'Test strip' }).click(); await page.waitForTimeout(12000);
const labels = (await bodyText(page)).split('\n').filter((l) => /^\d+(\.\d+)? s$/.test(l)).slice(0, 5);
console.log('labels', labels);
const strip = []; for (let i = 0; i < 5; i++) strip.push(await meanRGB(page, cols(i), '_b'));
await page.getByRole('button', { name: 'Test strip' }).click(); await page.waitForTimeout(3000);
for (let i = 0; i < 5; i++) {
  await setTime(labels[i].replace(' s', ''));
  const p = await meanRGB(page, cols(i), '_p');
  console.log('band', i + 1, labels[i], 'strip', JSON.stringify(strip[i]), 'L', luma(strip[i]), '| plain same columns', JSON.stringify(p), 'L', luma(p));
}
await setTime('10');
await shot(page, '11-strip-off');
await ctx.close();
