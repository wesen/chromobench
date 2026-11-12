// CHB-012 stage 3: scatter, halation and grain (guide §2.7–2.8, §8.1–8.2; textbook §2.4–2.5).
import { describe, expect, it } from 'vitest';
import {
  applyHalation, applyHalationLinear, crystals, edgeResponse, FilmCurves, grainDraw, grainHalo, grainImage, grainSpec, halationForStock, halationKernel,
  nodePacksData, KeyedUniforms, pcg4d, poisson, resolveStock, rmsGranularity48, selwynG, SPEKTRAFILM, sublayerSplit, sublayersOf, uniformAt,
} from './film-helpers.ts';

const data = nodePacksData();
const portra = resolveStock(data.stock('kodak_portra_400'), SPEKTRAFILM);
const f = FilmCurves.ofStock(portra);
const hal = halationForStock(portra);

describe('stage 3: halation (§2.4)', () => {
  it('the red kernel is 16 Gaussians, 98.5 % scatter and 1.5 % halation', () => {
    const K = halationKernel(hal, 0);
    expect(K.length).toBe(16);
    expect(K.reduce((a, g) => a + g.w, 0)).toBeCloseTo(1, 12);
    const halo = K.filter((g) => g.sigma_um > 30).reduce((a, g) => a + g.w, 0);
    expect(halo).toBeCloseTo(0.015 / 1.015, 6);
  });
  it('edge +2.5 → −1.0: dark-side cyan 0.157 → 0.895 (50 µm), 0.573 (100), 0.244 (200); weak 0.898, none 1.173 at 100', () => {
    const cy = (r: number, s = hal): number => f.at(0, edgeResponse(s, 0, 2.5, -1, r));
    expect(f.at(0, -1)).toBeCloseTo(0.157, 3);
    // within 0.0015 of the textbook (its curve interpolation differs in the last digit: 0.5742, 0.2449 here)
    expect(Math.abs(cy(50) - 0.895)).toBeLessThan(0.0015);
    expect(Math.abs(cy(100) - 0.573)).toBeLessThan(0.0015);
    expect(Math.abs(cy(200) - 0.244)).toBeLessThan(0.0015);
    expect(cy(224) - 0.157).toBeGreaterThan(0.05);
    expect(cy(240) - 0.157).toBeLessThan(0.05);
    expect(Math.abs(cy(100, halationForStock(portra, { antihalation: 'weak' })) - 0.898)).toBeLessThan(0.0015);
    expect(Math.abs(cy(100, halationForStock(portra, { antihalation: 'no' })) - 1.173)).toBeLessThan(0.0015);
  });
  it('Jensen at 50 µm: log10(K∗E) = +0.404 against K∗log10 E = −0.973; density-domain excess 0.013', () => {
    const K = halationKernel(hal, 0);
    const frac = (r: number): number => K.reduce((a, g) => a + g.w * (g.sigma_um > 0 ? 0.5 * (1 + erfApprox(-r / g.sigma_um / Math.SQRT2)) : 0), 0);
    expect(edgeResponse(hal, 0, 2.5, -1, 50)).toBeCloseTo(0.404, 3);
    expect(-1 + 3.5 * frac(50)).toBeCloseTo(-0.973, 3);
    expect(Math.abs((f.at(0, 2.5) - f.at(0, -1)) * frac(50) - 0.013)).toBeLessThan(0.001);
  });
  it('law: the image op matches the exact edge response, keeps uniform fields and obeys Jensen; the log-domain mutant fails', () => {
    const w = 160, h = 8, um = 2.5;
    const u = new Float64Array(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) u[(y * w + x) * 3 + k] = x < w / 2 ? 2.5 : -1;
    const out = applyHalation(u, w, h, um, hal);
    // the edge lies between pixels 79 and 80: pixel 100 is at 20.5 px = 51.25 µm
    expect(Math.abs(out[(4 * w + 100) * 3]! - edgeResponse(hal, 0, 2.5, -1, 20.5 * um))).toBeLessThan(2e-3);
    const flat = applyHalation(new Float64Array(30 * 30 * 3).fill(0.3), 30, 30, um, hal);
    for (const v of flat) expect(v).toBeCloseTo(0.3, 9);
    // Jensen: log10(K∗E) ≥ K∗log10 E pointwise; the mutant convolves u directly and lands on the right side only
    const mutant = applyHalationLog(u, w, h, um);
    let gap = 0;
    for (let i = 0; i < out.length; i++) {
      expect(out[i]!).toBeGreaterThanOrEqual(mutant[i]! - 1e-9);
      gap = Math.max(gap, out[i]! - mutant[i]!);
    }
    expect(gap).toBeGreaterThan(1);
  });
  it('law: an exposure scale commutes with halation (normalised kernel)', () => {
    const w = 40, h = 30, um = 3;
    const u = Float64Array.from({ length: w * h * 3 }, (_, i) => Math.sin(i * 0.37) * 1.5);
    const a = applyHalation(u.map((v) => v + 0.3), w, h, um, hal);
    const b = applyHalation(u, w, h, um, hal).map((v) => v + 0.3);
    for (let i = 0; i < a.length; i++) expect(Math.abs(a[i]! - b[i]!)).toBeLessThan(1e-9);
  });
});

