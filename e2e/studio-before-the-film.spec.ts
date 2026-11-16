// CHB-048 in the studio on the WebGPU engine (SwiftShader in CI), synthetic files only:
// - LAY-1 (D2): a camera file opens with its raw's as-shot white balance; Classic's Print shows the White balance panel
//   (preset, Temperature, Tint, Pick a neutral); a preset is one undo step; the eyedropper makes the clicked grey
//   neutral and disarms; picking it again changes nothing; a negative says why it has no white balance;
// - Darkroom first's "Before the film" palette carries the same controls; agents set it with scene.whiteBalance.
import { expect, test, type Page } from '@playwright/test';
import { writeTiff } from '@chromobench/ingest';
import { negativeScan, tif } from './scenes.ts';
import { opened } from './support.ts';

const W = 300, H = 200;
const idle = (page: Page) => page.evaluate(() => window.chromobench.idle());
const hook = <T>(page: Page, f: string): Promise<T> => page.evaluate(`(() => { const cb = window.chromobench; return ${f}; })()`) as Promise<T>;
const panel = (page: Page, id: string) => page.locator(`.ck-panel[data-panel="${id}"]:visible`).first();
const vp = (page: Page) => page.locator('.ck-vp:visible').first();
const wbNow = (page: Page) => hook<{ temperature_K: number; tint: number }>(page, 'cb.doc.stages.scene.medium.whiteBalance');

/** A grey card under a warm light (a small red patch on the right) as an RGGB DNG with an as-shot neutral. */
function warmCardDng(): Buffer {
  const w = 2 * W, h = 2 * H;
  const raw = new Uint16Array(w * h);
  // the card's camera RGB under the light (its as-shot neutral scaled): warm, more red than blue
  const card = [0.3, 0.36, 0.2];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const red = x > w * 0.85 && y > h * 0.4 && y < h * 0.6;
    const c = red ? [0.4, 0.06, 0.05] : card;
    const k = (y & 1) * 2 + (x & 1); // RGGB
    raw[y * w + x] = 512 + Math.round((k === 0 ? c[0]! : k === 3 ? c[2]! : c[1]!) * 14000);
  }
  return Buffer.from(writeTiff({
    images: [{ width: w, height: h, planes: [raw], bits: 16, photometric: 32803, newSubfileType: 0, rowsPerStrip: 256, tags: [
      { tag: 33421, type: 3, values: [2, 2] }, { tag: 33422, type: 1, values: [0, 1, 1, 2] }, { tag: 50710, type: 1, values: [0, 1, 2] },
      { tag: 50714, type: 3, values: [512] }, { tag: 50717, type: 3, values: [15000] }] }],
    ifd0Tags: [{ tag: 50706, type: 1, values: [1, 4, 0, 0] }, { tag: 271, type: 2, values: 'Synth' }, { tag: 272, type: 2, values: 'Camera' }, { tag: 50708, type: 2, values: 'Synth Camera' },
      { tag: 50721, type: 10, values: [0.8, -0.2, -0.05, -0.4, 1.2, 0.2, -0.05, 0.15, 0.6] }, { tag: 50778, type: 3, values: [21] },
      // AsShotNeutral: the camera's white balance was set for a light a little warmer than the card's
      { tag: 50728, type: 5, values: [0.75, 1, 0.62] }],
  }));
}

