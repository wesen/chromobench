// Waits shared by the studio specs (CHB-032).
//
// The open flow (apps/studio/src/main.ts, openFiles) writes "opening <name> (n of N)…" to #status before each file
// and its outcome ("opened …", "… was already open", or the error) after the last one. Renders run in the engine
// worker and write "rendered …" whenever one finishes, so the status cannot tell when an open is over: the first
// file of a multi-file open renders while the next one still opens, and a frame's first render can land before the
// open flow selects it. An open is over when the expected frames are open and the status no longer says "opening";
// idle() then waits for the renders, log writes and queued frames that the open started.
import type { Page } from '@playwright/test';

/** Waits for worker renders, log writes and queued frames (`window.chromobench.idle()`). */
const idle = (page: Page): Promise<void> => page.evaluate(() => window.chromobench.idle());

/**
 * After `page.setInputFiles('#file' | '#folder', …)`: waits until at least `frames` frames are open and the open
 * flow has written its outcome, then for idle(). Not for re-opening files that are already open (the frame count
 * does not grow): wait for the "already open" text instead.
 */
export async function opened(page: Page, frames = 1, timeout = 30_000): Promise<void> {
  await page.waitForFunction(
    (n) => window.chromobench.studio.frames.all().length >= n && !/opening/.test(document.querySelector('#status')?.textContent ?? ''),
    frames,
    { timeout },
  );
  await idle(page);
}
