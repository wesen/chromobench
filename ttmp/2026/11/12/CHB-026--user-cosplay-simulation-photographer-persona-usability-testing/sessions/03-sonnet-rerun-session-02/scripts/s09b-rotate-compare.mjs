import { launch, goto, shot, bodyText, readProbe, ROOT, rn, settle } from './lib.mjs';
const { ctx, page } = await launch(false, 'fresh'); await goto(page);
await page.setInputFiles('#file', ROOT + '/.playwright-mcp/scans/2025-08-09_raw000.dng');
for (let i = 0; i < 480; i++) { await page.waitForTimeout(250); const l = (await bodyText(page)).split('\n').slice(-4).join(' | '); if (/rendered \d/.test(l) && !/opening/.test(l) && i > 8) break; }
await page.waitForTimeout(2000);
await page.getByText(/2025-08-09_raw000\.dng · 2\/3/).last().click(); await page.waitForTimeout(4000);
await readProbe(page);
const frameMenu = async (item) => { await page.getByText('Frame', { exact: true }).first().click(); await page.waitForTimeout(250); await page.getByText(item, { exact: true }).click(); };
const n0 = (await rn(page))[0]; await frameMenu('Rotate Left'); console.log('settle', await settle(page, n0, 20));
await page.waitForTimeout(12000); // let refine passes finish
await shot(page, '61-scan-frame-2-rotated-left');
console.log('status', (await bodyText(page)).split('\n').slice(-2).join(' | '));
console.log('hist', (await bodyText(page)).split('\n').filter(l => /Orient|→/.test(l)).join(' | '));
console.log('ui', JSON.stringify((await readProbe(page)).ui.filter(u => u.kind !== 'menu')));
// full-width loupe? fit view only
await ctx.close();
