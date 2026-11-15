// CHB-031 WS-A (F17, F19, F23): the enlarger's two modes in the studio, used through the visible controls on the
// CPU reference engine (the film and paper model; the mock engine has no optics).
// - classic (real enlarger, the default): a typed Time changes the print and comes back exactly; Lighter / Darker
//   change the time by 1/3 stop; the test strip is in seconds; a photo shows the film it is shot on, no scanner.
// - tiny and simple (normalised): Time and Aperture are hidden, Lighter / Darker move the printer lights, the
//   History never records a time; the visible mode select brings the real enlarger back.
// - no frame selected: "Select a photo to print it." instead of live sliders.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { writeTiff } from '@chromobench/ingest';

const NEG = { name: 'neg.tif', mimeType: 'image/tiff', buffer: readFileSync(new URL('../fixtures/synthetic/m1-negative-96x64.tif', import.meta.url).pathname) };
const NO_FRAME = 'Select a photo to print it.';

/** a small synthetic camera RAW (the scene of studio-photo.spec.ts: a brightness ramp and a red patch, RGGB) */
function photo(): { name: string; mimeType: string; buffer: Buffer } {
  const W = 300, H = 200;
  const w = 2 * W, h = 2 * H;
  const raw = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = x >> 1, sy = y >> 1;
    const L = 0.02 + 0.5 * (sx / W) ** 2;
    const red = sx > 30 && sx < 80 && sy > 110 && sy < 165;
    const c = (y & 1) * 2 + (x & 1);
    const v = red ? (c === 0 ? 0.35 : 0.05) : L;
    raw[y * w + x] = 512 + Math.round(v * 14000);
  }
  const bytes = writeTiff({
    images: [{ width: w, height: h, planes: [raw], bits: 16, photometric: 32803, newSubfileType: 0, rowsPerStrip: 256, tags: [
      { tag: 33421, type: 3, values: [2, 2] }, { tag: 33422, type: 1, values: [0, 1, 1, 2] }, { tag: 50710, type: 1, values: [0, 1, 2] },
      { tag: 50714, type: 3, values: [512] }, { tag: 50717, type: 3, values: [15000] }] }],
    ifd0Tags: [{ tag: 50706, type: 1, values: [1, 4, 0, 0] }, { tag: 271, type: 2, values: 'Synth' }, { tag: 272, type: 2, values: 'Camera' }, { tag: 50708, type: 2, values: 'Synth Camera' },
      { tag: 50721, type: 10, values: [0.8, -0.2, -0.05, -0.4, 1.2, 0.2, -0.05, 0.15, 0.6] }, { tag: 50778, type: 3, values: [21] }],
  });
  return { name: 'scene.dng', mimeType: 'image/x-adobe-dng', buffer: Buffer.from(bytes) };
}

const idle = (page: Page) => page.evaluate(() => window.chromobench.idle());
const enlarger = (page: Page) =>
  page.evaluate(() => {
    const cb = window.chromobench;
    return { mode: cb.get('stages.darkroom.medium.mode') as string, time: cb.get('main.params.time_s') as number, lights: [...(cb.get('lights.params.logH') as number[])] };
  });
/** mean display value over a 9×9 grid of the print's pixels */
const mean = (page: Page) =>
  page.evaluate(() => {
    const s = window.chromobench.size()!;
    let t = 0, n = 0;
    for (let i = 1; i < 10; i++) for (let j = 1; j < 10; j++) {
      const v = window.chromobench.pixel(Math.floor((s.width * i) / 10), Math.floor((s.height * j) / 10));
      if (v) { t += v[0]! + v[1]! + v[2]!; n += 3; }
    }
    return n ? t / n : NaN;
  });
const arg = (page: Page, path: string) => page.locator(`.cb-arg[data-path="${path}"]`).first();
const darkroom = (page: Page) => page.locator('.ck-panel[data-panel="controls-darkroom"]').first();
/** the document paths the frame's steps in effect set (its History) */
const paths = (page: Page) => page.evaluate(() => window.chromobench.paths());

