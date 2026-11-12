// One measured session on the real GPU (M1 Max, Metal) against a studio build served here and tunnelled to the
// Mac's localhost (see mac-README.md). Opens a NEF as a photo, then drags the Time slider with 20 real mouse moves,
// and reports time to result and main-thread stalls (rAF gaps > 100 ms), as CHB-026's probe measures them.
// Usage: node mac-02-open-and-drag.mjs <url> <file> [--photo-checkbox] [--local]
//   --photo-checkbox: tick #photo before opening (builds before CHB-027 WS-A, which guess the mode themselves)
//   --local: run in this machine's headless Chromium (SwiftShader) instead, for comparison
import { chromium } from '@playwright/test';
const [url, file] = process.argv.slice(2);
const flag = (f) => process.argv.includes(f);
const browser = flag('--local')
  ? await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  : await chromium.connect('ws://127.0.0.1:9333/', { headers: { 'x-playwright-launch-options': JSON.stringify({ channel: 'chrome', headless: false }) } });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const probe = () => {
  const P = (window.__probe = { t0: performance.now(), stalls: [] });
  let last = performance.now();
  const tick = (t) => { const d = t - last; if (d > 100) P.stalls.push([Math.round(last - P.t0), Math.round(d)]); last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
};
const rendered = () => page.evaluate(() => +(document.body.innerText.match(/rendered (\d+)/) ?? [0, 0])[1]);
const settle = async (since, quietMs = 2500, limitMs = 120000) => {
  // the result is in when the render counter has moved and then stayed still for quietMs
  const t0 = Date.now(); let last = await rendered(), lastChange = Date.now(), moved = last !== since;
  while (Date.now() - t0 < limitMs) {
    await page.waitForTimeout(200);
    const r = await rendered();
    if (r !== last) { last = r; lastChange = Date.now(); moved = true; }
    if (moved && Date.now() - lastChange > quietMs) return lastChange - t0;
  }
  return null;
};
const out = { url, file, where: flag('--local') ? 'local SwiftShader' : 'M1 Max Chrome (Metal)' };
try {
  await page.goto(url);
  await page.waitForFunction(() => window.chromobench?.engineLabel, null, { timeout: 60000 });
  out.engine = await page.evaluate(() => window.chromobench.engineLabel);
  if (flag('--photo-checkbox')) await page.locator('#photo').check();
  await page.evaluate(probe);
  let r0 = await rendered(); let t = Date.now();
  await page.setInputFiles('#file', file);
  out.open = { resultMs: await settle(r0), stalls: await page.evaluate(() => window.__probe.stalls) };
  out.open.wallMs = Date.now() - t;
  await page.evaluate(probe);
  const s = page.locator('input[aria-label="Time"]'); const b = await s.boundingBox();
  const y = b.y + b.height / 2, x0 = b.x + b.width * 0.5;
  r0 = await rendered(); t = Date.now();
  await page.mouse.move(x0, y); await page.mouse.down();
  for (let i = 1; i <= 20; i++) { await page.mouse.move(x0 + i * 2, y); await page.waitForTimeout(30); }
  await page.mouse.up();
  const dragWallMs = Date.now() - t;
  out.drag = { dragWallMs, resultMs: await settle(r0), renders: (await rendered()) - r0, stalls: await page.evaluate(() => window.__probe.stalls) };
  out.drag.worstStallMs = Math.max(0, ...out.drag.stalls.map((x) => x[1]));
  out.open.worstStallMs = Math.max(0, ...out.open.stalls.map((x) => x[1]));
} finally {
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
}
