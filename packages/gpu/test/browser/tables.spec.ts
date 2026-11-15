// Stages 1–3 in headless Chromium (SwiftShader; the machine's GPU with REAL_GPU=1): runtime caps, compile diagnostics, device loss,
// table parity against core's f64 tables (each with a broken variant that must fail), the worker
// pool's bitwise equality, the OPFS cache across a reload, and the wqul integer/accuracy probe.
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

test('stage 1: caps report a granted device within the adapter limits', async ({ page }) => {
  const r = await run(page, 'caps');
  expect(r.caps.available).toBe(true);
  // SwiftShader by default; REAL_GPU=1 gets the machine's adapter (CHB-034). Either way the runtime reports which.
  expect(typeof r.caps.adapter.fallback).toBe('boolean');
  if (!process.env['REAL_GPU']) expect(r.caps.adapter.fallback).toBe(true);
  else expect(r.caps.adapter.fallback).toBe(false);
  for (const k of ['maxTextureDimension2D', 'maxBufferSize', 'maxStorageBufferBindingSize', 'maxComputeWorkgroupStorageSize']) {
    expect(r.caps.limits[k]).toBeLessThanOrEqual(r.adapterLimits[k]);
  }
  // we asked for more than the defaults and got what the adapter offers, capped at our wants
  expect(r.caps.limits.maxBufferSize).toBe(Math.min(2 ** 30, r.adapterLimits.maxBufferSize));
  expect(r.caps.features.float32Filterable).toBe(true);
});

test('stage 1: a broken kernel yields E_KERNEL_COMPILE with a line number', async ({ page }) => {
  const r = await run(page, 'compile-error');
  expect(r.thrown).toBe(true);
  expect(r.diag.code).toBe('E_KERNEL_COMPILE');
  expect(r.diag.where.line).toBe(3);
});

test('stage 1: an early return before workgroupBarrier is refused (uniform control flow)', async ({ page }) => {
  const r = await run(page, 'uniform-control-flow');
  expect(r.refused).toBe(true);
  expect(r.message).toMatch(/uniform control flow/);
});

test('stage 1: device loss rejects in-flight work with E_DEVICE_LOST; the next call recreates the device', async ({ page }) => {
  const r = await run(page, 'device-lost');
  expect(r.first).toBe('E_DEVICE_LOST');
  expect(r.after).toBe('E_DEVICE_LOST');
  expect(r.recreated).toBe(true);
  expect(r.rebuilt).toBe(33 ** 3 * 4);
});

test('stage 3: GPU solve table within 3e-6 of f64 on reachable nodes, 0 flips', async ({ page }) => {
  const r = await run(page, 'table:solve');
  expect(r.extra.nodes).toBe(35937);
  expect(r.maxDiff).toBeLessThanOrEqual(3e-6);
  expect(r.flips).toBe(0);
  expect(r.pass).toBe(true);
});

test('stage 3 broken variant: gtol = 1e-5 exceeds the solve tolerance', async ({ page }) => {
  const r = await run(page, 'table:solve:gtol1e-5');
  expect(r.pass).toBe(false);
  expect(r.maxDiff).toBeGreaterThan(3e-6);
});

test('stage 3: GPU printing-density table within 7.2e-7; LOG2_10 = 3.32 fails', async ({ page }) => {
  expect((await run(page, 'table:pd')).pass).toBe(true);
  const bad = await run(page, 'table:pd:log2-10-rounded');
  expect(bad.pass).toBe(false);
});

// core's print table has M = I (XYZ under the viewing light); the M path is checked with a Bradford M.
test('stage 3: GPU print table within 4.2e-7 in XYZ (also with a Bradford M); a row-major matrix fails', async ({ page }) => {
  expect((await run(page, 'table:print')).pass).toBe(true);
  expect((await run(page, 'table:print:adapted')).pass).toBe(true);
  const bad = await run(page, 'table:print:row-major');
  expect(bad.pass).toBe(false);
});

test('stage 3: worker tables are bitwise equal to the main thread', async ({ page }) => {
  const r = await run(page, 'workers-bitwise');
  for (const k of ['solve', 'pd', 'print']) {
    expect(r[k].words).toBe(35937 * 4);
    expect(r[k].differing).toBe(0);
  }
});

test('stage 3: the OPFS cache round-trips a table bit for bit across a page reload', async ({ page }) => {
  await run(page, 'opfs-write');
  await page.reload();
  await page.waitForFunction(() => document.body.dataset['ready'] === '1');
  const r = await run(page, 'opfs-read');
  expect(r.hit).toBe(true);
  expect(r.differing).toBe(0);
  expect(r.changedDomainHit).toBe(false);
});

test('wqul: WGSL runtime integer arithmetic wraps; exp2/log2 accuracy on this adapter', async ({ page }) => {
  const r = await run(page, 'wqul');
  expect(r.ints).toEqual(r.expected);
  // record, then bound loosely: relative 1e-6 for 10^x via exp2, 1e-6 absolute for log10 via log2
  expect(r.exp2MaxRel).toBeLessThan(1e-6);
  expect(r.pow10ViaExp2MaxRel).toBeLessThan(1e-5);
  expect(r.log10ViaLog2MaxAbs).toBeLessThan(1e-6);
});
