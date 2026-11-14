// CHB-034: the precision of the hardware texture filter's weights, on the machine's own adapter and on SwiftShader.
// A 2 × 1 texture holds 0 and 1; sampling where texel 1 should get weight w returns w as the hardware quantises it.
// Usage: node 04-filter-precision.mjs [url]   (any page on localhost, a secure context; default http://localhost:4173/)
// Result on the M1 Max (2026-11-14): Metal 257 distinct weights, max error 1/512 (8 bits); SwiftShader exact (6e-8).
import { chromium } from '@playwright/test';
const url = process.argv[2] ?? 'http://localhost:4173/';
const modes = { metal: [], swiftshader: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan'] };
for (const [name, args] of Object.entries(modes)) {
  const b = await chromium.launch({ channel: 'chromium', args });
  const p = await b.newPage();
  await p.goto(url);
  const r = await p.evaluate(async () => {
    const a = await navigator.gpu.requestAdapter();
    const feats = a.features.has('float32-filterable') ? ['float32-filterable'] : [];
    const d = await a.requestDevice({ requiredFeatures: feats });
    const out = {};
    for (const fmt of ['rgba16float', ...(feats.length ? ['rgba32float'] : [])]) {
      const tex = d.createTexture({ size: [2, 1], format: fmt, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      const data = fmt === 'rgba32float' ? new Float32Array([0,0,0,0, 1,1,1,1]) : new Uint16Array([0,0,0,0, 0x3c00,0x3c00,0x3c00,0x3c00]);
      d.queue.writeTexture({ texture: tex }, data, { bytesPerRow: data.byteLength }, [2, 1]);
      const N = 4096;
      const buf = d.createBuffer({ size: N * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      const rd = d.createBuffer({ size: N * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      const code = `@group(0) @binding(0) var t: texture_2d<f32>; @group(0) @binding(1) var s: sampler;
        @group(0) @binding(2) var<storage, read_write> o: array<f32>;
        @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
          let w = f32(id.x) / ${N - 1}.0;            // wanted weight of texel 1
          let u = (0.5 + w) / 2.0;                   // texel centres at 0.25 and 0.75
          o[id.x] = textureSampleLevel(t, s, vec2f(u, 0.5), 0.0).r - w; }`;
      const pipe = d.createComputePipeline({ layout: 'auto', compute: { module: d.createShaderModule({ code }), entryPoint: 'main' } });
      const bg = d.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [
        { binding: 0, resource: tex.createView() }, { binding: 1, resource: d.createSampler({ magFilter: 'linear', minFilter: 'linear' }) }, { binding: 2, resource: { buffer: buf } }] });
      const e = d.createCommandEncoder(); const c = e.beginComputePass(); c.setPipeline(pipe); c.setBindGroup(0, bg); c.dispatchWorkgroups(N / 64); c.end();
      e.copyBufferToBuffer(buf, 0, rd, 0, N * 4); d.queue.submit([e.finish()]);
      await rd.mapAsync(GPUMapMode.READ); const err = new Float32Array(rd.getMappedRange().slice(0));
      let mx = 0; for (const v of err) mx = Math.max(mx, Math.abs(v));
      const got = new Set(); for (let i = 0; i < N; i++) got.add(Math.round((err[i] + i / (N - 1)) * 1e6));
      out[fmt] = { maxWeightError: mx, distinctWeights: got.size, bitsImplied: Math.log2(got.size - 1).toFixed(2) };
    }
    return { adapter: a.info.architecture || a.info.vendor, out };
  });
  console.log(name, JSON.stringify(r));
  await b.close();
}
