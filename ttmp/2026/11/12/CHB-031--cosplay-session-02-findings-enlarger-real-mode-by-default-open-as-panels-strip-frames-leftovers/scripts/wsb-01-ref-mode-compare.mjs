// CHB-031 WS-B (F10): does the reference engine's 'tabulated' mode show the same picture as 'exact'?
//
//   pnpm --filter @chromobench/studio build && pnpm --filter @chromobench/studio preview --port 4811 --strictPort &
//   node ttmp/2026/11/12/CHB-031--*/scripts/wsb-01-ref-mode-compare.mjs [--base http://localhost:4811]
//        [--modes exact,tabulated] [--query refLong=768] [--out result.json]
//
// Per mode, in a fresh page (?nosw&fresh&canvas2d&engine=reference&refMode=<mode>): open the D750 NEF (a photo) and
// raw010.dng (a strip; its first frame is shown), wait for every render, and read the main viewer's presented image
// (display-encoded floats). The first mode's print settings are then copied into the later modes' frames (so the
// automatic first print cannot differ), and the images are compared pixel by pixel in 8-bit steps: mean, p99, max of
// |Δ| over R, G, B. Only numbers leave the page; the private files are read in place and the script skips (exit 0)
// when they are absent.
import { existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const BASE = arg('base', 'http://localhost:4811');
const MODES = arg('modes', 'exact,tabulated').split(',');
const EXTRA = arg('query', '');
const OUT = arg('out', '');
const NEF = arg('nef', join(homedir(), 'Downloads/2026-11-11 - manfred test bilder/DSC_8559.NEF'));
const DNG = arg('dng', join(homedir(), 'Downloads/raw010.dng'));
const files = [NEF, DNG].filter((f) => existsSync(f));
if (!files.length) {
  console.log('skipped: private test files absent');
  process.exit(0);
}

const idle = (page) => page.evaluate(async () => {
  await window.chromobench.idle();
  while (window.chromobench.rt.renders.busy()) await new Promise((r) => setTimeout(r, 100));
  await window.chromobench.idle();
});

/** The shown image of the visible main viewer, as plain arrays (display-encoded), and the selected frame's print. */
const grab = (page) => page.evaluate(() => {
  const cb = window.chromobench;
  const vps = [...cb.rt.viewports.values()].filter((v) => v.el.isConnected && v.el.offsetParent !== null);
  const img = vps.map((v) => v.shown().image).filter(Boolean).sort((a, b) => b.width * b.height - a.width * a.height)[0];
  const id = cb.studio.current;
  const r = cb.state().recipes[id];
  return {
    id, print: r.print, size: img ? `${img.width}×${img.height}` : null,
    region: img?.region, scale: img?.scale, channels: img?.channels, width: img?.width, height: img?.height,
    data: img ? Array.from(img.data, (v) => Math.round(Number(v) * 4095) / 4095) : null,
  };
});

async function open(page, file) {
  const name = file.split('/').pop();
  await page.setInputFiles('#file', file);
  await page.waitForFunction((n) => {
    const s = document.querySelector('#status')?.textContent ?? '';
    const st = window.chromobench.studio;
    return /E_|error|failed/i.test(s) || (!/opening/.test(s) && st.frames.get(st.current)?.name.startsWith(n));
  }, name, { timeout: 300_000, polling: 100 });
  await idle(page);
}

async function run(mode, prints) {
  const browser = await chromium.launch({ channel: 'chromium' });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  await page.goto(`${BASE}/?nosw&fresh&canvas2d&engine=reference&refMode=${mode}${EXTRA ? `&${EXTRA}` : ''}`);
  await page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: 120_000 });
  const label = await page.locator('#engine').textContent();
  const out = { mode, label, shots: {} };
  for (const f of files) {
    const key = f === NEF ? 'nef' : 'dng';
    const t = Date.now();
    await open(page, f);
    const auto = await grab(page);
    let same = auto;
    if (prints?.[key]) {
      await page.evaluate((p) => window.chromobench.set('print', p, 'same print'), prints[key]);
      await idle(page);
      same = await grab(page);
    }
    out.shots[key] = { ms: Date.now() - t, auto, same };
  }
  await browser.close();
  return out;
}

function diff(a, b) {
  if (!a?.data || !b?.data || a.width !== b.width || a.height !== b.height) return { comparable: false, a: a?.size, b: b?.size };
  const c = a.channels;
  const d = [];
  for (let i = 0; i < a.width * a.height; i++) for (let k = 0; k < 3; k++) d.push(Math.abs(a.data[i * c + k] - b.data[i * c + k]) * 255);
  d.sort((x, y) => x - y);
  const mean = d.reduce((s, v) => s + v, 0) / d.length;
  return { comparable: true, size: a.size, meanAbs8: +mean.toFixed(3), p99Abs8: +d[Math.floor(0.99 * d.length)].toFixed(2), maxAbs8: +d.at(-1).toFixed(2), over2: +(d.filter((v) => v > 2).length / d.length).toFixed(4) };
}

const runs = [];
for (const m of MODES) {
  const first = runs[0];
  const prints = first ? Object.fromEntries(Object.entries(first.shots).map(([k, v]) => [k, v.auto.print])) : null;
  runs.push(await run(m, prints));
  console.log(`${m}: ${runs.at(-1).label}; ${Object.entries(runs.at(-1).shots).map(([k, v]) => `${k} ${v.auto.size} in ${v.ms} ms, time ${v.auto.print.enlarger.time_s}`).join('; ')}`);
}
const report = { base: BASE, query: EXTRA, modes: MODES, comparisons: [] };
for (const r of runs.slice(1)) {
  for (const k of Object.keys(r.shots)) {
    const a = runs[0].shots[k], b = r.shots[k];
    const row = {
      file: k, against: `${runs[0].mode} vs ${r.mode}`,
      autoTime: [a.auto.print.enlarger.time_s, b.auto.print.enlarger.time_s],
      autoLights: [a.auto.print.lights?.logH, b.auto.print.lights?.logH],
      samePrint: diff(a.auto, b.same),
    };
    report.comparisons.push(row);
    console.log(JSON.stringify(row));
  }
}
report.runs = runs.map((r) => ({ mode: r.mode, label: r.label, files: Object.fromEntries(Object.entries(r.shots).map(([k, v]) => [k, { ms: v.ms, size: v.auto.size, time_s: v.auto.print.enlarger.time_s }])) }));
if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 1));
