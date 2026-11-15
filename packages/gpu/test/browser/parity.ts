// The parity page's test fixture (CHB-037 P3b). Opening the page loads every module of the GPU engine, core and the
// contract through the parity page's Vite server, then the data packs. On a cold server, with several workers
// asking at once on a loaded machine, that first load took longer than a test's whole budget (film.spec's first test
// timed out in its beforeEach). The Vite server now transforms the page's module graph when it starts
// (parity-page/vite.config.ts server.warmup), and each worker, before its first test, fetches the page's entry from
// Node in a worker fixture with its own budget, so the first browser load meets a warm server. (A first version
// opened a page in that fixture; on Metal one worker's browser.newPage never returned and spent the fixture's whole
// budget, so the fixture does not touch the browser.) Nothing a test checks changed.
import { expect, test as base, type Page } from '@playwright/test';

export { expect, type Page };

/** Opens the parity page and waits until it is ready (modules and packs loaded); bounded by the caller's budget. */
export async function openParity(page: Page): Promise<void> {
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('/parity-page/index.html', { timeout: 0 });
  await page.waitForFunction(() => document.body.dataset['ready'] === '1', null, { timeout: 0 });
}

export const test = base.extend<object, { warmParity: void }>({
  warmParity: [async ({}, use, info) => {
    // a worker fixture sees no test options: the project's baseURL comes from its config
    const base = info.project.use.baseURL;
    if (base) for (const path of ['/parity-page/index.html', '/src/parity/page.ts']) await (await fetch(new URL(path, base))).text();
    await use();
  }, { scope: 'worker', auto: true, timeout: 600_000 }],
});