/** The mutant: the same kernel applied to log exposures. */
function applyHalationLog(u: Float64Array, w: number, h: number, um: number): Float64Array {
  return applyHalationLinear(u, w, h, um, hal);
}

function erfApprox(x: number): number {
  // erf through the normal CDF used by edgeResponse's own erf (paper.ts)
  const t = 1 / (1 + 0.5 * Math.abs(x));
  const r = t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? 1 - r : r - 1;
}

describe('stage 3: counter-based random numbers', () => {
  it('pcg4d is deterministic and keyed; uniforms are 24-bit in [0, 1)', () => {
    const a = pcg4d(Uint32Array.of(1, 2, 3, 4));
    const b = pcg4d(Uint32Array.of(1, 2, 3, 4));
    expect([...a]).toEqual([...b]);
    // the Jarzynski & Olano listing, recomputed independently (Python, 32-bit wrap-around) for the diary
    expect([...pcg4d(Uint32Array.of(0, 0, 0, 0))]).toEqual([251852841, 760645481, 850445371, 3542436074]);
    let s = 0;
    for (let i = 0; i < 20000; i++) {
      const u = uniformAt(i % 137, Math.floor(i / 137), 5, 9, i % 6);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      expect(u * 2 ** 24).toBe(Math.floor(u * 2 ** 24));
      s += u;
    }
    expect(Math.abs(s / 20000 - 0.5)).toBeLessThan(0.01);
  });
  it('Poisson: mean and variance over λ in both branches; a rounded normal at 30 would be caught', () => {
    const U = new KeyedUniforms();
    for (const lam of [0.3, 4, 29.5, 30.5, 120, 2000]) {
      const n = 40000;
      let m = 0, v = 0;
      const xs: number[] = [];
      for (let i = 0; i < n; i++) { U.reset(i, 7, 3, 11); xs.push(poisson(lam, U)); }
      for (const x of xs) m += x;
      m /= n;
      for (const x of xs) v += (x - m) ** 2;
      v /= n - 1;
      expect(Math.abs(m - lam), `mean λ=${lam}`).toBeLessThan(4 * Math.sqrt(lam / n));
      expect(Math.abs(v / lam - 1), `var λ=${lam}`).toBeLessThan(0.04);
    }
    // the PTRS branch matches the Poisson pmf at λ = 30.5 in total variation (≤ 0.01 with 40k draws)
    const lam = 30.5, n = 40000;
    const h = new Map<number, number>();
    for (let i = 0; i < n; i++) { U.reset(i, 1, 1, 5); const k = poisson(lam, U); h.set(k, (h.get(k) ?? 0) + 1); }
    let tv = 0, p = Math.exp(-lam), tvNormal = 0;
    for (let k = 0; k < 120; k++) {
      if (k > 0) p *= lam / k;
      tv += Math.abs((h.get(k) ?? 0) / n - p);
      const q = 0.5 * (1 + erfApprox((k + 0.5 - lam) / Math.sqrt(2 * lam))) - 0.5 * (1 + erfApprox((k - 0.5 - lam) / Math.sqrt(2 * lam)));
      tvNormal += Math.abs(q - p);
    }
    expect(tv / 2).toBeLessThan(0.012);
    expect(tvNormal / 2).toBeGreaterThan(0.012);
  });
});

