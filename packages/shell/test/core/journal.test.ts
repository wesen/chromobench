// The diagnostics journal (CHB-038): dedupe and counts, the ring, filters, the tail that survives a reload, the
// badge's unseen count, the console and error capture layers, and the runtime's capture (commands, log entries,
// refusals, runtime diagnostics).
import { describe, expect, it } from 'vitest';
import { captureConsole, captureErrors, createCk, isJournalSnapshot, Journal, journalData, rowText } from '../../src/index.ts';

const clock = () => {
  let t = 1_700_000_000_000;
  return { now: () => (t += 1000) };
};

describe('Journal', () => {
  it('a repeated event is one row with its count, first and last time', () => {
    const j = new Journal({ ...clock(), session: 's1' });
    j.error('gpu', 'Validation error in [ComputePipeline "pointwise"]', { code: 'GPU_VALIDATION', data: { n: 1 } });
    j.info('command', 'frame.next');
    const r = j.error('gpu', 'Validation error in [ComputePipeline "pointwise"]', { code: 'GPU_VALIDATION', data: { n: 2 } })!;
    expect(j.size).toBe(2);
    expect(r.count).toBe(2);
    expect(r.last - r.first).toBe(2000);
    expect(r.data).toEqual({ n: 2 });
    // the repeat moved to the end (rows are ordered by their last occurrence)
    expect(j.rows().map((x) => x.source)).toEqual(['command', 'gpu']);
    expect(j.totals()).toEqual({ debug: 0, info: 1, warn: 0, error: 2 });
    expect(rowText(r)).toMatch(/ERROR gpu GPU_VALIDATION ×2 \(first \d\d:\d\d:\d\d\.\d{3}\) Validation error/);
  });

  it('keeps `capacity` rows: the ones that stopped happening go first', () => {
    const j = new Journal({ capacity: 10 });
    for (let i = 0; i < 10; i++) j.info('app', `event ${i}`);
    j.info('app', 'event 0');
    j.info('app', 'event 10');
    const msgs = j.rows().map((r) => r.message);
    expect(msgs).toHaveLength(10);
    expect(msgs).not.toContain('event 1');
    expect(msgs).toContain('event 0');
    expect(j.totals().info).toBe(12);
  });

  it('drops debug events unless debug is on; filters by level, source, text and limit', () => {
    const j = new Journal();
    expect(j.debug('engine', 'rendered')).toBeNull();
    j.debugOn = true;
    j.debug('engine', 'rendered screen');
    j.warn('worker', 'slow decode');
    j.error('decode', 'LibRaw: not a raw file', { code: 'E_FORMAT' });
    expect(j.rows({ level: 'warn' }).map((r) => r.source)).toEqual(['worker', 'decode']);
    expect(j.rows({ source: ['engine', 'decode'] })).toHaveLength(2);
    expect(j.rows({ text: 'e_format' })).toHaveLength(1);
    expect(j.rows({ limit: 1 })[0]!.source).toBe('decode');
  });

  it('counts unseen errors for the badge until markSeen', () => {
    const j = new Journal();
    const seen: (string | null)[] = [];
    j.subscribe((r) => seen.push(r ? r.message : null));
    j.error('gpu', 'lost');
    j.error('gpu', 'lost');
    expect(j.unseenErrors).toBe(2);
    j.markSeen();
    expect(j.unseenErrors).toBe(0);
    j.warn('app', 'not an error');
    expect(j.unseenErrors).toBe(0);
    expect(seen).toEqual(['lost', 'lost', null, 'not an error']);
  });

  it('a tail of the last rows and every error survives into the next session', () => {
    const a = new Journal({ session: 'a' });
    a.error('gpu', 'early error');
    for (let i = 0; i < 20; i++) a.info('command', `c${i}`);
    const tail = JSON.parse(JSON.stringify(a.tail(5)));
    expect(isJournalSnapshot(tail)).toBe(true);
    expect(tail.rows.map((r: { message: string }) => r.message)).toEqual(['early error', 'c15', 'c16', 'c17', 'c18', 'c19']);
    const b = new Journal({ session: 'b' });
    b.info('app', 'started');
    expect(b.restore(tail)).toBe(6);
    const rows = b.rows();
    expect(rows[0]!.session).toBe('a');
    expect(rows.at(-1)!.message).toBe('started');
    expect(rows.filter((r) => r.session === 'a').every((r) => r.id < 0)).toBe(true);
    expect(b.rows({ session: 'this' })).toHaveLength(1);
    expect(b.restore({ format: 'nope' })).toBe(0);
    expect(b.explain()).toMatch(/1 earlier session kept/);
  });

  it('makes data JSON-safe: errors, typed arrays, cycles, depth', () => {
    const cyc: Record<string, unknown> = { a: 1 };
    cyc['self'] = cyc;
    const d = journalData({ e: Object.assign(new Error('boom'), { code: 'E_X' }), px: new Float32Array(4), cyc, f: () => 1 }) as Record<string, Record<string, unknown>>;
    expect(d['e']!['message']).toBe('boom');
    expect(d['e']!['code']).toBe('E_X');
    expect(d['px']).toBe('[Float32Array 16 bytes]');
    expect(d['cyc']!['self']).toBe('[circular]');
    expect('f' in d).toBe(false);
  });
});

