// CHB-023: the photographer's file types through packages/ingest in the studio, on the GPU engine:
// a deflate-compressed 16-bit RGB TIFF, a 16-bit PNG and a Bayer DNG that LibRaw decodes in its worker
// (scan mode, CFA-binned). Each is a synthetic colour negative (orange mask, a grey ramp, a rebate
// band on the left) so the first print has something to balance.
import { expect, test, type Page } from '@playwright/test';
import { writePng, writeTiff } from '@chromobench/ingest';

const W = 1200, H = 800;

/** Transmittance of a synthetic negative: base (mask) × image density ramp, rebate at x < 40. */
function negative(): [Uint16Array, Uint16Array, Uint16Array] {
  const base = [0.75, 0.42, 0.22];
  const planes = [0, 1, 2].map(() => new Uint16Array(W * H)) as [Uint16Array, Uint16Array, Uint16Array];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = x < 40 ? 0 : 0.15 + 1.6 * ((x - 40) / (W - 40)) * (0.6 + 0.4 * (y / H));
      for (let k = 0; k < 3; k++) planes[k]![y * W + x] = Math.round(65535 * 0.9 * base[k]! * 10 ** -(d * [0.9, 1, 1.1][k]!));
    }
  }
  return planes;
}

function bayerDng(): Uint8Array {
  const [r, g, b] = negative();
  const w = 2 * W, h = 2 * H;
  const raw = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y >> 1) * W + (x >> 1);
      const c = (y & 1) * 2 + (x & 1); // RGGB
      const v = c === 0 ? r[i]! : c === 3 ? b[i]! : g[i]!;
      raw[y * w + x] = 512 + Math.round((v / 65535) * 14000);
    }
  }
  return writeTiff({
    images: [{ width: w, height: h, planes: [raw], bits: 16, photometric: 32803, newSubfileType: 0, rowsPerStrip: 256, tags: [
      { tag: 33421, type: 3, values: [2, 2] }, { tag: 33422, type: 1, values: [0, 1, 1, 2] }, { tag: 50710, type: 1, values: [0, 1, 2] },
      { tag: 50714, type: 3, values: [512] }, { tag: 50717, type: 3, values: [15000] }] }],
    ifd0Tags: [{ tag: 50706, type: 1, values: [1, 4, 0, 0] }, { tag: 271, type: 2, values: 'Synth' }, { tag: 272, type: 2, values: 'Scanner' }, { tag: 50708, type: 2, values: 'Synth Scanner' },
      { tag: 50721, type: 10, values: [0.8, -0.2, -0.05, -0.4, 1.2, 0.2, -0.05, 0.15, 0.6] }, { tag: 50778, type: 3, values: [21] }],
  });
}

const FILES = {
  tiff: () => ({ name: 'neg-16bit.tif', mimeType: 'image/tiff', buffer: Buffer.from(writeTiff({ images: [{ width: W, height: H, planes: negative(), bits: 16, compression: 'deflate', predictor: 2, photometric: 2 }] })) }),
  png: () => ({ name: 'neg-16bit.png', mimeType: 'image/png', buffer: Buffer.from(writePng({ width: W, height: H, planes: negative(), bits: 16, chromobenchEncoding: 'linear' })) }),
  dng: () => ({ name: 'neg-bayer.dng', mimeType: 'image/x-adobe-dng', buffer: Buffer.from(bayerDng()) }),
};

let pageErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
});
test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

const idle = (page: Page) => page.evaluate(() => window.chromobench.idle());

for (const [kind, make] of Object.entries(FILES)) {
  test(`${kind}: decoded by ingest, conditioned, printed on the GPU engine`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto('/?nosw&canvas2d&engine=gpu');
    await expect(page.locator('#engine')).toContainText('GPU', { timeout: 60_000 });
    await page.setInputFiles('#file', make());
    await expect(page.locator('#status')).toContainText('rendered', { timeout: 120_000 });
    await idle(page);
    await expect(page.locator('#notes')).toContainText(kind === 'dng' ? 'camera RAW (Synth Scanner) via LibRaw' : kind.toUpperCase());
    await expect(page.locator('#notes')).toContainText('base');
    const r = await page.evaluate(() => ({ w: window.chromobench.studio.session!.width, h: window.chromobench.studio.session!.height, auto: window.chromobench.log!.state.print.lights.auto.method }));
    expect(r).toEqual({ w: W, h: H, auto: 'integrate' });
    // the ramp prints: denser negative (right) → lighter print
    const left = (await page.evaluate(() => window.chromobench.pixel(200, 400)))!;
    const right = (await page.evaluate(() => window.chromobench.pixel(1100, 400)))!;
    expect(right[1]!).toBeGreaterThan(left[1]!);
  });
}
