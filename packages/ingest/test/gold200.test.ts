// Gold 200 goldens (guide §6, §8.2; textbook §1.7, §3.5): decode, rebate, σ at two scales, base
// classes at two sizes, shadow floor, and the traced pixel — plus the broken variants of §8.4.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Box, Vec3 } from '@chromobench/contract';
import {
  baseClass, classifyImage, noiseAtScale, openSourceSync, orientedToSensorBox, readChunks, rebateAuto, rebateFromBox,
  rebatePercentile, region, shadowFloor, sigmaD, type OpenedSource,
} from '@chromobench/ingest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const golden = JSON.parse(readFileSync(`${root}fixtures/golden/ingest-gold200.json`, 'utf8'));
const c1 = readdirSync(`${root}ttmp/2026/11/11`).find((d) => d.startsWith('CHB-001--'))!;
const SAMPLE = `${root}ttmp/2026/11/11/${c1}/sources/chromogen-studio-1.2/samples/gold200.png`;

const near = (got: readonly number[], want: readonly number[], tol: number): void => {
  got.forEach((v, i) => expect(Math.abs(v - want[i]!), `component ${i}: ${v} vs ${want[i]}`).toBeLessThanOrEqual(tol));
};

let src: OpenedSource;
let rebate: Box;
let crop: Box;
let Treb: Vec3;
let full: Float32Array;
let small: Float32Array;
const SW = 1292;
const SH = 863;
/** The sample is flipH: anchor footprint grids as Chromogen does in the oriented image. */
const G = { orientation: 'flipH' as const };

beforeAll(() => {
  const bytes = new Uint8Array(readFileSync(SAMPLE));
  src = openSourceSync(bytes, { options: { levels: golden.decode.levels } });
  const [rx, ry, rw, rh] = golden.oriented.rebate;
  const [cx, cy, cw, ch] = golden.oriented.crop;
  rebate = orientedToSensorBox('flipH', { x: rx, y: ry, w: rw, h: rh }, SW, SH);
  crop = orientedToSensorBox('flipH', { x: cx, y: cy, w: cw, h: ch }, SW, SH);
  Treb = rebateFromBox(src.linear, rebate, G).T;
  full = region(src.linear, crop, 1090, 754, G);
  small = region(src.linear, crop, 640, 443, G);
});

describe('Gold 200: bytes, probe, levels', () => {
  it('identity and PNG structure', () => {
    expect(src.sha256).toBe(golden.sha256);
    expect(readChunks(new Uint8Array(readFileSync(SAMPLE))).map((c) => c.type).filter((t, i, a) => a.indexOf(t) === i)).toEqual(golden.png.chunks);
    expect([src.info.width, src.info.height, src.info.bits]).toEqual([1292, 863, 16]);
  });
  it('16-bit PNG without colour chunks decodes as linear with W_ENCODING_ASSUMED; levels are declared', () => {
    expect(src.raw.encoding).toEqual({ value: 'linear', evidence: 'bit-depth' });
    expect(src.info.notes.map((n) => n.code)).toContain('W_ENCODING_ASSUMED');
    expect(src.info.levels).toEqual({ ...golden.decode.levels, from: 'declared' });
  });
  it('sensor coordinates of the rebate and crop (DR-7)', () => {
    expect(rebate).toEqual(golden.sensor.rebate);
    expect(crop).toEqual(golden.sensor.crop);
  });
  it('the traced pixel: stored samples and linear values', () => {
    const [x, y] = golden.tracedPixel.sensor;
    expect([0, 1, 2].map((k) => src.raw.planes[k]![y * SW + x])).toEqual(golden.tracedPixel.u);
    const row = new Float64Array(SW);
    near([0, 1, 2].map((k) => (src.linear.row(k, y, row), row[x]!)), golden.tracedPixel.T, 1e-5);
  });
});

