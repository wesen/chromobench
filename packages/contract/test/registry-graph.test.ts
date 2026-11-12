import { describe, expect, it } from 'vitest';
import {
  AREAS, allOps, bindArgs, check, ChromobenchError, closest, compile, defaultRecipe, getOp, Graph, law, nodeId, opsAccepting,
  pathOwners, RECIPE_FIELDS, registerOp, settablePaths, type Diagnostic, type OpDef, type SourceInfo,
} from '@chromobench/contract';

function diagOf(f: () => unknown): Diagnostic {
  try {
    f();
  } catch (e) {
    if (e instanceof ChromobenchError) return e.diag;
    throw e;
  }
  throw new Error('expected a ChromobenchError');
}

const SHA = 'ab'.repeat(32);
export function sourceInfo(sha = SHA, width = 12, height = 10): SourceInfo {
  return { sha256: sha, format: 'tiff', width, height, channels: 3, bits: 16, sample: 'uint', encoding: { value: 'linear', evidence: 'format' }, levels: { black: [0], white: [65535], from: 'default' }, clippedFraction: 0, notes: [] };
}

describe('registry and v0 catalog', () => {
  it('every area has ops and every op-owned recipe path has an owner', () => {
    for (const a of AREAS) expect(allOps().some((o) => o.area === a), a).toBe(true);
    for (const [p, rule] of Object.entries(RECIPE_FIELDS)) if (rule.kind === 'op') expect(pathOwners(p).length, p).toBeGreaterThan(0);
    expect(settablePaths()).toContain('print.lights.logH');
    expect(settablePaths()).not.toContain('print.lights');
  });

  it('the guide §5.5 ops are all present', () => {
    const names = new Set(allOps({ includeInternal: true }).map((o) => o.name));
    for (const n of ['source.open', 'source.info', 'source.pattern', 'scan.flatField', 'scan.flare', 'scan.rebate', 'scan.density', 'scan.noise', 'invert.dyes', 'invert.classify',
      'capture.expose', 'film.couple', 'film.halation', 'film.develop', 'film.grain', 'print.expose', 'print.lights', 'print.preflash', 'print.combine', 'print.develop',
      'view.reflect', 'view.flare', 'view.adapt', 'output.display', 'output.frame', 'output.encode', 'mask.luminance', 'mask.gradient', 'mask.ellipse', 'mask.paint',
      'mask.feather', 'mask.and', 'mask.or', 'mask.not', 'measure.stats', 'measure.histogram', 'measure.densitometer', 'measure.patches', 'darkroom.testStrip',
      'darkroom.ringAround', 'darkroom.contactSheet', 'finishing.clarity', 'finishing.hue']) expect(names.has(n), n).toBe(true);
    expect(allOps().some((o) => o.name === 'source.pattern')).toBe(false); // internal
  });

  it('registerOp refuses invalid definitions', () => {
    const base: OpDef = { name: 'print.zz', area: 'print', owner: 't', on: 'Image', returns: 'Image', domainIn: 'paper-logH', domainOut: 'paper-logH', class: 'pointwise', binding: 'setting', args: {}, doc: 'x' };
    const bad: Partial<OpDef>[] = [
      { name: 'nodot' }, { name: 'view.zz' }, { name: 'print.lights' },
      { args: { a: { type: 'number', doc: 'no unit' } } },
      { args: { a: { type: 'number', unit: 'logH', min: 1, max: 0, doc: 'min>max' } } },
      { args: { a: { type: 'number', unit: 'logH', min: 0, max: 1, usual: [0, 2], doc: 'usual outside' } } },
      { args: { a: { type: 'enum', doc: 'no values' } } },
      { args: { a: { type: 'enum', values: ['x'], default: 'y', doc: 'bad default' } } },
      { args: { a: { type: 'number', unit: 'none', path: 'print.nowhere', doc: 'bad path' } } },
      { domainIn: 'display-rgb' },
      { examples: ['frame.negative(('] },
    ];
    for (const b of bad) expect(diagOf(() => registerOp({ ...base, ...b } as OpDef)).code, JSON.stringify(b)).toBe('E_INVALID_OP_DEF');
  });

  it('bindArgs: defaults, ranges, soft warnings, redirects, did-you-mean', () => {
    const lights = getOp('print.lights');
    expect(bindArgs(lights, {}).args).toEqual({ logH: [0, 0, 0] });
    expect(bindArgs(lights, { logH: [0.6, 0, 0] }).warnings[0]?.code).toBe('RANGE');
    const r = diagOf(() => bindArgs(lights, { logH: [4, 0, 0] }));
    expect(r).toMatchObject({ code: 'E_ARG_RANGE', fix: '[0.1, 0, 0]', valid: ['[-1.5, 1.5]'] });
    expect(r.hint).toContain('0.025');
    expect(diagOf(() => bindArgs(lights, { logH: [NaN, 0, 0] })).code).toBe('E_ARG_RANGE');
    expect(diagOf(() => bindArgs(lights, { logH: 'red' })).code).toBe('E_ARG_TYPE');
    expect(diagOf(() => bindArgs(lights, { points: [4, 0, 0] }))).toMatchObject({ code: 'E_UNKNOWN_OPTION', fix: 'print.lights({logH: [0.1, 0, 0]})' });
    expect(diagOf(() => bindArgs(getOp('print.expose'), { tim_s: 12 }))).toMatchObject({ code: 'E_UNKNOWN_OPTION', hint: 'did you mean time_s?' });
    expect(bindArgs(getOp('scan.density'), { rebate: [0, 0, 8, 64] }).args).toEqual({ rebate: { x: 0, y: 0, w: 8, h: 64 } });
    expect(diagOf(() => bindArgs(getOp('darkroom.testStrip'), { vary: 'time', step: 5 })).code).toBe('E_ARG_RANGE');
    expect(diagOf(() => getOp('print.light')).hint).toBe('did you mean print.lights?');
  });

  it('closest follows the goja-cv edit budget', () => {
    expect(closest('tiem_s', ['time_s', 'fstop'])).toBe('time_s');
    expect(closest('xyz', ['time_s'])).toBeUndefined();
    expect(closest('LOGH', ['logH'])).toBe('logH');
  });

  it('opsAccepting lists what a paper-logH handle can call', () => {
    const names = opsAccepting('Image', 'paper-logH').map((o) => o.name);
    expect(names).toEqual(expect.arrayContaining(['print.lights', 'print.develop', 'measure.stats']));
    expect(names).not.toContain('print.expose');
  });
});

