// CHB-025: the studio opens in the CraftKit theme; View ▸ Theme switches to Chromogen and View ▸ Interface Gray picks
// a gray, the host frame follows (the tokens are written on <html>), and the choice survives a reload.
import { expect, test, type Page } from '@playwright/test';

const token = (page: Page, t: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue('--' + n).trim(), t);
// the host frame: the status line (CHB-027: the top bar is gone, its actions are in the menus)
const barBg = (page: Page) => page.evaluate(() => getComputedStyle(document.getElementById('statusbar')!).backgroundColor);

async function boot(page: Page, extra = ''): Promise<void> {
  await page.goto(`/?nosw&engine=mock&layout=classic${extra}`);
  await page.waitForFunction(() => document.body.dataset['ready'] === '1');
}

test('View ▸ Theme and View ▸ Interface Gray: CraftKit by default, Chromogen on request, saved across a reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await boot(page);
  expect(await token(page, 'panel')).toBe('#ececec');
  expect(await page.evaluate(() => document.documentElement.dataset['ckTheme'])).toBe('craftkit');
  expect(await barBg(page)).toBe('rgb(226, 226, 226)'); // --panel2

  // the View menu has the two submenus, with the current choice checked
  await page.locator('.ck-menubar-t', { hasText: 'View' }).click();
  await page.locator('.ck-menu-i', { hasText: /^Theme/ }).hover();
  await expect(page.locator('.ck-menu-i[data-command="view.theme.craftkit"] .ck-icon')).toHaveCount(1);
  await page.locator('.ck-menu-i[data-command="view.theme.chromogen"]').click();
  await expect.poll(() => token(page, 'panel')).toBe('#ffffff');
  expect(await token(page, 'font')).toContain('Arial');
  expect(await barBg(page)).toBe('rgb(246, 246, 246)'); // Chromogen's --panel2

  await page.evaluate(() => window.chromobench.run('view.gray.1'));
  await expect.poll(() => token(page, 'panel')).toBe('#1a1a1a');
  await page.evaluate(() => window.chromobench.idle());
  // the view tier is saved 700 ms after the change (autosave's debounce): flush the pending save instead of waiting
  // it out (a fixed 600 ms wait lost the race on the M1 Max, CHB-037 P9)
  await page.evaluate(() => window.chromobench.rt.save());

  await boot(page);
  expect(await page.evaluate(() => [window.chromobench.state().prefs?.theme, window.chromobench.state().prefs?.gray])).toEqual(['chromogen', '1']);
  expect(await token(page, 'panel')).toBe('#1a1a1a');
  await page.evaluate(() => { window.chromobench.run('view.theme.craftkit'); window.chromobench.run('view.gray.auto'); });
  await expect.poll(() => token(page, 'panel')).toBe('#ececec');
});
