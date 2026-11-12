// CHB-027 WS-A: files open as photos or negatives without a checkbox (F1), opening an open file says so (F2), a
// frame is re-opened the other way on the frame itself and its saved recipe never crosses modes (F3, F6, F15), and
// the library survives a reload with thumbnails, a context menu and Delete (F5, F6). Synthetic files only.
import { expect, test, type Page } from '@playwright/test';
import { writeTiff } from '@chromobench/ingest';
import { opened } from './support.ts';

const W = 240, H = 160;

/** A camera DNG of a neutral daylight scene (grey ramp, a red patch): a photo. */
function photoDng(): Buffer {
  const w = 2 * W, h = 2 * H;
  const raw = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const X = x >> 1, Y = y >> 1;
    const L = 0.03 + 0.5 * (X / W) ** 2 * (1 + 0.2 * Math.sin(X * 0.7 + Y * 0.3));
    const c = X > 30 && X < 70 && Y > 90 && Y < 130 ? [0.35, 0.05, 0.05] : [L, L, L];
    const k = (y & 1) * 2 + (x & 1); // RGGB
    raw[y * w + x] = 512 + Math.round(Math.min(1, k === 0 ? c[0]! : k === 3 ? c[2]! : c[1]!) * 14000);
  }
  return Buffer.from(writeTiff({
    images: [{ width: w, height: h, planes: [raw], bits: 16, photometric: 32803, newSubfileType: 0, rowsPerStrip: 64, tags: [
      { tag: 33421, type: 3, values: [2, 2] }, { tag: 33422, type: 1, values: [0, 1, 1, 2] }, { tag: 50710, type: 1, values: [0, 1, 2] },
      { tag: 50714, type: 3, values: [512] }, { tag: 50717, type: 3, values: [15000] }] }],
    ifd0Tags: [{ tag: 50706, type: 1, values: [1, 4, 0, 0] }, { tag: 271, type: 2, values: 'Synth' }, { tag: 272, type: 2, values: 'Camera' }, { tag: 50708, type: 2, values: 'Synth Camera' },
      { tag: 50721, type: 10, values: [0.8, -0.2, -0.05, -0.4, 1.2, 0.2, -0.05, 0.15, 0.6] }, { tag: 50778, type: 3, values: [21] }],
  }));
}

/** A colour negative scan: orange base, a density ramp, a rebate band at the left. */
function negativeTiff(): Buffer {
  const base = [0.75, 0.42, 0.22];
  const planes = [0, 1, 2].map(() => new Uint16Array(W * H));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = x < 12 ? 0 : 0.15 + 1.6 * ((x - 12) / (W - 12)) * (0.6 + 0.4 * (y / H)) + 0.03 * Math.sin(x * 0.9 + y * 0.4);
    for (let k = 0; k < 3; k++) planes[k]![y * W + x] = Math.round(65535 * 0.9 * base[k]! * 10 ** -(d * [0.9, 1, 1.1][k]!));
  }
  return Buffer.from(writeTiff({ images: [{ width: W, height: H, planes, bits: 16, photometric: 2 }] }));
}

const FILES = {
  photo: { name: 'DSC_0001.dng', mimeType: 'image/x-adobe-dng', buffer: photoDng() },
  negative: { name: 'scan-007.tif', mimeType: 'image/tiff', buffer: negativeTiff() },
};

const idle = (page: Page) => page.evaluate(() => window.chromobench.idle());
const frames = (page: Page) => page.evaluate(() => window.chromobench.studio.frames.all().map((e) => ({ name: e.name, kind: e.kind, mode: e.log.state.source.decode.mode })));
const select = (page: Page, name: string) => page.evaluate((n) => window.chromobench.run('frame.select', window.chromobench.studio.frames.all().find((e) => e.name === n)!.id), name);

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
});
test.afterEach(() => expect(errors).toEqual([]));

test('photo or negative is guessed per file; re-open the other way and back; an open file says so', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/?nosw&canvas2d&fresh&engine=reference');
  await page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: 60_000 });
  await page.setInputFiles('#file', [FILES.photo, FILES.negative]);
  await opened(page, 2, 120_000);
  expect((await frames(page)).sort((a, b) => a.name.localeCompare(b.name))).toEqual([
    { name: 'DSC_0001.dng', kind: 'digital-raw', mode: 'photo' },
    { name: 'scan-007.tif', kind: 'negative-scan', mode: 'scan' },
  ]);
  // the frame's mode in the status line
  await select(page, 'scan-007.tif');
  await expect(page.locator('#frame-mode')).toHaveText('Negative');
  await expect(page.locator('#mode-hint')).toBeHidden();

  // F2: the same file again: nothing new, and the status line says so
  await page.setInputFiles('#file', FILES.negative);
  await expect(page.locator('#status')).toContainText('scan-007.tif was already open', { timeout: 30_000 });
  expect((await frames(page)).length).toBe(2);

  // F3/F6: an edit as a negative, re-open as a photo (Frame menu command), then back through the hint (F15)
  await page.evaluate(() => window.chromobench.set('print.enlarger.time_s', 14, 'Time'));
  await idle(page);
  await page.evaluate(() => window.chromobench.run('frame.reopenAsPhoto'));
  await page.waitForFunction(() => window.chromobench.log?.state.kind === 'digital-raw', null, { timeout: 60_000 });
  await idle(page);
  await expect(page.locator('#frame-mode')).toHaveText('Photo');
  await expect(page.locator('#mode-hint')).toContainText('Looks like a negative');
  await page.locator('#mode-hint').click();
  await page.waitForFunction(() => window.chromobench.log?.state.kind === 'negative-scan', null, { timeout: 60_000 });
  await idle(page);
  expect(await page.evaluate(() => window.chromobench.log!.state.print.enlarger.time_s)).toBe(14);
  await expect(page.locator('#frame-mode')).toHaveText('Negative');
});

