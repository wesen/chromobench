const { waitRender, count, sample } = await import('./common.mjs?' + Date.now());
export default async ({ page, shot, readProbe }) => {
  const r = {};
  await page.locator('.ck-menubar-t', { hasText: 'Layer' }).click(); await page.waitForTimeout(250);
  r.layerMenu = await page.locator('.ck-menu').first().innerText(); await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+k'); await page.waitForTimeout(400); await page.keyboard.type('white balance'); await page.waitForTimeout(500);
  r.cmdWB = await page.evaluate(() => document.querySelector('.ck-dialog, [role=dialog]')?.innerText);
  for (let i = 0; i < 13; i++) await page.keyboard.press('Backspace');
  await page.keyboard.type('film'); await page.waitForTimeout(500);
  r.cmdFilm = await page.evaluate(() => document.querySelector('.ck-dialog, [role=dialog]')?.innerText);
  await page.keyboard.press('Escape');
  // switch to Classic, Scene module
  await page.locator('.ck-menubar-t', { hasText: 'View' }).click(); await page.waitForTimeout(250);
  await page.locator('.ck-menu').getByText('Layout…').click(); await page.waitForTimeout(500);
  await page.locator('.ck-dialog button, [role=dialog] button', { hasText: 'Classic' }).first().click(); await page.waitForTimeout(2500);
  await page.locator('button.ck-module', { hasText: /^Scene$/ }).click(); await page.waitForTimeout(2500);
  r.scene = await page.evaluate(() => { const els = [...document.querySelectorAll('*')].filter(e => (e.getBoundingClientRect().x > 1130 || e.getBoundingClientRect().x < 260) && e.getBoundingClientRect().y > 70 && e.getBoundingClientRect().y < 880 && e.children.length === 0 && e.innerText?.trim()); return els.map(e => e.innerText.trim()).slice(0, 90).join(' | '); });
  r.ranges = await page.evaluate(() => [...document.querySelectorAll('input[type=range]')].filter(e => e.offsetParent).map(e => e.getAttribute('aria-label')));
  await shot('62-classic-scene');
  r.probe = await readProbe();
  return r;
};
