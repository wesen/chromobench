// CHB-031 WS-D: the session 03 interface findings, driven as the photographer would (menus, clicks, keys) on the
// built studio, with synthetic negatives only (written here as 16-bit TIFFs). Screenshots go to various/ws-d/.
//
//   pnpm --filter @chromobench/studio build && pnpm --filter @chromobench/studio preview --port 4811 --strictPort &
//   node ttmp/2026/11/12/CHB-031--*/scripts/wsd-01-interface.mjs [--base http://localhost:4811] [--only f24,f26,…]
//
// F24 layout switch keeps the frames open; F26 "Where is …?" closes when its file opens another way; F36 Undo of
// another frame shows that frame; F32/F33 History words and 30+ rows; F34 Actual Pixels and the zoom readout; 8iv8
// darkroom with no frame. Prints what it saw; exits 1 when a check fails.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const BASE = arg('base', 'http://localhost:4811');
const ONLY = arg('only', 'f24,f26,f36,f32,f34,8iv8').split(',');
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'various', 'ws-d');
mkdirSync(SHOTS, { recursive: true });

/** A synthetic colour negative: orange base, a density ramp (slope makes each file distinct), a film edge at the left. */
function negativeTiff(slope, W = 300, H = 200) {
  const base = [0.75, 0.42, 0.22];
  const px = Buffer.alloc(W * H * 6);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const d = x < 14 ? 0 : 0.15 + slope * ((x - 14) / (W - 14)) * (0.6 + 0.4 * (y / H)) + 0.04 * Math.sin(x * 0.21 + y * 0.13);
      for (let k = 0; k < 3; k++) px.writeUInt16LE(Math.round(65535 * 0.9 * base[k] * 10 ** -(d * [0.9, 1, 1.1][k])), (y * W + x) * 6 + k * 2);
    }
  const tags = [
    [256, 4, 1, W], [257, 4, 1, H], [258, 3, 3, 0 /* bits: offset below */], [259, 3, 1, 1], [262, 3, 1, 2],
    [273, 4, 1, 0 /* strip offset below */], [277, 3, 1, 3], [278, 4, 1, H], [279, 4, 1, px.length], [284, 3, 1, 1],
  ];
  const ifdAt = 8;
  const ifdLen = 2 + tags.length * 12 + 4;
  const bitsAt = ifdAt + ifdLen;
  const dataAt = bitsAt + 6;
  const head = Buffer.alloc(dataAt);
  head.write('II', 0, 'latin1');
  head.writeUInt16LE(42, 2);
  head.writeUInt32LE(ifdAt, 4);
  head.writeUInt16LE(tags.length, ifdAt);
  tags.forEach(([tag, type, count, value], i) => {
    const o = ifdAt + 2 + i * 12;
    head.writeUInt16LE(tag, o);
    head.writeUInt16LE(type, o + 2);
    head.writeUInt32LE(count, o + 4);
    const v = tag === 258 ? bitsAt : tag === 273 ? dataAt : value;
    if (type === 3 && count === 1) head.writeUInt16LE(v, o + 8);
    else head.writeUInt32LE(v, o + 8);
  });
  head.writeUInt32LE(0, ifdAt + 2 + tags.length * 12);
  for (let k = 0; k < 3; k++) head.writeUInt16LE(16, bitsAt + k * 2);
  return Buffer.concat([head, px]);
}
const A = { name: 'roll-a-07.tif', mimeType: 'image/tiff', buffer: negativeTiff(1.6) };
const B = { name: 'roll-a-08.tif', mimeType: 'image/tiff', buffer: negativeTiff(1.1) };

let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed++;
};
const shot = (page, name) => page.screenshot({ path: join(SHOTS, `${name}.png`) });
const status = (page) => page.locator('#status').textContent();
const idle = (page) => page.evaluate(() => window.chromobench.idle());
const ready = (page) => page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: 60_000 });
async function opened(page, n, timeout = 120_000) {
  await page.waitForFunction((k) => window.chromobench.studio.frames.all().length >= k && !/opening/.test(document.querySelector('#status')?.textContent ?? ''), n, { timeout });
  await idle(page);
}
const menu = async (page, top, command) => {
  await page.locator('.ck-menubar-t', { hasText: top }).click();
  await page.locator(`.ck-menu-i[data-command="${command}"]`).click();
};
/** View ▸ Layout…, then the layout's button (the dialog names the others by their id: Simple, Darkroom, …) */
async function layout(page, id) {
  await menu(page, 'View', 'view.layout');
  await page.locator('.ck-dialog button', { hasText: new RegExp(`^${id}$`, 'i') }).click();
  await page.waitForFunction((l) => document.body.dataset['variant'] === l, id, { timeout: 30_000 });
  await idle(page);
}

