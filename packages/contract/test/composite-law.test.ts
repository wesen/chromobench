// The composite law with encodings, blend modes, the digital ops, colour and radial masks and the scene stage
// (contract 1.1, design §4–§7, §22, §29, §37).
import { describe, expect, it } from 'vitest';
import { Coll, set, type Json } from '@chromobench/values';
import {
  BLEND_MODES, compile, edit, getOp, opEncoding, validateDocument, type Compiled, type Document, type Graph, type Node,
} from '@chromobench/contract';
import { G, L, camDoc, component, diagOf, graph, maskOf, push, scanDoc } from './helpers.ts';
import { insert } from '@chromobench/values';

/** The print stage's nodes (after view.adapt, before output.display), receiver first. */
function printChain(g: Graph, c: Compiled): Node[] {
  const out: Node[] = [];
  for (let n = g.get(c.cuts.finished!.id)!; n.id !== c.cuts.print!.id; n = g.get(n.inputs[0]!)!) out.unshift(n);
  return out;
}
const opsOf = (ns: Node[]): string[] => ns.map((n) => (n.op === 'composite.encode' ? `→${String(n.args['to']).split('-')[1]}` : n.op));
const dom = (g: Graph, id: string): string => (g.get(id)!.info as { domain: string }).domain;
const withPrint = (d: Document, entries: [string, ReturnType<typeof L>][]): Document => edit(d, entries.map(([id, e]) => push('print', id, e))).doc;
/** A Coll as a stored param value (params are Json; a Coll is one). */
const C = (items: [string, Record<string, unknown>][]): Json => Coll.of(items) as unknown as Json;
let pid = 0;
/** An S-curve's params (point ids unique in the document, as every id). */
const sCurve = (): { points: Json } => { const k = pid++; return { points: C([[`p${k}a`, { x: 0, y: 0 }], [`p${k}b`, { x: 0.3, y: 0.22 }], [`p${k}c`, { x: 0.7, y: 0.8 }], [`p${k}d`, { x: 1, y: 1 }]]) }; };

describe('encodings', () => {
  it('each op declares one; curve and levels follow their channel', () => {
    expect(['exposure', 'mixer', 'vignette'].map((o) => getOp(o).encoding)).toEqual(['linear', 'linear', 'linear']);
    expect(['hsl', 'vibrance', 'grade'].map((o) => getOp(o).encoding)).toEqual(['oklab', 'oklab', 'oklab']);
    expect(['clarity', 'sharpen', 'heal'].map((o) => getOp(o).encoding)).toEqual(['stage', 'stage', 'stage']);
    expect(opEncoding(getOp('curve'), { channel: 'L' })).toBe('oklab');
    expect(opEncoding(getOp('curve'), { channel: 'G' })).toBe('linear');
    expect(opEncoding(getOp('levels'))).toBe('oklab');
  });

  it('adjacent ops in one encoding share one conversion; the stack ends in the stage encoding', () => {
    const g = graph();
    const c = compile(withPrint(scanDoc(), [['c', L('curve', sCurve())], ['h', L('hsl', { bands: C([['r', { centre_deg: 25, hue_deg: 10 }]]) })], ['v', L('vibrance', { vibrance: 0.3 })]]), g);
    expect(opsOf(printChain(g, c))).toEqual(['→oklab', 'curve', 'hsl', 'vibrance', '→xyz']);
    const e = compile(withPrint(scanDoc(), [['e', L('exposure', { stops: 0.5 })], ['r', L('curve', { channel: 'R', ...sCurve() })], ['m', L('mixer', { monochrome: true })], ['k', L('curve', sCurve())]]), g);
    expect(opsOf(printChain(g, e))).toEqual(['→rgb', 'exposure', 'curve', 'mixer', '→oklab', 'curve', '→xyz']);
    // a conversion of a conversion converts the original: rgb → oklab is one node from rgb, xyz from oklab one node
    const k = printChain(g, e);
    expect(dom(g, k[4]!.inputs[0]!)).toBe('print-rgb');
    expect(k[6]!.args['white']).toBe('D65');
    expect(dom(g, c.cuts.finished!.id)).toBe('print-xyz');
  });

  it('identity, disabled and amount-0 layers produce no node: the stack compiles to its input', () => {
    const g = graph();
    const base = compile(scanDoc(), g);
    const c = compile(withPrint(scanDoc(), [
      ['c', L('curve')], ['l', L('levels')], ['x', L('exposure')], ['h', L('hsl')], ['g', L('grade')], ['m', L('mixer')],
      ['v', L('vibrance', { vibrance: 0.4 }, { amount: 0 })], ['n', L('vignette', {}, { enabled: false })], ['s', L('sharpen', { strength: 0 })],
    ]), g);
    expect(c.cuts.finished!.id).toBe(base.cuts.finished!.id);
  });

  it('the print white is output.white; the scene white is D65', () => {
    const g = graph();
    const d = edit(withPrint(scanDoc(), [['x', L('exposure', { stops: 1 })]]), [set('output.white', 'D50')]).doc;
    const c = compile(d, g);
    expect(printChain(g, c).filter((n) => n.op === 'composite.encode').map((n) => n.args['white'])).toEqual(['D50', 'D50']);
  });
});

