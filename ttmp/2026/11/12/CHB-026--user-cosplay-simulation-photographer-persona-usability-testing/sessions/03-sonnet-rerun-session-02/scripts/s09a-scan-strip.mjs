import { launch, goto, shot, bodyText, readProbe, uptime, ROOT } from './lib.mjs';
import { execSync } from 'node:child_process';
const SHOTS = new URL('../shots/', import.meta.url).pathname;
const an = (f) => execSync(`python3 ${SHOTS}../scripts/analyze.py ${SHOTS}${f}.png`).toString().trim();
const { ctx, page } = await launch(false, 'fresh'); await goto(page);
await readProbe(page);
const t0 = Date.now(); console.log('uptime', uptime());
await page.setInputFiles('#file', ROOT + '/.playwright-mcp/scans/2025-08-09_raw000.dng');
let opened = -1, first = -1;
for (let i = 0; i < 480; i++) { await page.waitForTimeout(250); const l = (await bodyText(page)).split('\n').slice(-4).join(' | '); if (opened < 0 && /opened 2025/.test(l)) opened = (Date.now() - t0) / 1000; if (/rendered \d/.test(l) && !/opening/.test(l) && i > 8) { first = (Date.now() - t0) / 1000; break; } }
console.log('opened', opened, 'first picture', first);
await page.waitForTimeout(3000);
const b = (await bodyText(page)).split('\n');
console.log('status:', b.slice(-6).join(' | '));
console.log('frames:', [...new Set(b.filter(l => /raw000/.test(l)))].join(' | '));
console.log('ui', JSON.stringify((await readProbe(page)).ui.filter(u => u.kind !== 'menu')));
console.log('tooltip decode:', await page.evaluate(() => [...document.querySelectorAll('[title]')].filter(e => /strip|frame/i.test(e.title)).map(e => e.title).join(' ## ')));
const n = [...new Set(b.filter(l => /raw000.*\d\/\d/.test(l)))].length;
for (let k = 1; k <= 6; k++) {
  const el = page.getByText(new RegExp(`2025-08-09_raw000\\.dng · ${k}/\\d`)).last();
  if (!(await el.count())) break;
  await el.click(); await page.waitForTimeout(4500);
  await shot(page, `60-scan-frame-${k}`); console.log('frame', k, an(`60-scan-frame-${k}`));
}
await ctx.close();
