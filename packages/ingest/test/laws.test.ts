// Stage 3 laws (guide §8.2, §8.4): flat field, flat wedge, base relativity, flare fit, σ estimator
// properties, MAD robustness, stock ranking and the conditioning map — each with a broken variant.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Vec3 } from '@chromobench/contract';
import {
  baseCheck, cameraLinearFromInterleaved, checkFlat, conditioningMap, detectOpenGate, fitFlare, fitFlareChannel, flatAt, flatGrid,
  gaussian, madSigma, makeScannerForward, normaliseChannels, openSourceSync, readChannels, rankStocks, rebateAbsoluteD,
  rebateFromBox, region, sigmaAt, sigmaD, sigmaTable, wedgeReading, type CameraLinear, type StockSpectra,
} from '@chromobench/ingest';
import { C1, GOLD200, ROOT } from './chromogen.ts';

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

// Real stock data from Chromogen's bundle and the guide's illustrative X-T5 scanner.
const stockIds = Object.keys(laws.stockBases.D);
let fwd: ReturnType<typeof makeScannerForward>;
let P: [number[], number[], number[]];
let stocks: Record<string, StockSpectra>;
beforeAll(() => {
  const dir = `${C1}/various/extracted/chromogen-studio/st-data/cg`;
  const cam = JSON.parse(readFileSync(`${dir}/cameras/generic-bayer.json`, 'utf8'));
  const leds = [678, 532, 472].map((c) => gaussian(cam.wl, c, 20));
  P = (['R', 'G', 'B'] as const).map((k, i) => (cam[k] as number[]).map((v, j) => v * leds[i]![j]!)) as typeof P;
  stocks = {};
  for (const id of stockIds) {
    const d = JSON.parse(readFileSync(`${dir}/stocks/${id}.json`, 'utf8')).data;
    const z = (v: number | null): number => v ?? 0; // missing samples below 400 nm: no density
    stocks[id] = { base: d.base_density.map(z), dyes: [0, 1, 2].map((k) => d.channel_density.map((r: (number | null)[]) => z(r[k]!))) as StockSpectra['dyes'] };
  }
  fwd = makeScannerForward('xt5-rgb-led', P, stocks);
});

