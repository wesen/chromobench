// CHB-012 stage 4: the development model (guide §2.9, §5.5, §8.1 "derived" push table).
import { describe, expect, it } from 'vitest';
import {
  developCoupled, developmentCurves, dirForStock, FilmCurves, inhibitor, nodePacksData, precorrectedCurves, resolveStock, SPEKTRAFILM, type StockData,
} from './film-helpers.ts';

const data = nodePacksData();
const p800 = data.stock('kodak_portra_800');
const profiles = new Map<number, StockData>([[0, p800], [1, data.stock('kodak_portra_800_push1')], [2, data.stock('kodak_portra_800_push2')]]);
const ds = (d: StockData): FilmCurves => FilmCurves.ofStock(resolveStock(d, SPEKTRAFILM));
const rms = (a: FilmCurves, b: FilmCurves, lo = -2, hi = 2): number => {
  let s = 0, n = 0;
  for (let x = lo; x <= hi + 1e-9; x += 0.02) for (let k = 0 as 0 | 1 | 2; k < 3; k++) { s += (a.at(k, x) - b.at(k, x)) ** 2; n++; }
  return Math.sqrt(s / n);
};

describe('stage 4: development (§2.9, §5.5)', () => {
  it('measured: push 1 and push 2 of Portra 800 are the exported profiles, exactly', () => {
    for (const p of [1, 2]) {
      const r = developmentCurves(p800, p, profiles);
      expect(r.basis).toBe('measured');
      expect(rms(r.curves, ds(profiles.get(p)!))).toBe(0);
    }
  });
  it('the exposure-index convention: the grey card keeps its dye amount (f(0) ≈ 0.75) at every push', () => {
    const f0 = [0, 1, 2].map((p) => ds(profiles.get(p)!)).map((c) => [0, 1, 2].map((k) => c.at(k as 0, 0)));
    for (const row of f0.slice(1)) for (let k = 0; k < 3; k++) expect(Math.abs(row[k]! - f0[0]![k]!)).toBeLessThan(0.02);
  });
  it('interpolated: push 1 from push 0 and push 2 within 0.03 rms of the push 1 profile', () => {
    const r = developmentCurves(p800, 1, new Map([[0, p800], [2, profiles.get(2)!]]));
    expect(r.basis).toBe('interpolated');
    expect(rms(r.curves, ds(profiles.get(1)!))).toBeLessThan(0.03);
  });
  it('transferred and heuristic bases are labelled; the transfer keeps the grey card and raises contrast', () => {
    const p400 = data.stock('kodak_portra_400');
    const base = ds(p400);
    const t = developmentCurves(p400, 1);
    expect(t.basis).toBe('transferred');
    const pull = developmentCurves(p400, -1);
    expect(pull.basis).toBe('heuristic');
    for (let k = 0 as 0 | 1 | 2; k < 3; k++) {
      expect(Math.abs(t.curves.at(k, 0) - base.at(k, 0))).toBeLessThan(2e-3);
      expect(t.curves.slope(k, 0, 0.1)).toBeGreaterThan(1.15 * base.slope(k, 0, 0.1));
      expect(pull.curves.slope(k, 0, 0.1)).toBeLessThan(base.slope(k, 0, 0.1));
    }
    expect(developmentCurves(p400, 0).basis).toBe('none');
  });
  it('law (push neutrality): after any transform, couple + develop(f⁰ of the transformed f) reproduces neutrals', () => {
    const s = resolveStock(p800, SPEKTRAFILM);
    const dir = dirForStock(s);
    // push 3 (transferred beyond the data) folds the shifted axis (Σ_k M_kj f_k' ≥ 1): f⁰ does not exist there
    for (const push of [-1, 0.5, 1, 1.5, 2]) {
      const c = developmentCurves(p800, push, profiles).curves;
      const c0 = precorrectedCurves(c, dir);
      let worst = 0;
      for (let t = -2; t <= 2.5; t += 0.05) {
        const d = developCoupled([t, t, t], c, c0, dir);
        for (let k = 0 as 0 | 1 | 2; k < 3; k++) worst = Math.max(worst, Math.abs(d[k]! - c.at(k, t)));
      }
      expect(worst, `push ${push}`).toBeLessThan(0.003);
      // mutant: keep the nominal f⁰ under the pushed curves
      const nominal0 = precorrectedCurves(ds(p800), dir);
      const t = 1;
      const a = inhibitor([t, t, t], c, dir);
      if (push !== 0) expect(Math.abs(nominal0.at(0, t - a[0]!) - c.at(0, t))).toBeGreaterThan(0.01);
    }
  });
});
