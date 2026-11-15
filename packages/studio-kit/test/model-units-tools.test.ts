// Golden numbers of the darkroom units and the tools' arithmetic (guide §8), from fixtures/golden/CHB-009.json; the
// tools write darkroom layers and masks as values the contract's rules accept (CHB-037).
import { readFileSync } from 'node:fs';
import { compile, edit, Graph, layerEntry, sha256Hex, type Document } from '@chromobench/contract';
import { insert, set, type Mutation } from '@chromobench/values';
import { makeM1Tiff, MockEngine } from '@chromobench/engine-mock';
import { describe, expect, it } from 'vitest';
import { defaultDocument, exposureRows, printingScript } from '../src/model/doc.ts';
import {
  addDarkroomLayer, bandOffsets, maskComponent, maskedLayer, ringLights, ringTiles, simplify, stripBase, stripLabel, stripMutation, stripValues, type Pt3,
} from '../src/model/tools.ts';
import {
  burnSeconds, dodgeSeconds, filtrationAside, formatSeconds, formatStops, FSTOPS_THIRD, fstopLogH, fstopStops, PT, PT_PER_STOP, STOP, timeAtStops,
} from '../src/model/units.ts';

const G = JSON.parse(readFileSync(new URL('../../../fixtures/golden/CHB-009.json', import.meta.url), 'utf8'));
const FMT = { seconds: formatSeconds, stops: formatStops };
const d0 = (): Document => defaultDocument('negative-scan', { sha256: 'ab'.repeat(32), name: 'x.tif', width: 96, height: 64 });
const apply = (d: Document, ms: readonly Mutation[]): Document => edit(d, ms).doc;

describe('darkroom units (golden)', () => {
  it('points and stops', () => {
    expect(PT).toBe(G.units.logHPerPoint);
    expect(STOP).toBeCloseTo(G.units.logHPerStop, 5);
    expect(PT_PER_STOP).toBeCloseTo(G.units.pointsPerStop, 2);
    expect(4 * PT).toBeCloseTo(G.units.fourPointsLogH, 12);
    expect((1 / 3) * STOP / PT).toBeCloseTo(4.0, 1);
  });
  it('time in fractions of a stop', () => {
    expect(timeAtStops(12, 1 / 3)).toBeCloseTo(G.time.plusThirdStop_s, 2);
    expect(timeAtStops(12, 1 / 6)).toBeCloseTo(G.time.plusSixthStop_s, 2);
    const strip = stripValues('time', 12, G.time.strip.step, G.time.strip.count);
    strip.forEach((v, i) => expect(Number(v.toFixed(2))).toBe(G.time.strip.values_s[i]));
    expect(strip.map(formatSeconds)).toEqual(['7.56', '9.52', '12.0', '15.12', '19.05']);
  });
  it('aperture', () => {
    expect(fstopLogH(8, 11)).toBeCloseTo(G.aperture.f8ToF11_logH, 3);
    expect(fstopStops(8, 11)).toBeCloseTo(G.aperture.f8ToF11_stops, 2);
    const i = FSTOPS_THIRD.indexOf(5.6);
    expect(FSTOPS_THIRD.slice(i, i + 7)).toEqual(G.aperture.thirdStopLabels);
    expect(2 ** (21 / 6)).toBeCloseTo(11.31, 2); // nominal f/11 is rounded from 11.31
  });
  it('filtration aside uses the isolated-band rule', () => {
    expect(filtrationAside('y', 10)).toBe(G.filtration.plus10Y_aside);
    expect(filtrationAside('m', -5)).toBe('≈ +2.0 pt G');
  });
  it('stop fractions', () => {
    expect(formatStops(1 / 3)).toBe('+1/3');
    expect(formatStops(-0.25)).toBe('−1/4');
    expect(formatStops(1.5)).toBe('+1 1/2');
    expect(formatStops(-0.919)).toBe('−0.92');
  });
});