describe('the mix', () => {
  it('a masked or faded layer mixes in its op encoding; full coverage is the op itself', () => {
    const g = graph();
    const d = edit(scanDoc(), [insert('masks', 'm', maskOf([['r', component('radial', { box: { x: 2, y: 2, w: 6, h: 5 }, feather: 0.5 })]])), push('print', 'c', L('curve', sCurve(), { mask: 'm', amount: 0.7 }))]).doc;
    const c = compile(d, g);
    const ch = printChain(g, c);
    expect(opsOf(ch)).toEqual(['→oklab', 'composite.mix', '→xyz']);
    const mix = ch[1]!;
    expect(dom(g, mix.inputs[0]!)).toBe('print-oklab');
    expect(g.get(mix.args['top'] as string)!.op).toBe('curve');
    expect(mix.args).toMatchObject({ amount: 0.7, blend: 'normal' });
    expect(g.get(mix.args['mask'] as string)!.op).toBe('mask.radial');
  });

  it('every W3C mode is allowed on composite layers and isolated groups; a stage-encoded layer blends in linear RGB', () => {
    expect(BLEND_MODES).toHaveLength(16);
    for (const b of BLEND_MODES) expect(validateDocument(withPrint(scanDoc(), [['c', L('clarity', { strength: 0.3, radius_mm: 5 }, { blend: b })]]))).toEqual([]);
    const g = graph();
    const c = compile(withPrint(scanDoc(), [['c', L('clarity', { strength: 0.3, radius_mm: 5 }, { blend: 'multiply' })]]), g);
    const ch = printChain(g, c);
    expect(opsOf(ch)).toEqual(['→rgb', 'composite.mix', '→xyz']);
    expect(g.get(ch[1]!.args['top'] as string)).toMatchObject({ op: 'composite.encode', args: { to: 'print-rgb' } });
    expect(diagOf(() => edit(scanDoc(), [set('main.blend', 'multiply')])).code).toBe('E_DOCUMENT');
  });

  it('a group: pass at amount 1 is no node; isolated with a mode blends the children\'s result as one layer', () => {
    const g = graph();
    const kids: [string, ReturnType<typeof L>][] = [['c', L('curve', sCurve())], ['v', L('vibrance', { vibrance: 0.3 })]];
    const flat = compile(withPrint(scanDoc(), kids), g);
    const pass = compile(withPrint(scanDoc(), [['grp', G('look', kids)]]), g);
    expect(pass.cuts.finished!.id).toBe(flat.cuts.finished!.id);
    // isolated normal ≡ pass (design §37)
    const iso = compile(withPrint(scanDoc(), [['grp', G('look', kids, { blend: 'normal', amount: 0.5 })]]), g);
    const passHalf = compile(withPrint(scanDoc(), [['grp', G('look', kids, { amount: 0.5 })]]), g);
    expect(iso.cuts.finished!.id).toBe(passHalf.cuts.finished!.id);
    const lum = compile(withPrint(scanDoc(), [['grp', G('look', kids, { blend: 'luminosity' })]]), g);
    const ch = printChain(g, lum);
    expect(opsOf(ch)).toEqual(['→oklab', 'composite.mix', '→xyz']);
    expect(ch[1]!.args).toMatchObject({ blend: 'luminosity', amount: 1 });
    expect(g.get(ch[1]!.args['top'] as string)!.op).toBe('vibrance');
  });
});

