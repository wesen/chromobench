import { launch, goto, shot, bodyText, readProbe, PHOTOS, openFile, uptime, meanRGB, MAIN, rn, settle, luma, panelVals } from './lib.mjs';
const { ctx, page } = await launch(false, 'fresh');
await goto(page);
await openFile(page, PHOTOS + '/DSC_8559.NEF');
await page.waitForTimeout(2500);
await readProbe(page);
const apText = () => page.evaluate(() => { const r = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Aperture up'); return r?.parentElement?.innerText.replace(/\s+/g, ' '); });
const hist = () => page.evaluate(() => { const el = [...document.querySelectorAll('*')].find(e => e.children.length > 0 && /^History/.test(e.innerText||'') && e.innerText.length < 800 && e.offsetHeight < 400); return el?.innerText.replace(/\n+/g, ' | '); });
const editMenu = async () => { await page.getByText('Edit', { exact: true }).first().click(); await page.waitForTimeout(250); const t = await page.evaluate(() => [...document.querySelectorAll('[role=menuitem]')].map(e => e.innerText.replace(/\s+/g, ' ')).filter(x => /Undo|Redo/.test(x)).join(' || ')); await page.keyboard.press('Escape'); await page.mouse.click(700, 760); return t; };
const rows = [];
const measure = async (label, t) => { const m = await meanRGB(page, MAIN); const v = await panelVals(page); console.log(label.padEnd(24), 'RGB', JSON.stringify(m), 'luma', luma(m), 'B/R', (m[2]/m[0]).toFixed(3), 'G/avgRB', (m[1]/((m[0]+m[2])/2)).toFixed(3), 'settle', t, 'Time', v.Time, 'ap', await apText(), 'filt', v['Filtration C'], v['Filtration M'], v['Filtration Y'], 'lights', v['Printer lights R'], v['Printer lights G'], v['Printer lights B']); };
const time = page.getByLabel('Time value');
const n00 = (await rn(page))[0]; await time.click(); await time.press('Control+a'); await time.type('10'); await time.press('Enter'); await settle(page, n00);
console.log('uptime', uptime());
await measure('base 10 s', 0);
console.log('ui hist', await hist());
console.log('edit menu', await editMenu());
for (const b of ['Lighter', 'Lighter', 'Darker', 'Darker', 'Darker']) {
  const n0 = (await rn(page))[0]; await page.getByRole('button', { name: b }).click(); const t = await settle(page, n0, 20); await measure(b, t);
}
await shot(page, '08-after-lighter-darker');
// back to 10 via typed
{ const n0 = (await rn(page))[0]; await time.click(); await time.press('Control+a'); await time.type('10'); await time.press('Enter'); await settle(page, n0); }
await measure('time 10 again', 0);
// filtration
const setF = async (ch, v) => { const b = page.getByLabel(`Filtration ${ch} value`); const n0 = (await rn(page))[0]; await b.click(); await b.press('Control+a'); await b.type(v); await b.press('Enter'); const t = await settle(page, n0, 20); await measure(`filt ${ch}=${v}`, t); };
await setF('Y', '20'); await setF('Y', '0'); await setF('M', '20'); await setF('M', '0');
await setF('Y', '40');
await shot(page, '09-yellow-40');
await setF('Y', '0'); await setF('C', '20'); await setF('C', '0');
// aperture steps text
for (let i = 0; i < 3; i++) { const n0 = (await rn(page))[0]; await page.getByLabel('Aperture up').click(); await settle(page, n0, 15); console.log('ap up ->', await apText()); }
for (let i = 0; i < 3; i++) { const n0 = (await rn(page))[0]; await page.getByLabel('Aperture down').click(); await settle(page, n0, 15); }
console.log('ui hist', await hist());
console.log('edit menu', await editMenu());
// undo x all
const logU = [];
for (let i = 0; i < 6; i++) { const lbl = await editMenu(); const n0 = (await rn(page))[0]; await page.keyboard.press('Control+z'); await page.waitForTimeout(1500); logU.push(lbl); console.log('undo', i, lbl); }
console.log('ui log', JSON.stringify((await readProbe(page)).ui.slice(-12)));
await shot(page, '10-after-undo');
await ctx.close();
