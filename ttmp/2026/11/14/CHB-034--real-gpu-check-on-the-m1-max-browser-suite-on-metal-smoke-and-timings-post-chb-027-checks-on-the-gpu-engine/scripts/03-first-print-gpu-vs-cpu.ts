// CHB-034: the post-CHB-027 picture checks (photo first print, strip frames) on the real GPU engine, next to the
// CPU engine, in the installed Chrome (headed, Metal WebGPU) against the built app.
// Based on CHB-031 scripts/wsc-02-app-check.ts (which ran headless, CPU engine only).
//
//   pnpm --filter @chromobench/studio build && pnpm --filter @chromobench/studio exec vite preview --port 4811 --strictPort &
//   node ttmp/2026/11/14/CHB-034--*/scripts/03-first-print-gpu-vs-cpu.ts --private <scratchpad dir> [--base http://localhost:4811]
//
// Reads the photographer's files from the git-ignored .playwright-mcp/{photos,scans}/ (skips absent ones). Numbers go
// to stdout (one JSON line per frame and engine); screenshots only into --private, never into the repository.
import { existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../../../../..');
const arg = (k: string, d: string): string => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1]! : d;
};
const BASE = arg('base', 'http://localhost:4811');
const PRIV = arg('private', '');
if (!PRIV) throw new Error('--private <scratchpad dir> is required (screenshots of private photos)');
mkdirSync(PRIV, { recursive: true });

const FILES = [
  'photos/DSC_8559.NEF', // daylight truck, the easy one
  'photos/DSC_8541.NEF', // tungsten interior
  'photos/DSC_8536.NEF', // evening street
  'photos/DSC_8655.NEF', // night, fire truck, ISO 5000
  'photos/DSC_8553.NEF', // portrait, 90°
  'photos/DSC_8521.NEF', // portrait, 270°
  'photos/raw010.dng', // CHB-026's 3-frame negative strip (roll-49)
  'scans/2025-08-09_raw000.dng', // strip, 3 frames, has an NLP positive per frame
  'scans/2025-08-09_raw007.dng', // strip, likely 2 frames
  'scans/2025-10-07_roll-102_raw000.dng', // larger landscape layout
].map((f) => join(ROOT, '.playwright-mcp', f)).filter((p) => existsSync(p));

const ENGINES = ['gpu', 'reference'] as const;

async function boot(engine: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const browser = await chromium.launch({ channel: 'chrome', headless: false });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/?nosw&fresh&engine=${engine}`);
  await page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: 120_000 });
  return { page, close: async () => { if (errors.length) console.log(JSON.stringify({ engine, pageErrors: errors })); await browser.close(); } };
}
const idle = (page: Page) => page.evaluate(async () => { await (window as any).chromobench.idle(); });
async function open(page: Page, file: string): Promise<number> {
  const t = Date.now();
  await page.setInputFiles('#file', file);
  await page.waitForFunction(() => (window as any).chromobench.studio.frames.all().length >= 1 && !/opening/.test(document.querySelector('#status')?.textContent ?? ''), null, { timeout: 300_000 });
  await idle(page);
  return Date.now() - t;
}
/** the selected frame's print settings and the picture's mean Rec. 601 luma (0–255) over a 20 × 20 grid (as wsc-02) */
const look = (page: Page) => page.evaluate(() => {
  const cb = (window as any).chromobench;
  const p = cb.log.committed.print;
  const s = cb.size();
  let L = 0, n = 0;
  const rgb = [0, 0, 0];
  for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) {
    const v = cb.pixel(Math.floor((s.width * (i + 0.5)) / 20), Math.floor((s.height * (j + 0.5)) / 20));
    if (v) { L += 255 * (0.299 * v[0] + 0.587 * v[1] + 0.114 * v[2]); for (let k = 0; k < 3; k++) rgb[k] += 255 * v[k]; n++; }
  }
  const r = (x: number) => Number(x.toFixed(4));
  return {
    kind: cb.log.committed.kind, mode: p.enlarger.mode, time_s: r(p.enlarger.time_s), lights: p.lights.logH.map(r),
    auto: { method: p.lights.auto.method, alpha: p.lights.auto.alpha }, size: [s.width, s.height],
    luma: n ? Number((L / n).toFixed(1)) : null, meanRGB: n ? rgb.map((x) => Number((x / n).toFixed(1))) : null,
    orientation: cb.log.committed.view.frame.orientation, engine: cb.engineLabel,
  };
});

for (const file of FILES) {
  const name = basename(file);
  for (const engine of ENGINES) {
    const { page, close } = await boot(engine);
    try {
      const openMs = await open(page, file);
      const frames: string[] = await page.evaluate(() => {
        const s = (window as any).chromobench.state();
        return s.catalog.order.map((id: string) => s.catalog.frames[id].name);
      });
      const notes = (await page.locator('#notes').textContent())?.trim();
      for (let i = 0; i < frames.length; i++) {
        if (frames.length > 1) {
          await page.getByText(`${name} · ${i + 1}/${frames.length}`, { exact: true }).first().click();
          await idle(page);
        }
        const l = await look(page);
        console.log(JSON.stringify({ file: name, frame: `${i + 1}/${frames.length}`, engine, openMs: i === 0 ? openMs : undefined, ...l, notes: i === 0 ? notes : undefined }));
        await page.screenshot({ path: join(PRIV, `${name}-f${i + 1}-${engine}.png`) });
      }
    } catch (e) {
      console.log(JSON.stringify({ file: name, engine, error: String(e).slice(0, 400) }));
      await page.screenshot({ path: join(PRIV, `${name}-${engine}-error.png`) }).catch(() => {});
    } finally {
      await close();
    }
  }
}
