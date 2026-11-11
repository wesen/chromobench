// Policy semantics (guide §15, "Laws"): property tests with a seeded generator, each run once with a
// deliberately broken variant to show it can fail.
import { describe, expect, it } from 'vitest';
import { densitySpectrum, linearSensitivity, transmittance, zeroWhereMissing, type MissingPolicy } from '../src/index.ts';
import { open, SF } from './helpers.ts';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomDensity(r: () => number): Float64Array {
  const a = Float64Array.from({ length: 81 }, () => r() * 3 - 0.2);
  const gaps = Math.floor(r() * 4);
  for (let g = 0; g < gaps; g++) {
    const start = Math.floor(r() * 81);
    const len = 1 + Math.floor(r() * 20);
    for (let i = start; i < Math.min(81, start + len); i++) a[i] = NaN;
  }
  return a;
}

const N = 300;

describe('missing-data policies', () => {
  it('opaque: transmittance is exactly 0 where valid is 0 and 10^-D elsewhere', () => {
    const r = rng(7);
    for (let n = 0; n < N; n++) {
      const raw = randomDensity(r);
      const s = densitySpectrum(raw, 'opaque');
      const T = transmittance(s.values, s.valid);
      for (let i = 0; i < 81; i++) {
        if (Number.isNaN(raw[i]!)) expect(s.valid[i]! === 0 && T[i] === 0).toBe(true);
        else expect(T[i]).toBe(10 ** -raw[i]!);
      }
    }
  });

  it('zero-density: transmittance equals 10^-D with D = 0 at missing samples', () => {
    const r = rng(8);
    for (let n = 0; n < N; n++) {
      const raw = randomDensity(r);
      const s = densitySpectrum(raw, 'zero-density');
      const T = transmittance(s.values, s.valid);
      for (let i = 0; i < 81; i++) expect(T[i]).toBe(Number.isNaN(raw[i]!) ? 1 : 10 ** -raw[i]!);
    }
  });

  it('extend-flat: no invalid rows remain and every filled value is a measured neighbour', () => {
    const r = rng(9);
    for (let n = 0; n < N; n++) {
      const raw = randomDensity(r);
      if (raw.every((v) => Number.isNaN(v))) continue;
      const s = densitySpectrum(raw, 'extend-flat');
      expect(s.valid.every((v) => v === 1)).toBe(true);
      const measured = new Set(Array.from(raw).filter((v) => !Number.isNaN(v)));
      for (let i = 0; i < 81; i++) expect(measured.has(s.values[i]!)).toBe(true);
    }
  });

  it('values never hold NaN or infinities under any policy', () => {
    const r = rng(10);
    for (const p of ['opaque', 'zero-density', 'extend-flat'] as MissingPolicy[]) {
      for (let n = 0; n < 50; n++) expect(densitySpectrum(randomDensity(r), p).values.every(Number.isFinite)).toBe(true);
    }
  });

  it('a missing log sensitivity is zero sensitivity', () => {
    const s = linearSensitivity(zeroWhereMissing([NaN, 0, -1], 'log10'));
    expect(Array.from(s.values)).toEqual([0, 1, 0.1]);
    expect(Array.from(s.valid)).toEqual([0, 1, 1]);
  });

  it('broken variant: a transmittance that ignores valid is caught by the opaque law', () => {
    const raw = randomDensity(rng(11));
    raw[40] = NaN;
    const s = densitySpectrum(raw, 'opaque');
    const brokenT = s.values.map((d) => 10 ** -d); // reads missing as 0 D
    expect(brokenT[40]).toBe(1);
    expect(transmittance(s.values, s.valid)[40]).toBe(0);
  });

  it('on real data: Portra 400 base under opaque has 20 invalid rows (380–395, 705–780 nm), none under the others', () => {
    const p = open(SF);
    const inv = (m: MissingPolicy) => Array.from(p.stockSync('kodak_portra_400', { missing: m }).base_D.valid).flatMap((v, i) => (v ? [] : [380 + 5 * i]));
    expect(inv('opaque')).toEqual([380, 385, 390, 395, ...Array.from({ length: 16 }, (_, i) => 705 + 5 * i)]);
    expect(inv('zero-density')).toEqual([]);
    expect(inv('extend-flat')).toEqual([]);
    const flat = p.stockSync('kodak_portra_400', { missing: 'extend-flat' }).base_D.values;
    expect(flat[80]).toBe(flat[64]); // 780 nm takes the 700 nm value
  });
});
