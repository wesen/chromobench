// CHB-010 stage 1–2 goldens (fixtures/golden/chb010-enlarger.json): the real-mode enlarger, filters,
// optics, warmth, grade and the §3.6 balance experiment, reproduced with the f64 reference.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  blackbody, CHROMOGEN, deltaE2000, exposeSpectral, gradeToGamma, gradeX, greyPatchX, holdDensity, nodePacksData, lab, Lights, lm,
  makePrintChain, observe, opticsLogH, reflectance, SPEKTRAFILM, warmthVector, type PrintChainOptions,
} from '../src/index.ts';

const fx = JSON.parse(readFileSync(new URL('../../../fixtures/golden/chb010-enlarger.json', import.meta.url), 'utf8'));
const data = nodePacksData();
const BASE: PrintChainOptions = { data, film: 'kodak_portra_400', paper: 'kodak_portra_endura', conv: SPEKTRAFILM, view: 'D50', aim: 'midgray-normalised' };
const real = (o: Partial<PrintChainOptions> = {}) => makePrintChain({ ...BASE, mode: 'real', ...o });
const norm = (o: Partial<PrintChainOptions> = {}) => makePrintChain({ ...BASE, mode: 'normalised', ...o });
const ref = real();
const refGrey = ref.print(ref.grey);
const patch = (rho: number): number => (rho === 0.18 ? 0 : Math.log10(rho / 0.184));

/** §3.6: worst ΔE00 over the grey scale for printer lights and for a paper-dye density shift fitted on the grey card. */
function balanceExperiment(): { lights: number; density: number; densityWhite: number } {
  const ch = makePrintChain({ data, film: 'kodak_portra_400', paper: 'kodak_portra_endura', conv: CHROMOGEN, lamp: 'bb3200', filtration: { c: 0, m: 0, y: 0 }, view: 'bb5000', aim: 'grey-0.184' });
  const E55 = blackbody(5500).values;
  const E38 = blackbody(3800).values;
  const u0 = (rho: number, E: Float64Array) => exposeSpectral(ch.film, E.map((e) => e * rho), { illuminant: E55, grey: 0.184 });
  const g38 = u0(0.184, E38);
  const m38 = (g38[0] + g38[1] + g38[2]) / 3;
  const uCast = (rho: number) => u0(rho, E38).map((v) => v - m38);
  const cpOf = (u: number[]) => ch.develop(ch.aimLights.apply(ch.enlarger.exposure(ch.film.develop(u))));
  const xyzCp = (cp: number[]) => observe(ch.viewing, reflectance(ch.viewing, cp.map((v) => Math.max(0, v))));
  const cpGrey = cpOf(uCast(0.184));
  const dCp = lm((d) => { const X = xyzCp(cpGrey.map((v, k) => v + d[k]!)); return [0, 1, 2].map((k) => X[k]! / ch.white[k]! - 0.184); }, [0, 0, 0], { tol: 1e-20, maxIt: 100 }).x;
  const Lfit = greyPatchX(ch.enlarger.exposure(ch.film.develop(uCast(0.184))), ch.xyzOfX, ch.white);
  let lights = 0, density = 0, densityWhite = 0;
  for (let i = 0; i <= 110; i++) {
    const s = -3 + i * 0.05;
    const rho = 0.184 * 10 ** s;
    const want = lab(ch.xyzOfX(ch.aimLights.apply(ch.enlarger.exposure(ch.film.develop(u0(rho, E55))))), ch.white);
    lights = Math.max(lights, deltaE2000(want, lab(ch.xyzOfX(Lfit.apply(ch.enlarger.exposure(ch.film.develop(uCast(rho))))), ch.white)));
    const eD = deltaE2000(want, lab(xyzCp(cpOf(uCast(rho)).map((v, k) => v + dCp[k]!)), ch.white));
    density = Math.max(density, eD);
    if (s >= 1) densityWhite = Math.max(densityWhite, eD);
  }
  return { lights, density, densityWhite };
}
let balance: ReturnType<typeof balanceExperiment> | undefined;

