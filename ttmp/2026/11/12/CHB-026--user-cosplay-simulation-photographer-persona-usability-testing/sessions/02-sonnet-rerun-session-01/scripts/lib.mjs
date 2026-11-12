import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
export const ROOT = '/home/manuel/code/wesen/chromobench';
export const SES = ROOT + '/ttmp/2026/11/12/CHB-026--user-cosplay-simulation-photographer-persona-usability-testing/sessions/02-sonnet-rerun-session-01';
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
export async function launch(fresh = false) {
  const prof = SES + '/profile';
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
