// CHB-012 stage 2: characteristic curves and DIR coupling (guide §2.5–2.6, §8.1; textbook §2.2–2.3).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  coupleImage, developCoupled, dirForStock, effectiveGamma, FilmCurves, fitParametric, inhibitor, nodePacksData, parametric,
  inv3, parametricInverse, parametricSlope, precorrectedCurves, resolveStock, SPEKTRAFILM, type Mat3,
} from './film-helpers.ts';

const SF = JSON.parse(readFileSync(new URL('../../../fixtures/golden/film/spektrafilm-forward.json', import.meta.url), 'utf8'));
const data = nodePacksData();
const portra = resolveStock(data.stock('kodak_portra_400'), SPEKTRAFILM);
const f = FilmCurves.ofStock(portra);
const dir = dirForStock(portra);
const f0 = precorrectedCurves(f, dir);
const near = (a: ArrayLike<number>, b: ArrayLike<number>, tol: number, what = ''): void => {
  for (let i = 0; i < b.length; i++) expect(Math.abs(a[i]! - b[i]!), `${what}[${i}] ${a[i]} vs ${b[i]}`).toBeLessThanOrEqual(tol);
};

describe('stage 2: curves (§2.2)', () => {
  it('the parametric curve: slope against central differences, Newton inverse to 1e-12', () => {
    const p = { gamma: 0.557, x0: -1.24, D: 1.99, toe: 0.46, shoulder: 0.39, dmin: 0 };
    let worstD = 0, worstI = 0;
    for (let x = -3; x <= 4; x += 0.0137) {
      const h = 1e-5;
      worstD = Math.max(worstD, Math.abs((parametric(p, x + h) - parametric(p, x - h)) / (2 * h) - parametricSlope(p, x)));
      const y = parametric(p, x);
      if (y > 1e-6 && y < p.D - 1e-6) worstI = Math.max(worstI, Math.abs(parametric(p, parametricInverse(p, y)) - y));
    }
    expect(worstD).toBeLessThan(1e-9);
    expect(worstI).toBeLessThan(1e-12);
  });
  it('the Portra 400 fit table (γ, x₀, D, t, s) over −2.5…3.5 log H', () => {
    const want = [
      { gamma: 0.557, x0: -1.24, D: 1.99, toe: 0.46, shoulder: 0.39, rms: 0.009, max: 0.020 },
      { gamma: 0.501, x0: -1.41, D: 1.79, toe: 0.34, shoulder: 0.45, rms: 0.005, max: 0.014 },
      { gamma: 0.586, x0: -1.49, D: 2.16, toe: 0.36, shoulder: 0.41, rms: 0.007, max: 0.016 },
    ];
    for (let k = 0 as 0 | 1 | 2; k < 3; k++) {
      const p = fitParametric(f, k);
      const w = want[k]!;
      expect(Math.abs(p.gamma - w.gamma), `γ${k} ${p.gamma}`).toBeLessThan(0.006);
      expect(Math.abs(p.x0 - w.x0), `x0${k} ${p.x0}`).toBeLessThan(0.02);
      expect(Math.abs(p.D - w.D), `D${k} ${p.D}`).toBeLessThan(0.02);
      expect(Math.abs(p.toe - w.toe), `t${k} ${p.toe}`).toBeLessThan(0.02);
      expect(Math.abs(p.shoulder - w.shoulder), `s${k} ${p.shoulder}`).toBeLessThan(0.02);
      expect(p.rms).toBeLessThan(w.rms + 0.0006);
      expect(p.max).toBeLessThan(w.max + 0.0006);
    }
  });
  it('table slope at the grey card: cyan 0.488 against the fit\'s 0.557', () => {
    expect(f.slope(0, 0, 0.1)).toBeCloseTo(0.488, 2);
  });
  it('the table inverse round-trips on the straight part', () => {
    for (let x = -1.5; x <= 2; x += 0.05) for (let k = 0 as 0 | 1 | 2; k < 3; k++) expect(Math.abs(f.inverse(k, f.at(k, x)) - x)).toBeLessThan(6.4e-4);
  });
  it('gamma is an axis stretch: f(g·x), the grey card keeps its density', () => {
    const g = f.withGamma([1.25, 1.25, 1.25]);
    expect(g.at(0, 0)).toBeCloseTo(f.at(0, 0), 12);
    expect(g.at(1, 0.4)).toBeCloseTo(f.at(1, 0.5), 12);
  });
});

