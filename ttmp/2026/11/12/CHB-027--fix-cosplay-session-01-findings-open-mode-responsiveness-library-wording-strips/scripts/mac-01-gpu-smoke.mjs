// Drives the real Google Chrome on the M1 Mac (mimimi-2.local, Metal WebGPU) from this machine.
// On the Mac: a Playwright server of the SAME version as ours (1.65.0):
//   cd /tmp/chromobench-pw && npx -y playwright@1.65.0 run-server --port 9333 --host 127.0.0.1
// Here: the tunnels (the server to us; our studio preview ports to the Mac's localhost, a secure context):
//   ssh -N -L 9333:127.0.0.1:9333 -R 4600:127.0.0.1:4600 -R 4711:127.0.0.1:4711 -R 4811:127.0.0.1:4811 mimimi-2.local
// (Raw CDP to Chrome 157 fails with Playwright 1.65: "Browser context management is not supported".)
// Usage: node mac-01-gpu-smoke.mjs [url]   (default http://localhost:4600/?engine=gpu&fresh)
import { chromium } from '@playwright/test';
const url = process.argv[2] ?? 'http://localhost:4600/?engine=gpu&fresh';
export const connectMac = () => chromium.connect('ws://127.0.0.1:9333/', {
  headers: { 'x-playwright-launch-options': JSON.stringify({ channel: 'chrome', headless: false }) },
});
const browser = await connectMac();
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