describe('graph', () => {
  const mk = (): Graph => {
    const g = new Graph();
    g.registerSource(sourceInfo());
    return g;
  };

  it('E_DOMAIN names the op to call first', () => {
    const g = mk();
    const dyes = g.intern('source.pattern', [], { domain: 'film-dyes' }).node;
    expect(diagOf(() => g.intern('print.lights', [dyes.id], {}))).toMatchObject({ code: 'E_DOMAIN', hint: 'call print.expose first' });
  });

  it('E_WRONG_KIND for a value receiver', () => {
    const g = mk();
    const img = g.intern('source.pattern', [], {}).node;
    const v = g.intern('measure.stats', [img.id], {}).node;
    expect(diagOf(() => g.intern('print.lights', [v.id], {})).code).toBe('E_WRONG_KIND');
  });

  it('graph.hashcons: key order, explicit defaults, -0 → same id; any change → different id', () => {
    const lawHash = law('graph.hashcons', (r) => ({ t: r.range(0.1, 600), c: r.int(0, 200), m: r.int(0, 200) }), ({ t, c, m }) => {
      const g = mk();
      const d = g.intern('source.pattern', [], { domain: 'film-dyes' }).node;
      const a = g.intern('print.expose', [d.id], { time_s: t, filtration: { c, m, y: 0 } }).node;
      const b = g.intern('print.expose', [d.id], { filtration: { y: -0, m, c }, fstop: 8, time_s: t, mode: 'real' }).node;
      const other = g.intern('print.expose', [d.id], { time_s: t === 600 ? 599 : t + 0.001, filtration: { c, m, y: 0 } }).node;
      if (a.id !== b.id) return 'same call, different id';
      if (a.id === other.id) return 'different call, same id';
      return true;
    }, { justifies: 'hash-consing keys caches on content, not spelling', source: 'goja-cv §3.5' });
    const [rep] = check([lawHash], { n: 100, seed: 1 });
    expect(rep, rep?.message).toMatchObject({ ok: true });
  });

  it('graph.adopt: adopt(closure(n)) reproduces the id in another graph', () => {
    const g = mk();
    const n = compile(defaultRecipe('negative-scan', { sha256: SHA }), g);
    const g2 = mk();
    const nodes = g2.adopt(g.closure(n.id));
    expect(nodes[nodes.length - 1]!.id).toBe(n.id);
    expect(nodeId(g.closure(n.id).at(-1)!)).toBe(n.id);
  });

  it('compile builds the §5.7 chain and reuses upper nodes when only lights change', () => {
    const g = mk();
    const r = defaultRecipe('negative-scan', { sha256: SHA });
    const a = compile(r, g);
    expect(g.closure(a.id).map((d) => d.op)).toEqual(['source.open', 'scan.density', 'invert.dyes', 'print.expose', 'print.lights', 'print.develop', 'view.reflect', 'view.flare', 'view.adapt', 'output.display', 'output.frame']);
    const r2 = { ...r, print: { ...r.print, lights: { ...r.print.lights, logH: [0.1, 0, 0] as [number, number, number] } } };
    const b = compile(r2, g);
    const ida = g.closure(a.id).map((d) => nodeId(d));
    const idb = g.closure(b.id).map((d) => nodeId(d));
    expect(idb.slice(0, 4)).toEqual(ida.slice(0, 4));
    expect(idb[4]).not.toBe(ida[4]);
  });

  it('compile builds the digital-raw chain', () => {
    const g = mk();
    const n = compile(defaultRecipe('digital-raw', { sha256: SHA }), g);
    expect(g.closure(n.id).map((d) => d.op).slice(0, 7)).toEqual(['source.open', 'source.xyz', 'capture.expose', 'film.couple', 'film.halation', 'film.develop', 'film.grain']);
  });
});
