import { describe, expect, it } from 'vitest';
import {
  check, ChromobenchError, defaultRecipe, EditLog, law, validateRecipe, type Diagnostic, type FrameRecipe, type Mutation, type Rng,
} from '@chromobench/contract';

const SHA = 'cd'.repeat(32);
const fresh = (mode: 'ask' | 'auto' | 'read-only' = 'ask'): EditLog => {
  let t = 1000;
  return EditLog.create(defaultRecipe('negative-scan', { sha256: SHA }), { mode, now: () => ++t });
};

function diagOf(f: () => unknown): Diagnostic {
  try {
    f();
  } catch (e) {
    if (e instanceof ChromobenchError) return e.diag;
    throw e;
  }
  throw new Error('expected a ChromobenchError');
}

const randomSet = (r: Rng): Mutation => {
  switch (r.int(0, 3)) {
    case 0: return { op: 'set', path: 'print.lights.logH', value: [r.range(-0.5, 0.5), r.range(-0.5, 0.5), r.range(-0.5, 0.5)] };
    case 1: return { op: 'set', path: 'print.enlarger.time_s', value: r.range(1, 60) };
    case 2: return { op: 'set', path: 'print.grade', value: r.range(0, 5) };
    default: return { op: 'set', path: 'print.enlarger.filtration', value: { c: r.int(0, 100), m: r.int(0, 100), y: r.int(0, 100) } };
  }
};

describe('recipe', () => {
  it('defaultRecipe validates; broken recipes do not', () => {
    expect(validateRecipe(defaultRecipe('negative-scan', { sha256: SHA }))).toEqual([]);
    expect(validateRecipe(defaultRecipe('digital-raw', { sha256: SHA }))).toEqual([]);
    const r = defaultRecipe('negative-scan', { sha256: SHA }) as unknown as Record<string, any>;
    r['print'].lights.logH = [9, 0, 0];
    expect(validateRecipe(r)[0]?.code).toBe('E_ARG_RANGE');
    expect(validateRecipe({ version: 2 })[0]?.code).toBe('E_RECIPE');
  });
});

