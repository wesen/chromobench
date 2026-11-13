// Orchestrator check (session 04, S04-N2): a photo's first print in the app (preview at :4650, ?fresh in-memory
// store, CPU engine): automatic Time, mean display RGB over a 40 × 40 grid of the print, B/R. Private NEFs read in
// place; numbers only. Usage: node orch-03-photo-first-print-colour.mjs [label]
import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
const dir = `${process.env.HOME}/Downloads/2026-11-11 - manfred test bilder`;
const browser = await chromium.launch({ headless: true });
for (const n of ['DSC_8559', 'DSC_8541', 'DSC_8536', 'DSC_8655']) {
  const f = `${dir}/${n}.NEF`;
  if (!existsSync(f)) { console.log('absent', n); continue; }
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('http://localhost:4650/?fresh&nosw');
  await page.waitForFunction(() => !!window.chromobench?.idle, null, { timeout: 120000 });
  await page.setInputFiles('#file', f);
  await page.waitForFunction(() => /opened|rendered/.test(document.body.innerText), null, { timeout: 180000 });
  await page.evaluate(() => window.chromobench.idle());
  const r = await page.evaluate(() => {
    const s = window.chromobench.size();
    const m = [0, 0, 0]; let k = 0;
    for (let i = 1; i < 40; i++) for (let j = 1; j < 40; j++) {
      const v = window.chromobench.pixel(Math.floor((s.width * i) / 40), Math.floor((s.height * j) / 40));
      if (v) { m[0] += v[0]; m[1] += v[1]; m[2] += v[2]; k++; }
    }
    const t = document.querySelector('.cb-arg[data-path="print.enlarger.time_s"] input')?.value ?? '?';
    return { rgb: m.map((x) => x / k), time: t };
  });
  const [R, G, B] = r.rgb;
  console.log(`${process.argv[2] ?? ''} ${n}: time ${r.time}, mean RGB ${R.toFixed(3)} ${G.toFixed(3)} ${B.toFixed(3)}, B/R ${(B / R).toFixed(2)}`);
  await page.close();
}
await browser.close();
