// CHB-012: a digital camera RAW opened as a photo — LibRaw photo mode (demosaiced, camera colour), the
// forward path (source.xyz → capture.expose → film.couple → film.halation → film.develop → film.grain)
// on the GPU engine, printed through the same paper model as a negative scan.
import { expect, test } from '@playwright/test';
import { writeTiff } from '@chromobench/ingest';
import { opened } from './support.ts';

const W = 600, H = 400;

/** Scene light in camera RGB: a left-to-right brightness ramp with a red object. */
function scene(): [Uint16Array, Uint16Array, Uint16Array] {
  const planes = [0, 1, 2].map(() => new Uint16Array(W * H)) as [Uint16Array, Uint16Array, Uint16Array];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const L = 0.02 + 0.5 * (x / W) ** 2;
    let c = [L, L, L];
    if (x > 60 && x < 160 && y > 220 && y < 330) c = [0.35, 0.05, 0.05];
    for (let k = 0; k < 3; k++) planes[k]![y * W + x] = Math.round(65535 * Math.min(1, c[k]!));
  }
  return planes;
}

function bayerDng(): Uint8Array {
  const [r, g, b] = scene();
  const w = 2 * W, h = 2 * H;
  const raw = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y >> 1) * W + (x >> 1);
    const c = (y & 1) * 2 + (x & 1); // RGGB
    raw[y * w + x] = 512 + Math.round(((c === 0 ? r[i]! : c === 3 ? b[i]! : g[i]!) / 65535) * 14000);
  }
  return writeTiff({
    images: [{ width: w, height: h, planes: [raw], bits: 16, photometric: 32803, newSubfileType: 0, rowsPerStrip: 256, tags: [
      { tag: 33421, type: 3, values: [2, 2] }, { tag: 33422, type: 1, values: [0, 1, 1, 2] }, { tag: 50710, type: 1, values: [0, 1, 2] },
      { tag: 50714, type: 3, values: [512] }, { tag: 50717, type: 3, values: [15000] }] }],
    ifd0Tags: [{ tag: 50706, type: 1, values: [1, 4, 0, 0] }, { tag: 271, type: 2, values: 'Synth' }, { tag: 272, type: 2, values: 'Camera' }, { tag: 50708, type: 2, values: 'Synth Camera' },
      { tag: 50721, type: 10, values: [0.8, -0.2, -0.05, -0.4, 1.2, 0.2, -0.05, 0.15, 0.6] }, { tag: 50778, type: 3, values: [21] }],
  });
}

test('a camera RAW is guessed to be a photo, shot on film and printed on the GPU engine', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?nosw&canvas2d&fresh&engine=gpu');
  await expect(page.locator('#engine')).toHaveAttribute('data-engine', /GPU/, { timeout: 60_000 });
  await page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: 60_000 });
  // CHB-027: no "photo" checkbox any more; the studio guesses (no orange mask, no film edge: a photo)
  await page.setInputFiles('#file', { name: 'scene.dng', mimeType: 'image/x-adobe-dng', buffer: Buffer.from(bayerDng()) });
  await opened(page, 1, 120_000);
  await expect(page.locator('#notes')).toHaveAttribute('title', /photo: camera RAW \(Synth Camera\) via LibRaw, photo mode/);
  await expect(page.locator('#notes')).toContainText('Synth Camera photo');
  const s = await page.evaluate(() => ({ kind: window.chromobench.log!.state.kind, stock: window.chromobench.log!.state.capture?.stock, w: window.chromobench.size()!.width }));
  expect(s).toEqual({ kind: 'digital-raw', stock: 'kodak_portra_400', w: 2 * W }); // demosaiced at the sensor resolution
  // brighter scene → brighter print along the ramp; the red object prints red
  const dark = (await page.evaluate(() => window.chromobench.pixel(120, 200)))!;
  const bright = (await page.evaluate(() => window.chromobench.pixel(1120, 200)))!;
  expect(bright[1]!).toBeGreaterThan(dark[1]! + 0.2);
  const red = (await page.evaluate(() => window.chromobench.pixel(220, 550)))!;
  expect(red[0]!).toBeGreaterThan(red[1]! + 0.1);
  expect(errors).toEqual([]);
});
