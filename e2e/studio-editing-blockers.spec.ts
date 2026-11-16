// CHB-046 in the studio on the WebGPU engine (SwiftShader in CI), synthetic negatives only:
// - D1: Classic opens a file into Print (not the Library), and comes back to Print after a layout switch;
// - P9-1: a mask tool makes one mask and disarms; a click alone (no drag) makes no gradient; a later click on the
//   picture adds nothing to the layer selected then;
// - P9-9: Frame ▸ Apply Print Settings to Selection asks in the page (source, what, onto which frames), the primary is
//   outlined in the film strip, one undo takes it back;
// - F44: Real ↔ Normalised through the visible select keeps the print (pixels within 1/255);
// - P9-6: 60 px of Time is about half a stop, Alt finer, the arrow key ⅓ stop;
// - D5: the Enlarger lists the darkroom in his order with kind badges, By kind is a view, the print does not change.
import { expect, test, type Page } from '@playwright/test';
import { negativeScan, tif } from './scenes.ts';
import { opened } from './support.ts';

const idle = (page: Page) => page.evaluate(() => window.chromobench.idle());
const hook = <T>(page: Page, f: string): Promise<T> => page.evaluate(`(() => { const cb = window.chromobench; return ${f}; })()`) as Promise<T>;
const vp = (page: Page) => page.locator('.ck-vp:visible').first();
const panel = (page: Page, id: string) => page.locator(`.ck-panel[data-panel="${id}"]:visible`).first();
const tool = (page: Page) => hook<string | null>(page, 'cb.state().ui.tool ?? null');
const module = (page: Page) => hook<string>(page, 'cb.rt.module');

