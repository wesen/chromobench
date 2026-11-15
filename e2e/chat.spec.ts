// CHB-008 in the studio: the DSL session in a real Web Worker (a synchronous endless loop stopped by cancellation),
// and the assistant panel (cb.kits.chat) on the scripted demo and on the Claude transport against a routed fake API:
// streamed text, step cards with shown images, an approval card that applies the change, Stop, and the mode buttons.
// CHB-037: the assistant is loaded on first use (lazy chat), and works on the studio's log through AgentDocs.
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
    const a = await window.chromobench.eval('const d = await frame.print().measure.densitometer({ at: [48, 32] })\nreturn d.D.length') as { yaml: string; error?: { code: string } };
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 200);
    const t0 = performance.now();
    const b = await window.chromobench.eval('for (;;) {}', { signal: ac.signal }) as { yaml: string; error?: { code: string } };
    const ms = performance.now() - t0;
    const c = await window.chromobench.eval('mem.k = 7\nreturn mem.k * 6') as { yaml: string; error?: { code: string } };
    return { a: a.yaml.split('\n')[0], aErr: a.error?.code ?? null, b: b.error?.code, ms, c: c.yaml.split('\n')[0] };
  });
  expect(r).toMatchObject({ a: '3', aErr: null, b: 'E_CANCELLED', c: '42' });
  expect(r.ms).toBeLessThan(3000);
});

test('the scripted demo: streamed text, step cards with a shown image, an approval card that applies the lights', async ({ page }) => {
  await boot(page);
  await page.selectOption('#chat-provider', 'demo');
  await page.click('#chat-connect');
  await expect(page.locator('#chat-model-label')).toHaveText('scripted demo');
  const before = await page.evaluate(() => window.chromobench.get('lights.params.logH'));
  await page.fill('#chat-input', 'balance the centre please');
  await page.press('#chat-input', 'Enter');
  await expect(page.locator('.cb-chat-user')).toHaveText('balance the centre please');
  await expect(page.locator('.cb-chat-step').first()).toHaveAttribute('data-status', 'done');
  await expect(page.locator('.cb-chat-look img').first()).toBeVisible();
  const card = page.locator('.cb-chat-approval');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Printer lights'); // the card in the History's words (CHB-037 P6b)
  expect(await page.evaluate(() => window.chromobench.get('lights.params.logH'))).toEqual(before);
  await card.getByRole('button', { name: 'Approve' }).click();
  await expect(page.locator('#chat')).toHaveAttribute('data-status', 'idle');
  await expect(page.locator('.cb-chat-assistant').last()).toContainText('I proposed printer lights');
  const after = await page.evaluate(() => window.chromobench.get('lights.params.logH'));
  expect(after).not.toEqual(before);
  const last = await page.evaluate(() => window.chromobench.log.why(window.chromobench.studio.current!, 'lights.params.logH'));
  expect(last).toMatchObject({ by: 'agent', approvedBy: 'user' });
  // Revert undoes the approved step as the photographer's own edit
  await page.locator('.cb-chat-step').nth(1).getByRole('button', { name: 'Revert' }).click();
  expect(await page.evaluate(() => window.chromobench.get('lights.params.logH'))).toEqual(before);
});

