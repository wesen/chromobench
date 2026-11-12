// The DSL session behind the worker protocol (task 44uo): the same results as an in-page DslSession, the engine
// reached only through adopt/measure/evaluate, proposals replayed on the page's EditLog, mirror logs kept current,
// cancellation, the forced-restart backstop and E_BUSY.
import { describe, expect, it, vi } from 'vitest';
import { EditLog, defaultRecipe, type EvalResult } from '@chromobench/contract';
import { DslSession, docsProvider } from '@chromobench/dsl';
import { inThreadWorker, type WorkerLike } from '../src/index.ts';
import { FRAME, page } from './helpers.ts';

const E1 = `const r = frame.recipe
const print = frame.print()
const grey = await print.measure.densitometer({ at: [48, 32], aperture_px: 15 })
print.look('current print')
return { stock: r.scan.stock, time_s: r.print.enlarger.time_s, grey: grey.D }`;

describe('DSL session in a worker', () => {
  it('returns what an in-page DslSession returns, looks included', async () => {
    const p = await page();
    const viaWorker = await p.dsl.eval({ code: E1, frame: FRAME });
    const direct = await DslSession.create({ engine: p.engine, frames: { [FRAME]: { log: p.log, source: p.info, name: 'M1 test negative' } }, docs: docsProvider() });
    const inPage = await direct.eval({ code: E1, frame: FRAME });
    expect(viaWorker.error).toBeUndefined();
    expect(viaWorker.yaml).toBe(inPage.yaml);
    expect(viaWorker.looks).toHaveLength(1);
    expect(viaWorker.looks[0]!.image.bytes).toBeInstanceOf(Uint8Array);
    expect(viaWorker.looks[0]!.image.bytes.length).toBe(inPage.looks[0]!.image.bytes.length);
    expect(viaWorker.context).toEqual(inPage.context);
    direct.dispose();
    p.dsl.dispose();
  });

  it('reaches the engine only through adopt, measure and evaluate', async () => {
    const p = await page();
    const spies = (['open', 'prepare', 'adopt', 'measure', 'evaluate', 'dispose'] as const).map((k) => vi.spyOn(p.engine, k));
    await p.dsl.eval({ code: E1, frame: FRAME });
    const called = Object.fromEntries(spies.map((s, i) => [['open', 'prepare', 'adopt', 'measure', 'evaluate', 'dispose'][i], s.mock.calls.length]));
    expect(called['open']).toBe(0);
    expect(called['prepare']).toBe(0);
    expect(called['dispose']).toBe(0);
    expect(called['adopt']).toBeGreaterThan(0);
    expect(called['measure']).toBeGreaterThan(0);
    expect(called['evaluate']).toBeGreaterThan(0);
    p.dsl.dispose();
  });

  it('ask mode: edits become pending proposals on the page log, by agent, under the session tx prefix', async () => {
    const p = await page({ mode: 'ask' });
    const h0 = p.log.stateHash;
    const r = await p.dsl.eval({ code: `frame.edit({ 'print.enlarger.time_s': 12.6 }, { why: 'darker' })\nreturn 1`, frame: FRAME });
    expect(r.error).toBeUndefined();
    expect(r.mutations).toHaveLength(1);
    expect(r.mutations[0]).toMatchObject({ by: 'agent', status: 'pending', tx: 'chat1-eval-1', why: 'darker', frame: FRAME });
    expect(p.log.pending().map((e) => e.seq)).toEqual([r.mutations[0]!.seq]);
    expect(p.log.stateHash).toBe(h0);
    // the photographer approves on the page; the next eval's context and recipe see it
    p.log.approve([r.mutations[0]!.seq]);
    const next = await p.dsl.eval({ code: 'return frame.recipe.print.enlarger.time_s', frame: FRAME });
    expect(next.yaml.split('\n')[0]).toBe('12.6');
    expect(next.context.proposals).toEqual(['eval-1 approved']);
    p.dsl.dispose();
  });

  it('auto mode applies at once as one unit; read-only appends nothing', async () => {
    const auto = await page({ mode: 'auto' });
    const r = await auto.dsl.eval({ code: `frame.edit({ 'print.enlarger.time_s': 14 })\nreturn 1`, frame: FRAME });
    expect(r.mutations[0]!.status).toBe('applied');
    expect(auto.log.committed.print.enlarger.time_s).toBe(14);
    auto.dsl.dispose();
    const ro = await page({ mode: 'read-only' });
    const r2 = await ro.dsl.eval({ code: `frame.edit({ 'print.enlarger.time_s': 14 })\nreturn 1`, frame: FRAME });
    expect(r2.error?.code).toBe('E_READONLY');
    expect(ro.log.entries).toHaveLength(0);
    ro.dsl.dispose();
  });

  it('the photographer changing the mode after the worker synced still decides (the page log is the arbiter)', async () => {
    const p = await page({ mode: 'auto' });
    await p.dsl.eval({ code: 'return 1', frame: FRAME }); // the worker mirrors mode auto
    p.log.setMode('read-only');
    const r = await p.dsl.eval({ code: `frame.edit({ 'print.enlarger.time_s': 14 })\nreturn 1`, frame: FRAME });
    expect(r.error?.code).toBe('E_READONLY');
    expect(p.log.entries).toHaveLength(0);
    p.dsl.dispose();
  });

  it('a user edit between evals reaches the worker mirror', async () => {
    const p = await page();
    expect((await p.dsl.eval({ code: 'return frame.recipe.print.enlarger.time_s', frame: FRAME })).yaml.split('\n')[0]).toBe('10');
    p.log.apply([{ op: 'set', path: 'print.enlarger.time_s', value: 11 }], 'user', 'time');
    expect((await p.dsl.eval({ code: 'return frame.recipe.print.enlarger.time_s', frame: FRAME })).yaml.split('\n')[0]).toBe('11');
    p.dsl.dispose();
  });

  it('a page log that refuses the replay (frame changed under the eval) is reported, not hidden', async () => {
    const p = await page({ mode: 'ask' });
    // the page log goes read-only between the worker's snapshot and the replay: simulate by switching while the eval runs
    const code = `const d = await frame.print().measure.densitometer({ at: [48, 32] })\nframe.edit({ 'print.enlarger.time_s': 13 })\nreturn d.D`;
    const measure = p.engine.measure.bind(p.engine);
    vi.spyOn(p.engine, 'measure').mockImplementation(async (n, s) => {
      p.log.setMode('read-only'); // the photographer locks the agent out while the eval measures
      return measure(n, s);
    });
    const r = await p.dsl.eval({ code, frame: FRAME });
    expect(r.mutations).toEqual([]);
    expect(r.warnings.some((w) => w.code === 'CONFLICT' && /E_READONLY/.test(w.message))).toBe(true);
    expect(r.yaml).toContain('host:');
    expect(p.log.entries).toHaveLength(0);
    p.dsl.dispose();
  });

  // In-thread, a synchronous loop also blocks the page's timers, so this loop awaits; the browser test stops a
  // synchronous loop in a real Worker.
  it('cancellation interrupts a running eval; mem survives', async () => {
    const p = await page();
    await p.dsl.eval({ code: 'mem.x = 41\nreturn 1', frame: FRAME });
    const ac = new AbortController();
    const t0 = Date.now();
    setTimeout(() => ac.abort(), 100);
    const r = await p.dsl.eval({ code: 'for (let i = 0; ; i++) await frame.print({ time_s: 10 + (i % 7) }).measure.densitometer({ at: [48, 32] })', frame: FRAME }, { signal: ac.signal });
    expect(r.error?.code).toBe('E_CANCELLED');
    expect(Date.now() - t0).toBeLessThan(1500);
    const again = await p.dsl.eval({ code: 'return mem.x + 1', frame: FRAME });
    expect(again.yaml.split('\n')[0]).toBe('42');
    expect(again.warnings.map((w) => w.code)).not.toContain('E_SESSION_RESET');
    p.dsl.dispose();
  });

  it('the session deadline stops runaway code (E_TIMEOUT)', async () => {
    const p = await page();
    const r = await p.dsl.eval({ code: 'for (;;) {}', frame: FRAME, timeoutMs: 200 });
    expect(r.error?.code).toBe('E_TIMEOUT');
    p.dsl.dispose();
  });

  it('a worker that does not stop is terminated after the grace period; the next eval is told mem was lost', async () => {
    let n = 0;
    const terminated: number[] = [];
    // the first worker swallows evals and interrupts (a VM stuck where the interrupt handler never runs)
    const spawn = (): WorkerLike => {
      const k = ++n;
      const w = inThreadWorker();
      if (k > 1) return w;
      return {
        ...w,
        postMessage: (m: unknown, tr?: Transferable[]) => {
          const t = (m as { t: string }).t;
          if (t !== 'eval' && t !== 'interrupt') w.postMessage(m, tr);
        },
        terminate: () => {
          terminated.push(k);
          w.terminate();
        },
      };
    };
    const p = await page({ spawn, client: { graceMs: 100 } });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 50);
    const r = await p.dsl.eval({ code: 'mem.x = 1\nreturn 1', frame: FRAME }, { signal: ac.signal });
    expect(r.error?.code).toBe('E_CANCELLED');
    expect(r.error?.hint).toMatch(/mem are lost/);
    expect(terminated).toEqual([1]);
    const next = await p.dsl.eval({ code: 'return typeof mem.x', frame: FRAME });
    expect(next.error).toBeUndefined();
    expect(next.warnings[0]?.code).toBe('E_SESSION_RESET');
    expect(n).toBe(2);
    p.dsl.dispose();
  });

  it('an eval that waits too long for its turn returns E_BUSY without running', async () => {
    const p = await page({ client: { busyMs: 50 } });
    const first = p.dsl.eval({ code: 'for (;;) {}', frame: FRAME, timeoutMs: 300 });
    const second = p.dsl.eval({ code: 'mem.ran = true\nreturn 2', frame: FRAME });
    const [a, b] = (await Promise.all([first, second])) as [EvalResult, EvalResult];
    expect(a.error?.code).toBe('E_TIMEOUT');
    expect(b.error?.code).toBe('E_BUSY');
    expect((await p.dsl.eval({ code: 'return mem.ran === undefined', frame: FRAME })).yaml.split('\n')[0]).toBe('true');
    p.dsl.dispose();
  });

  it('frames opened after the session started are sent before the next eval', async () => {
    const p = await page();
    const r0 = defaultRecipe('negative-scan', { sha256: p.info.sha256 }, { frame: 'frame_two' });
    const log2 = EditLog.create(r0, { mode: 'ask' });
    const ids = ['frame_m1', 'frame_two'];
    const frames = { ids: () => ids, get: (id: string) => (id === FRAME ? { log: p.log, info: p.info } : id === 'frame_two' ? { log: log2, info: p.info } : undefined) };
    const { DslWorkerClient } = await import('../src/index.ts');
    const c = await DslWorkerClient.create({ spawn: inThreadWorker, engine: p.engine, frames });
    const r = await c.eval({ code: 'return cb.frames().map(f => f.id)' });
    expect(r.error?.code ?? null).toBe(null);
    expect(r.yaml).toContain('frame_two');
    c.dispose();
    p.dsl.dispose();
  });
});