async function boot(page: Page, layout: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/?nosw&canvas2d&fresh&engine=gpu&layout=${layout}`);
  await page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: 60_000 });
  return errors;
}
/** opens the warm card: the studio asks photo or negative (warm everywhere, no film edge); he says photos */
async function openCard(page: Page): Promise<void> {
  await page.setInputFiles('#file', { name: 'card.dng', mimeType: 'image/x-adobe-dng', buffer: warmCardDng() });
  await page.getByRole('button', { name: 'Photos from a camera' }).click({ timeout: 60_000 });
  await opened(page, 1, 120_000);
}
const centre = (page: Page) => page.evaluate(() => { const s = window.chromobench.size()!; return window.chromobench.pixel(Math.floor(s.width / 2), Math.floor(s.height / 2))!; });

test('LAY-1 in Classic: as shot by default, presets and undo, the eyedropper makes the card neutral; a negative says why', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await boot(page, 'classic');
  await openCard(page);
  expect(await hook(page, 'cb.rt.module')).toBe('print');

  // the raw's as-shot white is the document's white balance, and the picker says so
  const asShot = await hook<{ temperature_K: number; tint: number }>(page, 'cb.state().catalog.frames[cb.state().ui.selection.primary].asShot');
  expect(asShot.temperature_K).toBeGreaterThan(2000);
  const wb0 = await wbNow(page);
  expect(Math.abs(wb0.temperature_K - asShot.temperature_K)).toBeLessThan(0.01);
  const p = panel(page, 'white-balance');
  await expect(p).toBeVisible();
  const select = p.locator('.cb-preset select');
  await expect(select).toHaveValue('as-shot');
  await expect(p.locator('.cb-arg[data-path="stages.scene.medium.whiteBalance.temperature_K"]')).toBeVisible();
  await expect(p.locator('.cb-arg[data-path="stages.scene.medium.whiteBalance.tint"]')).toBeVisible();
  const before = await centre(page);

  // Tungsten: one step, the picture cools; undo gives the as-shot picture back
  await select.selectOption('tungsten');
  await idle(page);
  expect(await wbNow(page)).toEqual({ temperature_K: 2850, tint: 0 });
  const cooled = await centre(page);
  expect(cooled[2]! - cooled[0]!).toBeGreaterThan(before[2]! - before[0]! + 0.05);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('ControlOrMeta+z');
  await idle(page);
  expect((await wbNow(page)).temperature_K).toBeCloseTo(wb0.temperature_K, 3);
  await expect(select).toHaveValue('as-shot');

  // Pick a neutral: the tool arms, a click on the card makes its colour neutral and the tool goes
  await p.locator('button', { hasText: 'Pick a neutral' }).click();
  expect(await hook(page, 'cb.state().ui.tool')).toBe('white-balance');
  const b = (await vp(page).boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForFunction((t) => Math.abs((window.chromobench.get('stages.scene.medium.whiteBalance.temperature_K') as number) - t) > 1, wb0.temperature_K, { timeout: 30_000 });
  await idle(page);
  expect(await hook(page, 'cb.state().ui.tool ?? null')).toBeNull();
  const picked = await wbNow(page);
  await expect(select).toHaveValue('');
  // the card prints more neutral than as shot (its channels closer together)
  const spread = (v: number[]) => Math.max(v[0]!, v[1]!, v[2]!) - Math.min(v[0]!, v[1]!, v[2]!);
  const after = await centre(page);
  expect(spread(after)).toBeLessThan(spread(before));
  // picking the same card again keeps it (the agent's way: a document point)
  await hook(page, `cb.run('scene.whiteBalance', { at: [${W}, ${H}] })`);
  await idle(page);
  const again = await wbNow(page);
  expect(Math.abs(again.temperature_K - picked.temperature_K)).toBeLessThan(15);
  expect(Math.abs(again.tint - picked.tint)).toBeLessThan(1);

  // a negative: the panel says why there is no white balance, and the command refuses
  await page.setInputFiles('#file', tif('neg.tif', negativeScan(240, 160)));
  await opened(page, 2, 120_000);
  await expect(p.locator('.cb-wb')).toHaveCount(0);
  await expect(p).toContainText('A negative has no white balance before the film');
  expect(errors).toEqual([]);
});

test('LAY-1 in Darkroom first: the Before the film palette; an agent sets the white balance in Lightroom\'s units', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await boot(page, 'darkroom');
  await openCard(page);
  const p = panel(page, 'before-film');
  await expect(p).toBeVisible();
  await expect(p.locator('.cb-preset select')).toHaveValue('as-shot');
  // the agent's command (the DSL's wb.run reaches the same table), in auto mode: one step, the picker follows
  await hook(page, `cb.run('agent.mode', 'auto')`);
  const r = await page.evaluate(() => window.chromobench.eval("return JSON.stringify(await wb.run('scene.whiteBalance', { temperature_K: 6500, tint: 10 }))") as Promise<{ yaml: string; error?: unknown }>);
  expect(r.error, r.yaml).toBeUndefined();
  await idle(page);
  expect(await wbNow(page)).toEqual({ temperature_K: 6500, tint: 10 });
  await expect(p.locator('.cb-preset select')).toHaveValue('cloudy');
  expect(errors).toEqual([]);
});
