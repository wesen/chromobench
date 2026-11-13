import { launch, goto, shot, bodyText, readProbe, PHOTOS, rn, settle, uptime } from './lib.mjs';
import { execSync } from 'node:child_process';
const SHOTS = new URL('../shots/', import.meta.url).pathname;
const an = (f) => execSync(`python3 ${SHOTS}../scripts/analyze.py ${SHOTS}${f}.png`).toString().trim();
const { ctx, page } = await launch(false, 'fresh'); await goto(page);
await page.setInputFiles('#file', PHOTOS + '/DSC_8559.NEF');
for (let i = 0; i < 480; i++) { await page.waitForTimeout(250); const l = (await bodyText(page)).split('\n').slice(-4).join(' | '); if (/rendered \d/.test(l) && !/opening/.test(l) && i > 8) break; }
await page.waitForTimeout(4000);
console.log('titles:\n' + await page.evaluate(() => [...document.querySelectorAll('[title]')].filter(e => e.title.length > 3).map(e => (e.getAttribute('aria-label') || e.innerText || e.tagName).slice(0, 40).replace(/\n/g,' ') + ' => ' + e.title.replace(/\n/g, ' ⏎ ')).join('\n')));
console.log('\noptions:\n' + await page.evaluate(() => [...document.querySelectorAll('select')].map(s => (s.getAttribute('aria-label')) + ': ' + [...s.options].map(o => o.text).join(' | ') + ' [selected: ' + s.selectedOptions[0]?.text + ']').join('\n')));
const b = (await bodyText(page)).split('\n'); console.log('\nstatus bar:', b.slice(-5).join(' | '));
await page.getByText('View', { exact: true }).first().click(); await page.waitForTimeout(250); console.log('view menu:', await page.evaluate(() => [...document.querySelectorAll('[role=menuitem]')].map(e => e.innerText.replace(/\s+/g, ' ')).slice(8).join(' || '))); await page.keyboard.press('Escape'); await page.mouse.click(700, 400);
// Photo pill text/hover
await page.getByRole('button', { name: 'Photo' }).hover().catch(()=>{}); await page.waitForTimeout(600);
await shot(page, '70-hover-photo-pill');
// tabs
await page.getByText('Negative', { exact: true }).first().click(); await page.waitForTimeout(5000); await shot(page, '71-negative-tab'); 
await page.getByText('Print', { exact: true }).first().click(); await page.waitForTimeout(3000);
// sharpness fit
await page.mouse.click(700, 400); await page.keyboard.press('Control+0'); await page.waitForTimeout(4000);
await shot(page, '72-nef-fit'); console.log('\nfit', an('72-nef-fit'));
for (let i = 1; i <= 5; i++) { await page.keyboard.press('Control+='); await page.waitForTimeout(4000); await shot(page, `73-nef-zoom-${i}`); console.log('zoom', i, an(`73-nef-zoom-${i}`), '|', (await bodyText(page)).split('\n').slice(-1)[0]); }
await page.waitForTimeout(15000); await shot(page, '74-nef-zoom-5-settled'); console.log('zoom 5 settled', an('74-nef-zoom-5-settled'), '|', (await bodyText(page)).split('\n').slice(-1)[0]);
console.log('probe', JSON.stringify(await readProbe(page)).slice(0, 700));
await ctx.close();
