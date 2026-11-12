import { launch, goto, shot, bodyText, readProbe, PHOTOS, waitRendered } from './lib.mjs';
const { ctx, page } = await launch(false);
await goto(page);
await page.setInputFiles('#file', PHOTOS + '/DSC_8559.NEF');
await waitRendered(page, 'relink', 60);
await page.waitForTimeout(2000);
console.log((await bodyText(page)).split('\n').slice(-6).join(' | '));
await shot(page, '10b-state-after-relink');
// wait to see what pill click does
if (await page.getByText('Looks like a photo: re-open as photo?').count()) {
  const t0 = Date.now();
  await readProbe(page);
  await page.getByText('Looks like a photo: re-open as photo?').click();
  for (let i = 0; i < 12; i++) { await page.waitForTimeout(2000); console.log(((Date.now()-t0)/1000).toFixed(1), (await bodyText(page)).split('\n').slice(-5).join(' | ')); }
  await shot(page, '11-after-pill-click');
  console.log(JSON.stringify(await readProbe(page)));
}
await ctx.close();
