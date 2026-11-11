// Chapter 2 goldens (fixtures/golden/core/ch2.json).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  adaptBradford, addFlare, CHROMOGEN, encodeSRGB, greyPatchX, hex, interimData, knee, lab, Lights, makeEnlarger,
  makePrintChain, mulMV, paperDevelop, paperSlope, SPEKTRAFILM, whiteXYZ, XYZ_TO_SRGB, type Conventions,
} from '../src/index.ts';

const fx = JSON.parse(readFileSync(new URL('../../../fixtures/golden/core/ch2.json', import.meta.url), 'utf8'));
const data = interimData();
const CONV: Record<string, Conventions> = {
  SPEKTRAFILM, CHROMOGEN, 'SPEKTRAFILM+fit': { ...SPEKTRAFILM, cmf: 'chromogen-fit' }, 'SPEKTRAFILM/none': { ...SPEKTRAFILM, printNormalise: 'none' },
};
const chain = (e: any) => makePrintChain({ data, film: 'kodak_portra_400', paper: 'kodak_portra_endura', conv: CONV[e.conventions ?? 'SPEKTRAFILM']!, view: e.view ?? 'D50', aim: 'midgray-normalised' });
const greyXYZ: [number, number, number] = [0.1706, 0.175, 0.1686];

function compute(e: any): unknown {
  switch (e.what) {
    case 'neutralPack': { const p = data.neutralFilter('kodak_portra_endura', 'kodak_portra_400')!; return [p.c, p.m, p.y]; }
    case 'midgrayX': { const ch = chain(e); return ch.enlarger.exposureOfDensity(ch.enlarger.midgray); }
    case 'dxdCC': return chain(e).enlarger.dxdCC();
    case 'paperDyesMid': { const ch = chain(e); return paperDevelop(ch.paper.data.curveModel!, ch.enlarger.exposureOfDensity(ch.enlarger.midgray)); }
    case 'paperSlopesMid': { const ch = chain(e); return paperSlope(ch.paper.data.curveModel!, ch.enlarger.exposureOfDensity(ch.enlarger.midgray)); }
    case 'greyDvis': { const ch = chain(e); return ch.print(ch.film.develop([0, 0, 0])).Dvis; }
    case 'greyAB': { const ch = chain(e); const l = ch.print(ch.film.develop([0, 0, 0])).lab; return [l[1], l[2]]; }
    case 'chainSlope': {
      const ch = chain(e);
      const L = Math.log10(2);
      const D = (u: number): number => -Math.log10(addFlare(ch.print(ch.film.develop([u, u, u])).XYZ, e.flare, ch.paperWhite)[1]);
      return (D(-L / 2) - D(L / 2)) / L;
    }
    case 'paperWhiteY': return chain(e).paperWhite[1];
    case 'blackDvis': { const ch = chain(e); return -Math.log10(addFlare(ch.print([0, 0, 0]).XYZ, e.flare, ch.paperWhite)[1]); }
    case 'gmFlare': { const W = 10 ** -0.12; return -Math.log10(addFlare([0, 10 ** -e.D, 0], 0.01, [0, W, 0])[1]); }
    case 'adapt': case 'linear': case 'encoded': case 'hex': {
      const W = whiteXYZ({ illuminant: data.illuminant(e.view), cmf: data.cmf(), paper: chain(e).paper });
      const a = adaptBradford(greyXYZ, W);
      const lin = mulMV(XYZ_TO_SRGB, a);
      const enc = lin.map(encodeSRGB);
      return { adapt: a, linear: lin, encoded: enc, hex: hex(enc) }[e.what as 'adapt'];
    }
    case 'knee': return [0.5, 0.8, 1, 2].map((d) => knee(d, 0, 1, 6));
    case 'kneeGain': return [1.25 * knee(0.9, 0, 1, 6), knee(1.25 * 0.9, 0, 1, 6)];
    case 'red10': {
      const ch = chain(e);
      const cg = ch.film.develop([0, 0, 0]);
      const F = (X: number[]) => addFlare(X, e.flare, ch.paperWhite);
      const p0 = F(ch.print(cg).XYZ);
      const p1 = F(ch.print(cg, Lights.fromPoints([10, 0, 0])).XYZ);
      return [-Math.log10(p0[1]), -Math.log10(p1[1]), lab(p1, ch.white)[1]];
    }
    case 'greyPatch': {
      const ch = makePrintChain({ data, film: 'kodak_portra_400', paper: 'kodak_portra_endura', conv: CHROMOGEN, lamp: 'bb3200', filtration: { c: 0, m: 0, y: 0 }, view: e.view, aim: 'midgray-normalised' });
      return greyPatchX(ch.enlarger.exposure([0.687, 0.704, 0.864]), ch.xyzOfX, ch.white).logH;
    }
    default: throw new Error(`unknown kind ${e.what}`);
  }
}

describe('chapter 2 goldens', () => {
  for (const e of fx.entries) {
    it(`${e.id} (${e.section})`, () => {
      const got = compute(e);
      if (typeof e.expect === 'string') return expect(got).toBe(e.expect);
      const g = [got].flat(2) as number[];
      const x = [e.expect].flat(2) as number[];
      expect(g.length).toBe(x.length);
      g.forEach((v, i) => {
        const tol = e.tolDensity && i < 2 ? e.tolDensity : e.tol;
        expect(Math.abs(v - x[i]!), `${e.id}[${i}] got ${v} expected ${x[i]}`).toBeLessThanOrEqual(tol + 1e-12);
      });
    });
  }
  it('real mode: filter changes move density; normalised mode does not (mean x of the mid-grey stays 0)', () => {
    const ch = makePrintChain({ data, film: 'kodak_portra_400', paper: 'kodak_portra_endura', conv: SPEKTRAFILM, aim: 'midgray-normalised', filtrationShift: { c: 0, m: 0, y: 10 } });
    const x = ch.enlarger.exposureOfDensity(ch.enlarger.midgray);
    expect(Math.abs(x[0] + x[1] + x[2])).toBeLessThan(1e-12);
    const real = makePrintChain({ data, film: 'kodak_portra_400', paper: 'kodak_portra_endura', conv: SPEKTRAFILM, aim: 'midgray-normalised', filtrationShift: { c: 0, m: 0, y: 10 }, mode: 'real', real: { time_s: 10, fstop: 8 } });
    const xr = real.enlarger.exposureOfDensity(real.enlarger.midgray);
    expect(xr[2]).toBeLessThan(-0.09);
    const e = makeEnlarger({ ...real.enlarger.setup, real: { ...real.enlarger.setup.real!, time_s: 20 } });
    expect(e.offset_logH - real.enlarger.offset_logH).toBeCloseTo(Math.log10(2), 12);
  });
  it("aim 'grey-0.184' prints the grey card neutral at 18.4 %", () => {
    const ch = makePrintChain({ data, film: 'kodak_portra_400', paper: 'kodak_portra_endura', conv: SPEKTRAFILM });
    const p = ch.print(ch.film.develop([0, 0, 0]));
    expect(Math.abs(p.lab[1]) + Math.abs(p.lab[2])).toBeLessThan(1e-6);
    expect(p.XYZ[1]).toBeCloseTo(0.184, 9);
  });
});
