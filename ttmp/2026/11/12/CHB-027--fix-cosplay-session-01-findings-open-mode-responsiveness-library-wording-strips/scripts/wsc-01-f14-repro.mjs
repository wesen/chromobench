// WS-C, F14: replay the session-01 step-3 actions one by one and report after which one the shell's UI log
// gains a "Commands" dialog. Usage: node wsc-01-f14-repro.mjs <port> [file]
// The file defaults to the synthetic negative fixture; a private photo may be given locally (never committed).
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';

const port = process.argv[2] ?? '4911';
const file = process.argv[3] ?? resolve(import.meta.dirname, '../../../../../../fixtures/synthetic/m1-negative-96x64.tif');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`http://localhost:${port}/?nosw&fresh`);
await page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: 60_000 });
const log = () => page.evaluate(() => (window.chromobench?.rt?.chrome?.log ?? []).map((e) => `${e.kind}:${e.text ?? ''}`));
let seen = 0;
async function step(name, f) {
  try {
    await f();
  } catch (e) {
    console.log(`  ${name}: FAILED ${String(e.message).split('\n')[0]}`);
  }
  await page.waitForTimeout(300);
  const l = await log();
  console.log(`${name}: ${JSON.stringify(l.slice(seen))}`);
  seen = l.length;
}
await step('open', async () => {
  await page.setInputFiles('#file', file);
  await page.waitForFunction(() => /rendered/.test(document.getElementById('status')?.textContent ?? ''), null, { timeout: 120_000 });
});
const time = page.getByRole('textbox', { name: 'Time value' }).first();
for (const v of ['15', '0', '-5', 'abc', '1000', '12s', '7,5', '']) {
  await step(`fill ${JSON.stringify(v)}`, async () => {
    await time.fill(v);
    await time.press('Enter');
  });
}
await step('type 12 via keyboard', async () => {
  await time.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('12');
  await page.keyboard.press('Enter');
});
await step('Ctrl+Z', () => page.keyboard.press('Control+z'));
await step('Ctrl+Z on a German layout (KeyY)', () => page.evaluate(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyY', ctrlKey: true, bubbles: true }));
}));
await step('Ctrl+K in the field', async () => {
  await time.click();
  await page.keyboard.press('Control+k');
});
await step('Escape', () => page.keyboard.press('Escape'));
await browser.close();
