export default async ({ page, shot, readProbe }) => {
  const r = {};
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Analyse', exact: true }).click();
  let last = ''; const marks = [];
  for (let i = 0; i < 200; i++) { const s = await page.evaluate(() => document.body.innerText.split('\n').slice(-1)[0]); if (s !== last) { marks.push([Date.now() - t0, s.slice(0, 100)]); last = s; } if (Date.now() - t0 > 4000 && !/analys/i.test(s)) break; await page.waitForTimeout(300); }
  r.marks = marks; r.ms = Date.now() - t0;
  r.p1 = await readProbe();
  await page.getByRole('button', { name: /First print/ }).click(); await page.waitForTimeout(1500);
  r.dialog = await page.evaluate(() => document.querySelector('.ck-dialog, [role=dialog]')?.innerText);
  r.p2 = await readProbe();
  await shot('52-roll-analysed');
  r.panel = await page.evaluate(() => { const els = [...document.querySelectorAll('*')].filter(e => e.getBoundingClientRect().y > 70 && e.getBoundingClientRect().y < 880 && e.children.length === 0 && e.innerText?.trim()); return els.map(e => e.innerText.trim()).slice(0, 80).join(' | '); });
  return r;
};