describe('exposures', () => {
  it('dodge and burn seconds', () => {
    expect(dodgeSeconds(12, 0.25)).toBeCloseTo(G.exposures.dodgeQuarterStop_withheld_s, 2);
    expect(burnSeconds(12, 0.5)).toBeCloseTo(G.exposures.burnHalfStop_added_s, 2);
  });
  it('rows and printing script: the light law\'s seconds for each darkroom layer', () => {
    const d = apply(d0(), [
      set('main.params.time_s', 12),
      set('main.params.filtration', { c: 0, m: 51.6, y: 52.5 }),
      insert('stages.darkroom.stack', 'dodge1', layerEntry('dodge', { stops: 0.25 }, { name: 'Dodge', mask: null })),
      insert('stages.darkroom.stack', 'burn1', layerEntry('burn', { stops: 0.5 }, { name: 'Burn' })),
      insert('stages.darkroom.stack', 'flash1', layerEntry('flash', { time_s: 2 }, { name: 'Flash' })),
    ]);
    const rows = exposureRows(d, FMT);
    expect(rows.map((x) => x.id)).toEqual(['main', 'lights', 'dodge1', 'burn1', 'flash1']);
    expect(rows.filter((x) => x.t > 0).map((x) => x.seconds)).toEqual(['12.0 s', '−1.91 s', '+4.97 s', '2.0 s']);
    expect(rows.map((x) => x.change)).toEqual(['—', '—', '−1/4 st', '+1/2 st', '—']);
    expect(rows[1]!.note).toBe('printer lights');
    expect(printingScript(d, FMT)).toBe('Expose 12.0 s, hold back the sheet for 1.91 s; burn the sheet 4.97 s; flash 2.0 s.');
    // amount scales a contribution's time (the light law)
    expect(exposureRows(apply(d, [set('burn1.amount', 0.5)]), FMT).find((x) => x.id === 'burn1')!.seconds).toBe(`+${formatSeconds(burnSeconds(12, 0.5) / 2)} s`);
  });
  it('the darkroom layers the Exposures panel adds are valid entries of the light law', () => {
    let d = d0();
    for (const op of ['burn', 'dodge', 'flash', 'preflash', 'densityMask'] as const) {
      const r = addDarkroomLayer(d, op);
      d = apply(d, r.mutations);
      expect(d.stages.darkroom.stack.items[r.id]).toMatchObject({ kind: 'layer', op });
    }
    expect(d.stages.darkroom.stack.order).toEqual(['main', 'lights', 'burn1', 'dodge1', 'flash1', 'preflash1', 'contrast1']);
    expect(addDarkroomLayer(d, 'burn').id).toBe('burn2');
  });
});

describe('test strip and ring-around', () => {
  it('band offsets are centred', () => {
    expect(bandOffsets(5)).toEqual([-2, -1, 0, 1, 2]);
    expect(bandOffsets(4)).toEqual([-1.5, -0.5, 0.5, 1.5]);
  });
  it('a band click is one set on the main exposure; in normalised mode a time band moves the printer lights', () => {
    const d = d0();
    expect(stripBase('time', d)).toBe(10);
    expect(stripMutation('time', d, 15.1191)).toEqual({ path: 'main.params.time_s', value: 15.1191 });
    expect(stripMutation('filtration.y', d, 10)).toEqual({ path: 'main.params.filtration', value: { c: 0, m: 0, y: 10 } });
    const n = apply(d, [set('stages.darkroom.medium.mode', 'normalised')]);
    const m = stripMutation('time', n, 20);
    expect(m.path).toBe('lights.params.logH');
    (m.value as number[]).forEach((v) => expect(v).toBeCloseTo(Math.log10(2), 6));
    expect(stripLabel('time', 20, n)).toBe('+1 st');
    expect(stripLabel('time', 20, d)).toBe('20.0 s');
  });
  it('a filtration strip steps the signed shift through 0 (contract 0.2) and is labelled with signs', () => {
    expect(stripValues('filtration.y', 0, 5, 5)).toEqual([-10, -5, 0, 5, 10]);
    expect(stripValues('filtration.m', -95, 5, 5)).toEqual([-100, -100, -95, -90, -85]);
    expect([-10, 0, 2.5].map((v) => stripLabel('filtration.y', v))).toEqual(['−10 CC', '0 CC', '+2.5 CC']);
  });
  it('+G (−M) at 4 pt is (+2, −4, +2) pt; the dominant component equals the step', () => {
    const tiles = ringTiles(G.ringAround.step_pt);
    const g = tiles.find((t) => t.id === 'G')!;
    g.offset.forEach((v, i) => expect(v).toBeCloseTo(G.ringAround.plusGreen_logH[i], 12));
    expect(g.offset.map((v) => Math.round(v / PT))).toEqual(G.ringAround.plusGreen_points);
    for (const t of tiles.filter((x) => x.row < 3 && x.id !== 'current')) {
      expect(Math.max(...t.offset.map(Math.abs))).toBeCloseTo(4 * PT, 12);
      expect(t.offset.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 12); // colour moves keep density
    }
    // opposite directions are opposite offsets
    const off = (id: string): number[] => tiles.find((t) => t.id === id)!.offset;
    for (const [a, b] of [['G', 'M'], ['R', 'C'], ['B', 'Y']] as const) off(a).forEach((v, i) => expect(v).toBeCloseTo(-off(b)[i]!, 12));
    // more light of a colour makes more of its complementary dye: +Y needs more blue light, +B less
    expect(off('Y')[2]).toBeGreaterThan(0);
    expect(off('B')[2]).toBeLessThan(0);
    expect(off('R')[0]).toBeLessThan(0);
    expect(off('C')[0]).toBeGreaterThan(0);
    expect(tiles.filter((t) => t.row === 3).map((t) => t.label)).toEqual(['−2 step', '−1 step', '+1 step', '+2 step']);
    // the chosen tile's lights, held to ±1.5 log H
    expect(ringLights(d0(), g.offset)).toEqual(g.offset.map((x) => Number(x.toFixed(6))));
    expect(ringLights(apply(d0(), [set('lights.params.logH', [1.45, 0, 0])]), [0.1, 0, 0])[0]).toBe(1.5);
  });
});

