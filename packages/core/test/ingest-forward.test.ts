// ingest's stock ranking, base check and conditioning map on core's ScannerForward (CHB-017: the
// interim forward-stub in packages/ingest is gone). These tests moved here from
// packages/ingest/test/laws.test.ts because ingest takes a ScannerForward by injection (DR-9) and
// must not depend on core; core already sits above ingest (engine-mock → ingest).
// Golden: fixtures/golden/ingest-laws.json `stockBases` (CHB-006, from Chromogen's channels.js maths).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@chromobench/contract';
import { baseCheck, conditioningMap, rankStocks, rebateAbsoluteD, sigmaAt, sigmaTable } from '@chromobench/ingest';
import { CHROMOGEN, interimData, scannerForward, type PhysicsData } from '../src/index.ts';

const laws = JSON.parse(readFileSync(new URL('../../../fixtures/golden/ingest-laws.json', import.meta.url), 'utf8'));
const stockIds = Object.keys(laws.stockBases.D);
const data = interimData();
// The guide's illustrative X-T5 scanner: Gaussian LEDs 678/532/472 nm, 20 nm FWHM × generic-bayer.
// The golden table was computed with Chromogen's maths, where a missing sample has zero density
// (conventions nan: 'zero'); a golden number is reproducible only under its own conventions (§5.2).
const fwd = scannerForward(data, 'xt5-rgb-led', CHROMOGEN);

describe('stock ranking and the base check on core\'s ScannerForward (guide §2.3, §5.8)', () => {
  it('bases read through the X-T5 LED scanner match the guide table (CHROMOGEN conventions)', () => {
    for (const id of stockIds) fwd.readBase(id).forEach((v, k) => expect(Math.abs(v - laws.stockBases.D[id][k]), `${id}[${k}]`).toBeLessThan(laws.stockBases.tol));
  });
  it('under core\'s default conventions (missing = opaque) the red reading moves where the base data stops at 700 nm', () => {
    // CHB-017 measurement: Ektar 100 reads 0.304 instead of 0.202 D in red (its base has no samples from
    // 700 nm, inside the 678 nm LED's tail); every other stock moves by ≤ 0.0015 D. Ranking still puts
    // Gold 200 first and C200 second.
    const def = scannerForward(data, 'xt5-rgb-led');
    const moved = stockIds.map((id) => Math.max(...def.readBase(id).map((v, k) => Math.abs(v - fwd.readBase(id)[k]!))));
    expect(Math.max(...moved.filter((_, i) => stockIds[i] !== 'kodak_ektar_100'))).toBeLessThan(0.0015);
    expect(def.readBase('kodak_ektar_100')[0]).toBeCloseTo(0.3042, 3);
    const r = rankStocks(def.readBase('kodak_gold_200'), stockIds, def);
    expect(r.slice(0, 2).map((x) => x.stock)).toEqual(['kodak_gold_200', 'fujifilm_c200']);
  });
  it('ranks Gold 200 first, C200 0.020 D away; consistent ≤ 0.02 D', () => {
    const r = rankStocks(fwd.readBase('kodak_gold_200'), stockIds, fwd);
    expect(r[0]!.stock).toBe('kodak_gold_200');
    expect(r[1]!.stock).toBe('fujifilm_c200');
    for (const x of r.slice(1)) expect(Math.abs(x.maxDiffD - laws.stockBases.maxDiffFromGold[x.stock]), x.stock).toBeLessThan(0.001);
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

describe('conditioning map on core\'s ScannerForward (textbook §3.2)', () => {
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
    const gold = data.stock('kodak_gold_200');
    const flat: PhysicsData = { ...data, stockIds: () => [...data.stockIds(), 'x'], stock: (id) => (id === 'x' ? { ...gold, id: 'x', dyes: [gold.dyes[0]!, gold.dyes[0]!, gold.dyes[2]!] } : data.stock(id)) };
    const bad = scannerForward(flat, 'xt5-rgb-led');
    const r = conditioningMap(sigmaTable(bad, 'x', 5), dyes, 3, 1);
    expect(r.summary.illConditioned).toBe(1);
    expect(r.summary.notes[0]!.code).toBe('W_ILL_CONDITIONED');
  });
});