describe('capture layers', () => {
  it('console.error and console.warn go into the journal; the console still shows them; journal events are mirrored once', () => {
    const calls: string[] = [];
    const con = { error: (...a: unknown[]) => calls.push(`E ${a[0]}`), warn: (...a: unknown[]) => calls.push(`W ${a[0]}`), info: (...a: unknown[]) => calls.push(`I ${a[0]}`) };
    const j = new Journal();
    const stop = captureConsole(j, con);
    con.error('WebGPU: device lost', new Error('x'));
    con.warn('something odd');
    expect(j.rows().map((r) => [r.level, r.source, r.message])).toEqual([
      ['error', 'gpu', 'WebGPU: device lost x'],
      ['warn', 'app', 'something odd'],
    ]);
    j.error('engine', 'render failed');
    j.error('engine', 'render failed');
    j.info('sw', 'registered');
    expect(calls).toEqual(['E WebGPU: device lost', 'W something odd', 'E [engine] render failed', 'I [sw] registered']);
    stop();
    con.error('after');
    expect(j.rows({ text: 'after' })).toHaveLength(0);
  });

  it('uncaught errors and unhandled rejections', () => {
    const t = new EventTarget();
    const j = new Journal();
    const stop = captureErrors(j, t as never);
    t.dispatchEvent(Object.assign(new Event('error'), { error: new Error('kaboom'), filename: 'main.ts', lineno: 3, colno: 4 }));
    t.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: Object.assign(new Error('GPU device lost'), { code: 'E_DEVICE_LOST' }) }));
    expect(j.rows().map((r) => [r.code, r.source, r.message])).toEqual([
      ['UNCAUGHT', 'app', 'Uncaught: kaboom'],
      ['UNHANDLED_REJECTION', 'app', 'Unhandled rejection: E_DEVICE_LOST: GPU device lost'],
    ]);
    stop();
  });

  it('a runtime with services.journal records commands, log entries, undo, refusals and its diagnostics', async () => {
    const ck = createCk();
    const kit = ck
      .kit('k')
      .state('doc', { init: { n: 1 } })
      .commands({
        'n.set': { label: 'Set N', run: (ctx: any, n: number) => ctx.tx(`N ${n}`, (t: any) => void (t.doc.n = n)) },
        'n.boom': { label: 'Boom', run: () => { throw new Error('handler broke'); } },
      });
    const app = ck.shell('S').use(kit).module(ck.module('main', { label: 'Main' }).center(ck.text('x'))).build();
    const j = new Journal();
    const rt = app.start({ journal: j });
    rt.run('n.set', 4);
    rt.run('n.set', 4);
    rt.undo();
    rt.run('n.boom');
    const rows = j.rows().map((r) => `${r.source}:${r.message}${r.count > 1 ? `×${r.count}` : ''}`);
    expect(rows).toEqual(expect.arrayContaining(['command:n.set×2', 'store:N 4', 'store:Undo N 4', 'command:n.boom', 'ui:A handler threw']));
    rt.dispose();
    rt.emit('command', 'after', []);
    expect(j.rows({ text: 'after' })).toHaveLength(0);
  });
});
