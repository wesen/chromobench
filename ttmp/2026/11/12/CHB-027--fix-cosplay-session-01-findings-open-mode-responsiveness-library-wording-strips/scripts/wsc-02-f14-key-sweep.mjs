// WS-C, F14: press every key, alone and with modifiers, with the focus in different places, and list the presses
// that make the shell open a dialog (the "Commands" palette or any other). Usage: node wsc-02-f14-key-sweep.mjs <port>
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';

const port = process.argv[2] ?? '4911';
const file = resolve(import.meta.dirname, '../../../../../../fixtures/synthetic/m1-negative-96x64.tif');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
async function fresh() {
  await page.goto(`http://localhost:${port}/?nosw&fresh`);
  await page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: 60_000 });
  await page.setInputFiles('#file', file);
  await page.waitForFunction(() => /rendered/.test(document.getElementById('status')?.textContent ?? ''), null, { timeout: 120_000 });
}
const keys = [...'abcdefghijklmnopqrstuvwxyz0123456789', '/', '?', ',', '.', '-', '=', '[', ']', ';', "'", '\\', '`', 'Enter', 'Space', 'Tab', 'F1', 'F2', 'F3', 'F4', 'F9', 'F10', 'F11', 'F12', 'Delete', 'Backspace'];
const mods = ['', 'Control+', 'Shift+', 'Alt+', 'Control+Shift+', 'Control+Alt+'];
// the body last: its single-letter keys switch modules and hide panels
const places = {
  timeField: async () => page.getByRole('textbox', { name: 'Time value' }).first().focus({ timeout: 2000 }),
  timeSlider: async () => page.getByRole('slider', { name: 'Time' }).first().focus({ timeout: 2000 }),
  paperSelect: async () => page.getByRole('combobox', { name: 'Paper' }).first().focus({ timeout: 2000 }),
  body: async () => page.evaluate(() => (document.activeElement)?.blur?.()),
};
const count = () => page.evaluate(() => (window.chromobench.rt.chrome.log ?? []).filter((e) => e.kind === 'dialog' || e.kind === 'palette').map((e) => e.text ?? e.kind));
for (const [place, focus] of Object.entries(places)) {
  await fresh();
  const hits = [];
  let reloads = 0;
  for (const m of mods) {
    for (const k of keys) {
      if (m === 'Control+' && 'wtnq'.includes(k)) continue; // browser-level chords
      try {
        await focus();
      } catch {
        // a key moved the focus target away (another module, hidden panels): start over
        reloads++;
        await fresh();
        await focus();
      }
      const before = (await count()).length;
      await page.keyboard.press(m + k);
      const after = await count();
      if (after.length > before) {
        hits.push(`${m}${k} → ${after.slice(before).join(', ')}`);
        await page.keyboard.press('Escape');
        await page.evaluate(() => document.querySelectorAll('.ck-modal-back').forEach((x) => x.remove()));
      }
    }
  }
  console.log(`${place} (${reloads} reloads): ${hits.length ? hits.join(' | ') : 'no dialogs'}`);
}
await browser.close();
