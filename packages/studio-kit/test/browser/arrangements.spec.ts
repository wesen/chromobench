// The arrangements of CHB-035 §33 in Chromium (studio-kit dev host, MockEngine), and the two behaviour fixes:
// - classic: Library, Roll, Print, Edit, Finish as separate screens; the same row everywhere;
// - darkroom: one screen, the Enlarger as the darkroom stack (the main exposure's controls in its row), a collapsed
//   digital palette labelled as acting after the print, opened to add a clarity layer;
// - finish: the finish view of the print stack (retouch and clarity) shows a spot as a row;
// - ratings are undoable steps (a mis-rating is one Mod+Z); the History jump asks before crossing other frames.
import { expect, test, type Page } from '@playwright/test';

const errors: string[] = [];
test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', e => errors.push(e.message));
});
test.afterEach(() => {
  expect(errors).toEqual([]);
});

async function open(page: Page, layout: string): Promise<void> {
  await page.goto(`/demo/?layout=${layout}&fresh`);
  await page.waitForFunction(() => document.body.dataset['ready'] === '1');
}
const hook = <T>(page: Page, f: string): Promise<T> => page.evaluate(`(() => { const cb = window.chromobench; return ${f}; })()`) as Promise<T>;
const panel = (page: Page, id: string) => page.locator(`.ck-panel[data-panel="${id}"]`).first();

test('classic: the modules, each stage in its own screen with the same row component', async ({ page }) => {
  await open(page, 'classic');
  const tabs = await page.locator('.ck-module').allInnerTexts();
  expect(tabs.map(t => t.trim())).toEqual(['Library', 'Roll', 'Print', 'Edit', 'Finish', 'Assistant', 'Output']);
  await page.locator('.ck-module[data-module="print"]').click();
  await expect(panel(page, 'exposures').locator('.cb-stack-row')).toHaveCount(2);
  await page.locator('.ck-module[data-module="edit"]').click();
  await expect(panel(page, 'layers-edit')).toContainText('Applied from the top down; amount is opacity.');
  await page.locator('.ck-module[data-module="finish"]').click();
  await expect(panel(page, 'finish-layers')).toBeVisible();
  // the explain names the stages each module shows
  const text = await hook<string>(page, 'cb.explain()');
  expect(text).toMatch(/module print "Print" key D stages darkroom/);
  expect(text).toMatch(/module edit "Edit" key Mod\+Alt\+E stages print/);
});

test('darkroom: the Enlarger is the darkroom stack; the digital palette is collapsed, labelled, and adds a print layer', async ({ page }) => {
  await open(page, 'darkroom');
  const enlarger = panel(page, 'enlarger');
  await expect(enlarger.locator('.cb-stack-row[data-id="main"]')).toBeVisible();
  // the main exposure's controls sit in its row, the printer lights' pad in theirs
  await expect(enlarger.locator('.cb-stack-main .cb-arg[data-path="main.params.time_s"]')).toBeVisible();
  await expect(enlarger.locator('.cb-stack-main .cb-arg[data-path="lights.params.logH"]')).toBeVisible();
  // a burn: ordered by kind (after the main exposure, before the printer lights' filter)
  await enlarger.locator('.cb-stack-add').click();
  await page.getByRole('menuitem', { name: 'Burn', exact: true }).click();
  const ids = await enlarger.locator('.cb-stack-row').evaluateAll(rs => rs.map(r => (r as HTMLElement).dataset['id']));
  expect(ids).toEqual(['main', 'burn1', 'lights']);
  // the digital palette: closed, its title says it acts after the print
  const digital = panel(page, 'digital');
  await expect(digital).toContainText('Digital (after the print)');
  await expect(digital).toHaveClass(/is-closed/);
  await digital.locator('.ck-panel-h').click();
  await expect(digital).not.toHaveClass(/is-closed/);
  await digital.locator('.cb-stack-add').click();
  await page.getByRole('menuitem', { name: 'Clarity', exact: true }).click();
  expect(await hook<string[]>(page, 'cb.doc().stages.print.stack.order')).toEqual(['clarity1']);
  await expect(panel(page, 'layer-params').locator('.cb-arg[data-path="clarity1.params.strength"]')).toBeVisible();
});

test('finish: a spot is a row of the finish view; deleting the row removes the spot', async ({ page }) => {
  await open(page, 'finish');
  await page.keyboard.press('f');
  await page.keyboard.press('q');
  const vp = page.locator('.ck-vp[data-rendered]').first();
  const b = (await vp.boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  const view = panel(page, 'finish-layers');
  await expect(view.locator('.cb-stack-row[data-id="retouch"]')).toBeVisible();
  await expect(view.locator('.cb-stack-row[data-id="s1"]')).toBeVisible();
  await view.locator('.cb-stack-row[data-id="s1"] .cb-stack-name').click();
  await view.focus();
  await page.keyboard.press('Delete');
  expect(await hook<string[]>(page, 'cb.doc().stages.print.stack.items.retouch?.stack.order ?? []')).toEqual([]);
});

test('ratings: a mis-rating is one undo step; the History jump asks before it crosses another frame', async ({ page }) => {
  await open(page, 'classic');
  await page.keyboard.press('d');
  const f0 = await hook<string>(page, 'cb.studio.current');
  await hook(page, `cb.run('frame.rate', 3)`);
  await hook(page, `cb.run('frame.reject')`);
  expect(await hook<string>(page, `cb.state().ratings['${f0}'].flag`)).toBe('reject');
  await page.locator('.cb-hist').first().click();
  await page.keyboard.press('ControlOrMeta+z');
  expect(await hook<string | null>(page, `cb.state().ratings['${f0}'].flag`)).toBe(null);
  expect(await hook<number>(page, `cb.state().ratings['${f0}'].stars`)).toBe(3);
  // a change on this frame, then one on another frame: jumping back here would undo that one too
  const t = page.locator('.cb-arg[data-path="main.params.time_s"]').first();
  await t.locator('.cb-num').fill('12');
  await t.locator('.cb-num').press('Enter');
  const f1 = await hook<string>(page, `cb.studio.frames.ids().find(x => x !== '${f0}')`);
  await hook(page, `cb.rt.ctx().tx('Time', t => t.$set(['docs', '${f1}', 'stages', 'darkroom', 'stack', 'items', 'main', 'params', 'time_s'], 20))`);
  const hist = page.locator('#history').first();
  await expect(hist.locator('.cb-hist-i.is-crossed')).toHaveCount(1);
  await hist.locator('.cb-hist-i', { hasText: 'Frame added' }).click();
  const confirm = hist.locator('.cb-hist-confirm');
  await expect(confirm).toContainText('This also undoes 1 later change on roll-02.tif');
  await confirm.locator('.cb-hist-no').click();
  await expect(confirm).toHaveCount(0);
  expect(await hook<number>(page, 'cb.doc().stages.darkroom.stack.items.main.params.time_s')).toBe(12);
  await hist.locator('.cb-hist-i', { hasText: 'Frame added' }).click();
  await hist.locator('.cb-hist-yes').click();
  expect(await hook<number>(page, 'cb.doc().stages.darkroom.stack.items.main.params.time_s')).toBe(10);
  expect(await hook<number>(page, `cb.studio.doc('${f1}').stages.darkroom.stack.items.main.params.time_s`)).toBe(10);
});
