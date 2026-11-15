// CHB-035: WebGPU upload and readback cost of an rgba32float image at preview sizes, on the machine's adapter
// (headless; take the GPU lock on the shared Mac). Needs any page on localhost (a secure context), e.g. the studio's
// dev server: pnpm --filter @chromobench/studio exec vite --port 4173 --strictPort &
// Usage: node 01-gpu-readback-probe.mjs [url]
// M1 Max, 2026-11-14 (median of 6): 1500×1000 upload 5.8 / readback 6.5 ms; 3000×2000 21.8 / 26; 4000×2674 38.1 / 56.3.
import { chromium } from '@playwright/test';
const url = process.argv[2] ?? 'http://localhost:4173/';
const b = await chromium.launch({ channel: 'chromium' });
const p = await b.newPage();
await p.goto(url);
const r = await p.evaluate(async () => {
  const a = await navigator.gpu.requestAdapter(); const d = await a.requestDevice({ requiredLimits: { maxBufferSize: a.limits.maxBufferSize } });
  const out = { adapter: a.info.architecture };
  for (const [w, h] of [[1500, 1000], [3000, 2000], [4000, 2674]]) {
    const bytes = w * h * 16, tex = d.createTexture({ size: [w, h], format: 'rgba32float', usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING });
    const data = new Float32Array(w * h * 4).fill(0.5);
    const up = [], rb = [], cp = [];
    for (let i = 0; i < 8; i++) {
      await d.queue.onSubmittedWorkDone();
      let t = performance.now(); d.queue.writeTexture({ texture: tex }, data, { bytesPerRow: w * 16 }, [w, h]); await d.queue.onSubmittedWorkDone(); up.push(performance.now() - t);
      const buf = d.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      t = performance.now();
      const e = d.createCommandEncoder(); e.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: w * 16 }, [w, h]); d.queue.submit([e.finish()]);
      await buf.mapAsync(GPUMapMode.READ); const t1 = performance.now(); const f = new Float32Array(buf.getMappedRange().slice(0)); const t2 = performance.now();
      rb.push(t2 - t); cp.push(t2 - t1); buf.destroy();
    }
    const med = (x) => { x = x.slice(2).sort((a, b) => a - b); return +x[x.length >> 1].toFixed(1); };
    out[w + 'x' + h] = { MB: +(bytes / 2 ** 20).toFixed(0), uploadMs: med(up), readbackMs: med(rb), ofWhichCopyOutMs: med(cp) };
  }
  return out;
});
console.log(JSON.stringify(r, null, 1));
await b.close();
