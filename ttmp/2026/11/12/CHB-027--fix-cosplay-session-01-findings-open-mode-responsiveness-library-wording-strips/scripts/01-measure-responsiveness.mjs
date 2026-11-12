// CHB-027 WS-B: responsiveness, measured headless on the photographer's real files (F4, F10).
//
//   pnpm --filter @chromobench/studio build && pnpm --filter @chromobench/studio preview --port 4811 --strictPort &
//   node ttmp/2026/11/12/CHB-027--*/scripts/01-measure-responsiveness.mjs [--base http://localhost:4811]
//        [--engines reference,gpu] [--nef <file>] [--dng <file>] [--out result.json] [--shots dir] [--query extra=1]
//
// Per engine, in one fresh page (?nosw&fresh&canvas2d&engine=<e>), the session-01 steps of CHB-026:
//   1. open a D750 NEF as a photo        open time (until the first screen render), main-thread stalls
//   2. drag the Time slider 40 px         20 real mouse moves 30 ms apart; drag wall time, renders during the drag,
//                                         time from mouse-up to the final screen render, stalls
//   3. type "15" + Enter in Time value    time until the screen render, stalls
//   4. open raw010.dng as a negative      open time, stalls
//   5. drag the Time slider again         (the negative: print-only changes must not recompute the negative)
// Stalls are requestAnimationFrame gaps over 100 ms (CHB-026 scripts/01-install-probe.js), on the page clock.
// The private files are read in place and never copied; the script skips (exit 0) when they are absent.
// WebGPU runs on SwiftShader here (the flags of playwright.config.ts): GPU numbers are a software adapter's.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const BASE = arg('base', 'http://localhost:4811');
const ENGINES = arg('engines', 'reference,gpu').split(',');
const NEF = arg('nef', join(homedir(), 'Downloads/2026-11-11 - manfred test bilder/DSC_8559.NEF'));
const DNG = arg('dng', join(homedir(), 'Downloads/raw010.dng'));
const OUT = arg('out', '');
const SHOTS = arg('shots', '');
const EXTRA = arg('query', '');
const TIMEOUT = Number(arg('timeout', '240000'));
const STEP_TIMEOUT = Number(arg('step-timeout', '180000'));

const have = [NEF, DNG].filter((f) => existsSync(f));
if (!have.length) {
  console.log(`skipped: neither ${NEF} nor ${DNG} is here (private test photos)`);
  process.exit(0);
}

