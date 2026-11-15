// The stack kit's editors in Chromium (studio-kit dev host, MockEngine, core's numbers through editorMath): the
// classic Edit module's Layer panel shows the curve (add, drag, channel, delete), levels (the stage input's
// histogram, the black handle dragged, the midtone handle by keys), the HSL bands (typed, keys, band widths), the
// colour grading wheels (a drag, a reset), the channel mixer (typed, scrubbed, monochrome), and the colour-mask
// eyedropper (Sample, then a click on the print). Every gesture is one step and one undo.
import { expect, test, type Locator, type Page } from '@playwright/test';

const errors: string[] = [];
test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (e) => errors.push(e.message));
});
test.afterEach(() => {
  expect(errors).toEqual([]);
});

async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/demo/?layout=classic&fresh');
  await page.waitForFunction(() => document.body.dataset['ready'] === '1');
  await page.locator('.ck-module[data-module="edit"]').click();
}
const hook = <T>(page: Page, f: string): Promise<T> => page.evaluate(`(() => { const cb = window.chromobench; return ${f}; })()`) as Promise<T>;
const params = (page: Page, id: string) => hook<Record<string, any>>(page, `cb.doc().stages.print.stack.items['${id}'].params`);
const steps = (page: Page) => hook<number>(page, 'cb.log().inEffect(cb.studio.current).length');
const panel = (page: Page, id: string) => page.locator(`.ck-panel[data-panel="${id}"]`).first();
const editor = (page: Page, op: string) => panel(page, 'layer-params-edit').locator(`.cb-stack-editor[data-op="${op}"]`);

async function addLayer(page: Page, word: string): Promise<void> {
  await panel(page, 'layers-edit').locator('.cb-stack-add').click();
  await page.getByRole('menuitem', { name: word, exact: true }).click();
}
/** undo n steps from the keyboard (the focus off any field) */
async function undo(page: Page, n: number): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < n; i++) await page.keyboard.press('ControlOrMeta+z');
}
/** a point of a plane in page px, from fractions (y up) */
async function at(l: Locator, x: number, y: number): Promise<[number, number]> {
  const b = (await l.boundingBox())!;
  return [b.x + b.width * x, b.y + b.height * (1 - y)];
}

test('curve: click adds a point on the curve, a drag moves it, R channel, double-click deletes; core\'s curve drawn; undo', async ({ page }) => {
  await open(page);
  await addLayer(page, 'Curve');
  const ed = editor(page, 'curve');
  const plane = ed.locator('.ck-curve-g');
  await expect(plane).toBeVisible();
  // the generic controls do not repeat what the editor covers
  await expect(panel(page, 'layer-params-edit').locator('.cb-arg[data-path="curve1.params.channel"]')).toHaveCount(0);
  // the stage input's histogram behind the curve
  await expect(plane.locator('.ck-curve-hist')).toHaveAttribute('d', /^M0 /);
  expect(Object.keys((await params(page, 'curve1')).points.items)).toEqual(['curve1p1', 'curve1p2']);
  // a click adds a point on the curve
  let [x, y] = await at(plane, 0.25, 0.25);
  await page.mouse.click(x, y);
  await expect(plane.locator('.ck-curve-pt')).toHaveCount(3);
  const p1 = await params(page, 'curve1');
  expect(p1.points.order).toEqual(['curve1p1', 'curve1p3', 'curve1p2']);
  expect(p1.points.items.curve1p3.x).toBeCloseTo(0.25, 1);
  expect(await steps(page)).toBe(2);
  // drag it up: one step
  await page.mouse.move(x, y);
  await page.mouse.down();
  [x, y] = await at(plane, 0.25, 0.45);
  await page.mouse.move(x, y, { steps: 6 });
  await page.mouse.up();
  const p2 = await params(page, 'curve1');
  expect(p2.points.items.curve1p3.y).toBeCloseTo(0.45, 1);
  expect(await steps(page)).toBe(3);
  // the drawn curve goes through the point (core's curve, monotone: never above the next point)
  const d = (await ed.locator('.ck-curve-p').getAttribute('d'))!;
  expect(d.split('L').length).toBe(65);
  // the channel: one step; the curve keeps its points
  await ed.locator('.cb-ed-seg [data-value="R"]').click();
  expect((await params(page, 'curve1')).channel).toBe('R');
  await expect(ed.locator('.cb-ed-seg [data-value="R"]')).toHaveClass(/is-on/);
  expect(await steps(page)).toBe(4);
  // a double-click on the point deletes it: one step
  await page.mouse.dblclick(x, y);
  await expect(plane.locator('.ck-curve-pt')).toHaveCount(2);
  expect((await params(page, 'curve1')).points.order).toEqual(['curve1p1', 'curve1p2']);
  expect(await steps(page)).toBe(5);
  // undo walks back: the point, the channel, the drag, the point
  await undo(page, 4);
  const p0 = await params(page, 'curve1');
  expect(p0.channel).toBe('L');
  expect(p0.points.order).toEqual(['curve1p1', 'curve1p2']);
  await expect(plane.locator('.ck-curve-pt')).toHaveCount(2);
});

