// Dust as scan-stage heal layers (CHB-037 P5b-1): every speck a heal spot with an explicit source chosen from the
// image, the specks a "Dust" group the document's rules accept. Synthetic images only.
import { describe, expect, it } from 'vitest';
import { edit, newDocument, type Layer, type Vec3 } from '@chromobench/contract';
import { Coll, insert } from '@chromobench/values';
import { chooseSources, densityPlanes, dustGroup, dustSpots, DUST_GROUP_ID, plantedFrame, type HealSpot } from '@chromobench/ingest';

const TREB: Vec3 = [0.8, 0.6, 0.4];
/** linear RGB of density planes against the base */
const rgbOf = (D: Float32Array[], w: number, h: number): Float32Array => {
  const rgb = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) for (let k = 0; k < 3; k++) rgb[i * 3 + k] = TREB[k]! * 10 ** -D[k]![i]!;
  return rgb;
};

describe('dustSpots', () => {
  const F = plantedFrame({ seed: 7 });
  const spots = dustSpots(rgbOf(F.D, F.w, F.h), F.w, F.h, TREB, { sigma: F.sigma });
  it('finds the planted specks, each with a source inside the image and off every speck', () => {
    const strong = F.specks.filter((p) => -Math.log10(1 - p.a) >= 0.05);
    const hit = strong.filter((p) => spots.some((s) => Math.hypot(s.x - p.cx, s.y - p.cy) <= p.r + 1.5));
    expect(hit.length / strong.length).toBeGreaterThanOrEqual(0.9);
    for (const s of spots) {
      expect(s.r).toBeGreaterThan(0);
      expect(s.feather).toBe(0.3);
      expect(s.opacity).toBe(1);
      expect(s.src.x - s.r).toBeGreaterThanOrEqual(0);
      expect(s.src.y - s.r).toBeGreaterThanOrEqual(0);
      expect(s.src.x + s.r).toBeLessThanOrEqual(F.w);
      expect(s.src.y + s.r).toBeLessThanOrEqual(F.h);
      for (const o of spots) expect(Math.hypot(s.src.x - o.x, s.src.y - o.y)).toBeGreaterThanOrEqual(o.r + s.r - 1e-9);
      for (const p of [...F.specks, ...F.decoys]) expect(Math.hypot(s.src.x - p.cx, s.src.y - p.cy)).toBeGreaterThan(p.r);
    }
  });
  it('a source lies on the flat side of an edge, not across it', () => {
    const w = 120, h = 80;
    const D = [0, 1, 2].map(() => new Float32Array(w * h));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (const p of D) p[y * w + x] = x < 60 ? 0.5 : 1.2;
    const [src] = chooseSources(D, w, h, [{ x: 54, y: 40, r: 4 }]);
    expect(src).not.toBeNull();
    expect(src!.x + 4).toBeLessThanOrEqual(60);
    // and in the planes the scan gives: a speck on the flat side, away from the edge, heals from the flat side
    const rgb = rgbOf(D, w, h);
    for (let y = 38; y <= 42; y++) for (let x = 36; x <= 40; x++) for (let k = 0; k < 3; k++) rgb[(y * w + x) * 3 + k]! *= 0.5;
    const found = dustSpots(rgb, w, h, TREB, { sigma: [0.004, 0.004, 0.004] });
    expect(found.length).toBe(1);
    expect(found[0]!.src.x + found[0]!.r).toBeLessThanOrEqual(60);
    expect(densityPlanes(rgb, w, h, TREB)[0]![0]).toBeCloseTo(0.5, 5);
  });
});

describe('dustGroup', () => {
  const spots: HealSpot[] = [
    { x: 20.5, y: 30.5, r: 4, src: { x: 34, y: 30.5 }, feather: 0.3, opacity: 1 },
    { x: 80, y: 60, r: 3, src: { x: 70, y: 60 }, feather: 0.3, opacity: 1 },
  ];
  it('is a pass group "Dust" of one heal layer per speck, by ingest', () => {
    const g = dustGroup(spots);
    expect(g.kind).toBe('group');
    expect(g.name).toBe('Dust');
    expect(g.blend).toBe('pass');
    expect(g.stack.order).toEqual(['dust-1', 'dust-2']);
    const l = Coll.get(g.stack, 'dust-2') as Layer;
    expect(l.op).toBe('heal');
    expect(l.source).toEqual({ kind: 'auto', by: 'ingest.dust' });
    expect(Coll.values(l.params['spots'] as unknown as Coll<HealSpot>)).toEqual([spots[1]]);
  });
  it('a negative scan with it validates under the document rules', () => {
    const doc = newDocument('negative-scan', { sha256: 'a'.repeat(64), width: 120, height: 80 });
    const r = edit(doc, [insert('stages.scan.stack', DUST_GROUP_ID, dustGroup(spots))]);
    expect(r.doc.stages.scan!.stack.order).toEqual([DUST_GROUP_ID]);
    expect(() => edit(doc, [insert('stages.darkroom.stack', DUST_GROUP_ID, dustGroup(spots))])).toThrow();
  });
});
