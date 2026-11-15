// The DSL session behind the worker protocol (task 44uo; contract 1.0): the same results as an in-page DslSession,
// the engine reached only through adopt/measure/evaluate, the worker's copy of the log kept current, its submission
// made again on the page's log (the page's mode and documents decide), cancellation, the forced-restart backstop
// and E_BUSY.
import { describe, expect, it, vi } from 'vitest';
import { type EvalResult } from '@chromobench/contract';
import { DslSession, docsProvider, historyOf } from '@chromobench/dsl';
import { set } from '@chromobench/values';
import { DslWorkerClient, inThreadWorker, memoryDocs, type WorkerLike } from '../src/index.ts';
import { FRAME, m1Doc, page, param } from './helpers.ts';

const E1 = `const print = frame.print()
const grey = await print.measure.densitometer({ at: [48, 32], aperture_px: 15 })
print.show('current print')
return { stock: frame.get('stages.scan.medium.stock'), time_s: frame.get('main.params.time_s'), grey: grey.D }`;
const EDIT = (t: number): string => `frame.propose(set('main.params.time_s', ${t}), { why: 'darker' })\nreturn 1`;
const first = (yaml: string): string => yaml.split('\n')[0]!;

describe('DSL session in a worker', () => {
  it('returns what an in-page DslSession returns, images included', async () => {
    const p = await page();
    const viaWorker = await p.dsl.eval({ code: E1, frame: FRAME });
    const direct = await DslSession.create({ engine: p.engine, history: historyOf(p.docs), frames: { [FRAME]: { source: p.info, name: 'M1 test negative' } }, docs: docsProvider() });
    const inPage = await direct.eval({ code: E1, frame: FRAME });
    expect(viaWorker.error).toBeUndefined();
    expect(viaWorker.yaml).toBe(inPage.yaml);
    expect(viaWorker.shows).toHaveLength(1);
    expect(viaWorker.shows[0]!.image.bytes).toBeInstanceOf(Uint8Array);
    expect(viaWorker.shows[0]!.image.bytes.length).toBe(inPage.shows[0]!.image.bytes.length);
    expect(viaWorker.context).toEqual(inPage.context);
    direct.dispose();
    p.dsl.dispose();
  });

  it('reaches the engine only through adopt, measure and evaluate', async () => {
    const p = await page();
    const names = ['open', 'prepare', 'adopt', 'measure', 'evaluate', 'dispose'] as const;
    const spies = names.map((k) => vi.spyOn(p.engine, k));
    await p.dsl.eval({ code: E1, frame: FRAME });
    const called = Object.fromEntries(spies.map((s, i) => [names[i], s.mock.calls.length]));
    expect(called).toMatchObject({ open: 0, prepare: 0, dispose: 0 });
    expect(called['adopt']).toBeGreaterThan(0);
    expect(called['measure']).toBeGreaterThan(0);
    expect(called['evaluate']).toBeGreaterThan(0);
    p.dsl.dispose();
  });

  it('ask mode: the edit becomes a pending entry of the page log, by the agent, under the session tx prefix', async () => {
    const p = await page({ mode: 'ask' });
    const d0 = p.doc();
    const r = await p.dsl.eval({ code: EDIT(12.6), frame: FRAME });
    expect(r.error, r.yaml).toBeUndefined();
    expect(r.transactions).toHaveLength(1);
    expect(r.transactions[0]).toMatchObject({ doc: FRAME, why: 'darker', tx: { id: 'chat1-eval-1', by: 'agent', status: 'pending' } });
    expect(p.docs.log().pending().map((e) => e.seq)).toEqual([r.transactions[0]!.seq]);
    expect(p.doc()).toBe(d0);
    // the photographer approves on the page; the next eval's context and document see it
    p.docs.change((l) => l.approve(r.transactions[0]!.seq));
    const next = await p.dsl.eval({ code: "return frame.get('main.params.time_s')", frame: FRAME });
    expect(first(next.yaml)).toBe('12.6');
    expect(next.context.proposals).toEqual(['chat1-eval-1 approved']);
    p.dsl.dispose();
  });

  it('auto mode applies at once as one step; read-only appends nothing', async () => {
    const auto = await page({ mode: 'auto' });
    const r = await auto.dsl.eval({ code: EDIT(14), frame: FRAME });
    expect(r.transactions[0]!.tx.status).toBe('applied');
    expect(param(auto, 'main', 'time_s')).toBe(14);
    expect(auto.docs.log().steps).toHaveLength(1);
    auto.dsl.dispose();
    const ro = await page({ mode: 'read-only' });
    const r2 = await ro.dsl.eval({ code: EDIT(14), frame: FRAME });
    expect(r2.error?.code).toBe('E_READONLY');
    expect(ro.docs.log().entries).toHaveLength(0);
    ro.dsl.dispose();
  });

  it('the photographer changing the mode after the worker synced still decides (the page log is the arbiter)', async () => {
    const p = await page({ mode: 'auto' });
    await p.dsl.eval({ code: 'return 1', frame: FRAME }); // the worker copies mode auto
    p.docs.setMode('read-only');
    const r = await p.dsl.eval({ code: EDIT(14), frame: FRAME });
    expect(r.error?.code).toBe('E_READONLY');
    expect(p.docs.log().entries).toHaveLength(0);
    p.dsl.dispose();
  });

  it('a user edit between evals reaches the worker copy', async () => {
    const p = await page();
    expect(first((await p.dsl.eval({ code: "return frame.get('main.params.time_s')", frame: FRAME })).yaml)).toBe('10');
    p.userEdit(set('main.params.time_s', 11));
    expect(first((await p.dsl.eval({ code: "return frame.get('main.params.time_s')", frame: FRAME })).yaml)).toBe('11');
    p.dsl.dispose();
  });

  it('a page that went read-only while the eval ran refuses the submission, and the result says so', async () => {
    const p = await page({ mode: 'ask' });
    const code = `frame.propose(set('main.params.time_s', 13))\nconst d = await frame.print().measure.densitometer({ at: [48, 32] })\nreturn d.D`;
    const measure = p.engine.measure.bind(p.engine);
    vi.spyOn(p.engine, 'measure').mockImplementation(async (n, s) => {
      p.docs.setMode('read-only'); // the photographer locks the agent out while the eval measures
      return measure(n, s);
    });
    const r = await p.dsl.eval({ code, frame: FRAME });
    expect(r.transactions).toEqual([]);
    expect(r.warnings.some((w) => w.code === 'CONFLICT' && /E_READONLY/.test(w.message))).toBe(true);
    expect(r.yaml).toContain('host:');
    expect(p.docs.log().entries).toHaveLength(0);
    p.dsl.dispose();
  });

  it('auto mode: the photographer changed the same value while the eval ran: the page proposes instead of committing', async () => {
    const p = await page({ mode: 'auto' });
    const code = `frame.propose(set('main.params.time_s', 13))\nawait frame.print().measure.stats()\nreturn 1`;
    const measure = p.engine.measure.bind(p.engine);
    let once = true;
    vi.spyOn(p.engine, 'measure').mockImplementation(async (n, s) => {
      if (once) p.userEdit(set('main.params.time_s', 11));
      once = false;
      return measure(n, s);
    });
    const r = await p.dsl.eval({ code, frame: FRAME });
    expect(r.transactions.map((e) => e.tx.status)).toEqual(['pending']);
    expect(param(p, 'main', 'time_s')).toBe(11);
    expect(r.yaml).toMatch(/host:\n {2}- "frame_m1 changed while the eval ran/);
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
    const r = await p.dsl.eval({ code: "for (let i = 0; ; i++) await frame.with(set('main.params.time_s', 10 + (i % 7))).print().measure.densitometer({ at: [48, 32] })", frame: FRAME }, { signal: ac.signal });
    expect(r.error?.code).toBe('E_CANCELLED');
    expect(Date.now() - t0).toBeLessThan(1500);
    const again = await p.dsl.eval({ code: 'return mem.x + 1', frame: FRAME });
    expect(first(again.yaml)).toBe('42');
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
    const firstEval = p.dsl.eval({ code: 'for (;;) {}', frame: FRAME, timeoutMs: 300 });
    const second = p.dsl.eval({ code: 'mem.ran = true\nreturn 2', frame: FRAME });
    const [a, b] = (await Promise.all([firstEval, second])) as [EvalResult, EvalResult];
    expect(a.error?.code).toBe('E_TIMEOUT');
    expect(b.error?.code).toBe('E_BUSY');
    expect(first((await p.dsl.eval({ code: 'return mem.ran === undefined', frame: FRAME })).yaml)).toBe('true');
    p.dsl.dispose();
  });

  it('frames opened after the session started are sent before the next eval', async () => {
    const p = await page();
    const frames = new Map([[FRAME, { info: p.info }]]);
    const base = memoryDocs({ log: p.docs.log(), frames: {}, mode: 'ask' });
    const docs = { ...base, ids: () => [...frames.keys()].filter((id) => base.log().has(id)), get: (id: string) => frames.get(id) };
    const c = await DslWorkerClient.create({ spawn: inThreadWorker, engine: p.engine, docs });
    const list = async (): Promise<string> => first((await c.eval({ code: "return cb.frames().map(f => f.id + ':' + f.name).join(' ')" })).yaml);
    expect(await list()).toBe("'frame_m1:frame_m1'");
    // the studio opens a second frame: a new document in the log and a new frame entry
    base.change((l) => l.open('frame_two', m1Doc(p.info, 'frame_two'), { kind: 'frame' }));
    frames.set('frame_two', { info: p.info, name: 'Two' } as never);
    expect(await list()).toBe("'frame_m1:frame_m1 frame_two:Two'");
    c.dispose();
    p.dsl.dispose();
  });
});

describe('the workbench across the worker (CHB-037 P6b)', () => {
  it('wb calls go to the page and back; the entries a command made are the eval\'s transactions', async () => {
    const asked: string[] = [];
    const entry = { seq: 7, doc: 'main', at: 1, tx: { id: 's1', label: 'Rate', by: 'agent', status: 'pending', mutations: [], inverses: [], source: {} } };
    const workbench = {
      commands: () => [{ id: 'frame.rate', label: 'Set Stars', keys: [], args: ['n'], enabled: true, hidden: false, builtin: false }],
      run: (id: string, args: readonly unknown[], o: { eval: string }) => (asked.push(`${id} ${JSON.stringify(args)} ${o.eval}`), { ok: true, entries: [entry], how: 'proposed', module: 'print', frame: FRAME }),
      set: () => ({ ok: true, entries: [], how: 'none', module: null, frame: null }),
      selectors: () => [],
      state: (name: string) => ({ name }),
      screen: () => ({ layout: { id: 'tiny', label: 'Tiny', agent: false }, module: 'main', modules: [], frame: FRAME, tool: null, text: 'module main', controls: [] }),
      layouts: () => ({ current: { id: 'tiny', label: 'Tiny', agent: false }, available: [] }),
      build: (l: unknown) => ({ ok: true, layout: l, errors: [], warnings: [], explain: '', controls: [] }),
      use: () => ({ status: 'proposed', id: 'x', label: 'X', note: '' }),
    };
    const p = await page({ client: { workbench: workbench as never } });
    const r = await p.dsl.eval({ code: `const c = await wb.commands(); const ran = await wb.run('frame.rate', 2); return JSON.stringify({ n: c.length, how: ran.how, text: await wb.screen().explain(), st: await wb.state('current') })`, frame: FRAME });
    expect(r.error, r.yaml).toBeUndefined();
    expect(JSON.parse(first(r.yaml).slice(1, -1).replace(/''/g, "'"))).toEqual({ n: 1, how: 'proposed', text: 'module main', st: { name: 'current' } });
    expect(asked).toEqual(['frame.rate [2] chat1-eval-1']);
    expect(r.transactions.map((e) => e.seq)).toEqual([7]);
    // without a workbench on the page, wb is E_WORKBENCH in the worker too
    const q = await page();
    expect((await q.dsl.eval({ code: 'return await wb.commands()', frame: FRAME })).error?.code).toBe('E_WORKBENCH');
  });
});
