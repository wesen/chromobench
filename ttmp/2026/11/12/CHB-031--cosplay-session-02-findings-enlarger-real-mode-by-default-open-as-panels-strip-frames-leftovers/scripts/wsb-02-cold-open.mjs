// CHB-031 WS-B (F22): where a cold first open spends its time, as session 02's tester met it (a fresh browser
// profile, the service worker on, no WebGPU flags: the CPU engine), against a warm second start of the same profile.
//
//   pnpm --filter @chromobench/studio build && pnpm --filter @chromobench/studio preview --port 4811 --strictPort &
//   node ttmp/2026/11/12/CHB-031--*/scripts/wsb-02-cold-open.mjs --profile <empty dir outside the repo>
//        [--base http://localhost:4811] [--query nosw] [--file <photo>] [--trace <dir>] [--runs cold,warm] [--out r.json]
//
// Per run: a persistent context on the profile (cold: emptied first), the page, the NEF set on #file as soon as the
// studio is ready, and a timeline on the page clock (performance.now() from navigation): ready, each status text
// ("opening …", "opened …", "rendered N · screen"), the frame present, the first screen render of it; resource
// timings of the page and the engine worker (data packs, wasm); with --trace a Chrome trace of the run (v8, wasm,
// worker threads) and a summary of its longest events by name. The private file is read in place; the script skips
// (exit 0) when it is absent. Only numbers are written.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const BASE = arg('base', 'http://localhost:4811');
const QUERY = arg('query', '');
const FILE = arg('file', join(homedir(), 'Downloads/2026-11-11 - manfred test bilder/DSC_8559.NEF'));
const PROFILE = arg('profile', '');
const TRACE = arg('trace', '');
const RUNS = arg('runs', 'cold,warm').split(',');
const OUT = arg('out', '');
if (!existsSync(FILE)) {
  console.log(`skipped: ${FILE} absent (private test photo)`);
  process.exit(0);
}
if (!PROFILE) throw new Error('--profile <dir> is required (a browser profile outside the repository)');

const probe = () => {
  const P = (window.__cold = { status: [], renders: [], t: () => Math.round(performance.now()) });
  let last = '';
  const look = () => {
    const s = document.querySelector('#status')?.textContent ?? '';
    if (s && s !== last) P.status.push([P.t(), (last = s)]);
    if (!P.hooked && window.chromobench?.rt) {
      P.hooked = true;
      window.chromobench.rt.on('rendered', (e) => P.renders.push([P.t(), e.viewport, e.pass, e.w, e.h, Math.round(e.ms)]));
    }
  };
  const start = () => new MutationObserver(look).observe(document.body, { childList: true, subtree: true, characterData: true });
  if (document.body) start();
  else addEventListener('DOMContentLoaded', start);
  setInterval(look, 50);
};

const resources = (list) => list
  .filter((r) => /\.(wasm|safetensors|json)$|\/packs\/|engine-worker|index-|engines-/.test(r.name))
  .map((r) => ({ name: r.name.replace(/^https?:\/\/[^/]+/, '').replace(/\/packs\/[^/]+\/stocks\/.*/, '/packs/…/stocks/*'), start: Math.round(r.startTime), ms: Math.round(r.duration), bytes: r.transferSize ?? null }))
  .reduce((acc, r) => {
    // the stock files: one row (count, first start, last end)
    const k = r.name;
    const a = acc.find((x) => x.name === k);
    if (a) {
      a.n++;
      a.end = Math.max(a.end, r.start + r.ms);
    } else acc.push({ ...r, n: 1, end: r.start + r.ms });
    return acc;
  }, [])
  .map(({ name, start, end, n, bytes }) => ({ name, n, start, end, bytes }));

