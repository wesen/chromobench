import { launch, goto, shot, bodyText, readProbe, PHOTOS, meanRGB, luma, rn, settle, panelVals } from './lib.mjs';
const { ctx, page } = await launch(false, 'fresh');
await goto(page);
const modeSel = () => page.evaluate(() => document.querySelector('select[aria-label="Enlarger mode"]')?.value ?? null);
const lay = async (name) => { await page.getByText('View', { exact: true }).first().click(); await page.getByText('Layout…', { exact: true }).click(); await page.waitForTimeout(500); await page.getByRole('button', { name, exact: true }).click(); await page.waitForTimeout(2500); };
await lay('Simple');
console.log('layout simple; opening NEW file DSC_8541 (tungsten) in Simple');
await page.setInputFiles('#file', PHOTOS + '/DSC_8541.NEF'); await page.waitForTimeout(14000);
await page.getByText('Print', { exact: false }).filter({ hasText: /②/ }).first().click(); await page.waitForTimeout(6000);
await shot(page, '19-simple-new-frame');
console.log('SIMPLE new frame: ' + (await bodyText(page)).split('\n').join(' | '));
const pic = { x: 50, y: 90, width: 1100, height: 650 };
const m0 = await meanRGB(page, pic); console.log('simple picture', JSON.stringify(m0), luma(m0));
for (let i = 0; i < 2; i++) { const n0 = (await rn(page))[0]; await page.getByRole('button', { name: /Lighter/ }).first().click(); await settle(page, n0, 25); const m = await meanRGB(page, pic); console.log('lighter', i+1, JSON.stringify(m), luma(m)); }
console.log('body: ' + (await bodyText(page)).split('\n').join(' | '));
await shot(page, '19b-simple-new-frame-lighter');
await lay('Classic');
console.log('classic after switch: ' + (await bodyText(page)).split('\n').slice(-12).join(' | '));
// select 8541 again
await page.setInputFiles('#file', PHOTOS + '/DSC_8541.NEF'); await page.waitForTimeout(12000);
await shot(page, '20-classic-after-simple');
console.log('classic: mode', await modeSel(), JSON.stringify(await panelVals(page)));
const t = (await bodyText(page)).split('\n'); console.log('darkroom text', t.slice(t.indexOf('Darkroom'), t.indexOf('Paper')).join(' | '));
const m2 = await meanRGB(page, { x: 250, y: 140, width: 880, height: 580 }); console.log('classic picture', JSON.stringify(m2), luma(m2));
console.log('hist', t.filter(l => /→/.test(l)).slice(-3).join(' | '));
await ctx.close();
