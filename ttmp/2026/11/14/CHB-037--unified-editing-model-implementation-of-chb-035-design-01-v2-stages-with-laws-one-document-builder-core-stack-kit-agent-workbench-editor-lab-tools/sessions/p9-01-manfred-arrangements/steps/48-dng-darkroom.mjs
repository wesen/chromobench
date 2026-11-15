const { waitRender, count, sample } = await import('./common.mjs?' + Date.now());
export default async ({ page, shot, readProbe }) => {
  const r = {};
  r.btn = await page.locator('.ck-dialog button, [role=dialog] button').evaluateAll(bs => bs.map(b => [b.innerText, b.getAttribute('aria-label')]));
  await page.locator('.ck-dialog button, [role=dialog] button', { hasText: 'Darkroom' }).first().click(); await page.waitForTimeout(2500);
  r.url = page.url();
  r.strip = await page.evaluate(() => [...document.querySelectorAll('canvas.ck-thumb-c')].map(e => { const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; }));
  const syn = process.cwd().replace(/ttmp.*/, '') + '.playwright-mcp/p9-synthetic/';
  const t0 = Date.now();
  await page.setInputFiles('#file', syn + 'landscape-camera.dng');
  const marks = []; let last = '';
  for (let i = 0; i < 300; i++) { const s = await page.evaluate(() => document.body.innerText.split('\n').slice(-1)[0]).catch(() => ''); if (s !== last) { marks.push([Date.now() - t0, s.slice(0, 120)]); last = s; } if (/rendered \d+ · done/.test(s) && marks.some(m => /opened|opening/.test(m[1]))) break; if (/^opened/.test(s) && Date.now() - t0 > 2000) break; await page.waitForTimeout(300); }
  r.marks = marks; r.ms = Date.now() - t0;
  await page.waitForTimeout(3000);
  r.status = await page.evaluate(() => document.body.innerText.split('\n').slice(-4));
  r.right = await page.evaluate(() => { const els = [...document.querySelectorAll('*')].filter(e => e.getBoundingClientRect().x > 1130 && e.getBoundingClientRect().y > 28 && e.getBoundingClientRect().y < 880 && e.children.length === 0 && e.innerText?.trim()); return els.map(e => e.innerText.trim()).slice(0, 70).join(' | '); });
  r.stages = await page.evaluate(() => Object.keys(window.chromobench.doc?.stages ?? {}));
  r.decode = await page.evaluate(() => window.chromobench.doc?.source?.decode);
  await shot('59-dng-darkroom');
  r.probe = await readProbe();
  return r;
};
