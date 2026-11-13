import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
export const ROOT = '/home/manuel/code/wesen/chromobench';
export const SES = ROOT + '/ttmp/2026/11/12/CHB-026--user-cosplay-simulation-photographer-persona-usability-testing/sessions/04-sonnet-check-round-2';
export const SHOTS = SES + '/shots';
export const PHOTOS = ROOT + '/.playwright-mcp/photos';
export const probe = () => {
  if (window.__probe) return;
  const P = (window.__probe = { t0: performance.now(), toasts: [], stalls: [], status: [] });
  const now = () => Math.round(performance.now() - P.t0);
  P.reset = () => { P.t0 = performance.now(); P.toasts = []; P.stalls = []; P.status = []; };
  let last = performance.now();
  const tick = (t) => { const d = t - last; if (d > 100) P.stalls.push([Math.round(last - P.t0), Math.round(d)]); last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const start = () => {
    new MutationObserver((ms) => {
      for (const m of ms) for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        const t = n.classList?.contains('ck-toast') ? n : n.querySelector?.('.ck-toast');
        if (t) P.toasts.push([now(), [...t.classList].find((c) => c.startsWith('is-')) || '', t.innerText.replace(/\s+/g, ' ')]);
      }
      const txt = (document.body.innerText.match(/(opening [^\n]*|rendered \d+[^\n]*|exporting[^\n]*|exported[^\n]*|opened [^\n]*)/) || [])[1];
      if (txt && txt !== P._lastStatus) { P._lastStatus = txt; P.status.push([now(), txt]); }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  };
  if (document.body) start(); else addEventListener('DOMContentLoaded', start);
};
export async function launch(fresh = false, name = 'fresh') {
  const prof = SES + '/profile/' + name;
  if (fresh) fs.rmSync(prof, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(prof, { headless: true, viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(probe);
  const page = ctx.pages()[0] ?? await ctx.newPage();
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log('[console.' + m.type() + ']', m.text().slice(0, 300)); });
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
  return { ctx, page };
}
export async function goto(page) { await page.goto('http://localhost:4650/'); await page.waitForTimeout(1500); }
export const shot = (page, name) => page.screenshot({ path: SHOTS + '/' + name + '.png', timeout: 60000 });
export const readProbe = (page) => page.evaluate(() => {
  const P = window.__probe; const ui = window.chromobench?.rt?.chrome?.log ?? []; const seen = window.__uiSeen ?? 0; window.__uiSeen = ui.length;
  if (!P) return { ui: ui.slice(seen) };
  const out = { ui: ui.slice(seen), toasts: P.toasts, stalls: P.stalls, worstStallMs: Math.max(0, ...P.stalls.map((s) => s[1])), status: P.status }; P.reset(); return out;
});
export const bodyText = (page) => page.evaluate(() => document.body.innerText);
export async function waitIdle(page, label, maxS = 120, minS = 2) {
  const t0 = Date.now(); let last = '';
  for (let i = 0; i < maxS; i++) {
    await page.waitForTimeout(500);
    const bt = await bodyText(page); const line = bt.split('\n').slice(-3).join(' | ');
    if (line !== last) { console.log(label, ((Date.now()-t0)/1000).toFixed(1)+'s', line); last = line; }
    if (i/2 > minS && !/opening|rendering|working|exporting/.test(line) ) { return (Date.now()-t0)/1000; }
  }
  return -1;
}
export async function openVia(page, menuItems, path) {
  // click File, then submenu items; the last one opens the file chooser
  const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 10000 }), (async () => {
    await page.getByText('File', { exact: true }).first().click();
    for (const it of menuItems) { await page.getByText(it, { exact: true }).first().click(); await page.waitForTimeout(250); }
  })()]);
  await fc.setFiles(path);
}
export async function setOpenAs(page, label) {
  await page.getByText('File', { exact: true }).first().click();
  await page.getByText('Open As', { exact: true }).first().hover();
  await page.waitForTimeout(300);
  await page.getByText(label, { exact: true }).first().click();
  await page.waitForTimeout(800);
}
export async function menuState(page) {
  await page.getByText('File', { exact: true }).first().click();
  await page.getByText('Open As', { exact: true }).first().hover();
  await page.waitForTimeout(300);
  const t = await page.evaluate(() => [...document.querySelectorAll('[role=menuitem],[role=menuitemradio],[role=menuitemcheckbox]')].map(e=>e.innerText.replace(/\s+/g,' ')+(e.getAttribute('aria-checked')?` [${e.getAttribute('aria-checked')}]`:'')).join(' || '));
  await page.keyboard.press('Escape'); await page.mouse.click(700, 300);
  return t;
}
export async function waitRendered(page, label, maxS = 90) {
  const t0 = Date.now(); let last = ''; let sawOpening = false;
  for (let i = 0; i < maxS * 2; i++) {
    await page.waitForTimeout(500);
    const l = (await bodyText(page)).split('\n').slice(-4).join(' | ');
    if (l !== last) { console.log(label, ((Date.now()-t0)/1000).toFixed(1)+'s', l); last = l; }
    if (/opening/.test(l)) sawOpening = true;
    if (sawOpening && /rendered \d/.test(l) && !/opening/.test(l)) return (Date.now()-t0)/1000;
  }
  return -1;
}
export async function clickDialog(page, name) { await page.getByRole('button', { name }).click(); }
export async function openFile(page, file, maxS = 90) {
  const t0 = Date.now();
  await page.setInputFiles('#file', file);
  for (let i = 0; i < maxS * 4; i++) {
    await page.waitForTimeout(250);
    const l = (await bodyText(page)).split('\n').slice(-4).join(' | ');
    if (/rendered \d/.test(l) && !/opening/.test(l) && i > 8) return (Date.now() - t0) / 1000;
  }
  return -1;
}
import { execSync } from 'node:child_process';
export const uptime = () => execSync('uptime').toString().trim().replace(/.*up/, 'up');
// mean RGB of a screenshot clip
export async function meanRGB(page, clip, name = '_tmp') {
  const f = SHOTS + '/' + name + '.png';
  await page.screenshot({ path: f, clip, timeout: 60000 });
  return JSON.parse(execSync(`python3 -c "from PIL import Image, ImageStat; import json; im=Image.open('${f}').convert('RGB'); print(json.dumps([round(x,1) for x in ImageStat.Stat(im).mean]))"`).toString());
}
export const MAIN = { x: 250, y: 140, width: 880, height: 580 };
export const rn = async (page) => { const m = (await bodyText(page)).match(/rendered (\d+) · (\w+)/); return m ? [Number(m[1]), m[2]] : [0, '']; };
// wait until a new final ("screen") render appeared after n0; returns seconds
export async function settle(page, n0, maxS = 40) {
  const t0 = Date.now();
  for (let i = 0; i < maxS * 4; i++) {
    await page.waitForTimeout(250);
    const [n, k] = await rn(page);
    if (n > n0 && k === 'screen') { await page.waitForTimeout(600); return (Date.now() - t0) / 1000; }
  }
  return -1;
}
export const luma = (m) => +(0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]).toFixed(1);
export async function panelVals(page) {
  return page.evaluate(() => Object.fromEntries([...document.querySelectorAll('input[aria-label$=" value"]')].filter(e=>e.offsetParent).map(e => [e.getAttribute('aria-label').replace(' value',''), e.value])));
}
// click a library thumbnail (by file name) and answer the "Where is …?" dialog with the file chooser
export async function relink(page, name, file) {
  await page.getByText(name, { exact: true }).first().click();
  await page.waitForTimeout(800);
  const dlg = await bodyText(page);
  const btn = page.getByRole('button', { name: new RegExp('Locate') });
  if (await btn.count()) {
    const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 10000 }), btn.first().click()]);
    await fc.setFiles(file);
    return true;
  }
  return false;
}
