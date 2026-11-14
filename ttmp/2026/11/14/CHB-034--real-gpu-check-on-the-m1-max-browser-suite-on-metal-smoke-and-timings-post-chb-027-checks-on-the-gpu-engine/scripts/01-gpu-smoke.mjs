// CHB-034: CHB-027's mac-01 run on the Mac itself (no tunnel): launches the installed Chrome, headed.
// Usage: node 01-gpu-smoke.mjs [url]   (default http://localhost:4811/?engine=gpu&fresh)
import { chromium } from '@playwright/test';
const url = process.argv[2] ?? 'http://localhost:4811/?engine=gpu&fresh';
const browser = await chromium.launch({ channel: 'chrome', headless: false });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
try {
  await page.goto(url);
  const gpu = await page.evaluate(async () => {
    if (!navigator.gpu) return { gpu: false, secure: isSecureContext };
    const a = await navigator.gpu.requestAdapter();
    const i = a?.info ?? {};
    return { gpu: !!a, secure: isSecureContext, vendor: i.vendor, architecture: i.architecture, description: i.description, fallback: a?.isFallbackAdapter };
  });
  await page.waitForFunction(() => window.chromobench?.engineLabel, null, { timeout: 30000 }).catch(() => {});
  const engine = await page.evaluate(() => window.chromobench?.engineLabel ?? null);
  console.log(JSON.stringify({ url, gpu, engine }, null, 1));
} finally {
  await page.close();
  await browser.close();
}
