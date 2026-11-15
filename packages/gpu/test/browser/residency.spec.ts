// CHB-041 on the GPU: proxies (the source sampled on a render's grid) give the full-size texture's pixels bit for bit,
// and the engine recovers from an out-of-memory once, or says so (src/parity/residency-tests.ts).
import { expect, openParity, test, type Page } from './parity.ts';

async function run<T = Record<string, any>>(page: Page, name: string, opts: Record<string, unknown> = {}): Promise<T> {
  const r = await page.evaluate(([n, o]) => window.parity.run(n as string, o as Record<string, unknown>), [name, opts] as const);
  console.log(name, JSON.stringify(r));
  return r as T;
}

test.beforeEach(async ({ page }) => {
  await openParity(page);
});

test('a render smaller than its region reads a proxy of its own size: the same pixels as from the full-size texture', async ({ page }) => {
  test.setTimeout(300_000);
  const r = await run(page, 'residency:proxy');
  expect(r.error).toBeUndefined();
  for (const part of ['camera', 'negative']) {
    for (const [k, d] of Object.entries(r[part] as Record<string, { n: number; differ: number }>)) {
      expect(d.n, `${part} ${k}`).toBeGreaterThan(0);
      expect(d.differ, `${part} ${k}`).toBe(0);
    }
  }
  // with proxies no full-size texture is kept for these renders (all smaller than their regions)
  expect(r.kept.proxy.bytes).toBeLessThan(r.kept.full.bytes);
});

test('an out-of-memory recovers on the retry; beyond it, E_GPU_OOM says what was tried', async ({ page }) => {
  const r = await run(page, 'residency:recover');
  expect(r.error).toBeUndefined();
  expect(r.recovered.residentBefore).toBeGreaterThan(0);
  expect(r.recovered.same.differ).toBe(0);
  expect(r.failed.code).toBe('E_GPU_OOM');
  expect(r.failed.message).toMatch(/not enough GPU memory .* after letting go of/);
  expect(r.failed.hint).toMatch(/budget/);
  expect(r.afterLength).toBeGreaterThan(0);
});

// a measurement, not a law (CHB-041, asked: half floats for full-size intermediates): what rounding a camera file's first
// full-size texture to rgba16float costs, against the tolerances the GPU holds against the reference engine
test('half-float storage of the first full-size texture, measured against the parity tolerances', async ({ page }) => {
  const r = await run(page, 'residency:f16');
  expect(r.error).toBeUndefined();
  expect(r.sourceRelError).toBeGreaterThan(0);
  expect(r['scene.export'].maxAbs).toBeGreaterThan(0);
});
