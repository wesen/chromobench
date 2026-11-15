const { waitRender, count } = await import('./common.mjs?' + Date.now());
export default async ({ page, shot, readProbe }) => {
  const r = {};
  await page.locator('button.ck-module', { hasText: /^Roll$/ }).click(); await page.waitForTimeout(1500);
  r.rollBefore = await page.evaluate(() => { const els = [...document.querySelectorAll('*')].filter(e => e.getBoundingClientRect().y > 70 && e.children.length === 0 && e.innerText?.trim()); return els.map(e => e.innerText.trim()).slice(0, 60).join(' | '); });
  const syn = process.cwd().replace(/ttmp.*/, '') + '.playwright-mcp/p9-synthetic/';
  const files = [1, 2, 3, 4].map(i => syn + `roll-12-frame-${i}.tif`);
  const n = await count(page); const t0 = Date.now();
  await page.setInputFiles('#file', files);
  const marks = []; let last = '';
  for (let i = 0; i < 400; i++) {
    const s = await page.evaluate(() => document.body.innerText.split('\n').slice(-1)[0]).catch(() => '');
    if (s !== last) { marks.push([Date.now() - t0, s.slice(0, 120)]); last = s; }
    const nf = await page.evaluate(() => window.chromobench.studio?.frames?.all?.().length ?? null).catch(() => null);
    if (nf >= 5 && /done/.test(s) && Date.now() - t0 > 3000) break;
    await page.waitForTimeout(300);
  }
  r.ms = Date.now() - t0; r.marks = marks.slice(0, 30);
  await page.waitForTimeout(1500);
  await shot('49-roll-opened');
  r.text = await page.evaluate(() => { const els = [...document.querySelectorAll('*')].filter(e => e.getBoundingClientRect().y > 70 && e.children.length === 0 && e.innerText?.trim()); return els.map(e => e.innerText.trim()).slice(0, 80).join(' | '); });
  r.probe = await readProbe();
  return r;
};
