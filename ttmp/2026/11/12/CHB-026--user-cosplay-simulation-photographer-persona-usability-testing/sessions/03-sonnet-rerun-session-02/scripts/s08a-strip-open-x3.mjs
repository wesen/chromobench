import { launch, goto, bodyText, PHOTOS, uptime } from './lib.mjs';
const res = [];
for (let r = 0; r < 3; r++) {
  const up = uptime().replace(/.*load average:/, 'load');
  const { ctx, page } = await launch(true, 'strip-tmp'); await goto(page);
  const t0 = Date.now(); let opened = -1, first = -1;
  await page.setInputFiles('#file', PHOTOS + '/raw010.dng');
  for (let i = 0; i < 400; i++) { await page.waitForTimeout(200); const l = (await bodyText(page)).split('\n').slice(-4).join(' | '); if (opened < 0 && /opened raw010/.test(l)) opened = (Date.now() - t0) / 1000; if (/rendered \d/.test(l) && !/opening/.test(l)) { first = (Date.now() - t0) / 1000; break; } }
  res.push({ run: r + 1, opened, first, up }); console.log(JSON.stringify(res.at(-1)));
  await ctx.close();
}
const med = (a) => a.sort((x, y) => x - y)[1];
console.log('median opened', med(res.map(x => x.opened)), 'median first picture', med(res.map(x => x.first)));
