// §3.6 balance: a grey scale shot under 3,800 K on Portra 400 (balanced for 5,500 K), printed on Portra
// Endura with a 3,200 K lamp and viewed at 5,000 K (CHROMOGEN conventions, Figure 3.5 setup).
import { describe, expect, it } from 'vitest';
import {
  blackbody, CHROMOGEN, deltaE2000, exposeSpectral, greyPatchX, integrateToGrey, nodePacksData, lab, latdFromPD, Lights, lightsToSliders,
  colourOffset, makePrintChain, greyPick,
} from '../src/index.ts';

const data = nodePacksData();
const ch = makePrintChain({ data, film: 'kodak_portra_400', paper: 'kodak_portra_endura', conv: CHROMOGEN, lamp: 'bb3200', filtration: { c: 0, m: 0, y: 0 }, view: 'bb5000', aim: 'grey-0.184' });
const E55 = blackbody(5500).values;
const E38 = blackbody(3800).values;
const u0 = (rho: number, E: Float64Array) => exposeSpectral(ch.film, E.map((e) => e * rho), { illuminant: E55, grey: 0.184 });
const g38 = u0(0.184, E38);
const m38 = (g38[0] + g38[1] + g38[2]) / 3;
// The cast as a pure colour shift (mean removed), which is how §3.6 states it.
const uCast = (rho: number) => u0(rho, E38).map((v) => v - m38);

describe('§3.6 balance on a 3,800 K cast', () => {
  it('layer shifts (+0.166, +0.021, −0.187)', () => {
    const s = uCast(0.184);
    [0.166, 0.021, -0.187].forEach((v, k) => expect(Math.abs(s[k]! - v)).toBeLessThan(6e-4));
  });
  it('lights fitted on the grey card move by (+0.085, +0.002, −0.079) and leave ≤ 2.4 ΔE00 on the scale', () => {
    const Lfit = greyPatchX(ch.enlarger.exposure(ch.film.develop(uCast(0.184))), ch.xyzOfX, ch.white);
    [0.085, 0.002, -0.079].forEach((v, k) => expect(Math.abs(Lfit.logH[k]! - ch.aimLights.logH[k]! - v)).toBeLessThan(6e-4));
    let worst = 0;
    for (let s = -3; s <= 2.5001; s += 0.05) {
      const rho = 0.184 * 10 ** s;
      const ref = ch.xyzOfX(ch.aimLights.apply(ch.enlarger.exposure(ch.film.develop(u0(rho, E55)))));
      const got = ch.xyzOfX(Lfit.apply(ch.enlarger.exposure(ch.film.develop(uCast(rho)))));
      worst = Math.max(worst, deltaE2000(lab(ref, ch.white), lab(got, ch.white)));
    }
    expect(Math.abs(worst - 2.4)).toBeLessThan(0.06);
  });
  it('integrate-to-grey: α = 1 removes the colour of a uniform cast frame; the mean goes into density', () => {
    const aimLatd = [0.5, 0.6, 0.7];
    const L = integrateToGrey([0.6, 0.6, 0.6], { latd: aimLatd, lights: Lights.zero() }, 1);
    [0.1, 0, -0.1].forEach((v, k) => expect(L.logH[k]).toBeCloseTo(v, 12));
    const half = integrateToGrey([0.6, 0.6, 0.6], { latd: aimLatd, lights: Lights.zero() }, 0);
    half.logH.forEach((v) => expect(v).toBeCloseTo(0, 12));
    expect(latdFromPD([0, 0, 0, 1, 1, 1], 2)).toEqual([-Math.log10(0.55), -Math.log10(0.55), -Math.log10(0.55)]);
  });
  it('grey pick neutralises a cast patch without moving the mean light; sliders round-trip', () => {
    const c = ch.film.develop(uCast(0.184));
    const L = greyPick(ch, c, Lights.zero());
    const p = ch.print(c, L);
    expect(Math.hypot(p.lab[1], p.lab[2])).toBeLessThan(1e-5);
    expect(L.logH[0] + L.logH[1] + L.logH[2]).toBeCloseTo(0, 12);
    const wpm = [0.004, 0, -0.004];
    const o = colourOffset(3, -2, wpm);
    const s = lightsToSliders(o, wpm);
    expect(s.warmth).toBeCloseTo(3, 9);
    expect(s.tint).toBeCloseTo(-2, 9);
    expect(s.exposure).toBeCloseTo(0, 9);
  });
});