describe('masks: colour and radial', () => {
  it('a colour component measures the cut it reads in OkLab, the same node a layer converts', () => {
    const g = graph();
    const d = edit(scanDoc(), [
      insert('masks', 'sky', maskOf([['c', component('colour', { colour: [0.6, -0.02, -0.08], tolerance: 0.1, softness: 0.05 })]])),
      push('print', 'h', L('hsl', { bands: C([['b', { centre_deg: 260, saturation: 0.3 }]]) }, { mask: 'sky' })),
    ]).doc;
    const c = compile(d, g);
    const mix = printChain(g, c).find((n) => n.op === 'composite.mix')!;
    const m = g.get(mix.args['mask'] as string)!;
    expect(m.op).toBe('mask.colour');
    expect(m.inputs[0]).toBe(mix.inputs[0]); // the print in OkLab, shared
  });

  it('a colour component on a cut without colour is refused at compile', () => {
    const d = edit(scanDoc(), [
      insert('masks', 'm', maskOf([['c', component('colour', { colour: [0.6, 0, 0] })]])),
      push('darkroom', 'b', L('burn', { stops: 1 }, { mask: 'm' })),
    ]).doc;
    expect(diagOf(() => compile(d, graph()))).toMatchObject({ code: 'E_CUT' });
  });

  it('a hand-built graph fails the same way: a channel curve needs RGB, composite.encode stays in its stage', () => {
    const g = graph();
    const c = compile(scanDoc(), g);
    const ok = g.intern('composite.encode', [c.cuts.print!.id], { to: 'print-oklab' }).node;
    expect(diagOf(() => g.intern('curve', [ok.id], { channel: 'R' }))).toMatchObject({ code: 'E_DOMAIN' });
    expect(g.intern('curve', [ok.id], { channel: 'L' }).node.info).toMatchObject({ domain: 'print-oklab' });
    expect(diagOf(() => g.intern('composite.encode', [ok.id], { to: 'scene-rgb' }))).toMatchObject({ code: 'E_DOMAIN' });
    expect(diagOf(() => g.intern('curve', [ok.id], { points: [{ x: 0.5, y: 0.5 }, { x: 0.2, y: 0.3 }] }))).toMatchObject({ code: 'E_ARG_RANGE' });
  });
});

describe('the scene stage (camera files)', () => {
  it('layers compile between the white balance and the film; its masks read scene.input', () => {
    const g = graph();
    const d = edit(camDoc(), [
      insert('masks', 'm', maskOf([['l', component('luminance', { above: 0.5 })]])),
      insert('stages.scene.stack', 'x', L('exposure', { stops: -0.5 }, { mask: 'm' })),
      insert('stages.scene.stack', 'g', L('grade', { shadowsChroma: 0.04 })),
    ]).doc;
    const c = compile(d, g);
    expect(c.cuts['scene.input']!.op).toBe('source.xyz');
    const chain: Node[] = [];
    for (let n = g.get(c.cuts.scene!.id)!; n.id !== c.cuts['scene.input']!.id; n = g.get(n.inputs[0]!)!) chain.unshift(n);
    expect(opsOf(chain)).toEqual(['→rgb', 'composite.mix', '→oklab', 'grade', '→xyz']);
    expect(chain[0]!.args).toMatchObject({ to: 'scene-rgb', white: 'D65' });
    const mask = g.get(chain[1]!.args['mask'] as string)!;
    expect(mask.inputs[0]).toBe(c.cuts['scene.input']!.id);
    expect(g.get(c.cuts.film!.id)!.op).toBe('film.grain');
    expect(dom(g, c.cuts.scene!.id)).toBe('scene-xyz');
  });

  it('sharpen and clarity live on the print only (their radius is on the print)', () => {
    expect(getOp('sharpen').stages).toEqual(['print']);
    expect(diagOf(() => edit(camDoc(), [insert('stages.scene.stack', 's', L('sharpen'))])).code).toBe('E_DOCUMENT');
  });
});
