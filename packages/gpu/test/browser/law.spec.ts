// Contract 1.0 on the GPU (CHB-037 P3): the light law, composite mix, mask algebra, heal / clone and clarity against
// core's reference engine on documents compiled by the contract's compiler: end to end (RefEngine exact; tabulated for
// the preview) and kernel by kernel (src/parity/reference.ts: core's functions on the GPU's own inputs).
import { expect, openParity, test, type Page } from './parity.ts';

async function run<T = Record<string, any>>(page: Page, name: string, opts: Record<string, unknown> = {}): Promise<T> {
  const r = await page.evaluate(([n, o]) => window.parity.run(n as string, o as Record<string, unknown>), [name, opts] as const);
  console.log(name, JSON.stringify(r));
  return r as T;
}

test.beforeEach(async ({ page }) => {
  await openParity(page);
});

// Every darkroom kind (main at amount 0.95, printer lights, two masked burns, a dodge, base and open flashes, a density
// mask, a masked filter, a preflash, a group with amount and mask) in one print.combine: paper log H within 2e-4 of
// lightH on core exact (export) and on core tabulated (preview: the same 33³ pd tables), within 2e-5 of lightH on the
// GPU's own inputs (the passes alone), masks within 1e-5.
test('light law: print.combine with every darkroom kind matches lightH; masks and the density mask match core', async ({ page }) => {
  const r = await run(page, 'law:combine');
  expect(r.error).toBeUndefined();
  expect(r.barrier).toBe(true);
  expect(r.terms).toEqual(expect.arrayContaining(['burn', 'dodge', 'flash-base', 'flash-open']));
  expect(r.densities).toBe(1);
  expect(r.filters).toBe(2);
  expect(r.preflash).toBe(1);
  expect(r.export.maxAbs).toBeLessThanOrEqual(2e-4);
  expect(r.preview.maxAbs).toBeLessThanOrEqual(2e-4);
  expect(r.kernel.maxAbs).toBeLessThanOrEqual(2e-5);
  for (const m of r.masks) expect(m.maxAbs, m.op).toBeLessThanOrEqual(1e-5);
  expect(r.masks.length).toBeGreaterThanOrEqual(4);
  for (const d of r.densityMasks) {
    expect(d.maxAbs).toBeLessThanOrEqual(1e-4);
    expect(d.max).toBeGreaterThan(0.02);
  }
  expect(r.half.maxAbs).toBeLessThan(0.05);
  expect(r.vsMain.maxAbs).toBeGreaterThan(0.1); // the terms do change the print
});

test('light law: a print.combine without texture terms fuses into one pointwise op, equal to lightH and to its barrier form', async ({ page }) => {
  const r = await run(page, 'law:combine-fused');
  expect(r.error).toBeUndefined();
  for (const k of ['general', 'additive']) {
    expect(r[k].barrier, k).toBe(false);
    expect(r[k].light, k).not.toBeNull();
    expect(r[k].export.maxAbs, k).toBeLessThanOrEqual(2e-5);
    expect(r[k].preview.maxAbs, k).toBeLessThanOrEqual(2e-4);
  }
  expect(r.general.light.flags).toBe(0);
  expect(r.additive.light.flags).toBe(1);
  expect(r.fusedVsBarrier.barrier).toBe(true);
  expect(r.fusedVsBarrier.maxAbs).toBeLessThanOrEqual(2e-5);
});

test('composite.mix: the backdrop at coverage 0 and the top at coverage 1 bit for bit; mixPixel between; clarity under a mask', async ({ page }) => {
  const r = await run(page, 'law:composite');
  expect(r.error).toBeUndefined();
  expect(r.exact).toEqual({ amount0: 0, amount1: 0, amount1FullMask: 0, amount1EmptyMask: 0 });
  expect(r.between.maxAbs).toBeLessThanOrEqual(2e-6);
  expect(r.document.op).toBe('composite.mix');
  expect(r.document.kernel.maxRel).toBeLessThanOrEqual(2e-5);
  expect(r.document.chain.maxRel).toBeLessThanOrEqual(5e-4);
});

test('mask algebra: components and add / subtract / intersect / feather / invert match maskCombine; the exact laws hold bit for bit', async ({ page }) => {
  const r = await run(page, 'law:masks');
  expect(r.error).toBeUndefined();
  for (const [k, d] of Object.entries(r.parity as Record<string, { maxAbs: number }>)) expect(d.maxAbs, k).toBeLessThanOrEqual(1e-5);
  expect(r.laws.addIdempotent).toBe(0);
  expect(r.laws.intersectFull).toBe(0);
  expect(r.laws.amount0).toBe(0);
  expect(r.laws.invertTwice).toBeLessThanOrEqual(1e-7);
  expect(r.halfScale.maxAbs).toBeLessThanOrEqual(1e-5);
});

