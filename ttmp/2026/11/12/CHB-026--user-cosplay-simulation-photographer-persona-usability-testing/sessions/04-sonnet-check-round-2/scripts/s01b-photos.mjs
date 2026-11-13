import { launch, goto, shot, bodyText, readProbe, uptime, PHOTOS, openFile, panelVals, rn } from './lib.mjs';
import { execSync } from 'node:child_process';
const SHOTS = new URL('../shots/', import.meta.url).pathname;
const an = (f) => execSync(`python3 ${SHOTS}../scripts/analyze.py ${SHOTS}${f}.png`).toString().trim();
const { ctx, page } = await launch(false, 'fresh'); await goto(page);
console.log('uptime', uptime());
for (const n of ['8559','8541','8536','8655','8687']) {
  await readProbe(page);
  const t = await openFile(page, `${PHOTOS}/DSC_${n}.NEF`, 120);
  await page.waitForTimeout(8000);
  console.log('---', n, 'open secs', t, 'status', (await bodyText(page)).split('\n').slice(-1)[0]);
  console.log('panel', JSON.stringify(await panelVals(page)), 'mode', await page.evaluate(() => document.querySelector('select[aria-label="Enlarger mode"]')?.value ?? null));
  await shot(page, `01-first-${n}`);
  console.log(an(`01-first-${n}`));
  const pr = await readProbe(page); console.log('ui', JSON.stringify(pr.ui.filter(u=>u.kind!=='menu')), 'worst stall', pr.worstStallMs);
}
await page.waitForTimeout(1000);
await shot(page, '01-final');
await ctx.close();
