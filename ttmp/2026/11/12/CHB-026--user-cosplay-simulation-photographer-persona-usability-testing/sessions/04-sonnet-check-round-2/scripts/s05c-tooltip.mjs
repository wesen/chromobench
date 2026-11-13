import { launch, goto, ROOT, openFile, bodyText } from './lib.mjs';
const { ctx, page } = await launch(false, 'fresh'); await goto(page);
await openFile(page, ROOT + '/.playwright-mcp/scans/2025-08-09_raw013.dng'); await page.waitForTimeout(3000);
console.log('titles:', await page.evaluate(() => [...document.querySelectorAll('[title],[aria-label]')].map(e => e.title || e.getAttribute('aria-label')).filter(t => /mask|edge|orange|negative/i.test(t)).join(' ## ')));
console.log('tech lines:', (await bodyText(page)).split('\n').filter(l => /Technical|E_EVAL|W_NO|scan\.flare/.test(l)).join(' | '));
await ctx.close();
