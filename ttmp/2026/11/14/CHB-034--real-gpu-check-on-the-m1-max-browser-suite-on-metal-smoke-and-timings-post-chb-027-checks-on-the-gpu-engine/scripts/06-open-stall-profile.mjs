// CHB-034: what runs on the main thread during the stall of a GPU open (task 5un4). Opens a file in the studio
// (dev server, unminified) on the machine's own WebGPU adapter, with a rAF probe for gaps > 100 ms and a CDP
// sampling CPU profile; prints, per stall, the functions whose samples fall inside it (self time and the
// heaviest stacks).
//   pnpm --filter @chromobench/studio exec vite --port 4173 --strictPort &
//   node 06-open-stall-profile.mjs <file> [--base http://localhost:4173] [--engine gpu] [--top 25]
import { chromium } from '@playwright/test';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const file = process.argv[2];
const base = arg('base', 'http://localhost:4173');
const engine = arg('engine', 'gpu');
const top = Number(arg('top', '25'));

const browser = await chromium.launch({ channel: 'chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}/?nosw&fresh&engine=${engine}`);
  await page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: 120_000 });
  const engineLabel = await page.evaluate(() => window.chromobench?.engineLabel);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); // µs
  // the probe records stalls in performance.now() time; the profile's timestamps are in µs of the same monotonic
  // clock on another origin, so both are anchored to one marker taken right before the profile starts
  await page.evaluate(() => {
    const P = (window.__probe = { stalls: [] });
    let last = performance.now();
    const tick = (t) => { if (t - last > 100) P.stalls.push([last, t]); last = t; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  await cdp.send('Profiler.start');
  const t0Page = await page.evaluate(() => performance.now());
  const before = await page.evaluate(() => +(document.body.innerText.match(/rendered (\d+)/) ?? [0, 0])[1]);
  await page.setInputFiles('#file', file);
  // the open is done when the render counter moved and then stayed still for 2.5 s
  let last = before, still = Date.now(), moved = false;
  const tEnd = Date.now() + 120_000;
  while (Date.now() < tEnd) {
    await page.waitForTimeout(200);
    const r = await page.evaluate(() => +(document.body.innerText.match(/rendered (\d+)/) ?? [0, 0])[1]);
    if (r !== last) { last = r; still = Date.now(); moved = true; }
    if (moved && Date.now() - still > 2500) break;
  }
  const { profile } = await cdp.send('Profiler.stop');
  const stalls = await page.evaluate(() => window.__probe.stalls);

  // sample times in ms relative to the profile start, then shifted to page time via t0Page (the start marker)
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const name = (n) => `${n.callFrame.functionName || '(anonymous)'} ${n.callFrame.url.replace(/^.*\/(src|node_modules)\//, '$1/')}:${n.callFrame.lineNumber + 1}`;
  const times = [];
  let t = profile.startTime;
  for (let i = 0; i < profile.samples.length; i++) {
    t += profile.timeDeltas[i];
    times.push(t0Page + (t - profile.startTime) / 1000);
  }
  const out = { file: file.replace(/^.*\//, ''), engine: engineLabel, stalls: [] };
  for (const [a, b] of stalls) {
    const self = new Map();
    const stacks = new Map();
    let n = 0;
    for (let i = 0; i < times.length; i++) {
      if (times[i] < a || times[i] > b) continue;
      const leaf = byId.get(profile.samples[i]);
      if (!leaf || leaf.callFrame.functionName === '(idle)' || leaf.callFrame.functionName === '(program)') continue;
      n++;
      self.set(name(leaf), (self.get(name(leaf)) ?? 0) + 1);
      const chain = [];
      for (let id = leaf.id; id !== undefined && chain.length < 12; id = parent.get(id)) {
        const nd = byId.get(id);
        if (nd.callFrame.functionName === '(root)') break;
        chain.push(nd.callFrame.functionName || '(anonymous)');
      }
      const key = chain.reverse().join(' > ');
      stacks.set(key, (stacks.get(key) ?? 0) + 1);
    }
    const ms = (c) => Number(((c * profile.timeDeltas.reduce((x, y) => x + y, 0)) / profile.timeDeltas.length / 1000).toFixed(1));
    out.stalls.push({
      at: Math.round(a - t0Page), gapMs: Math.round(b - a), busyMs: ms(n),
      self: [...self].sort((x, y) => y[1] - x[1]).slice(0, top).map(([k, c]) => [ms(c), k]),
      stacks: [...stacks].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, c]) => [ms(c), k]),
    });
  }
  console.log(JSON.stringify(out, null, 1));
} finally {
  await browser.close();
}
