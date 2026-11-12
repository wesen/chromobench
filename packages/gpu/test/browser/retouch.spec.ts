// CHB-022 in headless Chromium: retouch.heal on the GPU (kernels/retouch.wgsl) against core's f64 retouch().
import { expect, test, type Page } from '@playwright/test';

async function run<T = Record<string, any>>(page: Page, name: string, opts: Record<string, unknown> = {}): Promise<T> {
  const r = await page.evaluate(([n, o]) => window.parity.run(n as string, o as Record<string, unknown>), [name, opts] as const);
  console.log(name, JSON.stringify(opts), JSON.stringify(r));
  return r as T;
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('/parity-page/index.html');
  await page.waitForFunction(() => document.body.dataset['ready'] === '1');
});

test('retouch.heal: GPU within f32 of core on a pattern and on a print; tiles equal one pass; half scale samples the same pixels', async ({ page }) => {
  const r = await run(page, 'retouch:parity');
  expect(r.error).toBeUndefined();
  expect(r.changed).toBeGreaterThan(300);
  expect(r.pattern.maxRel).toBeLessThan(1e-4);
  expect(r.print.maxRel).toBeLessThan(1e-4);
  expect(r.tileDiff).toBe(0);
  expect(r.half.maxRel).toBeLessThan(1e-4);
});

test('broken variant: a source one pixel off fails the parity', async ({ page }) => {
  const r = await run(page, 'retouch:parity', { broken: true });
  expect(r.pattern.maxAbs).toBeGreaterThan(0.01);
});
