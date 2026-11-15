// The parity page's test fixture (CHB-037 P3b). Opening the page loads every module of the GPU engine, core and the
// contract through the parity page's Vite server, then the data packs. On a cold server, with several workers
// asking at once on a loaded machine, that first load took longer than a test's whole budget (film.spec's first test
// timed out in its beforeEach). Now each worker opens the page once in a worker fixture with its own budget, before
// its first test, so the server's transforms are warm; a test's beforeEach then opens a warm page, and the test's
// budget measures the test. Nothing a test checks changed.
import { expect, test as base, type Page } from '@playwright/test';

export { expect, type Page };

/** Opens the parity page and waits until it is ready (modules and packs loaded); bounded by the caller's budget. */
export async function openParity(page: Page): Promise<void> {
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('/parity-page/index.html', { timeout: 0 });
  await page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: 0 });
}

export const test = base.extend<object, { warmParity: void }>({
  warmParity: [async ({ browser }, use, info) => {
    // a worker fixture sees no test options: the project's baseURL comes from its config
    const baseURL = info.project.use.baseURL;
    const page = await browser.newPage(baseURL ? { baseURL } : {});
    await openParity(page);
    await page.close();
    await use();
  }, { scope: 'worker', auto: true, timeout: 600_000 }],
});
