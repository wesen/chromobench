import { launch, goto, shot, bodyText, readProbe, PHOTOS, rn, settle } from './lib.mjs';
import { execSync } from 'node:child_process';
const SHOTS = new URL('../shots/', import.meta.url).pathname;
const an = (f) => execSync(`python3 ${SHOTS}../scripts/analyze.py ${SHOTS}${f}.png`).toString().trim();
const { ctx, page } = await launch(false, 'fresh'); await goto(page);
await page.setInputFiles('#file', PHOTOS + '/raw010.dng');
for (let i = 0; i < 200; i++) { await page.waitForTimeout(250); const l = (await bodyText(page)).split('\n').slice(-4).join(' | '); if (/rendered \d/.test(l) && i > 8) break; }
await page.waitForTimeout(2500);
await page.getByText('raw010.dng · 3/3', { exact: true }).first().click(); await page.waitForTimeout(4000);
await readProbe(page);
console.log('tooltip engine pill:', await page.evaluate(() => [...document.querySelectorAll('[title]')].filter(e => /Compat|mode|working|CPU|GPU/i.test(e.title + e.innerText)).map(e => e.innerText + ' => ' + e.title).join(' ## ')));
const frameMenu = async (item) => { await page.getByText('Frame', { exact: true }).first().click(); await page.waitForTimeout(250); await page.getByText(item, { exact: true }).click(); };
let n0 = (await rn(page))[0]; await frameMenu('Rotate Right'); console.log('rotate right settle', await settle(page, n0, 20));
await shot(page, '51-rotated-right'); console.log('rotated', an('51-rotated-right'));
console.log('ui', JSON.stringify((await readProbe(page)).ui.filter(u => u.kind !== 'menu')));
console.log('hist:', (await bodyText(page)).split('\n').filter(l => /Rotat|orient|crop/i.test(l)).join(' | '));
await page.getByText('Edit', { exact: true }).first().click(); await page.waitForTimeout(250);
console.log('edit menu:', await page.evaluate(() => [...document.querySelectorAll('[role=menuitem]')].map(e => e.innerText.replace(/\s+/g, ' ')).filter(x => /Undo|Redo/.test(x)).join(' || ')));
await page.keyboard.press('Escape'); await page.mouse.click(700, 770);
n0 = (await rn(page))[0]; await page.keyboard.press('Control+z'); console.log('undo settle', await settle(page, n0, 20));
await shot(page, '52-after-undo-rotate');
// zoom
await page.mouse.click(700, 400);
const nz0 = (await rn(page))[0];
await shot(page, '53-fit'); console.log('fit', an('53-fit'));
for (let i = 1; i <= 4; i++) { await page.keyboard.press('Control+='); await page.waitForTimeout(3500); await shot(page, `54-zoom-${i}`); console.log('zoom', i, an(`54-zoom-${i}`), (await bodyText(page)).split('\n').filter(l => /%|1:1|zoom/i.test(l)).slice(0,3).join(' | ')); }
console.log('probe', JSON.stringify(await readProbe(page)));
await ctx.close();
