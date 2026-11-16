// CHB-012 stage 1: spectral upsampling and exposure (guide §8.1; LFP ch. 1; textbook §1.8, §2.1).
// Two oracles: the guide's printed numbers (tol 0.6·10^−k) and spektrafilm's own values
// (fixtures/golden/film/spektrafilm-forward.json). The hanatos2025 table is an on-demand pack file:
// the tests that need it are skipped when it is absent.
import { existsSync, readFileSync } from 'node:fs';
import { openPackFromDisk } from '@chromobench/data/node';
import { cat16, xyToXYZ } from '@chromobench/contract';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  autoExposureEV, buildFilmTable, D65, erf4Window, filmTableFromLog2, nodePacksData, lookupBilinear, lookupCubic, makeExposer, makeFilmModel,
  mulMM, mulMV, quad2tri, rawOfLinearSRGB, resampleFilmTable, resolveStock, sigmoidSpectraTable, spdXY, spectraFromF16, spectralLocus, SPEKTRAFILM,
  SRGB_TO_XYZ, tri2quad, windowNormalisers, compressXY, midgrayFilmDensity, mulberryish, type FilmModel, type FilmTable, type SpectraTable,
} from './film-helpers.ts';

const SF = JSON.parse(readFileSync(new URL('../../../fixtures/golden/film/spektrafilm-forward.json', import.meta.url), 'utf8'));
const data = nodePacksData();
const portra = resolveStock(data.stock('kodak_portra_400'), SPEKTRAFILM);
const UPS = new URL('../../data/packs/spektrafilm@0.3.2+3bb2c2d/upsampling/hanatos2025-irradiance-xy-tc.safetensors', import.meta.url);
const haveHanatos = existsSync(UPS);
let hanatos: SpectraTable | undefined;
let film: FilmModel | undefined;

beforeAll(async () => {
  if (!haveHanatos) return;
  hanatos = spectraFromF16(await openPackFromDisk('spektrafilm@0.3.2+3bb2c2d').upsamplingTable());
  film = makeFilmModel(data, portra, hanatos);
}, 120_000);

const near = (a: ArrayLike<number>, b: ArrayLike<number>, tol: number): void => {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) expect(Math.abs(a[i]! - b[i]!), `[${i}] ${a[i]} vs ${b[i]}`).toBeLessThanOrEqual(tol);
};
const D55 = (): [number, number, number] => { const [x, y] = spdXY(data.illuminant('D55'), data.cmf()); return xyToXYZ(x, y); };
const MRED = [0.5606, 0.0807, 0.1143];

describe('stage 1: square coordinates (LFP §1.4, textbook §1.8)', () => {
  it('moderate red lands at (0.2588, 0.6303), (49.43, 120.39) at 192 and (16.30, 39.71) at 64', () => {
    const [u, v] = tri2quad(0.4913, 0.3207);
    // inputs rounded to four decimals: v = 0.3207/0.5087 = 0.63043
    near([u, v], [0.2588, 0.6303], 2e-4);
    near([u * 191, v * 191], [49.43, 120.39], 0.03);
    near([u * 63, v * 63], [16.30, 39.71], 0.01);
  });
  it('round trip is exact to rounding inside the triangle', () => {
    let worst = 0;
    const r = mulberryish(7);
    for (let i = 0; i < 2000; i++) {
      const x = r() * 0.999, y = r() * (1 - x);
      const [u, v] = tri2quad(x, y);
      const [x2, y2] = quad2tri(u, v);
      worst = Math.max(worst, Math.abs(x2 - x), Math.abs(y2 - y));
    }
    expect(worst).toBeLessThan(1e-15);
  });
});