const browser = await chromium.launch({ headless: true });
const fresh = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  return { ctx, page };
};
/** a page on its own empty database (not ?fresh: the reload must find the library) */
async function emptyLibrary(page, variant = 'classic') {
  await page.goto(`${BASE}/?nosw&variant=${variant}`);
  await page.evaluate(() => new Promise((ok) => {
    const r = indexedDB.deleteDatabase('chromobench-studio');
    r.onsuccess = r.onerror = r.onblocked = () => ok(null);
  }));
  await page.reload();
  await ready(page);
}

if (ONLY.includes('f24')) {
  console.log('── F24: View ▸ Layout keeps the open frames');
  const { ctx, page } = await fresh();
  await emptyLibrary(page);
  await page.setInputFiles('#file', [A, B]);
  await opened(page, 2);
  const sel = await page.evaluate(() => window.chromobench.studio.current);
  const t0 = await page.evaluate(() => window.chromobench.log.committed.print.enlarger.time_s);
  await page.evaluate(() => window.chromobench.set('print.enlarger.time_s', 12.6, 'Time'));
  await idle(page);
  await shot(page, '01-f24-classic-two-frames');
  await layout(page, 'simple');
  const n1 = await page.evaluate(() => window.chromobench.studio.frames.all().length);
  check(n1 === 2, `after Classic → Simple: ${n1} frames open (2)`);
  check(await page.evaluate(() => window.chromobench.studio.current) === sel, 'the same frame is selected');
  check(!/select one to open its file again/.test(await status(page)), `status: "${await status(page)}"`);
  check(new URL(page.url()).searchParams.get('variant') === 'simple', `URL: ${page.url()}`);
  await page.locator('.cb-steps button', { hasText: 'Print' }).first().click().catch(() => page.getByRole('button', { name: /Print/ }).first().click());
  await idle(page);
  check(!!(await page.locator('.ck-vp').first().getAttribute('data-rendered')), 'Simple ② Print renders the frame');
  await shot(page, '02-f24-simple-after-switch');
  await layout(page, 'darkroom');
  await idle(page);
  check(await page.evaluate(() => window.chromobench.studio.frames.all().length) === 2, 'Darkroom: both frames still open');
  check(await page.evaluate(() => window.chromobench.log?.committed.print.enlarger.time_s) === 12.6, 'the edit (Time 12.6 s) is still there');
  await shot(page, '03-f24-darkroom-after-switch');
  await layout(page, 'classic');
  check(await page.evaluate(() => window.chromobench.studio.frames.all().length) === 2, 'back in Classic: both frames still open');
  // one undo history across the switches: Ctrl+Z takes back the Time set before them
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Control+z');
  await idle(page);
  const t1 = await page.evaluate(() => window.chromobench.log.committed.print.enlarger.time_s);
  check(t1 === t0, `Ctrl+Z after three switches undoes Time 12.6 s (back to ${t1} s)`);
  await shot(page, '04-f24-classic-again');
  // a new frame opened in Simple prints normalised (the layout's mode)
  await layout(page, 'simple');
  await page.setInputFiles('#file', { name: 'roll-a-09.tif', mimeType: 'image/tiff', buffer: negativeTiff(1.3) });
  await opened(page, 3);
  const mode = await page.evaluate(() => window.chromobench.log.committed.print.enlarger.mode);
  check(mode === 'normalised', `a frame opened in Simple prints ${mode}`);
  await ctx.close();
}

