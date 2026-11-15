// CHB-037 P8a (node, no device): the planner fuses an unmasked composite.mix whose top is a pointwise chain on its
// backdrop and keeps the others as combine passes; the digital ops lower with core's parameters; op data is packed
// with each op's offset; the working WGSL carries core's matrices.
import { describe, expect, it } from 'vitest';
import { compile, edit, Graph, groupEntry, layerEntry, newDocument, type Compiled, type Document, type Entry, type Node, type SourceInfo } from '@chromobench/contract';
import { encodeTransform, OK_M1, toneCurve } from '@chromobench/core';
import { Coll, insert } from '@chromobench/values';
import { MAXOPS, OP, PROG, packOpData, packProgram, type Segment } from '../src/chain/program.ts';
import { WORKING_WGSL } from '../src/chain/working.ts';
import { fusedMixTop, isBarrier, readsOf } from '../src/engine/dag.ts';
import { lowerDigital } from '../src/engine/lower.ts';

const SHA = 'cd'.repeat(32);
const info: SourceInfo = { sha256: SHA, format: 'tiff', width: 40, height: 30, channels: 3, bits: 16, sample: 'uint', encoding: { value: 'linear', evidence: 'format' }, levels: { black: [0], white: [65535], from: 'default' }, clippedFraction: 0, notes: [] };

function compiled(print: [string, Entry][], masks = false): { g: Graph; c: Compiled } {
  const g = new Graph();
  g.registerSource(info);
  let d: Document = newDocument('negative-scan', { sha256: SHA }, { umPerPx: 6 });
  const m = masks ? [insert('masks', 'r', { name: 'r', components: Coll.of([['c', { kind: 'radial', params: { box: { x: 5, y: 5, w: 20, h: 10 } }, combine: 'add', amount: 1, enabled: true }]]), feather_mm: 0, invert: false, reads: 'stage-input' })] : [];
  d = edit(d, [...m, ...print.map(([id, e]) => insert('stages.print.stack', id, e))]).doc;
  return { g, c: compile(d, g) };
}
/** The composite.mix nodes upstream of the finished cut (every input followed). */
function mixes(g: Graph, c: Compiled): Node[] {
  const seen = new Set<string>();
  const out: Node[] = [];
  const visit = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const n = g.get(id)!;
    if (n.op === 'composite.mix') out.push(n);
    n.inputs.forEach(visit);
  };
  visit(c.cuts.finished!.id);
  return out;
}

describe('the fused mix (design §29: composite.mix and pointwise layers fuse)', () => {
  it('an unmasked layer at any amount or blend fuses: its top is the op on the mix\'s backdrop', () => {
    const { g, c } = compiled([['x', layerEntry('exposure', { stops: 0.5 }, { amount: 0.6 })], ['v', layerEntry('vibrance', {}, { blend: 'luminosity' })]]);
    const ms = mixes(g, c);
    expect(ms).toHaveLength(2);
    for (const m of ms) {
      expect(isBarrier(m, g)).toBe(false);
      expect(isBarrier(m)).toBe(true); // without the graph a mix is a barrier
      expect(readsOf(m, g)).toEqual([m.inputs[0]]);
      expect(fusedMixTop(g, m)!.map((n) => n.op)).toEqual([g.get(m.args['top'] as string)!.op]);
    }
  });

  it('a masked layer and an isolated group (its top is not on its backdrop) stay combine passes', () => {
    const { g, c } = compiled([['x', layerEntry('exposure', { stops: 0.5 }, { mask: 'r' })]], true);
    expect(mixes(g, c).map((m) => isBarrier(m, g))).toEqual([true]);
    const iso = compiled([['grp', groupEntry('g', Coll.of([['a', layerEntry('exposure', { stops: 0.4 })], ['b', layerEntry('vibrance', { vibrance: 0.5 })]]), { blend: 'luminosity' })]]);
    const [m] = mixes(iso.g, iso.c);
    expect(fusedMixTop(iso.g, m!)).toBeNull();
    expect(isBarrier(m!, iso.g)).toBe(true);
  });
});

