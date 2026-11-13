// CHB-031 round 2 WS-C: the built app, driven like a user (headless Chromium, CPU engine, a fresh library).
//
//   pnpm --filter @chromobench/studio build && pnpm --filter @chromobench/studio preview --port 4711 --strictPort &
//   node ttmp/2026/11/12/CHB-031--*/scripts/wsc-02-app-check.ts [--base http://localhost:4711] [--private <scratchpad dir>]
//
// Synthetic files (screenshots into the ticket's various/ws-c/):
//   A  classic: a synthetic camera RAW (a brightness ramp and a red patch) opens through a first print (F31): its
//      time, lights and auto record, and the mean luma of the picture;
//   B  simple: a synthetic negative, ② Print: the time row reads "Brightness" with no seconds, the lights rows
//      "Warmth" and "Tint" (F25); Lighter once;
//   C  classic: a synthetic 3-frame strip of 645 frames: each frame's orientation (flipV, F28) and the decode note
//      (ko8e).
// --private <dir>: the photographer's DSC_8559.NEF and Epson strip 2025-08-09_raw000.dng as well (skipped when absent):
//   numbers to stdout, screenshots only into <dir> (a scratchpad folder), never into the repository.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../../../../..');
const MAIN = join(ROOT, '..', '..', '..');
const SHOTS = join(HERE, '../various/ws-c');
const arg = (k: string, d: string): string => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1]! : d;
};
const BASE = arg('base', 'http://localhost:4711');
const PRIV = arg('private', '');
mkdirSync(SHOTS, { recursive: true });

const { plantedFrames, writeTiff, writeTiff16 } = await import(join(ROOT, 'packages/ingest/src/index.ts'));

/** the synthetic camera RAW of e2e/studio-enlarger.spec.ts (a brightness ramp and a red patch, RGGB) */
function photo(): { name: string; mimeType: string; buffer: Buffer } {
  const W = 300, H = 200, w = 2 * W, h = 2 * H;
  const raw = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = x >> 1, sy = y >> 1;
    const L = 0.02 + 0.5 * (sx / W) ** 2;
    const red = sx > 30 && sx < 80 && sy > 110 && sy < 165;
    const c = (y & 1) * 2 + (x & 1);
    raw[y * w + x] = 512 + Math.round((red ? (c === 0 ? 0.35 : 0.05) : L) * 14000);
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
/** three 645 frames down a strip of 120 film, the first underexposed (e2e/studio-open-strips.spec.ts) */
function strip(): { name: string; mimeType: string; buffer: Buffer } {
  const p = plantedFrames({ frames: 3, pxPerMm: 8, dark: [0] });
  const codes = new Uint16Array(p.rgb.length);
  for (let i = 0; i < p.rgb.length; i++) codes[i] = Math.round(65535 * Math.min(1, Math.max(0, p.rgb[i]!)));
  return { name: 'strip-31.tif', mimeType: 'image/tiff', buffer: Buffer.from(writeTiff16(p.w, p.h, codes)) };
}
const NEG = { name: 'neg.tif', mimeType: 'image/tiff', buffer: readFileSync(join(ROOT, 'fixtures/synthetic/m1-negative-96x64.tif')) };

const idle = (page: Page) => page.evaluate(async () => {
  await (window as any).chromobench.idle();
});
async function boot(variant = ''): Promise<{ page: Page; close: () => Promise<void> }> {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto(`${BASE}/?nosw&fresh&canvas2d&engine=reference${variant ? `&variant=${variant}` : ''}`);
  await page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: 120_000 });
  return { page, close: () => browser.close() };
}
async function open(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }, frames = 1): Promise<number> {
  const t = Date.now();
  await page.setInputFiles('#file', file);
  await page.waitForFunction((n) => (window as any).chromobench.studio.frames.all().length >= n && !/opening/.test(document.querySelector('#status')?.textContent ?? ''), frames, { timeout: 300_000 });
  await idle(page);
  return Date.now() - t;
}
/** the selected frame's print settings and the picture's mean Rec. 601 luma (0–255) over a 20 × 20 grid */
const look = (page: Page) => page.evaluate(() => {
  const cb = (window as any).chromobench;
  const p = cb.log.committed.print;
  const s = cb.size();
  let L = 0, n = 0;
  for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) {
    const v = cb.pixel(Math.floor((s.width * (i + 0.5)) / 20), Math.floor((s.height * (j + 0.5)) / 20));
    if (v) { L += 255 * (0.299 * v[0] + 0.587 * v[1] + 0.114 * v[2]); n++; }
  }
  return { kind: cb.log.committed.kind, mode: p.enlarger.mode, time_s: p.enlarger.time_s, lights: p.lights.logH, auto: { method: p.lights.auto.method, alpha: p.lights.auto.alpha }, luma: n ? Number((L / n).toFixed(1)) : null, orientation: cb.log.committed.view.frame.orientation };
});
const notes = (page: Page) => page.locator('#notes').textContent();

