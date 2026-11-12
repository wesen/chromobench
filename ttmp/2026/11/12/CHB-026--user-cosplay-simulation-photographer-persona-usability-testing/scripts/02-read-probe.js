// Run with browser_run_code_unsafe (filename: this file). Returns and resets the probe log, plus the shell's own
// UI log (every toast and dialog the shell showed since page load: window.chromobench.rt.chrome.log), new entries only.
async (page) => page.evaluate(() => {
  const P = window.__probe;
  const ui = window.chromobench?.rt?.chrome?.log ?? [];
  const seen = window.__uiSeen ?? 0;
  window.__uiSeen = ui.length;
  if (!P) return { note: 'no probe: run 01-install-probe.js first', ui: ui.slice(seen) };
  const out = { ui: ui.slice(seen), toasts: P.toasts, stalls: P.stalls, worstStallMs: Math.max(0, ...P.stalls.map((s) => s[1])), status: P.status };
  P.reset();
  return out;
})