function compute(e: any): unknown {
  switch (e.what) {
    case 'neutralPack': { const p = data.neutralFilter('kodak_portra_endura', 'kodak_portra_400')!; return [p.c, p.m, p.y]; }
    case 'grey': return e.field === 'Dvis' ? refGrey.Dvis : refGrey.lab;
    case 'paperWhiteY': return ref.paperWhite[1];
    case 'J': return (e.mode === 'real' ? ref : norm()).enlarger.dxdCC(ref.film.spectral(ref.grey));
    case 'red10': { const p = ref.print(ref.grey, Lights.fromPoints([10, 0, 0])); return { Dvis: p.Dvis, a: p.lab[1] }; }
    case 'optics': return opticsLogH(e.to) - opticsLogH(e.from);
    case 'timeFactor': return 10 ** (opticsLogH(e.from) - opticsLogH(e.to));
    case 'warmth': return warmthVector(makePrintChain({ ...BASE, aim: 'grey-0.184' }));
    case 'timeStrip': return e.expect.map((row: number[]) => {
      const ch = real({ optics: { time_s: 10 * 2 ** (Math.round(3 * Math.log2(row[0]! / 10)) / 3) } });
      return [row[0], ...[0.9, 0.18, 0.03].map((rho) => { const u = patch(rho); return ch.print(ch.film.develop([u, u, u])).Dvis; })];
    });
    case 'grade': return e.expect.map((row: number[]) => {
      const g = gradeToGamma(row[0]!);
      return [row[0], ...[0.9, 0.18, 0.03].map((rho) => { const u = patch(rho); return -Math.log10(ref.xyzOfX(gradeX(ref.xOfDyes(ref.film.develop([u, u, u])), g, ref.aimX))[1]); })];
    });
    case 'balance': balance ??= balanceExperiment(); return balance[e.field as 'lights'];
    default: throw new Error(`unknown kind ${e.what}`);
  }
}

describe('CHB-010 goldens: the real-mode enlarger and balance', () => {
  for (const e of fx.entries) {
    if (e.what === 'filter10') continue;
    it(`${e.id} (${e.section})`, () => {
      const got = compute(e);
      if (e.what === 'red10') {
        const g = got as { Dvis: number; a: number };
        expect(Math.abs(g.Dvis - e.expect.Dvis)).toBeLessThanOrEqual(0.003);
        expect(Math.abs(g.a - e.expect.a)).toBeLessThanOrEqual(0.1);
        return;
      }
      const g = [got].flat(2) as number[];
      const x = [e.expect].flat(2) as number[];
      expect(g.length).toBe(x.length);
      g.forEach((v, i) => expect(Math.abs(v - x[i]!), `${e.id}[${i}] got ${v} expected ${x[i]}`).toBeLessThanOrEqual(e.tol + 1e-12));
    });
  }
  for (const e of fx.entries.filter((q: any) => q.what === 'filter10')) {
    it(`${e.id}: Δx, density and colour in both modes, and the time that holds density (${e.section})`, () => {
      const sh = { c: 0, m: 0, y: 0, [e.filter]: 10 };
      const r = real({ filtrationShift: sh });
      const pr = r.print(r.grey);
      const pn = norm({ filtrationShift: sh }).print(r.grey);
      pr.x.forEach((v, k) => expect(Math.abs((v - refGrey.x[k]!) / 0.025 - e.expect.dx_pt[k]), `dx[${k}]`).toBeLessThanOrEqual(0.011));
      expect(Math.abs(pr.Dvis - refGrey.Dvis - e.expect.realDvis)).toBeLessThanOrEqual(0.003);
      expect(Math.abs(pn.Dvis - refGrey.Dvis - e.expect.normDvis)).toBeLessThanOrEqual(0.003);
      const [ax, v] = e.expect.colour as ['a' | 'b', number];
      expect(Math.abs(pr.lab[ax === 'a' ? 1 : 2] - v)).toBeLessThanOrEqual(0.1);
      const hold = holdDensity(r, refGrey.Dvis);
      expect(Math.abs(hold.factor - e.expect.timeFactor)).toBeLessThanOrEqual(0.001);
      // the time found holds the grey's visual density on a rebuilt chain, not only on the light shift
      const back = real({ filtrationShift: sh, optics: { time_s: 10 * hold.factor } });
      expect(back.print(back.grey).Dvis).toBeCloseTo(refGrey.Dvis, 9);
    });
  }
});