/** The probe: rAF stalls, renders of every viewport, pointer and key times, all on the page clock. */
const probe = () => {
  if (window.__wsb) return;
  const P = (window.__wsb = { stalls: [], renders: [], marks: [], t: () => performance.now() });
  let last = performance.now();
  const tick = (t) => {
    if (t - last > 100) P.stalls.push([Math.round(last), Math.round(t - last)]);
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  for (const ev of ['pointerdown', 'pointerup', 'keydown']) {
    addEventListener(ev, (e) => P.marks.push([ev === 'keydown' ? `key:${e.key}` : ev, Math.round(performance.now())]), true);
  }
  P.hook = () => {
    if (P.hooked || !window.chromobench?.rt) return false;
    P.hooked = true;
    window.chromobench.rt.on('rendered', (e) => P.renders.push([Math.round(performance.now()), e.viewport, e.pass, e.w, e.h, Math.round(e.ms)]));
    return true;
  };
};

async function window_(page, from) {
  return page.evaluate((t0) => {
    const P = window.__wsb;
    return {
      stalls: P.stalls.filter((s) => s[0] + s[1] >= t0),
      renders: P.renders.filter((r) => r[0] >= t0),
      marks: P.marks.filter((m) => m[1] >= t0),
      now: Math.round(performance.now()),
    };
  }, from);
}

const now = (page) => page.evaluate(() => Math.round(performance.now()));
const idle = (page) => page.evaluate(() => window.chromobench.idle());

/** The main viewer's renders: the viewport with the largest results. */
function mainRenders(renders) {
  const big = new Map();
  for (const r of renders) big.set(r[1], Math.max(big.get(r[1]) ?? 0, r[3] * r[4]));
  const vp = [...big.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return renders.filter((r) => r[1] === vp);
}

function summary(name, t0, w, extra = {}) {
  const main = mainRenders(w.renders);
  const screens = main.filter((r) => r[2] !== 'draft');
  const lastScreen = screens.at(-1);
  const stalls = w.stalls.map((s) => s[1]);
  return {
    step: name,
    resultMs: lastScreen ? lastScreen[0] - t0 : null,
    firstRenderMs: main[0] ? main[0][0] - t0 : null,
    renders: main.length,
    drafts: main.filter((r) => r[2] === 'draft').length,
    lastSize: lastScreen ? `${lastScreen[3]}×${lastScreen[4]}` : null,
    draftSize: main.find((r) => r[2] === 'draft') ? `${main.find((r) => r[2] === 'draft')[3]}×${main.find((r) => r[2] === 'draft')[4]}` : null,
    renderMs: main.map((r) => r[5]),
    stalls: stalls.length,
    worstStallMs: stalls.length ? Math.max(...stalls) : 0,
    stallTotalMs: stalls.reduce((a, b) => a + b, 0),
    ...extra,
  };
}

async function openFile(page, file, photo, label) {
  await page.locator('#photo').setChecked(photo);
  const t0 = await now(page);
  const wall = Date.now();
  await page.setInputFiles('#file', file);
  await page.waitForFunction(() => /rendered|E_|error|failed/i.test(document.querySelector('#status')?.textContent ?? ''), null, { timeout: TIMEOUT, polling: 50 });
  await idle(page);
  const w = await window_(page, t0);
  return summary(label, t0, w, { wallMs: Date.now() - wall, status: await page.locator('#status').textContent(), notes: (await page.locator('#notes').textContent())?.slice(0, 160) });
}

async function drag(page, label, px = 40, moves = 20, gapMs = 30) {
  const s = page.locator('input[aria-label="Time"]').first();
  await s.scrollIntoViewIfNeeded();
  const b = await s.boundingBox();
  const v = await s.evaluate((e) => ({ v: Number(e.value), min: Number(e.min), max: Number(e.max) }));
  const thumb = 16;
  const x = b.x + thumb / 2 + ((v.v - v.min) / (v.max - v.min)) * (b.width - thumb);
  const y = b.y + b.height / 2;
  const before = await s.evaluate((e) => e.getAttribute('aria-valuetext'));
  const t0 = await now(page);
  const wall = Date.now();
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= moves; i++) {
    await page.mouse.move(x + (px * i) / moves, y);
    await page.waitForTimeout(gapMs);
  }
  await page.mouse.up();
  const dragWall = Date.now() - wall;
  await idle(page);
  const w = await window_(page, t0);
  const up = w.marks.find((m) => m[0] === 'pointerup')?.[1] ?? t0;
  const down = w.marks.find((m) => m[0] === 'pointerdown')?.[1] ?? t0;
  const main = mainRenders(w.renders);
  const lastScreen = main.filter((r) => r[2] !== 'draft').at(-1);
  const after = await s.evaluate((e) => e.getAttribute('aria-valuetext'));
  return summary(label, t0, w, {
    dragWallMs: dragWall,
    pointerDownToUpMs: up - down,
    upToResultMs: lastScreen ? lastScreen[0] - up : null,
    rendersDuringDrag: main.filter((r) => r[0] <= up).length,
    value: `${before} → ${after}`,
  });
}

async function typed(page, label, text = '15') {
  const f = page.locator('input[aria-label="Time value"]').first();
  await f.click();
  await f.fill(text);
  const t0 = await now(page);
  await f.press('Enter');
  await idle(page);
  const w = await window_(page, t0);
  return summary(label, t0, w);
}

async function run(engine) {
  const browser = await chromium.launch({ channel: 'chromium', args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(probe);
  const t = Date.now();
  await page.goto(`${BASE}/?nosw&fresh&canvas2d&engine=${engine}${EXTRA ? `&${EXTRA}` : ''}`);
  await page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: TIMEOUT });
  const bootMs = Date.now() - t;
  await page.evaluate(() => window.__wsb.hook());
  const label = await page.locator('#engine').textContent();
  const steps = [];
  const out = { engine, label, bootMs, steps, errors };
  const shot = async (n) => SHOTS && page.screenshot({ path: join(SHOTS, `${engine}-${n}.png`), timeout: 60_000 }).catch(() => undefined);
  // each step races a timeout; after a timeout the page is still busy, so the engine's run stops there
  const step = async (name, f) => {
    let timer;
    const r = await Promise.race([f(), new Promise((res) => (timer = setTimeout(() => res({ step: name, timedOut: STEP_TIMEOUT }), STEP_TIMEOUT)))]);
    clearTimeout(timer);
    steps.push(r);
    console.log(`  ${engine}: ${JSON.stringify(r)}`);
    if (r.timedOut) throw Object.assign(new Error(`${name}: no result in ${STEP_TIMEOUT} ms`), { partial: true });
  };
  try {
    if (existsSync(NEF)) {
      await step('open NEF as photo', () => openFile(page, NEF, true, 'open NEF as photo'));
      await shot('1-nef');
      await step('drag Time 40 px (photo)', () => drag(page, 'drag Time 40 px (photo)'));
      await step('type 15 + Enter (photo)', () => typed(page, 'type 15 + Enter (photo)'));
      await shot('2-nef-after');
    }
    if (existsSync(DNG)) {
      await step('open DNG as negative', () => openFile(page, DNG, false, 'open DNG as negative'));
      await shot('3-dng');
      await step('drag Time 40 px (negative)', () => drag(page, 'drag Time 40 px (negative)'));
      await step('type 15 + Enter (negative)', () => typed(page, 'type 15 + Enter (negative)'));
      await shot('4-dng-after');
    }
  } catch (e) {
    if (!e.partial) throw e;
    out.error = e.message;
  }
  await browser.close();
  return out;
}

if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const results = [];
for (const e of ENGINES) {
  try {
    results.push(await run(e));
  } catch (err) {
    results.push({ engine: e, error: String(err?.message ?? err) });
  }
}

const cell = (x) => (x === null || x === undefined ? '–' : String(x));
for (const r of results) {
  console.log(`\n## ${r.engine}: ${r.label ?? ''} (boot ${r.bootMs ?? '–'} ms)${r.error ? `  ERROR ${r.error}` : ''}`);
  if (!r.steps) continue;
  console.log('| step | result ms | first render ms | renders (drafts) | worst stall ms | stalls (total ms) | drag wall ms | up→result ms | size | note |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const s of r.steps) {
    if (s.timedOut) {
      console.log(`| ${s.step} | > ${s.timedOut} (no result) | | | | | | | | |`);
      continue;
    }
    console.log(`| ${s.step} | ${cell(s.resultMs)} | ${cell(s.firstRenderMs)} | ${s.renders} (${s.drafts}) | ${s.worstStallMs} | ${s.stalls} (${s.stallTotalMs}) | ${cell(s.dragWallMs)} | ${cell(s.upToResultMs)} | ${cell(s.lastSize)}${s.draftSize ? ` / draft ${s.draftSize}` : ''} | ${cell(s.value ?? s.status)} |`);
  }
  if (r.errors.length) console.log('page errors:', r.errors.join(' | '));
}
if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 1));
