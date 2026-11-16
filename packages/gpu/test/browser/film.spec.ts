// CHB-012 in headless Chromium: the forward film path (digital RAW → film) on the GPU against core's
// reference engine on the same graph, the pcg4d uniforms bit for bit, grain statistics, and a
// digital-raw recipe end to end (guide §5.6 kernel table).
import { expect, openParity, test, type Page } from './parity.ts';

async function run<T = Record<string, any>>(page: Page, name: string, opts: Record<string, unknown> = {}): Promise<T> {
  const r = await page.evaluate(([n, o]) => window.parity.run(n as string, o as Record<string, unknown>), [name, opts] as const);
  console.log(name, JSON.stringify(opts), JSON.stringify(r).slice(0, 3000));
  return r as T;
}

test.beforeEach(async ({ page }) => {
  await openParity(page);
});

test('pcg4d uniforms are bit-identical to core (JS Math.imul and WGSL u32)', async ({ page }) => {
  const r = await run(page, 'film:rng');
  expect(r.error).toBeUndefined();
  expect(r.differing).toBe(0);
});

test('forward stages match core: camera matrix, exposure, coupling, halation, development', async ({ page }) => {
  test.setTimeout(300_000);
  const r = await run(page, 'film:stages');
  expect(r.error).toBeUndefined();
  // f32 against f64 with the same algorithms (cubic film table, the same curve samples); measured
  // (SwiftShader) ≤ 1.3e-6 everywhere, the guide's budget is 1e-4 dye / 0.005 stops
  for (const k of ['xyz', 'expose', 'couple', 'coupleDiffused', 'halation', 'develop', 'developPush']) expect(r[k].max, k).toBeLessThan(2e-5);
});

test('white balance before the film (CHB-048): a changed temperature and tint match core at the scene and through the film', async ({ page }) => {
  test.setTimeout(300_000);
  // a tungsten white with a green tint, away from the as-shot white (the GPU binds core's matrix: contract sceneMatrix)
  const r = await run(page, 'film:stages', { wb: { temperature_K: 3200, tint: 15 } });
  expect(r.error).toBeUndefined();
  for (const k of ['xyz', 'expose', 'develop']) expect(r[k].max, k).toBeLessThan(2e-5);
});

test('grain: the same Poisson model, mean and variance of core on a uniform field', async ({ page }) => {
  test.setTimeout(300_000);
  const r = await run(page, 'film:grain');
  expect(r.error).toBeUndefined();
  // the guide's grain budget: mean within 3σ/√n, variance within 2 %; here the uniforms are identical and
  // only f32 CDF comparisons can flip a count (measured: 80 % of values within 1e-4, variance ratio 0.99993)
  expect(Math.abs(r.gpu.mean - r.ref.mean)).toBeLessThan(3 * Math.sqrt(r.ref.variance / (96 * 64)));
  expect(Math.abs(r.gpu.variance / r.ref.variance - 1)).toBeLessThan(0.02);
  expect(r.identicalShare).toBeGreaterThan(0.6);
});

test('the film mixture blur (multi-pass beyond σ = 32 px) matches core\'s f64 convolution in the interior', async ({ page }) => {
  const r = await run(page, 'film:mixture');
  expect(r.error).toBeUndefined();
  expect(r.max).toBeLessThan(2e-3);
  expect(r.mean).toBeLessThan(2e-4);
});

test('a digital-raw recipe renders on the GPU like the reference engine', async ({ page }) => {
  test.setTimeout(300_000);
  const r = await run(page, 'film:recipe');
  expect(r.error).toBeUndefined();
  expect(r.finite).toBe(true);
  for (const op of ['source.xyz', 'capture.expose', 'film.couple', 'film.halation', 'film.develop', 'film.grain']) expect(r.ops).toContain(op);
  expect(r.max).toBeLessThan(2e-4);
});

test('a camera file exports tile by tile exactly as whole: film.couple and film.halation read their reach from the halo', async ({ page }) => {
  test.setTimeout(600_000);
  const r = await run(page, 'film:tiles');
  expect(r.error).toBeUndefined();
  for (const k of ['film', 'grain']) {
    expect(r[k].ops, k).toEqual(expect.arrayContaining(['film.couple', 'film.halation']));
    expect(r[k].codes, k).toBe(0);
    expect(r[k].before, k).toBeGreaterThan(0);
  }
});
