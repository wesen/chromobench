import { launch, goto, shot, bodyText, readProbe, uptime, ROOT, panelVals } from './lib.mjs';
import { execSync } from 'node:child_process';
const SHOTS = new URL('../shots/', import.meta.url).pathname;
const an = (f) => execSync(`python3 ${SHOTS}../scripts/analyze.py ${SHOTS}${f}.png`).toString().trim();
const file = process.argv[2]; const tag = process.argv[3];
const { ctx, page } = await launch(false, 'fresh'); await goto(page); await readProbe(page);
console.log('uptime', uptime());
const t0 = Date.now();
await page.setInputFiles('#file', file);
let first = -1;
for (let i = 0; i < 480; i++) { await page.waitForTimeout(250); const l = (await bodyText(page)).split('\n').slice(-4).join(' | '); if (/rendered \d/.test(l) && !/opening/.test(l) && i > 8) { first = (Date.now() - t0) / 1000; break; } }
console.log('first picture', first); await page.waitForTimeout(4000);
const b = (await bodyText(page)).split('\n');
console.log('status:', b.slice(-6).join(' | '));
const base = file.split('/').pop();
const frames = [...new Set(b.filter(l => l.includes(base) && /\d\/\d/.test(l)))];
console.log('frames:', frames.join(' | '));
console.log('ui', JSON.stringify((await readProbe(page)).ui.filter(u => u.kind !== 'menu')));
const n = frames.length || 1;
for (let k = 1; k <= n; k++) {
  const el = page.getByText(frames[k-1] ?? base, { exact: true }).last();
  await el.click(); await page.waitForTimeout(6000);
  await shot(page, `${tag}-f${k}`); console.log('frame', k, an(`${tag}-f${k}`));
  console.log('  vals', JSON.stringify(await panelVals(page)));
}
console.log('decode text:', b.filter(l => /strip|frame|base|edge/i.test(l)).join(' | '));
await ctx.close();