function summariseTrace(path) {
  const t = JSON.parse(readFileSync(path, 'utf8'));
  const ev = (t.traceEvents ?? t).filter((e) => e.ph === 'X' && e.dur > 0);
  const threads = new Map();
  for (const e of (t.traceEvents ?? t)) if (e.ph === 'M' && e.name === 'thread_name') threads.set(`${e.pid}:${e.tid}`, e.args.name);
  const by = new Map();
  for (const e of ev) {
    const th = threads.get(`${e.pid}:${e.tid}`) ?? '?';
    const k = `${th} | ${e.name}`;
    const a = by.get(k) ?? { k, ms: 0, n: 0, max: 0 };
    a.ms += e.dur / 1000;
    a.n++;
    a.max = Math.max(a.max, e.dur / 1000);
    by.set(k, a);
  }
  return [...by.values()].filter((a) => !/RunTask|ThreadControllerImpl|TaskQueueManager|MessageLoop|RunMicrotasks|v8.callFunction|FunctionCall|EvaluateScript$/.test(a.k)).sort((a, b) => b.ms - a.ms).slice(0, 40)
    .map((a) => ({ what: a.k, totalMs: Math.round(a.ms), n: a.n, maxMs: Math.round(a.max) }));
}

async function run(kind) {
  if (kind === 'cold') rmSync(PROFILE, { recursive: true, force: true });
  mkdirSync(PROFILE, { recursive: true });
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(probe);
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const workers = [];
  page.on('worker', (w) => workers.push(w));
  const browser = ctx.browser();
  const tracePath = TRACE ? join(TRACE, `${kind}.json`) : '';
  if (tracePath && browser) {
    mkdirSync(TRACE, { recursive: true });
    await browser.startTracing(page, { path: tracePath, categories: ['devtools.timeline', 'v8', 'v8.wasm', 'disabled-by-default-v8.compile', 'blink', 'toplevel', 'disabled-by-default-devtools.timeline'] });
  }
  const wall = Date.now();
  await page.goto(`${BASE}/${QUERY ? `?${QUERY}` : ''}`);
  await page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: 300_000, polling: 50 });
  const readyAt = await page.evaluate(() => Math.round(performance.now()));
  const name = FILE.split('/').pop();
  const openAt = await page.evaluate(() => Math.round(performance.now()));
  await page.setInputFiles('#file', FILE);
  await page.waitForFunction((n) => {
    const st = window.chromobench?.studio;
    return st && st.frames.get(st.current)?.name === n && !/opening/.test(document.querySelector('#status')?.textContent ?? '');
  }, name, { timeout: 300_000, polling: 50 });
  const presentAt = await page.evaluate(() => Math.round(performance.now()));
  await page.waitForFunction((t0) => window.__cold.renders.some((r) => r[0] >= t0 && r[2] !== 'draft'), openAt, { timeout: 300_000, polling: 50 });
  await page.evaluate(() => window.chromobench.idle());
  const P = await page.evaluate(() => ({ status: window.__cold.status, renders: window.__cold.renders, nav: performance.getEntriesByType('navigation')[0]?.toJSON?.() ?? null, res: performance.getEntriesByType('resource').map((r) => r.toJSON()), engine: window.chromobench.engineLabel, sw: !!navigator.serviceWorker?.controller }));
  const wres = [];
  for (const w of workers) wres.push(...(await w.evaluate(() => performance.getEntriesByType('resource').map((r) => ({ ...r.toJSON(), worker: self.name || location.pathname }))).catch(() => [])));
  const firstScreen = P.renders.find((r) => r[0] >= openAt && r[2] !== 'draft');
  const out = {
    kind, query: QUERY, engine: P.engine, swControlled: P.sw, wallMs: Date.now() - wall,
    readyMs: readyAt, openAt, presentMs: presentAt - openAt, firstScreenMs: firstScreen ? firstScreen[0] - openAt : null, firstScreen,
    status: P.status.map(([t, s]) => [t - openAt, s.slice(0, 80)]),
    page: resources(P.res), worker: resources(wres),
  };
  if (tracePath && browser) {
    await browser.stopTracing();
    out.trace = summariseTrace(tracePath);
  }
  await ctx.close();
  return out;
}

const results = [];
for (const k of RUNS) {
  const r = await run(k);
  results.push(r);
  console.log(`${k}${QUERY ? ` ?${QUERY}` : ''}: ready ${r.readyMs} ms; open → frame present ${r.presentMs} ms, → first screen render ${r.firstScreenMs} ms (${r.engine}; SW controls the page: ${r.swControlled})`);
  for (const s of r.status) console.log(`   ${String(s[0]).padStart(7)} ms  ${s[1]}`);
}
if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 1));
