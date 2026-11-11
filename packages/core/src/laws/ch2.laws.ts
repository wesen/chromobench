// Chapter 2 laws (§2.6–2.9, guide §8.2), each with the mutant it must catch.
import type { PhysicsData } from '../data/provider.ts';
import { displayEncode, makePrintChain } from '../print/chain.ts';
import { adaptBradford, addFlare, D50, D65, observe, reflectance, whiteXYZ } from '../print/colour.ts';
import { compressOutput, DEFAULT_COMPRESS } from '../print/gamut.ts';
import { paperDeveloper } from '../print/paper.ts';
import { SPEKTRAFILM } from '../spectral/conventions.ts';
import { mulMV, type Vec3 } from '../spectral/linalg.ts';
import { encodeSRGB, XYZ_TO_SRGB } from '../print/colour.ts';
import { NW } from '../spectral/spectrum.ts';
import { defineLaw, near, type CoreLaw } from './harness.ts';

export function ch2Laws(data: PhysicsData): CoreLaw[] {
  const chain = makePrintChain({ data, film: 'kodak_portra_400', paper: 'kodak_portra_endura', conv: SPEKTRAFILM, aim: 'midgray-normalised', view: 'D50' });
  const { film, paper, enlarger } = chain;
  const develop = paperDeveloper(paper);

  const lights = defineLaw('lights', { justifies: 'a light multiplies the whole spectral sum: x(D, ℓ) = x(D, 0) + ℓ, applied before the paper curve', section: '§2.6, §2.8, §2.9' },
    { printDyes: (c: number[], l: number[]): Vec3 => develop(enlarger.exposure(c).map((v, k) => v + l[k]!)) },
    (r) => ({ c: [r.range(0, 2.5), r.range(0, 2.5), r.range(0, 2.5)], l: [r.range(-0.5, 0.5), r.range(-0.5, 0.5), r.range(-0.5, 0.5)] }),
    (im) => ({ c, l }) => {
      // Reference: scale the paper's sensitivities by 10^ℓ inside the spectral sum.
      const D = film.spectral(c);
      const L = enlarger.light;
      const x = paper.sens.map((s, k) => {
        let t = 0;
        for (let i = 0; i < NW; i++) if (film.pass[i]) t += L[i]! * 10 ** -D[i]! * s[i]! * 10 ** l[k]!;
        return Math.log10(t) + enlarger.offset_logH;
      });
      const want = develop(x);
      const got = im.printDyes(c, l);
      for (let k = 0; k < 3; k++) { const m = near(got[k]!, want[k]!, 1e-12, `paper dye ${k}`); if (m !== true) return m; }
      return true;
    },
    { name: 'lights applied as a density offset after the paper curve', patch: { printDyes: (c, l) => develop(enlarger.exposure(c)).map((v, k) => v + l[k]!) as Vec3 } });

  const normalisation = defineLaw('normalisation', { justifies: "with mid-grey geometric-mean normalisation a filter moves colour, not density: Σ_k ∂x_k/∂v = 0 at the mid-grey", section: '§2.6' },
    { offset: (r: Vec3): number => -(r[0] + r[1] + r[2]) / 3 },
    (r) => ({ c: r.range(0, 60), m: r.range(20, 90), y: r.range(20, 90), j: r.int(0, 2) }),
    (im) => ({ c, m, y, j }) => {
      const h = 0.5;
      const pack = { c, m, y };
      const keys = ['c', 'm', 'y'] as const;
      const xAt = (sgn: number): Vec3 => {
        const p = { ...pack, [keys[j]!]: pack[keys[j]!] + sgn * h };
        const e = makePrintChain({ data, film, paper, conv: SPEKTRAFILM, aim: 'midgray-normalised', filtration: p }).enlarger;
        const r = e.rawLog(e.midgray);
        const off = im.offset(r);
        return r.map((v) => v + off) as Vec3;
      };
      const xp = xAt(1);
      const xm = xAt(-1);
      const colSum = [0, 1, 2].reduce((s, k) => s + (xp[k]! - xm[k]!) / (2 * h), 0);
      return near(colSum, 0, 1e-10, `column ${j} sum`);
    },
    { name: 'geometric mean replaced by arithmetic', patch: { offset: (r) => -Math.log10((10 ** r[0] + 10 ** r[1] + 10 ** r[2]) / 3) } });

  const v = chain.viewing;
  const Wv = whiteXYZ(v);
  const flareAdapt = defineLaw('flare and adaptation', { justifies: 'Bradford is linear and maps the viewing white to D65, so flare f·W before adaptation equals f·D65 after', section: 'guide §5.4' },
    { adapt: (X: ArrayLike<number>, from: ArrayLike<number>): Vec3 => adaptBradford(X, from, D65) },
    (r) => ({ cp: [r.range(0, 2.5), r.range(0, 2.5), r.range(0, 2.5)], f: r.range(0, 0.02) }),
    (im) => ({ cp, f }) => {
      const X = observe(v, reflectance(v, cp));
      const before = im.adapt(addFlare(X, f, Wv), Wv);
      const after = addFlare(im.adapt(X, Wv), f, D65);
      for (let k = 0; k < 3; k++) { const m = near(before[k]!, after[k]!, 1e-12, `XYZ ${k}`); if (m !== true) return m; }
      return true;
    },
    { name: 'adaptation does not map white to white (assumes D50 source)', patch: { adapt: (X) => adaptBradford(X, D50, D65) } });

  const kneeLast = defineLaw('knee last', { justifies: 'the knee is the last colour operation: output.display lies in [0, 1]³ for any input', section: '§2.7' },
    { display: (X: ArrayLike<number>): Vec3 => displayEncode(X) },
    (r) => ({ X: [r.range(0, 3), r.range(0, 3), r.range(0, 3)] }),
    (im) => ({ X }) => {
      const o = im.display(X);
      return o.every((t) => t >= 0 && t <= 1) ? true : `display ${o.join(', ')} leaves the cube`;
    },
    { name: 'gain 1.25 after the knee', patch: { display: (X) => compressOutput(mulMV(XYZ_TO_SRGB, X), DEFAULT_COMPRESS).map((t) => encodeSRGB(1.25 * t)) as Vec3 } });

  return [lights, normalisation, flareAdapt, kneeLast];
}
