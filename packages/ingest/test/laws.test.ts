// Stage 3 laws (guide §8.2, §8.4): flat field, flare fit, σ estimator properties, MAD robustness and the
// open gate — each with a broken variant. Stock ranking, the base check and the conditioning map need a
// ScannerForward and run on core's (packages/core/test/ingest-forward.test.ts, CHB-017); the flat-wedge
// and base-relativity channel laws are core's chapter 1 laws (packages/core/src/laws/ch1.laws.ts).
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Vec3 } from '@chromobench/contract';
import {
  cameraLinearFromInterleaved, checkFlat, detectOpenGate, fitFlare, fitFlareChannel, flatAt, flatGrid,
  madSigma, openSourceSync, rebateFromBox, region, sigmaD, wedgeReading, type CameraLinear,
} from '@chromobench/ingest';
import { GOLD200, ROOT } from './chromogen.ts';

const laws = JSON.parse(readFileSync(`${ROOT}fixtures/golden/ingest-laws.json`, 'utf8'));

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
function gauss(r: () => number): () => number {
  return () => Math.sqrt(-2 * Math.log(r() + 1e-300)) * Math.cos(2 * Math.PI * r());
}

/** A CameraLinear multiplied by a per-pixel factor field. */
function times(src: CameraLinear, f: (x: number, y: number, c: number) => number): CameraLinear {
  return {
    ...src,
    row: (c, y, out) => {
      src.row(c, y, out);
      for (let x = 0; x < src.width; x++) out[x] = out[x]! * f(x, y, c);
    },
  };
}

describe('flat field (textbook §3.1, §3.9)', () => {
  let src: CameraLinear;
  beforeAll(() => {
    src = openSourceSync(new Uint8Array(readFileSync(GOLD200)), { options: { levels: { black: [32, 32, 32], white: [64032, 64032, 64032] } } }).linear;
  });
  /** Worst |ΔD| over the full-size frame after vignetting by V and dividing by a flat of V with `amp` uniform noise. */
  function flatLaw(amp: number, broken = false, cx = 0.5, cy = 0.5): number {
    const W = src.width, H = src.height;
    const V = (x: number, y: number): number => 10 ** (-laws.flatField.vignetteD * (((x + 0.5) / W - cx) ** 2 + ((y + 0.5) / H - cy) ** 2) / 0.5);
    const scan = times(src, V);
    const u = rng(11);
    const flatCapture = cameraLinearFromInterleaved(W, H, new Float32Array(W * H * 3).map((_, i) => {
      const q = Math.floor(i / 3);
      return 0.8 * V(q % W, Math.floor(q / W)) * (1 + amp * (2 * u() - 1));
    }));
    const F = flatGrid(flatCapture, 'smooth');
    if (cx === 0.5 && cy === 0.5) expect(F.falloffD[1]).toBeCloseTo(0.25, 1);
    expect(checkFlat(F, scan).flat).toBe(F);
    const rebate = { x: 1174, y: 100, w: 20, h: 680 };
    const crop = { x: 76, y: 60, w: 1090, h: 754 };
    const T0 = rebateFromBox(src, rebate).T;
    const T1 = rebateFromBox(scan, rebate, { flat: F }).T;
    const a = region(src, crop, 1090, 754);
    const b = region(scan, crop, 1090, 754, broken ? {} : { flat: F });
    const Fv = new Float64Array(3);
    let worst = 0;
    for (let ty = 0; ty < 754; ty++) for (let tx = 0; tx < 1090; tx++) {
      const i = ty * 1090 + tx;
      // Broken variant: the flat read in oriented coordinates of a frame rotated by 90° (cw90: u' = 1 − v, v' = u).
      if (broken) flatAt(F, 1 - (crop.y + ty + 0.5) / H, (crop.x + tx + 0.5) / W, Fv);
      for (let k = 0; k < 3; k++) {
        const d0 = -Math.log10(a[3 * i + k]! / T0[k]!);
        const d1 = -Math.log10(b[3 * i + k]! / (broken ? Fv[k]! : 1) / T1[k]!);
        worst = Math.max(worst, Math.abs(d1 - d0));
      }
    }
    return worst;
  }
  it('a 0.26 D vignette divided by its own flat returns every density to within 0.0006 D', () => {
    expect(flatLaw(0)).toBeLessThanOrEqual(laws.flatField.maxErrD);
  }, 60_000);
  it('… and with a ±1 % noisy flat to within 0.0007 D (the noise draw of the textbook is not reproducible)', () => {
    expect(flatLaw(laws.flatField.flatNoise)).toBeLessThanOrEqual(laws.flatField.maxErrNoisyD);
  }, 60_000);
  it('broken variant: the flat applied in oriented coordinates of a 90°-rotated frame fails', () => {
    // (a centred radial vignette is symmetric under the rotation, so the light is decentred here)
    expect(flatLaw(laws.flatField.flatNoise, false, 0.4, 0.45)).toBeLessThanOrEqual(laws.flatField.maxErrNoisyD);
    expect(flatLaw(laws.flatField.flatNoise, true, 0.4, 0.45)).toBeGreaterThan(0.01);
  }, 60_000);
  it('a flat of a different aspect is refused with W_FLAT_SHAPE, not silently ignored', () => {
    const F = flatGrid(cameraLinearFromInterleaved(10, 10, new Float32Array(300).fill(0.5)));
    const r = checkFlat(F, { width: 20, height: 10 });
    expect(r.flat).toBeNull();
    expect(r.notes[0]!.code).toBe('W_FLAT_SHAPE');
  });
});

