// CHB-031 WS-B: Remove from Library never opens "Where is …?" by itself (F21); File ▸ Open As shows while it is not
// Guess and resets at the next start unless kept (F18); strip frames open upright, at the working size of a picture,
// with Rotate in the Frame menu, and a strip whose film edge lies on a thin frame takes its base from the gaps (F20).
// Synthetic files only. Screenshots go to the test's output folder (test-results/, ignored); the ones in CHB-031's
// various/ws-b/ were taken by this spec once.
import { expect, test, type Page } from '@playwright/test';
import { plantedFrames, writeTiff, writeTiff16 } from '@chromobench/ingest';
import { opened } from './support.ts';

/** A colour negative scan: orange base, a density ramp (its slope makes each file distinct), a rebate band at the left. */
function negativeTiff(slope: number): Buffer {
  const W = 240, H = 160, base = [0.75, 0.42, 0.22];
  const planes = [0, 1, 2].map(() => new Uint16Array(W * H));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = x < 12 ? 0 : 0.15 + slope * ((x - 12) / (W - 12)) * (0.6 + 0.4 * (y / H)) + 0.03 * Math.sin(x * 0.9 + y * 0.4);
    for (let k = 0; k < 3; k++) planes[k]![y * W + x] = Math.round(65535 * 0.9 * base[k]! * 10 ** -(d * [0.9, 1, 1.1][k]!));
  }
  return Buffer.from(writeTiff({ images: [{ width: W, height: H, planes, bits: 16, photometric: 2 }] }));
}

/** Three 645 frames down a strip of 120 film; the first one underexposed (thin, nearly at base). */
function stripTiff(): Buffer {
  const p = plantedFrames({ frames: 3, pxPerMm: 8, dark: [0] });
  const codes = new Uint16Array(p.rgb.length);
  for (let i = 0; i < p.rgb.length; i++) codes[i] = Math.round(65535 * Math.min(1, Math.max(0, p.rgb[i]!)));
  return Buffer.from(writeTiff16(p.w, p.h, codes));
}

const A = { name: 'scan-a.tif', mimeType: 'image/tiff', buffer: negativeTiff(1.6) };
const B = { name: 'scan-b.tif', mimeType: 'image/tiff', buffer: negativeTiff(1.1) };
const STRIP = { name: 'strip-31.tif', mimeType: 'image/tiff', buffer: stripTiff() };

const idle = (page: Page) => page.evaluate(() => window.chromobench.idle());
const ready = (page: Page) => page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: 60_000 });
/** a database of its own for this test (not ?fresh: the reload must find the library and the prefs) */
async function emptyLibrary(page: Page): Promise<void> {
  await page.goto('/?nosw&canvas2d&engine=reference');
  await page.evaluate(() => new Promise((ok) => {
    const r = indexedDB.deleteDatabase('chromobench-studio');
    r.onsuccess = r.onerror = r.onblocked = () => ok(null);
  }));
  await page.reload();
  await ready(page);
}
const menu = async (page: Page, top: string, command: string, sub?: string) => {
  await page.locator('.ck-menubar-t', { hasText: top }).click();
  if (sub) await page.locator('.ck-menu-i', { hasText: sub }).first().hover();
  await page.locator(`.ck-menu-i[data-command="${command}"]`).click();
};

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
});
test.afterEach(() => expect(errors).toEqual([]));

test('F21: Remove from Library on the open frame does not open "Where is …?" for a frame that is not open', async ({ page }) => {
  test.setTimeout(180_000);
  await emptyLibrary(page);
  await page.setInputFiles('#file', [A, B]);
  await opened(page, 2, 120_000);
  await page.waitForTimeout(1500); // the shell's autosave (debounced)
  await page.reload();
  await ready(page);
  await expect(page.locator('#status')).toContainText('2 frames in the library');
  // A again: open; B stays "not open" in the library
  await page.setInputFiles('#file', A);
  await opened(page, 1, 120_000);
  const a = await page.evaluate(() => window.chromobench.studio.current);
  expect(await page.evaluate(() => window.chromobench.studio.frames.get(window.chromobench.studio.current!)?.name)).toBe('scan-a.tif');
  // remove A as he would: right-click its cell, Remove from Library
  await page.locator('.cb-cell:visible').filter({ hasText: 'scan-a.tif' }).first().click({ button: 'right' });
  await page.getByText('Remove from Library').click();
  await expect(page.locator('.cb-cell:visible')).toHaveCount(1);
  // nothing asks for B's file: the selection did not move onto it
  await page.waitForTimeout(1500);
  await expect(page.locator('.ck-dialog')).toHaveCount(0);
  const sel = await page.evaluate(() => window.chromobench.studio.current);
  expect(sel === null || sel === '').toBe(true);
  expect(a).toBeTruthy();
  // selecting B himself still asks for its file
  await page.locator('.cb-cell:visible').first().click();
  await expect(page.locator('.ck-dialog')).toContainText('needs the file again');
});

