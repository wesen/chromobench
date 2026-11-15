import { describe, expect, it } from 'vitest';
import {
  AREAS, allOps, bindArgs, check, closest, compile, getOp, Graph, law, nodeId, nodeSlots, opsAccepting, opsForStage, registerOp,
  type OpDef,
} from '@chromobench/contract';
import { diagOf, graph, linear, maskOf, push, scanDoc, L } from './helpers.ts';
import { edit } from '@chromobench/contract';
import { insert } from '@chromobench/values';

describe('registry and catalogue', () => {
  it('every area has ops; the layer ops live in their stages with an encoding', () => {
    for (const a of AREAS) expect(allOps().some((o) => o.area === a), a).toBe(true);
    const names = (s: Parameters<typeof opsForStage>[0]): string[] => opsForStage(s).map((o) => o.name).sort();
    expect(names('darkroom')).toEqual(['burn', 'densityMask', 'dodge', 'expose', 'filter', 'flash', 'preflash']);
    expect(names('print')).toEqual(['clarity', 'clone', 'heal']);
    expect(names('scan')).toEqual(['clone', 'heal']);
    expect(names('scene')).toEqual([]);
    for (const o of allOps({ includeInternal: true })) if (o.stages) expect(o.encoding, o.name).toBeDefined();
    expect(getOp('clarity')).toMatchObject({ encoding: 'linear', class: 'spatial' });
    expect(getOp('clarity').args['radius_mm']).toMatchObject({ unit: 'mm' });
    expect(getOp('heal').coalesce).toEqual({ list: 'spots', opacity: 'opacity' });
  });

  it('the old ops are gone', () => {
    const names = new Set(allOps({ includeInternal: true }).map((o) => o.name));
    for (const n of ['print.lights', 'print.preflash', 'mask.and', 'mask.or', 'mask.not', 'mask.gradient', 'scan.heal', 'retouch.heal', 'finishing.clarity', 'finishing.hue']) expect(names.has(n), n).toBe(false);
    for (const n of ['print.expose', 'print.combine', 'print.develop', 'print.densityMask', 'mask.linear', 'mask.ellipse', 'mask.paint', 'mask.luminance', 'mask.constant', 'mask.combine', 'mask.feather', 'mask.invert', 'composite.mix']) expect(names.has(n), n).toBe(true);
    // no argument is a JSON string any more
    for (const o of allOps({ includeInternal: true })) for (const [a, s] of Object.entries(o.args)) expect(s.type === 'string' && /JSON/.test(s.doc), `${o.name}.${a}`).toBe(false);
  });

  it('registerOp refuses invalid definitions', () => {
    const base: OpDef = { name: 'print.zz', area: 'print', owner: 't', on: 'Image', returns: 'Image', domainIn: 'paper-logH', domainOut: 'paper-logH', class: 'pointwise', binding: 'setting', args: {}, doc: 'x' };
    const bad: Partial<OpDef>[] = [
      { name: 'view.zz' }, { name: 'print.combine' }, { name: 'zz' }, { name: 'zz', stages: ['print'] },
      { name: 'zz', stages: ['darkroom'], encoding: 'stage' },
      { args: { a: { type: 'number', doc: 'no unit' } } },
      { args: { a: { type: 'number', unit: 'logH', min: 1, max: 0, doc: 'min>max' } } },
      { args: { a: { type: 'enum', values: ['x'], default: 'y', doc: 'bad default' } } },
      { args: { a: { type: 'list', doc: 'no item schema' } } },
      { args: { a: { type: 'list', of: { b: { type: 'number', doc: 'no unit' } }, doc: 'x' } } },
      { domainIn: 'display-rgb' },
      { examples: ['frame.negative(('] },
    ];
    for (const b of bad) expect(diagOf(() => registerOp({ ...base, ...b } as OpDef)).code, JSON.stringify(b)).toBe('E_INVALID_OP_DEF');
  });

  it('bindArgs: defaults, ranges, soft warnings, redirects, did-you-mean, structured lists, no non-finite numbers', () => {
    const filter = getOp('filter');
    expect(bindArgs(filter, {}).args).toEqual({ logH: [0, 0, 0] });
    expect(bindArgs(filter, { logH: [0.6, 0, 0] }).warnings[0]?.code).toBe('RANGE');
    const r = diagOf(() => bindArgs(filter, { logH: [4, 0, 0] }));
    expect(r).toMatchObject({ code: 'E_ARG_RANGE', fix: '[0.1, 0, 0]', valid: ['[-1.5, 1.5]'] });
    expect(diagOf(() => bindArgs(filter, { points: [4, 0, 0] }))).toMatchObject({ code: 'E_UNKNOWN_OPTION', fix: 'filter({logH: [0.1, 0, 0]})' });
    expect(diagOf(() => bindArgs(getOp('print.expose'), { tim_s: 12 }))).toMatchObject({ code: 'E_UNKNOWN_OPTION', hint: 'did you mean time_s?' });
    expect(diagOf(() => bindArgs(getOp('print.expose'), { time_s: NaN })).code).toBe('E_ARG_RANGE');
    const paint = bindArgs(getOp('mask.paint'), { strokes: [{ points: [[1, 2], [3, 4, 0.5]], radius: 2 }] }).args;
    expect(paint['strokes']).toEqual([{ points: [[1, 2, 1], [3, 4, 0.5]], radius: 2, hardness: 0.5, mode: 'add' }]);
    expect(diagOf(() => bindArgs(getOp('mask.paint'), { strokes: [{ points: [[1, 2]], radius: 2, mood: 'add' }] })).code).toBe('E_UNKNOWN_OPTION');
    expect(diagOf(() => bindArgs(getOp('heal'), { spots: [{ x: 1, y: 1, r: 2, src: { x: Infinity, y: 0 } }] })).code).toBe('E_ARG_RANGE');
    expect(diagOf(() => getOp('print.combin')).hint).toBe('did you mean print.combine?');
  });

  it('closest follows the goja-cv edit budget', () => {
    expect(closest('tiem_s', ['time_s', 'fstop'])).toBe('time_s');
    expect(closest('xyz', ['time_s'])).toBeUndefined();
  });

  it('opsAccepting lists what a paper-logH handle can call; light terms are not nodes', () => {
    const names = opsAccepting('Image', 'paper-logH').map((o) => o.name);
    expect(names).toEqual(expect.arrayContaining(['print.combine', 'print.develop', 'measure.stats']));
    expect(names).not.toContain('burn');
    const g = graph();
    expect(diagOf(() => g.intern('burn', [], { stops: 1 })).code).toBe('E_WRONG_KIND');
  });
});