describe('Gold 200: rebate, σ, classes (textbook goldens)', () => {
  it('T_reb of the picked box', () => near(Treb, golden.rebateT.value, golden.rebateT.tol));
  it('σ at full size 1,090×754 from the rebate box', () => {
    const n = noiseAtScale(src.linear, Treb, 1, { rgb: full, w: 1090, h: 754 }, rebate, G);
    expect(n.from).toBe('rebate');
    near(n.sigma, golden.sigmaFull.value, golden.sigmaFull.tol);
  });
  it('σ at the 640-pixel statistics size', () => {
    const n = noiseAtScale(src.linear, Treb, 640 / 1090, { rgb: small, w: 640, h: 443 }, rebate, G);
    expect(n.size).toEqual([640, 443]);
    near(n.sigma, golden.sigma640.value, golden.sigma640.tol);
  });
  it('blank and below-base fractions at both sizes', () => {
    const sF = noiseAtScale(src.linear, Treb, 1, { rgb: full, w: 1090, h: 754 }, rebate, G).sigma;
    const sS = noiseAtScale(src.linear, Treb, 640 / 1090, { rgb: small, w: 640, h: 443 }, rebate, G).sigma;
    const f = classifyImage(full, 1090, 754, Treb, sF).stats;
    const s = classifyImage(small, 640, 443, Treb, sS).stats;
    expect(f.size).toEqual([1090, 754]);
    expect(Math.abs(f.blank - golden.classes.full.blank)).toBeLessThanOrEqual(golden.classes.full.tol);
    expect(Math.abs(f.below - golden.classes.full.below)).toBeLessThanOrEqual(golden.classes.full.tol);
    expect(Math.abs(s.blank - golden.classes['640'].blank)).toBeLessThanOrEqual(golden.classes['640'].tol);
    expect(Math.abs(s.below - golden.classes['640'].below)).toBeLessThanOrEqual(golden.classes['640'].tol);
  });
  it('the traced pixel is below base with the picked rebate', () => {
    const [x, y] = golden.tracedPixel.sensor;
    const row = new Float64Array(SW);
    const T = [0, 1, 2].map((k) => (src.linear.row(k, y, row), row[x]!)) as Vec3;
    const sF = noiseAtScale(src.linear, Treb, 1, { rgb: full, w: 1090, h: 754 }, rebate, G).sigma;
    const c = baseClass(T, Treb, sF);
    near(c.D, golden.tracedPixel.D, 0.0006);
    near(c.z, golden.tracedPixel.z, 0.02);
    expect(c.cls).toBe('below');
  });
  it('shadow floor next to the rebate is within noise; mid-frame it is 0.03–0.04 D lower', () => {
    // The rebate is on the sensor's right (flipH), so bands count from the right edge of the crop.
    const bands = shadowFloor(full, 1090, 754, Treb, 25, 'right');
    near(bands[0]!.p01, golden.shadowFloor.nextToRebate, golden.shadowFloor.tol);
    const mid = bands[Math.floor(bands.length / 2)]!.p01;
    near(mid, golden.shadowFloor.midFrame, golden.shadowFloor.midTol);
  });
});

describe('Gold 200: broken variants must fail (guide §8.4)', () => {
  it('the percentile rebate reports the traced pixel as blank, not below base', () => {
    const p = rebatePercentile(src.linear, crop, G);
    near(p.T, golden.percentileRebate.T, 2e-4);
    expect(p.notes.map((n) => n.code)).toContain('W_REBATE_PERCENTILE');
    const [x, y] = golden.tracedPixel.sensor;
    const row = new Float64Array(SW);
    const T = [0, 1, 2].map((k) => (src.linear.row(k, y, row), row[x]!)) as Vec3;
    const sF = noiseAtScale(src.linear, Treb, 1, { rgb: full, w: 1090, h: 754 }, rebate, G).sigma;
    expect(baseClass(T, p.T, sF).cls).toBe(golden.percentileRebate.tracedPixelClass);
  });
  it('the automatic region search finds the rebate strip (overlapping the picked box, within 0.015 D)', () => {
    const a = rebateAuto(src.linear, crop);
    expect(a.from).toBe('auto-region');
    const d = a.T.map((t, k) => Math.abs(Math.log10(t / Treb[k]!)));
    expect(Math.max(...d)).toBeLessThan(0.015); // the strip is 0.021 D denser at its top (textbook §3.5)
    const b = a.box!;
    const ix = Math.max(0, Math.min(b.x + b.w, rebate.x + rebate.w) - Math.max(b.x, rebate.x));
    const iy = Math.max(0, Math.min(b.y + b.h, rebate.y + rebate.h) - Math.max(b.y, rebate.y));
    expect((ix * iy) / (rebate.w * rebate.h)).toBeGreaterThan(0.8);
  });
  it('f32 summed-area tables lose σ on a 4096² frame', () => {
    const w = 4096, h = 4096;
    const rgb = new Float32Array(w * h * 3);
    let s = 12345;
    const rnd = (): number => { s = (s * 1103515245 + 12345) >>> 0; return s / 4294967296; };
    for (let i = 0; i < w * h; i++) {
      const g = Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
      const t = 0.5 * 10 ** (-0.01 * g);
      rgb[3 * i] = t; rgb[3 * i + 1] = t; rgb[3 * i + 2] = t;
    }
    const T0: Vec3 = [1, 1, 1]; // D ≈ 0.30: running sums reach 5e6, where f32 keeps no digit below 0.5
    const good = sigmaD(rgb, w, h, T0, null, 4, false)!;
    const bad = sigmaD(rgb, w, h, T0, null, 4, true)!;
    expect(Math.abs(good[0] / 0.01 - 1.0062)).toBeLessThan(0.01);
    expect(Math.abs(bad[0] / 0.01 - 1.0062)).toBeGreaterThan(0.05);
  }, 120_000);
});
