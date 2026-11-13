import { launch, goto, shot, bodyText, readProbe, PHOTOS, SHOTS, waitRendered } from './lib.mjs';
import { execSync } from 'node:child_process';
console.log('uptime', execSync('uptime').toString().trim());
const { ctx, page } = await launch(true, 'fresh');
await goto(page);
console.log('--- EMPTY BODY ---\n' + await bodyText(page));
await shot(page, '01-empty');
const t0 = Date.now();
await page.setInputFiles('#file', PHOTOS + '/DSC_8559.NEF');
const seen = []; let last = '';
let firstPic = -1;
for (let i = 0; i < 240; i++) {
  await page.waitForTimeout(250);
  const l = (await bodyText(page)).split('\n').slice(-4).join(' | ');
  if (l !== last) { last = l; seen.push([((Date.now()-t0)/1000).toFixed(1), l]); console.log(seen.at(-1).join('s  ')); }
  if (i === 20) await shot(page, '02-cold-open-waiting-5s');
  if (i === 60) await shot(page, '02b-cold-open-waiting-15s');
  if (/rendered \d/.test(l) && !/opening/.test(l)) { firstPic = (Date.now()-t0)/1000; break; }
}
console.log('first picture s', firstPic);
await page.waitForTimeout(4000);
console.log(JSON.stringify(await readProbe(page), null, 1));
console.log('uptime', execSync('uptime').toString().trim());
console.log('--- BODY ---\n' + await bodyText(page));
await shot(page, '03-nef-opened');
await ctx.close();