test('F18: File ▸ Open As shows in the status line, resets at the next start, and stays when kept', async ({ page }) => {
  test.setTimeout(120_000);
  await emptyLibrary(page);
  const pill = page.locator('#open-as');
  await expect(pill).toBeHidden();
  await menu(page, 'File', 'file.openAs.photo', 'Open As');
  await expect(pill).toBeVisible();
  await expect(pill).toHaveText('Opening as photos');
  await page.waitForTimeout(1500); // autosave
  await page.reload();
  await ready(page);
  // a new start: Guess again
  expect(await page.evaluate(() => window.chromobench.state().prefs.openAs ?? 'auto')).toBe('auto');
  await expect(pill).toBeHidden();
  // kept: it survives the restart, visibly
  await menu(page, 'File', 'file.openAs.negative', 'Open As');
  await menu(page, 'File', 'file.openAs.keep', 'Open As');
  expect(await page.evaluate(() => window.chromobench.state().prefs.openAsKeep)).toBe(true);
  await page.waitForTimeout(1500);
  await page.reload();
  await ready(page);
  await expect(pill).toHaveText('Opening as negatives');
  await page.screenshot({ path: test.info().outputPath('02-open-as-pill.png') });
  // the pill is a way back to Guess
  await pill.click();
  await expect(pill).toBeHidden();
  expect(await page.evaluate(() => window.chromobench.state().prefs.openAs)).toBe('auto');
});

test('F20: strip frames open upright at a picture\'s working size; Frame ▸ Rotate; the base from the gaps', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/?nosw&canvas2d&fresh&engine=reference');
  await ready(page);
  await page.setInputFiles('#file', STRIP);
  await opened(page, 3, 120_000);
  const frames = await page.evaluate(() => {
    const s = window.chromobench.state() as any;
    return s.catalog.order.map((id: string) => ({ id, name: s.catalog.frames[id].name, crop: s.recipes[id].view.frame.crop, orientation: s.recipes[id].view.frame.orientation }));
  });
  expect(frames.map((f: { name: string }) => f.name)).toEqual(['strip-31.tif · 1/3', 'strip-31.tif · 2/3', 'strip-31.tif · 3/3']);
  // wide frames on a vertical strip, scanned through the base and upside down: mirrored top to bottom by default (F28)
  for (const f of frames) expect(f.orientation).toBe('flipV');
  // each frame at about a picture's working size (the strip is 1108 px long: its frames get their own pixels, not
  // a third of 640 px)
  for (const f of frames) expect(Math.max(f.crop.w, f.crop.h)).toBeGreaterThan(400);
  // the first frame is thin, so the film edge found lies on it: the base comes from the gaps between the frames
  const notes = await page.evaluate(() => [...(window.chromobench.engine as any).notes.values()].flatMap((n: { notes: string[] }) => n.notes).join(' | '));
  expect(notes).toMatch(/from the gaps between frames/);
  await page.getByText('strip-31.tif · 2/3', { exact: true }).first().click();
  await idle(page);
  // the decode note says where the base was read (ko8e), not "film edge found"
  await expect(page.locator('#notes')).toContainText('strip of 3 frames, film base read between the frames');
  await page.screenshot({ path: test.info().outputPath('01-synthetic-strip-frame2-upright.png') });
  // Frame ▸ Rotate Right, then Rotate Left: back as it was
  const orientation = () => page.evaluate(() => (window.chromobench.state() as any).recipes[window.chromobench.studio.current!].view.frame.orientation);
  await menu(page, 'Frame', 'frame.rotateRight');
  await idle(page);
  expect(await orientation()).toBe('transpose');
  await page.screenshot({ path: test.info().outputPath('03-synthetic-strip-frame2-rotated.png') });
  await menu(page, 'Frame', 'frame.rotateLeft');
  await idle(page);
  expect(await orientation()).toBe('flipV');
});
