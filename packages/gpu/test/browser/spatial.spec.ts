// Stage 5 and the engine in headless Chromium: blur, halation, tiles and global fields, grain, SAT
// probe, GpuEngine taps and CHB-002's conformance suite.
import { expect, test, type Page } from '@playwright/test';

async function run<T = Record<string, any>>(page: Page, name: string, opts: Record<string, unknown> = {}): Promise<T> {
  const r = await page.evaluate(([n, o]) => window.parity.run(n as string, o as Record<string, unknown>), [name, opts] as const);
  console.log(name, JSON.stringify(r).slice(0, 2000));
  return r as T;
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('/parity-page/index.html');
  await page.waitForFunction(() => document.body.dataset['ready'] === '1');
});

test('separable blur matches direct 2-D f64 convolution within one level; flat stays flat; 1.5σ truncation fails', async ({ page }) => {
  const r = await run(page, 'blur:vs-direct');
  expect(r.maxLevels).toBeLessThanOrEqual(1);
  expect(r.flatDev).toBeLessThanOrEqual(1e-6);
  const bad = await run(page, 'blur:vs-direct', { k: 1.5 });
  expect(bad.maxLevels).toBeGreaterThan(1);
});

test('halation: exposure conserved by the 1 + a normalisation (the Studio form is not); log10(K∗E) ≥ K∗log10 E', async ({ page }) => {
  const r = await run(page, 'halation');
  expect(Math.abs(r.meanRelGood)).toBeLessThanOrEqual(1e-6);
  expect(r.meanRelStudio).toBeGreaterThan(0.2);
  expect(r.lawMinGap).toBeGreaterThanOrEqual(-1e-6);
  expect(r.uniformGap).toBeLessThanOrEqual(1e-6);
  expect(r.lawMaxGap).toBeGreaterThan(0.01); // blurring log exposure is measurably different
});

test('tiles: 8-px halo matches one pass; no halo fails at the seams', async ({ page }) => {
  const r = await run(page, 'tiles:halo8');
  expect(r.meanLevels).toBeLessThanOrEqual(0.001);
  expect(r.maxLevels).toBeLessThanOrEqual(1);
  const bad = await run(page, 'tiles:no-halo');
  expect(bad.maxLevels).toBeGreaterThan(1);
});

test('tiles: a wide kernel per tile fails; read from the global field it passes', async ({ page }) => {
  const bad = await run(page, 'tiles:wide-per-tile');
  expect(bad.maxLevels).toBeGreaterThan(1);
  const good = await run(page, 'tiles:wide-global-field');
  expect(good.tileVsOnePassLevels).toBe(0);
  // field vs full-resolution blur on worst-case content (6-px full-contrast blocks, s = 8): the
  // σ/s ≥ 2 rule leaves ≈2 levels of aliasing; at s = 4 it is within one level
  expect(good.interiorMaxLevels).toBeLessThanOrEqual(2.5);
  expect(good.interiorMeanLevels).toBeLessThanOrEqual(0.5);
  const s4 = await run(page, 'tiles:wide-global-field', { downsample: 4 });
  expect(s4.interiorMaxLevels).toBeLessThanOrEqual(1);
  const raw = await run(page, 'tiles:wide-global-field', { uncompensated: true });
  expect(raw.interiorMeanLevels).toBeGreaterThan(good.interiorMeanLevels);
});

test('grain is bitwise tile-invariant', async ({ page }) => {
  const r = await run(page, 'grain:tiles');
  expect(r.differing).toBe(0);
});

test('grain statistics: N(0,1) to 0.5 %, no period at 1024 px, Selwyn σ²·A constant within 5 %', async ({ page }) => {
  const r = await run(page, 'grain:stats');
  expect(Math.abs(r.mean)).toBeLessThan(0.005);
  expect(Math.abs(r.variance - 1)).toBeLessThan(0.005);
  expect(Math.abs(r.acf1024)).toBeLessThan(0.01);
  expect(Math.abs(r.acf1)).toBeLessThan(0.01);
  const s = await run(page, 'grain:selwyn');
  expect(s.spread).toBeLessThan(0.05);
});

test('SAT probe: f32 SAT fails to estimate σ = 0.010 at 4096 × 2731; wrapping u32 gives 0.0100', async ({ page }) => {
  const r = await run(page, 'sat');
  expect(Math.abs(r.sigmaU32 - 0.01)).toBeLessThan(2e-4);
  expect(Math.abs(r.sigmaF32 - 0.01)).toBeGreaterThan(0.005);
});

test('GpuEngine evaluates every domain along the negative-scan chain', async ({ page }) => {
  const r = await run(page, 'engine:taps');
  const want: Record<string, string> = {
    'scan.density': 'scanner-density', 'invert.dyes': 'film-dyes', 'film.grain': 'film-dyes', 'print.expose': 'paper-logH',
    'print.lights': 'paper-logH', 'print.develop': 'paper-dyes', 'view.reflect': 'print-xyz', 'view.flare': 'print-xyz', 'output.display': 'display-rgb',
  };
  for (const [op, d] of Object.entries(want)) {
    expect(r[op].domain, op).toBe(d);
    expect(r[op].finite, op).toBe(true);
    expect([r[op].w, r[op].h]).toEqual([20, 15]);
  }
  expect(r['invert.dyes'].channels).toBe(4);
});

test('CHB-002 conformance suite passes against GpuEngine', async ({ page }) => {
  test.setTimeout(600_000);
  const r = await run(page, 'conformance');
  expect(r.failures).toEqual([]);
  expect(r.total).toBeGreaterThan(100);
});
