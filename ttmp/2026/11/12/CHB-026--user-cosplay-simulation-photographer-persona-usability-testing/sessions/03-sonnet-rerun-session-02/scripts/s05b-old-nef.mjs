import { launch, goto, shot, bodyText, readProbe, PHOTOS, meanRGB, luma, rn, settle, panelVals, MAIN, uptime } from './lib.mjs';
const { ctx, page } = await launch(false, 'old-library');
page.on('filechooser', () => console.log('FILECHOOSER event fired'));
await page.goto('http://localhost:4650/'); await page.waitForTimeout(3000);
await readProbe(page);
await page.getByText('DSC_8541.NEF', { exact: true }).first().click(); await page.waitForTimeout(1200);
await shot(page, '24-old-where-is');
const t0 = Date.now();
const p = page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null);
await page.getByRole('button', { name: /Locate DSC/ }).click();
const fc = await p; console.log('chooser from Locate:', !!fc);
if (fc) await fc.setFiles(PHOTOS + '/DSC_8541.NEF'); else await page.setInputFiles('#file', PHOTOS + '/DSC_8541.NEF');
for (let i = 0; i < 120; i++) { await page.waitForTimeout(250); const l = (await bodyText(page)).split('\n').slice(-3).join(' | '); if (/rendered \d/.test(l)) { console.log('relink to picture', (Date.now() - t0) / 1000, uptime()); break; } }
await page.waitForTimeout(2500);
await shot(page, '25-old-nef-relinked');
console.log('ui', JSON.stringify((await readProbe(page)).ui));
const t = (await bodyText(page)).split('\n');
console.log('darkroom text', t.slice(t.indexOf('Darkroom'), t.indexOf('Paper')).join(' | '));
console.log('mode', await page.evaluate(() => document.querySelector('select[aria-label="Enlarger mode"]')?.value), JSON.stringify(await panelVals(page)));
console.log('hist', t.filter(l => /→|Auto|You/.test(l)).join(' | '));
const m = await meanRGB(page, MAIN); console.log('picture', JSON.stringify(m), luma(m));
// try printing darker via time
console.log('time inputs present:', await page.getByLabel('Time value').count());
const sel = page.getByLabel('Enlarger mode');
await sel.selectOption('real'); await page.waitForTimeout(4000);
await shot(page, '26-old-nef-real');
console.log('after switching to real:', JSON.stringify(await panelVals(page)), JSON.stringify((await readProbe(page)).ui.filter(u=>u.kind!=='menu')));
const m2 = await meanRGB(page, MAIN); console.log('picture real', JSON.stringify(m2), luma(m2));
const box = page.getByLabel('Time value');
for (const v of ['15', '20']) { const n0 = (await rn(page))[0]; await box.click(); await box.press('Control+a'); await box.type(v); await box.press('Enter'); const s = await settle(page, n0, 20); const mm = await meanRGB(page, MAIN); console.log('time', v, JSON.stringify(mm), luma(mm), 'settle', s); }
await shot(page, '27-old-nef-time-20');
await ctx.close();