describe('stage 1: CAT16 and moderate red (LFP §1.2)', () => {
  it('k = 1/Σȳ = 0.046792', () => {
    expect(1 / data.cmf()[1].reduce((a, b) => a + b, 0)).toBeCloseTo(0.046792, 5);
  });
  it('M_D55 reproduces the guide within 1e-4 and spektrafilm within 2e-4', () => {
    const M = mulMM(cat16(D65, D55()), SRGB_TO_XYZ);
    near(M.flat(), [0.4197, 0.3744, 0.1628, 0.2131, 0.7137, 0.0732, 0.0150, 0.0965, 0.8099], 1e-4);
    near(M.flat(), (SF.M_sRGB_D55 as number[][]).flat(), 2e-4);
    near(spdXY(data.illuminant('D55'), data.cmf()), SF.refXY, 1e-9);
  });
  it('moderate red: XYZ (0.2841, 0.1854, 0.1087), b 0.5783, xy (0.4913, 0.3207)', () => {
    const X = mulMV(mulMM(cat16(D65, D55()), SRGB_TO_XYZ), MRED);
    near(X, [0.2841, 0.1854, 0.1087], 1e-4);
    const b = X[0] + X[1] + X[2];
    expect(b).toBeCloseTo(0.5783, 4);
    near([X[0] / b, X[1] / b], [0.4913, 0.3207], 1e-4);
  });
});

describe('stage 1: the band-pass window (LFP §1.5, textbook §1.8)', () => {
  it('Portra 400 window values', () => {
    const w = erf4Window(portra.data.window!);
    const at = (nm: number): number => w[(nm - 380) / 5]!;
    near([at(400), at(445), at(550), at(645), at(700)], [0.144, 0.632, 0.735, 0.225, 0.060], 6e-4);
    expect(Math.abs(at(500) - 0.90)).toBeLessThan(0.006);
    for (const [nm, v] of Object.entries(SF.window.at as Record<string, number>)) expect(Math.abs(at(Number(nm)) - v)).toBeLessThan(1e-9);
  });
  it('normalisers under 5,500 K (0.336, 0.739, 0.480) and centroid shifts', () => {
    const w = erf4Window(portra.data.window!);
    const E = data.illuminant('bb5500');
    near(windowNormalisers(portra.sens, w, E), [0.336, 0.739, 0.480], 6e-4);
    // centroids of the sensitivity itself, bare and windowed (no illuminant)
    const centroid = (k: number, win: boolean): number => {
      let a = 0, b = 0;
      for (let i = 0; i < 81; i++) { const s = portra.sens[k]![i]! * (win ? w[i]! : 1); a += s * (380 + 5 * i); b += s; }
      return a / b;
    };
    near([centroid(0, false), centroid(0, true), centroid(2, false), centroid(2, true)], [624.2, 612.5, 430.8, 447.2], 0.06);
  });
  it('law: the window keeps the reference illuminant\'s exposures', () => {
    const w = erf4Window(portra.data.window!);
    const E = data.illuminant('D55');
    const n = windowNormalisers(portra.sens, w, E);
    for (let k = 0; k < 3; k++) {
      let a = 0, b = 0;
      for (let i = 0; i < 81; i++) { a += (portra.sens[k]![i]! * w[i]! / n[k]!) * E[i]!; b += portra.sens[k]![i]! * E[i]!; }
      expect(a / b).toBeCloseTo(1, 12);
      // mutant: skip the renormalisation
      let c = 0;
      for (let i = 0; i < 81; i++) c += portra.sens[k]![i]! * w[i]! * E[i]!;
      expect(Math.abs(c / b - 1)).toBeGreaterThan(0.2);
    }
  });
});

describe('stage 1: input gamut compression (spektrafilm compress_xy_radial)', () => {
  it('matches spektrafilm on five chromaticities', () => {
    const loc = spectralLocus(data.cmf());
    const white = SF.refXY as [number, number];
    (SF.compressXY.in as [number, number][]).forEach((xy, i) => near(compressXY(xy[0], xy[1], white, loc), SF.compressXY.out[i], 2e-4));
  });
});

describe('stage 1: Filmbench 64² table (LFP §1.5)', () => {
  const fb = openPackFromDisk('interim-filmbench@1').stockSync('kodak_portra_400');
  const t: FilmTable = filmTableFromLog2(64, fb.raw['film_exposure_lut64_log2']!.data);
  it('moderate red: log₂ entry (2.116, −0.131, 0.255) and raw (2.506, 0.528, 0.690)', () => {
    const [u, v] = tri2quad(0.4913, 0.3207);
    const e = lookupBilinear({ n: 64, raw: Float64Array.from(fb.raw['film_exposure_lut64_log2']!.data) }, u, v);
    near(e, [2.116, -0.131, 0.255], 0.002);
    const raw = Array.from(lookupBilinear(t, u, v), (r) => r * 0.5783);
    near(raw, [2.506, 0.528, 0.690], 0.003);
    near(raw.map((r) => Math.log2(r)), [1.33, -0.92, -0.54], 0.006);
  });
});

