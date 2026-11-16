// CHB-047 in the studio (synthetic files only): Classic's Output module and the export at the size he chooses.
// - OUT-1: the Output panel's settings (format, colour space, size, JPEG quality, file name) are his preferences, the
//   Export button writes the photo through the save dialog, "Export N selected" writes the selected ones into a folder,
//   progress and results show in the panel; File ▸ Export… is the same form; an agent runs output.set / output.export;
// - OUT-2: on a working image smaller than the file (?long, ?refLong) "Original size" is the file's own size (decoded
//   again for the export), "Long edge" is exact, "Percentage" of the original; JPEG decodes in the browser; the export
//   at the file's size, averaged down to the working size, is the working-size print; both engines; a camera file.
// The browser's pickers are replaced by in-memory handles (headless has no dialogs): the files written land in
// window.__written, so the real path (pickers, sinks, encoders) runs.
import { expect, test, type Page } from '@playwright/test';
import { cameraDng, dng, negativeScan, tif } from './scenes.ts';
import { opened } from './support.ts';
import { syntheticPrinterProfile } from '../packages/output/test/helpers.ts';

const idle = (page: Page) => page.evaluate(() => window.chromobench.idle());
const hook = <T>(page: Page, f: string): Promise<T> => page.evaluate(`(async () => { const cb = window.chromobench; return ${f}; })()`) as Promise<T>;
const panel = (page: Page) => page.locator('.cb-output:visible').first();

/** In-memory replacements of showSaveFilePicker and showDirectoryPicker: written bytes in window.__written by name. */
const FAKE_PICKERS = () => {
  const w = window as unknown as { __written: Record<string, number[]>; __picked: string[] };
  w.__written = {};
  w.__picked = [];
  const handle = (name: string) => ({
    name,
    async createWritable() {
      let buf = new Uint8Array(0);
      return {
        async write(d: { type: string; position: number; data: Uint8Array }) {
          const end = d.position + d.data.byteLength;
          if (end > buf.length) {
            const nb = new Uint8Array(end);
            nb.set(buf);
            buf = nb;
          }
          buf.set(new Uint8Array(d.data.buffer, d.data.byteOffset, d.data.byteLength), d.position);
        },
        async close() { w.__written[name] = Array.from(buf); },
        async abort() { delete w.__written[name]; },
      };
    },
    async getFile() { return new File([new Uint8Array(w.__written[name] ?? [])], name); },
    async remove() { delete w.__written[name]; },
  });
  (window as unknown as Record<string, unknown>)['showSaveFilePicker'] = async (o: { suggestedName: string }) => {
    w.__picked.push(`file:${o.suggestedName}`);
    return handle(o.suggestedName);
  };
  (window as unknown as Record<string, unknown>)['showDirectoryPicker'] = async () => {
    w.__picked.push('folder');
    return {
      name: 'exports',
      async getFileHandle(n: string) { return handle(n); },
      async getDirectoryHandle() { throw new Error('no subfolders'); },
      async removeEntry(n: string) { delete w.__written[n]; },
    };
  };
};

