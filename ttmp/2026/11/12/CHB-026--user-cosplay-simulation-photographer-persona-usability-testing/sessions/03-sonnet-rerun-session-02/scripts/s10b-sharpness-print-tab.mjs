import { launch, goto, shot, bodyText, readProbe, PHOTOS, rn, settle, uptime } from './lib.mjs';
import { execSync } from 'node:child_process';
const SHOTS = new URL('../shots/', import.meta.url).pathname;
const an = (f) => execSync(`python3 ${SHOTS}../scripts/analyze.py ${SHOTS}${f}.png`).toString().trim();
const { ctx, page } = await launch(true, 'fresh'); await goto(page);
await page.setInputFiles('#file', PHOTOS + '/DSC_8559.NEF');
for (let i = 0; i < 480; i++) { await page.waitForTimeout(250); const l = (await bodyText(page)).split('\n').slice(-4).join(' | '); if (/rendered \d/.test(l) && !/opening/.test(l) && i > 8) break; }
await page.waitForTimeout(3000);
await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === 'Negative'); b.previousElementSibling.click(); }); await page.waitForTimeout(3000);
await page.keyboard.press('Control+0'); await page.waitForTimeout(3000);
await shot(page, '75-nef-fit-print'); console.log('fit', an('75-nef-fit-print'), '|', (await bodyText(page)).split('\n').slice(-1)[0]);
for (let i = 1; i <= 3; i++) {
  await page.mouse.move(690, 420); await page.keyboard.press('Control+=');
  const t0 = Date.now(); let last = '';
  for (let k = 0; k < 80; k++) { await page.waitForTimeout(500); const s = (await bodyText(page)).split('\n').slice(-1)[0]; if (s !== last) { last = s; console.log('  ', ((Date.now() - t0) / 1000).toFixed(1) + 's', s); } if (k > 6 && /screen|refine/.test(s) && Date.now() - t0 > 9000) break; }
  await shot(page, `76-nef-print-zoom-${i}`); console.log('zoom', i, an(`76-nef-print-zoom-${i}`));
}
console.log('probe', JSON.stringify(await readProbe(page)).slice(0, 600));
await ctx.close();
