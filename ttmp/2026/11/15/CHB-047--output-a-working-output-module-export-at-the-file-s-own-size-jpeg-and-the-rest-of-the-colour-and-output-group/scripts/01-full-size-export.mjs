// CHB-047 OUT-2: an export at the file's own size on the studio's GPU engine (or ?engine=reference), measured headless.
//   node 01-full-size-export.mjs <studio url> <file> [query] [nograin]   e.g. http://localhost:5571 /path/to/photo.NEF engine=gpu
// `nograin`: the film's grain off first (grain is noise drawn per pixel: at two sizes it is two different draws, so
// per-pixel differences then measure the grain, not the mapping; block means of 8 × 8 working pixels are printed too).
// Run it on a real GPU under the lock (Playwright's Chromium without SwiftShader flags gets Metal headless). It opens
// the file, exports it (1) at its own size as PNG 8-bit and (2) at the working size (Long edge = the working image's long
// side, which renders the working image itself), averages (1) down to (2)'s size by area (fractional box weights) in the
// page and prints: the times, the export's peak GPU memory (engine.memory(), the budget journal's numbers), the journal's
// memory rows, and |Δ| of the two in 8-bit levels (mean, p99, max). Prints numbers only: never the file's name.
import { chromium } from '@playwright/test';

const [url, file, query = 'engine=gpu', nograin] = process.argv.slice(2);
if (!url || !file) throw new Error('usage: 01-full-size-export.mjs <studio url> <file> [query]');
const browser = await chromium.launch({ channel: 'chromium', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.addInitScript(() => {
  const w = window;
  w.__written = {};
  const handle = (name) => ({
    name,
    async createWritable() {
      const parts = [];
      return {
        async write(d) { parts.push({ at: d.position, data: d.data.slice() }); },
        async close() {
          const n = parts.reduce((m, p) => Math.max(m, p.at + p.data.byteLength), 0);
          const buf = new Uint8Array(n);
          for (const p of parts) buf.set(p.data, p.at);
          w.__written[name] = buf;
        },
        async abort() { delete w.__written[name]; },
      };
    },
    async getFile() { return new File([w.__written[name]], name); },
    async remove() { delete w.__written[name]; },
  });
  w.showSaveFilePicker = async (o) => handle(o.suggestedName);
});
await page.goto(`${url}/?nosw&canvas2d&fresh&layout=classic&${query}`);
await page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: 120_000 });
const t0 = Date.now();
await page.setInputFiles('#file', file);
await page.waitForFunction(() => window.chromobench.studio.frames.all().length >= 1 && !/opening/.test(document.querySelector('#status')?.textContent ?? ''), null, { timeout: 300_000 });
await page.evaluate(() => window.chromobench.idle());
const openMs = Date.now() - t0;
const sizes = await page.evaluate(() => {
  const cb = window.chromobench;
  return cb.studio.engine.sizes(cb.studio.frames.get(cb.studio.current).sha);
});
if (nograin === 'nograin') {
  await page.evaluate(() => window.chromobench.set('stages.film.medium.grain.amount', 0));
  await page.evaluate(() => window.chromobench.idle());
}
const engineLabel = await page.evaluate(() => window.chromobench.studio.engine.label);
const mem = () => page.evaluate(() => window.chromobench.engine.primary.memory?.({ reset: true }) ?? null);
const exportOne = async (settings, name) => {
  await page.evaluate((s) => window.chromobench.run('output.set', s), { ...settings, name });
  await mem();
  const a = Date.now();
  const r = await page.evaluate(() => window.chromobench.run('output.export', { frames: 'current', to: 'files' }));
  return { wall: Date.now() - a, result: r[0], memory: await mem() };
};
const full = await exportOne({ format: 'png8', space: 'srgb', size: 'original' }, 'full');
const work = await exportOne({ format: 'png8', space: 'srgb', size: 'long', longPx: Math.max(sizes.working.width, sizes.working.height) }, 'working');
const jpeg = await exportOne({ format: 'jpeg', space: 'srgb', size: 'original', quality: 90 }, 'full-jpeg');
const cmp = await page.evaluate(async () => {
  const w = window.__written;
  const pixels = async (n) => {
    const bmp = await createImageBitmap(new Blob([w[n]], { type: 'image/png' }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0);
    return { w: bmp.width, h: bmp.height, d: g.getImageData(0, 0, bmp.width, bmp.height).data };
  };
  const big = await pixels('full.png'), small = await pixels('working.png');
  // area average of big onto small's grid: output pixel (x, y) covers [x·kx, (x+1)·kx) × [y·ky, (y+1)·ky) of big
  const kx = big.w / small.w, ky = big.h / small.h;
  const wts = (i, k) => {
    const a = i * k, b = (i + 1) * k, out = [];
    for (let p = Math.floor(a); p < Math.ceil(b); p++) out.push([p, Math.min(b, p + 1) - Math.max(a, p)]);
    return out;
  };
  const B = 8;
  const bw = Math.floor(small.w / B), bh = Math.floor(small.h / B);
  const avg = new Float64Array(small.w * small.h * 3);
  const hist = new Float64Array(256 * 4);
  let sum = 0, n = 0, max = 0;
  const cols = Array.from({ length: small.w }, (_, x) => wts(x, kx));
  for (let y = 0; y < small.h; y++) {
    const rows = wts(y, ky);
    for (let x = 0; x < small.w; x++) for (let c = 0; c < 3; c++) {
      let acc = 0, wsum = 0;
      for (const [py, wy] of rows) for (const [px, wx] of cols[x]) {
        acc += wy * wx * big.d[(py * big.w + px) * 4 + c];
        wsum += wy * wx;
      }
      avg[(y * small.w + x) * 3 + c] = acc / wsum;
      const d = Math.abs(acc / wsum - small.d[(y * small.w + x) * 4 + c]);
      sum += d;
      n++;
      max = Math.max(max, d);
      hist[Math.min(hist.length - 1, Math.floor(d * 4))]++;
    }
  }
  let p99 = 0, seen = 0;
  for (let i = 0; i < hist.length; i++) {
    seen += hist[i];
    if (seen >= 0.99 * n) { p99 = (i + 1) / 4; break; }
  }
  let p999 = 0;
  seen = 0;
  for (let i = 0; i < hist.length; i++) {
    seen += hist[i];
    if (seen >= 0.999 * n) { p999 = (i + 1) / 4; break; }
  }
  // 8 × 8 block means of both: grain and other per-pixel noise average out, the picture's placement and tone stay
  let bsum = 0, bmax = 0, bn = 0;
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) for (let c = 0; c < 3; c++) {
    let a = 0, b = 0;
    for (let y = by * B; y < (by + 1) * B; y++) for (let x = bx * B; x < (bx + 1) * B; x++) {
      a += avg[(y * small.w + x) * 3 + c];
      b += small.d[(y * small.w + x) * 4 + c];
    }
    const d = Math.abs(a - b) / (B * B);
    bsum += d;
    bmax = Math.max(bmax, d);
    bn++;
  }
  return { blocks8: { mean: bsum / bn, max: bmax }, big: `${big.w}×${big.h}`, small: `${small.w}×${small.h}`, mean: sum / n, p99, p999, max, sizes: Object.fromEntries(Object.entries(w).map(([k, v]) => [k, v.byteLength])) };
});
const journal = await page.evaluate(() => window.chromobench.diagnostics.journal.rows({ source: 'gpu' }).filter((r) => /GPU_(MEMORY|EVICT|OOM)/.test(r.code ?? '')).map((r) => ({ code: r.code, count: r.count, message: r.message })));
const images = await page.evaluate(() => window.chromobench.studio.engine.exportImages);
console.log(JSON.stringify({ engine: engineLabel, openMs, sizes, full, work, jpeg, cmp, journal, exportImagesAfter: images }, null, 2));
await browser.close();
