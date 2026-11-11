/// <reference types="@webgpu/types" />
// CHB-006 stage 4: WGSL dust kernels against the JS reference (guide §8.3 parity):
// neutral plane and background planes within 1e-5 D, threshold masks identical except pixels within
// 1e-6 of the threshold. Runs in headless Chromium on SwiftShader.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { boxMean, mad, neutralPlane, oddPad, plantedFrame, squareClosing, squareOpening } from '@chromobench/ingest';

const wgsl = (f: string): string => readFileSync(new URL(`../packages/ingest/src/conditioning/dust/wgsl/${f}`, import.meta.url), 'utf8');

test.beforeEach(async ({ page }) => {
  await page.goto('/wgsl-blank.html');
});

test('dust WGSL kernels compile and match the JS reference', async ({ page }) => {
  const F = plantedFrame({ seed: 7, w: 160, h: 128, n: 12, decoys: 4 });
  const { w, h } = F;
  const r = 10;
  // JS reference
  const N = neutralPlane(F.D, F.sigma);
  const p = 4 * r + (r >> 1) + 2;
  const { pad, pw, ph } = oddPad(N, w, h, p);
  const closed = squareClosing(squareOpening(pad, pw, ph, r), pw, ph, r);
  const bm = boxMean(closed, pw, ph, r >> 1);
  const bg = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) bg[y * w + x] = bm[(y + p) * pw + x + p]!;
  // the threshold stage on the flat background (no trend: the parity is per kernel)
  const res = Array.from(N, (v, i) => v - bg[i]!);
  const [med, sig] = mad(res);
  const lo = Math.max(0.015, 2.5 * sig);
  const wts = F.sigma.map((s) => 1 / (s * s));

  const gpu = await page.evaluate(async (a) => {
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter!.requestDevice();
    const errors: string[] = [];
    const mods: Record<string, GPUShaderModule> = {};
    for (const [name, code] of Object.entries(a.code)) {
      mods[name] = device.createShaderModule({ code, label: name });
      for (const m of (await mods[name]!.getCompilationInfo()).messages) if (m.type === 'error') errors.push(`${name} ${m.lineNum}: ${m.message}`);
    }
    if (errors.length) return { errors, N: [], bg: [], mask: [] };
    const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    const buf = (data: Float32Array | Uint32Array | number): GPUBuffer => {
      const size = typeof data === 'number' ? data : data.byteLength;
      const b = device.createBuffer({ size: Math.max(16, size), usage: S });
      if (typeof data !== 'number') device.queue.writeBuffer(b, 0, data as Float32Array<ArrayBuffer>);
      return b;
    };
    const uni = (u: ArrayBuffer): GPUBuffer => {
      const b = device.createBuffer({ size: u.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(b, 0, u);
      return b;
    };
    const run = (mod: string, entry: string, bufs: GPUBuffer[], gx: number, gy = 1): void => {
      const pipe = device.createComputePipeline({ layout: 'auto', compute: { module: mods[mod]!, entryPoint: entry } });
      const bind = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: bufs.map((b, i) => ({ binding: i, resource: { buffer: b } })) });
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(pipe);
      pass.setBindGroup(0, bind);
      pass.dispatchWorkgroups(gx, gy);
      pass.end();
      device.queue.submit([enc.finish()]);
    };
    const read = async (b: GPUBuffer, n: number): Promise<number[]> => {
      const r = device.createBuffer({ size: n * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      const enc = device.createCommandEncoder();
      enc.copyBufferToBuffer(b, 0, r, 0, n * 4);
      device.queue.submit([enc.finish()]);
      await r.mapAsync(GPUMapMode.READ);
      const out = Array.from(new Float32Array(r.getMappedRange().slice(0)));
      r.unmap();
      return out;
    };
    const n = a.w * a.h;
    // neutral plane
    const Dbuf = buf(new Float32Array(a.D));
    const Nbuf = buf(n * 4);
    const pu = new ArrayBuffer(32);
    new Uint32Array(pu, 0, 4).set([n, 0, 0, 0]);
    new Float32Array(pu, 16, 4).set([...a.wts, a.wts[0]! + a.wts[1]! + a.wts[2]!]);
    run('neutral', 'neutral', [Dbuf, Nbuf, uni(pu)], Math.ceil(n / 256));
    const Ngpu = await read(Nbuf, n);
    // background on the padded plane: opening, closing (min/max passes), box mean
    const pn = a.pw * a.ph;
    let cur = buf(new Float32Array(a.pad));
    const step = (mod: string, entry: string, r: number, isMax: number): void => {
      const out = buf(pn * 4);
      run(mod, entry, [cur, out, uni(new Uint32Array([a.pw, a.ph, r, isMax]).buffer)], Math.ceil(a.pw / 64), Math.ceil(a.ph / 4));
      cur = out;
    };
    for (const isMax of [0, 1, 1, 0]) { step('minmax', 'passH', a.r, isMax); step('minmax', 'passV', a.r, isMax); }
    step('boxmean', 'meanH', a.r >> 1, 0);
    step('boxmean', 'meanV', a.r >> 1, 0);
    const padded = await read(cur, pn);
    const bg: number[] = [];
    for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) bg.push(padded[(y + a.p) * a.pw + x + a.p]!);
    // threshold
    const Mbuf = buf(n * 4);
    const tu = new ArrayBuffer(32);
    new Uint32Array(tu, 0, 4).set([n, 0, 0, 0]);
    new Float32Array(tu, 16, 4).set([a.med, a.lo, 0, 0]);
    run('neutral', 'threshold', [buf(new Float32Array(a.N)), buf(new Float32Array(a.bg)), Mbuf, uni(tu)], Math.ceil(n / 256));
    const mr = device.createBuffer({ size: n * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(Mbuf, 0, mr, 0, n * 4);
    device.queue.submit([enc.finish()]);
    await mr.mapAsync(GPUMapMode.READ);
    const mask = Array.from(new Uint32Array(mr.getMappedRange().slice(0)));
    mr.unmap();
    device.destroy();
    return { errors, N: Ngpu, bg, mask };
  }, {
    code: { minmax: wgsl('minmax.wgsl'), boxmean: wgsl('boxmean.wgsl'), neutral: wgsl('neutral.wgsl') },
    D: [...F.D[0]!, ...F.D[1]!, ...F.D[2]!], wts, w, h, pad: Array.from(pad), pw, ph, p, r,
    N: Array.from(N), bg: Array.from(bg), med, lo,
  });

  expect(gpu.errors).toEqual([]);
  let worstN = 0, worstBg = 0;
  for (let i = 0; i < w * h; i++) {
    worstN = Math.max(worstN, Math.abs(gpu.N[i]! - N[i]!));
    worstBg = Math.max(worstBg, Math.abs(gpu.bg[i]! - bg[i]!));
  }
  expect(worstN).toBeLessThan(1e-5);
  expect(worstBg).toBeLessThan(1e-5);
  let differ = 0;
  for (let i = 0; i < w * h; i++) {
    const js = res[i]! - med >= lo ? 1 : 0;
    if (gpu.mask[i] !== js && Math.abs(res[i]! - med - lo) > 1e-6) differ++;
  }
  expect(differ).toBe(0);
  expect(gpu.mask.reduce((s, v) => s + v, 0)).toBeGreaterThan(20);
});
