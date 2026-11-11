// Chapter 1 goldens (fixtures/golden/core/ch1.json).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  baseWeightedK, CHROMOGEN, Channels, hessian, interimData, makeScanner, readStock, resolveStock, secant, sigmoidFlatC2,
  singularValues3, solveLinear, sub3, symEig3, tangentAtZero, type Mat3,
} from '../src/index.ts';

const fx = JSON.parse(readFileSync(new URL('../../../fixtures/golden/core/ch1.json', import.meta.url), 'utf8'));
const data = interimData();
const stock = resolveStock(data.stock('kodak_portra_400'), CHROMOGEN);
const c: number[] = fx.greyC;
const ch = (id: string): Channels => makeScanner(data, id).channels;

function close(got: number | number[] | number[][], exp: number | number[] | number[][], tol: number, id: string): void {
  const g = [got].flat(2) as number[];
  const e = [exp].flat(2) as number[];
  expect(g.length, id).toBe(e.length);
  g.forEach((v, i) => expect(Math.abs(v - e[i]!), `${id}[${i}]: got ${v}, expected ${e[i]}`).toBeLessThanOrEqual(tol + 1e-12));
}

function onBaseK(P: Channels): Mat3 {
  const m = P.masked(stock.pass);
  const rb = m.read(stock.base);
  const cols = stock.dyes.map((e) => sub3(m.read(stock.base.map((b, i) => b + e[i]!)), rb));
  return [0, 1, 2].map((k) => [cols[0]![k]!, cols[1]![k]!, cols[2]![k]!]) as Mat3;
}

function compute(e: any): number | number[] | number[][] {
  const P = e.scanner ? ch(e.scanner) : undefined;
  const D = stock.spectral(c);
  switch (e.what) {
    case 'read': return readStock(P!, stock, c)[e.channel as 0];
    case 'transmittance': return P!.transmittance(D)[e.channel as 0];
    case 'meanD': return P!.P[e.channel as 0].reduce((s, w, i) => s + w * D[i]!, 0);
    case 'spectral550': return D[34]!;
    case 'terms550': return [c[0]! * stock.dyes[0]![34]!, c[1]! * stock.dyes[1]![34]!, c[2]! * stock.dyes[2]![34]!, stock.base[34]!];
    case 'softmin': {
      const two = new Channels([[1, 1, ...new Array(79).fill(0)], [1, 1, ...new Array(79).fill(0)], [1, 1, ...new Array(79).fill(0)]] as never);
      return two.read([0, 2, ...new Array(79).fill(0)])[0];
    }
    case 'hessianEig': return symEig3(hessian(P!, stock, c, e.channel));
    case 'centroids': return P!.centroids_nm();
    case 'tangent0Diag': return tangentAtZero(P!, stock).map((r, k) => r[k]!);
    case 'secantDiag': return secant(P!, stock).map((r, k) => r[k]!);
    case 'secant': return secant(P!, stock);
    case 'tangent0': return tangentAtZero(P!, stock);
    case 'baseWeighted': return baseWeightedK(P!, stock);
    case 'solveErr': {
      const K = { secant: secant(P!, stock), onBase: onBaseK(P!), tangent0: tangentAtZero(P!, stock), baseWeighted: baseWeightedK(P!, stock) }[e.K as 'secant'];
      const d = sub3(readStock(P!, stock, c), readStock(P!, stock, [0, 0, 0]));
      return sub3(solveLinear(K, d).c, c);
    }
    case 'svSecant': return singularValues3(secant(P!, stock));
    case 'aboveRebate': return sub3(readStock(P!, stock, c), readStock(P!, stock, [0, 0, 0]));
    case 'dyesAlone': return P!.read(stock.dyes[0]!.map((_, i) => c[0]! * stock.dyes[0]![i]! + c[1]! * stock.dyes[1]![i]! + c[2]! * stock.dyes[2]![i]!));
    case 'sigmoidC2': return sigmoidFlatC2(e.input);
    default: throw new Error(`unknown golden kind ${e.what}`);
  }
}

describe('chapter 1 goldens', () => {
  for (const e of fx.entries) {
    it(`${e.id} (${e.section}, ${e.source})`, () => {
      close(compute(e), e.expect, e.tol, e.id);
      if (e.cond) {
        const s = singularValues3(secant(ch(e.scanner), stock));
        expect(Math.abs(s[0] / s[2] - e.cond)).toBeLessThan(0.006);
      }
    });
  }
  it('0.01 D along the weakest direction becomes ~0.047 of cyan (white LED, §1.4)', () => {
    const s = solveLinear(secant(ch('white-led'), stock), [0, 0, 0]);
    expect(1 / s.sigmaMin * 0.01).toBeCloseTo(0.047, 3);
  });
});
