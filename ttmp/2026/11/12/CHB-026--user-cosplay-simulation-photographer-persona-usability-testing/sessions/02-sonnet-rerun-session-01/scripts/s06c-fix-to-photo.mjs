import { launch, goto, shot, bodyText, readProbe, PHOTOS, waitRendered, setOpenAs, clickDialog } from './lib.mjs';
const { ctx, page } = await launch(false);
await goto(page);
await setOpenAs(page, 'Photo or Negative: Guess');
await page.setInputFiles('#file', PHOTOS + '/DSC_8559.NEF');   // Guess mode, frame was a negative in library
console.log('open (Guess)', await waitRendered(page, 'guess', 90));
await page.waitForTimeout(2500);
await shot(page, '09-after-guess-open');
console.log(JSON.stringify(await readProbe(page)));
const d = await page.evaluate(() => document.querySelector('[role=dialog],dialog,.ck-dialog')?.innerText);
console.log('DIALOG', d);
console.log((await bodyText(page)).split('\n').slice(-6).join(' | '));
await ctx.close();
