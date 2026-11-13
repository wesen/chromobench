import { launch, goto, shot, bodyText, readProbe, PHOTOS, openFile, rn, settle, panelVals, uptime } from './lib.mjs';
const { ctx, page } = await launch(false, 'fresh'); await goto(page);
console.log('uptime', uptime());
const lay = async (name) => { await page.getByText('View', { exact: true }).first().click(); await page.getByText('Layout…', { exact: true }).click(); await page.waitForTimeout(500); await page.getByRole('dialog').getByRole('button', { name: new RegExp(name) }).click(); await page.waitForTimeout(2500); if (await page.getByRole('dialog').count()) await page.keyboard.press('Escape'); await page.waitForTimeout(800); };
await lay('Classic');
await openFile(page, PHOTOS + '/DSC_8541.NEF'); await page.waitForTimeout(3000);
// sample status words continuously
await page.evaluate(() => { window.__words = new Set(); setInterval(() => { const t = document.body.innerText.split('\n').slice(-1)[0]; window.__words.add(t); }, 80); });
const click = async (name) => { await page.getByText(name, { exact: true }).first().click(); await page.waitForTimeout(350); };
const frameMenu = async (item) => { await page.getByText('Frame', { exact: true }).first().click(); await page.waitForTimeout(150); await page.getByText(item, { exact: true }).click(); await page.waitForTimeout(350); };
await shot(page, '_dbg'); console.log((await bodyText(page)).split('\n').filter(l=>!/not open/.test(l)).join(' | ').slice(0,600));
let k = 0;
for (let i = 0; i < 8; i++) { await click('Lighter'); k++; }
for (let i = 0; i < 4; i++) { await click('Darker'); k++; }
await frameMenu('Rotate Left'); k++; await frameMenu('Rotate Right'); k++; await frameMenu('Flip Left to Right'); k++;
for (let i = 0; i < 6; i++) { await page.locator('button', { hasText: /^\+$/ }).first().click(); await page.waitForTimeout(350); k++; }
for (let i = 0; i < 4; i++) { await page.locator('button', { hasText: /^−$/ }).first().click(); await page.waitForTimeout(350); k++; }
const box = page.getByLabel('Time value');
for (const v of ['7', '9,5', '12', '6']) { await box.click(); await box.press('Control+a'); await box.type(v); await box.press('Enter'); await page.waitForTimeout(500); k++; }
await frameMenu('Rotate Right'); k++; await frameMenu('Rotate Left'); k++; await frameMenu('Flip Left to Right'); k++;
for (let i = 0; i < 4; i++) { await click('Lighter'); k++; }
console.log('edits made', k);
await page.waitForTimeout(15000);
const words = await page.evaluate(() => [...window.__words]); console.log('status line words seen:', JSON.stringify(words));
await shot(page, '70-history-many');
// history rows geometry
const geo = await page.evaluate(() => {
  const h = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.trim() === 'History');
  const panel = h?.closest('.ck-panel') ?? h?.parentElement?.parentElement;
  const rows = [...(panel?.querySelectorAll('[role=option],li,.ck-row,button') ?? [])].filter(e => /You|Auto/.test(e.innerText || ''));
  const rects = rows.map(r => { const b = r.getBoundingClientRect(); return [Math.round(b.top), Math.round(b.height), r.innerText.replace(/\s+/g, ' ').slice(0, 60)]; });
  let overlaps = 0; for (let i = 1; i < rects.length; i++) if (rects[i][0] < rects[i - 1][0] + rects[i - 1][1] - 1) overlaps++;
  const sc = [...panel?.querySelectorAll('*') ?? []].find(e => e.scrollHeight > e.clientHeight + 4 && getComputedStyle(e).overflowY !== 'visible');
  return { n: rects.length, overlaps, scrollable: !!sc, scrollH: sc?.scrollHeight, clientH: sc?.clientHeight, rects };
});
console.log('history rows', geo.n, 'overlaps', geo.overlaps, 'scrollable', geo.scrollable, geo.scrollH, geo.clientH);
console.log(geo.rects.map(r => r[2]).join('\n'));
await ctx.close();
