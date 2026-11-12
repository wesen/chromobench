// The page side of the bridge protocol against a fake socket: hello with frames and mode, an eval run in the
// page's DSL worker session (in ask mode the edit comes back pending, nothing waits for approval), looks as base64,
// cancellation from the bridge, sessions, focus updates and reconnection with backoff.
import { describe, expect, it } from 'vitest';
import { BridgePageClient, DslWorkerClient, inThreadWorker, type SocketLike } from '../src/index.ts';
import { FRAME, page } from './helpers.ts';

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.readyState = 3;
    this.onclose?.({});
  }
  push(m: object): void {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
}

async function until(cond: () => boolean, ms = 5000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('BridgePageClient', () => {
  it('hello, eval in ask mode (pending, not waiting), looks, cancel, sessions, focus, reconnect', async () => {
    const p = await page({ mode: 'ask' });
    const sockets: FakeSocket[] = [];
    const sessions = new Map<string, Promise<DslWorkerClient>>([['default', Promise.resolve(p.dsl)]]);
    let n = 0;
    const statuses: string[] = [];
    const c = new BridgePageClient({
      url: 'ws://127.0.0.1:7341/ws/page',
      pageId: 'p-test',
      frames: p.frames,
      currentFrame: () => FRAME,
      mode: () => p.log.mode,
      session: (id) => sessions.get(id) ?? null,
      createSession: () => {
        const id = `s-${++n}`;
        sessions.set(id, DslWorkerClient.create({ spawn: inThreadWorker, engine: p.engine, frames: p.frames, txPrefix: `mcp-${id}` }));
        return id;
      },
      connect: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      onStatus: (s) => statuses.push(s),
      backoff: { min: 5, max: 20 },
    });
    c.start();
    const ws = sockets[0]!;
    ws.open();
    expect(ws.sent[0]).toEqual({ t: 'hello', page: 'p-test', app: 'chromobench-studio', catalogHash: '', focused: true, frame: FRAME, frames: [{ id: FRAME, name: 'M1 test negative', open: true }], mode: 'ask' });

    ws.push({ t: 'eval', id: 'e-0001', session: 'default', req: { code: "frame.edit({ 'print.enlarger.time_s': 12.6 })\nframe.print().look('now')\nreturn 1", timeoutMs: 30000 } });
    await until(() => ws.sent.some((m) => m['t'] === 'eval.result'));
    const r = ws.sent.find((m) => m['t'] === 'eval.result') as { id: string; text: string; isError: boolean; looks: { mime: string; base64: string }[] };
    expect(r.id).toBe('e-0001');
    expect(r.isError).toBe(false);
    expect(r.text).toContain('pending');
    expect(r.looks[0]!.mime).toBe('image/png');
    expect(p.log.pending()[0]).toMatchObject({ by: 'agent', tx: 'chat1-eval-1' });

    // cancellation from the bridge stops the eval; no result is sent for it
    ws.push({ t: 'eval', id: 'e-0002', session: 'default', req: { code: 'for (let i = 0; ; i++) await frame.print({ time_s: 10 + (i % 3) }).measure.densitometer({ at: [48, 32] })', timeoutMs: 30000 } });
    await new Promise((res) => setTimeout(res, 60));
    ws.push({ t: 'eval.cancel', id: 'e-0002', reason: 'client' });
    await new Promise((res) => setTimeout(res, 200));
    expect(ws.sent.filter((m) => m['t'] === 'eval.result')).toHaveLength(1);

    // sessions: create one, run in it; an unknown one is an error result
    ws.push({ t: 'session.create', id: 'e-0003' });
    await until(() => ws.sent.some((m) => m['t'] === 'session.created'));
    expect(ws.sent.find((m) => m['t'] === 'session.created')).toEqual({ t: 'session.created', id: 'e-0003', session: 's-1' });
    ws.push({ t: 'eval', id: 'e-0004', session: 's-1', req: { code: 'return typeof mem.x', timeoutMs: 1000 } });
    ws.push({ t: 'eval', id: 'e-0005', session: 'nope', req: { code: 'return 1', timeoutMs: 1000 } });
    await until(() => ws.sent.filter((m) => m['t'] === 'eval.result').length === 3);
    expect(ws.sent.find((m) => m['id'] === 'e-0005')).toMatchObject({ isError: true });
    expect(String(ws.sent.find((m) => m['id'] === 'e-0005')!['text'])).toContain('E_SESSION');

    // focus/mode updates
    p.log.setMode('auto');
    c.update();
    expect(ws.sent.at(-1)).toMatchObject({ t: 'focus', mode: 'auto', frame: FRAME });

    // the bridge goes away: reconnect with backoff, hello again
    ws.close();
    await until(() => sockets.length === 2);
    sockets[1]!.open();
    expect(sockets[1]!.sent[0]).toMatchObject({ t: 'hello', page: 'p-test', mode: 'auto' });
    expect(statuses).toEqual(['connecting', 'connected', 'disconnected', 'connecting', 'connected']);
    c.stop();
    for (const s of sessions.values()) (await s).dispose();
  });
});
