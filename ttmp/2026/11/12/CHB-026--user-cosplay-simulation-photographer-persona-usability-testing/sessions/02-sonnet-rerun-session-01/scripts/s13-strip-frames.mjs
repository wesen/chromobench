import { launch, goto, shot, bodyText, readProbe, PHOTOS, waitRendered } from './lib.mjs';
const { ctx, page } = await launch(false);
await goto(page);
const st = async () => (await bodyText(page)).split('\n').slice(-6).join(' | ');
console.log('RELAUNCH:', await st());
await shot(page, '21-relaunch-with-strip');
await page.setInputFiles('#file', PHOTOS + '/raw010.dng');
await page.waitForTimeout(8000);
console.log('RELINK:', await st());
console.log('FRAMES', await page.evaluate(() => window.chromobench?.studio?.frames?.all?.().length));
const thumbs = page.getByText(/raw010.dng · \d\/3/);
console.log('thumb count', await thumbs.count());
for (const i of [1, 2]) {
  await page.getByText(`raw010.dng · ${i+1}/3`).last().click(); await page.waitForTimeout(3500);
  await shot(page, `22-strip-frame-${i+1}`);
  console.log('frame', i+1, await page.getByLabel('Time value').inputValue(), await st());
}
// edit time on frame 3, switch to 1, undo
await readProbe(page);
const box = page.getByLabel('Time value');
await box.click(); await box.press('Control+a'); await box.type('3'); await box.press('Enter'); await page.waitForTimeout(2500);
await page.getByText('raw010.dng · 1/3').last().click(); await page.waitForTimeout(2500);
await page.mouse.click(700, 760);
await page.keyboard.press('Control+z'); await page.waitForTimeout(2000);
const p = await readProbe(page); console.log('UNDO on frame 1 ->', JSON.stringify(p.ui.map(u=>u.text??u.kind)));
await page.getByText('Edit', { exact: true }).first().click(); await page.waitForTimeout(300);
console.log('EDIT', await page.evaluate(() => [...document.querySelectorAll('[role=menuitem]')].map(e=>e.innerText.replace(/\s+/g,' ')).slice(0,4).join(' || ')));
await shot(page, '23-undo-menu-other-frame');
await ctx.close();
