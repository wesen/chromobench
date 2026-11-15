// CHB-038: diagnostics and problem reports in the studio. The badge appears on a WebGPU error and a repeat
// increments its count; a report holds exactly the parts he chose; a report reopens with its documents and history;
// the journal survives a reload; the agent reads it with wb.diagnostics(); and the owner's WebGPU error ("Destroyed
// texture [Texture (unlabeled 160x107 px, RGBA32Float)] used in a submit", a thumbnail's grain racing the viewer's)
// does not come back. Synthetic files only (e2e/scenes.ts).
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { unzip } from '../packages/output/src/encode/zip.ts';
import { cameraDng, dng, negativeScan, tif } from './scenes.ts';
import { opened } from './support.ts';

const ready = (page: Page) => page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: 90_000 });
const idle = (page: Page) => page.evaluate(() => window.chromobench.idle());
type Row = { level: string; source: string; code?: string; message: string; count: number; session: string };
const rows = (page: Page, f: Record<string, unknown> = {}) => page.evaluate((x) => window.chromobench.diagnostics.journal.rows(x as never) as Row[], f);

let pageErrors: string[] = [];
test.beforeEach(({ page }) => {
  pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
});
test.afterEach(() => expect(pageErrors).toEqual([]));

test('the badge appears on a WebGPU error; a repeat increments it; Diagnostics shows one row ×2', async ({ page }) => {
  await page.goto('/?nosw&fresh&engine=reference');
  await ready(page);
  await expect(page.locator('#diag-badge')).toBeHidden();
  const inject = () => page.evaluate(() => {
    const d = window.chromobench.diagnostics.devices()[0];
    if (!d) throw new Error('no WebGPU device for the viewer');
    // the owner's kind of error: a destroyed texture used in a submit (reported through the device's uncapturederror)
    const t = d.createTexture({ label: 'test.injected', size: [4, 4], format: 'rgba8unorm', usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST });
    const u = d.createTexture({ size: [4, 4], format: 'rgba8unorm', usage: GPUTextureUsage.COPY_DST });
    t.destroy();
    const enc = d.createCommandEncoder();
    enc.copyTextureToTexture({ texture: t }, { texture: u }, [4, 4]);
    d.queue.submit([enc.finish()]);
  });
  await inject();
  await expect(page.locator('#diag-badge')).toHaveText('1 problem');
  await inject();
  await expect(page.locator('#diag-badge')).toHaveText('2 problems');
  const gpu = (await rows(page, { level: 'error', source: 'gpu' }));
  expect(gpu).toHaveLength(1);
  expect(gpu[0]).toMatchObject({ code: 'GPU_VALIDATION', count: 2 });
  expect(gpu[0]!.message).toMatch(/^presenter: validation error: Destroyed texture \[Texture "test\.injected"\] used in a submit/);
  await page.locator('#diag-badge').click();
  const row = page.locator('#diagnostics-rows li[data-level="error"][data-source="gpu"]');
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-count', '2');
  await expect(row.locator('.cb-diag-n')).toHaveText('×2');
  // he looked: the badge is quiet until the next error
  await expect(page.locator('#diag-badge')).toBeHidden();
});

