// CHB-025 visual check: screenshot each studio variant (apps/studio on MockEngine, four frames open) in the given
// looks. Usage (dev server already running on BASE):
//   node shots.mjs <outdir> <prefix> [looks...]    looks: current | craftkit-light | craftkit-dark | chromogen | gray-N
// BASE defaults to http://localhost:4173; VARIANTS=classic,lab narrows the set. Extra shots: lab with an agent's
// proposal waiting (approval card, ribbon), classic's View ▸ Theme menu, the command palette and its other modules (library grid, roll, finish, assistant).
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [out, prefix = 'shot', ...looksArg] = process.argv.slice(2);
const looks = looksArg.length ? looksArg : ['current'];
const BASE = process.env.BASE ?? 'http://localhost:4173';
const VARIANTS = (process.env.VARIANTS ?? 'classic,darkroom,simple,lab,roll,looks,finish').split(',');
const fixture = readFileSync(new URL('../../../../../../fixtures/synthetic/m1-negative-96x64.tif', import.meta.url));
const frames = [0, 1, 2, 3].map((n) => {
  const b = Buffer.from(fixture);
  b[b.length - 2] = (b[b.length - 2] + n) & 0xff;
  return { name: `frame-${n + 1}.tif`, mimeType: 'image/tiff', buffer: b };
});
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium' });
for (const look of looks) {
  const scheme = look === 'craftkit-dark' ? 'dark' : 'light';
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
  for (const v of VARIANTS) {
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(`${BASE}/?nosw&fresh&engine=mock&variant=${v}`);
    await page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: 30000 });
    if (look === 'chromogen') await page.evaluate(() => window.chromobench.run('view.theme.chromogen'));
    else if (look.startsWith('craftkit')) await page.evaluate(() => window.chromobench.run('view.theme.craftkit'));
    else if (look.startsWith('gray-')) await page.evaluate((g) => window.chromobench.run('view.gray.' + g), look.slice(5));
    await page.setInputFiles('#file', frames);
    await page.waitForFunction(() => /rendered/.test(document.querySelector('#status')?.textContent ?? ''), null, { timeout: 30000 }).catch(() => {});
    await page.evaluate(() => window.chromobench.idle());
    await page.waitForTimeout(600);
    const shoot = async (name) => {
      await page.waitForTimeout(300);
      const f = join(out, `${prefix}-${name}-${look}.png`);
      await page.screenshot({ path: f });
      console.log(f, errs.length ? 'ERRORS: ' + errs.join(' | ') : '');
    };
    if (v === 'lab') {
      await page.evaluate(() => { window.chromobench.propose({ 'print.grade': 3 }, 'more contrast'); window.chromobench.propose({ 'print.preflash': 0.01 }, 'softer highlights'); });
      await page.evaluate(() => window.chromobench.idle());
      await page.locator('#pending .show').first().click().catch(() => {});
    }
    await shoot(v);
    if (v === 'classic') {
      // View ▸ Theme open, then the command palette
      await page.locator('.ck-menubar-t', { hasText: 'View' }).click();
      await page.locator('.ck-menu-i', { hasText: /^Theme/ }).hover();
      await shoot(`${v}.menu`);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await page.evaluate(() => window.chromobench.run('app.palette'));
      await page.keyboard.type('gray');
      await shoot(`${v}.palette`);
      await page.keyboard.press('Escape');
    }
    if (v === 'classic')
      for (const m of ['library', 'roll', 'finish', 'assistant']) {
        await page.evaluate((id) => window.chromobench.rt.go(id), m);
        await page.evaluate(() => window.chromobench.idle());
        await shoot(`${v}.${m}`);
      }
    await page.close();
  }
  await ctx.close();
}
await browser.close();