test('levels: the stage input\'s histogram, the black handle dragged, the midtones by keys; each one step', async ({ page }) => {
  await open(page);
  await addLayer(page, 'Levels');
  const ed = editor(page, 'levels');
  await expect(ed.locator('.cb-ed-hist-a')).toHaveAttribute('d', /^M0 /);
  // the catalogue's sliders stay for typed values, output black and white under More
  await expect(panel(page, 'layer-params-edit').locator('.cb-arg[data-path="levels1.params.black"]')).toBeVisible();
  const bar = ed.locator('.cb-ed-handles');
  const h = (await ed.locator('.cb-ed-handle.is-black').boundingBox())!;
  const b = (await bar.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.2, h.y + h.height / 2, { steps: 5 });
  await page.mouse.up();
  expect((await params(page, 'levels1')).black).toBeCloseTo(0.2, 1);
  expect(await steps(page)).toBe(2);
  await expect(ed.locator('.cb-ed-read')).toContainText('Black 20 %');
  // the midtone handle: three presses, one step; left darkens the midtones (gamma > 1 means brighter: here it falls)
  await ed.locator('.cb-ed-handle.is-gamma').focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  const g = (await params(page, 'levels1')).gamma;
  expect(g).toBeLessThan(1);
  expect(await steps(page)).toBe(3);
  await undo(page, 2);
  const p = await params(page, 'levels1');
  expect([p.black, p.gamma]).toEqual([0, 1]);
});

test('HSL: eight bands; hue typed, keys coalesce, band widths; each one step', async ({ page }) => {
  await open(page);
  await addLayer(page, 'HSL');
  const ed = editor(page, 'hsl');
  await expect(ed.locator('.cb-ed-bands .cb-ed-band')).toHaveCount(8);
  await expect(ed.locator('.cb-ed-bands')).toContainText('Magenta');
  await ed.locator('.cb-ed-seg [data-value="hue_deg"]').click();
  const orange = ed.locator('.cb-ed-bands .cb-stack-num[data-path="hsl1b2.hue_deg"]');
  await orange.locator('.cb-num').fill('+15');
  await orange.locator('.cb-num').press('Enter');
  expect((await params(page, 'hsl1')).bands.items.hsl1b2.hue_deg).toBe(15);
  // saturation of red by keys: two presses, one step
  await ed.locator('.cb-ed-seg [data-value="saturation"]').click();
  const red = ed.locator('.cb-ed-bands .cb-stack-num[data-path="hsl1b1.saturation"] .cb-range');
  await red.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  expect((await params(page, 'hsl1')).bands.items.hsl1b1.saturation).toBeCloseTo(0.02, 6);
  // typed in percent
  const sat = ed.locator('.cb-ed-bands .cb-stack-num[data-path="hsl1b6.saturation"] .cb-num');
  await sat.fill('-40');
  await sat.press('Enter');
  expect((await params(page, 'hsl1')).bands.items.hsl1b6.saturation).toBe(-0.4);
  await ed.locator('.cb-ed-widths > summary').click();
  const w = ed.locator('.cb-ed-widths .cb-stack-num[data-path="hsl1b1.width_deg"] .cb-num');
  await w.fill('60');
  await w.press('Enter');
  expect((await params(page, 'hsl1')).bands.items.hsl1b1.width_deg).toBe(60);
  expect(await steps(page)).toBe(5);
  await undo(page, 4);
  const b = (await params(page, 'hsl1')).bands.items;
  expect([b.hsl1b2.hue_deg, b.hsl1b1.saturation, b.hsl1b6.saturation, b.hsl1b1.width_deg]).toEqual([0, 0, 0, 45]);
});

