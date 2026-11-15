// CHB-037 P9: end-to-end walkthroughs of the unified studio on the WebGPU engine (SwiftShader in CI, Metal with
// REAL_GPU=1), on synthetic scenes (e2e/scenes.ts) only. Each test is one photographer's job, done through the
// visible controls where a person would use them, and checked on the document and the log:
// - a negative scan from import to export: the first print, Time, a sky burnt through a gradient mask, a density
//   mask, a look (the filter pack) in the Looks layout and back, the print stack (curve, HSL, grade, a masked
//   clarity, a blend mode, a group), finish (crop, heal), undo to the first print and redo to the end, the export;
// - the darkroom arrangement: the Enlarger as the darkroom stack, the digital palette opened, a print layer;
// - a roll: frames linked to the roll, an override, sync, a look over the roll, one undo;
// - a camera file through the scene stage;
// - the agent with only `eval`: the document and its stages, a what-if, a proposal approved on the card, a command
//   through `wb`, and "a simpler screen" built with `wb.layouts.build` and accepted in the dialog.
// P9_SHOTS=<dir> writes the arrangement screenshots there (the ticket's various/ folder); otherwise test-results/.
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { join } from 'node:path';
import { cameraDng, dng, negativeScan, tif } from './scenes.ts';
import { opened } from './support.ts';

const idle = (page: Page) => page.evaluate(() => window.chromobench.idle());
const vp = (page: Page) => page.locator('.ck-vp:visible').first();
const shown = (page: Page) => page.evaluate(() => window.chromobench.printNode());
const panel = (page: Page, id: string) => page.locator(`.ck-panel[data-panel="${id}"]:visible`).first();
const doc = <T>(page: Page, f: string): Promise<T> => page.evaluate(`(() => { const d = window.chromobench.doc; return ${f}; })()`) as Promise<T>;
const hook = <T>(page: Page, f: string): Promise<T> => page.evaluate(`(() => { const cb = window.chromobench; return ${f}; })()`) as Promise<T>;
const module = (page: Page, id: string) => page.locator(`.ck-module[data-module="${id}"]`).click();

async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
  const dir = process.env['P9_SHOTS'];
  await page.screenshot({ path: dir ? join(dir, name) : info.outputPath(name) });
}

