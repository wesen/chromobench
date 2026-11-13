// CHB-031 WS-D (session 03 findings): View ▸ Layout rebuilds the interface in place and the open frames stay open
// (F24); "Where is …?" closes as answered when its file opens another way (F26); Undo of a change on another frame
// shows that frame (F36); History in words, its rows keep their height and the list scrolls (F32, F33); View ▸
// Actual Pixels and the zoom readout (F34); the darkroom layout with no frame shows one empty-state text (8iv8).
// Synthetic files only; screenshots go to the test's output folder (test-results/).
import { expect, test, type Page } from '@playwright/test';
import { writeTiff } from '@chromobench/ingest';
import { opened } from './support.ts';

/** A colour negative scan: orange base, a density ramp (its slope makes each file distinct), a film edge at the left. */
function negativeTiff(slope: number): Buffer {
  const W = 240, H = 160, base = [0.75, 0.42, 0.22];
  const planes = [0, 1, 2].map(() => new Uint16Array(W * H));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = x < 12 ? 0 : 0.15 + slope * ((x - 12) / (W - 12)) * (0.6 + 0.4 * (y / H)) + 0.03 * Math.sin(x * 0.9 + y * 0.4);
    for (let k = 0; k < 3; k++) planes[k]![y * W + x] = Math.round(65535 * 0.9 * base[k]! * 10 ** -(d * [0.9, 1, 1.1][k]!));
  }
  return Buffer.from(writeTiff({ images: [{ width: W, height: H, planes, bits: 16, photometric: 2 }] }));
}
const A = { name: 'roll-d-07.tif', mimeType: 'image/tiff', buffer: negativeTiff(1.6) };
const B = { name: 'roll-d-08.tif', mimeType: 'image/tiff', buffer: negativeTiff(1.1) };
const C = { name: 'roll-d-09.tif', mimeType: 'image/tiff', buffer: negativeTiff(1.3) };

const idle = (page: Page) => page.evaluate(() => window.chromobench.idle());
const ready = (page: Page) => page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: 60_000 });
const frames = (page: Page) => page.evaluate(() => window.chromobench.studio.frames.all().length);
/** a database of its own for this test (not ?fresh: a reload must find the library) */
async function emptyLibrary(page: Page, variant = 'classic'): Promise<void> {
  await page.goto(`/?nosw&canvas2d&engine=reference&variant=${variant}`);
  await page.evaluate(() => new Promise((ok) => {
    const r = indexedDB.deleteDatabase('chromobench-studio');
    r.onsuccess = r.onerror = r.onblocked = () => ok(null);
  }));
  await page.reload();
  await ready(page);
}
const menu = async (page: Page, top: string, command: string) => {
  await page.locator('.ck-menubar-t', { hasText: top }).click();
  await page.locator(`.ck-menu-i[data-command="${command}"]`).click();
};
/** View ▸ Layout…, then the layout's button (the dialog names the other layouts by their id) */
async function layout(page: Page, id: string): Promise<void> {
  await menu(page, 'View', 'view.layout');
  await page.locator('.ck-dialog button', { hasText: new RegExp(`^${id}$`, 'i') }).click();
  await page.waitForFunction((v) => document.body.dataset['variant'] === v, id, { timeout: 30_000 });
  await idle(page);
}

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
});
test.afterEach(() => expect(errors).toEqual([]));