async function boot(page: Page, layout = '', o: { keep?: boolean } = {}): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await goto(page, layout, o);
  return errors;
}
/** `keep`: the browser's own library (IndexedDB) instead of a library in memory */
async function goto(page: Page, layout = '', o: { keep?: boolean } = {}): Promise<void> {
  await page.goto(`/?nosw&canvas2d${o.keep ? '' : '&fresh'}&engine=reference${layout ? `&layout=${layout}` : ''}`);
  await page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: 60_000 });
}
async function open(page: Page, file: { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
  await page.setInputFiles('#file', file);
  await page.waitForFunction(() => !!window.chromobench.doc, null, { timeout: 120_000 });
  await idle(page);
}
async function typeTime(page: Page, v: string): Promise<void> {
  const box = arg(page, 'main.params.time_s').locator('.cb-num');
  await box.fill(v);
  await box.press('Enter');
  await idle(page);
}

test('classic: the real enlarger by default; Time changes the print; Lighter is 1/3 stop of time; the strip is in seconds', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await boot(page);
  await page.keyboard.press('d'); // the Print module, no frame yet
  await expect(darkroom(page)).toContainText(NO_FRAME);
  await expect(darkroom(page).locator('.cb-arg:visible')).toHaveCount(0);

  await open(page, NEG);
  await expect(darkroom(page)).not.toContainText(NO_FRAME);
  const e0 = await enlarger(page);
  expect(e0.mode).toBe('real');
  await expect(arg(page, 'main.params.time_s')).toBeVisible();
  await expect(arg(page, 'main.params.fstop')).toBeVisible();
  // a negative shows its film and the scanner, not the film a photo is shot on (F23)
  await expect(arg(page, 'stages.scan.medium.scanner')).toBeVisible();
  await expect(arg(page, 'stages.film.medium.stock')).toBeHidden();

  // F17: twice the time prints darker, half the time lighter, and the same time prints the same picture
  await typeTime(page, '10');
  const m10 = await mean(page);
  await typeTime(page, '20');
  const m20 = await mean(page);
  await typeTime(page, '5');
  const m5 = await mean(page);
  expect(m20).toBeLessThan(m10 - 0.02);
  expect(m5).toBeGreaterThan(m10 + 0.02);
  await typeTime(page, '10');
  expect(await mean(page)).toBeCloseTo(m10, 6);

  // the pad's Lighter / Darker: 1/3 stop of time in real mode, the lights untouched
  // (a click is a burst, like the arrow keys: it reaches the frame's log when the burst ends)
  const lights = (await enlarger(page)).lights;
  await page.getByRole('button', { name: 'Printer lights density lighter' }).first().click();
  await expect.poll(async () => (await enlarger(page)).time).toBeCloseTo(10 * 2 ** (-1 / 3), 3);
  await idle(page);
  expect((await enlarger(page)).lights).toEqual(lights);
  expect(await mean(page)).toBeGreaterThan(m10);
  await page.getByRole('button', { name: 'Printer lights density darker' }).first().click();
  await expect.poll(async () => (await enlarger(page)).time).toBeCloseTo(10, 3);
  await idle(page);

  // the test strip around 10 s: five bands 1/3 stop apart, labelled in seconds
  await page.locator('.cb-tools button, .cb-tools .ck-btn', { hasText: 'Test strip' }).first().click();
  await idle(page);
  await expect(page.locator('.cb-band-t')).toHaveText(['6.3 s', '7.94 s', '10.0 s', '12.6 s', '15.87 s']);
  expect(errors).toEqual([]);
});

test('classic: a photo prints in real mode and shows the film it is shot on, without a scanner (F17, F23)', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await boot(page);
  await open(page, photo());
  await page.keyboard.press('d');
  expect(await page.evaluate(() => (window.chromobench.doc?.stages.scan ? 'negative-scan' : 'digital-raw'))).toBe('digital-raw');
  expect((await enlarger(page)).mode).toBe('real');
  // F31: an automatic first print, density only (alpha 0): the three lights stay together, the colour is the camera's
  const auto = await page.evaluate(() => window.chromobench.get('lights.source'));
  expect(auto).toMatchObject({ method: 'integrate', alpha: 0, applied: true });
  const l = (await enlarger(page)).lights;
  expect(Math.max(...l) - Math.min(...l)).toBeLessThan(1e-5);
  await expect(arg(page, 'stages.film.medium.stock')).toBeVisible();
  await expect(arg(page, 'stages.scan.medium.scanner')).toBeHidden();
  await expect(arg(page, 'stages.scan.medium.stock')).toBeHidden();
  await expect(darkroom(page)).toContainText('A photo prints as if the scene had been shot on this film.');
  const m10 = await mean(page);
  await typeTime(page, '20');
  expect(await mean(page)).toBeLessThan(m10 - 0.02);
  expect(errors).toEqual([]);
});