describe.skipIf(!haveHanatos)('stage 1: the hanatos2025 192² table against spektrafilm', () => {
  it('film-table nodes equal spektrafilm\'s tc_lut (window + compression, window only, bare)', () => {
    const f = film!;
    for (const [i, j, v] of SF.tcLut['window+compress'] as [number, number, number[]][]) near(f.table.raw.subarray((i * 192 + j) * 3, (i * 192 + j) * 3 + 3), v, 1e-9 + 1e-6 * Math.max(...v));
    const bare = buildFilmTable(hanatos!, { sens: portra.sens, window: null, refIlluminant: data.illuminant('D55') });
    for (const [i, j, v] of SF.tcLut.bare as [number, number, number[]][]) near(bare.raw.subarray((i * 192 + j) * 3, (i * 192 + j) * 3 + 3), v, 1e-6 * Math.max(...v));
  });
  it('raw of nine colours equals spektrafilm (1e-5 stops with its matrix)', () => {
    // spektrafilm's own sRGB → XYZ(D55) matrix (colour-science whites), so only the table and lookup are compared
    const ex = makeExposer(film!.table, { adapt: 'none', sourceWhite: D65, refWhite: film!.refWhite, ev: 0, interp: 'cubic' });
    for (const [name, e] of Object.entries(SF.raw as Record<string, { rgb: number[]; raw: number[] }>)) {
      const r = ex.raw(mulMV(SF.M_sRGB_D55, e.rgb));
      for (let k = 0; k < 3; k++) expect(Math.abs(Math.log2(r[k]! / e.raw[k]!)), `${name}[${k}]`).toBeLessThan(1e-5);
      // with core's whites (D65 = 0.95047, 1, 1.08883): within 2e-3 stops
      const r2 = rawOfLinearSRGB(film!, e.rgb);
      for (let k = 0; k < 3; k++) expect(Math.abs(Math.log2(r2[k]! / e.raw[k]!)), `${name}[${k}]`).toBeLessThan(2e-3);
    }
  });
  it('guide numbers: moderate red raw (2.506, 0.528, 0.690), grey (1.012, 0.989, 0.918), bare (2.933, 0.604, 1.145)', () => {
    near(rawOfLinearSRGB(film!, MRED), [2.506, 0.528, 0.690], 0.0015);
    near(rawOfLinearSRGB(film!, [0.184, 0.184, 0.184]), [1.012, 0.989, 0.918], 0.0012);
    const bare = makeFilmModel(data, { ...portra, data: { ...portra.data, window: undefined as never } }, hanatos!);
    near(rawOfLinearSRGB(bare, MRED), [2.933, 0.604, 1.145], 0.02);
  });
  it('grey vs D55 spectrum: +0.018, −0.015, −0.124 stops', () => {
    const g = rawOfLinearSRGB(film!, [0.184, 0.184, 0.184]);
    near(Array.from(g, (v) => Math.log2(v)), [0.018, -0.015, -0.124], 0.0015);
  });
  it('mid-grey density for the print normalisation sits at log H (0.005, −0.005, −0.037)', () => {
    const g = rawOfLinearSRGB(film!, [0.184, 0.184, 0.184]);
    near(Array.from(g, (v) => Math.log10(v)), [0.005, -0.005, -0.037], 6e-4);
    expect(midgrayFilmDensity(film!).length).toBe(81);
  });
  it('table-error table: 64² from 192² vs 192², in stops over 2,000 random sRGB colours', () => {
    const small = resampleFilmTable(film!.table, 64);
    const r = mulberryish(3);
    const errs: number[] = [];
    const M = mulMM(cat16(D65, film!.refWhite), SRGB_TO_XYZ);
    const px = new Float64Array(3), py = new Float64Array(3);
    for (let i = 0; i < 2000; i++) {
      const X = mulMV(M, [r(), r(), r()]);
      const b = X[0] + X[1] + X[2];
      const [u, v] = tri2quad(X[0] / b, X[1] / b);
      lookupCubic(film!.table, u, v, 3, px);
      lookupCubic(small, u, v, 3, py);
      for (let k = 0; k < 3; k++) errs.push(Math.abs(Math.log2(py[k]! / px[k]!)));
    }
    errs.sort((a, b) => a - b);
    const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
    expect(mean).toBeLessThan(0.003);
    expect(errs[Math.floor(0.99 * errs.length)]!).toBeLessThan(0.012);
  });
  it('core\'s sigmoid-fit fallback stays near hanatos2025 for in-gamut sRGB (reported, bounded)', () => {
    const sig = makeFilmModel(data, portra, sigmoidSpectraTable(data.cmf(), 64));
    const r = mulberryish(5);
    const errs: number[] = [];
    for (let i = 0; i < 500; i++) {
      const c = [r(), r(), r()];
      const a = rawOfLinearSRGB(film!, c), b = rawOfLinearSRGB(sig, c);
      for (let k = 0; k < 3; k++) errs.push(Math.abs(Math.log2(b[k]! / a[k]!)));
    }
    const mean = errs.reduce((x, y) => x + y, 0) / errs.length;
    expect(mean).toBeLessThan(0.15);
    // neutrals agree closely (both are smooth near the white)
    const g1 = rawOfLinearSRGB(film!, [0.184, 0.184, 0.184]), g2 = rawOfLinearSRGB(sig, [0.184, 0.184, 0.184]);
    for (let k = 0; k < 3; k++) expect(Math.abs(Math.log2(g2[k]! / g1[k]!))).toBeLessThan(0.05);
  });
});

