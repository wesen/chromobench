import { launch, goto, bodyText, PHOTOS } from './lib.mjs';
import { execSync } from 'node:child_process';
const res = [];
for (let r = 0; r < 3; r++) {
  const up = execSync('uptime').toString().trim().replace(/.*load average:/, 'load');
  const { ctx, page } = await launch(true, 'cold-tmp');
  await goto(page);
  const t0 = Date.now(); let opened = -1, first = -1;
  await page.setInputFiles('#file', PHOTOS + '/DSC_8559.NEF');
  for (let i = 0; i < 400; i++) {
    await page.waitForTimeout(200);
    const l = (await bodyText(page)).split('\n').slice(-4).join(' | ');
    if (opened < 0 && /opened DSC/.test(l)) opened = (Date.now() - t0) / 1000;
    if (/rendered \d/.test(l) && !/opening/.test(l)) { first = (Date.now() - t0) / 1000; break; }
  }
  res.push({ run: r + 1, opened, first, up }); console.log(JSON.stringify(res.at(-1)));
  await ctx.close();
}
const med = (a) => a.sort((x, y) => x - y)[1];
console.log('median opened', med(res.map((x) => x.opened)), 'median first picture', med(res.map((x) => x.first)));