test('heal and clone: sequential spots, coalesced like layers kept apart; density heal in the scan; tiles equal one pass', async ({ page }) => {
  const r = await run(page, 'law:heal');
  expect(r.error).toBeUndefined();
  expect(r.op).toBe('clone');
  expect(r.coalesced.op).toBe('heal');
  expect(r.coalesced.spots).toBe(3);
  expect(r.coalesced.sameNode).toBe(true);
  expect(r.print.kernel.maxRel).toBeLessThan(1e-4);
  expect(r.print.chain.maxRel).toBeLessThan(5e-4);
  expect(r.coalesced.maxAbs).toBeLessThanOrEqual(1e-6);
  expect(r.parallel.maxAbs).toBeGreaterThan(1e-3); // spot 3 reads spot 1's result: the old semantics differ
  expect(r.tileDiff).toBe(0);
  expect(r.half.maxRel).toBeLessThan(1e-4);
  expect(r.scan.op).toBe('heal');
  expect(r.scan.changed).toBeGreaterThan(30);
  expect(r.scan.maxAbs).toBeLessThan(1e-4);
});

test('broken variant: a heal source 0.7 px off fails the parity', async ({ page }) => {
  const r = await run(page, 'law:heal', { broken: true });
  expect(r.print.kernel.maxAbs).toBeGreaterThan(1e-3);
});

test('clarity: radius in mm on the print through umPerPx.paper; direct and downsampled low-pass match the f64 definition', async ({ page }) => {
  const r = await run(page, 'law:clarity');
  expect(r.error).toBeUndefined();
  for (const k of ['small', 'wide', 'soften']) {
    expect(r[k].op, k).toBe('clarity');
    expect(r[k].umPaper, k).toBe(32); // 4 µm/px on the film × magnification 8
    expect(r[k].effect, k).toBeGreaterThan(1e-3);
  }
  for (const k of ['small', 'soften']) {
    expect(r[k].kernel.maxRel, k).toBeLessThan(2e-5);
    expect(r[k].chain.maxRel, k).toBeLessThan(5e-4);
  }
  // σ > 32 px runs on a downsampled, padded field (one Gaussian with core's edge rule): measured 1.3e-4 on a frame
  // smaller than σ, 7e-4 on a frame five times σ (the gain (L′/L)³ triples the low-pass's error)
  expect(r.wide.sigma).toBeGreaterThan(32);
  expect(r.wide.kernel.maxRel).toBeLessThan(5e-4);
  expect(r.large.op).toBe('clarity');
  expect(r.large.sigma).toBe(100);
  expect(r.large.kernel.maxRel).toBeLessThan(2e-3);
});

// One pass up to σ = 32 px; beyond it the field path (box average of the clamp-extended image on a padded field, one
// compensated pass, bilinear read back): within 5e-4 of core's gaussianBlur1 on a mask (measured 2.1e-4 at σ 40, 1.0e-4
// at σ 100; several clamped passes were 28 % off at the edge).
test('blur: Gaussians of any σ match core\'s one-pass clamp-to-edge Gaussian', async ({ page }) => {
  const r = await run(page, 'law:blur');
  expect(r.error).toBeUndefined();
  expect(r.s10.d).toBeLessThanOrEqual(1e-6);
  expect(r.s32.d).toBeLessThanOrEqual(1e-6);
  expect(r.s40.d).toBeLessThanOrEqual(5e-4);
  expect(r.s100.d).toBeLessThanOrEqual(5e-4);
});

test('whole documents (every darkroom kind; fused lights; heal and clarity on the print) at display within one 8-bit level of core', async ({ page }) => {
  const r = await run(page, 'law:core');
  expect(r.error).toBeUndefined();
  for (const k of ['combine', 'fused', 'print']) expect(r[k].max8bit, k).toBeLessThanOrEqual(1);
});

test('output.frame: crop and the eight orientations are a pixel permutation of output.display (full, half, region); straightening is core\'s', async ({ page }) => {
  const r = await run(page, 'law:frame');
  expect(r.error).toBeUndefined();
  for (const o of ['none', 'flipH', 'flipV', 'rot180', 'cw90', 'ccw90', 'transpose', 'transverse']) {
    expect(r[o].size, o).toEqual(r[o].want);
    expect([r[o].full, r[o].half, r[o].region], o).toEqual([0, 0, 0]);
  }
  expect(r.straighten.size).toEqual(r.straighten.want);
  expect(r.straighten.maxAbs).toBeLessThan(1e-5);
  expect(r.straighten.core8bit).toBeLessThanOrEqual(1);
});

test('an export tile by tile equals the whole-frame export for every spatial op (halos, whole-frame fields and extremes)', async ({ page }) => {
  test.setTimeout(600_000);
  const r = await run(page, 'law:tiles');
  expect(r.error).toBeUndefined();
  const want: Record<string, string[]> = {
    densityNarrow: ['print.densityMask'], densityWide: ['print.densityMask'], featherNarrow: ['mask.feather'], featherWide: ['mask.feather'],
    clarity: ['clarity'], sharpen: ['sharpen'], heal: ['heal'],
  };
  for (const [k, ops] of Object.entries(want)) for (const op of ops) expect(r[k].ops, k).toContain(op);
  for (const k of [...Object.keys(want), 'stack']) {
    expect(r[k].codes, k).toBe(0);
    // the check can fail: the preview path, every texture on the tile's own grid, differs at the tile borders
    if (k !== 'heal') expect(r[k].before, k).toBeGreaterThan(0);
  }
});