test('tiny: normalised by default; Time and Aperture hidden; Lighter moves the lights; the mode select brings Time back', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await boot(page, 'tiny');
  await expect(darkroom(page)).toContainText(NO_FRAME);
  await open(page, NEG);
  const e0 = await enlarger(page);
  expect(e0.mode).toBe('normalised');
  await expect(arg(page, 'stages.darkroom.medium.mode')).toBeVisible();
  await expect(arg(page, 'main.params.time_s')).toBeHidden();
  await expect(arg(page, 'main.params.fstop')).toBeHidden();
  await expect(darkroom(page)).toContainText('so Time and Aperture are hidden');

  const m0 = await mean(page);
  await page.getByRole('button', { name: 'Printer lights density lighter' }).first().click();
  await expect.poll(async () => (await enlarger(page)).lights[0]).toBeCloseTo(e0.lights[0]! - 0.025, 6); // one printer point
  await idle(page);
  const e1 = await enlarger(page);
  expect(e1.time).toBe(e0.time);
  e1.lights.forEach((l, i) => expect(l).toBeCloseTo(e0.lights[i]! - 0.025, 6));
  expect(await mean(page)).toBeGreaterThan(m0);
  expect(await paths(page)).toContain('lights.params.logH');
  expect(await paths(page)).not.toContain('main.params.time_s');

  // the visible select: the real enlarger, with its Time and Aperture
  await arg(page, 'stages.darkroom.medium.mode').locator('select').selectOption('real');
  await idle(page);
  expect((await enlarger(page)).mode).toBe('real');
  await expect(arg(page, 'main.params.time_s')).toBeVisible();
  await expect(darkroom(page)).not.toContainText('so Time and Aperture are hidden');
  expect(errors).toEqual([]);
});

test('simple: normalised by default; its Lighter / Darker move the three printer lights by 1/3 stop', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await boot(page, 'simple');
  await open(page, NEG);
  await page.getByText('② Print').first().click();
  await idle(page);
  const e0 = await enlarger(page);
  expect(e0.mode).toBe('normalised');
  // F25: no time row that never moves (the time nudge reads "Brightness", no seconds), and the two lights rows
  // have their own titles
  const timeRow = page.locator('.cb-arg.is-nudge[data-path="main.params.time_s"]').first();
  await expect(timeRow.locator('.cb-arg-l')).toHaveText('Brightness');
  await expect(timeRow.locator('.cb-arg-v')).toHaveText('');
  await expect(timeRow).not.toContainText(/\d\s*s\b|\bst\b/);
  await expect(page.locator('.cb-arg.is-nudge[data-path="lights.params.logH"] .cb-arg-l')).toHaveText(['Warmth', 'Tint']);
  await page.screenshot({ path: test.info().outputPath('f25-simple-normalised.png') });
  const m0 = await mean(page);
  const third = Math.log10(2) / 3;
  await page.getByRole('button', { name: 'Lighter', exact: true }).first().click();
  await expect.poll(async () => (await enlarger(page)).lights[0]).toBeCloseTo(e0.lights[0]! - third, 5);
  await idle(page);
  const e1 = await enlarger(page);
  expect(e1.time).toBe(e0.time);
  e1.lights.forEach((l, i) => expect(l).toBeCloseTo(e0.lights[i]! - third, 5));
  expect(await mean(page)).toBeGreaterThan(m0);
  expect(await paths(page)).toContain('lights.params.logH');
  expect(await paths(page)).not.toContain('main.params.time_s');
  // Darker right after Lighter: the two presses coalesce into one step whose net change is nothing (no step left)
  await page.getByRole('button', { name: 'Darker', exact: true }).first().click();
  await expect.poll(async () => (await enlarger(page)).lights[0]).toBeCloseTo(e0.lights[0]!, 5);
  (await enlarger(page)).lights.forEach((l, i) => expect(l).toBeCloseTo(e0.lights[i]!, 5));
  expect(await paths(page)).not.toContain('main.params.time_s');
  expect(errors).toEqual([]);
});

test('darkroom: real by default with its mode shown; a frame saved in normalised mode keeps it and can switch (F17, F19)', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await boot(page, 'darkroom');
  const panel = page.locator('.ck-panel[data-panel="enlarger"]').first();
  // no photo yet: one empty-state text, which says how to open one; the Paper panel is not drawn (CHB-031 8iv8)
  await expect(panel).toContainText('No photos yet');
  await expect(page.locator('.ck-panel[data-panel="paper"]').first()).toBeHidden();
  await open(page, NEG);
  expect((await enlarger(page)).mode).toBe('real');
  await expect(panel).not.toContainText('No photos yet');
  await expect(panel).not.toContainText(NO_FRAME);
  await expect(page.locator('.ck-panel[data-panel="paper"]').first()).toBeVisible();
  await expect(arg(page, 'stages.darkroom.medium.mode')).toBeVisible();
  await expect(arg(page, 'main.params.time_s')).toBeVisible();

  // a frame printed in tiny (normalised) and saved, opened again in darkroom: still normalised, Time hidden
  await goto(page, 'tiny', { keep: true });
  await open(page, NEG);
  expect((await enlarger(page)).mode).toBe('normalised');
  await goto(page, 'darkroom', { keep: true });
  await open(page, NEG);
  expect((await enlarger(page)).mode).toBe('normalised');
  await expect(arg(page, 'main.params.time_s')).toBeHidden();
  await arg(page, 'stages.darkroom.medium.mode').locator('select').selectOption('real');
  await idle(page);
  expect((await enlarger(page)).mode).toBe('real');
  await expect(arg(page, 'main.params.time_s')).toBeVisible();
  expect(errors).toEqual([]);
});
