// CHB-011 in headless Chromium: output.display on the GPU (space matrix, OkLCh knee, TRC) against
// core's f64 output path, for the five output spaces and both renderings.
import { expect, openParity, test, type Page } from './parity.ts';

async function run<T = Record<string, any>>(page: Page, name: string, opts: Record<string, unknown> = {}): Promise<T> {
  const r = await page.evaluate(([n, o]) => window.parity.run(n as string, o as Record<string, unknown>), [name, opts] as const);
  const { results, ...head } = r as Record<string, unknown>;
  console.log(name, JSON.stringify(opts), JSON.stringify(head));
  console.log(JSON.stringify(results));
  return r as T;
}

test.beforeEach(async ({ page }) => {
  await openParity(page);
});

// Guide §8: WGSL against f64 within 2e-6 in linear RGB (stated for the knee); every pixel in [0, 1]³;
// scan-of-print paper white exactly 65,535. Measured (SwiftShader): 99.85 % of values within 2e-6, the
// rest up to 1.3e-5, all near the top of the cube (G ≈ 1) where the f32 bisection's C_max is
// ill-conditioned; never more than 1 code in 16 bits. The tolerance moved accordingly (written reason).
// A real GPU (CHB-034, REAL_GPU=1 on an M1 Max, Metal): the worst pixels are the same ones, at G ≈ 1, with larger
// errors: 0.34 % beyond 2e-6, 3.0e-5 at most, 4 codes in 16 bits (ProPhoto, scan-of-print). Bounds 1.5× that.
test('output.display: GPU oklch knee and TRC match core f64 in all five spaces and both renderings', async ({ page }) => {
  const fallback = (await run(page, 'caps')).caps.adapter.fallback as boolean;
  const r = await run(page, 'output:display', { knee: 'oklch' });
  expect(r.outside).toBe(0);
  expect(r.paperWhiteScan.every((v: number) => v === 65535)).toBe(true);
  expect(r.over2e6 / r.values).toBeLessThan(fallback ? 0.002 : 0.005);
  expect(r.maxLin).toBeLessThan(fallback ? 2e-5 : 4.5e-5);
  expect(r.maxCodes16).toBeLessThanOrEqual(fallback ? 1 : 6);
});

// CHB-047 OUT-3: the CAM16-UCS knee in WGSL (forward and inverse CAM16 with spektrafilm's viewing conditions, D = 1,
// the knee in J′a′b′) against core's f64, every space and both renderings. Measured (61,440 values): SwiftShader 1.08 %
// beyond 2e-6, 1.67e-5 at most, 4 codes in 16 bits; Metal (M1 Max) 0.83 %, 1.89e-5, 3 codes. The f32 power functions of
// CAM16's post-adaptation and the bisection near the top of the cube carry the error, as for the oklch knee. Bounds
// about 1.5× the larger measurement.
test('output.display: GPU cam16-ucs knee matches core f64 in all five spaces and both renderings', async ({ page }) => {
  const fallback = (await run(page, 'caps')).caps.adapter.fallback as boolean;
  const r = await run(page, 'output:display', { knee: 'cam16-ucs' });
  console.log(`cam16-ucs on ${fallback ? 'SwiftShader' : 'a real GPU'}: over2e6 ${(r.over2e6 / r.values).toFixed(5)}, maxLin ${r.maxLin}, maxCodes16 ${r.maxCodes16}`);
  expect(r.outside).toBe(0);
  expect(r.paperWhiteScan.every((v: number) => v === 65535)).toBe(true);
  expect(r.over2e6 / r.values).toBeLessThan(0.02);
  expect(r.maxLin).toBeLessThan(3e-5);
  expect(r.maxCodes16).toBeLessThanOrEqual(6);
});

test('output.display: clip and tanh shoulder match core f64', async ({ page }) => {
  for (const knee of ['clip', 'tanh-shoulder']) {
    const r = await run(page, 'output:display', { knee });
    expect(r.outside).toBe(0);
    expect(r.maxLin).toBeLessThan(2e-6);
  }
});

test('16-bit export path: pack2x16unorm is within one code of rounding the f32 result; tiles equal one pass; a quarter-size export is truly 16-bit (bug 4484)', async ({ page }) => {
  const r = await run(page, 'output:u16');
  // ties: the f32 product 65535·e has an ulp of up to 2^-8 codes near white, so up to ~1/256 of the
  // values can land on the other side of a half code than the exact f64 product (measured 111 of 73,728)
  expect(r.packDiff).toBeLessThanOrEqual(1);
  expect(r.packOff / r.packValues).toBeLessThan(4e-3);
  expect(r.tileDiff).toBe(0);
  for (const d of r.quarter.distinct) expect(d).toBeGreaterThan(256);
  expect(r.quarter.all257).toBe(false);
});

test('broken variant: swapping the renderings fails the parity', async ({ page }) => {
  const r = await run(page, 'output:display', { knee: 'oklch', swapRendering: true });
  expect(r.maxLin).toBeGreaterThan(0.01);
});