test('a report holds exactly the parts he chose', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?nosw&canvas2d&fresh&engine=reference');
  await ready(page);
  await page.setInputFiles('#file', [tif('scan-007.tif', negativeScan(240, 160))]);
  await opened(page);
  await page.evaluate(() => window.chromobench.set('main.params.time_s', 14, 'Time'));
  await idle(page);
  // Help ▸ Report a Problem… (the command's promise ends with the dialog: not awaited)
  await page.evaluate(() => void window.chromobench.run('diagnostics.report'));
  const dlg = page.locator('.ck-dialog', { hasText: 'Report a Problem' });
  await expect(dlg).toBeVisible();
  await dlg.locator('#report-description').fill('the print went dark after the time change');
  await expect(dlg.locator('#report-documents')).toBeChecked();
  await expect(dlg.locator('#report-pictures')).toBeChecked();
  await expect(dlg.locator('#report-originals')).not.toBeChecked();
  await dlg.locator('#report-pictures').uncheck();
  await dlg.locator('#report-originals').check();
  const [dl] = await Promise.all([page.waitForEvent('download'), dlg.getByRole('button', { name: 'Save the report…' }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^chromobench-report-\d{4}-\d\d-\d\d-\d{4}-[a-z0-9]+\.zip$/);
  const files = unzip(new Uint8Array(readFileSync((await dl.path())!)));
  const id = await page.evaluate(() => window.chromobench.studio.current!);
  const sha = await page.evaluate(() => window.chromobench.doc!.source.sha256);
  expect([...files.keys()].sort()).toEqual([
    'README.txt', 'environment.json', `frames/${id}/document.json`, `frames/${id}/history.json`, 'journal.json', 'journal.txt',
    `originals/${sha.slice(0, 8)}-scan-007.tif`, 'report.json', 'settings.json', 'view.json',
  ].sort());
  const m = JSON.parse(new TextDecoder().decode(files.get('report.json')));
  expect(m.parts).toEqual(['environment', 'journal', 'settings', 'documents', 'originals']);
  expect(m.description).toBe('the print went dark after the time change');
  expect(new TextDecoder().decode(files.get('README.txt'))).toMatch(/the print went dark/);
  const env = JSON.parse(new TextDecoder().decode(files.get('environment.json')));
  expect(env.browser.userAgent).toMatch(/Chrome/);
  expect(env.app.commit).toBeTruthy();
});

test('a report reopens with its documents and history', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/?nosw&canvas2d&fresh&engine=reference');
  await ready(page);
  await page.setInputFiles('#file', [tif('scan-012.tif', negativeScan(240, 160, { exposure: 0.4 }))]);
  await opened(page);
  await page.evaluate(() => window.chromobench.set('main.params.time_s', 13, 'Time'));
  await page.evaluate(() => window.chromobench.set('main.params.time_s', 16, 'Time'));
  await idle(page);
  const before = await page.evaluate(() => ({ labels: window.chromobench.entries().map((e) => e.label), time: window.chromobench.get('main.params.time_s') }));
  const bytes = await page.evaluate(async () => Array.from((await window.chromobench.diagnostics.build({ description: 'reopen me', parts: ['documents', 'pictures', 'originals'] })).bytes));
  // the owner's studio: nothing open, nothing saved
  await page.goto('/?nosw&canvas2d&fresh&engine=reference');
  await ready(page);
  expect(await page.evaluate(() => window.chromobench.studio.frames.all().length)).toBe(0);
  await page.evaluate((b) => window.chromobench.diagnostics.openReport(new Uint8Array(b)), bytes);
  const view = page.locator('#report-view');
  await expect(view).toBeVisible();
  await expect(view).toContainText('reopen me');
  await expect(view.locator('.cb-report-frame img')).toHaveCount(1);
  await view.locator('#report-open').click();
  await opened(page);
  const after = await page.evaluate(() => ({ labels: window.chromobench.entries().map((e) => e.label), time: window.chromobench.get('main.params.time_s'), name: window.chromobench.studio.frames.all()[0]!.name }));
  expect(after).toEqual({ ...before, name: 'scan-012.tif' });
  expect(await page.evaluate(() => window.chromobench.diagnostics.opened?.manifest.description)).toBe('reopen me');
});

test('the journal survives a reload: the earlier session is kept', async ({ page }) => {
  await page.goto('/?nosw&canvas2d&engine=reference');
  await ready(page);
  const session = await page.evaluate(() => {
    const j = window.chromobench.diagnostics.journal;
    j.error('engine', 'synthetic failure before the reload', { code: 'TEST_RELOAD' });
    return j.session;
  });
  // saved a second after the change (and when the page is hidden)
  await page.waitForTimeout(1600);
  await page.reload();
  await ready(page);
  const kept = await rows(page, { text: 'synthetic failure before the reload' });
  expect(kept).toHaveLength(1);
  expect(kept[0]).toMatchObject({ session, code: 'TEST_RELOAD', level: 'error' });
  expect(await page.evaluate(() => window.chromobench.diagnostics.journal.session)).not.toBe(session);
  // the badge counts this session's errors only
  await expect(page.locator('#diag-badge')).toBeHidden();
});

test('the agent reads the journal: wb.diagnostics()', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?nosw&canvas2d&fresh&engine=reference');
  await ready(page);
  await page.evaluate(() => {
    const j = window.chromobench.diagnostics.journal;
    j.error('gpu', 'engine: validation error: synthetic', { code: 'GPU_VALIDATION' });
    j.error('gpu', 'engine: validation error: synthetic', { code: 'GPU_VALIDATION' });
  });
  const r = await page.evaluate(() => window.chromobench.eval("const d = await wb.diagnostics({ level: 'warn', source: 'gpu' })\nreturn JSON.stringify({ rows: d.rows.map((r) => r.code + ' x' + r.count), errors: d.totals.error, ua: d.environment.browser.summary, text: (await wb.diagnostics().explain()).split('\\n')[0] })") as Promise<{ yaml: string; error?: unknown }>);
  expect(r.error).toBeUndefined();
  const line = r.yaml.split('\n')[0]!;
  const v = JSON.parse(line.startsWith("'") ? line.slice(1, -1).replace(/''/g, "'") : line);
  expect(v.rows).toEqual(['GPU_VALIDATION x2']);
  expect(v.errors).toBeGreaterThanOrEqual(2);
  expect(v.ua).toMatch(/^Chrome \d+ on /);
  expect(v.text).toMatch(/^journal · session /);
});