async function boot(page: Page, layout: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?nosw&canvas2d&fresh&engine=gpu&layout=${layout}`);
  await page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: 60_000 });
  return errors;
}
async function press(page: Page, from: [number, number], to: [number, number], steps = 5): Promise<void> {
  const b = (await vp(page).boundingBox())!;
  await page.mouse.move(b.x + b.width * from[0], b.y + b.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * to[0], b.y + b.height * to[1], { steps });
  await page.mouse.up();
  await idle(page);
}
/** the print's display values on a 9×9 grid */
const grid = (page: Page) =>
  page.evaluate(() => {
    const s = window.chromobench.size()!;
    const out: number[] = [];
    for (let i = 1; i < 10; i++) for (let j = 1; j < 10; j++) out.push(...(window.chromobench.pixel(Math.floor((s.width * i) / 10), Math.floor((s.height * j) / 10)) ?? []));
    return out;
  });
const maxDiff = (a: number[], b: number[]): number => a.reduce((m, x, i) => Math.max(m, Math.abs(x - b[i]!)), 0);
const mean = (a: number[]): number => a.reduce((s, x) => s + x, 0) / a.length;

test('D1 and P9-1: Classic opens into Print; a mask tool needs a drag, makes one mask and disarms', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await boot(page, 'classic');
  expect(await module(page)).toBe('library');
  await page.setInputFiles('#file', tif('neg-a.tif', negativeScan(240, 160)));
  await opened(page, 1, 120_000);
  // D1: the file opened into Print, with no module click
  expect(await module(page)).toBe('print');
  await expect(vp(page)).toHaveAttribute('data-rendered', /\d+x\d+/);
  // a layout switch with the frame open comes back to Print (it used to land on the Library)
  await hook(page, `cb.run('view.layout', 'darkroom')`);
  await page.waitForFunction(() => document.body.dataset['layout'] === 'darkroom', null, { timeout: 60_000 });
  await hook(page, `cb.run('view.layout', 'classic')`);
  await page.waitForFunction(() => document.body.dataset['layout'] === 'classic', null, { timeout: 60_000 });
  await idle(page);
  expect(await module(page)).toBe('print');

  // P9-1 in Edit: a clarity layer, its Linear tool from the masks panel
  await page.locator('.ck-module[data-module="edit"]').click();
  await panel(page, 'layers-edit').locator('.cb-stack-add').click();
  await page.getByRole('menuitem', { name: 'Clarity', exact: true }).click();
  await idle(page);
  const clarity = await hook<string>(page, `cb.doc.stages.print.stack.order[0]`);
  await panel(page, 'layer-masks-edit').locator('.cb-stack-tool-mask-linear').click();
  expect(await tool(page)).toBe('mask-linear');
  // a click alone: no gradient, the tool stays for the drag
  await press(page, [0.5, 0.4], [0.5, 0.4], 1);
  expect(await hook(page, `cb.doc.stages.print.stack.items['${clarity}'].mask ?? null`)).toBeNull();
  expect(await tool(page)).toBe('mask-linear');
  // a drag: one mask on the clarity layer, and the tool goes
  await press(page, [0.5, 0.3], [0.5, 0.7]);
  const mask = await hook<string>(page, `cb.doc.stages.print.stack.items['${clarity}'].mask`);
  expect(mask).toBeTruthy();
  expect(await tool(page)).toBeNull();
  // a curve, then a click and a drag on the picture: the curve gets no mask (the session's bug), the clarity's mask
  // keeps its one component
  await panel(page, 'layers-edit').locator('.cb-stack-add').click();
  await page.getByRole('menuitem', { name: 'Curve', exact: true }).click();
  await idle(page);
  const curve = await hook<string>(page, `cb.doc.stages.print.stack.order.find((k) => cb.doc.stages.print.stack.items[k].op === 'curve')`);
  await press(page, [0.3, 0.3], [0.3, 0.3], 1);
  await press(page, [0.2, 0.2], [0.6, 0.6]);
  expect(await hook(page, `cb.doc.stages.print.stack.items['${curve}'].mask ?? null`)).toBeNull();
  expect(await hook<number>(page, `cb.doc.masks.items['${mask}'].components.order.length`)).toBe(1);
  // the radial tool too: one ellipse, then no tool
  await hook(page, `cb.tool('mask-radial')`);
  await press(page, [0.4, 0.4], [0.6, 0.6]);
  expect(await hook(page, `cb.doc.stages.print.stack.items['${curve}'].mask ?? null`)).toBeTruthy();
  expect(await tool(page)).toBeNull();
  expect(errors).toEqual([]);
});

test('P9-9: Apply Print Settings asks first, names its source, the primary is outlined, one undo', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await boot(page, 'classic');
  await page.setInputFiles('#file', [tif('roll-1.tif', negativeScan(240, 160)), tif('roll-2.tif', negativeScan(240, 160, { exposure: 0.3 }))]);
  await opened(page, 2, 120_000);
  const ids = await hook<string[]>(page, 'cb.studio.frames.ids()');
  const [a, b] = ids as [string, string];
  await hook(page, `cb.run('frame.select', '${a}')`);
  await hook(page, `cb.set('main.params.time_s', 31.75, 'Time')`);
  await idle(page);
  const before = await hook<number>(page, `cb.studio.doc('${b}').stages.darkroom.stack.items.main.params.time_s`);
  // select both in the strip, the corrected frame last: it is the primary, and outlined
  const cell = (id: string) => page.locator(`.ck-filmstrip:visible .ck-coll-cell[data-key="${id}"]`);
  await cell(b).click();
  await cell(a).click({ modifiers: ['ControlOrMeta'] });
  await expect.poll(() => hook<{ primary: string }>(page, 'cb.state().ui.selection')).toMatchObject({ primary: a });
  await expect(cell(a)).toHaveClass(/is-primary/);
  const outline = await cell(a).locator('.cb-cell').evaluate((el) => getComputedStyle(el).boxShadow);
  expect(outline).not.toBe('none');
  expect(await cell(b).locator('.cb-cell').evaluate((el) => getComputedStyle(el).boxShadow)).toBe('none');
  const cursor = await hook<number>(page, 'cb.log.cursor');
  await page.locator('.ck-menubar-t', { hasText: 'Frame' }).click();
  await page.locator('.ck-menu-i[data-command="print.applyToSelection"]').click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toContainText('Apply the print settings of roll-1.tif?');
  await expect(dlg).toContainText('From roll-1.tif');
  await expect(dlg).toContainText('Onto roll-2.tif');
  await expect(dlg.locator('li[data-path="main.params.time_s"]')).toContainText('Time: 31.75 s');
  // nothing copied while it asks
  expect(await hook<number>(page, `cb.studio.doc('${b}').stages.darkroom.stack.items.main.params.time_s`)).toBe(before);
  await dlg.getByRole('button', { name: 'Apply to 1 frame' }).click();
  await idle(page);
  expect(await hook<number>(page, `cb.studio.doc('${b}').stages.darkroom.stack.items.main.params.time_s`)).toBe(31.75);
  expect(await hook<number>(page, 'cb.log.cursor')).toBe(cursor + 1);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('ControlOrMeta+z');
  await idle(page);
  expect(await hook<number>(page, `cb.studio.doc('${b}').stages.darkroom.stack.items.main.params.time_s`)).toBe(before);
  expect(await hook<number>(page, `cb.studio.doc('${a}').stages.darkroom.stack.items.main.params.time_s`)).toBe(31.75);
  expect(errors).toEqual([]);
});

test('F44 and P9-6: Real ↔ Normalised keeps the print; Time drags half a stop per 60 px, Alt finer, ⅓ stop per key', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await boot(page, 'classic');
  await page.setInputFiles('#file', tif('neg-b.tif', negativeScan(240, 160)));
  await opened(page, 1, 120_000);
  const controls = panel(page, 'controls-darkroom');
  // a print away from the calibration: a long time, some yellow
  await hook(page, `cb.set('main.params.time_s', 31, 'Time')`);
  await hook(page, `cb.set('main.params.filtration', { c: 0, m: 0, y: 15 }, 'Filtration')`);
  await idle(page);
  await expect(vp(page)).toHaveAttribute('data-rendered', /\d+x\d+/);
  const real = await grid(page);
  const lights0 = await hook<number[]>(page, `cb.get('lights.params.logH')`);
  await controls.locator('.cb-arg[data-path="stages.darkroom.medium.mode"] select').selectOption('normalised');
  await idle(page);
  expect(await hook<string>(page, `cb.get('stages.darkroom.medium.mode')`)).toBe('normalised');
  const norm = await grid(page);
  console.log(`[CHB-046 F44 e2e] real mean ${(255 * mean(real)).toFixed(2)}, normalised mean ${(255 * mean(norm)).toFixed(2)}, max diff ${(255 * maxDiff(real, norm)).toFixed(3)}/255`);
  expect(maxDiff(norm, real)).toBeLessThan(1.5 / 255);
  await controls.locator('.cb-arg[data-path="stages.darkroom.medium.mode"] select').selectOption('real');
  await idle(page);
  expect(maxDiff(await grid(page), real)).toBeLessThan(1.5 / 255);
  (await hook<number[]>(page, `cb.get('lights.params.logH')`)).forEach((l, k) => expect(l).toBeCloseTo(lights0[k]!, 5));
  expect(await hook<number>(page, `cb.get('main.params.time_s')`)).toBe(31);

  // P9-6: the Time track
  await hook(page, `cb.set('main.params.time_s', 10, 'Time')`);
  await idle(page);
  const range = controls.locator('.cb-arg[data-path="main.params.time_s"] input.cb-range').first();
  const rb = (await range.boundingBox())!;
  const dragBy = async (dx: number, alt = false) => {
    await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
    if (alt) await page.keyboard.down('Alt');
    await page.mouse.down();
    await page.mouse.move(rb.x + rb.width / 2 + dx, rb.y + rb.height / 2, { steps: 6 });
    await page.mouse.up();
    if (alt) await page.keyboard.up('Alt');
    await idle(page);
    return hook<number>(page, `cb.get('main.params.time_s')`);
  };
  const t1 = await dragBy(60);
  console.log(`[CHB-046 P9-6 e2e] 60 px of Time: 10 → ${t1} s (${Math.log2(t1 / 10).toFixed(3)} st)`);
  expect(Math.log2(t1 / 10)).toBeGreaterThan(0.3);
  expect(Math.log2(t1 / 10)).toBeLessThan(0.7);
  await hook(page, `cb.set('main.params.time_s', 10, 'Time')`);
  await idle(page);
  const t2 = await dragBy(60, true);
  console.log(`[CHB-046 P9-6 e2e] 60 px of Time with Alt: 10 → ${t2} s`);
  expect(Math.abs(Math.log2(t2 / 10))).toBeLessThan(0.1);
  await range.focus();
  await hook(page, `cb.set('main.params.time_s', 10, 'Time')`);
  await idle(page);
  await range.press('ArrowRight');
  await idle(page);
  expect(await hook<number>(page, `cb.get('main.params.time_s')`)).toBeCloseTo(10 * 2 ** (1 / 3), 3);
  expect(errors).toEqual([]);
});

test('D5: the Enlarger in his order with kind badges; By kind is a view; the order does not change the print', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await boot(page, 'darkroom');
  await page.setInputFiles('#file', tif('neg-c.tif', negativeScan(240, 160)));
  await opened(page, 1, 120_000);
  await expect(vp(page)).toHaveAttribute('data-rendered', /\d+x\d+/);
  const enl = panel(page, 'enlarger');
  for (const op of ['Density mask', 'Burn', 'Dodge']) {
    await enl.locator('.cb-stack-add').click();
    await page.getByRole('menuitem', { name: op, exact: true }).click();
    await idle(page);
  }
  const order = await hook<string[]>(page, `cb.doc.stages.darkroom.stack.order`);
  expect(order.slice(0, 2)).toEqual(['main', 'lights']);
  const rows = () => enl.locator('.cb-stack-row').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset['id']));
  // his order: the density mask he made first comes first (by kind it came after the burn and the dodge)
  expect(await rows()).toEqual(order);
  const burn = order.find((k) => /burn/.test(k))!;
  await enl.locator(`.cb-stack-row[data-id="${burn}"] .cb-stack-name`).dblclick();
  await enl.locator('.cb-stack-rename').fill('Sky');
  await enl.locator('.cb-stack-rename').press('Enter');
  await expect(enl.locator(`.cb-stack-row[data-id="${burn}"] .cb-stack-kind`)).toHaveText('Burn');
  await expect(enl.locator('.cb-stack-kinds')).toHaveText('Main exposure · Burn · Dodge · Printer lights · Density mask');
  await enl.locator('.cb-stack-bykind').click();
  // by kind: the main exposure, light added and held back, then the filters and masks (a view: the document keeps his order)
  await expect.poll(rows).toEqual(['main', burn, order.find((k) => /dodge/.test(k)), 'lights', order[2]]);
  await expect(enl.locator('.cb-stack-bykind')).toHaveAttribute('aria-pressed', 'true');
  expect(await hook<string[]>(page, `cb.doc.stages.darkroom.stack.order`)).toEqual(order);
  await enl.locator('.cb-stack-bykind').click();
  await expect.poll(rows).toEqual(order);
  // the order does not change the print: the last layer moved to the top
  await idle(page);
  const p0 = await grid(page);
  await hook(page, `cb.run('layer.move', '${order.at(-1)}', 'main', 'before')`);
  await idle(page);
  expect((await hook<string[]>(page, `cb.doc.stages.darkroom.stack.order`))[0]).toBe(order.at(-1));
  expect(maxDiff(await grid(page), p0)).toBeLessThan(1 / 255);
  expect(errors).toEqual([]);
});