describe('flare (textbook §3.1, §3.7)', () => {
  it('f = 0.5 % reproduces the wedge readings', () => {
    laws.flare.steps.forEach((d: number, i: number) => expect(wedgeReading(d, laws.flare.f)).toBeCloseTo(laws.flare.readings[i], 3));
  });
  it('fits f from the textbook readings and from readings with 0.005 D of noise', () => {
    expect(Math.abs(fitFlareChannel(laws.flare.steps, laws.flare.readings) - laws.flare.f)).toBeLessThan(1e-4);
    const g = gauss(rng(3));
    const fits: number[] = [];
    for (let trial = 0; trial < 20; trial++) {
      const readings = laws.flare.steps.map((d: number, i: number) => ({
        nominalD: d,
        Dmeas: [0, 1, 2].map(() => wedgeReading(d, laws.flare.f) + (i ? laws.flare.noiseD * g() : 0)) as Vec3,
      }));
      fits.push(...fitFlare(readings).f);
    }
    fits.sort((a, b) => a - b);
    expect(Math.abs(fits[fits.length >> 1]! - laws.flare.f)).toBeLessThan(laws.flare.fitTol);
  });
  it('fits per-channel f with a shared density scale; a negative f is reported, not clamped', () => {
    const readings = laws.flare.steps.map((d: number) => ({ nominalD: d, Dmeas: [0.002, 0.005, 0.01].map((f) => wedgeReading(d, f, 0.97)) as Vec3 }));
    const fit = fitFlare(readings, { fitScale: true });
    fit.f.forEach((v, k) => expect(v).toBeCloseTo([0.002, 0.005, 0.01][k]!, 5));
    expect(fit.q).toBeCloseTo(0.97, 5);
    const neg = fitFlare(laws.flare.steps.map((d: number) => ({ nominalD: d, Dmeas: [d * 1.02, d * 1.02, d * 1.02] as Vec3 })));
    expect(neg.f[0]).toBeLessThan(0);
    expect(neg.notes[0]!.code).toBe('RANGE');
  });
  it('flare removal through region: T = T′(1 + f) − f restores the wedge', () => {
    const f = 0.005;
    const d = [0, 1, 2, 3];
    const data = new Float32Array(d.length * 3);
    d.forEach((v, i) => { for (let k = 0; k < 3; k++) data[3 * i + k] = 0.8 * (10 ** -v + f) / (1 + f); });
    const out = region(cameraLinearFromInterleaved(d.length, 1, data), { x: 0, y: 0, w: d.length, h: 1 }, d.length, 1, { openGate: [0.8, 0.8, 0.8], flare: f });
    d.forEach((v, i) => expect(-Math.log10(out[3 * i]!)).toBeCloseTo(v, 4));
  });
});

