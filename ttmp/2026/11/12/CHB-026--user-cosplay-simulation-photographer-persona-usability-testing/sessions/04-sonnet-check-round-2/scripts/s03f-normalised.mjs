import { launch, goto, shot, bodyText, readProbe, PHOTOS, openFile, meanRGB, luma, rn, settle, panelVals } from './lib.mjs';
const { ctx, page } = await launch(false, 'fresh'); await goto(page);
await openFile(page, PHOTOS + '/DSC_8559.NEF'); await page.waitForTimeout(3000); await readProbe(page);
console.log('mode options:', await page.evaluate(() => [...document.querySelectorAll('select[aria-label="Enlarger mode"] option')].map(o => o.value + ':' + o.text).join(' ; ')));
const clip = { x: 250, y: 100, width: 880, height: 600 };
const lay = async (name) => { await page.getByText('View', { exact: true }).first().click(); await page.getByText('Layout…', { exact: true }).click(); await page.waitForTimeout(500); await page.getByRole('dialog').getByRole('button', { name, exact: true }).click(); await page.waitForTimeout(3000); if (await page.getByRole('dialog').count()) await page.keyboard.press('Escape'); await page.waitForTimeout(1000); };
const rows = async (tag) => {
  await lay('Simple'); await page.getByText('② Print', { exact: true }).click(); await page.waitForTimeout(4000);
  const b = (await bodyText(page)).split('\n').filter(l => !/not open/.test(l)); const i = b.indexOf('Fit · ' + (b.find(l => /^Fit/.test(l)) || '').slice(6));
  console.log(tag, 'rows:', b.slice(b.findIndex(l => /^Fit/.test(l))).join(' | ').slice(0, 500));
  await shot(page, '48-simple-' + tag);
  const m0 = await meanRGB(page, clip, '_m'); console.log(tag, 'base luma', luma(m0), 'B/R', (m0[2] / m0[0]).toFixed(3));
  for (const btn of ['Lighter', 'Warmer', 'More magenta', 'Harder']) {
    const el = page.getByRole('button', { name: new RegExp(btn) }).first(); if (!(await el.count())) { console.log(' no button', btn); continue; }
    const before = await meanRGB(page, clip, '_m'); const n0 = (await rn(page))[0]; await el.click(); const s = await settle(page, n0, 30);
    const after = await meanRGB(page, clip, '_m');
    console.log(' ', btn, 'settle', s, 'luma', luma(before), '->', luma(after), 'B/R', (before[2] / before[0]).toFixed(3), '->', (after[2] / after[0]).toFixed(3), 'G/(R+B)/2', (before[1]/((before[0]+before[2])/2)).toFixed(3), '->', (after[1]/((after[0]+after[2])/2)).toFixed(3));
  }
  console.log(tag, 'history', (await bodyText(page)).split('\n').filter(l => /→|Lighter|Warm|Tint|lights/.test(l)).slice(0, 6).join(' | '));
};
await lay('Classic'); await page.waitForTimeout(3000); await shot(page, '49a-classic-back');
console.log('selects:', await page.evaluate(() => [...document.querySelectorAll('select')].map(e => e.getAttribute('aria-label')+':'+e.offsetParent).join(' ; '))); await page.locator('select[aria-label="Enlarger mode"]').selectOption({ index: 1 }, { timeout: 8000 }); await page.waitForTimeout(4000);
console.log('mode now', await page.evaluate(() => document.querySelector('select[aria-label="Enlarger mode"]')?.value));
await shot(page, '49-classic-normalised'); console.log('classic normalised vals', JSON.stringify(await panelVals(page)));
await rows('normalised');
console.log('ui', JSON.stringify((await readProbe(page)).ui.filter(u => u.kind !== 'menu')));
await ctx.close();
