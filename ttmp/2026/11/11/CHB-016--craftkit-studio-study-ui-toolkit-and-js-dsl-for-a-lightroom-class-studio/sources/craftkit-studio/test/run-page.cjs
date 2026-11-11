// node test/run-page.cjs <dir> [waitTitle] [timeoutMs] : serve <dir>, open it, wait for document.title === waitTitle, print the body
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const ROOT = path.resolve(process.argv[2]), WAIT = process.argv[3] || 'done', TO = +(process.argv[4] || 60000);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.wasm': 'application/wasm', '.jpg': 'image/jpeg', '.png': 'image/png', '.woff': 'font/woff', '.json': 'application/json' };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]); const f = path.join(ROOT, u === '/' ? 'index.html' : u); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d); }); });
srv.listen(0, async () => {
  const port = srv.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', m => console.log('[console]', m.type(), m.text()));
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.goto(`http://localhost:${port}/${process.env.PAGE || ''}`);
  try { await page.waitForFunction(t => document.title === t, WAIT, { timeout: TO }); } catch (e) { console.log('TIMEOUT'); }
  console.log(await page.evaluate(() => document.body.innerText));
  await browser.close(); srv.close();
});