describe('channel laws (textbook §1.9, §3.7)', () => {
  it('a flat wedge step of 1.234 D reads 1.234 in every channel', () => {
    for (const p of [P, normaliseChannels([gaussian(P[0].map((_, i) => 380 + 5 * i), 600, 80), P[1], P[2]])]) {
      readChannels(normaliseChannels(p), new Array(p[0].length).fill(laws.flatWedge.d)).forEach((v) => expect(Math.abs(v - laws.flatWedge.d)).toBeLessThan(laws.flatWedge.tol));
    }
  });
  it('base relativity: read(P, D + b) − read(P, b) = read(relativeTo(P, b), D)', () => {
    const Pn = normaliseChannels(P);
    const b = stocks.kodak_gold_200!.base;
    const D = b.map((_, i) => 0.7 * stocks.kodak_gold_200!.dyes[0][i]! + 0.3 * stocks.kodak_gold_200!.dyes[2][i]!);
    const lhs = readChannels(Pn, D.map((v, i) => v + b[i]!)).map((v, k) => v - readChannels(Pn, b)[k]!);
    const rel = normaliseChannels(Pn.map((p) => p.map((v, i) => v * 10 ** -b[i]!)) as typeof P);
    const rhs = readChannels(rel, D);
    lhs.forEach((v, k) => expect(Math.abs(v - rhs[k]!)).toBeLessThan(laws.baseRelativity.tol));
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

describe('stock ranking and the base check (guide §2.3, §5.8)', () => {
  it('bases read through the X-T5 LED scanner match the guide table', () => {
    for (const id of stockIds) fwd.readBase(id).forEach((v, k) => expect(Math.abs(v - laws.stockBases.D[id][k])).toBeLessThan(laws.stockBases.tol));
  });
  it('ranks Gold 200 first, C200 0.020 D away; consistent ≤ 0.02 D', () => {
    const r = rankStocks(fwd.readBase('kodak_gold_200'), stockIds, fwd);
    expect(r[0]!.stock).toBe('kodak_gold_200');
    expect(r[1]!.stock).toBe('fujifilm_c200');
    for (const x of r.slice(1)) expect(Math.abs(x.maxDiffD - laws.stockBases.maxDiffFromGold[x.stock])).toBeLessThan(0.001);
    expect(r.filter((x) => x.consistent).map((x) => x.stock)).toContain('kodak_gold_200');
    // shapeDiff survives an unknown common factor in the open gate
    const shifted = rankStocks(fwd.readBase('kodak_gold_200').map((v) => v + 0.1) as Vec3, stockIds, fwd);
    expect(shifted[0]!.consistent).toBe(false);
    expect(Math.min(...shifted.map((x) => x.shapeDiffD))).toBeLessThan(1e-9);
  });
  it('the base check warns above 0.02 D; without an open gate there is nothing to check', () => {
    const base = fwd.readBase('kodak_gold_200');
    const open: Vec3 = [0.9, 0.95, 0.85];
    const T = base.map((d, k) => open[k]! * 10 ** -d) as Vec3;
    expect(baseCheck(T, open, 'kodak_gold_200', fwd)!.warn).toBe(false);
    const wrong = baseCheck(T, open, 'kodak_portra_400', fwd)!;
    expect(wrong.warn).toBe(true);
    expect(wrong.notes[0]!.code).toBe('W_BASE_MISMATCH');
    expect(baseCheck(T, null, 'kodak_gold_200', fwd)).toBeNull();
    expect(rebateAbsoluteD(T, null)).toBeNull();
    // Gold 200's sample has no open gate: its counts-scale "rebate" bears no relation to any stock (guide §2.3).
    const naive = rebateAbsoluteD([0.1205, 0.6793, 0.2139], [1, 1, 1])!;
    naive.forEach((v, k) => expect(v).toBeCloseTo([0.919, 0.168, 0.670][k]!, 3));
    expect(rankStocks(naive, stockIds, fwd).some((x) => x.consistent)).toBe(false);
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

describe('conditioning map (textbook §3.2)', () => {
  it('σ₃ table, trilinear reads, gain map and the ill-conditioned share', () => {
    const t = sigmaTable(fwd, 'kodak_gold_200', 9, 2.6);
    expect(sigmaAt(t, 1.3, 0, 2.6)).toBeCloseTo(fwd.sigmaMin('kodak_gold_200', [1.3, 0, 2.6]), 6);
    expect(Math.abs(sigmaAt(t, 0.5, 0.5, 0.5) / fwd.sigmaMin('kodak_gold_200', [0.5, 0.5, 0.5]) - 1)).toBeLessThan(0.02);
    const dyes = new Float32Array([0.5, 0.5, 0.5, 1, 1, 1, 0, 0, 2.4]);
    const { gain, summary } = conditioningMap(t, dyes, 3, 1);
    expect(gain[0]).toBeCloseTo(1 / sigmaAt(t, 0.5, 0.5, 0.5), 5);
    expect(summary.size).toEqual([3, 1]);
    // Narrowband LEDs barely amplify noise; a degenerate forward model is flagged.
    expect(summary.illConditioned).toBe(0);
    const flatDyes: StockSpectra = { base: stocks.kodak_gold_200!.base, dyes: [stocks.kodak_gold_200!.dyes[0], stocks.kodak_gold_200!.dyes[0], stocks.kodak_gold_200!.dyes[2]] };
    const bad = makeScannerForward('degenerate', P, { x: flatDyes });
    const r = conditioningMap(sigmaTable(bad, 'x', 5), dyes, 3, 1);
    expect(r.summary.illConditioned).toBe(1);
    expect(r.summary.notes[0]!.code).toBe('W_ILL_CONDITIONED');
  });
});

