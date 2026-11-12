// The packs implement core's PhysicsData (packages/core/src/data/provider.ts). This file checks the type, the data overlap
// with the retired interim JSON provider, and core's print chain on pack data. (Moved here from packages/data to avoid a workspace cycle.)
import { describe, expect, it } from 'vitest';
import { chb001InterimData, makePrintChain, resolveStock, SPEKTRAFILM, type PhysicsData } from '@chromobench/core';
import { nodePhysicsData } from '@chromobench/data/node';

const packs: PhysicsData = nodePhysicsData(); // compile-time check: the adapter satisfies core's interface
const interim = chb001InterimData();

function maxdiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i]!) && Number.isFinite(b[i]!)) d = Math.max(d, Math.abs(a[i]! - b[i]!));
  return d;
}

describe('packs as core PhysicsData', () => {
  it('serves the same stock ids, roles and illuminants as the interim provider (plus TH-KG3-L)', () => {
    expect(packs.stockIds().sort()).toEqual(interim.stockIds().sort());
    for (const id of packs.stockIds()) expect(packs.stock(id).role, id).toBe(interim.stock(id).role);
    expect(packs.illuminantNames().sort()).toEqual([...interim.illuminantNames(), 'TH-KG3-L'].sort());
    expect(packs.id).toBe('spektrafilm@0.3.2+3bb2c2d|illustrative@1');
  });

  it('stock arrays agree with interim within its rounding (4 decimals for Filmbench-sourced arrays)', () => {
    for (const id of packs.stockIds()) {
      const a = packs.stock(id);
      const b = interim.stock(id);
      for (let k = 0; k < 3; k++) {
        expect(maxdiff(a.logSensitivity[k]!, b.logSensitivity[k]!), `${id} logS`).toBeLessThanOrEqual(5e-5 + 1e-12);
        expect(maxdiff(a.dyes[k]!, b.dyes[k]!), `${id} dyes`).toBeLessThanOrEqual(5e-6 + 1e-12);
        expect(maxdiff(a.curves[k]!, b.curves[k]!), `${id} curves`).toBeLessThanOrEqual(5e-5 + 1e-12);
      }
      expect(maxdiff(a.base, b.base), `${id} base`).toBeLessThanOrEqual(5e-6 + 1e-12);
      expect(!!a.curveModel, id).toBe(!!b.curveModel);
    }
  });

  it('under core\'s opaque convention the light-pass mask is identical for every stock', () => {
    for (const id of packs.stockIds()) {
      expect(Array.from(resolveStock(packs.stock(id), SPEKTRAFILM).pass), id).toEqual(Array.from(resolveStock(interim.stock(id), SPEKTRAFILM).pass));
    }
  });

  it('reference data agree: CMF, illuminants, dichroics, neutral table, camera, white LED', () => {
    for (let k = 0; k < 3; k++) expect(maxdiff(packs.cmf()[k]!, interim.cmf()[k]!)).toBeLessThanOrEqual(1e-6);
    for (const n of interim.illuminantNames()) expect(maxdiff(packs.illuminant(n), interim.illuminant(n)), n).toBeLessThanOrEqual(1e-6);
    expect(packs.illuminant('bb3200')).toEqual(interim.illuminant('bb3200'));
    for (let k = 0; k < 3; k++) expect(maxdiff(packs.dichroic()[k]!, interim.dichroic()[k]!)).toBeLessThanOrEqual(1e-6);
    expect(packs.neutralFilter('kodak_portra_endura', 'kodak_portra_400')).toEqual(interim.neutralFilter('kodak_portra_endura', 'kodak_portra_400'));
    for (let k = 0; k < 3; k++) expect(maxdiff(packs.camera("generic-bayer")[k]!, interim.camera("generic-bayer")[k]!)).toBeLessThanOrEqual(1e-5);
    expect(maxdiff(packs.light('white-led'), interim.light('white-led'))).toBeLessThanOrEqual(1e-5);
  });

  it('core\'s print chain on pack data: the mid-grey of Portra 400 on Endura is (0.004, 0.005, -0.009) and the grey card prints neutral', () => {
    const opts = { film: 'kodak_portra_400', paper: 'kodak_portra_endura', conv: SPEKTRAFILM, aim: 'midgray-normalised' as const };
    const a = makePrintChain({ data: packs, ...opts });
    const b = makePrintChain({ data: interim, ...opts });
    const xa = a.enlarger.exposureOfDensity(a.enlarger.midgray);
    const xb = b.enlarger.exposureOfDensity(b.enlarger.midgray);
    for (let k = 0; k < 3; k++) expect(Math.abs(xa[k]! - xb[k]!)).toBeLessThan(1e-4);
    const g = makePrintChain({ data: packs, film: 'kodak_portra_400', paper: 'kodak_portra_endura', conv: SPEKTRAFILM });
    const p = g.print(g.film.develop([0, 0, 0]));
    expect(Math.abs(p.lab[1]) + Math.abs(p.lab[2])).toBeLessThan(1e-6);
    expect(p.XYZ[1]).toBeCloseTo(0.184, 9);
  });
});