describe('lowering the digital ops (core prepares every parameter)', () => {
  const node = (op: string, args: Record<string, unknown>, recvDomain = 'print-oklab'): { g: Pick<Graph, 'get'>; n: Node } => {
    const recv = { id: 'r', op: 'x', inputs: [], args: {}, info: { kind: 'Image', domain: recvDomain, width: 4, height: 4, channels: 3, umPerPx: {} } } as unknown as Node;
    const n = { id: 'n', op, inputs: ['r'], args, info: recv.info } as unknown as Node;
    return { g: { get: (id: string) => (id === 'r' ? recv : undefined) }, n };
  };

  it('composite.encode carries core\'s transform: pre, post and f', () => {
    const { g, n } = node('composite.encode', { to: 'print-oklab', white: 'D50' }, 'print-xyz');
    const op = lowerDigital(g, n);
    const t = encodeTransform('stage', 'oklab', 'D50');
    expect(op).toMatchObject({ code: OP.ENCODE, flags: 1 });
    expect(op.data).toEqual([...t.pre.flat(), ...t.post.flat()]);
  });

  it('curve: the Hermite segments (x, y, m) and the count; levels: 1/γ; channels as flags', () => {
    const pts = [{ x: 0, y: 0 }, { x: 0.3, y: 0.2 }, { x: 1, y: 1 }];
    const op = lowerDigital(node('curve', { channel: 'G', points: pts }).g, node('curve', { channel: 'G', points: pts }).n);
    const c = toneCurve(pts);
    expect(op).toMatchObject({ code: OP.CURVE, flags: 2, aux: 3 });
    expect(op.data).toEqual([...c.x, ...c.y, ...c.m]);
    const lv = lowerDigital(node('levels', { channel: 'L', black: 0.1, white: 0.9, gamma: 2, outBlack: 0, outWhite: 1 }).g, node('levels', { channel: 'L', black: 0.1, white: 0.9, gamma: 2, outBlack: 0, outWhite: 1 }).n);
    expect(lv).toMatchObject({ code: OP.LEVELS, flags: 0, p0: [0.1, 0.9, 0.5, 0], p1: [1] });
    const h = lowerDigital(node('hsl', { bands: [{ centre_deg: 90, width_deg: 45, hue_deg: 30, saturation: 0.1, lightness: 0 }] }).g, node('hsl', { bands: [{ centre_deg: 90, width_deg: 45, hue_deg: 30, saturation: 0.1, lightness: 0 }] }).n);
    expect(h.aux).toBe(1);
    expect(h.data![0]).toBeCloseTo(0, 15);
    expect(h.data![3]).toBeCloseTo(Math.PI / 6, 15);
  });

  it('op data is packed in order and each op addresses its own (op.z)', () => {
    const seg: Segment = { ops: [{ code: OP.EXPOSURE, p0: [2, 0] }, { code: OP.MIXER, data: [1, 0, 0, 0, 1, 0, 0, 0, 1] }, { code: OP.SAVE }, { code: OP.CURVE, aux: 2, data: [0, 1, 0, 1, 1, 1] }, { code: OP.MIX, flags: 15, aux: 2, p0: [0.5] }], tables: {} };
    expect(Array.from(packOpData(seg)!)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1]);
    const buf = packProgram({ seg, outW: 4, outH: 4, frameW: 4, frameH: 4, region: { x: 0, y: 0, w: 4, h: 4 }, srcOrigin: [0, 0], srcIsPrev: false, lookup: 0, exact: false });
    const u = new Uint32Array(buf, PROG.offset('ops'), 4 * MAXOPS);
    expect([u[1 * 4 + 2], u[3 * 4 + 2], u[3 * 4 + 3], u[4 * 4 + 1], u[4 * 4 + 3]]).toEqual([0, 9, 2, 15, 2]);
    expect(packOpData({ ops: [{ code: OP.EXPOSURE }], tables: {} })).toBeNull();
  });

  it('the working WGSL carries core\'s matrices', () => {
    expect(WORKING_WGSL).toContain(`const WK_M1 = mat3x3<f32>(vec3<f32>(${OK_M1[0][0]}, ${OK_M1[1][0]}, ${OK_M1[2][0]})`);
    expect(WORKING_WGSL).toContain('fn wkMix(');
  });
});

