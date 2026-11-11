// Stage 3 (node-side): interim f64 oracle, table keys, cache file format, lookups, half floats.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildTableF64, chromogenOracle, look3, tableNodes, tetra3 } from '../src/physics/oracle.ts';
import { pdInputs, printInputs, solveInputs } from '../src/physics/setup.ts';
import { loadStock, scannerChannels, type CameraJson, type StockJson } from '../src/physics/spectral.ts';
import { decodeTable, encodeTable, MemoryStore, TableCache } from '../src/tables/cache.ts';
import { keyFor, tableId } from '../src/tables/keys.ts';
import { toHalf } from '../src/tables/manager.ts';
import { nodeAt, type SpectralInputs, type Table } from '../src/tables/inputs.ts';

const fx = (n: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/chromogen/${n}.json`, import.meta.url), 'utf8'));
const gold = loadStock(fx('kodak_gold_200') as StockJson);
const endura = loadStock(fx('kodak_portra_endura') as StockJson);
const camera = fx('generic-bayer') as CameraJson;
const si = solveInputs(scannerChannels('xt5-fitted', camera), gold, 9);

describe('interim f64 oracle (Chromogen port)', () => {
  it('solves a reachable density back to its dyes', () => {
    const c = [0.6, 0.8, 1.1] as [number, number, number];
    // forward model: d_k = −log10 Σ P_k 10^−(B + Σ c ε)
    const d = [0, 1, 2].map((k) => {
      let s = 0;
      for (let i = 0; i < 81; i++) s += si.P[k]![i]! * 10 ** -(si.B[i]! + c[0] * si.E[0][i]! + c[1] * si.E[1][i]! + c[2] * si.E[2][i]!);
      return -Math.log10(s);
    }) as [number, number, number];
    const r = chromogenOracle.solve(si, d);
    for (let k = 0; k < 3; k++) expect(r.c[k]).toBeCloseTo(c[k]!, 6);
    expect(r.residual).toBeLessThan(1e-6);
  });

  it('a range-chunked build is bitwise equal to the whole build (worker invariant)', () => {
    const whole = buildTableF64(chromogenOracle, si).data;
    const parts = new Float32Array(whole.length);
    for (let q0 = 0; q0 < 729; q0 += 100) parts.set(tableNodes(chromogenOracle, si, q0, Math.min(729, q0 + 100)), 4 * q0);
    expect(Buffer.from(parts.buffer).equals(Buffer.from(whole.buffer))).toBe(true);
  });

  it('the solve table has nodes on both sides of the 0.01 reachability flag', () => {
    const t = buildTableF64(chromogenOracle, si).data;
    let reach = 0;
    for (let q = 0; q < 729; q++) if (t[4 * q + 3]! < 0.01) reach++;
    expect(reach).toBeGreaterThan(100);
    expect(reach).toBeLessThan(729);
  });

  it('print table: paper white is bright and near-neutral under D65 adaptation', () => {
    const pi = printInputs(endura);
    const w = chromogenOracle.spectral(pi, [0, 0, 0]);
    expect(w[1]).toBeGreaterThan(0.7);
    expect(w[0] / w[1]).toBeCloseTo(0.95047, 1);
  });
});

describe('table keys', () => {
  const pi = pdInputs(gold, endura);
  it('change with the domain, N, the data, the scan and the builder', () => {
    const id = tableId(keyFor(pi, { builder: 'f64' }));
    expect(tableId(keyFor(pi, { builder: 'f64' }))).toBe(id);
    expect(tableId(keyFor({ ...pi, range: [0, 2.7] }, { builder: 'f64' }))).not.toBe(id);
    expect(tableId(keyFor({ ...pi, N: 17 }, { builder: 'f64' }))).not.toBe(id);
    const B = Float64Array.from(pi.B);
    B[40]! += 1e-12;
    expect(tableId(keyFor({ ...pi, B }, { builder: 'f64' }))).not.toBe(id);
    expect(tableId(keyFor(pi, { builder: 'gpu-f32' }))).not.toBe(id);
    expect(tableId(keyFor(si, { builder: 'f64', scan: 'abc' }))).not.toBe(tableId(keyFor(si, { builder: 'f64' })));
  });
  it('the solver options are in the solve key', () => {
    expect(tableId(keyFor({ ...si, gtol: 1e-6 }, { builder: 'f64' }))).not.toBe(tableId(keyFor(si, { builder: 'f64' })));
  });
});

describe('table cache', () => {
  const t: Table = { N: 3, range: [0, 1], data: Float32Array.from({ length: 108 }, (_, i) => i * 0.25) };
  const key = keyFor({ ...pdInputs(gold, endura), N: 3 } as SpectralInputs, { builder: 'f64' });
  it('round-trips a table bit for bit and refuses a different key or corrupted payload', () => {
    const b = encodeTable(key, t);
    const back = decodeTable(b, key)!;
    expect(Buffer.from(back.data.buffer).equals(Buffer.from(t.data.buffer))).toBe(true);
    expect(decodeTable(b, { ...key, domain: { ...key.domain, hi: 9 } })).toBeNull();
    const bad = b.slice();
    bad[bad.length - 1]! ^= 1;
    expect(decodeTable(bad, key)).toBeNull();
  });
  it('resolves memory → store → build and evicts beyond the budget', async () => {
    const store = new MemoryStore();
    let builds = 0;
    const c1 = new TableCache(store);
    await c1.resolve(key, async () => (builds++, t));
    await c1.resolve(key, async () => (builds++, t));
    expect(builds).toBe(1);
    const c2 = new TableCache(store); // a "page reload": empty memory, same store
    await c2.resolve(key, async () => (builds++, t));
    expect(builds).toBe(1);
    expect(c2.stats.storeHits).toBe(1);
    const c3 = new TableCache(store, { storeBudget: 10 });
    await c3.put(key, t);
    expect(store.files.size).toBe(0);
  });
});

describe('lookups (CPU models of the GPU lookups)', () => {
  const N = 5;
  const lin = (a: number[]) => [1 + 2 * a[0]! - a[1]! + 0.5 * a[2]!, a[0]! * 0, 3 * a[2]!, 1];
  const T: Table = { N, range: [0, 2], data: new Float32Array(N ** 3 * 4) };
  for (let q = 0; q < N ** 3; q++) T.data.set(lin(nodeAt(q, N, 0, 2)), 4 * q);
  it('trilinear and tetrahedral reproduce a linear function exactly', () => {
    for (const a of [[0.3, 1.7, 0.9], [1.99, 0.01, 1.2], [0.5, 0.5, 0.5]]) {
      const want = lin(a);
      look3(T, a).forEach((v, k) => expect(v).toBeCloseTo(want[k]!, 5));
      tetra3(T, a).forEach((v, k) => expect(v).toBeCloseTo(want[k]!, 5));
    }
  });
  it('both equal the node values at nodes', () => {
    const q = 2 + 5 * 3 + 25 * 1;
    const a = nodeAt(q, N, 0, 2);
    expect(look3(T, a)[0]).toBeCloseTo(T.data[4 * q]!, 6);
    expect(tetra3(T, a)[0]).toBeCloseTo(T.data[4 * q]!, 6);
  });
});

describe('toHalf', () => {
  it('encodes known values', () => {
    expect(toHalf(1)).toBe(0x3c00);
    expect(toHalf(-2)).toBe(0xc000);
    expect(toHalf(0.5)).toBe(0x3800);
    expect(toHalf(65504)).toBe(0x7bff);
    expect(toHalf(1e6)).toBe(0x7c00);
    expect(toHalf(2 ** -24)).toBe(1);
  });
});
