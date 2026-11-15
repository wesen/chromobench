// CHB-034: GPU time of the preview display chain per table lookup mode (hw = hardware trilinear filter,
// trilinear = manual, tetra = manual tetrahedral), through the parity page's 'chain:lookup-bench' scenario.
// Needs the parity page served on localhost (a secure context):
//   pnpm --filter @chromobench/gpu exec vite --config parity-page/vite.config.ts --port 4185 --strictPort &
//   node 05-lookup-bench.mjs [--base http://localhost:4185] [--sizes 4000x2674,2000x1337] [--rounds 15] [--swiftshader]
// Without --swiftshader the browser gets the machine's own adapter (Metal on the Mac).
import { chromium } from '@playwright/test';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const base = arg('base', 'http://localhost:4185');
const sizes = arg('sizes', '4000x2674,2000x1337').split(',').map((s) => s.split('x').map(Number));
const rounds = Number(arg('rounds', '15'));
const args = process.argv.includes('--swiftshader') ? ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan'] : [];

const browser = await chromium.launch({ channel: 'chromium', args });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.goto(`${base}/parity-page/index.html`);
  await page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: 120_000 });
  for (const [w, h] of sizes) {
    const r = await page.evaluate(([w, h, rounds]) => window.parity.run('chain:lookup-bench', { w, h, rounds }), [w, h, rounds]);
    console.log(JSON.stringify(r));
  }
} finally {
  await browser.close();
}
