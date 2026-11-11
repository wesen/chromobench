// CHB-010 stages 1–2 on the GPU side (node, no device): the pd table key carries lamp and pack and
// nothing else; print.expose's offset carries κ, optics and the aim (core's chain); print.develop's
// curve row carries the grade as a gamma about the upstream aim grey.
import { describe, expect, it } from 'vitest';
import { exposeSettings, gradeToGamma, makePrintChain, SPEKTRAFILM } from '@chromobench/core';
import { CorePhysics, N1 } from '../src/physics/core.ts';
import { defaultPhysicsData } from '../src/physics/data.ts';
import { keyFor, tableId } from '../src/tables/keys.ts';
import { X_RANGE } from '../src/tables/inputs.ts';

const data = defaultPhysicsData();
const P = new CorePhysics(data);
const FILM = 'kodak_portra_400';
const args = (o: Record<string, unknown> = {}) => ({ paper: 'kodak_portra_endura', mode: 'real', lamp: 'TH-KG3', filtration: { c: 0, m: 0, y: 0 }, time_s: 10, fstop: 8, aim: 'grey-0.184', aimView: 'D50', ...o });
const expose = (o: Record<string, unknown> = {}) => P.expose(exposeSettings(args(o), FILM), 9);
const pdId = (o: Record<string, unknown> = {}) => tableId(keyFor(expose(o).pd, { builder: 'f64' }));

describe('print.expose on the GPU (CHB-010 stage 1)', () => {
  it('the pd table key changes with the lamp and the pack, not with time, aperture, magnification, mode or aim', () => {
    const base = pdId();
    for (const o of [{ time_s: 20 }, { fstop: 11 }, { magnification: 4 }, { mode: 'normalised' }, { aim: 'midgray-normalised' }]) expect(pdId(o), JSON.stringify(o)).toBe(base);
    for (const o of [{ lamp: 'bb3200' }, { filtration: { c: 0, m: 10, y: 0 } }]) expect(pdId(o), JSON.stringify(o)).not.toBe(base);
  });

  it('the offset is clear + κ + optics + aim lights: time and magnification shift it uniformly in real mode only', () => {
    const p0 = expose().offset;
    expose({ time_s: 20 }).offset.forEach((v, k) => expect(v - p0[k]!).toBeCloseTo(Math.log10(2), 12));
    expose({ magnification: 17 }).offset.forEach((v, k) => expect(v - p0[k]!).toBeCloseTo(-2 * Math.log10(2), 12));
    expose({ mode: 'normalised', time_s: 20 }).offset.forEach((v, k) => expect(v).toBeCloseTo(p0[k]!, 12));
    // a filter in real mode costs light at the grey card: the offset is core's x through the new pack
    const ch = makePrintChain({ data, film: FILM, paper: 'kodak_portra_endura', conv: SPEKTRAFILM, mode: 'real', filtrationShift: { c: 0, m: 10, y: 0 }, view: 'D50' });
    expose({ filtration: { c: 0, m: 10, y: 0 } }).offset.forEach((v, k) => expect(v).toBeCloseTo(ch.aimLights.apply(ch.enlarger.clear())[k]!, 12));
  });
});

describe('print.develop on the GPU (grade)', () => {
  const nodes = [
    { op: 'invert.dyes', args: { stock: FILM, scanner: 'xt5-fitted' }, id: 'dyes', inputs: [] },
    { op: 'print.expose', args: args(), id: 'expose', inputs: ['dyes'] },
  ];
  const ctx = P.ctx(nodes, 2);
  const at = (row: Float32Array, x: number, k: number): number => {
    const u = ((x - X_RANGE[0]) / (X_RANGE[1] - X_RANGE[0])) * (N1 - 1);
    const i = Math.min(N1 - 2, Math.floor(u));
    const t = u - i;
    return row[4 * i + k]! * (1 - t) + row[4 * (i + 1) + k]! * t;
  };

  it('the row is the paper as made (grade-independent); the grade lowers to γ and the upstream aim grey as pivot', () => {
    const row = P.developRow('kodak_portra_endura');
    const dev = P.env.chain(exposeSettings(args(), FILM)).develop;
    for (const x of [-1, -0.2, 0, 0.4, 1.1]) for (let k = 0; k < 3; k++) expect(Math.abs(at(row.data, x, k) - dev([x, x, x])[k]!)).toBeLessThan(2e-4);
    expect(P.grade(ctx, 2)).toBeNull();
    const g4 = P.grade(ctx, 4)!;
    expect(g4.gamma).toBe(gradeToGamma(4));
    expect(g4.gamma).toBe(1.45);
    expect(g4.pivot).toEqual(P.env.chain(exposeSettings(args(), FILM)).aimX);
    // with no print.expose upstream the pivot is spektrafilm's morph centre
    expect(P.grade(P.ctx([], 0), 0)!.pivot).toEqual([0, 0, 0]);
  });
});