test('regression (the owner\'s WebGPU error): thumbnails and the viewer render grain at different sizes at once, no destroyed texture is submitted', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/?nosw&canvas2d&fresh&engine=gpu&layout=classic&long=600');
  await ready(page);
  // as the owner: a camera file, edits, then a second camera file
  await page.setInputFiles('#file', [dng('DSC_0001.dng', cameraDng(240, 160))]);
  await opened(page);
  for (const t of [12, 9, 15]) await page.evaluate((v) => window.chromobench.set('main.params.time_s', v, 'Time'), t);
  await idle(page);
  await page.setInputFiles('#file', [dng('DSC_0002.dng', cameraDng(200, 150))]);
  await opened(page, 2);
  // and, deterministically, the race itself: each frame's print (film.grain runs on camera files) at a thumbnail's
  // size and the viewer's, started together, several times
  await page.evaluate(async () => {
    const s = window.chromobench.studio;
    for (let round = 0; round < 4; round++) {
      const jobs: Promise<unknown>[] = [];
      for (const e of s.frames.all()) {
        for (const side of [160, 420, 161 + round]) {
          const h = { $: 'cb.image', frame: e.id, doc: s.doc(e.id), what: 'print', args: {}, expr: 'frame.print()' };
          jobs.push(s.bridge.render(h as never, { slot: `t${side}`, epoch: round, lane: 'bg', pass: 'screen', maxSide: side, signal: new AbortController().signal }));
        }
      }
      await Promise.all(jobs);
    }
  });
  await idle(page);
  await page.waitForTimeout(500);
  const gpu = await rows(page, { level: 'warn', source: 'gpu' });
  expect(gpu.map((r) => `${r.code} ×${r.count} ${r.message}`)).toEqual([]);
  // the engine device reported itself; its textures are labelled (an error would name the owner)
  const dev = await rows(page, { source: 'gpu', text: 'engine device' });
  expect(dev.length).toBeGreaterThan(0);
});

test('regression (the owner\'s WebGPU error), the interleaving itself: a ones texture handed to a pass stays valid while another size is asked', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?nosw&canvas2d&fresh&engine=gpu&long=600');
  await ready(page);
  const r = await page.evaluate(async () => {
    type Tex = { width: number; height: number; createView(): unknown };
    const g = (window.chromobench.engine as unknown as { primary: { runtime: { device: GPUDevice; busy<T>(f: () => Promise<T>): Promise<T>; retiring: number }; film: { ones(like: { width: number; height: number }): Promise<Tex> } } }).primary;
    const rt = g.runtime;
    const dev = rt.device;
    const errors: string[] = [];
    dev.addEventListener('uncapturederror', (e) => errors.push((e as GPUUncapturedErrorEvent).error.message));
    let retiring = 0;
    await rt.busy(async () => {
      // render A (a 160×107 thumbnail) takes its texture of ones and awaits its pipeline...
      const a = await g.film.ones({ width: 160, height: 107 });
      // ...meanwhile renders at other sizes ask for theirs (the viewer, other thumbnails)
      for (const [w, h] of [[900, 600], [640, 427], [480, 320], [320, 213], [1200, 800]]) await g.film.ones({ width: w!, height: h! });
      retiring = rt.retiring;
      // ...then A submits a command buffer that uses its texture (a copy of ones into it: its content stays ones)
      const src = dev.createTexture({ label: 'test.ones', size: [160, 107], format: 'rgba32float', usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST });
      dev.queue.writeTexture({ texture: src }, new Float32Array(160 * 107 * 4).fill(1), { bytesPerRow: 160 * 16 }, [160, 107]);
      const enc = dev.createCommandEncoder();
      enc.copyTextureToTexture({ texture: src }, { texture: a as unknown as GPUTexture }, [160, 107]);
      dev.queue.submit([enc.finish()]);
      await dev.queue.onSubmittedWorkDone();
      src.destroy();
    });
    await dev.queue.onSubmittedWorkDone();
    await new Promise((ok) => setTimeout(ok, 200));
    return { errors, retiring, after: rt.retiring };
  });
  // before the fix: "Destroyed texture [Texture (unlabeled 160x107 px, TextureFormat::RGBA32Float)] used in a submit"
  expect(r.errors).toEqual([]);
  expect(r.retiring).toBeGreaterThan(0);
  expect(r.after).toBe(0);
});
