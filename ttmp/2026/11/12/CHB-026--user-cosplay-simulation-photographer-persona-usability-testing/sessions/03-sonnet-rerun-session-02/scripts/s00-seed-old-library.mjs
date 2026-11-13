// Orchestrator setup for session 03, run BEFORE the tester starts: builds "Manfred's library from last week" with
// the build of main before CHB-031 (contract 0.3.0, enlarger mode normalised by default), served at :4650 from
// apps/studio/dist-current. Opens DSC_8541.NEF (tungsten interior) and raw010.dng (3-frame negative strip), makes one
// Lighter step on the NEF, and leaves the profile in sessions/03-…/profile/old-library (git-ignored).
import { chromium } from '@playwright/test';
const ROOT = '/home/manuel/code/wesen/chromobench';
const SES = ROOT + '/ttmp/2026/11/12/CHB-026--user-cosplay-simulation-photographer-persona-usability-testing/sessions/03-sonnet-rerun-session-02';
const ctx = await chromium.launchPersistentContext(SES + '/profile/old-library', { headless: true, viewport: { width: 1440, height: 900 } });
const page = ctx.pages()[0] ?? await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
const tail = async () => (await page.evaluate(() => document.body.innerText)).split('\n').slice(-4).join(' | ');
async function until(re, maxS = 180) {
  for (let i = 0; i < maxS * 2; i++) { await page.waitForTimeout(500); const t = await tail(); if (re.test(t)) return t; }
  throw new Error('timeout: ' + (await tail()));
}
await page.goto('http://localhost:4650/'); await page.waitForTimeout(2000);
await page.setInputFiles('#file', ROOT + '/.playwright-mcp/photos/DSC_8541.NEF');
console.log('8541:', await until(/opened|rendered \d/));
await page.waitForTimeout(4000);
await page.getByRole('button', { name: /Lighter/ }).first().click().catch((e) => console.log('no Lighter button:', String(e).slice(0, 120)));
await page.waitForTimeout(4000);
await page.setInputFiles('#file', ROOT + '/.playwright-mcp/photos/raw010.dng');
console.log('raw010:', await until(/opened|rendered \d/));
await page.waitForTimeout(6000);
const state = await page.evaluate(() => {
  const s = window.chromobench?.store?.get?.() ?? window.chromobench?.rt?.store?.get?.();
  const frames = s?.frames ?? s?.library?.frames;
  return { keys: s ? Object.keys(s).slice(0, 20) : null, n: frames ? Object.keys(frames).length : null };
});
console.log('state:', JSON.stringify(state));
await page.screenshot({ path: SES + '/shots/s00-seeded-old-library.png' });
await ctx.close();
