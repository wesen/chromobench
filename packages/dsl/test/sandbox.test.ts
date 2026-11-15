// Stage 1 (guide §9 sandbox tests): limits, the pump, globals, determinism and handle leaks.
import { describe, expect, it } from 'vitest';
import { setup } from './helpers.ts';

describe('time limits', () => {
  it('a synchronous loop → E_TIMEOUT within deadline + 100 ms, and mem survives', async () => {
    const s = await setup();
    await s.run('mem.x = 41');
    const t0 = Date.now();
    const r = await s.run('while (true) {}', { timeoutMs: 400 });
    const dt = Date.now() - t0;
    expect(r.error?.code).toBe('E_TIMEOUT');
    expect(dt).toBeLessThan(400 + 100);
    expect((await s.run('return mem.x + 1')).yaml.split('\n')[0]).toBe('42');
    s.session.dispose();
  });

  it('a loop after an await → E_TIMEOUT; afterwards the same VM runs promises and mem is intact', async () => {
    const s = await setup();
    await s.run('mem.y = 7');
    const r = await s.run('await frame.print().measure.stats()\nwhile (true) {}', { timeoutMs: 300 });
    expect(r.error?.code).toBe('E_TIMEOUT');
    const after = await s.run('const st = await frame.print().measure.stats()\nreturn mem.y + 1 + st.clipHigh');
    expect(after.error).toBeUndefined();
    expect(after.yaml.split('\n')[0]).toBe('8');
    s.session.dispose();
  });

  it('awaiting something that never settles → E_STALLED immediately', async () => {
    const s = await setup();
    const t0 = Date.now();
    const r = await s.run('await new Promise(() => {})\nreturn 1', { timeoutMs: 10_000 });
    expect(r.error?.code).toBe('E_STALLED');
    expect(Date.now() - t0).toBeLessThan(500);
    s.session.dispose();
  });
});

describe('memory limit', () => {
  it('a 100 MB allocation → E_MEMORY; the session is usable afterwards', async () => {
    const s = await setup();
    await s.run('mem.keep = 5');
    const r = await s.run('const a = []\nfor (;;) a.push(new Array(1e5).fill(1.5))', { timeoutMs: 20_000 });
    expect(r.error?.code).toBe('E_MEMORY');
    const after = await s.run('return typeof mem.keep');
    expect(after.error).toBeUndefined();
    // either the VM survived (mem intact) or it was restarted with a note on the error
    const survived = after.yaml.startsWith('number');
    if (!survived) expect(r.error?.hint).toMatch(/restarted; mem was lost/);
    expect((await s.run('return 1 + 1')).yaml.split('\n')[0]).toBe('2');
    s.session.dispose();
  }, 30_000);
});

describe('host promises (DR-2: sync variant, deferred promises)', () => {
  it('await chains and Promise.all over measurements', async () => {
    const s = await setup();
    const r = await s.run(`const p = frame.print()
const a = await p.measure.stats()
const [b, c] = await Promise.all([p.measure.densitometer({ at: [48, 32] }), frame.with(set('main.params.time_s', 20)).print().measure.densitometer({ at: [48, 32] })])
return { a: a.clipHigh, darker: c.D.every((d, k) => d > b.D[k]) }`);
    expect(r.error).toBeUndefined();
    expect(r.yaml).toMatch(/^a: 0\ndarker: true/);
    s.session.dispose();
  });

  it('a measurement started but not awaited is cancelled with an UNHANDLED warning', async () => {
    const s = await setup();
    const r = await s.run('frame.print().measure.stats().then(() => 0)\nreturn 1');
    expect(r.warnings.map((w) => w.code)).toContain('UNHANDLED');
    s.session.dispose();
  });
});

describe('the global surface (§5.5, §5.11)', () => {
  it('no network, timers, modules, clocks or WebAssembly', async () => {
    const s = await setup();
    const r = await s.run('return [typeof fetch, typeof setTimeout, typeof require, typeof Date, typeof WebAssembly, typeof XMLHttpRequest, typeof process].join(" ")');
    expect(r.yaml.split('\n')[0]).toBe('undefined undefined undefined undefined undefined undefined undefined');
    const imp = await s.run('return await import("x")');
    expect(imp.error?.code).toBe('E_SANDBOX');
    const f = await s.run('return fetch("https://example.com")');
    expect(f.error?.code).toBe('E_SANDBOX');
    s.session.dispose();
  });

  it('the host bridge is not reachable from guest code', async () => {
    const s = await setup();
    const r = await s.run('return [typeof host, typeof hostEval, typeof __native, Object.getOwnPropertyNames(globalThis).filter(k => /host|native/i.test(k)).length].join(" ")');
    expect(r.yaml.split('\n')[0]).toBe('undefined undefined undefined 0');
    s.session.dispose();
  });
});

describe('determinism', () => {
  it('the same eval on the same recipe gives byte-identical text; Math.random is seeded and frozen', async () => {
    const code = 'const xs = [Math.random(), Math.random()]\ntry { Math.random = () => 0 } catch (e) {}\nreturn { xs, still: Math.random() !== 0 }';
    const a = await setup();
    const b = await setup();
    const ra = await a.run(code);
    const rb = await b.run(code);
    expect(ra.yaml).toBe(rb.yaml);
    expect(ra.yaml).toMatch(/still: true/);
    const other = await a.run(`${code}\n// different code, different stream`);
    expect(other.yaml.split('\n')[0]).not.toBe(ra.yaml.split('\n')[0]);
    a.session.dispose();
    b.session.dispose();
  });
});

describe('errors point at agent lines', () => {
  it('syntax errors, and errors in mem functions from older evals', async () => {
    const s = await setup();
    const syn = await s.run('const a = 1\nconst = 2');
    expect(syn.error?.code).toBe('SyntaxError');
    expect(syn.error?.where?.line).toBe(2);
    const def = await s.run('mem.bad = (h) => {\n  return h.nope.x\n}');
    expect(def.error).toBeUndefined();
    const r = await s.run('const x = 1\nreturn mem.bad({})');
    expect(r.error?.code).toBe('TypeError');
    expect(r.error?.message).toMatch(/in code from eval \d+, line 2/);
    expect(r.error?.where?.line).toBe(2);
    s.session.dispose();
  });

  it('a top-level const from an earlier eval → ReferenceError with the mem hint', async () => {
    const s = await setup();
    await s.run('const greyD = 1');
    const r = await s.run('return greyD');
    expect(r.error?.code).toBe('ReferenceError');
    expect(r.error?.hint).toMatch(/keep values on mem/);
    expect(r.error?.fix).toBe('mem.greyD');
    s.session.dispose();
  });
});

describe('leaks', () => {
  it('1000 mixed evals, then the VM and runtime dispose cleanly', async () => {
    const s = await setup();
    const codes = [
      'return 1',
      'return await frame.print().measure.densitometer({ at: [48, 32] })',
      'return frame.negative().nope',
      'mem.n = (mem.n ?? 0) + 1; return { n: mem.n, h: frame.print() }',
      'await new Promise(() => {})',
      'frame.print().show("x"); return [1, 2, 3]',
      "frame.with(set('main.params.time_s', 12)).finished(); return frame.get('main.params.time_s')",
    ];
    for (let i = 0; i < 1000; i++) await s.run(codes[i % codes.length]!);
    expect(() => s.session.dispose()).not.toThrow();
  }, 60_000);
});
