// M1 walking skeleton (guide §5.12): open a 16-bit TIFF, render through the mock chain, drag the
// generated red printer-light slider +4 points (preview during the drag, one apply on release),
// undo, then an agent proposal in ask mode that is approved.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const golden = JSON.parse(readFileSync(new URL('../fixtures/golden/contract.json', import.meta.url), 'utf8')).m1Trace;
const FIXTURE = new URL('../fixtures/synthetic/m1-negative-96x64.tif', import.meta.url).pathname;
const P = { x: 48, y: 32 };

async function idle(page: Page): Promise<void> {
  await page.evaluate(() => window.chromobench.idle());
}
const pixel = (page: Page) => page.evaluate(({ x, y }) => window.chromobench.pixel(x, y), P);
const hash = (page: Page) => page.evaluate(() => window.chromobench.log!.stateHash);
// The studio (CHB-009) presents through WebGPU (Display P3) with a viewport transform, so the
// canvas pixel of a document pixel is read back through the presenter's own pipeline.
const canvasPixel = (page: Page) => page.evaluate(({ x, y }) => window.chromobench.canvasPixel(x, y), P);

function near(a: number[] | null, b: number[], tol = 1e-4): void {
  expect(a).not.toBeNull();
  b.forEach((v, i) => expect(Math.abs(a![i]! - v), `component ${i}: ${a![i]} vs ${v}`).toBeLessThanOrEqual(tol));
}

test('M1: open, drag +4 pt red, undo, agent proposal approved', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');

  // 1. open the fixture: frame.add with the default recipe, by 'auto'
  await page.setInputFiles('#file', FIXTURE);
  await expect(page.locator('#status')).toContainText('rendered');
  await idle(page);
  const p0 = await pixel(page);
  near(p0, golden.before.display);
  expect(await canvasPixel(page)).toEqual(golden.before.display.map((v: number) => Math.round(v * 255)));
  const s0 = await hash(page);
  expect(await page.evaluate(() => window.chromobench.log!.why('print.lights.logH')[0]!.by)).toBe('auto');

  // 2. drag the generated red slider: previews for each detent, no journal entries, hash unchanged
  const red = page.getByRole('slider', { name: 'Printer lights R' });
  await expect(red).toHaveAttribute('min', '-60');
  for (let n = 1; n <= 4; n++) {
    await red.evaluate((el: HTMLInputElement, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, n);
    await idle(page);
    const st = await page.evaluate(() => ({ red: window.chromobench.log!.state.print.lights.logH[0], entries: window.chromobench.log!.entries.length, hash: window.chromobench.log!.stateHash }));
    expect(st.red).toBeCloseTo(0.025 * n, 12);
    expect(st.entries).toBe(0);
    expect(st.hash).toBe(s0);
  }
  // release: exactly one apply
  await red.evaluate((el: HTMLInputElement) => el.dispatchEvent(new Event('change', { bubbles: true })));
  await idle(page);
  const after = await page.evaluate(() => ({ entries: window.chromobench.log!.entries.length, units: window.chromobench.log!.units.length }));
  expect(after).toEqual({ entries: 1, units: 1 });
  const p1 = await pixel(page);
  near(p1, golden.after.display);
  expect(p1![0]).toBeLessThan(p0![0]!);
  const s1 = await hash(page);
  expect(s1).not.toBe(s0);
  // upper nodes were not recomputed for the lights change
  const runs = await page.evaluate(() => window.chromobench.chainRuns());
  expect(runs.slice(0, 4)).toEqual([{ op: 'source.open', runs: 1 }, { op: 'scan.density', runs: 1 }, { op: 'invert.dyes', runs: 1 }, { op: 'print.expose', runs: 1 }]);

  // 3. undo: pixel and state hash return exactly
  await page.click('#undo');
  await idle(page);
  expect(await hash(page)).toBe(s0);
  expect(await pixel(page)).toEqual(p0);
  await expect(red).toHaveValue('0');

  // 4. agent proposal in ask mode: pending, pixel unchanged; approval matches step 2
  await page.evaluate(() => window.chromobench.propose({ 'print.lights.logH': [0.1, 0, 0] }, '+4 pt red'));
  await idle(page);
  await expect(page.locator('#pending li')).toHaveCount(1);
  expect(await pixel(page)).toEqual(p0);
  expect(await hash(page)).toBe(s0);
  await page.locator('#pending .approve').click();
  await idle(page);
  await expect(page.locator('#pending li')).toHaveCount(0);
  expect(await pixel(page)).toEqual(p1);
  expect(await hash(page)).toBe(s1);
  const last = await page.evaluate(() => window.chromobench.log!.why('print.lights.logH').at(-1));
  expect(last).toMatchObject({ by: 'agent', approvedBy: 'user' });
  await expect(page.locator('#why')).toContainText('approved');
  expect(errors).toEqual([]);
});

test('M1: a stale proposal is refused with E_STALE', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('#file', FIXTURE);
  await expect(page.locator('#status')).toContainText('rendered');
  await page.evaluate(() => window.chromobench.propose({ 'print.lights.logH': [0.1, 0, 0] }));
  const red = page.getByRole('slider', { name: 'Printer lights G' });
  await red.evaluate((el: HTMLInputElement) => { el.value = '2'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await idle(page);
  const h = await hash(page);
  await page.locator('#pending .approve').click();
  await expect(page.locator('#status')).toContainText('E_STALE');
  expect(await hash(page)).toBe(h);
});
