import { launch, goto, shot, bodyText, readProbe, PHOTOS, openFile, uptime, rn, settle } from './lib.mjs';
const { ctx, page } = await launch(false, 'fresh');
await goto(page);
await openFile(page, PHOTOS + '/DSC_8559.NEF');
await page.waitForTimeout(2500);
await readProbe(page);
const box = page.getByLabel('Time value');
const tip = await page.evaluate(() => { const e = document.querySelector('input[aria-label="Time value"]'); return [e.title, e.placeholder, e.parentElement?.title, document.querySelector('input[aria-label="Time"]')?.title]; });
console.log('tooltips/placeholders', JSON.stringify(tip));
const worst = []; let n = 0;
for (const v of ['10', '15', '0', '-5', '-5 s', '+1/3 st', 'abc', '1000', '12s', '7,5', '']) {
  const t0 = Date.now();
  await box.click(); await box.press('Control+a'); if (v) await box.type(v); else await box.press('Delete');
  await box.press('Enter');
  await page.waitForTimeout(2500);
  const r = await readProbe(page);
  const bad = await box.evaluate((e) => e.classList.contains('is-bad') || /bad/.test(e.className));
  console.log(`typed ${JSON.stringify(v)} -> box ${JSON.stringify(await box.inputValue())} bad=${bad} | log ${JSON.stringify(r.ui.filter(u=>u.kind!=='menu'))} | stall ${r.worstStallMs}`);
  worst.push(r.worstStallMs);
  if (v === 'abc') await shot(page, '12-typed-abc');
  if (v === '-5') await shot(page, '12b-typed-minus5');
  if (v === '') await shot(page, '12c-typed-empty');
  if (v === '1000') await shot(page, '12d-typed-1000');
}
// is the red state leaking to another frame? (only one frame here); blur
await page.mouse.click(700, 770); await page.waitForTimeout(800);
console.log('after blur box', await box.inputValue());
console.log('worst stalls', Math.max(...worst));
console.log('hist', (await page.evaluate(() => document.body.innerText)).split('\n').filter(l => /→/.test(l)).join(' | '));
await ctx.close();
