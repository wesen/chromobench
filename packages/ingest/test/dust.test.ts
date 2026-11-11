// Stage 4 dust tests (guide §8.3): planted dust in density (recall/precision), neutrality rejects
// single-channel blobs (and the variant without it does not), goja-cv's heal laws, IR detection.
import { beforeAll, describe, expect, it } from 'vitest';
import {
  checkDust, components, detectSpecks, distanceToSet, heal, plantedFrame, spotsMask, toRecipeSpots, type PlantedFrame, type SpeckResult,
} from '@chromobench/ingest';

let F: PlantedFrame;
let R: SpeckResult;
const near = (s: { cx: number; cy: number }, p: { cx: number; cy: number; r: number }): boolean => Math.hypot(s.cx - p.cx + 0.5, s.cy - p.cy + 0.5) <= p.r + 1.5;

beforeAll(() => {
  F = plantedFrame({ seed: 7 });
  R = detectSpecks(F.D, F.w, F.h, F.sigma);
});

describe('dust detection in density', () => {
  for (const seed of [7, 11, 23]) {
    it(`recall ≥ 0.95 and precision ≥ 0.9 for specks of ≥ 5σ (seed ${seed})`, () => {
      const G = seed === 7 ? F : plantedFrame({ seed });
      const r = seed === 7 ? R : detectSpecks(G.D, G.w, G.h, G.sigma);
      const strong = G.specks.filter((p) => -Math.log10(1 - p.a) >= 5 * r.noiseD);
      expect(strong.length).toBeGreaterThanOrEqual(25);
      const found = r.spots.filter((s) => s.score >= 0.5);
      const hit = strong.filter((p) => found.some((s) => near(s, p)));
      const tp = found.filter((s) => G.specks.some((p) => near(s, p)));
      expect(hit.length / strong.length).toBeGreaterThanOrEqual(0.95);
      expect(tp.length / found.length).toBeGreaterThanOrEqual(0.9);
    });
  }
  it('neutrality rejects single-channel blobs of the same contrast; without it they pass (broken variant)', () => {
    const decoyFound = (r: SpeckResult): number => F.decoys.filter((p) => r.spots.some((s) => s.score >= 0.5 && near(s, p))).length;
    const candidates = F.decoys.filter((p) => R.spots.some((s) => near(s, p)));
    expect(candidates.length).toBeGreaterThanOrEqual(F.decoys.length * 0.8); // they are detected as candidates …
    expect(decoyFound(R)).toBe(0); // … but scored out by neutrality
    const broken = detectSpecks(F.D, F.w, F.h, F.sigma, { neutrality: false });
    expect(decoyFound(broken)).toBeGreaterThanOrEqual(F.decoys.length * 0.8);
  });
  it('dust spots are neutral; recipe spots are in sensor px', () => {
    const dust = R.spots.filter((s) => s.score >= 0.5);
    for (const s of dust) expect(s.neutrality).toBeGreaterThan(0.5);
    const rs = toRecipeSpots(R.spots, { x0: 100, y0: 50 });
    expect(rs.length).toBe(dust.length);
    expect(rs[0]!.x).toBeCloseTo(100 + dust[0]!.cx, 6);
  });
  it('an infrared plane detects dust directly (Digital ICE), without neutrality', () => {
    const ir = new Float32Array(F.w * F.h).map((_, i) => 0.05 + 0.002 * Math.sin(i));
    for (const s of F.specks) for (let y = Math.floor(s.cy - s.r); y <= Math.ceil(s.cy + s.r); y++) for (let x = Math.floor(s.cx - s.r); x <= Math.ceil(s.cx + s.r); x++) {
      if ((x + 0.5 - s.cx) ** 2 + (y + 0.5 - s.cy) ** 2 <= s.r * s.r) ir[y * F.w + x]! += -Math.log10(1 - s.a);
    }
    const r = detectSpecks(F.D, F.w, F.h, F.sigma, {}, ir);
    const found = r.spots.filter((s) => s.score >= 0.5);
    expect(found.every((s) => s.source === 'ir')).toBe(true);
    expect(F.specks.filter((p) => found.some((s) => near(s, p))).length / F.specks.length).toBeGreaterThanOrEqual(0.95);
    expect(F.decoys.some((p) => found.some((s) => near(s, p)))).toBe(false);
  });
});

describe('heal laws (goja-cv heal_test.go 61–119, in density)', () => {
  const sigmaMean = (): number => (F.sigma[0] + F.sigma[1] + F.sigma[2]) / 3;
  const healWith = (method: 'patch' | 'diffuse'): ReturnType<typeof heal> => heal(F.D, F.w, F.h, spotsMask(R.spots.filter((s) => s.score >= 0.5), F.w, F.h), { marginPx: 1.5, method });
  it('healed specks are within 1.5σ of the truth; nothing outside the grown targets changes', () => {
    const h = healWith('patch');
    let sum = 0, n = 0;
    for (const p of F.specks) for (let y = Math.floor(p.cy - p.r); y <= Math.ceil(p.cy + p.r); y++) for (let x = Math.floor(p.cx - p.r); x <= Math.ceil(p.cx + p.r); x++) {
      if ((x + 0.5 - p.cx) ** 2 + (y + 0.5 - p.cy) ** 2 > p.r * p.r) continue;
      for (let k = 0; k < 3; k++) { sum += Math.abs(h.planes[k]![y * F.w + x]! - F.truth[k]![y * F.w + x]!); n++; }
    }
    expect(sum / n).toBeLessThanOrEqual(1.5 * sigmaMean());
    for (let i = 0; i < F.w * F.h; i++) if (!h.grown[i]) for (let k = 0; k < 3; k++) expect(h.planes[k]![i]).toBe(F.D[k]![i]);
  });
  it('check.dust after healing finds at most one speck', () => {
    const h = healWith('patch');
    expect(checkDust(R).verdict).toBe('dusty');
    expect(checkDust(detectSpecks(h.planes, F.w, F.h, F.sigma)).count).toBeLessThanOrEqual(1);
  });
  it('patch keeps more than twice the high-pass σ of diffuse inside healed specks', () => {
    const hp = (planes: Float32Array[], mask: Uint8Array): number => {
      let s = 0, n = 0;
      for (let y = 1; y < F.h - 1; y++) for (let x = 1; x < F.w - 1; x++) {
        const i = y * F.w + x;
        if (!mask[i]) continue;
        const p = planes[1]!;
        const lap = p[i]! - (p[i - 1]! + p[i + 1]! + p[i - F.w]! + p[i + F.w]!) / 4;
        s += lap * lap; n++;
      }
      return Math.sqrt(s / n);
    };
    const a = healWith('patch');
    const b = healWith('diffuse');
    expect(hp(a.planes, a.grown)).toBeGreaterThan(2 * hp(b.planes, b.grown));
  });
});

describe('kernels', () => {
  it('distance transform and components', () => {
    const m = new Uint8Array(25);
    m[12] = 1;
    const d = distanceToSet(m, 5, 5);
    expect(d[0]).toBeCloseTo(Math.SQRT2 * 2, 6);
    expect(d[13]).toBe(1);
    const fg = Uint8Array.from([1, 0, 1, 0, 1, 0, 1, 0, 0]);
    expect(components(fg, 3, 3).map((c) => Array.from(c))).toEqual([[0, 2, 4, 6]]);
  });
});