// A: classic, a synthetic photo
{
  const { page, close } = await boot();
  const ms = await open(page, photo());
  console.log('A classic, synthetic photo:', JSON.stringify({ openMs: ms, ...(await look(page)) }));
  await page.screenshot({ path: join(SHOTS, 'wsc-01-classic-synthetic-photo-first-print.png') });
  await close();
}
// B: simple, a synthetic negative, ② Print
{
  const { page, close } = await boot('simple');
  await open(page, NEG);
  await page.getByText('② Print').first().click();
  await idle(page);
  const titles = await page.locator('.cb-arg.is-nudge .cb-arg-l').allTextContents();
  const timeRow = await page.locator('.cb-arg.is-nudge[data-path="print.enlarger.time_s"]').first().textContent();
  console.log('B simple, synthetic negative:', JSON.stringify({ titles, timeRow, ...(await look(page)) }));
  await page.getByRole('button', { name: 'Lighter', exact: true }).first().click();
  await page.waitForTimeout(1200);
  await idle(page);
  console.log('B after Lighter:', JSON.stringify(await look(page)));
  await page.screenshot({ path: join(SHOTS, 'wsc-02-simple-print-brightness-warmth-tint.png') });
  await close();
}
// C: classic, a synthetic strip
{
  const { page, close } = await boot();
  await open(page, strip(), 3);
  const frames = await page.evaluate(() => {
    const s = (window as any).chromobench.state();
    return s.catalog.order.map((id: string) => `${s.catalog.frames[id].name}: ${s.recipes[id].view.frame.orientation}`);
  });
  await page.getByText('strip-31.tif · 2/3', { exact: true }).first().click();
  await idle(page);
  console.log('C classic, synthetic strip:', JSON.stringify({ frames, notes: await notes(page) }));
  await page.screenshot({ path: join(SHOTS, 'wsc-03-classic-synthetic-strip-flipV-note.png') });
  await close();
}
// D: the photographer's files (numbers only; screenshots only into --private)
if (PRIV) {
  mkdirSync(PRIV, { recursive: true });
  const nef = join(homedir(), 'Downloads/2026-11-11 - manfred test bilder/DSC_8559.NEF');
  const dng = [join(ROOT, '.playwright-mcp/scans/2025-08-09_raw000.dng'), join(MAIN, '.playwright-mcp/scans/2025-08-09_raw000.dng')].find((p) => existsSync(p));
  if (existsSync(nef)) {
    const { page, close } = await boot();
    const ms = await open(page, nef);
    console.log('D classic, DSC_8559.NEF:', JSON.stringify({ openMs: ms, ...(await look(page)) }));
    await page.screenshot({ path: join(PRIV, 'app-DSC_8559.png') });
    await close();
  } else console.log('D: DSC_8559.NEF absent, skipped');
  if (dng) {
    const { page, close } = await boot();
    const ms = await open(page, dng, 3);
    await page.getByText('2025-08-09_raw000.dng · 2/3', { exact: true }).first().click();
    await idle(page);
    const frames = await page.evaluate(() => {
      const s = (window as any).chromobench.state();
      return s.catalog.order.map((id: string) => s.recipes[id].view.frame.orientation);
    });
    console.log('D classic, raw000.dng frame 2:', JSON.stringify({ openMs: ms, frames, notes: await notes(page), ...(await look(page)) }));
    await page.screenshot({ path: join(PRIV, 'app-raw000-f2.png') });
    await close();
  } else console.log('D: 2025-08-09_raw000.dng absent, skipped');
}
