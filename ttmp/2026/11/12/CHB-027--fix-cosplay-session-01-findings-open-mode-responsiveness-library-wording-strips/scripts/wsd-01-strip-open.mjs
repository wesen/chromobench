// CHB-027 WS-D: open a strip scan in a built studio (headless Chromium) and report what opened — frames, names,
// automatic first print per frame (time, lights), time to result and main-thread stalls (rAF gaps > 100 ms, as
// CHB-026's probe measures them) — then select each frame in the filmstrip and screenshot its print.
// The photographer's scans are private: screenshots go to <outDir> (keep it outside the repository for them).
// Usage: node wsd-01-strip-open.mjs <url> <file> <outDir> [label]
//   e.g. node …/wsd-01-strip-open.mjs 'http://127.0.0.1:5011/?nosw&fresh&engine=reference' ~/Downloads/raw010.dng /tmp/x wsd
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
const [url, file, outDir, label = 'run'] = process.argv.slice(2);
if (!existsSync(file)) {
  console.log(JSON.stringify({ skipped: `${file} absent` }));
  process.exit(0);
}
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const probe = () => {
  const P = (window.__probe = { t0: performance.now(), stalls: [] });
  let last = performance.now();
  const tick = (t) => { const d = t - last; if (d > 100) P.stalls.push([Math.round(last - P.t0), Math.round(d)]); last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
};
const rendered = () => page.evaluate(() => +(document.body.innerText.match(/rendered (\d+)/) ?? [0, 0])[1]);
const settle = async (since, quietMs = 2500, limitMs = 240000) => {
  const t0 = Date.now(); let last = await rendered(), lastChange = Date.now(), moved = last !== since;
  while (Date.now() - t0 < limitMs) {
    await page.waitForTimeout(200);
    const r = await rendered();
    if (r !== last) { last = r; lastChange = Date.now(); moved = true; }
    if (moved && Date.now() - lastChange > quietMs) return lastChange - t0;
  }
  return null;
};
const out = { label, url, file: file.split('/').pop() };
try {
  await page.goto(url);
  await page.waitForFunction(() => window.chromobench?.engineLabel, null, { timeout: 120000 });
  out.engine = await page.evaluate(() => window.chromobench.engineLabel);
  await page.evaluate(probe);
  const r0 = await rendered();
  const t = Date.now();
  await page.setInputFiles('#file', file);
  const resultMs = await settle(r0);
  await page.evaluate(() => window.chromobench.idle());
  const stalls = await page.evaluate(() => window.__probe.stalls);
  out.open = { resultMs, wallMs: Date.now() - t, stalls: stalls.length, worstStallMs: Math.max(0, ...stalls.map((s) => s[1])), totalStallMs: stalls.reduce((a, s) => a + s[1], 0) };
  out.status = await page.evaluate(() => document.querySelector('#statusbar')?.innerText.replace(/\s+/g, ' ') ?? '');
  out.frames = await page.evaluate(() => {
    const s = window.chromobench.state();
    return s.catalog.order.map((id) => {
      const r = s.recipes[id];
      return { id, name: s.catalog.frames[id].name, kind: s.catalog.frames[id].kind, crop: r?.view.frame.crop ?? null, time_s: r?.print.enlarger.time_s, lights: r?.print.lights.logH };
    });
  });
  // each frame, selected in the filmstrip as he would, its print on screen
  for (const [i, f] of out.frames.entries()) {
    const cell = page.getByText(f.name, { exact: true }).first();
    if (await cell.isVisible().catch(() => false)) await cell.click();
    else await page.evaluate((id) => window.chromobench.run('frame.select', id), f.id);
    const r1 = await rendered();
    await settle(r1, 1500, 60000);
    await page.evaluate(() => window.chromobench.idle());
    f.selected = await page.evaluate(() => window.chromobench.studio.current);
    await page.screenshot({ path: `${outDir}/${label}-frame${i + 1}.png` });
  }
  out.errors = errors;
} finally {
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
}