if (ONLY.includes('f26')) {
  console.log('── F26: "Where is …?" closes when the file opens another way');
  const { ctx, page } = await fresh();
  await emptyLibrary(page);
  await page.setInputFiles('#file', [A, B]);
  await opened(page, 2);
  await page.waitForTimeout(1500); // autosave
  await page.reload();
  await ready(page);
  check(/2 frames in the library/.test(await status(page)), `after reload: "${await status(page)}"`);
  const before = await page.evaluate(() => window.chromobench.studio.current);
  await page.locator('.cb-cell:visible').filter({ hasText: B.name }).first().click();
  await page.locator('.ck-dialog', { hasText: `Where is ${B.name}?` }).waitFor({ timeout: 10_000 }).catch(async (e) => {
    console.log('     dialog log:', await page.evaluate(() => JSON.stringify(window.chromobench.rt.chrome.log.slice(-4))), 'selection before/after:', before, await page.evaluate(() => JSON.stringify(window.chromobench.rt.store.peek(['ui', 'selection']))), await page.evaluate(() => JSON.stringify(Object.values(window.chromobench.rt.store.peek(['catalog', 'frames'])).map((c) => [c.id, c.name]))));
    throw e;
  });
  await shot(page, '05-f26-where-is');
  await page.setInputFiles('#file', B); // File ▸ Open, not Locate
  await opened(page, 1);
  await page.waitForTimeout(300);
  check(await page.locator('.ck-dialog').count() === 0, 'the dialog closed as answered');
  const cur = await page.evaluate(() => window.chromobench.studio.frames.get(window.chromobench.studio.current)?.name);
  check(cur === B.name, `the frame asked for is selected (${cur})`);
  // the page takes clicks again: a click on A asks for A's file
  await page.locator('.cb-cell:visible').filter({ hasText: A.name }).first().click();
  await page.locator('.ck-dialog', { hasText: `Where is ${A.name}?` }).waitFor({ timeout: 10_000 });
  check(true, 'clicks reach the library again (A asks for its file)');
  await page.getByRole('button', { name: 'Not now' }).click();
  await shot(page, '06-f26-after');
  await ctx.close();
}

if (ONLY.includes('f36')) {
  console.log('── F36: Undo of another frame shows that frame');
  const { ctx, page } = await fresh();
  await emptyLibrary(page);
  await page.setInputFiles('#file', [A, B]);
  await opened(page, 2);
  const ids = await page.evaluate(() => window.chromobench.studio.frames.all().map((e) => e.id));
  await page.evaluate((id) => window.chromobench.run('frame.select', id), ids[0]);
  await idle(page);
  const box = page.getByLabel('Time value');
  await box.click();
  await box.press('Control+a');
  await box.fill('14');
  await box.press('Enter');
  await idle(page);
  await page.locator('.cb-cell:visible').filter({ hasText: B.name }).first().click();
  await idle(page);
  check(await page.evaluate(() => window.chromobench.studio.current) === ids[1], 'B selected');
  await page.locator('.ck-vp').first().click();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  const toast = await page.locator('.ck-toast').last().textContent();
  check(await page.evaluate(() => window.chromobench.studio.current) === ids[0], `after Ctrl+Z: A is shown (toast "${toast}")`);
  check(/on roll-a-07\.tif/.test(toast ?? ''), 'the toast still names the frame');
  await idle(page);
  await shot(page, '07-f36-undo-shows-frame');
  await page.locator('.cb-cell:visible').filter({ hasText: B.name }).first().click();
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(200);
  check(await page.evaluate(() => window.chromobench.studio.current) === ids[0], 'Redo shows A too');
  await ctx.close();
}

