import { launch, goto, shot, bodyText, readProbe, PHOTOS, waitRendered, SHOTS } from './lib.mjs';
import { execSync } from 'node:child_process';
const { ctx, page } = await launch(false);
await goto(page);
await page.setInputFiles('#file', PHOTOS + '/DSC_8559.NEF');
await waitRendered(page, 'open', 60);
await page.waitForTimeout(3000);
const mean = async (tag) => { const f = SHOTS + '/_tmp.png'; await page.screenshot({ path: f, clip: { x: 250, y: 140, width: 880, height: 580 } }); return execSync(`python3 -c "from PIL import Image, ImageStat; print(round(ImageStat.Stat(Image.open('${f}').convert('L')).mean[0],2))"`).toString().trim(); };
const box = page.getByLabel('Time value');
const val = async () => await box.inputValue();
const cls = async () => await box.getAttribute('class');
console.log('start', await val(), 'mean', await mean());
await readProbe(page);
const results = [];
for (const v of ['15', '0', '-5', 'abc', '1000', '12s', '7,5', '']) {
  await box.click(); await box.press('Control+a'); if (v) await box.type(v); else await box.press('Backspace');
  const n0 = (await bodyText(page)).match(/rendered (\d+)/)?.[1];
  const t0 = Date.now(); await box.press('Enter');
  let tr = -1;
  for (let i = 0; i < 80; i++) { await page.waitForTimeout(250); const n = (await bodyText(page)).match(/rendered (\d+)/)?.[1]; if (n !== n0) { tr = Date.now() - t0; } if (tr > 0 && Date.now() - t0 - tr > 2500) break; if (i > 12 && tr < 0) break; }
  await page.waitForTimeout(300);
  const p = await readProbe(page);
  const r = { typed: v, boxNow: await val(), cls: await cls(), msToLastRender: tr, toasts: p.toasts.map(t=>t[2]), ui: p.ui.map(u=>u.text??u.kind), worstStall: p.worstStallMs, mean: await mean() };
  console.log(JSON.stringify(r));
  await shot(page, '15-typed-' + (v||'empty').replace(/[^a-z0-9]/gi,'_'));
}
// switch focus away and see state
await page.mouse.click(700, 760); await page.waitForTimeout(400);
console.log('after blur box', await val(), await cls());
await shot(page, '16-after-typing');
await ctx.close();
