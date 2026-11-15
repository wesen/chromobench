// Contract 1.1 on the GPU (CHB-037 P8a): the digital layers of the composite stages, their encodings, the blend modes
// fused and masked, and documents with print stacks, against core's reference engine (src/parity/digital-tests.ts).
import { expect, openParity, test, type Page } from './parity.ts';

async function run<T = Record<string, any>>(page: Page, name: string, opts: Record<string, unknown> = {}): Promise<T> {
  const r = await page.evaluate(([n, o]) => window.parity.run(n as string, o as Record<string, unknown>), [name, opts] as const);
  console.log(name, JSON.stringify(r));
  return r as T;
}

test.beforeEach(async ({ page }) => {
  await openParity(page);
});

// Every op (exposure, mixer, vignette, curve and levels on L and on a channel, hsl, vibrance, grade, the colour and
// radial masks) and every encoding (xyz ↔ rgb ↔ oklab, D50 and D65 whites, scene and print) on seeded images.
test('digital layers: every op and encoding matches the reference engine', async ({ page }) => {
  const r = await run<Record<string, { maxAbs: number }>>(page, 'law:digital');
  expect((r as { error?: unknown }).error).toBeUndefined();
  expect(Object.keys(r).length).toBeGreaterThanOrEqual(2 * 14 + 9);
  for (const [k, d] of Object.entries(r)) expect(d.maxAbs, k).toBeLessThanOrEqual(2e-5);
});

test('blend modes: all 16, fused into the pointwise kernel and as a masked pass, in linear RGB and OkLab', async ({ page }) => {
  const r = await run(page, 'law:blend');
  expect(r.error).toBeUndefined();
  expect(r.fusedCount).toBe(r.total);
  expect(r.saveMix).toBe(true);
  expect(r.top).toEqual(['hsl', 'curve']);
  // a separable mode in OkLab converts both colours to RGB and its result back: where the result's LMS nears 0
  // (exclusion of two light colours), the cube root's slope amplifies f32 rounding (SwiftShader: 1.1e-4 in OkLab, a third
  // of an 8-bit level); everywhere else 1e-5
  const sep = new Set(['multiply', 'screen', 'overlay', 'darken', 'lighten', 'colour-dodge', 'colour-burn', 'hard-light', 'soft-light', 'difference', 'exclusion']);
  for (const [k, d] of Object.entries(r.modes as Record<string, { fused: number; masked: number }>)) {
    const bound = k.startsWith('oklab') && sep.has(k.slice(6)) ? 3e-4 : 2e-5;
    expect(d.fused, `${k} fused`).toBeLessThanOrEqual(bound);
    expect(d.masked, `${k} masked`).toBeLessThanOrEqual(bound);
  }
});

test('documents with print stacks (every op, masks, blends, groups) match the reference engine at display', async ({ page }) => {
  const r = await run(page, 'law:digital-doc');
  expect(r.error).toBeUndefined();
  for (const k of ['tone', 'colour', 'masked', 'blends']) {
    expect(r[k].display.max8bit, k).toBeLessThanOrEqual(1);
    expect(r[k].finished.maxAbs, k).toBeLessThanOrEqual(3e-4);
  }
  expect(r.colour.fusedMixes).toBeGreaterThanOrEqual(1); // the mixer at 0.7 fuses
  expect(r.blends.fusedMixes).toBeGreaterThanOrEqual(3);
});

test('the scene stage of a camera file renders on the GPU like the reference engine', async ({ page }) => {
  test.setTimeout(300_000);
  const r = await run(page, 'film:scene');
  expect(r.error).toBeUndefined();
  expect(r.changed).toBeGreaterThan(100);
  expect(r.scene.max).toBeLessThan(3e-5);
  expect(r.display.max).toBeLessThan(2e-4);
});

test('bench: six composite layers on the print at 4000 × 2674, preview and export', async ({ page }) => {
  test.skip(!process.env['BENCH'], 'timing only: set BENCH=1');
  test.setTimeout(900_000);
  const r = await run(page, 'bench:composite', {});
  expect(r.error).toBeUndefined();
});