describe('graph', () => {
  const mk = (): Graph => graph();

  it('E_DOMAIN names the op to call first', () => {
    const g = mk();
    const dyes = g.intern('source.pattern', [], { domain: 'film-dyes' }).node;
    expect(diagOf(() => g.intern('print.develop', [dyes.id], {}))).toMatchObject({ code: 'E_DOMAIN', hint: 'call print.expose first' });
  });

  it('graph.hashcons: key order, explicit defaults, -0 → same id; any change → different id', () => {
    const lawHash = law('graph.hashcons', (r) => ({ t: r.range(0.1, 600), c: r.int(0, 200), m: r.int(0, 200) }), ({ t, c, m }) => {
      const g = mk();
      const d = g.intern('source.pattern', [], { domain: 'film-dyes' }).node;
      const a = g.intern('print.expose', [d.id], { time_s: t, filtration: { c, m, y: 0 } }).node;
      const b = g.intern('print.expose', [d.id], { filtration: { y: -0, m, c }, fstop: 8, time_s: t, mode: 'real', magnification: 8 }).node;
      const other = g.intern('print.expose', [d.id], { time_s: t === 600 ? 599 : t + 0.001, filtration: { c, m, y: 0 } }).node;
      if (a.id !== b.id) return 'same call, different id';
      if (a.id === other.id) return 'different call, same id';
      return true;
    }, { justifies: 'hash-consing keys caches on content, not spelling', source: 'goja-cv §3.5' });
    const [rep] = check([lawHash], { n: 100, seed: 1 });
    expect(rep, rep?.message).toMatchObject({ ok: true });
  });

  it('node ids inside structured args are inputs, in a fixed order; adopt(closure) reproduces every id', () => {
    const g = mk();
    const d = edit(scanDoc(), [
      insert('masks', 'm1', maskOf([['c1', linear()]])),
      push('darkroom', 'b1', L('burn', { stops: 1 }, { mask: 'm1' })),
      push('darkroom', 'd1', L('dodge', { stops: 0.5 })),
      push('darkroom', 'dm', L('densityMask', { gamma: 0.5, radius_um: 300, polarity: 'positive' })),
    ]).doc;
    const c = compile(d, g);
    const h = c.cuts['darkroom.H']!;
    expect(h.inputs[0]).toBe(c.cuts['darkroom.main']!.id);
    expect(nodeSlots(getOp('print.combine'), h.args).map((s) => s.at)).toEqual(['terms.0.image', 'terms.0.mask', 'terms.1.image', 'densities.0.image']);
    expect(h.inputs.slice(1)).toEqual(nodeSlots(getOp('print.combine'), h.args).map((s) => s.id));
    const g2 = mk();
    const nodes = g2.adopt(g.closure(c.display.id));
    expect(nodes.at(-1)!.id).toBe(c.display.id);
    expect(nodeId(g.closure(c.display.id).at(-1)!)).toBe(c.display.id);
  });
});