describe('masks', () => {
  it('RDP keeps a straight stroke to its end points and keeps corners', () => {
    const line: Pt3[] = Array.from({ length: 50 }, (_, i) => [i, 0.1 * Math.sin(i), 0.5]);
    expect(simplify(line, 0.5)).toHaveLength(2);
    const corner: Pt3[] = [[0, 0, 1], [5, 0, 1], [10, 0, 1], [10, 5, 1], [10, 10, 1]];
    expect(simplify(corner, 0.5)).toEqual([[0, 0, 1], [10, 0, 1], [10, 10, 1]]);
  });
  it('a mask tool makes a mask value in the library and a burn through it; the document compiles and renders on the mock', async () => {
    const engine = new MockEngine();
    const bytes = makeM1Tiff();
    const info = await engine.open({ kind: 'file', sha256: sha256Hex(bytes), bytes });
    const g = new Graph();
    g.registerSource(info);
    let d = defaultDocument('negative-scan', { sha256: info.sha256, name: 'm1.tif', width: info.width, height: info.height });
    const shapes = [
      { kind: 'ellipse' as const, cx: 48, cy: 32, rx: 10, ry: 8, angle: 30 },
      { kind: 'linear' as const, from: [0, 0] as [number, number], to: [0, 64] as [number, number] },
      { kind: 'stroke' as const, points: [[10, 10, 0.5], [20, 12, 0.5]] as Pt3[], radius: 4, hardness: 0.5, mode: 'add' as const },
    ];
    const made: string[] = [];
    for (const sh of shapes) {
      const r = maskedLayer(d, g, sh, { featherPx: 8 });
      d = apply(d, r.mutations);
      made.push(`${r.mask}:${r.layer}`);
    }
    expect(made).toEqual(['m1:burn1', 'm2:burn2', 'm3:burn3']);
    expect(d.masks.items['m1']!.components.items['m1c1']).toMatchObject({ kind: 'ellipse', params: { box: { x: 38, y: 24, w: 20, h: 16 }, angle_deg: 30 }, combine: 'add', amount: 1 });
    expect(d.masks.items['m2']!.components.items['m2c1']!.kind).toBe('linear');
    expect(d.masks.items['m3']!.components.items['m3c1']!.kind).toBe('paint');
    // the feather is stored in mm on the print: 8 px at the print's pitch
    expect(d.masks.items['m1']!.feather_mm).toBeGreaterThan(0);
    expect(d.stages.darkroom.stack.items['burn1']).toMatchObject({ op: 'burn', mask: 'm1', params: { stops: 0.5 } });
    const c = compile(d, g);
    engine.adopt(g.closure(c.display.id));
    const r = await engine.evaluate(c.display, { scale: 'full', precision: 'preview' });
    expect(r.width).toBe(info.width);
    expect(maskComponent({ kind: 'ellipse', cx: 5, cy: 5, rx: 2, ry: 3 })).toEqual(['ellipse', { box: { x: 3, y: 2, w: 4, h: 6 } }]);
  });
});