test('F24: View ▸ Layout keeps the open frames open, their edits and one undo history', async ({ page }, info) => {
  test.setTimeout(240_000);
  await emptyLibrary(page);
  await page.setInputFiles('#file', [A, B]);
  await opened(page, 2, 120_000);
  const sel = await page.evaluate(() => window.chromobench.studio.current);
  const t0 = await page.evaluate(() => window.chromobench.log!.committed.print.enlarger.time_s);
  await page.evaluate(() => window.chromobench.set('print.enlarger.time_s', 12.6, 'Time'));
  await idle(page);

  await layout(page, 'simple');
  expect(await frames(page)).toBe(2);
  expect(await page.evaluate(() => window.chromobench.studio.current)).toBe(sel);
  await expect(page.locator('#status')).not.toContainText('select one to open its file again');
  await expect(page.locator('#status')).toContainText('2 frames open');
  expect(new URL(page.url()).searchParams.get('variant')).toBe('simple');
  await page.locator('.cb-steps button', { hasText: 'Print' }).first().click();
  await idle(page);
  await expect(page.locator('.ck-vp:visible').first()).toHaveAttribute('data-rendered', /\d+x\d+/);
  await page.screenshot({ path: info.outputPath('f24-simple-after-switch.png') });

  await layout(page, 'darkroom');
  expect(await frames(page)).toBe(2);
  expect(await page.evaluate(() => window.chromobench.log!.committed.print.enlarger.time_s)).toBe(12.6);
  await expect(page.locator('.cb-cell:visible .ck-thumb-badge', { hasText: 'not open' })).toHaveCount(0);

  await layout(page, 'classic');
  expect(await frames(page)).toBe(2);
  // one undo history: Ctrl+Z takes back the Time set before the switches
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Control+z');
  await idle(page);
  expect(await page.evaluate(() => window.chromobench.log!.committed.print.enlarger.time_s)).toBe(t0);

  // a new frame takes the layout's enlarger mode: normalised in Simple
  await layout(page, 'simple');
  await page.setInputFiles('#file', C);
  await opened(page, 3, 120_000);
  expect(await page.evaluate(() => window.chromobench.log!.committed.print.enlarger.mode)).toBe('normalised');
});

test('F26: "Where is …?" closes as answered when its file is opened through File ▸ Open or dropped', async ({ page }) => {
  test.setTimeout(180_000);
  await emptyLibrary(page);
  await page.setInputFiles('#file', [A, B]);
  await opened(page, 2, 120_000);
  await page.waitForTimeout(1500); // the shell's autosave (debounced)
  await page.reload();
  await ready(page);
  await expect(page.locator('#status')).toContainText('2 frames in the library');
  await page.locator('.cb-cell:visible').filter({ hasText: B.name }).first().click();
  await expect(page.locator('.ck-dialog')).toContainText(`Where is ${B.name}?`);
  // not Locate: the file opened the other way
  await page.setInputFiles('#file', B);
  await opened(page, 1, 120_000);
  await expect(page.locator('.ck-dialog')).toHaveCount(0);
  expect(await page.evaluate(() => window.chromobench.studio.frames.get(window.chromobench.studio.current!)?.name)).toBe(B.name);
  // the page takes clicks again: A asks for its file, and a drop of the file answers it
  await page.locator('.cb-cell:visible').filter({ hasText: A.name }).first().click();
  await expect(page.locator('.ck-dialog')).toContainText(`Where is ${A.name}?`);
  const dt = await page.evaluateHandle(([name, b64]) => {
    const d = new DataTransfer();
    d.items.add(new File([Uint8Array.from(atob(b64!), (c) => c.charCodeAt(0))], name!, { type: 'image/tiff' }));
    return d;
  }, [A.name, A.buffer.toString('base64')]);
  await page.dispatchEvent('.ck-main', 'drop', { dataTransfer: dt });
  await opened(page, 2, 120_000);
  await expect(page.locator('.ck-dialog')).toHaveCount(0);
  expect(await page.evaluate(() => window.chromobench.studio.frames.get(window.chromobench.studio.current!)?.name)).toBe(A.name);
});

