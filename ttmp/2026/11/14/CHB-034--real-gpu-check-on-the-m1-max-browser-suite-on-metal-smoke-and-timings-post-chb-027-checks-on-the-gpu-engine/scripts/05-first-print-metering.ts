// CHB-034 task fusz: where does the first print's metered exposure differ between the engines? Opens one or more
// private files under several page configurations (engine, working size, CPU table mode, WebGPU adapter) and prints
// the first print's Time, lights and their total log10(Time) + mean(lights), the exposure each run metered.
//
//   pnpm --filter @chromobench/studio build && pnpm --filter @chromobench/studio exec vite preview --port 5641 --strictPort &
//   node ttmp/2026/11/14/CHB-034--*/scripts/05-first-print-metering.ts --base http://localhost:5641 \
//     --files photos/DSC_8559.NEF,photos/DSC_8541.NEF --runs 'metal:engine=gpu' 'cpu:engine=reference' 'sw:engine=gpu&long=640'
//
// A run is `<browser>:<query>`: browser `metal` = the installed Chrome, headed, the machine's GPU (take the GPU lock
// first); `sw` = Playwright's Chromium, headless, WebGPU on SwiftShader; `cpu` = Playwright's Chromium, headless, no
// WebGPU flags (for engine=reference). Numbers only on stdout (one JSON line per frame and run); no screenshots.
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../../../../..');
const arg = (k: string, d: string): string => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1]! : d;
};
const BASE = arg('base', 'http://localhost:5641');
const FILES = arg('files', 'photos/DSC_8559.NEF').split(',').map((f) => join(ROOT, '.playwright-mcp', f)).filter((p) => existsSync(p));
const ri = process.argv.indexOf('--runs');
const RUNS = ri > 0 ? process.argv.slice(ri + 1).filter((a) => !a.startsWith('--')) : ['metal:engine=gpu', 'cpu:engine=reference'];

async function launch(kind: string): Promise<Browser> {
  if (kind === 'metal') return chromium.launch({ channel: 'chrome', headless: false });
  if (kind === 'sw') return chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan'] });
  return chromium.launch();
}

const idle = (page: Page) => page.evaluate(async () => { await (window as any).chromobench.idle(); });
const look = (page: Page) => page.evaluate(() => {
  const cb = (window as any).chromobench;
  const p = cb.log.committed.print;
  const t = p.enlarger.time_s as number, L = p.lights.logH as number[];
  return { time_s: t, lights: L.map((x) => Number(x.toFixed(6))), total: Number((Math.log10(t) + (L[0]! + L[1]! + L[2]!) / 3).toFixed(6)), size: cb.size(), engine: cb.engineLabel };
});

for (const file of FILES) {
  const name = basename(file);
  for (const run of RUNS) {
    const [kind, query] = [run.slice(0, run.indexOf(':')), run.slice(run.indexOf(':') + 1)];
    const browser = await launch(kind);
    const t0 = Date.now();
    try {
      const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
      await page.goto(`${BASE}/?nosw&fresh&${query}`);
      await page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: 120_000 });
      await page.setInputFiles('#file', file);
      await page.waitForFunction(() => (window as any).chromobench.studio.frames.all().length >= 1 && !/opening/.test(document.querySelector('#status')?.textContent ?? ''), null, { timeout: 300_000 });
      await idle(page);
      const frames: string[] = await page.evaluate(() => {
        const s = (window as any).chromobench.state();
        return s.catalog.order.map((id: string) => s.catalog.frames[id].name);
      });
      for (let i = 0; i < frames.length; i++) {
        if (frames.length > 1) {
          await page.getByText(`${name} · ${i + 1}/${frames.length}`, { exact: true }).first().click();
          await idle(page);
        }
        console.log(JSON.stringify({ file: name, frame: `${i + 1}/${frames.length}`, run, ms: Date.now() - t0, ...(await look(page)) }));
      }
    } catch (e) {
      console.log(JSON.stringify({ file: name, run, error: String(e).slice(0, 300) }));
    } finally {
      await browser.close();
    }
  }
}