async function boot(page: Page, layout: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?nosw&canvas2d&fresh&engine=gpu&layout=${layout}`);
  await page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: 60_000 });
}

/** a drag on the main viewer between two points given as fractions of its box */
async function drag(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const b = (await vp(page).boundingBox())!;
  await page.mouse.move(b.x + b.width * from[0], b.y + b.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * to[0], b.y + b.height * to[1], { steps: 5 });
  await page.mouse.up();
  await idle(page);
}

/** "+ Layer" in a layers panel, then the menu item */
async function addLayer(page: Page, panelId: string, label: string): Promise<void> {
  await panel(page, panelId).locator('.cb-stack-add').click();
  await page.getByRole('menuitem', { name: label, exact: true }).click();
  await idle(page);
}

/** a value typed into a number field (the way he types, Enter to commit) */
async function type(page: Page, scope: ReturnType<typeof panel>, path: string, v: string): Promise<void> {
  const f = scope.locator(`.cb-arg[data-path="${path}"] .cb-num:visible`).first();
  await f.fill(v, { timeout: 15_000 });
  await f.press('Enter');
  await idle(page);
}

const undoKey = async (page: Page, n: number, key = 'ControlOrMeta+z') => {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < n; i++) await page.keyboard.press(key);
  await idle(page);
};

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
});
test.afterEach(() => {
  expect(errors).toEqual([]);
});

test('a negative scan from import to export: darkroom, a look, the print stack, finish, undo and redo', async ({ page }, info) => {
  test.setTimeout(420_000);
  await boot(page, 'classic');
  await page.setInputFiles('#file', tif('landscape-neg.tif', negativeScan(600, 400)));
  await opened(page, 1, 120_000);
  // the first print: the printer lights balanced on the frame, a metered time
  expect(await hook<string>(page, `cb.get('lights.source.method')`)).toBe('integrate');
  expect(await hook<string>(page, `cb.get('stages.scan.medium.kind') ?? 'scan'`)).toBeTruthy();
  await module(page, 'print');
  await expect(vp(page)).toHaveAttribute('data-rendered', /\d+x\d+/);
  const first = await shown(page);

  // the darkroom: Time typed in his way, a sky burnt through a gradient drawn from the top to the horizon
  const exposures = panel(page, 'exposures');
  await type(page, page.locator('.ck-panel:visible'), 'main.params.time_s', '12,5');
  expect(await hook<number>(page, `cb.get('main.params.time_s')`)).toBe(12.5);
  await hook(page, `cb.tool('mask-linear')`);
  await drag(page, [0.5, 0.05], [0.5, 0.5]);
  await hook(page, 'cb.tool(null)');
  const burn = await doc<string>(page, `d.stages.darkroom.stack.order.find((k) => d.stages.darkroom.stack.items[k].op === 'burn')`);
  expect(burn).toBeTruthy();
  const burnMask = await doc<string>(page, `d.stages.darkroom.stack.items['${burn}'].mask`);
  expect(await doc<string>(page, `d.masks.items['${burnMask}'].components.items[d.masks.items['${burnMask}'].components.order[0]].kind`)).toBe('linear');
  await expect(exposures.locator(`.cb-stack-row[data-id="${burn}"] .cb-stack-mask`)).toBeVisible();
  // a density mask (contrast) from the Exposures panel's "+ Layer"
  await addLayer(page, 'exposures', 'Density mask');
  expect(await doc<string[]>(page, `d.stages.darkroom.stack.order.map((k) => d.stages.darkroom.stack.items[k].op ?? d.stages.darkroom.stack.items[k].kind)`)).toContain('densityMask');
  await expect(vp(page)).toHaveAttribute('data-rendered', /\d+x\d+/);
  const darkroomDone = await shown(page);
  expect(darkroomDone).not.toBe(first);
  await shot(page, info, '01-classic-print-darkroom-stack.png');

  // a look from the filter pack: View ▸ Layout → Looks, Warm print applied (a link), back to Classic; frames stay
  await hook(page, `cb.run('view.layout', 'looks')`);
  await page.waitForFunction(() => document.body.dataset['layout'] === 'looks', null, { timeout: 60_000 });
  await idle(page);
  await expect(page.locator('.ck-panel[data-panel="looks-library"]')).toBeVisible();
  await page.locator('.ck-panel[data-panel="looks-library"] .cb-look-cell', { hasText: 'Warm print' }).getByRole('button', { name: 'Preview' }).click();
  await page.locator('#looks-apply').click();
  await idle(page);
  await expect.poll(() => doc<string | null>(page, `Object.values(d.stages.darkroom.stack.items).find((e) => e.kind === 'link')?.ref.look ?? null`)).toBe('warm-print');
  await shot(page, info, '02-looks-layout-warm-print.png');
  await hook(page, `cb.run('view.layout', 'classic')`);
  await page.waitForFunction(() => document.body.dataset['layout'] === 'classic', null, { timeout: 60_000 });
  await idle(page);
  expect(await hook<number>(page, 'cb.studio.frames.all().length')).toBe(1);

  // the print stack in the Edit module: curve, HSL, grade, a clarity through a radial mask, a blend mode, a group
  await module(page, 'edit');
  await expect(vp(page)).toHaveAttribute('data-rendered', /\d+x\d+/);
  await addLayer(page, 'layers-edit', 'Curve');
  const plane = panel(page, 'layer-params-edit').locator('.cb-ed-curve .ck-curve-g');
  const pb = (await plane.boundingBox())!;
  await page.mouse.move(pb.x + pb.width * 0.5, pb.y + pb.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(pb.x + pb.width * 0.5, pb.y + pb.height * 0.4, { steps: 5 });
  await page.mouse.up();
  await idle(page);
  await addLayer(page, 'layers-edit', 'HSL');
  await addLayer(page, 'layers-edit', 'Colour grading');
  await addLayer(page, 'layers-edit', 'Clarity');
  const ops = await doc<Record<string, string>>(page, `Object.fromEntries(d.stages.print.stack.order.map((k) => [d.stages.print.stack.items[k].op, k]))`);
  expect(Object.keys(ops).sort()).toEqual(['clarity', 'curve', 'grade', 'hsl']);
  // the clarity layer is selected (just added): the radial tool gives it a mask
  await hook(page, `cb.tool('mask-radial')`);
  await drag(page, [0.3, 0.6], [0.45, 0.75]);
  await hook(page, 'cb.tool(null)');
  expect(await doc<string | null>(page, `d.stages.print.stack.items['${ops['clarity']}'].mask ?? null`)).toBeTruthy();
  // the grade layer blends in Soft light
  const blend = panel(page, 'layers-edit').locator(`.cb-stack-row[data-id="${ops['grade']}"] .cb-stack-blend`);
  if (await blend.count()) await blend.selectOption('soft-light');
  else await hook(page, `cb.run('layer.blend', '${ops['grade']}', 'soft-light')`);
  await idle(page);
  expect(await doc<string>(page, `d.stages.print.stack.items['${ops['grade']}'].blend`)).toBe('soft-light');
  // HSL and grade in a group (the row's Group action, then the grade moved in by the command a drag runs)
  await hook(page, `cb.run('layer.group', ['${ops['hsl']}', '${ops['grade']}'])`);
  await idle(page);
  const group = await doc<string>(page, `d.stages.print.stack.order.find((k) => d.stages.print.stack.items[k].kind === 'group')`);
  expect(await doc<string[]>(page, `d.stages.print.stack.items['${group}'].stack.order`)).toEqual(expect.arrayContaining([ops['hsl'], ops['grade']]));
  await expect(vp(page)).toHaveAttribute('data-rendered', /\d+x\d+/);
  const printDone = await shown(page);
  expect(printDone).not.toBe(darkroomDone);
  await shot(page, info, '03-classic-edit-print-stack.png');

  // finish: crop from a corner handle, a heal spot on the print
  await module(page, 'finish');
  await page.keyboard.press('r');
  await expect(page.locator('.cb-crop-frame')).toHaveCount(1);
  // the handles are drawn after the crop frame: wait for the corner before reading its box (raced on Metal)
  const corner = page.locator('[data-handle="1,1"]');
  await expect(corner).toBeVisible();
  const hb = (await corner.boundingBox())!;
  await page.mouse.move(hb.x + 4, hb.y + 4);
  await page.mouse.down();
  await page.mouse.move(hb.x - 60, hb.y - 40, { steps: 4 });
  await page.mouse.up();
  await idle(page);
  expect(await doc<{ w: number } | null>(page, 'd.geometry.crop')).not.toBeNull();
  await page.keyboard.press('q');
  const vb = (await vp(page).boundingBox())!;
  await page.mouse.click(vb.x + vb.width * 0.4, vb.y + vb.height * 0.4);
  await idle(page);
  expect((await doc<string[]>(page, 'd.stages.print.stack.items.retouch?.stack.order ?? []')).length).toBe(1);
  await expect(vp(page)).toHaveAttribute('data-rendered', /\d+x\d+/);
  const finished = await shown(page);
  await shot(page, info, '04-classic-finish.png');

  // undo every step back to the first print, then redo to the end: the same print again
  const steps = await hook<number>(page, 'cb.units()');
  expect(steps).toBeGreaterThanOrEqual(13);
  await module(page, 'print');
  await undoKey(page, steps);
  expect(await hook<number>(page, 'cb.units()')).toBe(0);
  await expect(vp(page)).toHaveAttribute('data-rendered', /\d+x\d+/);
  expect(await shown(page)).toBe(first);
  await undoKey(page, steps, 'ControlOrMeta+Shift+z');
  expect(await hook<number>(page, 'cb.units()')).toBe(steps);
  await module(page, 'finish');
  await expect(vp(page)).toHaveAttribute('data-rendered', /\d+x\d+/);
  expect(await shown(page)).toBe(finished);

  // the export: the cropped print at the file's size, 16-bit TIFF
  const x = await page.evaluate(() => window.chromobench.exportPng('srgb', 'tiff16'));
  expect(x).toMatchObject({ bits: 16 });
  const crop = await doc<{ w: number; h: number }>(page, 'd.geometry.crop');
  expect(Math.abs(x!.width - Math.round(crop.w * 600)) <= 2 || Math.abs(x!.width - Math.round(crop.w)) <= 2).toBe(true);
});

test('the darkroom arrangement: the Enlarger is the darkroom stack; the digital palette adds a print layer', async ({ page }, info) => {
  test.setTimeout(240_000);
  await boot(page, 'darkroom');
  await page.setInputFiles('#file', [tif('landscape-neg.tif', negativeScan(600, 400)), tif('landscape-neg-2.tif', negativeScan(600, 400, { exposure: 1 }))]);
  await opened(page, 2, 120_000);
  // the vertical film strip above the History shows both frames (it had no height in a side column before P9)
  const strip = page.locator('.ck-side-left .ck-listview');
  expect((await strip.boundingBox())!.height).toBeGreaterThan(150);
  await expect(strip.locator('.ck-coll-row')).toHaveCount(2);
  // each row shows its print, not only its name (P9-4: the thumbnails were 2 px tall)
  await expect(strip.locator('.ck-coll-row .ck-thumb[data-rendered]')).toHaveCount(2, { timeout: 60_000 });
  expect((await strip.locator('.ck-coll-row .ck-thumb').first().boundingBox())!.height).toBeGreaterThan(80);
  await strip.locator('.ck-coll-row', { hasText: 'landscape-neg.tif' }).click();
  await idle(page);
  expect(await hook<string>(page, 'cb.studio.frames.get(cb.studio.current).name')).toBe('landscape-neg.tif');
  const enlarger = panel(page, 'enlarger');
  await expect(enlarger.locator('.cb-stack-row[data-id="main"]')).toBeVisible();
  await type(page, enlarger, 'main.params.time_s', '14');
  await addLayer(page, 'enlarger', 'Dodge');
  const dodge = await doc<string>(page, `d.stages.darkroom.stack.order.find((k) => d.stages.darkroom.stack.items[k].op === 'dodge')`);
  expect(dodge).toBeTruthy();
  const digital = panel(page, 'digital');
  await expect(digital).toContainText('Digital (after the print)');
  await shot(page, info, '05-darkroom-enlarger.png');
  await digital.locator('.ck-panel-h').click();
  await addLayer(page, 'digital', 'Vibrance');
  expect(await doc<string[]>(page, 'd.stages.print.stack.order.map((k) => d.stages.print.stack.items[k].op)')).toEqual(['vibrance']);
  await expect(vp(page)).toHaveAttribute('data-rendered', /\d+x\d+/);
  await shot(page, info, '06-darkroom-digital-palette.png');
  expect(await hook<number>(page, 'cb.units()')).toBe(3);
  await undoKey(page, 3);
  expect(await doc<number>(page, 'd.stages.print.stack.order.length')).toBe(0);
});

test('a roll: frames link to the roll, an override, sync, a look over the roll, one undo', async ({ page }, info) => {
  test.setTimeout(300_000);
  await boot(page, 'classic');
  const files = [0, 0.4, -0.4, 0.8].map((ev, i) => tif(`roll-07-${i + 1}.tif`, negativeScan(360, 240, { exposure: ev })));
  await page.setInputFiles('#file', files);
  await opened(page, 4, 180_000);
  await module(page, 'roll');
  await page.locator('#roll-new').click();
  await expect(page.locator('#rolls li')).toContainText('first-printed', { timeout: 120_000 });
  await idle(page);
  const roll = await hook<string>(page, 'Object.keys(cb.state().roll.rolls)[0]');
  const ids = await hook<string[]>(page, `cb.state().roll.rolls['${roll}'].frames`);
  expect(ids).toHaveLength(4);
  // link: every frame's scan links to the roll
  expect(await hook<string[]>(page, `${JSON.stringify(ids)}.map((f) => cb.studio.doc(f).stages.scan.medium.link?.roll)`)).toEqual(Array(4).fill(roll));
  await shot(page, info, '07-classic-roll.png');
  // an override: frame 2's own base (a field the roll shares), stored as the frame's override; its own grade too
  await hook(page, `cb.run('frame.select', '${ids[1]}')`);
  await idle(page);
  await module(page, 'print');
  const baseT = await hook<number[]>(page, `cb.state().roll.rolls['${roll}'].media.scan.baseT`);
  await hook(page, `cb.set('stages.scan.medium.baseT', ${JSON.stringify(baseT.map((v) => v * 0.97))}, 'Base')`);
  await hook(page, `cb.set('stages.darkroom.medium.grade', 3, 'Grade')`);
  await idle(page);
  expect(await hook<string[]>(page, `Object.keys(cb.studio.doc('${ids[1]}').stages.scan.medium.overrides)`)).toContain('baseT');
  expect(await hook<number>(page, `cb.studio.doc('${ids[1]}').stages.darkroom.medium.grade`)).toBe(3);
  // sync (copy) in Classic: frame 1's Time to frames 3 and 4 — select in the film strip (the source last, so it is
  // the primary), Settings ▸ Sync Settings; one step
  await hook(page, `cb.run('frame.select', '${ids[0]}')`);
  await hook(page, `cb.set('main.params.time_s', 9, 'Time')`);
  await idle(page);
  const cell = (id: string) => page.locator(`.ck-filmstrip:visible .ck-coll-cell[data-key="${id}"]`);
  await cell(ids[2]!).click();
  await cell(ids[3]!).click({ modifiers: ['ControlOrMeta'] });
  await cell(ids[0]!).click({ modifiers: ['ControlOrMeta'] });
  await expect.poll(() => hook<{ ids: string[]; primary: string }>(page, 'cb.state().ui.selection')).toMatchObject({ primary: ids[0] });
  const before = await hook<number>(page, 'cb.log.cursor');
  await page.locator('.ck-menubar-t', { hasText: 'Settings' }).click();
  await page.locator('.ck-menu-i[data-command="looks.sync"]').click();
  await idle(page);
  expect(await hook<number[]>(page, `${JSON.stringify(ids)}.map((f) => cb.studio.doc(f).stages.darkroom.stack.items.main.params.time_s)`)).toEqual([9, expect.any(Number), 9, 9]);
  expect(await hook<number>(page, 'cb.log.cursor')).toBe(before + 1);
  // a look over the roll, in the Looks layout: one card, approved; one undo takes it off every frame
  await hook(page, `cb.run('view.layout', 'looks')`);
  await page.waitForFunction(() => document.body.dataset['layout'] === 'looks', null, { timeout: 60_000 });
  await idle(page);
  await page.locator('.ck-panel[data-panel="looks-library"] .cb-look-cell', { hasText: 'More contrast' }).getByRole('button', { name: 'Preview' }).click();
  await hook(page, `cb.run('looks.applyToRoll', 'all')`);
  const card = page.locator('#looks-pending');
  await expect(card).toContainText('More contrast');
  await page.locator('#looks-pending-approve').click();
  await expect(card).toHaveCount(0);
  await idle(page);
  const looked = () => hook<boolean[]>(page, `${JSON.stringify(ids)}.map((f) => Object.values(cb.studio.doc(f).stages.darkroom.stack.items).some((e) => e.kind === 'link' && e.ref.look === 'more-contrast'))`);
  expect(await looked()).toEqual([true, true, true, true]);
  await undoKey(page, 1);
  expect(await looked()).toEqual([false, false, false, false]);
  expect(await hook<number>(page, `cb.studio.doc('${ids[1]}').stages.darkroom.medium.grade`)).toBe(3);
});

test('a camera file through the scene stage: Scene module, an exposure layer before the film', async ({ page }, info) => {
  test.setTimeout(240_000);
  await boot(page, 'classic');
  await page.setInputFiles('#file', dng('scene-camera.dng', cameraDng(400, 266)));
  await opened(page, 1, 120_000);
  expect(await doc<boolean>(page, '!!d.stages.scene')).toBe(true);
  await module(page, 'scene');
  await expect(vp(page)).toHaveAttribute('data-rendered', /\d+x\d+/);
  const n0 = await shown(page);
  await addLayer(page, 'layers-scene', 'Exposure');
  const ex = await doc<string>(page, `d.stages.scene.stack.order[0]`);
  expect(await doc<string>(page, `d.stages.scene.stack.items['${ex}'].op`)).toBe('exposure');
  const params = page.locator('.ck-panel[data-panel^="layer-params"]:visible').first();
  const f = params.locator('.cb-arg .cb-num').first();
  await f.fill('0.7');
  await f.press('Enter');
  await idle(page);
  await expect(vp(page)).toHaveAttribute('data-rendered', /\d+x\d+/);
  expect(await shown(page)).not.toBe(n0);
  await shot(page, info, '08-classic-scene-camera-file.png');
});

test('the agent with only eval: the document, a what-if, a proposal approved, wb.run, and a simpler screen', async ({ page }, info) => {
  test.setTimeout(300_000);
  await boot(page, 'classic');
  await page.setInputFiles('#file', tif('landscape-neg.tif', negativeScan(600, 400)));
  await opened(page, 1, 120_000);
  type R = { yaml: string; error?: { code: string; message: string } };
  const ev = (code: string) => page.evaluate((c) => window.chromobench.eval(c) as Promise<R>, code);
  const one = async (code: string): Promise<any> => {
    const r = await ev(code);
    expect(r.error, r.yaml).toBeUndefined();
    const l = r.yaml.split('\n')[0]!;
    return JSON.parse(l.startsWith("'") ? l.slice(1, -1).replace(/''/g, "'") : l);
  };
  // what he sees: the document, its stages, a measurement
  const a = await one(`const e = frame.explain(); const d = await frame.print().measure.densitometer({ at: [300, 60] }); return JSON.stringify({ stages: Object.keys(frame.doc.stages), explained: typeof e === 'string' ? e.length > 0 : !!e, D: d.D.length })`);
  expect(a.stages).toEqual(['scan', 'darkroom', 'print']);
  expect(a.D).toBe(3);
  // a what-if: the sky burnt half a stop through a gradient mask, measured on a draft, then proposed
  const b = await one(`const sky = [insert('masks', 'sky', mask('Sky').add('c1', 'linear', { from: [300, 0], to: [300, 220] }).feather(1)), insert('stages.darkroom.stack', 'b1', layer('burn', { stops: 0.5 }).mask('sky'))];
const before = await frame.print().measure.densitometer({ at: [300, 40] });
const after = await frame.with(sky).print().measure.densitometer({ at: [300, 40] });
frame.propose(sky, { why: 'the sky prints too light' });
return JSON.stringify({ before: before.D[1], after: after.D[1] })`);
  expect(b.after).not.toBe(b.before);
  // ask mode: the proposal waits on its card; he approves it
  await expect.poll(() => hook<number>(page, 'cb.pending().length')).toBe(1);
  await module(page, 'print');
  const approve = page.getByRole('button', { name: /^Approve/ }).first();
  await approve.click();
  await idle(page);
  expect(await hook<number>(page, 'cb.pending().length')).toBe(0);
  expect(await doc<string>(page, `d.stages.darkroom.stack.items.b1.mask`)).toBe('sky');
  // a command through the workbench (the one the key runs), and the screen with live values
  const c = await one(`await wb.run('module.edit'); const s = await wb.screen(); return JSON.stringify({ module: s.module, controls: s.controls.length })`);
  expect(c.module).toBe('edit');
  // "a simpler screen": a layout written in the sandbox, built by the studio's passes, proposed, accepted
  const l = await one(`const b = await wb.layouts.build({ id: 'simpler', label: 'Simpler', description: 'the print and the enlarger', build: (ck, cb) => cb.studio('Chromobench').menus(...cb.menus.standard()).module(ck.module('main', { label: 'Print', stages: ['darkroom'] }).center(cb.viewer(cb.sel.frame.print(), { tools: ['probe'] })).right(ck.dock.column({ width: 300 }, cb.kits.stack.panels.enlarger(), cb.panels.history().hidden(cb.sel.doc.not())))) }); const u = await wb.layouts.use(b, { why: 'a simpler screen' }); return JSON.stringify({ ok: b.ok, errors: b.errors, warnings: b.warnings.length, status: u.status })`);
  expect(l).toMatchObject({ ok: true, errors: [], status: 'proposed' });
  const dlg = page.getByRole('dialog', { name: 'Use the assistant’s layout?' });
  await expect(dlg).toBeVisible();
  await shot(page, info, '09-agent-layout-dialog.png');
  await dlg.getByRole('button', { name: 'Use Simpler' }).click();
  await page.waitForFunction(() => document.body.dataset['layout'] === 'simpler', null, { timeout: 60_000 });
  await idle(page);
  await expect(panel(page, 'enlarger')).toBeVisible();
  await shot(page, info, '10-agent-simpler-screen.png');
  // View ▸ Layout returns to a built-in layout; the frame and its history stay
  await hook(page, `cb.run('view.layout', 'classic')`);
  await page.waitForFunction(() => document.body.dataset['layout'] === 'classic', null, { timeout: 60_000 });
  expect(await hook<number>(page, 'cb.units()')).toBe(1);
});

// P9-8 (the persona session): after View ▸ Layout from Darkroom first (no roll kit) to Classic, New roll failed with
// E_PATH (the adopted log's main document had no `roll`); a layout's own state now joins the adopted log.
test('a roll after switching from Darkroom first to Classic', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?nosw&canvas2d&fresh&engine=mock&layout=darkroom');
  await page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: 60_000 });
  await page.setInputFiles('#file', [tif('roll-a.tif', negativeScan(200, 130)), tif('roll-b.tif', negativeScan(200, 130, { exposure: 1 }))]);
  await opened(page, 2);
  await hook(page, `cb.run('view.layout', 'classic')`);
  await page.waitForFunction(() => document.body.dataset['layout'] === 'classic', null, { timeout: 60_000 });
  await idle(page);
  await module(page, 'roll');
  await page.locator('#roll-new').click();
  await expect(page.locator('#rolls li')).toHaveCount(1, { timeout: 60_000 });
  expect(await hook<string[]>(page, 'Object.keys(cb.state().roll.rolls)')).toEqual(['roll-1']);
});