describe('stage 1: exposure laws (§2.1, §2.8)', () => {
  const sig = makeFilmModel(data, portra, sigmoidSpectraTable(data.cmf(), 32));
  it('linear in brightness: doubling XYZ doubles raw; flat patches 90 % → +0.689, 3 % → −0.788 log H vs 18.4 %', () => {
    const r1 = rawOfLinearSRGB(sig, [0.2, 0.3, 0.1]), r2 = rawOfLinearSRGB(sig, [0.4, 0.6, 0.2]);
    for (let k = 0; k < 3; k++) expect(r2[k]! / r1[k]!).toBeCloseTo(2, 12);
    const g = rawOfLinearSRGB(sig, [0.184, 0.184, 0.184]);
    const w = rawOfLinearSRGB(sig, [0.9, 0.9, 0.9]), b = rawOfLinearSRGB(sig, [0.03, 0.03, 0.03]);
    for (let k = 0; k < 3; k++) {
      expect(Math.log10(w[k]! / g[k]!)).toBeCloseTo(0.689, 3);
      expect(Math.log10(b[k]! / g[k]!)).toBeCloseTo(-0.788, 3);
    }
  });
  it('shifts compose: expose(EV₁) then +EV₂ = expose(EV₁ + EV₂)', () => {
    const a = rawOfLinearSRGB(sig, MRED, { ev: 0.7 }), b = rawOfLinearSRGB(sig, MRED, { ev: 1.2 });
    for (let k = 0; k < 3; k++) expect(Math.log2(b[k]! / a[k]!)).toBeCloseTo(0.5, 12);
  });
});

describe('stage 1: auto exposure (spektrafilm utils/autoexposure.py)', () => {
  it('a weighted mean of 0.092 is pushed up one stop (textbook §2.1)', () => {
    expect(autoExposureEV(new Float64Array(12).fill(0.092), 4, 3, 'center_weighted')).toBeCloseTo(1, 12);
  });
  it('all seven methods match spektrafilm on the synthetic image', () => {
    const w = 40, h = 30;
    const Y = new Float64Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const R = 0.05 + (0.5 * x) / w, G = 0.1 + (0.3 * y) / h, B = 0.2 + (0.2 * ((x + y) % 7)) / 7;
      Y[y * w + x] = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
    }
    for (const [m, ev] of Object.entries(SF.autoexposure.ev as Record<string, number>)) expect(Math.abs(autoExposureEV(Y, w, h, m as never) - ev), m).toBeLessThan(1e-4);
  });
});
