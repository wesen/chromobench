// End-to-end checks: node test/e2e.cjs [scenario …]. Serves dist/, drives the Studio like a person would,
// asserts on state, and leaves screenshots in the scratchpad.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const ROOT = path.resolve(process.env.DIST || 'dist');
const OUT = process.env.OUT || '/tmp/claude-0/-home-claude/67f1174e-8841-5d00-8f38-259a6c609c2c/scratchpad/e2e';
fs.mkdirSync(OUT, { recursive: true });
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.wasm': 'application/wasm', '.jpg': 'image/jpeg', '.png': 'image/png' };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]); const f = path.join(ROOT, u === '/' ? 'index.html' : u); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } let body = d; if (u === '/' || u === '/index.html') body = '<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"></head><body style="margin:0">' + d + '</body></html>'; r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(body); }); });

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? '✓' : '✕'} ${msg}`); if (!cond) failures++; };
const S = Object.assign({}, ...fs.readdirSync(__dirname).filter(f => /^scenarios.*\.cjs$/.test(f)).map(f => require('./' + f)));

srv.listen(0, async () => {
  const port = srv.address().port;
  const browser = await chromium.launch();
  const want = process.argv.slice(2);
  for (const [name, fn] of Object.entries(S)) {
    if (want.length && !want.includes(name)) continue;
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message + ' ' + (e.stack || '').split('\n')[1]));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });
    await page.goto(`http://localhost:${port}/`);
    await page.waitForFunction(() => window.STUDIO && window.STUDIO.root, null, { timeout: 15000 });
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
    await page.waitForTimeout(800);
    console.log(name);
    const st = p => page.evaluate(pp => window.STUDIO.store.peek(pp), p);
    const shot = n => page.screenshot({ path: path.join(OUT, `${name}-${n}.png`) });
    const idle = async (ms = 400) => { await page.waitForTimeout(ms); await page.waitForFunction(() => !document.querySelector('.ck-vp-busy:not([hidden])'), null, { timeout: 15000 }).catch(() => {}); };
    try { await fn({ page, st, ok, shot, idle }); } catch (e) { ok(false, 'threw: ' + e.message.split('\n')[0]); }
    for (const e of errors) ok(false, e);
    await ctx.close();
  }
  await browser.close(); srv.close();
  console.log(failures ? `${failures} failed` : 'all passed');
  process.exit(failures ? 1 : 0);
});
