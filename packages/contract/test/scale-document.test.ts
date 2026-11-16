// scaleDocument (contract 1.6, CHB-047): a document on a decode of another size. Every pixel quantity the catalogue
// names (unit px, box, point, polyline) and the fixed ones (crop, probes, the scan medium's boxes and pitch) scale;
// nothing else changes; the compiled graph on the larger source has the larger output and the same physical pitch.
import { describe, expect, it } from 'vitest';
import { Coll, insert } from '@chromobench/values';
import { compile, edit, Graph, pitches, scaleBox, scaleDocument, type Document } from '@chromobench/contract';
import { camDoc, component, L, maskOf, push, scanDoc, SHA, sourceInfo, spot, spots } from './helpers.ts';

function rich(base: Document): Document {
  return edit(base, [
    insert('masks', 'm1', maskOf([
      ['lin', component('linear', { from: { x: 2, y: 3 }, to: { x: 10, y: 9 } })],
      ['rad', component('radial', { box: { x: 1, y: 2, w: 6, h: 4 }, angle_deg: 30, feather: 0.4 })],
      ['ell', component('ellipse', { box: { x: 0, y: 0, w: 12, h: 10 }, angle_deg: 0 })],
      ['pnt', component('paint', { strokes: Coll.of([['s1', { points: [[1, 2, 0.5], [3, 4, 1]], radius: 2.5, hardness: 0.5, mode: 'add' }]]) as never })],
      ['lum', component('luminance', { above: 0.2, below: 0.8 })],
    ], { feather_mm: 3 })),
    push('darkroom', 'b1', L('burn', { stops: 1 }, { mask: 'm1' })),
    push('print', 'h1', L('heal', spots(['a', spot(5, 6, 2, { x: 9, y: 6 })]))),
    insert('probes', 'p1', { x: 4, y: 5, r: 2 }),
    { op: 'set', path: 'geometry.crop', value: { x: 1, y: 1, w: 10, h: 7 } },
  ]).doc;
}

describe('scaleDocument', () => {
  it('scales every pixel quantity: crop, probes, mask geometry, brush strokes, heal spots; leaves the rest', () => {
    const d = rich(scanDoc());
    const s = scaleDocument(d, 2, 3);
    expect(s.geometry.crop).toEqual({ x: 2, y: 3, w: 20, h: 21 });
    expect(Coll.get(s.probes, 'p1')).toEqual({ x: 8, y: 15, r: 2 * Math.sqrt(6) });
    const m = Coll.get(s.masks, 'm1')!;
    expect(m.feather_mm).toBe(3);
    expect(Coll.get(m.components, 'lin')!.params).toEqual({ from: { x: 4, y: 9 }, to: { x: 20, y: 27 } });
    expect(Coll.get(m.components, 'rad')!.params).toEqual({ box: { x: 2, y: 6, w: 12, h: 12 }, angle_deg: 30, feather: 0.4 });
    expect(Coll.get(m.components, 'ell')!.params['box']).toEqual({ x: 0, y: 0, w: 24, h: 30 });
    const stroke = Coll.get(Coll.get(m.components, 'pnt')!.params['strokes'] as never as Coll<{ points: number[][]; radius: number }>, 's1')!;
    expect(stroke.points).toEqual([[2, 6, 0.5], [6, 12, 1]]);
    expect(stroke.radius).toBeCloseTo(2.5 * Math.sqrt(6), 12);
    expect(Coll.get(m.components, 'lum')!.params).toEqual({ above: 0.2, below: 0.8 });
    const heal = Coll.get(s.stages.print.stack, 'h1')!;
    const sp = Coll.get((heal as unknown as { params: { spots: Coll<Record<string, unknown>> } }).params.spots, 'a')!;
    expect(sp).toMatchObject({ x: 10, y: 18, r: 2 * Math.sqrt(6), src: { x: 18, y: 18 }, feather: 0.3, opacity: 1 });
    // the burn's stops and the darkroom medium are not pixels
    expect(Coll.get(s.stages.darkroom.stack, 'b1')).toEqual(Coll.get(d.stages.darkroom.stack, 'b1'));
    expect(s.stages.darkroom.medium).toBe(d.stages.darkroom.medium);
    expect(s.output).toBe(d.output);
  });

  it("the scan medium: rebate and open gate scale, µm per pixel divides; a scale of 1 is the same document", () => {
    const d = edit(scanDoc(), [
      { op: 'set', path: 'stages.scan.medium.rebate', value: { x: 0, y: 0, w: 3, h: 10 } },
      { op: 'set', path: 'stages.scan.medium.openGate', value: { x: 10, y: 0, w: 2, h: 10 } },
    ]).doc;
    const s = scaleDocument(d, 4, 4);
    const m = s.stages.scan!.medium as { umPerPx: number; rebate: unknown; openGate: unknown };
    expect(m.umPerPx).toBe(6 / 4);
    expect(m.rebate).toEqual({ x: 0, y: 0, w: 12, h: 40 });
    expect(m.openGate).toEqual({ x: 40, y: 0, w: 8, h: 40 });
    expect(scaleDocument(d, 1, 1)).toBe(d);
    expect(scaleDocument(edit(d, [{ op: 'set', path: 'stages.scan.medium.openGate', value: 'flat' }]).doc, 2, 2).stages.scan!.medium).toMatchObject({ openGate: 'flat' });
  });

  it('boxes keep whole-pixel edges, and an edge on the border stays on the border', () => {
    expect(scaleBox({ x: 0, y: 0, w: 12, h: 10 }, 6016 / 12, 4016 / 10)).toEqual({ x: 0, y: 0, w: 6016, h: 4016 });
    const b = scaleBox({ x: 333, y: 17, w: 1001, h: 667 }, 1.504, 1.5041);
    for (const v of Object.values(b)) expect(Number.isInteger(v)).toBe(true);
    expect(b.x + b.w).toBe(Math.round(1334 * 1.504));
  });

  it('compiled on a source k times larger: the output is k times larger, the physical pitch the same', () => {
    for (const base of [scanDoc(), camDoc()]) {
      const d = rich(base);
      const g1 = new Graph();
      g1.registerSource(sourceInfo(SHA, 12, 10));
      const g2 = new Graph();
      g2.registerSource(sourceInfo(SHA, 36, 30));
      const s = scaleDocument(d, 3, 3);
      const a = compile(d, g1).display, b = compile(s, g2).display;
      expect([(b.info as { width: number }).width, (b.info as { height: number }).height]).toEqual([30, 21]);
      expect([(a.info as { width: number }).width, (a.info as { height: number }).height]).toEqual([10, 7]);
      // µm per pixel on the film: a third at three times the pixels, so every physical size is the same on the print
      expect(pitches(s, g2).film).toBeCloseTo(pitches(d, g1).film / 3, 12);
    }
  });

  it('refuses an unresolved link and a non-positive scale', () => {
    const d0 = scanDoc();
    const lk = { kind: 'link', ref: { look: 'warm', version: 1 }, params: {}, overrides: {} } as never;
    const d: Document = { ...d0, stages: { ...d0.stages, print: { ...d0.stages.print, stack: Coll.insert(d0.stages.print.stack, 'lk', lk) } } };
    expect(() => scaleDocument(d, 2, 2)).toThrow(/resolved/);
    expect(() => scaleDocument(scanDoc(), 0, 2)).toThrow(/positive/);
  });
});
