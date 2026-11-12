// WS-C: drive the built studio the way the photographer did in session 01 and record what it says.
// Usage: node wsc-03-check.mjs <port> <shots dir> [photo file]
// Opens two synthetic negatives (the M1 fixture and a copy with one byte changed); with a photo file given (a
// private NEF, local only), opens that as a photo first. Prints the UI log and saves screenshots.
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const port = process.argv[2] ?? '4911';
const shots = process.argv[3] ?? '.';
const photo = process.argv[4];
mkdirSync(shots, { recursive: true });
const fixture = resolve(import.meta.dirname, '../../../../../../fixtures/synthetic/m1-negative-96x64.tif');
const a = readFileSync(fixture);
const b = Buffer.from(a);
b[b.length - 1] ^= 1;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`http://localhost:${port}/?nosw&fresh`);
await page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: 60_000 });
const log = () => page.evaluate(() => (window.chromobench?.rt?.chrome?.log ?? []).map((e) => `${e.kind}:${e.text ?? ''}${e.detail ? ` [${e.detail}]` : ''}`));
let seen = 0;
async function step(name, f, shot) {
  try {
    await f();
  } catch (e) {
    console.log(`  ${name}: FAILED ${String(e.message).split('\n')[0]}`);
  }
  await page.waitForTimeout(250);
  if (shot) await page.screenshot({ path: `${shots}/${shot}.png` });
  const l = await log();
  console.log(`${name}: ${JSON.stringify(l.slice(seen))}`);
  seen = l.length;
}
const rendered = () => page.waitForFunction(() => /rendered/.test(document.getElementById('status')?.textContent ?? ''), null, { timeout: 180_000 });
const committedTime = () => page.evaluate(() => window.chromobench.log?.committed.print.enlarger.time_s);

if (photo) {
  await step('open photo', async () => {
    if (await page.locator('#photo').count()) await page.locator('#photo').check();
    await page.setInputFiles('#file', photo);
    await rendered();
    await page.evaluate(() => window.chromobench.idle());
  }, '01-photo-opened');
  if (await page.locator('#photo').count()) await page.locator('#photo').uncheck();
}
await step('open negatives', async () => {
  await page.setInputFiles('#file', [{ name: 'neg-a.tif', mimeType: 'image/tiff', buffer: a }, { name: 'neg-b.tif', mimeType: 'image/tiff', buffer: b }]);
  await page.waitForFunction(() => /opened 2 files|rendered/.test(document.getElementById('status')?.textContent ?? ''), null, { timeout: 180_000 });
  await page.evaluate(() => window.chromobench.idle());
});
console.log('engine:', await page.locator('#engine').textContent(), '| title:', await page.locator('#engine').getAttribute('title'));
console.log('notes:', await page.locator('#notes').textContent(), '| title:', await page.locator('#notes').getAttribute('title'));
const time = page.locator('.cb-arg[data-path="print.enlarger.time_s"]').first();
const field = time.locator('.cb-num');
const range = time.locator('input[type=range]');
console.log('time field title:', await field.getAttribute('title'), '| placeholder:', await field.getAttribute('placeholder'));
console.log('time:', await committedTime(), 's; slider range', await range.getAttribute('min'), '→', await range.getAttribute('max'), '(log2 s)');
const paper = page.locator('.cb-arg[data-path="print.paper"]').first();
console.log('paper readout:', JSON.stringify(await paper.locator('.cb-arg-v').textContent()), '| selected:', await paper.locator('select').evaluate((s) => s.selectedOptions[0]?.text));
console.log('time label tip:', await time.locator('.cb-arg-l').getAttribute('title'));
await paper.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${shots}/02-status-and-paper.png` });

for (const [v, shot] of [['15'], ['0', '03-time-0-clamped'], ['1000'], ['-5', '04-time-minus-5'], ['7,5'], ['abc', '05-time-abc']]) {
  await step(`type ${JSON.stringify(v)} + Enter`, async () => {
    await field.fill(v);
    await field.press('Enter');
  }, shot);
  console.log(`  → time ${await committedTime()} s, box ${JSON.stringify(await field.inputValue())}, red ${await field.evaluate((x) => x.classList.contains('is-bad'))}`);
}
await step('switch to the other frame while the bad entry is in the box', async () => {
  await page.locator('.ck-side-bottom .ck-thumb').nth(1).click();
  await page.evaluate(() => window.chromobench.idle());
}, '06-after-frame-switch');
console.log(`  → box ${JSON.stringify(await field.inputValue())}, red ${await field.evaluate((x) => x.classList.contains('is-bad'))}`);

await step('Escape resets a bad entry', async () => {
  await field.fill('xyz');
  await field.press('Enter');
  await field.press('Escape');
});
console.log(`  → box ${JSON.stringify(await field.inputValue())}, red ${await field.evaluate((x) => x.classList.contains('is-bad'))}`);

await step('drag the Time slider', async () => {
  const box = await range.boundingBox();
  const thumbX = await range.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.left + ((Number(el.value) - Number(el.min)) / (Number(el.max) - Number(el.min))) * r.width;
  });
  await page.mouse.move(thumbX, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(thumbX + i * 2, box.y + box.height / 2);
  await page.mouse.up();
  await page.evaluate(() => window.chromobench.idle());
});
console.log(`  → time ${await committedTime()} s`);

await step('Edit menu after selecting the first frame', async () => {
  await page.locator('.ck-side-bottom .ck-thumb').nth(0).click();
  await page.locator('.ck-menubar-t', { hasText: 'Edit' }).dispatchEvent('pointerdown');
}, '07-edit-menu-other-frame');
console.log('  edit menu:', JSON.stringify(await page.locator('.ck-menu .ck-menu-l').allTextContents()));
await page.keyboard.press('Escape');
await browser.close();