describe('stage 2: DIR coupling (§2.3)', () => {
  it('M is params_builder\'s negative matrix', () => {
    near(dir.M.flat(), (SF.dir.M as number[][]).flat(), 1e-12);
  });
  it('inhibitor at the grey card a = (0.485, 0.663, 0.692)', () => {
    near(inhibitor([0, 0, 0], f, dir), [0.485, 0.663, 0.692], 6e-4);
  });
  it('spektrafilm\'s d0, a and coupled d on six exposures (1e-9)', () => {
    (SF.dir.u as number[][]).forEach((u, i) => {
      near(f.develop(u, [0, 0, 0]), SF.dir.d0[i], 1e-9, `d0 ${i}`);
      near(inhibitor(u, f, dir), SF.dir.a[i], 1e-9, `a ${i}`);
      near(developCoupled(u, f, f0, dir), SF.dir.d[i], 1e-9, `d ${i}`);
    });
  });
  it('moderate red trace (derived): a = (0.5195, 0.6752, 0.6859), d = (0.9867, 0.4557, 0.7116)', () => {
    const u = [0.399, -0.2774, -0.1612];
    near(inhibitor(u, f, dir), [0.5195, 0.6752, 0.6859], 6e-4);
    near(developCoupled(u, f, f0, dir), [0.9867, 0.4557, 0.7116], 6e-4);
  });
  it('law: neutral reproduction within 0.0012 over −2.5…3.0; mutant (datasheet after coupling) fails', () => {
    let worst = 0, worstMut = 0;
    for (let t = -2.5; t <= 3.0001; t += 0.01) {
      const d = developCoupled([t, t, t], f, f0, dir);
      const a = inhibitor([t, t, t], f, dir);
      for (let k = 0 as 0 | 1 | 2; k < 3; k++) {
        worst = Math.max(worst, Math.abs(d[k]! - f.at(k, t)));
        worstMut = Math.max(worstMut, Math.abs(f.at(k, t - a[k]!) - f.at(k, t)));
      }
    }
    expect(worst).toBeLessThan(0.0012);
    expect(worstMut).toBeGreaterThan(0.1);
  });
  it('J(0) and its row sums (0.489, 0.479, 0.558)', () => {
    // central differences of ±0.05 log H on the coupled stage, as the textbook
    const h = 0.05;
    const J: Mat3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let k = 0; k < 3; k++) {
      const up = [0, 0, 0], dn = [0, 0, 0];
      up[k] = h; dn[k] = -h;
      const a = developCoupled(up, f, f0, dir), b = developCoupled(dn, f, f0, dir);
      for (let j = 0; j < 3; j++) J[j]![k] = (a[j]! - b[j]!) / (2 * h);
    }
    near(J.flat(), [0.610, -0.056, -0.065, -0.154, 0.740, -0.107, -0.145, -0.171, 0.874], 0.0035);
    near(J.map((r) => r[0] + r[1] + r[2]), [0.489, 0.479, 0.558], 0.0035);
    // the closed form agrees with the differences to 0.008 (textbook; 0.0083 here)
    near(effectiveGamma([0, 0, 0], f, f0, dir, 0.05).flat(), J.flat(), 0.0086);
  });
  it('law: no negative dyes; toe magenta 0.004 against −0.333 for the density matrix after the curve', () => {
    const u = [1, -1.5, -1.5];
    const d = developCoupled(u, f, f0, dir);
    expect(d[1]).toBeCloseTo(0.004, 3);
    const B: Mat3 = [[1, -0.076, -0.076], [-0.245, 1, -0.118], [-0.255, -0.244, 1]];
    // f₁ = B⁻¹ f per channel on the neutral ramp, so neutrals reproduce; then d = B f₁(u)
    const Bi = inv3(B);
    const f1 = (k: number, t: number): number => Bi[k]![0]! * f.at(0, t) + Bi[k]![1]! * f.at(1, t) + Bi[k]![2]! * f.at(2, t);
    const f1u = [f1(0, u[0]!), f1(1, u[1]!), f1(2, u[2]!)];
    const mutant = B[1][0] * f1u[0]! + B[1][1] * f1u[1]! + B[1][2] * f1u[2]!;
    expect(mutant).toBeCloseTo(-0.333, 2);
    for (let r = 0; r < 400; r++) {
      const v = [Math.sin(r * 1.3) * 3, Math.cos(r * 0.7) * 3, Math.sin(r * 2.9 + 1) * 3];
      for (const x of developCoupled(v, f, f0, dir)) expect(x).toBeGreaterThanOrEqual(0);
    }
  });
  it('edge of a red object (u_R = +1 beside the grey card): 1.399 inside, 0.687 outside, overshoot 1.484, undershoot 0.615', () => {
    const w = 400, h = 1, um = 1;
    const u = new Float64Array(w * 3);
    for (let x = 0; x < w; x++) u[x * 3] = x < w / 2 ? 1 : 0;
    const d0 = { ...dir, diffusion: { sigma_um: 20, tail_um: 200, tailWeight: 0.06 } };
    // a one-row image: the blur runs along x only, which is the 1-D marginal of the isotropic kernel
    const uc = coupleImageRow(u, w, um, d0);
    const cyan = Array.from({ length: w }, (_, x) => f0.at(0, uc[x * 3]!));
    const inside = cyan[50]!, outside = cyan[w - 50]!;
    expect(Math.abs(inside - 1.399)).toBeLessThan(0.01);
    expect(Math.abs(outside - 0.687)).toBeLessThan(0.01);
    expect(Math.abs(Math.max(...cyan) - 1.484)).toBeLessThan(0.01);
    expect(Math.abs(Math.min(...cyan) - 0.615)).toBeLessThan(0.01);
  });
});

function coupleImageRow(u: Float64Array, w: number, um: number, d: typeof dir): Float64Array {
  // pad vertically so the reflect boundary keeps the row uniform in y
  return coupleImage(u, w, 1, um, f, d);
}
