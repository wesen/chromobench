// CHB-046: a headless walk through the changed flows on synthetic negatives (never the photographer's files), with a
// screenshot and a few numbers per step. Run from the worktree root against a running studio (vite dev server):
//   node e2e/make-scenes.ts <scenes-dir>
//   pnpm --filter @chromobench/studio exec vite --port 5585 --strictPort &
//   node ttmp/…/CHB-046…/scripts/01-walk-changed-flows.mjs http://localhost:5585 <scenes-dir> <shots-dir>
// Headless Chromium with WebGPU on SwiftShader (REAL_GPU=1 for the machine's adapter); never a headed window.
import { chromium } from '@playwright/test';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

const [base = 'http://localhost:5585', scenes = '.playwright-mcp/synthetic', shots = 'shots'] = process.argv.slice(2);
mkdirSync(shots, { recursive: true });
const args = process.env.REAL_GPU ? [] : ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan'];
const browser = await chromium.launch({ channel: 'chromium', headless: true, args });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const log = (...a) => console.log('·', ...a);
const hook = (f) => page.evaluate(`(() => { const cb = window.chromobench; return ${f}; })()`);
const idle = () => page.evaluate(() => window.chromobench.idle());
const shot = (n) => page.screenshot({ path: join(shots, n) });
const lumaOf = () => page.evaluate(() => {
  const s = window.chromobench.size(); let t = 0, n = 0;
  for (let i = 1; i < 10; i++) for (let j = 1; j < 10; j++) { const v = window.chromobench.pixel(Math.floor((s.width * i) / 10), Math.floor((s.height * j) / 10)); if (v) { t += 255 * (0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]); n++; } }
  return t / n;
});
const vpBox = async () => (await page.locator('.ck-vp:visible').first().boundingBox());
async function press(from, to, steps = 5) {
  const b = await vpBox();
  await page.mouse.move(b.x + b.width * from[0], b.y + b.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * to[0], b.y + b.height * to[1], { steps });
  await page.mouse.up();
  await idle();
}

await page.goto(`${base}/?nosw&canvas2d&fresh&engine=gpu&layout=classic`);
await page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: 60_000 });
log('boot: layout', await hook('document.body.dataset.layout'), '· module', await hook('cb.rt.module'));

// D1: open two frames of the synthetic roll → Print
await page.setInputFiles('#file', [join(scenes, 'roll-12-frame-1.tif'), join(scenes, 'roll-12-frame-2.tif')]);
await page.waitForFunction(() => window.chromobench.studio.frames.all().length >= 2 && !/opening/.test(document.querySelector('#status')?.textContent ?? ''), null, { timeout: 180_000 });
await idle();
log('D1: after open, module', await hook('cb.rt.module'), '· neutralise', await hook('cb.state().prefs.neutralise'), '% · lights', JSON.stringify(await hook(`cb.get('lights.params.logH')`)), '· source alpha', await hook(`cb.get('lights.source').alpha`));
await shot('01-open-into-print.png');

// F44: real → normalised → real
await hook(`cb.set('main.params.time_s', 31, 'Time')`);
await idle();
const l0 = await lumaOf();
await page.locator('.ck-panel[data-panel="controls-darkroom"] .cb-arg[data-path="stages.darkroom.medium.mode"] select').selectOption('normalised');
await idle();
const l1 = await lumaOf();
await shot('02-normalised-keeps-density.png');
await page.locator('.ck-panel[data-panel="controls-darkroom"] .cb-arg[data-path="stages.darkroom.medium.mode"] select').selectOption('real');
await idle();
log(`F44: luma real ${l0.toFixed(2)} → normalised ${l1.toFixed(2)} → real ${(await lumaOf()).toFixed(2)}; History: ${await page.locator('#history').innerText().catch(() => '')}`.replace(/\n/g, ' | ').slice(0, 400));

// P9-6: 60 px of Time
await hook(`cb.set('main.params.time_s', 10, 'Time')`);
await idle();
const r = await page.locator('.ck-panel[data-panel="controls-darkroom"] .cb-arg[data-path="main.params.time_s"] input.cb-range').first().boundingBox();
await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
await page.mouse.down();
await page.mouse.move(r.x + r.width / 2 + 60, r.y + r.height / 2, { steps: 6 });
await page.mouse.up();
await idle();
log('P9-6: 60 px of Time from 10 s →', await hook(`cb.get('main.params.time_s')`), 's');