async function boot(page: Page, query: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(FAKE_PICKERS);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?nosw&canvas2d&fresh&layout=classic&${query}`);
  await page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: 60_000 });
  return errors;
}

/** A written file decoded by the browser: its size and its 8-bit RGBA pixels. */
const decoded = (page: Page, name: string) =>
  page.evaluate(async (n) => {
    const bytes = new Uint8Array((window as unknown as { __written: Record<string, number[]> }).__written[n]!);
    const type = n.endsWith('.jpg') ? 'image/jpeg' : n.endsWith('.png') ? 'image/png' : 'image/tiff';
    const bmp = await createImageBitmap(new Blob([bytes], { type }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d')!;
    g.drawImage(bmp, 0, 0);
    return { width: bmp.width, height: bmp.height, rgba: Array.from(g.getImageData(0, 0, bmp.width, bmp.height).data), head: Array.from(bytes.subarray(0, 4)) };
  }, name);

/**
 * The mean, 99th percentile and largest |Δ| (8-bit levels) of `big` averaged down by k×k blocks against `small`. The
 * print is not linear, so at a hard edge (the film edge) the average of the printed pixels is not the print of the
 * averaged scan: the largest differences sit there, the percentile says how few they are.
 */
function compareDown(big: { width: number; rgba: number[] }, small: { width: number; height: number; rgba: number[] }, k: number): { mean: number; p99: number; max: number } {
  const ds: number[] = [];
  for (let y = 0; y < small.height; y++) for (let x = 0; x < small.width; x++) for (let c = 0; c < 3; c++) {
    let a = 0;
    for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) a += big.rgba[((y * k + j) * big.width + x * k + i) * 4 + c]!;
    ds.push(Math.abs(a / (k * k) - small.rgba[(y * small.width + x) * 4 + c]!));
  }
  ds.sort((a, b) => a - b);
  return { mean: ds.reduce((s, d) => s + d, 0) / ds.length, p99: ds[Math.floor(ds.length * 0.99)]!, max: ds.at(-1)! };
}

async function exportClick(page: Page, button: '#output-export' | '#output-export-selected'): Promise<void> {
  await panel(page).locator(button).click();
  await page.waitForFunction(() => window.chromobench.state().ui.export?.running === false, null, { timeout: 120_000 });
  await idle(page);
}

test('OUT-1 and OUT-2 on the GPU engine: the Output module, sizes, JPEG, the selection into a folder', async ({ page }) => {
  test.setTimeout(240_000);
  // a working image of 240 px for a 480 × 320 file: Original size is twice the working size
  const errors = await boot(page, 'engine=gpu&long=240');
  await page.setInputFiles('#file', [tif('neg-a.tif', negativeScan(480, 320)), tif('neg-b.tif', negativeScan(480, 320, { exposure: 0.5 }))]);
  await opened(page, 2, 120_000);
  await hook(page, `cb.rt.go('output')`);
  await expect(panel(page)).toBeVisible();
  const p = panel(page);
  // the defaults: JPEG, sRGB, original size, quality 90, the file's name
  await expect(p.locator('#output-format')).toHaveValue('jpeg');
  await expect(p.locator('#output-space')).toHaveValue('srgb');
  await expect(p.locator('#output-size')).toHaveValue('original');
  await expect(p.locator('#output-quality-n')).toHaveValue('90');
  await expect(p.locator('#output-long')).toBeHidden();
  const cur = await hook<string>(page, 'cb.studio.current');
  const curName = await hook<string>(page, `cb.studio.frames.get(cb.studio.current).name`);
  const stem = curName.replace(/\.tif$/, '');

  // Original size: the file's own 480 × 320, a JPEG through the save dialog
  await exportClick(page, '#output-export');
  expect(await page.evaluate(() => (window as unknown as { __picked: string[] }).__picked)).toEqual([`file:${stem}.jpg`]);
  await expect(p.locator('#output-results li')).toHaveCount(1);
  await expect(p.locator('#output-results li').first()).toContainText(`✓ ${stem}.jpg · 480 × 320 px`);
  const jpg = await decoded(page, `${stem}.jpg`);
  expect([jpg.width, jpg.height, jpg.head.slice(0, 2)]).toEqual([480, 320, [0xff, 0xd8]]);

  // Long edge 300 px, quality 80, PNG 8-bit later; settings are his preferences (not an edit: no undo step)
  const steps = await hook<number>(page, `cb.rt.store.log.entries.length`);
  await p.locator('#output-size').selectOption('long');
  await expect(p.locator('#output-long')).toBeVisible();
  await p.locator('#output-long').fill('300');
  await p.locator('#output-long').press('Enter');
  await p.locator('#output-long').blur();
  await p.locator('#output-quality-n').fill('80');
  await p.locator('#output-quality-n').blur();
  await p.locator('#output-name').fill('{name}-print-{n}');
  await p.locator('#output-name').blur();
  expect(await hook(page, 'cb.state().prefs.export')).toMatchObject({ size: 'long', longPx: 300, quality: 80, name: '{name}-print-{n}' });
  expect(await hook<number>(page, `cb.rt.store.log.entries.length`)).toBe(steps);
  await expect(p.locator('#output-sample')).toContainText(`${stem}-print-1.jpg`);
  await exportClick(page, '#output-export');
  await expect(p.locator('#output-results li').first()).toContainText(`${stem}-print-1.jpg · 300 × 200 px`);
  expect((await decoded(page, `${stem}-print-1.jpg`)).width).toBe(300);

  // the export at the file's size, averaged 2 × 2, is the working-size print (both PNG 8-bit through the pipeline)
  await p.locator('#output-format').selectOption('png8');
  await expect(p.locator('#output-quality-n')).toBeHidden();
  await p.locator('#output-size').selectOption('original');
  await p.locator('#output-name').fill('full');
  await p.locator('#output-name').blur();
  await exportClick(page, '#output-export');
  await hook(page, `cb.run('output.set', { size: 'long', longPx: 240, name: 'working' })`);
  await exportClick(page, '#output-export');
  const full = await decoded(page, 'full.png');
  const work = await decoded(page, 'working.png');
  expect([full.width, full.height, work.width, work.height]).toEqual([480, 320, 240, 160]);
  const cmp = compareDown(full, work, 2);
  console.log(`full size averaged 2×2 vs working size (8-bit levels): mean ${cmp.mean.toFixed(3)}, p99 ${cmp.p99.toFixed(2)}, max ${cmp.max.toFixed(2)}`);
  expect(cmp.mean).toBeLessThan(1.5);
  expect(cmp.p99).toBeLessThan(6);

  // Percentage: 25 % of the original (120 × 80), and the selection into one folder
  await hook(page, `cb.run('output.set', { format: 'jpeg', size: 'percent', pct: 25, name: '{name}-small' })`);
  const ids = await hook<string[]>(page, 'cb.studio.frames.all().map((e) => e.id)');
  await page.evaluate((x) => window.chromobench.rt.ctx().set({ ui: { selection: { ids: x, primary: x[0], anchor: x[0] } } }), ids);
  await expect(p.locator('#output-export-selected')).toHaveText('Export 2 selected');
  await exportClick(page, '#output-export-selected');
  expect((await page.evaluate(() => (window as unknown as { __picked: string[] }).__picked)).at(-1)).toBe('folder');
  await expect(p.locator('#output-results li')).toHaveCount(2);
  for (const n of ['neg-a-small.jpg', 'neg-b-small.jpg']) expect((await decoded(page, n)).width).toBe(120);
  await expect(p.locator('.cb-export-head')).toHaveText('Exported 2 photos');
  // OUT_SHOTS=<dir>: the module as he sees it after the export of the selection
  if (process.env['OUT_SHOTS']) await page.screenshot({ path: `${process.env['OUT_SHOTS']}/01-output-module.png` });

  // an agent: output.export to memory answers the results (nothing written), in its own settings
  const before = Object.keys(await page.evaluate(() => (window as unknown as { __written: object }).__written)).length;
  const r = await hook<{ ok: boolean; width: number; file: string }[]>(page, `cb.run('output.export', { frames: 'current', to: 'memory' })`);
  expect(r).toMatchObject([{ ok: true, width: 120, height: 80 }]);
  expect(Object.keys(await page.evaluate(() => (window as unknown as { __written: object }).__written)).length).toBe(before);
  expect(await hook(page, `cb.run('output.set', { quality: 0 })`)).toEqual({ error: 'JPEG quality must be a whole number from 1 to 100' });
  expect(await hook(page, 'cb.state().prefs.export.quality')).toBe(80);

  // File ▸ Export… is the same form, reading the same settings
  await page.locator('.ck-menubar-t', { hasText: 'File' }).click();
  await page.locator('.ck-menu-i[data-command="file.export"]').click();
  await expect(page.locator('.ck-dialog #export-format')).toHaveValue('jpeg');
  await expect(page.locator('.ck-dialog #export-size')).toHaveValue('percent');
  await expect(page.locator('.ck-dialog #export-pct')).toHaveValue('25');
  await page.locator('.ck-dialog button', { hasText: 'Cancel' }).click();
  void cur;
  expect(errors).toEqual([]);
});

test('OUT-2 on the CPU engine and with a camera file: original size decoded in the engine worker', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await boot(page, 'engine=reference&refLong=160');
  await page.setInputFiles('#file', tif('neg-c.tif', negativeScan(480, 320)));
  await opened(page, 1, 120_000);
  expect(await hook(page, `cb.studio.frames.get(cb.studio.current).info.width`)).toBe(160);
  await hook(page, `cb.run('output.set', { format: 'tiff16', space: 'display-p3', size: 'original', name: '{name}' })`);
  const t = await hook<{ ok: boolean; width: number; height: number; bits: number }[]>(page, `cb.run('output.export', { to: 'memory' })`);
  expect(t).toMatchObject([{ ok: true, width: 480, height: 320, bits: 16 }]);
  // the export images are let go afterwards: the engine's graph has the working source only
  expect(await hook<string[]>(page, `cb.studio.engine.exportImages`)).toEqual([]);
  // a camera file (LibRaw's photo mode): its original size is the demosaiced raw's
  await page.setInputFiles('#file', dng('cam.dng', cameraDng(240, 160)));
  await opened(page, 2, 120_000);
  await hook(page, `cb.run('output.set', { format: 'jpeg', space: 'srgb', size: 'long', longPx: 400 })`);
  const c = await hook<{ ok: boolean; width: number; height: number }[]>(page, `cb.run('output.export', { frames: 'current', to: 'memory' })`);
  expect(c).toMatchObject([{ ok: true, width: 400, height: Math.round(400 * 160 / 240) }]);
  expect(errors).toEqual([]);
});

test('OUT-5: a file for the printer — a printer profile added to his library, the export converted to it and the profile embedded', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await boot(page, 'engine=gpu&long=240');
  await page.setInputFiles('#file', tif('neg-p.tif', negativeScan(480, 320)));
  await opened(page, 1, 120_000);
  await hook(page, `cb.rt.go('output')`);
  const p = panel(page);
  await expect(p.locator('#output-space option', { hasText: 'Add printer profile…' })).toHaveCount(1);
  // "Add printer profile…" (the panel opens the host's file input; the test hands it the file)
  const icc = Buffer.from(syntheticPrinterProfile());
  await page.setInputFiles('#printer-profile', { name: 'inkjet-paper.icc', mimeType: 'application/vnd.iccprofile', buffer: icc });
  await page.waitForFunction(() => !!window.chromobench.state().prefs.export?.printer, null, { timeout: 60_000 });
  await expect(p.locator('#output-space')).toHaveValue(/^printer:[0-9a-f]{64}$/);
  await expect(p.locator('#output-intent')).toBeVisible();
  await expect(p.locator('#output-intent')).toHaveValue('relative');
  await expect(p.locator('#output-bpc')).toBeChecked();
  await p.locator('#output-intent').selectOption('perceptual');
  await p.locator('#output-format').selectOption('tiff16');
  expect(await hook(page, 'cb.state().prefs.export.printer')).toMatchObject({ intent: 'perceptual', bpc: true });
  await exportClick(page, '#output-export');
  await expect(p.locator('#output-results li').first()).toContainText('✓ neg-p.tif · 480 × 320 px');
  // the file carries the printer profile byte for byte (TIFF tag 34675)
  const has = await page.evaluate((profile) => {
    const b = (window as unknown as { __written: Record<string, number[]> }).__written['neg-p.tif']!;
    outer: for (let i = 0; i + profile.length <= b.length; i++) {
      for (let k = 0; k < profile.length; k++) if (b[i + k] !== profile[k]) continue outer;
      return true;
    }
    return false;
  }, Array.from(icc));
  expect(has).toBe(true);
  // back to a colour space: the printer choice goes
  await p.locator('#output-space').selectOption('srgb');
  expect(await hook(page, 'cb.state().prefs.export.printer')).toBeNull();
  await expect(p.locator('#output-intent')).toBeHidden();
  expect(errors).toEqual([]);
});
