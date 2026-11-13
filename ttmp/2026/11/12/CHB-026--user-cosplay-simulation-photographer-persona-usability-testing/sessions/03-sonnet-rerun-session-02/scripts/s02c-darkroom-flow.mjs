import { launch, goto, shot, bodyText, readProbe, PHOTOS, openFile, uptime, meanRGB, MAIN, rn, settle, luma, panelVals } from './lib.mjs';
const { ctx, page } = await launch(false, 'fresh');
await goto(page);
await openFile(page, PHOTOS + '/DSC_8559.NEF');
await page.waitForTimeout(2500);
await readProbe(page);
console.log('uptime', uptime());
const rows = [];
const measure = async (label, t) => { const m = await meanRGB(page, MAIN); const vals = await panelVals(page); const ap = (await bodyText(page)).match(/f\/[\d.]+/g); rows.push({ label, m, L: luma(m), t, vals: JSON.stringify(vals), ap: ap?.[0] }); console.log(label, 'RGB', JSON.stringify(m), 'luma', luma(m), 'settle', t, JSON.stringify(vals), 'ap', ap?.slice(0,2)); };
await measure('start', 0);
const time = page.getByLabel('Time value');
const setTime = async (v) => { const n0 = (await rn(page))[0]; await time.click(); await time.press('Control+a'); await time.type(v); await time.press('Enter'); return settle(page, n0); };
for (const v of ['6.3', '10', '12.6', '15.87', '30']) await measure('type time ' + v, await setTime(v));
// slider drag
{
  const sl = page.getByLabel('Time', { exact: true }).first(); const b = await sl.boundingBox();
  const n0 = (await rn(page))[0]; await page.mouse.move(b.x + b.width * 0.3, b.y + b.height / 2); await page.mouse.down();
  for (let i = 1; i <= 20; i++) { await page.mouse.move(b.x + b.width * (0.3 + i * 0.004), b.y + b.height / 2); await page.waitForTimeout(30); }
  await page.mouse.up(); const t = await settle(page, n0); await measure('slider drag +20 moves', t);
}
await setTime('10'); await measure('time back to 10', 0);
// aperture
for (const [name, label] of [['Aperture up', 'aperture up (+1)'], ['Aperture up', 'aperture up (+2)'], ['Aperture down', 'aperture down'], ['Aperture down', 'aperture down 2'], ['Aperture down', 'aperture down 3']]) {
  const n0 = (await rn(page))[0]; await page.getByLabel(name).click(); const t = await settle(page, n0, 15); await measure(label, t);
}
console.log('probe', JSON.stringify(await readProbe(page)));
await shot(page, '07-after-aperture');
await ctx.close();
