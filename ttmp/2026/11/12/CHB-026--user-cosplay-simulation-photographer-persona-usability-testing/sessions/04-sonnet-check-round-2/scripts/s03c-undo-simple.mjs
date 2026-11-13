import { launch, goto, shot, bodyText, readProbe, PHOTOS, openFile, meanRGB, luma, rn, settle, panelVals } from './lib.mjs';
const { ctx, page } = await launch(false, 'fresh'); await goto(page);
await openFile(page, PHOTOS + '/DSC_8559.NEF'); await page.waitForTimeout(3000); await readProbe(page);
const lay = async (name) => { await page.getByText('View', { exact: true }).first().click(); await page.getByText('Layout…', { exact: true }).click(); await page.waitForTimeout(500); await page.getByRole('dialog').getByRole('button', { name, exact: true }).click(); await page.waitForTimeout(3000); if (await page.getByRole('dialog').count()) await page.keyboard.press('Escape'); await page.waitForTimeout(1500); };
const hist = async () => (await bodyText(page)).split('\n').filter(l => /Time|Rotated|Lighter|Darker|stop|Auto/.test(l)).slice(0, 8).join(' | ');
// edit in Classic, switch layout, undo
let n0 = (await rn(page))[0]; const box = page.getByLabel('Time value'); await box.click(); await box.press('Control+a'); await box.type('14'); await box.press('Enter'); await settle(page, n0, 30);
console.log('classic after edit: Time', (await panelVals(page)).Time, '| history', await hist());
const l1 = luma(await meanRGB(page, { x: 250, y: 140, width: 880, height: 580 }, '_m')); console.log('luma edited', l1);
await lay('Darkroom');
console.log('darkroom: Time', (await panelVals(page)).Time, '| history', await hist());
await shot(page, '43-darkroom-after-edit');
n0 = (await rn(page))[0];
await page.getByText('Edit', { exact: true }).first().click(); await page.waitForTimeout(300);
console.log('edit menu:', await page.evaluate(() => [...document.querySelectorAll('[role=menuitem]')].map(e => e.innerText.replace(/\s+/g, ' ')).filter(x => /Undo|Redo/.test(x)).join(' || ')));
await page.getByText(/^Undo/).first().click(); await settle(page, n0, 30); await page.waitForTimeout(1500);
console.log('after Undo (menu) in darkroom: Time', (await panelVals(page)).Time, '| history', await hist());
const l2 = luma(await meanRGB(page, { x: 100, y: 100, width: 900, height: 600 }, '_m')); console.log('luma after undo (darkroom, wide clip)', l2);
await shot(page, '44-darkroom-after-undo');
console.log('ui', JSON.stringify((await readProbe(page)).ui.filter(u => u.kind !== 'menu')));
// Simple
await lay('Simple');
console.log('--- SIMPLE ---'); await shot(page, '45-simple-start');
console.log((await bodyText(page)).split('\n').filter(Boolean).join(' | ').slice(0, 900));
for (const step of [/Print/]) { await page.getByText('Print', { exact: true }).first().click(); await page.waitForTimeout(3500); }
await shot(page, '46-simple-print');
const body = await bodyText(page); console.log('simple print body:', body.split('\n').filter(Boolean).join(' | ').slice(0, 1200));
console.log('sliders:', await page.evaluate(() => [...document.querySelectorAll('input')].filter(e => e.offsetParent).map(e => (e.getAttribute('aria-label') || e.type) + '=' + e.value).join(' ; ')));
await ctx.close();
