// Run with the Playwright MCP tool browser_run_code_unsafe (filename: this file).
// Installs a probe in the current page AND every later navigation (addInitScript):
//   window.__probe.toasts  — every toast: [ms since probe start, kind, text]   (toasts vanish after ~2.6 s!)
//   window.__probe.stalls  — main-thread stalls > 100 ms seen by requestAnimationFrame: [start ms, duration ms]
//   window.__probe.status  — changes of the right-hand status text: [ms, text]
// Read it back with 02-read-probe.js. Reset with: window.__probe.reset()
async (page) => {
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
        const s = document.querySelector('.ck-status-r, [class*=status] [class*=right]');
        const txt = (document.body.innerText.match(/(opening [^\n]*|rendered \d+[^\n]*|exporting[^\n]*|exported[^\n]*|opened [^\n]*)/) || [])[1];
        if (txt && txt !== P._lastStatus) { P._lastStatus = txt; P.status.push([now(), txt]); }
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    };
    if (document.body) start(); else addEventListener('DOMContentLoaded', start);
  };
  await page.addInitScript(probe);
  await page.evaluate(probe);
  return 'probe installed';
}