test('the library survives a reload: thumbnails, "not open", the context menu, Delete removes', async ({ page }) => {
  test.setTimeout(180_000);
  // a database of its own for this test (not ?fresh: the reload must find the library)
  await page.goto('/?nosw&canvas2d&engine=reference');
  await page.evaluate(() => new Promise((ok) => {
    const r = indexedDB.deleteDatabase('chromobench-studio');
    r.onsuccess = r.onerror = r.onblocked = () => ok(null);
  }));
  await page.reload();
  await page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: 60_000 });
  await expect(page.locator('.ck-coll-empty:visible').first()).toContainText('No photos yet');
  await page.setInputFiles('#file', [FILES.photo, FILES.negative]);
  await opened(page, 2, 120_000);
  // the thumbnails are kept in the KV during the session and go into the catalog at the next start
  // (expect.poll, not waitForFunction: waitForFunction takes the async predicate's promise as truthy and returns at once)
  await expect.poll(() => page.evaluate(async () => {
    const st = window.chromobench.studio;
    const urls = await Promise.all(st.frames.ids().map((id) => st.kv!.get<string>('frames', `thumb:${id}`)));
    return urls.length === 2 && urls.every((u) => u?.startsWith('data:image/jpeg'));
  }), { timeout: 30_000 }).toBe(true);
  await page.waitForTimeout(1500); // the shell's autosave (debounced)
  await page.reload();
  await page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: 60_000 });
  await expect(page.locator('#status')).toContainText('2 frames in the library');
  const cells = page.locator('.cb-cell:visible');
  await expect(cells).toHaveCount(2);
  await expect(cells.first().locator('.ck-thumb-i')).toHaveAttribute('src', /^data:image\/jpeg/);
  await expect(cells.first().locator('.ck-thumb-badge')).toContainText('not open');
  // selecting one: no file handle (setInputFiles), so it asks where the file is
  await cells.first().click();
  await expect(page.locator('.ck-dialog')).toContainText('needs the file again');
  await page.locator('.ck-dialog button', { hasText: 'Not now' }).click();
  // the studio's context menu, not the browser's
  await cells.nth(1).click({ button: 'right' });
  await expect(page.getByText('Remove from Library')).toBeVisible();
  await page.keyboard.press('Escape');
  // Delete removes the selected frame from the library
  await page.locator('.ck-filmstrip:visible').first().focus();
  await page.keyboard.press('Delete');
  await expect(cells).toHaveCount(1);
});

test('the host top bar is folded into the menus: File (open, open as, export, recipe), View ▸ Layout', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?nosw&canvas2d&fresh&engine=reference');
  await page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: 60_000 });
  await expect(page.locator('#bar')).toHaveCount(0);
  await page.locator('.ck-menubar-t', { hasText: 'File' }).click();
  for (const c of ['file.open', 'file.openFolder', 'file.export', 'file.saveRecipe']) await expect(page.locator(`.ck-menu-i[data-command="${c}"]`)).toBeVisible();
  // File ▸ Open As ▸ Open as Photos: remembered, checked
  await page.locator('.ck-menu-i', { hasText: 'Open As' }).hover();
  await page.locator('.ck-menu-i[data-command="file.openAs.photo"]').click();
  expect(await page.evaluate(() => window.chromobench.state().prefs.openAs)).toBe('photo');
  // a file opened now is a photo, whatever it looks like (and the hint says so)
  await page.setInputFiles('#file', FILES.negative);
  await expect(page.locator('#frame-mode')).toHaveText('Photo', { timeout: 60_000 });
  await expect(page.locator('#mode-hint')).toContainText('Looks like a negative');
  // Export…: format and colour space in a dialog
  await page.locator('.ck-menubar-t', { hasText: 'File' }).click();
  await page.locator('.ck-menu-i[data-command="file.export"]').click();
  await expect(page.locator('.ck-dialog #export-format')).toBeVisible();
  await expect(page.locator('.ck-dialog #export-space')).toBeVisible();
  await page.locator('.ck-dialog button', { hasText: 'Cancel' }).click();
  // View ▸ Layout… lists the variants
  await page.locator('.ck-menubar-t', { hasText: 'View' }).click();
  await page.locator('.ck-menu-i[data-command="view.layout"]').click();
  await expect(page.locator('.ck-dialog')).toContainText('Darkroom');
  await page.keyboard.press('Escape');
});
