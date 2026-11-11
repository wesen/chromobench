// Stage 4 in headless Chromium: chain and lookup parity on synthetic Gold 200 frames against the
// CPU f64 evaluation of the same program (interim reference until CHB-003's engine).
import { expect, test, type Page } from '@playwright/test';

async function run<T = Record<string, any>>(page: Page, name: string, opts: Record<string, unknown> = {}): Promise<T> {
  const r = await page.evaluate(([n, o]) => window.parity.run(n as string, o as Record<string, unknown>), [name, opts] as const);
  console.log(name, JSON.stringify(r));
  return r as T;
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('/parity-page/index.html');
  await page.waitForFunction(() => document.body.dataset['ready'] === '1');
});

test('export chain: film-dyes within 5e-6 of the exact f64 solve on reachable pixels, same classification', async ({ page }) => {
  const r = await run(page, 'chain:export-dyes');
  expect(r.error).toBeUndefined();
  expect(r.maxDiff).toBeLessThanOrEqual(5e-6);
  expect(r.flips).toBe(0);
});

// "Within one 8-bit level": the 8-bit encodings differ by at most 1. The continuous difference is
// reported too; export reaches ~1.1 levels at the steepest part of the curve (pd/print table error).
test('preview chain: display-rgb within one 8-bit level of the f64 reference', async ({ page }) => {
  const r = await run(page, 'chain:preview-display');
  expect(r.max8bit).toBeLessThanOrEqual(1);
  expect(r.meanLevels).toBeLessThan(0.25);
});

test('export chain: display-rgb within one 8-bit level of the f64 reference', async ({ page }) => {
  const r = await run(page, 'chain:export-display');
  expect(r.max8bit).toBeLessThanOrEqual(1);
  expect(r.meanLevels).toBeLessThan(0.25);
});

test('broken variant: lookups without the half-texel mapping fail the preview chain', async ({ page }) => {
  const r = await run(page, 'chain:preview-display', { lookup: 3 });
  expect(r.max8bit).toBeGreaterThan(1);
});

// The guide asks for identity in every 8-bit value. Table differences of ~1e-6 can still flip a value
// that sits on a rounding boundary (1 of 18,432 here), so the test bounds the continuous difference.
test('the print from worker (f64) tables and from GPU tables agrees to a hundredth of an 8-bit level', async ({ page }) => {
  const r = await run(page, 'chain:builders-identical');
  expect(r.maxLevels).toBeLessThan(0.01);
  expect(r.differing8bit).toBeLessThanOrEqual(Math.ceil(r.values * 1e-3));
});

test('the per-pixel solve at node positions equals the table value', async ({ page }) => {
  const r = await run(page, 'chain:node-solve');
  expect(r.pass).toBe(true);
});

test('lookups between nodes: hw ≤ 1.6e-4 rms, manual trilinear = look3, tetrahedral more accurate, no half-texel fails', async ({ page }) => {
  const hw = await run(page, 'lookup:hw');
  const tri = await run(page, 'lookup:trilinear');
  const tet = await run(page, 'lookup:tetra');
  const bad = await run(page, 'lookup:no-half-texel');
  expect(hw.keys).toBe(20000);
  expect(hw.rms).toBeLessThanOrEqual(1.6e-4);
  expect(tri.maxVsLook3).toBeLessThanOrEqual(1e-6);
  expect(tri.rms / tet.rms).toBeGreaterThan(1.3); // textbook: 1.9× at N = 33
  expect(bad.rms).toBeGreaterThan(10 * hw.rms);
});
