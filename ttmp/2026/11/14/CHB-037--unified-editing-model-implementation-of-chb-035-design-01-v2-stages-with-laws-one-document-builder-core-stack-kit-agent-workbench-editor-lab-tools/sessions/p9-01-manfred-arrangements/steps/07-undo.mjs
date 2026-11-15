const { waitRender, count, sample, mainExp, typeInto, history } = await import('./common.mjs?' + Date.now());
const menuText = async (page, name) => { await page.getByText(name, { exact: true }).first().click(); await page.waitForTimeout(250); const t = await page.locator('.ck-menu, [role=menu]').last().innerText().catch(() => ''); return t; };
export default async ({ page, shot, readProbe }) => {
  const r = {};
  r.editMenu = await menuText(page, 'Edit'); await page.keyboard.press('Escape');
  await page.mouse.click(670, 400); // click on picture first so keys go to the app, not a field
  for (let i = 0; i < 3; i++) { const n = await count(page); const t0 = Date.now(); await page.keyboard.press('Meta+z'); r['undo' + i] = { render: (await waitRender(page, n, t0, 6000)).doneMs, main: await mainExp(page) }; }
  r.after3 = await sample(page, { sky: [300, 170, 400, 60], wall: [400, 520, 50, 50] });
  r.probe1 = await readProbe();
  await shot('09-undo-one-too-many');
  r.editMenu2 = await menuText(page, 'Edit'); await page.keyboard.press('Escape');
  const n = await count(page); const t0 = Date.now();
  await page.keyboard.press('Meta+Shift+z');
  r.redo = { render: (await waitRender(page, n, t0, 6000)).doneMs, main: await mainExp(page) };
  r.probe2 = await readProbe();
  // he still finds it too dark & brown? It's at 12 s again. Values on the filtration rows: are they typable?
  r.numFields = await page.evaluate(() => [...document.querySelectorAll('input.cb-num')].map(e => e.getAttribute('aria-label')));
  return r;
};
