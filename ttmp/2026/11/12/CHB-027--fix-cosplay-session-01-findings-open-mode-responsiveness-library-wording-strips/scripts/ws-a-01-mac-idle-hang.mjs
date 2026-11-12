// CHB-027 WS-A step 6: does the GPU idle() hang (a catalog write during a GPU render) reproduce on a real GPU?
// The studio-real "gpu: first print" steps up to the Time change, N runs on the owner's M1 Max (Chrome, Metal) through
// the Playwright server (see mac-README.md; take the lock first). The page is this machine's preview on :4711.
//   node ws-a-01-mac-idle-hang.mjs [runs=10] [url=http://localhost:4711/]
import { chromium } from '@playwright/test';

const FIXTURE = new URL('../../../../../../fixtures/synthetic/m1-negative-96x64.tif', import.meta.url).pathname;
const runs = Number(process.argv[2] ?? 10);
const base = process.argv[3] ?? 'http://localhost:4711/';
const results = [];
for (let i = 0; i < runs; i++) {
  const browser = await chromium.connect('ws://127.0.0.1:9333/', { headers: { 'x-playwright-launch-options': JSON.stringify({ channel: 'chrome', headless: false }) } });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    await page.goto(`${base}?nosw&canvas2d&fresh&engine=gpu`);
    await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60000 });
    const engine = await page.locator('#engine').getAttribute('data-engine');
    await page.setInputFiles('#file', FIXTURE);
    await page.waitForFunction(() => /rendered/.test(document.getElementById('status').textContent), null, { timeout: 60000 });
    await page.evaluate(() => window.chromobench.idle());
    await page.evaluate(() => window.chromobench.log.state.print);
    await page.evaluate(() => window.chromobench.pixel(48, 32));
    await page.evaluate(() => window.chromobench.set('print.enlarger.time_s', window.chromobench.log.state.print.enlarger.time_s * 2, 'time +1 st'));
    const t0 = Date.now();
    const r = await Promise.race([page.evaluate(() => window.chromobench.idle().then(() => 'ok')), new Promise((ok) => setTimeout(() => ok('TIMEOUT'), 20000))]);
    // the pre-fix thumbnail capture writes the catalog 2 s after a change: on a fast GPU idle() is over by then, so
    // re-render without a log event (alternating views) from 1.7 s to ~4 s, idle() after each, so the write lands
    // during renders as it did on SwiftShader
    let r2 = 'ok';
    const t1 = Date.now();
    await page.waitForTimeout(1700);
    for (let k = 0; k < 40 && r2 === 'ok' && Date.now() - t1 < 4500; k++) {
      await page.evaluate((k) => window.chromobench.run('view.show', k % 2 ? 'negative' : 'print'), k);
      r2 = await Promise.race([page.evaluate(() => window.chromobench.idle().then(() => 'ok')), new Promise((ok) => setTimeout(() => ok('TIMEOUT'), 20000))]);
    }
    const thumb = r2 === 'ok' ? await page.evaluate(() => Object.values(window.chromobench.state().catalog.frames).map((f) => !!f.thumb).join(',')) : '?';
    results.push(r === 'ok' && r2 === 'ok' ? 'ok' : 'TIMEOUT');
    console.log(`run ${i + 1}: ${r} (${Date.now() - t0} ms), across the thumbnail: ${r2} (${Date.now() - t1} ms), thumb in catalog: ${thumb} · ${engine}`);
  } catch (e) {
    results.push('error');
    console.log(`run ${i + 1}: error ${String(e).slice(0, 200)}`);
  } finally {
    await browser.close().catch(() => undefined);
  }
}
console.log(`ok ${results.filter((x) => x === 'ok').length} / ${runs}`);
