// CHB-006 stage 2: LibRaw WASM in a module Worker in the browser. A synthetic 40-megapixel Bayer DNG
// (7728×5152) is decoded in scan mode while the main thread keeps ticking; we record the decode time
// and the longest main-thread gap (guide §7 stage 2 "time it and record the result").
import { expect, test } from '@playwright/test';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ingest = fileURLToPath(new URL('../packages/ingest/src/', import.meta.url));
// The dev server pre-bundles @colorhythm/libraw-wasm, so its import.meta.url no longer points at the
// .wasm; hosts pass the URL (workerRawDecoder's wasmUrl). In the app this is Vite's `?url` import.
const wasm = realpathSync(fileURLToPath(new URL('../packages/ingest/node_modules/@colorhythm/libraw-wasm/dist/libraw.wasm', import.meta.url)));

test.beforeEach(async ({ page }) => {
  await page.goto('/wgsl-blank.html');
});

test('a 40-megapixel RAW decodes in a Worker without blocking the main thread', async ({ page }) => {
  test.setTimeout(180_000);
  const r = await page.evaluate(async ({ base, wasm }) => {
    type Ingest = typeof import('@chromobench/ingest');
    const m = (await import(/* @vite-ignore */ `/@fs${base}index.ts`)) as Ingest;
    const w = 7728, h = 5152;
    const raw = new Uint16Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw[y * w + x] = 512 + [1000, 3000, 3000, 2000][(y & 1) * 2 + (x & 1)]! + ((x + y) & 15);
    const bytes = m.writeTiff({
      images: [{ width: w, height: h, planes: [raw], bits: 16, photometric: 32803, newSubfileType: 0, rowsPerStrip: 256, tags: [
        { tag: 33421, type: 3, values: [2, 2] }, { tag: 33422, type: 1, values: [0, 1, 1, 2] }, { tag: 50710, type: 1, values: [0, 1, 2] },
        { tag: 50714, type: 3, values: [512] }, { tag: 50717, type: 3, values: [15000] }] }],
      ifd0Tags: [{ tag: 50706, type: 1, values: [1, 4, 0, 0] }, { tag: 271, type: 2, values: 'Synth' }, { tag: 272, type: 2, values: 'Big' }, { tag: 50708, type: 2, values: 'Synth Big' },
        { tag: 50721, type: 10, values: [0.8, -0.2, -0.05, -0.4, 1.2, 0.2, -0.05, 0.15, 0.6] }, { tag: 50778, type: 3, values: [21] }],
    });
    const mb = bytes.byteLength / 2 ** 20; // measured before the buffer is transferred
    const worker = new Worker(`/@fs${base}libraw/worker-entry.ts`, { type: 'module' });
    const dec = m.workerRawDecoder(worker as never, { wasmUrl: `/@fs${wasm}` });
    let maxGap = 0;
    let last = performance.now();
    const tick = setInterval(() => { const t = performance.now(); maxGap = Math.max(maxGap, t - last); last = t; }, 10);
    const t0 = performance.now();
    const img = await dec.decode(bytes, { mode: 'scan', bin: 'cfa' });
    const ms = performance.now() - t0;
    clearInterval(tick);
    worker.terminate();
    return { ms, maxGap, w: img.width, h: img.height, g: img.planes[1]![0], mb };
  }, { base: ingest, wasm });
  console.log(`40 MP Bayer DNG (${r.mb.toFixed(0)} MiB) decoded in a Worker in ${r.ms.toFixed(0)} ms; longest main-thread gap ${r.maxGap.toFixed(0)} ms`);
  expect([r.w, r.h]).toEqual([3864, 2576]);
  expect(r.g).toBeCloseTo(3000, -1);
  expect(r.maxGap).toBeLessThan(250);
});