describe('σ estimator (textbook §1.7)', () => {
  const N = 1024;
  let white: Float32Array;
  beforeAll(() => {
    const g = gauss(rng(5));
    white = new Float32Array(N * N * 3).map(() => 10 ** (-0.01 * g()));
  });
  /** Neighbour differences / √2 with a MAD — the broken alternative. */
  const neighbour = (rgb: Float32Array, w: number, h: number): number => {
    const d: number[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x + 1 < w; x += 2) d.push((-Math.log10(rgb[3 * (y * w + x + 1)]!) + Math.log10(rgb[3 * (y * w + x)]!)) / Math.SQRT2);
    return madSigma(d);
  };
  it('the 9×9 leave-one-out local mean stays within 4 % at every reduction; neighbour differences fail at 0.7', () => {
    const src = cameraLinearFromInterleaved(N, N, white);
    for (const r of laws.footprint.reductions as number[]) {
      const n = Math.round(N * r);
      const img = region(src, { x: 0, y: 0, w: N, h: N }, n, n, { channels: 3 });
      let s = 0, s2 = 0;
      for (let i = 0; i < n * n; i++) { const v = -Math.log10(img[3 * i]!); s += v; s2 += v * v; }
      const truth = Math.sqrt(s2 / (n * n) - (s / (n * n)) ** 2);
      const est = sigmaD(img, n, n, [1, 1, 1])![0] / truth;
      expect(Math.abs(est - (r === 1 ? 1.0062 : 1))).toBeLessThan(laws.footprint.localMeanTol);
      if (r === 0.7) expect(Math.abs(neighbour(img, n, n) / truth - laws.footprint.neighbourAt07)).toBeLessThan(0.03);
    }
  }, 60_000);
  it('MAD: one sample at 50σ among 81 barely moves the MAD estimate; the standard deviation follows it', () => {
    const g = gauss(rng(17));
    const x = Array.from({ length: 81 }, g);
    const sd = (a: number[]): number => { const m = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)); };
    const before = [sd(x), madSigma(x)];
    x[40] = 50;
    const after = [sd(x), madSigma(x)];
    expect(after[0]! / before[0]!).toBeGreaterThan(4);
    expect(Math.abs(after[1]! / before[1]! - 1)).toBeLessThan(0.06);
  });
});


describe('open gate (guide §5.7)', () => {
  it('finds sprocket-hole pixels with the light\'s colour; rejects bright orange film; W_NO_OPEN_GATE otherwise', () => {
    const w = 120, h = 80;
    const light: Vec3 = [0.9, 0.95, 0.8];
    const data = new Float32Array(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) {
      const hole = x >= 110 && y % 20 < 8;
      data[(y * w + x) * 3 + k] = hole ? light[k]! : light[k]! * [0.5, 0.2, 0.1][k]! * (x < 100 ? 0.3 : 1);
    }
    const src = cameraLinearFromInterleaved(w, h, data);
    const g = detectOpenGate(src, { lightRatio: light });
    expect(g.from).toBe('capture');
    g.T!.forEach((v, k) => expect(v).toBeCloseTo(light[k]!, 4));
    const noHoles = cameraLinearFromInterleaved(w, h, data.map((v, i) => (Math.floor(i / 3) % w >= 110 ? data[i - 30]! : v)));
    const none = detectOpenGate(noHoles, { lightRatio: light });
    expect(none.T).toBeNull();
    expect(none.notes[0]!.code).toBe('W_NO_OPEN_GATE');
  });
});