describe('stage 3: grain (§2.5)', () => {
  const spec = grainSpec();
  const sub = sublayersOf(f, portra.data.sublayerCurves, spec);
  it('the stock has sublayer curves and they sum to the channel curve', () => {
    expect(portra.data.sublayerCurves?.length).toBe(256 * 9);
    for (const d of [0.3, 1, 1.8]) for (let ch = 0 as 0 | 1 | 2; ch < 3; ch++) {
      const s = sublayerSplit(sub, ch, d);
      const dmin = spec.densityMin[ch]!;
      expect(Math.abs(s[0] + s[1] + s[2] - dmin - d)).toBeLessThan(0.02);
    }
  });
  it('RMS granularity at D = 1.0: 9.1, 7.4, 13.8; near D = 0.3 about 11, 10, 17', () => {
    const r = [0, 1, 2].map((k) => rmsGranularity48(sub, spec, k as 0, 1.0));
    expect(Math.abs(r[0]! - 9.1)).toBeLessThan(0.06);
    expect(Math.abs(r[1]! - 7.4)).toBeLessThan(0.06);
    expect(Math.abs(r[2]! - 13.8)).toBeLessThan(0.06);
    const q = [0, 1, 2].map((k) => rmsGranularity48(sub, spec, k as 0, 0.3));
    expect(Math.abs(q[0]! - 11)).toBeLessThan(1);
    expect(Math.abs(q[1]! - 10)).toBeLessThan(1);
    expect(Math.abs(q[2]! - 17)).toBeLessThan(1);
  });
  it('law: one sublayer draw has E = D and Var = (D_max/N)·D·(1 − uD/D_max) (400,000 draws, 1 %)', () => {
    const U = new KeyedUniforms();
    const D = 0.6, dmax = 1.1, N = 12, u = 0.97;
    let m = 0, m2 = 0;
    const n = 400000;
    for (let i = 0; i < n; i++) { U.reset(i % 1000, Math.floor(i / 1000), 2, 3); const x = grainDraw(D, dmax, N, u, U); m += x; m2 += x * x; }
    m /= n;
    const v = m2 / n - m * m;
    const want = (dmax / N) * D * (1 - (u * D) / dmax);
    expect(Math.abs(m - D)).toBeLessThan(3 * Math.sqrt(want / n));
    expect(Math.abs(v / want - 1)).toBeLessThan(0.01);
    // mutant: two independent draws averaged per pixel halves the variance
    let a = 0, a2 = 0;
    for (let i = 0; i < 50000; i++) {
      U.reset(i, 0, 2, 3); const x1 = grainDraw(D, dmax, N, u, U);
      U.reset(i, 1, 2, 3); const x2 = grainDraw(D, dmax, N, u, U);
      const x = (x1 + x2) / 2; a += x; a2 += x * x;
    }
    a /= 50000;
    expect(Math.abs((a2 / 50000 - a * a) / want - 1)).toBeGreaterThan(0.3);
  });
  it('law (Selwyn): G = σ²A does not depend on the pixel size; the unscaled mutant does', () => {
    const G = (um: number, scaleN: boolean): number => {
      const { N } = crystals(sub, spec, um);
      const n0 = crystals(sub, spec, 6).N;
      const D = sublayerSplit(sub, 1, 1.0);
      let v = 0;
      for (let sl = 0; sl < 3; sl++) {
        const Nn = scaleN ? N[sl]![1]! : n0[sl]![1]!;
        v += (sub.dmax[sl]![1]! / Nn) * D[sl]! * (1 - (spec.uniformity[1]! * D[sl]!) / sub.dmax[sl]![1]!);
      }
      return v * um * um;
    };
    expect(G(3, true) / G(12, true)).toBeCloseTo(1, 12);
    expect(G(12, true)).toBeCloseTo(selwynG(sub, spec, 1, 1.0), 9);
    expect(Math.abs(G(3, false) / G(12, false) - 1)).toBeGreaterThan(0.5);
  });
  it('law: tile independence — a padded tile equals the same region of a full render, bit for bit', () => {
    const w = 72, h = 56, um = 6;
    const d = Float64Array.from({ length: w * h * 3 }, (_, i) => 0.4 + 0.6 * Math.abs(Math.sin(i * 0.013)));
    const full = grainImage(d, w, h, { umPerPx: um }, sub, spec);
    const halo = grainHalo(sub, spec, um);
    const tx = 30, ty = 22, tw = 16, th = 12;
    const x0 = tx - halo, y0 = ty - halo, pw = tw + 2 * halo, ph = th + 2 * halo;
    expect(x0).toBeGreaterThanOrEqual(0);
    const pad = new Float64Array(pw * ph * 3);
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) for (let k = 0; k < 3; k++) pad[(y * pw + x) * 3 + k] = d[((y0 + y) * w + x0 + x) * 3 + k]!;
    const tile = grainImage(pad, pw, ph, { umPerPx: um, origin: { x: x0, y: y0 } }, sub, spec);
    let worst = 0;
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) for (let k = 0; k < 3; k++) {
      worst = Math.max(worst, Math.abs(tile[((y + halo) * pw + x + halo) * 3 + k]! - full[((ty + y) * w + tx + x) * 3 + k]!));
    }
    expect(worst).toBeLessThan(1e-12);
  });
  it('law: the grain mean leaves a uniform field unchanged (within Monte Carlo error)', () => {
    const w = 96, h = 96, um = 4;
    for (const D of [0.3, 1.0, 1.8]) {
      const out = grainImage(new Float64Array(w * h * 3).fill(D), w, h, { umPerPx: um }, sub, spec);
      for (let k = 0; k < 3; k++) {
        let m = 0;
        for (let i = 0; i < w * h; i++) m += out[i * 3 + k]!;
        m /= w * h;
        const sigma = Math.sqrt(selwynG(sub, spec, k as 0, D) / (um * um));
        expect(Math.abs(m - D), `D=${D} k=${k}`).toBeLessThan(0.02 + (6 * sigma) / Math.sqrt(w * h));
      }
    }
  });
});
