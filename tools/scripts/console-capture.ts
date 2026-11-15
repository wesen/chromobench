// Opens the running studio headless on the machine's own GPU (no SwiftShader flags), loads synthetic files, walks a few
// modules, and prints every console error/warning, page error and failed request, grouped and counted.
//   node tools/scripts/console-capture.ts [url] [--swiftshader] [--sequence] [--files a.NEF b.dng …]
// --files opens local files instead of the synthetic scenes (local only: nothing is uploaded, only messages printed).
// --sequence (CHB-038) opens the files one after the other, as the owner did, with edits between them (the main
// exposure's time a few times, then the next file), and prints the studio's diagnostics journal (warnings and errors).
// Headless only: a headed window takes the owner's focus. Synthetic material only (e2e/scenes.ts).
import { chromium } from '@playwright/test';
import { cameraDng, dng, negativeScan, tif } from '../../e2e/scenes.ts';
const fileArgs = process.argv.includes('--files') ? process.argv.slice(process.argv.indexOf('--files') + 1) : [];

const url = process.argv.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:4173/?layout=classic&fresh';
const swift = process.argv.includes('--swiftshader');
const sequence = process.argv.includes('--sequence');
const args = swift ? ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan'] : [];
// channel 'chromium': the full build in new headless mode (the stripped headless shell has no WebGPU)
const browser = await chromium.launch({ headless: true, channel: 'chromium', args });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const seen = new Map<string, number>();
const note = (kind: string, text: string) => {
  const key = `${kind}: ${text.replace(/\s+/g, ' ').slice(0, 400)}`;
  seen.set(key, (seen.get(key) ?? 0) + 1);
};
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') note(`console.${m.type()}`, m.text()); });
page.on('pageerror', (e) => note('pageerror', `${e.message}\n${(e.stack ?? '').split('\n').slice(0, 3).join(' | ')}`));
page.on('requestfailed', (r) => note('requestfailed', `${r.url()} ${r.failure()?.errorText ?? ''}`));
const pause = (ms: number) => page.waitForTimeout(ms);

await page.goto(url);
await pause(3000);
const adapter = await page.evaluate(async () => {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<{ info?: Record<string, string> } | null> } }).gpu;
  const a = gpu ? await gpu.requestAdapter() : null;
  return a ? JSON.stringify(a.info ?? {}) : 'no adapter';
});
console.log(`adapter: ${adapter}`);
type Hook = { idle(): Promise<void>; set(p: string, v: unknown, l?: string): void; studio: { frames: { all(): unknown[] } }; diagnostics?: { journal: { text(f: object): string } } };
const files = fileArgs.length ? fileArgs : [tif('neg.tif', negativeScan(600, 400)), dng('camera.dng', cameraDng(400, 266))];
if (sequence) {
  let n = 0;
  for (const f of files) {
    n++;
    await page.setInputFiles('#file', [f] as never);
    await page.waitForFunction((k) => (window as unknown as { chromobench: Hook }).chromobench.studio.frames.all().length >= k, n, { timeout: 120_000 });
    await page.evaluate(() => (window as unknown as { chromobench: Hook }).chromobench.idle());
    for (const t of [12, 9, 15, 11, 14]) {
      await page.evaluate((v) => (window as unknown as { chromobench: Hook }).chromobench.set('main.params.time_s', v, 'Time'), t);
      await pause(400);
    }
    await pause(3000);
    console.log(`opened and edited file ${n}`);
  }
  await pause(5000);
} else {
  await page.setInputFiles('#file', files as never);
  await pause(fileArgs.length ? 25000 : 8000);
}
for (const key of ['d', 'e', 'f', 'g']) { await page.keyboard.press(key); await pause(2500); }
const journal = await page.evaluate(() => (window as unknown as { chromobench: Hook }).chromobench.diagnostics?.journal.text({ level: 'warn' }) ?? '(no journal)');
console.log(`journal (warnings and errors):\n${journal}`);
await page.goto(url.replace(/layout=[a-z]+/, 'layout=darkroom'));
await pause(6000);
await browser.close();

console.log(`\n${seen.size} distinct messages`);
for (const [k, n] of [...seen.entries()].sort((a, b) => b[1] - a[1])) console.log(`×${n}  ${k}`);