// P9-9: Apply Print Settings, the primary outlined
const ids = await hook('cb.studio.frames.ids()');
await hook(`cb.run('frame.select', '${ids[0]}')`);
await hook(`cb.set('main.params.time_s', 31.75, 'Time')`);
await idle();
const cell = (id) => page.locator(`.ck-filmstrip:visible .ck-coll-cell[data-key="${id}"]`);
await cell(ids[1]).click();
await cell(ids[0]).click({ modifiers: ['ControlOrMeta'] });
await idle();
await page.locator('.ck-menubar-t', { hasText: 'Frame' }).click();
await page.locator('.ck-menu-i[data-command="print.applyToSelection"]').click();
await page.getByRole('dialog').waitFor();
log('P9-9 dialog:', (await page.getByRole('dialog').innerText()).replace(/\n+/g, ' | '));
await shot('03-apply-print-settings-asks.png');
await page.getByRole('dialog').getByRole('button', { name: /Apply to/ }).click();
await idle();
log('P9-9: frame 2 time', await hook(`cb.studio.doc('${ids[1]}').stages.darkroom.stack.items.main.params.time_s`));

// D4: Settings ▸ Sync
await page.locator('.ck-menubar-t', { hasText: 'Settings' }).click();
await page.locator('.ck-menu-i[data-command="looks.sync"]').click();
await page.getByRole('dialog').waitFor();
log('D4 dialog:', (await page.getByRole('dialog').innerText()).replace(/\n+/g, ' | '));
await shot('04-sync-asks.png');
await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

// P9-1: Edit, clarity, Linear: click, drag, click again
await hook(`cb.run('frame.select', '${ids[0]}')`);
await page.locator('.ck-module[data-module="edit"]').click();
await page.locator('.ck-panel[data-panel="layers-edit"]:visible .cb-stack-add').click();
await page.getByRole('menuitem', { name: 'Clarity', exact: true }).click();
await idle();
await page.locator('.ck-panel[data-panel="layer-masks-edit"]:visible .cb-stack-tool-mask-linear').click();
await press([0.5, 0.4], [0.5, 0.4], 1);
log('P9-1: after a click: tool', await hook('cb.state().ui.tool'), '· masks', await hook('Object.keys(cb.doc.masks.items).length'));
await press([0.5, 0.2], [0.5, 0.7]);
log('P9-1: after a drag: tool', await hook('cb.state().ui.tool'), '· masks', await hook('Object.keys(cb.doc.masks.items).length'));
await press([0.3, 0.3], [0.7, 0.7]);
log('P9-1: a later drag on the picture: masks', await hook('Object.keys(cb.doc.masks.items).length'));
await shot('05-mask-tool-disarmed.png');

// D5 and D8: Darkroom first, the Enlarger in his order; the Roll module's First print panel
await hook(`cb.run('view.layout', 'darkroom')`);
await page.waitForFunction(() => document.body.dataset['layout'] === 'darkroom', null, { timeout: 60_000 });
await idle();
const enl = page.locator('.ck-panel[data-panel="enlarger"]:visible');
for (const op of ['Density mask', 'Burn', 'Dodge']) {
  await enl.locator('.cb-stack-add').click();
  await page.getByRole('menuitem', { name: op, exact: true }).click();
  await idle();
}
log('D5: rows', JSON.stringify(await enl.locator('.cb-stack-row').evaluateAll((els) => els.map((e) => e.querySelector('.cb-stack-name')?.textContent + (e.querySelector('.cb-stack-kind:not([hidden])') ? ` [${e.querySelector('.cb-stack-kind').textContent}]` : '')))), '· summary', await enl.locator('.cb-stack-kinds').innerText());
await shot('06-enlarger-his-order.png');
await enl.locator('.cb-stack-bykind').click();
await page.waitForTimeout(500);
log('D5: by kind', JSON.stringify(await enl.locator('.cb-stack-row').evaluateAll((els) => els.map((e) => e.dataset.id))));
await shot('07-enlarger-by-kind.png');
await hook(`cb.run('view.layout', 'classic')`);
await page.waitForFunction(() => document.body.dataset['layout'] === 'classic', null, { timeout: 60_000 });
await idle();
log('D1: back in Classic, module', await hook('cb.rt.module'));
const fp = page.locator('.ck-panel[data-panel="first-print"]:visible');
log('D8: First print panel', (await fp.innerText()).replace(/\n+/g, ' | '));
await shot('08-first-print-panel.png');
log('page errors', JSON.stringify(errors));
await browser.close();