test('colour grading: a drag in the shadows wheel sets hue and strength in one step; double-click the dot clears it', async ({ page }) => {
  await open(page);
  await addLayer(page, 'Colour grading');
  const ed = editor(page, 'grade');
  await expect(ed.locator('.cb-ed-wheel')).toHaveCount(3);
  const disc = ed.locator('.cb-ed-wheel[data-wheel="shadows"] .ck-wheel-d');
  const b = (await disc.boundingBox())!;
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  // to the right, half way out: hue 90°, strength half the rim
  await page.mouse.move(cx + (b.width / 2 - 4) * 0.5, cy, { steps: 6 });
  await page.mouse.up();
  const p = await params(page, 'grade1');
  expect(p.shadowsHue_deg).toBeCloseTo(90, 0);
  expect(p.shadowsChroma).toBeGreaterThan(0.04);
  expect(p.shadowsChroma).toBeLessThan(0.06);
  expect(await steps(page)).toBe(2);
  await expect(ed.locator('.cb-ed-wheel[data-wheel="shadows"] .cb-ed-read')).toContainText('90°');
  // the lightness under the wheel, typed in percent
  const lum = ed.locator('.cb-ed-wheel[data-wheel="highlights"] .cb-num');
  await lum.fill('20');
  await lum.press('Enter');
  expect((await params(page, 'grade1')).highlightsLightness).toBe(0.2);
  await ed.locator('.cb-ed-wheel[data-wheel="shadows"] .ck-wheel-p').dblclick();
  expect((await params(page, 'grade1')).shadowsChroma).toBe(0);
  expect(await steps(page)).toBe(4);
  await undo(page, 3);
  const q = await params(page, 'grade1');
  expect([q.shadowsChroma, q.highlightsLightness]).toEqual([0, 0]);
});

test('channel mixer: a cell typed, a cell scrubbed, monochrome switches to the grey row; each one step', async ({ page }) => {
  await open(page);
  await addLayer(page, 'Channel mixer');
  const ed = editor(page, 'mixer');
  const cell = (arg: string, k: number) => ed.locator(`.cb-ed-cell[data-arg="${arg}"][data-k="${k}"]`);
  await expect(cell('grey', 0)).toBeHidden();
  await cell('red', 0).click();
  await cell('red', 0).fill('0.8');
  await cell('red', 0).press('Enter');
  expect((await params(page, 'mixer1')).red).toEqual([0.8, 0, 0]);
  await expect(ed.locator('.cb-ed-sum').first()).toHaveText('0.80');
  // scrub: drag the green row's G cell sideways
  const b = (await cell('green', 1).boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 40, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
  expect((await params(page, 'mixer1')).green[1]).toBeCloseTo(1.2, 2);
  await ed.locator('.cb-ed-mono').check();
  expect((await params(page, 'mixer1')).monochrome).toBe(true);
  await expect(cell('grey', 0)).toBeVisible();
  await expect(cell('red', 0)).toBeHidden();
  expect(await steps(page)).toBe(4);
  await undo(page, 3);
  const p = await params(page, 'mixer1');
  expect([p.red, p.green, p.monochrome]).toEqual([[1, 0, 0], [0, 1, 0], false]);
});

test('eyedropper: Sample, then a click on the print writes the colour range\'s colour (one step); the tool adds a range', async ({ page }) => {
  await open(page);
  await addLayer(page, 'Vibrance');
  const masks = panel(page, 'layer-masks-edit');
  await masks.locator('.cb-stack-new-colour').click();
  const colour = () => hook<number[]>(page, `cb.doc().masks.items.m1.components.items.m1c1.params.colour`);
  expect(await colour()).toEqual([0.7, 0, 0]);
  const row = masks.locator('.cb-ed-colour');
  const swatch0 = await row.locator('.cb-ed-swatch').evaluate((e) => (e as HTMLElement).style.background);
  const n0 = await steps(page);
  await row.locator('.cb-stack-sample').click();
  await expect(row.locator('.cb-stack-sample')).toHaveAttribute('aria-pressed', 'true');
  const vp = page.locator('.ck-vp:visible').first();
  const b = (await vp.boundingBox())!;
  // the blue patch in the middle of the synthetic print
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await expect.poll(colour).not.toEqual([0.7, 0, 0]);
  const c = await colour();
  expect(c[0]).toBeGreaterThan(0.2);
  expect(c[2]).toBeLessThan(0); // blue: OkLab b < 0
  expect(await steps(page)).toBe(n0 + 1);
  await expect(row.locator('.cb-stack-sample')).toHaveAttribute('aria-pressed', 'false');
  expect(await row.locator('.cb-ed-swatch').evaluate((e) => (e as HTMLElement).style.background)).not.toBe(swatch0);
  // the tool alone: a click adds another colour range to the mask (combined by the Draw choice)
  await masks.locator('.cb-stack-tool-mask-colour').click();
  await page.mouse.click(b.x + b.width * 0.1, b.y + b.height / 2);
  await expect(masks.locator('.cb-stack-comp')).toHaveCount(2);
  expect(await steps(page)).toBe(n0 + 2);
  await undo(page, 2);
  expect(await colour()).toEqual([0.7, 0, 0]);
  await expect(masks.locator('.cb-stack-comp')).toHaveCount(1);
});
