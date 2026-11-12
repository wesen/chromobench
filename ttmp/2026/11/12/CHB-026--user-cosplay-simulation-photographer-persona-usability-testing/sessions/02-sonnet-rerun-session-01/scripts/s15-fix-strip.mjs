import { launch, goto, shot, bodyText, readProbe, PHOTOS, setOpenAs } from './lib.mjs';
const { ctx, page } = await launch(false);
await goto(page);
const st = async () => (await bodyText(page)).split('\n').slice(-5).join(' | ');
console.log('RELAUNCH', await st());
await shot(page, '26-relaunch-after-mistake');
// select the stray whole-strip frame and relink it
await page.getByText('raw010.dng', { exact: true }).last().click(); await page.waitForTimeout(800);
console.log('DLG', await page.evaluate(() => document.querySelector('[role=dialog],dialog,.ck-dialog')?.innerText));
if (await page.getByRole('button', { name: 'Not now' }).count()) await page.getByRole('button', { name: 'Not now' }).click();
await page.setInputFiles('#file', PHOTOS + '/raw010.dng');
await page.waitForTimeout(7000);
console.log('AFTER RELINK', await st());
await readProbe(page);
if (await page.getByText('Looks like a negative: re-open as negative?').count()) {
  const t0 = Date.now();
  await page.getByText('Looks like a negative: re-open as negative?').click();
  for (let i = 0; i < 14; i++) { await page.waitForTimeout(1500); console.log(((Date.now()-t0)/1000).toFixed(1), await st()); }
}
await shot(page, '27-after-fix-pill');
console.log(JSON.stringify(await readProbe(page)));
console.log('FRAMES', await page.evaluate(() => window.chromobench?.studio?.frames?.all?.().length));
await ctx.close();
