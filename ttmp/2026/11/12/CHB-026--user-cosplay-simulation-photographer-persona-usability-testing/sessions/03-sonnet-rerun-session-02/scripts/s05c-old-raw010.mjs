import { launch, goto, shot, bodyText, readProbe, PHOTOS, meanRGB, luma, rn, settle, panelVals, MAIN, uptime } from './lib.mjs';
const { ctx, page } = await launch(false, 'old-library');
await page.goto('http://localhost:4650/'); await page.waitForTimeout(3000);
await readProbe(page);
await page.getByText('raw010.dng · 2/3', { exact: true }).first().click(); await page.waitForTimeout(1200);
console.log('dialog:', (await readProbe(page)).ui.map(u => u.text).join(' / '));
const t0 = Date.now();
await page.setInputFiles('#file', PHOTOS + '/raw010.dng');
for (let i = 0; i < 160; i++) { await page.waitForTimeout(250); const l = (await bodyText(page)).split('\n').slice(-3).join(' | '); if (/rendered \d/.test(l) && i > 8) { console.log('relink to picture', (Date.now() - t0) / 1000, uptime()); break; } }
await page.waitForTimeout(3000);
await shot(page, '28-old-raw010-relinked');
await page.getByRole('button', { name: 'Not now' }).click().catch(() => {}); await page.waitForTimeout(800);
await shot(page, '28b-old-raw010-dialog-dismissed');
const t = (await bodyText(page)).split('\n');
console.log('bottom:', t.slice(-10).join(' | '));
console.log('darkroom text', t.slice(t.indexOf('Darkroom'), t.indexOf('Paper')).join(' | '));
console.log('mode', await page.evaluate(() => document.querySelector('select[aria-label="Enlarger mode"]')?.value), JSON.stringify(await panelVals(page)));
console.log('ui', JSON.stringify((await readProbe(page)).ui));
const m = await meanRGB(page, MAIN); console.log('picture', JSON.stringify(m), luma(m));
const sel = page.getByLabel('Enlarger mode');
await sel.selectOption('real'); await page.waitForTimeout(5000);
console.log('real:', JSON.stringify(await panelVals(page)));
const box = page.getByLabel('Time value');
for (const v of ['2.23', '4', '8']) { const n0 = (await rn(page))[0]; await box.click(); await box.press('Control+a'); await box.type(v); await box.press('Enter'); const s = await settle(page, n0, 25); const mm = await meanRGB(page, MAIN); console.log('time', v, JSON.stringify(mm), luma(mm), 'settle', s); }
await shot(page, '29-old-raw010-time-8');
await ctx.close();
