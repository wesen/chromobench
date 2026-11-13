import { launch, goto, shot, bodyText, PHOTOS, openFile, meanRGB, rn, settle, luma, uptime, panelVals } from './lib.mjs';
const { ctx, page } = await launch(false, 'fresh'); await goto(page);
console.log('uptime', uptime());
await openFile(page, PHOTOS + '/DSC_8559.NEF'); await page.waitForTimeout(3000);
if ((await page.evaluate(() => document.querySelector('select[aria-label="Enlarger mode"]')?.value)) !== 'real') { await page.locator('select[aria-label="Enlarger mode"]').selectOption('real'); await page.waitForTimeout(4000); }
console.log('mode', await page.evaluate(() => document.querySelector('select[aria-label="Enlarger mode"]')?.value), JSON.stringify(await panelVals(page)));
const time = page.getByLabel('Time value');
const setTime = async (v) => { const n0 = (await rn(page))[0]; await time.click(); await time.press('Control+a'); await time.type(v); await time.press('Enter'); return settle(page, n0, 40); };
console.log('set 10:', await setTime('10'));
const bw = 888 / 5; const cols = (i) => ({ x: Math.round(244 + i * bw + 4), y: 140, width: Math.round(bw - 8), height: 560 });
await page.getByRole('button', { name: 'Test strip' }).click(); await page.waitForTimeout(14000);
await shot(page, '80-test-strip');
const labels = (await bodyText(page)).split('\n').filter((l) => /^\d+(\.\d+)? s$/.test(l)).slice(0, 5);
console.log('strip labels', JSON.stringify(labels));
const strip = []; for (let i = 0; i < 5; i++) strip.push(await meanRGB(page, cols(i), '_b'));
console.log('strip band luma', JSON.stringify(strip.map(luma)));
await page.getByRole('button', { name: 'Test strip' }).click(); await page.waitForTimeout(3000);
for (const v of ['6.3', '10', '20']) {
  console.log('Time', v, 'settle', await setTime(v)); const m = await meanRGB(page, { x: 250, y: 140, width: 880, height: 580 }, '_p');
  console.log('  luma', luma(m), 'B/R', (m[2] / m[0]).toFixed(3)); await shot(page, '81-time-' + v.replace('.', '_'));
}
await ctx.close();
