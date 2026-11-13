import { launch, goto, shot, bodyText, readProbe, PHOTOS, meanRGB, luma, rn, settle } from './lib.mjs';
const { ctx, page } = await launch(false, 'fresh');
await goto(page);
const lay = async (name) => { await page.getByText('View', { exact: true }).first().click(); await page.getByText('Layout…', { exact: true }).click(); await page.waitForTimeout(500); await page.getByRole('button', { name, exact: true }).click(); await page.waitForTimeout(2500); };
await lay('Simple');
await page.setInputFiles('#file', PHOTOS + '/DSC_8541.NEF'); await page.waitForTimeout(12000);
await page.getByText('Print', { exact: false }).filter({ hasText: /②/ }).first().click(); await page.waitForTimeout(5000);
console.log(await page.evaluate(() => [...document.querySelectorAll('input,button,select')].filter(e => e.offsetParent).map(e => `${e.tagName}:${e.type}:${e.getAttribute('aria-label')||e.innerText||''}:${e.value||''}`).join('\n')));
await ctx.close();
