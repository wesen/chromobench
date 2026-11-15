// CHB-037 P3: GPU time of a representative print (src/parity/bench-tests.ts), only with BENCH=1 (a timing, not a
// check): BENCH=1 REAL_GPU=1 for the Mac's own GPU.
import { test } from '@playwright/test';

test('bench: a plain and a darkroom print at 4000 × 2674, preview and export', async ({ page }) => {
  test.skip(!process.env['BENCH'], 'timing only: set BENCH=1');
  test.setTimeout(900_000);
  await page.goto('/parity-page/index.html');
  await page.waitForFunction(() => document.body.dataset['ready'] === '1');
  const r = await page.evaluate(() => window.parity.run('bench:print', {}));
  console.log('bench:print', JSON.stringify(r));
});
