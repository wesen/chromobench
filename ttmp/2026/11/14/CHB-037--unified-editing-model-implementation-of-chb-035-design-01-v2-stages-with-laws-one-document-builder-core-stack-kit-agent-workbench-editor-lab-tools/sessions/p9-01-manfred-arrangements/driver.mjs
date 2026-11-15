// Long-lived headless Chromium for the P9 cosplay session. Keeps ONE page open across steps
// (so open photos and History persist like Manfred's browser) and runs step files sent by step.mjs
// over a unix socket. Step files export default async ({ page, shot, probe, log }) => result.
import { chromium } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const S = path.dirname(new URL(import.meta.url).pathname);
process.chdir(S); const SOCK = '.driver.sock'; // relative: absolute path exceeds the 104-byte socket limit
try { fs.unlinkSync(SOCK); } catch {}
const ctx = await chromium.launchPersistentContext(path.join(S, 'profile'), {
  headless: true, channel: 'chromium',
  args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan'],
  viewport: { width: 1440, height: 900 }, acceptDownloads: true,
});
const probe = () => {
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
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  };
  if (document.body) start(); else addEventListener('DOMContentLoaded', start);
};
await ctx.addInitScript(probe);
const page = ctx.pages()[0] ?? (await ctx.newPage());
const consoleLog = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleLog.push(`${m.type()}: ${m.text()}`.slice(0, 400)); });
page.on('pageerror', (e) => consoleLog.push('pageerror: ' + String(e).slice(0, 400)));
page.on('dialog', (d) => { consoleLog.push('dialog: ' + d.type() + ' ' + d.message()); d.dismiss().catch(() => {}); });
const shot = async (name, opts = {}) => { const p = path.join(S, 'shots', name + '.png'); await page.screenshot({ path: p, ...opts }); return 'shots/' + name + '.png'; };
const readProbe = () => page.evaluate(() => {
  const P = window.__probe; const ui = window.chromobench?.rt?.chrome?.log ?? [];
  const seen = window.__uiSeen ?? 0; window.__uiSeen = ui.length;
  if (!P) return { note: 'no probe', ui: ui.slice(seen) };
  const out = { ui: ui.slice(seen), toasts: P.toasts, worstStallMs: Math.max(0, ...P.stalls.map((s) => s[1])), stalls: P.stalls.slice(-8) };
  P.reset(); return out;
});
const server = http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  const { file } = JSON.parse(body);
  let out;
  try {
    const mod = await import(pathToFileURL(file).href + '?t=' + Date.now());
    const t0 = Date.now();
    const result = await mod.default({ page, ctx, shot, readProbe, S });
    out = { ok: true, ms: Date.now() - t0, result, console: consoleLog.splice(0) };
  } catch (e) { out = { ok: false, error: String(e?.stack ?? e).slice(0, 2000), console: consoleLog.splice(0) }; }
  res.end(JSON.stringify(out, null, 1));
  if (out.result === '__quit__') { await ctx.close(); server.close(); process.exit(0); }
});
server.listen(SOCK, () => console.log('driver ready', SOCK));
