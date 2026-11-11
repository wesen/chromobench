// f64 tables for CHB-005 parity: node order, texel-centre lookup, and agreement with the exact functions.
import { describe, expect, it } from 'vitest';
import {
  buildPdTable, buildPrintTable, buildSolveTable, interimData, look3, makeForward, makePrintChain, makeScanner, nodeAt,
  observe, reflectance, resolveStock, SPEKTRAFILM,
} from '../src/index.ts';

const data = interimData();
const chain = makePrintChain({ data, film: 'kodak_portra_400', paper: 'kodak_portra_endura', conv: SPEKTRAFILM });

describe('tables', () => {
  it('nodeAt runs x fastest', () => {
    expect(nodeAt(1, 3, 0, 2)).toEqual([1, 0, 0]);
    expect(nodeAt(3, 3, 0, 2)).toEqual([0, 1, 0]);
    expect(nodeAt(9, 3, 0, 2)).toEqual([0, 0, 1]);
  });
  it('look3 returns node values exactly at nodes and is trilinear between them', () => {
    const t = buildPrintTable(chain, { N: 9 });
    for (const q of [0, 17, 300, 728]) {
      const v = look3(t, nodeAt(q, 9, t.lo, t.hi));
      for (let c = 0; c < 3; c++) expect(v[c]).toBeCloseTo(t.data[4 * q + c]!, 12);
    }
    const mid = look3(t, [0.5 * (t.hi - t.lo) / 8, 0, 0]);
    expect(mid[1]).toBeCloseTo(0.5 * (t.data[1]! + t.data[4 + 1]!), 12);
  });
  it('print table at N = 33 interpolates the exact XYZ within 3e-3 at random points (measured 2.24e-3)', () => {
    const t = buildPrintTable(chain);
    let worst = 0;
    for (let i = 0; i < 200; i++) {
      const cp = [((i * 37) % 97) / 97 * 2.6, ((i * 53) % 89) / 89 * 2.6, ((i * 71) % 83) / 83 * 2.6];
      const X = observe(chain.viewing, reflectance(chain.viewing, cp));
      const v = look3(t, cp);
      for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(v[k]! - X[k]!));
    }
    expect(worst).toBeLessThan(3e-3);
  });
  it('pd table holds clear − x', () => {
    const t = buildPdTable(chain, { N: 5 });
    const c = nodeAt(62, 5, t.lo, t.hi);
    const x = chain.enlarger.exposure(c);
    const clear = chain.enlarger.clear();
    for (let k = 0; k < 3; k++) expect(t.data[4 * 62 + k]).toBeCloseTo(clear[k]! - x[k]!, 12);
  });
  it('solve table: channel 4 is the residual and reachable nodes re-read to their key', () => {
    const f = makeForward(makeScanner(data, 'xt5-fitted'), resolveStock(data.stock('kodak_gold_200'), SPEKTRAFILM));
    const { table } = buildSolveTable(f, { N: 7 });
    for (let q = 0; q < 343; q += 17) {
      const c = [table.data[4 * q]!, table.data[4 * q + 1]!, table.data[4 * q + 2]!];
      const a = nodeAt(q, 7, table.lo, table.hi);
      const d = f.K.map((row, k) => row[0] * a[0] + row[1] * a[1] + row[2] * a[2] + f.Dbase[k]!);
      const D = f.D(c);
      expect(table.data[4 * q + 3]).toBeCloseTo(Math.hypot(D[0] - d[0]!, D[1] - d[1]!, D[2] - d[2]!), 10);
    }
  });
});
