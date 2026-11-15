const { waitRender, count, sample } = await import('./common.mjs?' + Date.now());
export default async ({ page, shot, readProbe }) => {
  const r = {};
  const add = page.locator('button.cb-stack-add').filter({ visible: true }).first();
  r.addLabel = await add.getAttribute('aria-label');
  await add.click(); await page.waitForTimeout(400);
  r.menu = await page.locator('.ck-menu, .ck-pop').last().innerText();
  await shot('63-scene-plus-layer');
  // pick something with exposure / white balance
  const opts = r.menu.split('\n');
  const pick = opts.find(o => /white|balance|temp/i.test(o)) ?? opts.find(o => /expos/i.test(o)) ?? opts[0];
  r.pick = pick;
  let n = await count(page); let t0 = Date.now();
  await page.locator('.ck-menu, .ck-pop').last().getByText(pick, { exact: true }).click(); await page.waitForTimeout(800);
  r.ranges = await page.evaluate(() => [...document.querySelectorAll('input[type=range]')].filter(e => e.offsetParent).map(e => e.getAttribute('aria-label') + '=' + e.getAttribute('aria-valuetext')));
  const before = await sample(page, { sky: [400, 200, 400, 60], wall: [440, 520, 40, 40] });
  const lbl = r.ranges.map(s => s.split('=')[0]).find(l => /temp|white|kelvin/i.test(l)) ?? r.ranges.map(s => s.split('=')[0]).find(l => /expos|stops|EV/i.test(l));
  r.lbl = lbl;
  if (lbl) { const s = page.locator(`input[type=range][aria-label="${lbl}"]`).first(); const b = await s.boundingBox(); n = await count(page); t0 = Date.now();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); for (let i = 1; i <= 8; i++) { await page.mouse.move(b.x + b.width / 2 - i * 4, b.y + b.height / 2); await page.waitForTimeout(30); } await page.mouse.up();
    r.render = await waitRender(page, n, t0, 15000); }
  r.before = before; r.after = await sample(page, { sky: [400, 200, 400, 60], wall: [440, 520, 40, 40] });
  r.hist = await page.evaluate(() => document.body.innerText.match(/(You|Auto) [^\n]*/g)?.slice(-3));
  await shot('64-scene-adjusted');
  r.probe = await readProbe();
  return r;
};
