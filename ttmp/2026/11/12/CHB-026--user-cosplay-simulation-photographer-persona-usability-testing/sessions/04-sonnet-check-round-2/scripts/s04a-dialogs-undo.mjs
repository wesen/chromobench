import { launch, goto, shot, bodyText, readProbe, PHOTOS, openFile, rn, settle, panelVals } from './lib.mjs';
const { ctx, page } = await launch(false, 'fresh'); await goto(page);   // reload: library frames are "not open"
await readProbe(page);
console.log('library after reload:', (await bodyText(page)).split('\n').filter(l => /not open|DSC_8559/.test(l)).slice(0, 4).join(' | '));
await page.getByText('DSC_8559.NEF', { exact: true }).first().click(); await page.waitForTimeout(1500);
const dlg = () => page.evaluate(() => [...document.querySelectorAll('[role=dialog]')].map(e => e.innerText.replace(/\n+/g, ' / ')).join(' ## '));
console.log('after click on not-open frame, dialog:', await dlg()); await shot(page, '60-where-is');
const t0 = Date.now();
let fcPromise = page.waitForEvent('filechooser', { timeout: 4000 }).catch(() => null);
await page.keyboard.press('Control+o');
let fc = await fcPromise; console.log('Ctrl+O with the dialog open gives a file chooser:', !!fc);
if (fc) await fc.setFiles(PHOTOS + '/DSC_8559.NEF'); else { console.log('fallback: the same input File > Open feeds'); await page.setInputFiles('#file', PHOTOS + '/DSC_8559.NEF'); }
for (let i = 0; i < 40; i++) { await page.waitForTimeout(500); if (!(await dlg())) { console.log('dialog gone after', (Date.now() - t0) / 1000, 's'); break; } }
await page.waitForTimeout(6000);
console.log('dialog now:', JSON.stringify(await dlg())); await shot(page, '61-after-file-open');
console.log('ui', JSON.stringify((await readProbe(page)).ui.filter(u => u.kind !== 'menu')), '| status', (await bodyText(page)).split('\n').slice(-1)[0]);
// two frames: open 8541 too, edit A (8559), select B (8541), Undo
await openFile(page, PHOTOS + '/DSC_8541.NEF'); await page.waitForTimeout(3000);
await page.getByText('DSC_8559.NEF', { exact: true }).last().click(); await page.waitForTimeout(3500);
const box = page.getByLabel('Time value'); let n0 = (await rn(page))[0]; await box.click(); await box.press('Control+a'); await box.type('14'); await box.press('Enter'); await settle(page, n0, 30);
console.log('A edited, panel', (await panelVals(page)).Time);
await page.getByText('DSC_8541.NEF', { exact: true }).last().click(); await page.waitForTimeout(3500);
console.log('on B, panel Time', (await panelVals(page)).Time); await shot(page, '62-on-B-before-undo'); await readProbe(page);
await page.keyboard.press('Control+z'); await page.waitForTimeout(3500);
const cur = await page.evaluate(() => window.chromobench?.studio?.current?.name ?? null);
console.log('after Undo: panel Time', (await panelVals(page)).Time, '| ui', JSON.stringify((await readProbe(page)).ui.filter(u => u.kind !== 'menu')), '| current frame', cur);
await shot(page, '63-after-undo-other-frame');
console.log('label shown top-left:', (await bodyText(page)).split('\n').filter(l => /^DSC_85\d+\.NEF$/.test(l)).join(' | '));
await ctx.close();
