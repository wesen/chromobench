import { launch, goto, shot, bodyText, readProbe, PHOTOS, uptime, rn, settle } from './lib.mjs';
import { execSync } from 'node:child_process';
const SHOTS = new URL('../shots/', import.meta.url).pathname;
const { ctx, page } = await launch(true, 'fresh'); await goto(page);
await page.setInputFiles('#file', PHOTOS + '/raw010.dng');
for (let i = 0; i < 200; i++) { await page.waitForTimeout(250); const l = (await bodyText(page)).split('\n').slice(-4).join(' | '); if (/rendered \d/.test(l) && !/opening/.test(l)) break; }
await page.waitForTimeout(3000);
console.log('status', (await bodyText(page)).split('\n').slice(-6).join(' | '));
console.log('frames:', (await bodyText(page)).split('\n').filter(l => /raw010/.test(l)).join(' | '));
await readProbe(page);
const an = (f) => execSync(`python3 ${SHOTS}../scripts/analyze.py ${SHOTS}${f}.png`).toString().trim();
for (let k = 1; k <= 3; k++) {
  await page.getByText(`raw010.dng · ${k}/3`, { exact: true }).first().click();
  await page.waitForTimeout(4500);
  await shot(page, `50-strip-frame-${k}`);
  console.log('frame', k, an(`50-strip-frame-${k}`));
  const t = (await bodyText(page)).split('\n'); console.log('  time/lights:', await page.evaluate(() => Object.entries(Object.fromEntries([...document.querySelectorAll('input[aria-label$=" value"]')].filter(e=>e.offsetParent).map(e => [e.getAttribute('aria-label').replace(' value',''), e.value]))).map(([a,b])=>a+'='+b).join(' ')));
}
console.log('probe', JSON.stringify(await readProbe(page)));
await ctx.close();
