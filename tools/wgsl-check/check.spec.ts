/// <reference types="@webgpu/types" />
// WebGPU smoke test and WGSL compile check (CHB-002 stage 1).
// 1. request an adapter and a device in headless Chromium;
// 2. compile every *.wgsl under packages/gpu/kernels/ plus the smoke kernel, each linked with the modules it includes
//    (`//! include <name>`) by the engine's own linker (packages/gpu/src/chain/wgsl-link.ts, CHB-037 P3b), so a kernel
//    compiles here exactly as the engine compiles it, and an include that is missing fails here;
// 3. fail on any compilation message of type 'error';
// 4. run the smoke kernel on [0,1,2,3] and read back [1,2,3,4].
import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { includesOf, linkWgsl } from '../../packages/gpu/src/chain/wgsl-link.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

function wgslFiles(): { name: string; code: string }[] {
  const out = [{ name: 'tools/wgsl-check/smoke.wgsl', code: readFileSync(join(here, 'smoke.wgsl'), 'utf8') }];
  const kernels = join(root, 'packages', 'gpu', 'kernels');
  if (existsSync(kernels)) {
    for (const f of readdirSync(kernels, { recursive: true }) as string[]) {
      if (f.endsWith('.wgsl')) out.push({ name: `packages/gpu/kernels/${f}`, code: linkWgsl(readFileSync(join(kernels, f), 'utf8'), (n) => readFileSync(join(kernels, n), 'utf8')) });
    }
  }
  return out;
}

test.beforeEach(async ({ page }) => {
  // A served page gives a secure context (localhost) for navigator.gpu.
  await page.goto('/wgsl-blank.html');
});

test('WebGPU adapter and device are available in headless Chromium', async ({ page }) => {
  const info = await page.evaluate(async () => {
    if (!('gpu' in navigator)) return { ok: false, why: 'navigator.gpu missing' };
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { ok: false, why: 'no adapter' };
    const device = await adapter.requestDevice();
    const ai = adapter.info;
    device.destroy();
    return { ok: true, why: `${ai.vendor} ${ai.architecture} ${ai.description}` };
  });
  console.log('adapter:', info.why);
  expect(info.ok, info.why).toBe(true);
});

test('every WGSL file compiles without errors', async ({ page }) => {
  const files = wgslFiles();
  const results = await page.evaluate(async (files) => {
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter!.requestDevice();
    const out: { name: string; errors: string[] }[] = [];
    for (const f of files) {
      const mod = device.createShaderModule({ code: f.code, label: f.name });
      const ci = await mod.getCompilationInfo();
      out.push({ name: f.name, errors: ci.messages.filter((m) => m.type === 'error').map((m) => `${m.lineNum}:${m.linePos} ${m.message}`) });
    }
    device.destroy();
    return out;
  }, files);
  for (const r of results) expect(r.errors, r.name).toEqual([]);
});

test('the kernels that use the working encodings include them (the module system is explicit)', () => {
  const kernels = join(root, 'packages', 'gpu', 'kernels');
  for (const f of ['combine.wgsl', 'pointwise.wgsl']) expect(includesOf(readFileSync(join(kernels, f), 'utf8')), f).toContain('working.wgsl');
  // a kernel without its include does not compile alone: the linker is what makes it whole
  expect(readFileSync(join(kernels, 'combine.wgsl'), 'utf8')).toContain('wkMix(');
});

test('broken WGSL is reported (the check can fail)', async ({ page }) => {
  const errors = await page.evaluate(async () => {
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter!.requestDevice();
    const mod = device.createShaderModule({ code: '@compute @workgroup_size(1) fn main() { let x: f32 = undefined_name; }' });
    const ci = await mod.getCompilationInfo();
    device.destroy();
    return ci.messages.filter((m) => m.type === 'error').length;
  });
  expect(errors).toBeGreaterThan(0);
});

test('smoke compute shader adds 1: [0,1,2,3] -> [1,2,3,4]', async ({ page }) => {
  const code = readFileSync(join(here, 'smoke.wgsl'), 'utf8');
  const out = await page.evaluate(async (code) => {
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter!.requestDevice();
    const input = new Float32Array([0, 1, 2, 3]);
    const buf = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(buf, 0, input);
    const read = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'main' } });
    const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buf } }] });
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(1);
    pass.end();
    enc.copyBufferToBuffer(buf, 0, read, 0, 16);
    device.queue.submit([enc.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    const result = Array.from(new Float32Array(read.getMappedRange().slice(0)));
    read.unmap();
    device.destroy();
    return result;
  }, code);
  expect(out).toEqual([1, 2, 3, 4]);
});
