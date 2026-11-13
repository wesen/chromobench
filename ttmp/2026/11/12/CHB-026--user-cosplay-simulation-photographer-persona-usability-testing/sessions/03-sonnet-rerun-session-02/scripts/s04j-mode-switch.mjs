import { launch, goto, shot, bodyText, readProbe, PHOTOS, meanRGB, luma, rn, settle, panelVals, MAIN } from './lib.mjs';
const { ctx, page } = await launch(false, 'fresh');
await goto(page);
await page.setInputFiles('#file', PHOTOS + '/DSC_8541.NEF'); await page.waitForTimeout(12000);
const sel = page.getByLabel('Enlarger mode');
const state = async (l) => { const m = await meanRGB(page, MAIN); console.log(l, 'mode', await sel.inputValue(), JSON.stringify(await panelVals(page)), 'RGB', JSON.stringify(m), 'luma', luma(m)); };
await readProbe(page);
await state('start');
for (const v of ['real', 'normalised', 'real']) {
  const n0 = (await rn(page))[0]; await sel.selectOption(v); await settle(page, n0, 20); await state('after ' + v);
  console.log(' ui', JSON.stringify((await readProbe(page)).ui.filter(u => u.kind !== 'menu')));
  if (v === 'real') await shot(page, '21-mode-real-' + (n0 % 7));
}
const t = (await bodyText(page)).split('\n'); console.log('hist', t.filter(l => /→|mode/i.test(l)).slice(-4).join(' | '));
await ctx.close();
