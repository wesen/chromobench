// CHB-008 in the studio: the DSL session in a real Web Worker (a synchronous endless loop stopped by cancellation),
// and the assistant panel (cb.kits.chat) on the scripted demo and on the Claude transport against a routed fake API:
// streamed text, step cards with looks, an approval card that applies the change, Stop, and the mode buttons.
import { expect, test, type Page } from '@playwright/test';
import { opened } from './support.ts';

const FIXTURE = new URL('../fixtures/synthetic/m1-negative-96x64.tif', import.meta.url).pathname;

const idle = (page: Page) => page.evaluate(() => window.chromobench.idle());

async function boot(page: Page): Promise<void> {
  await page.goto('/?nosw&engine=mock&layout=classic&fresh');
  await page.waitForFunction(() => document.body.dataset['ready'] === '1');
  await page.setInputFiles('#file', FIXTURE);
  await opened(page);
  await page.evaluate(() => window.chromobench.rt.go('assistant'));
  await expect(page.locator('#chat')).toBeVisible();
}

let pageErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
});
test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

test('the DSL runs in a Web Worker: results, and a synchronous endless loop stopped by cancellation', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    const a = await window.chromobench.eval('const d = await frame.print().measure.densitometer({ at: [48, 32] })\nreturn d.D.length');
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 200);
    const t0 = performance.now();
    const b = await window.chromobench.eval('for (;;) {}', { signal: ac.signal });
    const ms = performance.now() - t0;
    const c = await window.chromobench.eval('mem.k = 7\nreturn mem.k * 6');
    return { a: a.yaml.split('\n')[0], aErr: a.error?.code ?? null, b: b.error?.code, ms, c: c.yaml.split('\n')[0] };
  });
  expect(r).toMatchObject({ a: '3', aErr: null, b: 'E_CANCELLED', c: '42' });
  expect(r.ms).toBeLessThan(3000);
});

test('the scripted demo: streamed text, step cards with a look, an approval card that applies the lights', async ({ page }) => {
  await boot(page);
  await page.selectOption('#chat-provider', 'demo');
  await page.click('#chat-connect');
  await expect(page.locator('#chat-model-label')).toHaveText('scripted demo');
  const before = await page.evaluate(() => window.chromobench.log!.committed.print.lights.logH);
  await page.fill('#chat-input', 'balance the centre please');
  await page.press('#chat-input', 'Enter');
  await expect(page.locator('.cb-chat-user')).toHaveText('balance the centre please');
  await expect(page.locator('.cb-chat-step').first()).toHaveAttribute('data-status', 'done');
  await expect(page.locator('.cb-chat-look img').first()).toBeVisible();
  const card = page.locator('.cb-chat-approval');
  await expect(card).toBeVisible();
  await expect(card).toContainText('print.lights.logH');
  expect(await page.evaluate(() => window.chromobench.log!.committed.print.lights.logH)).toEqual(before);
  await card.getByRole('button', { name: 'Approve' }).click();
  await expect(page.locator('#chat')).toHaveAttribute('data-status', 'idle');
  await expect(page.locator('.cb-chat-assistant').last()).toContainText('I proposed printer lights');
  const after = await page.evaluate(() => window.chromobench.log!.committed.print.lights.logH);
  expect(after).not.toEqual(before);
  const last = await page.evaluate(() => window.chromobench.log!.why('print.lights.logH').at(-1));
  expect(last).toMatchObject({ by: 'agent', approvedBy: 'user' });
  // Revert undoes the approved step as the photographer's own edit
  await page.locator('.cb-chat-step').nth(1).getByRole('button', { name: 'Revert' }).click();
  expect(await page.evaluate(() => window.chromobench.log!.committed.print.lights.logH)).toEqual(before);
});

test('the mode buttons are the photographer\'s: they set every frame\'s mode', async ({ page }) => {
  await boot(page);
  await page.locator('.cb-chat-modes [data-mode="read-only"]').click();
  expect(await page.evaluate(() => window.chromobench.studio.frames.mode)).toBe('read-only');
  expect(await page.evaluate(() => window.chromobench.log!.mode)).toBe('read-only');
  await expect(page.locator('.cb-chat-modes [data-mode="read-only"]')).toHaveAttribute('aria-checked', 'true');
  await page.locator('.cb-chat-modes [data-mode="auto"]').click();
  expect(await page.evaluate(() => window.chromobench.log!.mode)).toBe('auto');
});

const sse = (events: object[]): string => events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join('');

test('the Claude transport: key typed at runtime, streamed reply from the (routed) API; Stop ends a long stream', async ({ page }) => {
  const seen: { key?: string | null; model?: string; browser?: string | null }[] = [];
  let slow = false;
  await page.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const body = req.postDataJSON() as { model: string };
    seen.push({ key: req.headers()['x-api-key'] ?? null, model: body.model, browser: req.headers()['anthropic-dangerous-direct-browser-access'] ?? null });
    const text = slow ? 'x'.repeat(10) : 'The grey card prints a little warm.';
    const events = [
      { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 9 } },
      { type: 'message_stop' },
    ];
    if (slow) await new Promise((r) => setTimeout(r, 4000));
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse(events) });
  });
  await boot(page);
  await page.selectOption('#chat-provider', 'anthropic');
  await page.click('#chat-connect');
  await expect(page.locator('.cb-chat-err')).toHaveText('Enter your Anthropic API key.');
  await page.fill('#chat-key', 'sk-ant-test-not-a-real-key');
  await page.click('#chat-connect');
  await expect(page.locator('#chat-model-label')).toHaveText('claude-opus-5-5');
  await page.fill('#chat-input', 'how does the grey card print?');
  await page.click('#chat-send');
  await expect(page.locator('.cb-chat-assistant').last()).toHaveText('The grey card prints a little warm.');
  expect(seen[0]).toEqual({ key: 'sk-ant-test-not-a-real-key', model: 'claude-opus-5-5', browser: 'true' });
  // the key is not in the studio's state or the frame's log
  const leaked = await page.evaluate(() => JSON.stringify(window.chromobench.state()).includes('sk-ant') || JSON.stringify(window.chromobench.log!.toJSON()).includes('sk-ant'));
  expect(leaked).toBe(false);
  // Stop while the API is still answering
  slow = true;
  await page.fill('#chat-input', 'and now?');
  await page.click('#chat-send');
  await expect(page.locator('#chat-stop')).toBeVisible();
  await page.click('#chat-stop');
  await expect(page.locator('#chat')).toHaveAttribute('data-status', 'idle');
  await expect(page.locator('.cb-chat-notice').last()).toHaveText('Stopped.');
});
