// node test/shoot.cjs <outdir> '<plan json>' : serve dist/, run steps, screenshot each, print console problems
// step: { name, vp: {width, height}, dark, actions: [ {eval}|{key}|{wait}|{click: selector}|{shot: name} ], fresh }
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const ROOT = path.resolve(process.env.DIST || 'dist'), OUT = process.argv[2];
const plan = JSON.parse(fs.existsSync(process.argv[3]) ? fs.readFileSync(process.argv[3], 'utf8') : process.argv[3]);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.wasm': 'application/wasm', '.jpg': 'image/jpeg', '.png': 'image/png', '.woff': 'font/woff', '.json': 'application/json' };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]); const f = path.join(ROOT, u === '/' ? 'index.html' : u); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } let body = d; if (u === '/' || u === '/index.html') body = '<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"></head><body style="margin:0">' + d + '</body></html>'; r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(body); }); });
fs.mkdirSync(OUT, { recursive: true });
srv.listen(0, async () => {
  const port = srv.address().port;
  const browser = await chromium.launch();
  let ctx = null, page = null;
  for (const step of plan) {
    if (!page || step.fresh !== false) {
      if (ctx) await ctx.close();
      ctx = await browser.newContext({ viewport: step.vp || { width: 1440, height: 900 }, colorScheme: step.dark === false ? 'light' : 'dark', deviceScaleFactor: step.dpr || 1 });
      page = await ctx.newPage();
      page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log(`  [${step.name}] ${m.type()}: ${m.text().slice(0, 400)}`); });
      page.on('pageerror', e => console.log(`  [${step.name}] pageerror: ${e.message}\n${(e.stack || '').split('\n').slice(0, 4).join('\n')}`));
      await page.goto(`http://localhost:${port}/`);
      await page.waitForFunction(() => window.STUDIO && window.STUDIO.root, null, { timeout: 15000 }).catch(() => console.log('  not mounted'));
      if (step.clear !== false) await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
      await page.waitForTimeout(step.boot || 1500);
    }
    for (const a of step.actions || []) {
      if (a.eval) { try { const r = await page.evaluate(a.eval); if (r !== undefined && r !== null) console.log(`  [${step.name}] eval → ${typeof r === 'string' ? r : JSON.stringify(r)}`); } catch (e) { console.log(`  [${step.name}] eval error: ${e.message}`); } }
      if (a.key) await page.keyboard.press(a.key);
      if (a.down) await page.keyboard.down(a.down);
      if (a.up) await page.keyboard.up(a.up);
      if (a.type) await page.keyboard.type(a.type);
      if (a.click) { try { await page.click(a.click, { timeout: 3000 }); } catch (e) { console.log(`  [${step.name}] click ${a.click}: ${e.message.split('\n')[0]}`); } }
      if (a.mouse) { const m = a.mouse; if (m.move) await page.mouse.move(...m.move); if (m.down) await page.mouse.down(); if (m.to) await page.mouse.move(...m.to, { steps: m.steps || 8 }); if (m.up) await page.mouse.up(); }
      if (a.wait) await page.waitForTimeout(a.wait);
      if (a.shot) await page.screenshot({ path: path.join(OUT, a.shot + '.png') });
    }
    if (step.shot !== false) await page.screenshot({ path: path.join(OUT, step.name + '.png') });
    console.log(step.name, 'done');
  }
  await browser.close(); srv.close();
});