if (ONLY.includes('f32')) {
  console.log('── F32/F33: History in words; 30+ rows scroll and keep their height');
  const { ctx, page } = await fresh();
  await emptyLibrary(page);
  await page.setInputFiles('#file', A);
  await opened(page, 1);
  const time = page.getByLabel('Time value');
  for (const v of ['12.6', '10', '7.94', '10']) {
    await time.click();
    await time.press('Control+a');
    await time.fill(v);
    await time.press('Enter');
    await idle(page);
  }
  await menu(page, 'Frame', 'frame.rotateRight');
  await idle(page);
  // 28 more steps: aperture clicks one by one (a burst of quick clicks is one step, as it should be)
  const steps = ['Aperture up', 'Aperture down'];
  for (let i = 0; i < 28; i++) {
    const b = page.getByRole('button', { name: steps[Math.floor(i / 2) % 2] }).first();
    if (await b.count()) await b.click();
    else await page.evaluate((k) => window.chromobench.set('print.enlarger.fstop', [8, 9, 10, 11][k % 4], 'Aperture'), i);
    await page.waitForTimeout(900);
  }
  await idle(page);
  const rows = await page.locator('#history .cb-hist-i').evaluateAll((els) => els.map((e) => ({ t: e.textContent, h: e.getBoundingClientRect().height, top: e.getBoundingClientRect().top })));
  console.log(`     ${rows.length} rows; first: ${rows.slice(1, 7).map((r) => `"${r.t}"`).join(', ')}`);
  check(rows.length >= 30, `30+ rows (${rows.length})`);
  const hs = rows.map((r) => r.h);
  check(Math.min(...hs) >= 16 && Math.max(...hs) - Math.min(...hs) < 1, `every row keeps its height (${Math.min(...hs).toFixed(1)}–${Math.max(...hs).toFixed(1)} px)`);
  check(rows.every((r, i) => i === 0 || r.top - rows[i - 1].top >= rows[i - 1].h - 0.5), 'no row overlaps the one above');
  const text = rows.map((r) => r.t).join('\n');
  check(!/[{}"]|view\.frame|transpose|flipH|\bst\)/.test(text), 'no JSON, paths, orientation tokens or "st)"');
  check(/\(\+⅓ stop\)/.test(text) && /Rotated right/.test(text), 'stops as "+⅓ stop", Rotate as "Rotated right"');
  const sc = await page.locator('#history').evaluate((e) => ({ top: e.scrollTop, h: e.scrollHeight, c: e.clientHeight }));
  check(sc.h > sc.c && sc.top > 0, `the list scrolls and shows the newest step (scrollTop ${sc.top}, ${sc.c}/${sc.h})`);
  await page.locator('[data-panel="history"]').first().screenshot({ path: join(SHOTS, '08-f33-history-30-rows.png') });
  await shot(page, '09-f32-history-words');
  await ctx.close();
}

if (ONLY.includes('f34')) {
  console.log('── F34: View ▸ Actual Pixels (1:1) and the zoom readout');
  const { ctx, page } = await fresh();
  await emptyLibrary(page);
  await page.setInputFiles('#file', A);
  await opened(page, 1);
  const zoom = page.locator('.ck-vp-zoom:visible').first();
  check(/^Fit · \d/.test((await zoom.textContent()) ?? ''), `readout at fit: "${await zoom.textContent()}"`);
  await page.locator('.ck-menubar-t', { hasText: 'View' }).click();
  const item = page.locator('.ck-menu-i[data-command="view.actual"]');
  check(/Actual Pixels \(1:1\)/.test((await item.textContent()) ?? ''), `menu item: "${(await item.textContent())?.replace(/\s+/g, ' ')}"`);
  await page.keyboard.press('Escape');
  await page.locator('.ck-vp').first().click();
  await page.keyboard.press('Control+Alt+0');
  await idle(page);
  check((await zoom.textContent()) === '100 %', `Ctrl+Alt+0: "${await zoom.textContent()}"`);
  await shot(page, '10-f34-actual-pixels');
  await zoom.click();
  await idle(page);
  check(/^Fit · /.test((await zoom.textContent()) ?? ''), 'a click on the readout fits again');
  await page.keyboard.press('Control+=');
  await idle(page);
  console.log(`     Zoom In from fit: "${await zoom.textContent()}"`);
  await shot(page, '11-f34-zoom-in');
  await ctx.close();
}

if (ONLY.includes('8iv8')) {
  console.log('── 8iv8: darkroom with no frame');
  const { ctx, page } = await fresh();
  await emptyLibrary(page, 'darkroom');
  const visible = await page.locator('.ck-panel:visible').evaluateAll((els) => els.map((e) => e.getAttribute('data-panel')));
  check(JSON.stringify(visible) === '["enlarger"]', `panels shown: ${visible.join(', ')}`);
  const texts = await page.locator('.ck-panel:visible .cb-empty, .ck-panel:visible .ck-text').allTextContents();
  console.log(`     texts: ${texts.map((t) => `"${t}"`).join(', ')}`);
  await shot(page, '12-8iv8-darkroom-empty');
  await page.setInputFiles('#file', A);
  await opened(page, 1);
  const after = await page.locator('.ck-panel:visible').evaluateAll((els) => els.map((e) => e.getAttribute('data-panel')));
  check(['history', 'enlarger', 'paper', 'exposures'].every((p) => after.includes(p)), `with a frame: ${after.join(', ')}`);
  await shot(page, '13-8iv8-darkroom-frame');
  await ctx.close();
}

await browser.close();
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
