// Golden numbers of the darkroom units and the tools' arithmetic (guide §8), from fixtures/golden/CHB-009.json.
import { readFileSync } from 'node:fs';
import { Graph, sha256Hex, type FrameRecipe } from '@chromobench/contract';
import { makeM1Tiff, MockEngine } from '@chromobench/engine-mock';
import { describe, expect, it } from 'vitest';
import { defaultFor } from '../src/core/frame-session.ts';
import {
  bandOffsets, exposureRows, maskSpec, parseMask, printingScript, ringTiles, simplify, stripLabel, stripMutation, stripValues, type MaskDoc, type Pt3,
} from '../src/core/tools.ts';
import {
  burnSeconds, dodgeSeconds, filtrationAside, formatSeconds, formatStops, FSTOPS_THIRD, fstopLogH, fstopStops, PT, PT_PER_STOP, STOP, timeAtStops,
} from '../src/core/units.ts';

const G = JSON.parse(readFileSync(new URL('../../../fixtures/golden/CHB-009.json', import.meta.url), 'utf8'));

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
  it('rows and printing script', () => {
    const r = defaultFor('ab'.repeat(32), 'x.tif');
    const rr: FrameRecipe = {
      ...r,
      print: {
        ...r.print,
        enlarger: { ...r.print.enlarger, time_s: 12, filtration: { c: 0, m: 51.6, y: 52.5 } },
        exposures: [
          { id: 'dodge1', kind: 'dodge', enabled: true, mask: 'face', time_s: null, stops: 0.25, filtration: null, through: null },
          { id: 'burn1', kind: 'burn', enabled: true, mask: 'sky', time_s: null, stops: 0.5, filtration: null, through: null },
          { id: 'flash1', kind: 'flash', enabled: true, mask: null, time_s: 2, stops: null, filtration: null, through: 'base' },
        ],
      },
    };
    const rows = exposureRows(rr);
    expect(rows.map((x) => x.seconds)).toEqual(['12.0 s', '−1.91 s', '+4.97 s', '2.0 s']);
    expect(rows.map((x) => x.change)).toEqual(['—', '−1/4 st', '+1/2 st', '—']);
    expect(printingScript(rr)).toBe('Expose 12.0 s, hold back face for 1.91 s; burn sky 4.97 s; flash 2.0 s.');
  });
});

describe('test strip and ring-around', () => {
  it('band offsets are centred', () => {
    expect(bandOffsets(5)).toEqual([-2, -1, 0, 1, 2]);
    expect(bandOffsets(4)).toEqual([-1.5, -0.5, 0.5, 1.5]);
  });
  it('a band click is one set', () => {
    const r = defaultFor('ab'.repeat(32), 'x.tif');
    expect(stripMutation('time', r, 15.1191)).toEqual({ op: 'set', path: 'print.enlarger.time_s', value: 15.1191 });
    expect(stripMutation('filtration.y', r, 10)).toEqual({ op: 'set', path: 'print.enlarger.filtration', value: { c: 0, m: 0, y: 10 } });
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
  });
});

describe('masks', () => {
  it('RDP keeps a straight stroke to its end points and keeps corners', () => {
    const line: Pt3[] = Array.from({ length: 50 }, (_, i) => [i, 0.1 * Math.sin(i), 0.5]);
    expect(simplify(line, 0.5)).toHaveLength(2);
    const corner: Pt3[] = [[0, 0, 1], [5, 0, 1], [10, 0, 1], [10, 5, 1], [10, 10, 1]];
    expect(simplify(corner, 0.5)).toEqual([[0, 0, 1], [10, 0, 1], [10, 10, 1]]);
  });
  it('MaskSpec round-trips through mask.set and renders on the mock', async () => {
    const engine = new MockEngine();
    const bytes = makeM1Tiff();
    const info = await engine.open({ kind: 'file', sha256: sha256Hex(bytes), bytes });
    const g = new Graph();
    g.registerSource(info);
    const src = g.intern('source.open', [], { source: info.sha256, encoding: 'linear' }).node;
    const doc: MaskDoc = {
      shapes: [
        { kind: 'ellipse', cx: 48, cy: 32, rx: 10, ry: 8 },
        { kind: 'ellipse', cx: 30, cy: 20, rx: 12, ry: 4, angle: 30 },
        { kind: 'gradient', from: [0, 0], to: [0, 64] },
        { kind: 'stroke', points: [[10, 10, 0.5], [20, 12, 0.5]], radius: 4, hardness: 0.5, mode: 'add' },
      ],
      feather: 3,
      invert: true,
    };
    const spec = maskSpec(g, src.id, doc);
    expect(spec.version).toBe(1);
    expect(spec.nodes.at(-1)!.op).toBe('mask.not');
    expect(parseMask(spec)).toEqual(doc);
    const root = g.adopt(spec.nodes).at(-1)!;
    engine.adopt(spec.nodes);
    const r = await engine.evaluate(root, { scale: 'full', precision: 'preview' });
    expect(r.info.domain).toBe('mask');
    // the tilted ellipse (mask.ellipse.angle_deg) covers its rotated major axis, not the box corner
    const tilted = spec.nodes.find((n) => n.op === 'mask.ellipse' && n.args['angle_deg'] === 30)!;
    const e = g.adopt(spec.nodes.slice(0, spec.nodes.indexOf(tilted) + 1)).at(-1)!;
    const m = await (await engine.evaluate(e, { scale: 'full', precision: 'preview' })).read();
    const at = (x: number, y: number) => m[y * r.width + x];
    expect(at(30 + 9, 20 + 5)).toBe(1); // 10.4 px along the 30° axis
    expect(at(30 + 9, 20 - 5)).toBe(0);
  });
});
