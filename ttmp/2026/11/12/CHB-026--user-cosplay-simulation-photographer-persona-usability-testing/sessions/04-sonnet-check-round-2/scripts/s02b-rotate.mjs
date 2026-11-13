import { launch, goto, shot, bodyText, readProbe, rn, settle } from './lib.mjs';
import { execSync } from 'node:child_process';
const SHOTS = new URL('../shots/', import.meta.url).pathname;
const an = (f) => execSync(`python3 ${SHOTS}../scripts/analyze.py ${SHOTS}${f}.png`).toString().trim();
const [file, tag, ...rots] = process.argv.slice(2); // rots like 1:Left
const { ctx, page } = await launch(false, 'fresh'); await goto(page); await readProbe(page);
await page.setInputFiles('#file', file);
for (let i = 0; i < 480; i++) { await page.waitForTimeout(250); const l = (await bodyText(page)).split('\n').slice(-4).join(' | '); if (/rendered \d/.test(l) && !/opening/.test(l) && i > 8) break; }
await page.waitForTimeout(3000);
console.log('ui after open', JSON.stringify((await readProbe(page)).ui.filter(u=>u.kind!=='menu')));
const base = file.split('/').pop();
for (const r of rots) {
  const [k, dir] = r.split(':');
  await page.getByText(new RegExp(base.replace('.', '\\.') + ' · ' + k + '/\\d')).last().click(); await page.waitForTimeout(4500);
  const n0 = (await rn(page))[0];
  await page.getByText('Frame', { exact: true }).first().click(); await page.waitForTimeout(250);
  if (k === rots[0].split(':')[0]) console.log('frame menu:', await page.evaluate(() => [...document.querySelectorAll('[role=menuitem]')].map(e => e.innerText.replace(/\s+/g,' ')).join(' || ')));
  await page.getByText('Rotate ' + dir, { exact: true }).click();
  console.log('frame', k, 'rotate', dir, 'settle', await settle(page, n0, 30));
  await page.waitForTimeout(10000);
  await shot(page, `${tag}-f${k}-rot${dir}`); console.log(an(`${tag}-f${k}-rot${dir}`));
  console.log('history:', (await bodyText(page)).split('\n').filter(l => /Rotated|Auto/.test(l)).join(' | '));
}
await ctx.close();