test('the mode buttons are the photographer\'s: they set the studio\'s agent mode', async ({ page }) => {
  await boot(page);
  await page.locator('.cb-chat-modes [data-mode="read-only"]').click();
  expect(await page.evaluate(() => window.chromobench.studio.mode)).toBe('read-only');
  expect(await page.evaluate(() => window.chromobench.state().prefs.agentMode)).toBe('read-only');
  await expect(page.locator('.cb-chat-modes [data-mode="read-only"]')).toHaveAttribute('aria-checked', 'true');
  await page.locator('.cb-chat-modes [data-mode="auto"]').click();
  expect(await page.evaluate(() => window.chromobench.studio.mode)).toBe('auto');
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
  const leaked = await page.evaluate(() => JSON.stringify(window.chromobench.state()).includes('sk-ant') || JSON.stringify(window.chromobench.log.toJSON()).includes('sk-ant'));
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

// CHB-037 P6b: the agent's workbench from eval alone — the command table, a command run as the agent, the screen
// with live values, and a layout written in the sandbox that the photographer accepts in a dialog.
test('the workbench: wb.commands, wb.run, wb.screen().explain(), and a layout the agent writes, proposed and used', async ({ page }) => {
  await boot(page);
  type R = { yaml: string; error?: { code: string; message: string } };
  const ev = (code: string) => page.evaluate((c) => window.chromobench.eval(c) as Promise<R>, code);
  const one = (r: R): unknown => {
    expect(r.error, r.yaml).toBeUndefined();
    const l = r.yaml.split('\n')[0]!;
    return JSON.parse(l.startsWith("'") ? l.slice(1, -1).replace(/''/g, "'") : l);
  };
  const a = one(await ev(`const c = await wb.commands(); await wb.run('module.print'); const s = await wb.screen(); return JSON.stringify({ n: c.length, hasPick: c.some((x) => x.id === 'frame.pick'), module: s.module, time: s.controls.some((x) => x.path === 'main.params.time_s'), text: (await wb.screen().explain()).includes('module print') })`)) as Record<string, unknown>;
  expect(a).toMatchObject({ hasPick: true, module: 'print', time: true, text: true });
  expect(await page.evaluate(() => window.chromobench.rt.module)).toBe('print');
  // ask mode: a document command the agent runs waits for approval
  const rated = one(await ev(`return JSON.stringify(await wb.run('frame.rate', 4))`)) as { how: string };
  expect(rated.how).toBe('proposed');
  // a layout written in the sandbox: built by the studio (its passes), then proposed; he accepts it
  const b = one(await ev(`const b = await wb.layouts.build({ id: 'just-print', label: 'Just the print', build: (ck, cb) => cb.studio('Chromobench').menus(...cb.menus.standard()).module(ck.module('main', { label: 'Print', stages: ['darkroom'] }).center(cb.viewer(cb.sel.frame.print(), { tools: ['probe'] })).right(ck.dock.column({ width: 300 }, cb.panels.controls('darkroom'), cb.panels.history().hidden(cb.sel.doc.not())))) }); mem.l = b.layout; const u = await wb.layouts.use(b, { why: 'fewer panels' }); return JSON.stringify({ ok: b.ok, errors: b.errors, status: u.status })`)) as Record<string, unknown>;
  expect(b).toMatchObject({ ok: true, errors: [], status: 'proposed' });
  const dlg = page.getByRole('dialog', { name: 'Use the assistant’s layout?' });
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: 'Use Just the print' }).click();
  await page.waitForFunction(() => document.body.dataset['layout'] === 'just-print');
  await idle(page);
  const c = one(await ev(`const l = await wb.layout(); const s = await wb.screen(); return JSON.stringify({ id: l.id, agent: l.agent, modules: s.modules.map((m) => m.id), frame: s.frame })`)) as Record<string, unknown>;
  expect(c).toMatchObject({ id: 'just-print', agent: true, modules: ['main'] });
  expect(c['frame']).toBeTruthy();
});

