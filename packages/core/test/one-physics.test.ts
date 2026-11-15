// CHB-017 "one physics": the array form of core's tables (what packages/gpu's workers and table keys
// consume) reproduces core's table builders, and the reference engine's tabulated mode renders through
// those tables.
import { describe, expect, it } from 'vitest';
import { Graph, sha256Hex } from '@chromobench/contract';
import { makeM1Tiff } from '@chromobench/engine-mock';
import {
  buildPdTable, buildPrintTable, buildSolveTable, nodePacksData, makeForward, makePrintChain, makeScanner, nodeAt, pdArrays, printArrays, RefEngine,
  resolveStock, solveArrays, solveNode, SPEKTRAFILM, spectralNode,
} from '../src/index.ts';

const data = nodePacksData();
const N = 9;

describe('table arrays reproduce the builders (Studio node order)', () => {
  const f = makeForward(makeScanner(data, 'xt5-fitted'), resolveStock(data.stock('kodak_gold_200'), SPEKTRAFILM));
  const chain = makePrintChain({ data, film: 'kodak_gold_200', paper: 'kodak_portra_endura', conv: SPEKTRAFILM, filtrationShift: { c: 0, m: 4, y: -6 } });

  it('solve: bit-identical to buildSolveTable', () => {
    const t = buildSolveTable(f, { N }).table;
    const inp = solveArrays(f);
    for (let q = 0; q < N ** 3; q++) {
      const a = nodeAt(q, N, t.lo, t.hi);
      const d = [0, 1, 2].map((k) => f.K[k]![0]! * a[0] + f.K[k]![1]! * a[1] + f.K[k]![2]! * a[2] + f.Dbase[k]!);
      const r = solveNode(inp, d);
      expect([r.c[0], r.c[1], r.c[2], r.residual_D]).toEqual(Array.from(t.data.subarray(4 * q, 4 * q + 4)));
    }
  });

  it('pd: clear − exposure(c) to 1e-12, whatever the normalisation offset', () => {
    const t = buildPdTable(chain, { N });
    const inp = pdArrays(chain.enlarger);
    let max = 0;
    for (let q = 0; q < N ** 3; q++) {
      const v = spectralNode(inp, nodeAt(q, N, t.lo, t.hi));
      for (let k = 0; k < 3; k++) max = Math.max(max, Math.abs(v[k]! - t.data[4 * q + k]!));
    }
    expect(max).toBeLessThan(1e-12);
  });

  it('print: XYZ under the viewing light to 1e-14', () => {
    const t = buildPrintTable(chain, { N });
    const inp = printArrays(chain.viewing);
    let max = 0;
    for (let q = 0; q < N ** 3; q++) {
      const v = spectralNode(inp, nodeAt(q, N, t.lo, t.hi));
      for (let k = 0; k < 3; k++) max = Math.max(max, Math.abs(v[k]! - t.data[4 * q + k]!));
    }
    expect(max).toBeLessThan(1e-14);
  });
});

describe('reference engine, tabulated mode', () => {
  it('renders print → view through the tables, within table error of exact inside the table domains', async () => {
    const run = async (mode: 'exact' | 'tabulated') => {
      const e = new RefEngine({ data: nodePacksData(), mode });
      const g = new Graph();
      const bytes = makeM1Tiff();
      g.registerSource(await e.open({ kind: 'file', sha256: sha256Hex(bytes), bytes }));
      const I = (op: string, inputs: string[], args: Record<string, unknown> = {}): string => {
        const { node } = g.intern(op, inputs, args);
        e.adopt(g.closure(node.id));
        return node.id;
      };
      const pat = I('source.pattern', [], { domain: 'film-dyes', width: 8, height: 6, seed: 4 });
      const xyz = I('view.reflect', [I('print.develop', [I('print.combine', [I('print.expose', [pat])], { filters: [{ logH: [0, 0, 0], amount: 1 }] })])], { illuminant: 'D50' });
      const read = async (id: string) => (await e.evaluate({ id, info: g.get(id)!.info }, { scale: 'full', precision: 'export' })).read();
      return { xyz: await read(xyz), dyes: await read(pat) };
    };
    const [ex, tab] = [await run('exact'), await run('tabulated')];
    let max = 0;
    let n = 0;
    for (let i = 0; i < ex.xyz.length / 3; i++) {
      // the film-dyes domain is [0, 3]; the pd table covers C_RANGE [0, 2.6] and clamps beyond it
      if ([0, 1, 2].some((k) => ex.dyes[3 * i + k]! > 2.6)) continue;
      n++;
      for (let k = 0; k < 3; k++) max = Math.max(max, Math.abs(ex.xyz[3 * i + k]! - tab.xyz[3 * i + k]!));
    }
    expect(n).toBeGreaterThan(10);
    // 33³ table interpolation in linear XYZ (CHB-003 Step 18 measured 2.24e-3 for the print table alone)
    expect(max).toBeGreaterThan(0);
    expect(max).toBeLessThan(5e-3);
  });
});
