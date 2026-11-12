import { describe, expect, it } from 'vitest';
import {
  accessorNode, applyMutation, check, ChromobenchError, compile, CONTRACT_VERSION, cut, defaultRecipe, EditLog, ERROR_CODES, getOp, Graph, law,
  migrateRecipe, PRINT_OPTION_PATHS, PRINT_OPTIONS, RECIPE_VERSION, renameLegacyValues, validateRecipe, validateRoll,
  type Diagnostic, type FrameRecipe, type Mutation, type Rng,
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

/** The same recipe as a version-1 document (contracts 0.1, 0.2): orientation and crop under scan, no 0.3 fields. */
function asV1(r: FrameRecipe): Record<string, any> {
  const o = structuredClone(r) as unknown as Record<string, any>;
  o['version'] = 1;
  if (o['scan']) {
    o['scan'].orientation = o['view'].frame.orientation;
    o['scan'].crop = o['view'].frame.crop;
    delete o['scan'].baseT;
  }
  delete o['view'].frame;
  delete o['print'].densityMasks;
  delete o['retouch'];
  delete o['roll'];
  return o;
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

describe('contract 0.2 (CHB-017)', () => {
  it('the new codes', () => {
    for (const c of ['W_DECODE_NOTE', 'SyntaxError', 'ReferenceError', 'TypeError', 'RangeError', 'Error']) expect(Object.keys(ERROR_CODES)).toContain(c);
  });

  it('filtration is a signed shift: −10 Y validates, below −100 does not', () => {
    const r = defaultRecipe('negative-scan', { sha256: SHA });
    expect(validateRecipe({ ...r, print: { ...r.print, enlarger: { ...r.print.enlarger, filtration: { c: 0, m: -5, y: -10 } } } })).toEqual([]);
    const bad = validateRecipe({ ...r, print: { ...r.print, enlarger: { ...r.print.enlarger, filtration: { c: 0, m: 0, y: -101 } } } });
    expect(bad[0]!.code).toBe('E_ARG_RANGE');
    expect(bad[0]!.path).toBe('print.enlarger.filtration');
  });

  it("knee 'cam16-ucs' is renamed 'oklch'; migrateRecipe rewrites pre-0.2 (version-1) recipes", () => {
    const r = defaultRecipe('negative-scan', { sha256: SHA });
    expect(r.view.output.display.knee.method).toBe('oklch');
    const old = asV1(r);
    old['view'].output.display.knee.method = 'cam16-ucs';
    old['view'].output.export.knee.method = 'cam16-ucs';
    expect(validateRecipe(old).length).toBeGreaterThan(0);
    const m = migrateRecipe(old);
    expect([m.view.output.display.knee.method, m.view.output.export.knee.method]).toEqual(['oklch', 'oklch']);
    expect(old['view'].output.display.knee.method).toBe('cam16-ucs'); // the input is not mutated
    expect(renameLegacyValues(r as unknown as Record<string, unknown>)).toBe(r);
  });

  it("an edit log persisted under 0.1 with 'cam16-ucs' loads, initial recipe and logged sets renamed", () => {
    const log = fresh();
    log.apply([{ op: 'set', path: 'view.output.display.knee.method', value: 'clip' }], 'user', 'knee');
    const data = log.toJSON() as unknown as Record<string, any>;
    data['version'] = 1;
    data['initial'] = asV1(data['initial']);
    data['initial'].view.output.display.knee.method = 'cam16-ucs';
    data['entries'][0].m.value = 'cam16-ucs';
    const back = new EditLog(data as never);
    expect(back.toJSON().initial.view.output.display.knee.method).toBe('oklch');
    expect(back.state.view.output.display.knee.method).toBe('oklch');
  });

  it('compile passes print.aim and the viewing light to print.expose', () => {
    const r = defaultRecipe('negative-scan', { sha256: SHA });
    r.print.aim = 'midgray-normalised';
    r.view.illuminant = 'D65';
    const g = new Graph();
    g.registerSource({
      sha256: SHA, format: 'tiff', width: 8, height: 6, channels: 3, bits: 16, sample: 'uint', encoding: { value: 'linear', evidence: 'format' },
      levels: { black: [0, 0, 0], white: [65535, 65535, 65535], from: 'default' }, cfa: 'none', clippedFraction: 0, notes: [],
    });
    const root = compile(r, g);
    const expose = g.closure(root.id).find((n) => n.op === 'print.expose')!;
    expect(expose.args['aim']).toBe('midgray-normalised');
    expect(expose.args['aimView']).toBe('D65');
  });

  it('ring-around steps are printer points; step_cc redirects with a hint', () => {
    const op = getOp('darkroom.ringAround');
    expect(op.args['step_pt']!.unit).toBe('point');
    const g = new Graph();
    const src = g.intern('source.pattern', [], { domain: 'film-dyes', width: 6, height: 6, seed: 1 }).node;
    const d = diagOf(() => g.intern('darkroom.ringAround', [src.id], { step_cc: 10 }));
    expect(d.code).toBe('E_UNKNOWN_OPTION');
    expect(d.hint).toMatch(/points/);
  });
});

describe('contract 0.3 (CHB-024)', () => {
  const g0 = (): Graph => {
    const g = new Graph();
    g.registerSource({
      sha256: SHA, format: 'tiff', width: 8, height: 6, channels: 3, bits: 16, sample: 'uint', encoding: { value: 'linear', evidence: 'format' },
      levels: { black: [0, 0, 0], white: [65535, 65535, 65535], from: 'default' }, cfa: 'none', clippedFraction: 0, notes: [],
    });
    return g;
  };
  const ops = (g: Graph, r: FrameRecipe): string[] => g.closure(compile(r, g).id).map((n) => n.op);
  const nodeOf = (g: Graph, r: FrameRecipe, op: string) => g.closure(compile(r, g).id).find((n) => n.op === op)!;

  it('the version, recipe version 2, the roll and film-layout codes, Diagnostic.where.file', () => {
    expect(CONTRACT_VERSION).toBe('0.4.0');
    expect(RECIPE_VERSION).toBe(2);
    for (const c of ['W_ROLL_MIXED', 'W_ROLL_STOCK_AMBIGUOUS', 'W_ROLL_BASE_WEAK', 'W_FRAME_DIVERGES', 'W_NO_SURROUND', 'W_SURROUND_BRIGHT', 'W_REBATE_BLANK', 'W_NO_REBATE', 'W_NO_FILM', 'W_VEIL_FROM_ROLL']) {
      expect(Object.keys(ERROR_CODES)).toContain(c);
    }
    const d: Diagnostic = { code: 'E_PATH', message: 'x', where: { line: 3, file: 'variants/darkroom.ts' } };
    expect(d.where?.file).toBe('variants/darkroom.ts');
  });

  it('migrateRecipe: version 1 → 2 moves orientation and crop to view.frame and adds the 0.3 fields', () => {
    const r = defaultRecipe('negative-scan', { sha256: SHA });
    const v1 = asV1(r);
    v1['scan'].orientation = 'cw90';
    v1['scan'].crop = { x: 1, y: 2, w: 3, h: 4 };
    const m = migrateRecipe(v1);
    expect(m.version).toBe(2);
    expect(m.view.frame).toEqual({ orientation: 'cw90', angle_deg: 0, crop: { x: 1, y: 2, w: 3, h: 4 } });
    expect(m.scan!.baseT).toBeNull();
    expect('orientation' in m.scan!).toBe(false);
    expect(m.print.densityMasks).toEqual({});
    expect(m.retouch).toEqual({ spots: {} });
    expect(m.roll).toBeNull();
    const raw = migrateRecipe(asV1(defaultRecipe('digital-raw', { sha256: SHA })));
    expect(raw.view.frame.orientation).toBe('none');
    // a version-2 recipe may now select CAM16-UCS under its own name, and keeps it
    const c = structuredClone(r);
    c.view.output.display.knee.method = 'cam16-ucs';
    expect(validateRecipe(c)).toEqual([]);
    expect(migrateRecipe(c as never).view.output.display.knee.method).toBe('cam16-ucs');
  });

  it('a version-1 edit log loads: its set paths move to view.frame; toJSON writes version 2', () => {
    const log = fresh();
    log.apply([{ op: 'set', path: 'view.frame.orientation', value: 'rot180' }], 'user', 'rotate');
    const data = log.toJSON() as unknown as Record<string, any>;
    data['version'] = 1;
    data['initial'] = asV1(data['initial']);
    data['entries'][0].m.path = 'scan.orientation';
    const back = new EditLog(data as never);
    expect(back.state.view.frame.orientation).toBe('rot180');
    expect(back.toJSON().version).toBe(2);
    expect(back.toJSON().entries[0]!.m).toMatchObject({ path: 'view.frame.orientation' });
  });

  it('scan.orientation / scan.crop say where they went', () => {
    const d = diagOf(() => fresh().apply([{ op: 'set', path: 'scan.crop', value: { x: 0, y: 0, w: 4, h: 4 } }], 'user', 'crop'));
    expect(d.code).toBe('E_PATH');
    expect(d.fix).toBe('view.frame.crop');
  });

  it('EditLog.preview takes several mutations; state applies them in order; the event lists them all', () => {
    const log = fresh();
    const seen: unknown[] = [];
    log.on((e) => { if (e.type === 'preview') seen.push(e.mutations.length, e.mutation); });
    const ms: Mutation[] = [{ op: 'set', path: 'print.enlarger.time_s', value: 12 }, { op: 'set', path: 'print.lights.logH', value: [0.1, 0, 0] }];
    log.preview(ms);
    expect(log.state.print.enlarger.time_s).toBe(12);
    expect(log.state.print.lights.logH).toEqual([0.1, 0, 0]);
    expect(log.committed.print.enlarger.time_s).toBe(10);
    expect(seen).toEqual([2, ms[0]]);
    expect(() => log.preview([ms[0]!, { op: 'set', path: 'print.grade', value: 99 }])).toThrow(ChromobenchError);
    log.preview([]);
    expect(log.state).toBe(log.committed);
    log.preview(ms[1]!);
    expect(log.state.print.lights.logH).toEqual([0.1, 0, 0]);
  });

  it('LoggedMutation.batch: apply and propose record it; approve and reject act on a whole batch', () => {
    const log = fresh();
    log.apply([{ op: 'set', path: 'print.enlarger.time_s', value: 11 }], 'user', 'first print', { tx: 'roll:1', batch: 'b1' });
    expect(log.entries[0]!.batch).toBe('b1');
    log.propose([{ op: 'set', path: 'print.grade', value: 3 }, { op: 'set', path: 'print.preflash', value: 0.01 }], { tx: 'a1', batch: 'b2' });
    log.propose([{ op: 'set', path: 'view.flare', value: 0.3 }], { tx: 'a2' });
    const u = log.approve({ batch: 'b2' });
    expect(Array.isArray(u)).toBe(false);
    expect(log.state.print.grade).toBe(3);
    expect(log.state.print.preflash).toBe(0.01);
    expect(log.pending().map((e) => e.tx)).toEqual(['a2']);
    expect((log.approve({ batch: 'nope' }) as Diagnostic[])[0]!.code).toBe('E_MUTATION');
    log.propose([{ op: 'set', path: 'print.grade', value: 4 }], { tx: 'a3', batch: 'b3' });
    log.reject({ batch: 'b3' });
    expect(log.pending().map((e) => e.tx)).toEqual(['a2']);
  });

  it('retouch.spots.<id> and print.densityMasks.<id>: set adds or replaces, null deletes; bad entries are refused', () => {
    const r = defaultRecipe('negative-scan', { sha256: SHA });
    const spot = { mode: 'clone', x: 10, y: 12, r: 4, src: { x: 30, y: 12 }, feather: 0.5, opacity: 1, enabled: true };
    let x = applyMutation(r, { op: 'set', path: 'retouch.spots.s1', value: spot }).recipe;
    expect(x.retouch.spots['s1']).toEqual(spot);
    expect(validateRecipe(x)).toEqual([]);
    x = applyMutation(x, { op: 'set', path: 'retouch.spots.s1', value: null }).recipe;
    expect(x.retouch.spots).toEqual({});
    expect(applyMutation(x, { op: 'set', path: 'retouch.spots.s9', value: null }).recipe).toBe(x);
    expect(diagOf(() => applyMutation(r, { op: 'set', path: 'retouch.spots.s1', value: { ...spot, r: 0 } })).code).toBe('E_ARG_TYPE');
    const dm = { kind: 'contrast', polarity: 'positive', amount: 0.4, radius_um: 600, enabled: true };
    x = applyMutation(r, { op: 'set', path: 'print.densityMasks.m1', value: dm }).recipe;
    expect(validateRecipe(x)).toEqual([]);
    expect(applyMutation(x, { op: 'set', path: 'print.densityMasks.m1', value: null }).recipe.print.densityMasks).toEqual({});
    expect(diagOf(() => applyMutation(r, { op: 'set', path: 'print.densityMasks.m1', value: { ...dm, amount: 2 } })).code).toBe('E_ARG_TYPE');
    // other paths still refuse null
    expect(diagOf(() => applyMutation(r, { op: 'set', path: 'print.grade', value: null })).code).toBe('E_ARG_TYPE');
  });

  it('scan.flare is a number or a per-channel vec3; compile passes it; zero is omitted', () => {
    const r = defaultRecipe('negative-scan', { sha256: SHA });
    const v = applyMutation(r, { op: 'set', path: 'scan.flare', value: [0.01, 0.08, 0.08] }).recipe;
    expect(validateRecipe(v)).toEqual([]);
    expect(diagOf(() => applyMutation(r, { op: 'set', path: 'scan.flare', value: [0, 30, 0] })).code).toBe('E_ARG_RANGE');
    expect(diagOf(() => applyMutation(r, { op: 'set', path: 'scan.flare', value: [0, 1] })).code).toBe('E_ARG_TYPE');
    const g = g0();
    expect(nodeOf(g, v, 'scan.flare').args['flare']).toEqual([0.01, 0.08, 0.08]);
    expect(ops(g, { ...v, scan: { ...v.scan!, flare: [0, 0, 0] } })).not.toContain('scan.flare');
    expect(nodeOf(g, { ...v, scan: { ...v.scan!, flare: 1.5 } }, 'scan.flare').args['flare']).toBe(1.5);
  });

  it('scan.baseT: the roll base wins over the rebate box in scan.density', () => {
    const r = defaultRecipe('negative-scan', { sha256: SHA });
    const g = g0();
    const withBox = { ...r, scan: { ...r.scan!, rebate: { x: 0, y: 0, w: 2, h: 6 } } };
    expect(nodeOf(g, withBox, 'scan.density').args['rebate']).toEqual({ x: 0, y: 0, w: 2, h: 6 });
    const both = applyMutation(withBox, { op: 'set', path: 'scan.baseT', value: [0.5, 0.4, 0.3] }).recipe;
    const d = nodeOf(g, both, 'scan.density');
    expect(d.args['baseT']).toEqual([0.5, 0.4, 0.3]);
    expect(d.args['rebate']).toBeUndefined();
    expect(diagOf(() => applyMutation(r, { op: 'set', path: 'scan.baseT', value: [0, 1, 1] })).code).toBe('E_ARG_RANGE');
  });

  it('view.frame: output.frame takes orientation, angle and crop for both frame kinds', () => {
    for (const kind of ['negative-scan', 'digital-raw'] as const) {
      let r = defaultRecipe(kind, { sha256: SHA });
      r = applyMutation(r, { op: 'set', path: 'view.frame.angle_deg', value: 1.5 }).recipe;
      r = applyMutation(r, { op: 'set', path: 'view.frame.crop', value: { x: 1, y: 1, w: 5, h: 4 } }).recipe;
      r = applyMutation(r, { op: 'set', path: 'view.frame.orientation', value: 'cw90' }).recipe;
      const g = g0();
      const top = compile(r, g);
      expect(top.op).toBe('output.frame');
      expect(top.args).toMatchObject({ orientation: 'cw90', angle_deg: 1.5, crop: { x: 1, y: 1, w: 5, h: 4 } });
      expect(top.info).toMatchObject({ width: 4, height: 5 });
    }
    expect(diagOf(() => applyMutation(defaultRecipe('digital-raw', { sha256: SHA }), { op: 'set', path: 'view.frame.angle_deg', value: 50 })).code).toBe('E_ARG_RANGE');
  });

  it('flashes go through the base or an empty gate; density masks reach print.combine; retouch.heal sits before finishing', () => {
    let r = defaultRecipe('negative-scan', { sha256: SHA });
    r = applyMutation(r, { op: 'exposure.add', exposure: { id: 'f1', kind: 'flash', time_s: 1 } }).recipe;
    r = applyMutation(r, { op: 'exposure.add', exposure: { id: 'f2', kind: 'flash', time_s: 1, through: 'open' } }).recipe;
    r = applyMutation(r, { op: 'exposure.add', exposure: { id: 'b1', kind: 'burn', stops: 1 } }).recipe;
    r = applyMutation(r, { op: 'set', path: 'print.densityMasks.m1', value: { kind: 'contrast', polarity: 'positive', amount: 0.5, radius_um: 400, enabled: true } }).recipe;
    r = applyMutation(r, { op: 'set', path: 'print.densityMasks.m0', value: { kind: 'unsharp', polarity: 'same', amount: 0.2, radius_um: 40, enabled: true } }).recipe;
    r = applyMutation(r, { op: 'set', path: 'print.densityMasks.off', value: { kind: 'unsharp', polarity: 'same', amount: 0.2, radius_um: 40, enabled: false } }).recipe;
    r = applyMutation(r, { op: 'set', path: 'retouch.spots.s1', value: { mode: 'heal', x: 3, y: 3, r: 1, src: { x: 5, y: 3 }, feather: 0.5, opacity: 1, enabled: true } }).recipe;
    r = applyMutation(r, { op: 'set', path: 'finishing.values.clarity', value: 0.3 }).recipe;
    const g = g0();
    const comb = nodeOf(g, r, 'print.combine');
    expect(comb.args['modes']).toEqual(['flash-base', 'flash-open', 'add']);
    const dms = comb.args['densityMasks'] as string[];
    expect(dms.length).toBe(2);
    const masks = dms.map((id) => g.get(id)!);
    expect(masks.map((n) => n.args['polarity'])).toEqual(['same', 'positive']); // sorted by id: m0, m1
    const mainExpose = g.get(comb.inputs[0]!)!;
    expect(masks.every((m) => m.inputs[0] === mainExpose.id && m.info.kind === 'Image' && (m.info as { domain: string }).domain === 'scalar-field')).toBe(true);
    const order = ops(g, r);
    expect(order.indexOf('view.adapt')).toBeLessThan(order.indexOf('retouch.heal'));
    expect(order.indexOf('retouch.heal')).toBeLessThan(order.indexOf('finishing.clarity'));
    expect(JSON.parse(nodeOf(g, r, 'retouch.heal').args['spots'] as string)).toHaveProperty('s1');
    // no spots, no masks, no exposures: the chain is as before
    const plain = ops(g0(), defaultRecipe('negative-scan', { sha256: SHA }));
    expect(plain).not.toContain('retouch.heal');
    expect(plain).not.toContain('print.combine');
    expect(diagOf(() => g.intern('print.combine', [mainExpose.id], { modes: ['flash'], exposures: [mainExpose.id], masks: [dms[0]!] })).code).toBe('E_ARG_RANGE');
  });

  it('darkroom.lightsToFiltration takes the print settings from the recipe paths', () => {
    const op = getOp('darkroom.lightsToFiltration');
    expect(Object.fromEntries(Object.entries(op.args).map(([k, a]) => [k, a.path]))).toMatchObject({
      logH: 'print.lights.logH', paper: 'print.paper', mode: 'print.enlarger.mode', time_s: 'print.enlarger.time_s', aimView: 'view.illuminant',
    });
    expect(op.fields!.map((f) => f.name)).toEqual(['filtration', 'time_s', 'stops', 'lights', 'residual']);
  });

  it('the shared frame vocabulary: print() options own real args; cut and accessorNode name the compiled nodes', () => {
    for (const [opt, [op, arg]] of Object.entries(PRINT_OPTIONS)) {
      expect(getOp(op).args[arg], opt).toBeDefined();
      expect(PRINT_OPTION_PATHS[opt]).toBeDefined();
    }
    const r = defaultRecipe('negative-scan', { sha256: SHA });
    const g = g0();
    expect(cut(r, g, 'view.adapt').op).toBe('view.adapt');
    expect(cut(r, g, 'output.frame').id).toBe(compile(r, g).id);
    expect(accessorNode(r, g, 'scan', {}).op).toBe('scan.density');
    expect(accessorNode(r, g, 'negative').op).toBe('invert.dyes');
    expect(diagOf(() => cut(defaultRecipe('digital-raw', { sha256: SHA }), g0(), 'invert.dyes')).code).toBe('E_INTERNAL');
  });

  it('the roll record validates; FrameRecipe.roll is {id} or null', () => {
    const roll = { id: 'r1', label: 'Gold 200, Lisbon', frames: ['f1', 'f2'], fragment: { 'scan.stock': 'kodak_gold_200', 'scan.baseT': [0.5, 0.4, 0.3] }, analysis: null, reference: 'f1', match: null, status: 'set-up' };
    expect(validateRoll(roll)).toEqual([]);
    expect(validateRoll({ ...roll, fragment: { 'scan.nope': 1 } })[0]!.code).toBe('E_PATH');
    expect(validateRoll({ ...roll, status: 'done' })[0]!.code).toBe('E_RECIPE');
    const r = defaultRecipe('negative-scan', { sha256: SHA });
    expect(applyMutation(r, { op: 'set', path: 'roll', value: { id: 'r1' } }).recipe.roll).toEqual({ id: 'r1' });
    expect(diagOf(() => applyMutation(r, { op: 'set', path: 'roll', value: { id: '' } })).code).toBe('E_ARG_TYPE');
  });
});
