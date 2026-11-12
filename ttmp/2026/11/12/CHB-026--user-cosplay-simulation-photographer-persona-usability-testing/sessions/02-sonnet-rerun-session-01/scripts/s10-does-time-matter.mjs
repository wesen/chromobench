import { launch, goto, shot, bodyText, readProbe, PHOTOS, waitRendered, SHOTS } from './lib.mjs';
import { execSync } from 'node:child_process';
const { ctx, page } = await launch(false);
await goto(page);
await page.setInputFiles('#file', PHOTOS + '/DSC_8559.NEF');
await waitRendered(page, 'open', 60);
await page.waitForTimeout(3000);
const mean = async () => { const f = SHOTS + '/_tmp.png'; await page.screenshot({ path: f, clip: { x: 250, y: 140, width: 880, height: 580 } }); return execSync(`python3 -c "from PIL import Image, ImageStat; print(round(ImageStat.Stat(Image.open('${f}').convert('L')).mean[0],2))"`).toString().trim(); };
const n = async () => (await bodyText(page)).match(/rendered (\d+)/)?.[1];
console.log('start', await mean(), await n());
const box = page.getByLabel('Time value');
for (const v of ['0.1', '600', '10']) { await box.click(); await box.press('Control+a'); await box.type(v); await box.press('Enter'); await page.waitForTimeout(8000); console.log('time', v, 'mean', await mean(), 'n', await n()); }
for (let i = 0; i < 3; i++) { await page.getByRole('button', { name: 'Lighter' }).click(); await page.waitForTimeout(6000); console.log('lighter', i, await mean(), await n()); }
const info = await page.evaluate(() => { const f = window.chromobench?.studio?.current; return f ? Object.keys(f).slice(0,40) : null; });
console.log(JSON.stringify(info));
await shot(page, '17-lighter-x3');
await ctx.close();