describe('edit log', () => {
  it('apply validates paths and values; nothing is appended on failure', () => {
    const log = fresh();
    const h = log.stateHash;
    expect(diagOf(() => log.apply([{ op: 'set', path: 'print.lights', value: [0, 4, -2] }], 'user', 'x'))).toMatchObject({ code: 'E_PATH', valid: ['print.lights.auto', 'print.lights.logH'] });
    expect(diagOf(() => log.apply([{ op: 'set', path: 'print.enlarger.tim_s', value: 3 }], 'user', 'x'))).toMatchObject({ code: 'E_PATH', hint: 'did you mean print.enlarger.time_s?' });
    expect(diagOf(() => log.apply([{ op: 'set', path: 'capture.stock', value: 'x' }], 'user', 'x')).code).toBe('E_PATH');
    expect(diagOf(() => log.apply([{ op: 'sett' } as unknown as Mutation], 'user', 'x'))).toMatchObject({ code: 'E_UNKNOWN_OP', hint: 'did you mean set?' });
    expect(log.entries.length).toBe(0);
    expect(log.stateHash).toBe(h);
  });

  it('exposures by id, masks, and why()', () => {
    const log = fresh();
    log.apply([{ op: 'exposure.add', exposure: { id: 'sky', kind: 'burn', stops: 0.5 } }], 'user', 'burn sky');
    log.apply([{ op: 'set', path: 'print.exposures.sky.stops', value: 1 }], 'user', 'more');
    expect(log.state.print.exposures[0]!.stops).toBe(1);
    expect(diagOf(() => log.apply([{ op: 'set', path: 'print.exposures.nope.stops', value: 1 }], 'user', 'x')).code).toBe('E_PATH');
    expect(diagOf(() => log.apply([{ op: 'exposure.add', exposure: { id: 'sky', kind: 'burn' } }], 'user', 'x')).code).toBe('E_MUTATION');
    const w = log.why('print.exposures.sky.stops');
    expect(w.map((p) => p.op)).toEqual(['frame.add', 'exposure.add', 'set']);
  });

  it('the §6 flow: +4 pt red, preview, single apply, undo restores the hash exactly', () => {
    const log = fresh();
    const s0 = log.stateHash;
    for (let n = 1; n <= 4; n++) log.preview({ op: 'set', path: 'print.lights.logH', value: [0.025 * n, 0, 0] });
    expect(log.state.print.lights.logH[0]).toBeCloseTo(0.1, 12);
    expect(log.stateHash).toBe(s0);
    expect(log.entries.length).toBe(0);
    log.apply([{ op: 'set', path: 'print.lights.logH', value: [0.1, 0, 0] }], 'user', 'Printer lights');
    const s1 = log.stateHash;
    expect(s1).not.toBe(s0);
    expect(log.units.length).toBe(1);
    log.undo();
    expect(log.stateHash).toBe(s0);
    expect(log.entries.length).toBe(1);
    log.redo();
    expect(log.stateHash).toBe(s1);
  });

  it('ask mode: pending, approve, why says agent approved', () => {
    const log = fresh('ask');
    const before = log.stateHash;
    const p = log.propose([{ op: 'set', path: 'print.lights.logH', value: [0.1, 0, 0] }], { tx: 'eval-12', why: 'warm it up' });
    expect(p[0]).toMatchObject({ status: 'pending', by: 'agent', frame: log.frame, why: 'warm it up' });
    expect((p[0]!.m as { expect?: unknown }).expect).toEqual([0, 0, 0]);
    expect(log.stateHash).toBe(before);
    const u = log.approve(p.map((e) => e.seq));
    expect(Array.isArray(u)).toBe(false);
    const w = log.why('print.lights.logH');
    expect(w.at(-1)).toMatchObject({ by: 'agent', approvedBy: 'user', tx: 'eval-12' });
    expect(log.formatWhy('print.lights.logH')).toContain('approved');
  });

  it('read-only refuses; auto applies at once', () => {
    expect(diagOf(() => fresh('read-only').propose([{ op: 'set', path: 'print.grade', value: 3 }], { tx: 't' })).code).toBe('E_READONLY');
    const log = fresh('auto');
    log.propose([{ op: 'set', path: 'print.grade', value: 3 }], { tx: 't' });
    expect(log.state.print.grade).toBe(3);
  });

  it('agent cannot sneak in through apply', () => {
    expect(diagOf(() => fresh().apply([{ op: 'set', path: 'print.grade', value: 3 }], 'agent' as 'user', 'x')).code).toBe('E_READONLY');
  });

  // Laws §9
  const logLaws = [
    law('log.undo', (r) => Array.from({ length: r.int(0, 4) }, () => randomSet(r)).concat([randomSet(r)]), (ms: Mutation[]) => {
      const log = fresh();
      for (const m of ms.slice(0, -1)) log.apply([m], 'user', 'pre');
      const h = log.stateHash;
      log.apply([ms.at(-1)!], 'user', 'u');
      log.undo();
      return log.stateHash === h || 'undo did not restore the hash';
    }, { justifies: 'undo is a cursor over the fold (DR-5)', source: 'guide DR-5' }),
    law('log.redo', (r) => [randomSet(r), randomSet(r)], (ms: Mutation[]) => {
      const log = fresh();
      for (const m of ms) log.apply([m], 'user', 'u');
      const h = log.stateHash;
      log.undo();
      log.redo();
      return log.stateHash === h || 'redo did not restore the hash';
    }, { justifies: 'redo re-applies the same unit (DR-5)', source: 'guide DR-5' }),
    law('log.approve', (r) => randomSet(r), (m: Mutation) => {
      const a = fresh();
      a.apply([m], 'user', 'u');
      const b = fresh('ask');
      const p = b.propose([m], { tx: 't' });
      b.approve(p.map((e) => e.seq));
      const c = fresh('auto');
      c.propose([m], { tx: 't' });
      return (a.stateHash === b.stateHash && b.stateHash === c.stateHash) || 'approve/auto differ from apply';
    }, { justifies: 'approval applies exactly what was proposed (DR-7)', source: 'guide DR-7' }),
    law('log.stale', (r) => r.range(0.01, 0.4), (v: number) => {
      const log = fresh('ask');
      const p = log.propose([{ op: 'set', path: 'print.lights.logH', value: [v, 0, 0] }], { tx: 't' });
      log.apply([{ op: 'set', path: 'print.lights.logH', value: [0, v, 0] }], 'user', 'meanwhile');
      const h = log.stateHash;
      const res = log.approve(p.map((e) => e.seq));
      if (!Array.isArray(res) || res[0]?.code !== 'E_STALE') return 'expected E_STALE';
      return log.stateHash === h || 'stale approval changed the state';
    }, { justifies: 'a stale proposal never silently undoes the photographer (DR-7)', source: 'guide DR-7' }),
    law('log.ts', (r) => [randomSet(r), r.int(0, 1e9)] as const, ([m, t0]) => {
      const a = EditLog.create(defaultRecipe('negative-scan', { sha256: SHA }), { now: () => t0 });
      const b = EditLog.create(defaultRecipe('negative-scan', { sha256: SHA }), { now: () => t0 + 12345 });
      a.apply([m], 'user', 'u');
      b.apply([m], 'user', 'u');
      return (a.stateHash === b.stateHash && a.logHash === b.logHash) || 'timestamps leaked into a hash';
    }, { justifies: 'hashes compare states across machines and runs', source: 'guide §5.8' }),
    law('log.preview', (r) => [randomSet(r), randomSet(r)] as const, ([m, p]) => {
      const log = fresh();
      log.apply([m], 'user', 'u');
      const h = log.stateHash;
      const n = log.entries.length;
      log.preview(p);
      return (log.stateHash === h && log.entries.length === n) || 'preview changed the journal or the hash';
    }, { justifies: 'drags are gestures; only release is logged (DR-6)', source: 'guide DR-6' }),
  ];

  it('edit-log laws hold (n = 200, seed 1)', () => {
    for (const r of check(logLaws, { n: 200, seed: 1 })) expect(r, `${r.name}: ${r.message}`).toMatchObject({ ok: true });
  });

  it('a log whose undo does nothing fails log.undo', () => {
    class Broken extends EditLog {
      override undo(): boolean {
        return true;
      }
    }
    const broken = law('log.undo.broken', (r) => randomSet(r), (m: Mutation) => {
      const log = new Broken(fresh().toJSON());
      const h = log.stateHash;
      log.apply([m], 'user', 'u');
      log.undo();
      return log.stateHash === h || 'undo did not restore the hash';
    }, { justifies: 'mutant', source: 'test' });
    expect(check([broken], { n: 20, seed: 1 })[0]!.ok).toBe(false);
  });

  it('persists and reloads', () => {
    const log = fresh();
    log.apply([{ op: 'set', path: 'print.grade', value: 3 }], 'user', 'g');
    const again = new EditLog(JSON.parse(JSON.stringify(log.toJSON())) as ReturnType<EditLog['toJSON']>);
    expect(again.stateHash).toBe(log.stateHash);
    expect((again.state as FrameRecipe).print.grade).toBe(3);
  });
});
