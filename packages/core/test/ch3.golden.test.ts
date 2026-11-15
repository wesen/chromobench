// Chapter 3 goldens (fixtures/golden/core/ch3.json): forward model, LM trace, active set, tables, flare.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '@chromobench/contract';
import {
  buildSolveTable, CHROMOGEN, fitFlare, forwardJacobian, nodePacksData, makeForward, makeScanner, removeFlare, resolveStock,
  solveDyes, withFlare,
} from '../src/index.ts';

const fx = JSON.parse(readFileSync(new URL('../../../fixtures/golden/core/ch3.json', import.meta.url), 'utf8'));
const data = nodePacksData();
const stock = resolveStock(data.stock('kodak_portra_400'), CHROMOGEN);
const white = makeScanner(data, 'white-led');
const cg = stock.develop([0, 0, 0]);
const near = (got: ArrayLike<number>, exp: ArrayLike<number>, tol: number, what: string): void => {
  for (let i = 0; i < exp.length; i++) expect(Math.abs(got[i]! - exp[i]!), `${what}[${i}] got ${got[i]} expected ${exp[i]}`).toBeLessThanOrEqual(tol + 1e-12);
};

describe('chapter 3 goldens', () => {
  const fS = makeForward(white, stock, { start: 'secant' });
  const fB = makeForward(white, stock);
  it('grey reading and rebate through the white LED (§3.2)', () => {
    near(fS.D(cg), fx.greyReading.expect, fx.greyReading.tol, 'd');
    near(fS.Dbase, fx.greyReading.rebate, fx.greyReading.tol, 'Dbase');
  });
  it('J at grey (§3.2)', () => near(forwardJacobian(fS, cg).flat(), fx.jGreyWhite.expect.flat(), fx.jGreyWhite.tol, 'J'));
  it('closed-form J matches central differences on 50 random triples (§3.2)', () => {
    const r = mulberry32(3);
    let worst = 0;
    for (let n = 0; n < fx.jCentralDiff.n; n++) {
      const c = [r.range(0, 2.5), r.range(0, 2.5), r.range(0, 2.5)];
      const J = forwardJacobian(fS, c);
      const h = 1e-5;
      for (let j = 0; j < 3; j++) {
        const cp = c.slice(); cp[j]! += h;
        const cm = c.slice(); cm[j]! -= h;
        const dp = fS.D(cp);
        const dm = fS.D(cm);
        for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(J[k]![j]! - (dp[k]! - dm[k]!) / (2 * h)));
      }
    }
    expect(worst).toBeLessThan(1e-9); // textbook: ≤ 3.8e-10 with its step; ours ~1e-10 with h = 1e-5
  });
  it('analytical start from the secant (§3.2)', () => near(solveDyes(fS, fS.D(cg)).start, fx.analyticalStartSecant.expect, fx.analyticalStartSecant.tol, 'start'));
  it('LM trace from the secant start reproduces §3.3 to four decimals', () => {
    const r = solveDyes(fS, fS.D(cg), { activeSet: false, gtol: 0, trace: true });
    expect(r.trace!.length).toBe(fx.lmTrace.rows.length);
    fx.lmTrace.rows.forEach((row: any, i: number) => {
      const t = r.trace![i]!;
      near(t.c, row.c, fx.lmTrace.tol, `row ${i} c`);
      expect(Math.abs(t.residual - row.r) / row.r).toBeLessThan(0.006);
      expect(Math.abs(t.mu - row.mu) / row.mu).toBeLessThan(0.06);
      if (row.tries) expect(t.tries).toBe(row.tries);
    });
    expect(r.passes).toBe(fx.lmTrace.passes);
    expect(r.stop).toBe('tolerance');
    near(r.c, cg, 1e-5, 'truth');
  });
  it('base-weighted start: closer start, 2 iterations and 5 passes (guide §6.2, derived)', () => {
    const r = solveDyes(fB, fB.D(cg));
    near(r.start, fx.baseWeightedStart.expect, fx.baseWeightedStart.tol, 'start');
    expect(r.iterations).toBe(fx.baseWeightedStart.iterations);
    expect(r.passes).toBe(fx.baseWeightedStart.passes);
  });
  for (const [name, f] of [['secant', fS], ['base-weighted', fB]] as const) {
    it(`shadow pixel (§3.4), ${name} start: active set 0.10646 D in 4 it / 9 passes; plain LM hits the cap`, () => {
      const d = fx.shadow.aboveRebate.map((v: number, k: number) => v + f.Dbase[k]!);
      const a = solveDyes(f, d, { activeSet: true, gtol: 1e-9 });
      expect(Math.abs(a.residual_D - fx.shadow.activeSet.residual)).toBeLessThan(fx.shadow.tol);
      expect([a.iterations, a.passes]).toEqual([fx.shadow.activeSet.iterations, fx.shadow.activeSet.passes]);
      expect(a.held).toEqual([true, false, false]);
      const p = solveDyes(f, d, { activeSet: false, gtol: 0 });
      expect([p.iterations, p.passes, p.stop]).toEqual([fx.shadow.plain.iterations, fx.shadow.plain.passes, 'maxIterations']);
      if (name === 'secant') expect(Math.abs(p.residual_D - fx.shadow.plain.residual)).toBeLessThan(fx.shadow.tol);
      expect(p.residual_D).toBeGreaterThan(a.residual_D);
    });
  }
  for (const cs of fx.tableIterations.cases) {
    it(`33³ table iterations, ${cs.scanner}: plain ${cs.plain} → active ${cs.active} (§3.4)`, () => {
      const f = makeForward(makeScanner(data, cs.scanner), resolveStock(data.stock(cs.stock), CHROMOGEN), { start: 'secant' });
      const plain = buildSolveTable(f, { solve: { activeSet: false, gtol: 0 } }).stats;
      const active = buildSolveTable(f, { solve: { activeSet: true, gtol: 1e-9 } }).stats;
      expect(Math.abs(plain.meanIterations - cs.plain)).toBeLessThan(0.06);
      expect(Math.abs(active.meanIterations - cs.active)).toBeLessThan(0.06);
      expect(Math.abs(plain.atCap - cs.capPlain)).toBeLessThanOrEqual(cs.capPlainTol ?? 5);
      expect(Math.abs(active.atCap - cs.capActive)).toBeLessThanOrEqual(cs.capActiveTol ?? 0);
      expect(Math.abs(active.unreachable - cs.unreachable)).toBeLessThan(6e-4);
      expect(plain.meanIterations / active.meanIterations).toBeGreaterThan(4.4);
      // deterministic and compute-bound (two 33³ solve tables, ~2–3 s alone): no timeout, so a loaded machine (parallel
      // suites) cannot fail it; a wrong count fails it as before (CHB-037 P3b)
    }, 0);
  }
  it('flat wedge reads its density in every channel of every scanner (§3.7)', () => {
    for (const id of ['xt5-fitted', 'rgb-led-book', 'white-led', 'status-m']) {
      for (const v of makeScanner(data, id).channels.read(new Float64Array(81).fill(fx.flatWedge.D))) expect(Math.abs(v - fx.flatWedge.expect)).toBeLessThan(fx.flatWedge.tol);
    }
  });
  it('wedge with 0.5 % flare and the fit recovers f (§3.7)', () => {
    const got = fx.flareWedge.steps.map((d: number) => withFlare([d, d, d], [1, 1, 1], fx.flareWedge.f)[0]);
    near(got, fx.flareWedge.expect, fx.flareWedge.tol, 'wedge');
    const r = mulberry32(5);
    const noisy = got.map((v: number) => v + 0.005 * (r.next() + r.next() + r.next() - 1.5) * 2);
    expect(Math.abs(fitFlare(fx.flareWedge.steps, got).f - 0.005)).toBeLessThan(1e-7);
    expect(Math.abs(fitFlare(fx.flareWedge.steps, noisy).f - 0.005)).toBeLessThan(5e-4);
    near(removeFlare(withFlare([1.2, 0.4, 2.1], [0.3, 0.2, 0.1], 0.01), [0.3, 0.2, 0.1], 0.01), [1.2, 0.4, 2.1], 1e-12, 'round trip');
  });
  it('white patch with 0.5 % flare, narrowband blue: 1.429 → 1.172 D (§3.1)', () => {
    const f = makeForward(makeScanner(data, fx.whitePatchFlare.scanner), stock);
    const Treb = f.Dbase.map((v) => 10 ** -v);
    expect(Math.abs(withFlare([0, 0, fx.whitePatchFlare.aboveRebate], Treb, fx.whitePatchFlare.f)[2] - fx.whitePatchFlare.expect)).toBeLessThan(fx.whitePatchFlare.tol);
  });
});