// CHB-037 P9: what the assistant wrote outlives the page — a layout he accepted is kept (View ▸ Layout lists it, a
// reload comes back to it) and a look it wrote is registered again at the next start, so a frame linking it opens.
test('the assistant’s layout and look survive a reload', async ({ page }) => {
  type R = { yaml: string; error?: { code: string; message: string } };
  const ev = (code: string) => page.evaluate((c) => window.chromobench.eval(c) as Promise<R>, code);
  const ok = async (code: string): Promise<string> => {
    const r = await ev(code);
    expect(r.error, r.yaml).toBeUndefined();
    return r.yaml;
  };
  // a database of its own (not ?fresh: the reload must find what was kept)
  await page.goto('/?nosw&engine=mock&layout=classic');
  await page.evaluate(() => new Promise((ok) => {
    const r = indexedDB.deleteDatabase('chromobench-studio');
    r.onsuccess = r.onerror = r.onblocked = () => ok(null);
  }));
  await page.reload();
  await page.waitForFunction(() => document.body.dataset['ready'] === '1');
  await page.setInputFiles('#file', FIXTURE);
  await opened(page);
  await page.evaluate(() => window.chromobench.rt.go('assistant'));
  const src = `defineLook({ name: 'agent-warm', version: 1, label: 'Agent warm', group: 'Mine', doc: '', params: {}, stages: ['darkroom'], fn: () => ({ stacks: { darkroom: { order: ['f'], items: { f: { kind: 'layer', op: 'filter', params: { logH: [-0.05, 0, 0.05] }, name: 'Warm', enabled: true, amount: 1, mask: null, blend: 'normal', source: { kind: 'look' } } } } } }) })`;
  await ok(`await cb.looks.define(${JSON.stringify(src)}); return 'ok'`);
  await ok(`return JSON.stringify(cb.looks.apply('agent-warm', {}, { why: 'warmer' }))`);
  // approve whatever waits (ask mode), so the link is in the frame's document
  for (const seq of await page.evaluate(() => window.chromobench.pending().map((p) => p.seq))) await page.evaluate((s) => window.chromobench.studio.approve(s), seq);
  await expect.poll(() => page.evaluate(() => Object.values(window.chromobench.doc!.stages.darkroom.stack.items).some((e) => e.kind === 'link' && (e.ref as { look?: string }).look === 'agent-warm'))).toBe(true);
  // a simpler screen, accepted
  await ok(`const b = await wb.layouts.build({ id: 'simpler', label: 'Simpler', build: (ck, cb) => cb.studio('Chromobench').menus(...cb.menus.standard()).module(ck.module('main', { label: 'Print', stages: ['darkroom'] }).center(cb.viewer(cb.sel.frame.print(), { tools: ['probe'] })).right(ck.dock.column({ width: 300 }, cb.panels.controls('darkroom'), cb.panels.history().hidden(cb.sel.doc.not())))) }); return (await wb.layouts.use(b)).status`);
  await page.getByRole('dialog', { name: 'Use the assistant’s layout?' }).getByRole('button', { name: 'Use Simpler' }).click();
  await page.waitForFunction(() => document.body.dataset['layout'] === 'simpler');
  await idle(page);
  await page.evaluate(() => window.chromobench.rt.save());
  expect(new URL(page.url()).searchParams.get('layout')).toBe('simpler');
  // View ▸ Layout lists it
  expect(await page.evaluate(() => (window.chromobench.state() as { ui: { host: { layouts: { id: string; label: string }[] } } }).ui.host.layouts.find((l) => l.id === 'simpler')?.label)).toBe('Simpler (assistant)');
  // the reload: the same layout, the frame with its link to the agent's look, no error
  await page.reload();
  await page.waitForFunction(() => document.body.dataset['ready'] === '1');
  await idle(page);
  expect(await page.evaluate(() => document.body.dataset['layout'])).toBe('simpler');
  // the file again (the browser cannot read it without asking): its saved edit comes back by its hash
  await page.setInputFiles('#file', FIXTURE);
  await opened(page);
  expect(await page.evaluate(() => Object.values(window.chromobench.doc!.stages.darkroom.stack.items).some((e) => e.kind === 'link' && (e.ref as { look?: string }).look === 'agent-warm'))).toBe(true);
  expect(await page.evaluate(() => window.chromobench.printNode())).toBeTruthy();
  // and back to a built-in layout through View ▸ Layout
  await page.evaluate(() => window.chromobench.run('view.layout', 'classic'));
  await page.waitForFunction(() => document.body.dataset['layout'] === 'classic');
});
