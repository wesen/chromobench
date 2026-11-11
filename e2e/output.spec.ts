// CHB-011 in headless Chromium: the display canvas configuration, an export through a real OPFS sink
// (written, read back, aborted), and lcms running in its module worker. The modules are loaded from
// the studio's dev server through Vite's /@fs/ path (the workspace root is allowed).
import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const fsPath = (rel: string): string => '/@fs' + fileURLToPath(new URL(rel, import.meta.url));
const CANVAS = fsPath('../packages/output/src/display/canvas.ts');
const OUTPUT = fsPath('../packages/output/src/index.ts');
const WORKER = fsPath('../packages/output/src/icc/lcms/worker.ts');

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('/');
});

test('configureCanvas: rgba16float in the display gamut; reconfigures to display-p3 when (color-gamut: p3) starts to match', async ({ page }) => {
  const r = await page.evaluate(async (path) => {
    const m = await import(path);
    const device = await (await navigator.gpu.requestAdapter())!.requestDevice();
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 4;
    let fire = (): void => undefined;
    const media = { matches: false, addEventListener: (_t: string, f: () => void) => { fire = f; }, removeEventListener: () => undefined };
    const changes: string[] = [];
    const cfg = m.configureCanvas(c, device, { matchMedia: () => media, onChange: (s: string) => changes.push(s) });
    const ctx = c.getContext('webgpu') as GPUCanvasContext & { getConfiguration?: () => { colorSpace?: string; format?: string } | null };
    const draw = async (): Promise<string> => {
      try {
        const tex = ctx.getCurrentTexture();
        const enc = device.createCommandEncoder();
        enc.beginRenderPass({ colorAttachments: [{ view: tex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 1, g: 1, b: 1, a: 1 } }] }).end();
        device.queue.submit([enc.finish()]);
        await device.queue.onSubmittedWorkDone();
        return tex.format;
      } catch (e) { return 'error: ' + (e as Error).message; }
    };
    const first = { space: cfg.space, format: cfg.format, configured: ctx.getConfiguration?.()?.colorSpace ?? null, drawn: await draw() };
    media.matches = true;
    fire();
    const second = { space: cfg.space, configured: ctx.getConfiguration?.()?.colorSpace ?? null, drawn: await draw() };
    cfg.dispose();
    return { first, second, changes, actual: m.displaySpace() };
  }, CANVAS);
  console.log(JSON.stringify(r));
  expect(r.first.space).toBe('srgb');
  expect(r.first.format).toBe('rgba16float');
  expect(r.second.space).toBe('display-p3');
  expect(r.changes).toEqual(['display-p3']);
  if (r.first.configured !== null) expect([r.first.configured, r.second.configured]).toEqual(['srgb', 'display-p3']);
  // Canvas presentation is unavailable in headless Chromium on SwiftShader: every getCurrentTexture()
  // fails with "A valid external Instance reference no longer exists", whatever the format, tone
  // mapping or whether the canvas is attached (probed). Where it works, the texture is rgba16float.
  for (const d of [r.first.drawn, r.second.drawn]) expect(d).toMatch(/^rgba16float$|external Instance reference/);
});

test('export into OPFS: a PNG16 written through opfsSink reads back; an aborted TIFF leaves no file', async ({ page }) => {
  const r = await page.evaluate(async (path) => {
    const m = await import(path);
    const w = 32, h = 16;
    const px = new Uint16Array(w * h * 3).map((_, i) => (i * 337) & 0xffff);
    const sink = await m.opfsSink('chb011-test/a.png');
    const pw = await m.Png16Writer.open(sink, { width: w, height: h, colour: m.pngColour(m.getSpace('display-p3'), 'icc+cicp'), dpi: 300 });
    await pw.writeRows(px, h);
    await pw.finish();
    await sink.close();
    const file = await sink.file();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const types = m.pngChunks(bytes).map((c: { type: string }) => c.type);
    const t = await m.opfsSink('chb011-test/b.tif');
    const tw = await m.Tiff16Writer.open(t, { width: w, height: h, compression: 'deflate', icc: m.getSpace('prophoto').icc });
    await tw.writeRows(px, h / 2);
    await t.abort();
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('chb011-test');
    const names: string[] = [];
    for await (const k of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(k);
    await root.removeEntry('chb011-test', { recursive: true });
    return { size: file.size, sinkSize: sink.size, types, names, picker: m.pickerAvailable() };
  }, OUTPUT);
  console.log(JSON.stringify(r));
  expect(r.size).toBe(r.sinkSize);
  expect(r.types).toEqual(expect.arrayContaining(['IHDR', 'cICP', 'iCCP', 'pHYs', 'IDAT', 'IEND']));
  expect(r.names).toEqual(['a.png']);
});

test('lcms in its module worker: opens the bundled profiles and converts sRGB white to the D50 PCS', async ({ page }) => {
  const r = await page.evaluate(async ([out, worker]) => {
    const m = await import(out);
    const l = await m.lcmsInWorker(new Worker(worker, { type: 'module' }));
    const h = await l.open(m.getSpace('srgb').icc);
    const xyz = await l.openXYZ();
    const t = await l.transform(h, xyz, { intent: 'relative', bpc: false, in: 'RGB_16', out: 'XYZ_FLT' });
    const white = Array.from(await l.run(t, new Uint16Array([65535, 65535, 65535]), 1) as Float32Array);
    const info = await l.info(h);
    let refused = '';
    try { await l.open(new Uint8Array(200)); } catch (e) { refused = (e as Error).message; }
    l.dispose();
    return { version: l.version, white, info, refused };
  }, [OUTPUT, WORKER] as const);
  console.log(JSON.stringify(r));
  expect(r.version).toBe(2160);
  expect(r.info.colourSpace).toBe('RGB');
  expect(Math.abs(r.white[0]! - 0.9642)).toBeLessThan(1e-3);
  expect(Math.abs(r.white[1]! - 1)).toBeLessThan(1e-3);
  expect(Math.abs(r.white[2]! - 0.8249)).toBeLessThan(1e-3);
  expect(r.refused).toMatch(/E_ICC_INVALID/);
});