test('F36: Undo and Redo of a change on another frame show that frame; F32/F33: History in words, 30+ rows scroll', async ({ page }, info) => {
  test.setTimeout(180_000);
  await emptyLibrary(page);
  await page.setInputFiles('#file', [A, B]);
  await opened(page, 2, 120_000);
  const [a, b] = await page.evaluate(() => window.chromobench.studio.frames.all().map((e) => e.id));
  await page.evaluate((id) => window.chromobench.run('frame.select', id), a!);
  await idle(page);
  const time = page.getByLabel('Time value');
  await time.fill('14');
  await time.press('Enter');
  await idle(page);
  await page.locator('.cb-cell:visible').filter({ hasText: B.name }).first().click();
  await expect.poll(() => page.evaluate(() => window.chromobench.studio.current)).toBe(b);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Control+z');
  await expect(page.locator('.ck-toast').last()).toContainText(`Undo Time (on ${A.name})`);
  await expect.poll(() => page.evaluate(() => window.chromobench.studio.current)).toBe(a);
  await page.locator('.cb-cell:visible').filter({ hasText: B.name }).first().click();
  await expect.poll(() => page.evaluate(() => window.chromobench.studio.current)).toBe(b);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => page.evaluate(() => window.chromobench.studio.current)).toBe(a);
  await idle(page);

  // History: Rotate and times in words; then 30 more steps
  await menu(page, 'Frame', 'frame.rotateRight');
  await page.evaluate(() => window.chromobench.set('print.enlarger.time_s', 10, 'Time'));
  await idle(page);
  const hist = page.locator('#history:visible');
  await expect(hist.locator('.cb-hist-i').filter({ hasText: 'Rotated right' })).toHaveCount(1);
  await expect(hist.locator('.cb-hist-i.is-cursor')).toContainText('Time 14.0 → 10.0 s (−½ stop)');
  for (let i = 0; i < 30; i++) await page.evaluate((k) => window.chromobench.set('print.grade', 2 + (k % 4) * 0.5, 'Grade'), i);
  await idle(page);
  const rows = await hist.locator('.cb-hist-i').evaluateAll((els) => els.map((e) => ({ t: e.textContent ?? '', h: e.getBoundingClientRect().height, top: e.getBoundingClientRect().top })));
  expect(rows.length).toBeGreaterThan(30);
  for (const [i, r] of rows.entries()) {
    expect(r.h).toBeCloseTo(rows[0]!.h, 0);
    if (i) expect(r.top - rows[i - 1]!.top).toBeGreaterThanOrEqual(rows[i - 1]!.h - 0.5);
  }
  expect(rows.map((r) => r.t).join('\n')).not.toMatch(/[{}"]|view\.frame|transpose|flipH/);
  const sc = await hist.evaluate((e) => ({ top: e.scrollTop, h: e.scrollHeight, c: e.clientHeight }));
  expect(sc.h).toBeGreaterThan(sc.c);
  expect(sc.top).toBeGreaterThan(0); // the newest step is in view
  await page.locator('[data-panel="history"]:visible').first().screenshot({ path: info.outputPath('f33-history.png') });
});

test('F34: View ▸ Actual Pixels (1:1), Ctrl+Alt+0, and the zoom readout', async ({ page }) => {
  test.setTimeout(120_000);
  await emptyLibrary(page);
  await page.setInputFiles('#file', A);
  await opened(page, 1, 120_000);
  const zoom = page.locator('.ck-vp-zoom:visible').first();
  await expect(zoom).toHaveText(/^Fit · \d+ %$/);
  await page.locator('.ck-menubar-t', { hasText: 'View' }).click();
  await expect(page.locator('.ck-menu-i[data-command="view.actual"]')).toContainText('Actual Pixels (1:1)');
  await page.locator('.ck-menu-i[data-command="view.actual"]').click();
  await expect(zoom).toHaveText('100 %');
  await zoom.click();
  await expect(zoom).toHaveText(/^Fit · /);
  await page.locator('.ck-vp:visible').first().click();
  await page.keyboard.press('Control+Alt+0');
  await expect(zoom).toHaveText('100 %');
});

test('8iv8: the darkroom layout with no frame shows one empty-state text, no empty panels', async ({ page }) => {
  test.setTimeout(120_000);
  await emptyLibrary(page, 'darkroom');
  await expect(page.locator('.ck-panel:visible')).toHaveCount(1);
  await expect(page.locator('.ck-panel:visible')).toHaveAttribute('data-panel', 'enlarger');
  await expect(page.locator('.ck-panel:visible')).toContainText('No photos yet');
  await page.setInputFiles('#file', A);
  await opened(page, 1, 120_000);
  for (const p of ['history', 'enlarger', 'paper', 'exposures']) await expect(page.locator(`.ck-panel[data-panel="${p}"]`)).toBeVisible();
});
