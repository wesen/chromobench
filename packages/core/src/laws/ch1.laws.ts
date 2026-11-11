// Chapter 1 laws (§1.9, guide §8.2), each with the mutant it must catch.
import { fail } from '@chromobench/contract';
import type { PhysicsData } from '../data/provider.ts';
import { makeScanner } from '../scan/scanner.ts';
import { Channels, hessian, readStock, relativeTo, statusM } from '../spectral/channels.ts';
import { CHROMOGEN, SPEKTRAFILM } from '../spectral/conventions.ts';
import { symEig3, type Mat3 } from '../spectral/linalg.ts';
import { metamericBlack } from '../spectral/metamer.ts';
import { resolveStock, type Stock } from '../spectral/stock.ts';
import { blackbody, NW, Spectrum } from '../spectral/spectrum.ts';
import { addQ, q } from '../spectral/units.ts';
import { defineLaw, near, type CoreLaw, type Rng } from './harness.ts';

const dyes3 = (r: Rng, hi = 2.5): number[] => [r.range(0, hi), r.range(0, hi), r.range(0, hi)];

export function ch1Laws(data: PhysicsData): CoreLaw[] {
  const stocks: Stock[] = ['kodak_portra_400', 'kodak_gold_200', 'fujifilm_c200'].flatMap((id) => [resolveStock(data.stock(id), CHROMOGEN), resolveStock(data.stock(id), SPEKTRAFILM)]);
  const channels: Channels[] = ['rgb-led-book', 'white-led', 'xt5-fitted'].map((id) => makeScanner(data, id).channels).concat(statusM());
  const pick = (r: Rng): { s: number; k: number; c: number[] } => ({ s: r.int(0, stocks.length - 1), k: r.int(0, channels.length - 1), c: dyes3(r) });
  const cmf = data.cmf();
  const E = blackbody(5000).values;
  const A = cmf.map((x) => x.map((v, i) => v * E[i]!));

  const bounds = defineLaw('bounds', { justifies: 'a channel density is a weighted soft minimum: min D ≤ read ≤ Σ w D', section: '§1.3, §1.9' },
    { read: (P: Channels, D: ArrayLike<number>) => P.read(D) },
    (r) => ({ k: r.int(0, channels.length - 1), D: Array.from({ length: 6 }, () => r.range(0, 3)), seed: r.int(0, 1e6) }),
    (im) => ({ k, D, seed }) => {
      const P = channels[k]!;
      const Dfull = Float64Array.from({ length: NW }, (_, i) => D[(i * 7 + seed) % D.length]!);
      const got = im.read(P, Dfull);
      for (let ch = 0; ch < 3; ch++) {
        let mn = Infinity;
        let mean = 0;
        P.P[ch]!.forEach((w, i) => { if (w > 0) mn = Math.min(mn, Dfull[i]!); mean += w * Dfull[i]!; });
        if (got[ch]! < mn - 1e-12) return `channel ${ch}: ${got[ch]} below min ${mn}`;
        if (got[ch]! > mean + 1e-12) return `channel ${ch}: ${got[ch]} above weighted mean ${mean}`;
        if (mean - mn > 0.05 && got[ch]! > mean - 1e-6) return `channel ${ch}: read equals the weighted mean (${mean}): not a soft minimum`;
      }
      return true;
    },
    { name: 'read returns the weighted mean', patch: { read: (P, D) => P.P.map((p) => p.reduce((s, w, i) => s + w * D[i]!, 0)) as never } });

  const baseRel = defineLaw('base relativity', { justifies: 'subtracting the rebate reading is reading through P·10^−b renormalised', section: '§1.6, §1.9' },
    { relativeTo: (P: Channels, b: ArrayLike<number>) => relativeTo(P, b) },
    pick,
    (im) => ({ s, k, c }) => {
      const st = stocks[s]!;
      const P = channels[k]!.masked(st.pass);
      const D = st.spectral(c);
      const dyesOnly = D.map((v, i) => (st.pass[i] ? v - st.base[i]! : 0));
      const lhs = P.read(D).map((v, j) => v - P.read(st.base)[j]!);
      const rhs = im.relativeTo(P, st.base).read(dyesOnly);
      for (let j = 0; j < 3; j++) { const m = near(lhs[j]!, rhs[j]!, 1e-12, `channel ${j}`); if (m !== true) return m; }
      return true;
    },
    { name: 'relativeTo forgets to renormalise', patch: { relativeTo: (P, b) => new Channels(P.P.map((p) => p.map((v, i) => v * 10 ** -b[i]!)) as never, 'bad', false) } });

  const concave = defineLaw('concavity', { justifies: 'the Hessian is −ln10 times a covariance: no positive eigenvalue; matches finite differences', section: '§1.3, §1.9' },
    { hessian: (P: Channels, st: Stock, c: number[], k: 0 | 1 | 2): Mat3 => hessian(P, st, c, k) },
    pick,
    (im) => ({ s, k, c }) => {
      const st = stocks[s]!;
      const P = channels[k]!;
      for (const ch of [0, 1, 2] as const) {
        const H = im.hessian(P, st, c, ch);
        const ev = symEig3(H);
        if (ev[2] > 1e-9) return `channel ${ch}: positive eigenvalue ${ev[2]}`;
        const h = 1e-4;
        for (let j = 0; j < 3; j++) {
          const cp = c.slice(); cp[j]! += h;
          const cm = c.slice(); cm[j]! -= h;
          const d2 = (readStock(P, st, cp)[ch]! - 2 * readStock(P, st, c)[ch]! + readStock(P, st, cm)[ch]!) / (h * h);
          const m = near(H[j]![j]!, d2, 1e-4 + 1e-3 * Math.abs(d2), `H[${j}][${j}] vs finite difference`);
          if (m !== true) return m;
        }
      }
      return true;
    },
    { name: 'sign flip in the covariance', patch: { hessian: (P, st, c, k) => hessian(P, st, c, k).map((r) => r.map((v) => -v)) as Mat3 } });

  const metamer = defineLaw('metamerism', { justifies: 'a metameric black leaves XYZ unchanged but changes film exposure', section: '§1.8, §1.9' },
    { black: (Am: Float64Array[], p: ArrayLike<number>) => metamericBlack(Am, p) },
    (r) => ({ amp: r.range(0.02, 0.1), period: r.range(80, 300), phase: r.range(0, 6.28) }),
    (im) => ({ amp, period, phase }) => {
      const p = Float64Array.from({ length: NW }, (_, i) => amp * Math.sin((2 * Math.PI * (380 + 5 * i)) / period + phase));
      const b = im.black(A, p);
      for (let k = 0; k < 3; k++) {
        const xyz = cmf[k]!.reduce((s, v, i) => s + v * E[i]! * b[i]!, 0) / cmf[1]!.reduce((s, v, i) => s + v * E[i]!, 0);
        if (Math.abs(xyz) > 1e-12) return `XYZ[${k}] changed by ${xyz}`;
      }
      return true;
    },
    { name: 'projection uses the plain CMFs instead of light × CMF', patch: { black: (_Am, p) => metamericBlack(cmf, p) } });

  const guards = {
    mulDensity: () => new Spectrum(new Array(NW).fill(1), 'density').mul(new Spectrum(new Array(NW).fill(1), 'transmittance')),
    addTransmittance: () => new Spectrum(new Array(NW).fill(1), 'transmittance').add(new Spectrum(new Array(NW).fill(1), 'transmittance')),
    addDlogH: () => addQ(q(1, 'D'), q(0.1, 'logH')),
  };
  const kinds = defineLaw('kinds and units', { justifies: 'transmittances multiply, densities add; D + logH is a type error (Hunt 14.17)', section: '§1.1' },
    guards,
    (r) => ({ which: r.int(0, 2) }),
    (im) => ({ which }) => {
      const f = [im.mulDensity, im.addTransmittance, im.addDlogH][which]!;
      try { f(); } catch { return true; }
      return `guard ${which} did not throw`;
    },
    { name: 'D + logH guard removed', patch: { addDlogH: () => q(1.1, 'D') } });

  const flatWedge = defineLaw('flat wedge', { justifies: 'a spectrally flat density d reads d in every channel of every Channels', section: '§3.7, §3.9' },
    { make: (P: Channels) => P },
    (r) => ({ k: r.int(0, channels.length - 1), d: r.range(0, 3) }),
    (im) => ({ k, d }) => {
      const got = im.make(channels[k]!).read(new Float64Array(NW).fill(d));
      for (let j = 0; j < 3; j++) { const m = near(got[j]!, d, 1e-12, `channel ${j}`); if (m !== true) return m; }
      return true;
    },
    { name: 'channels not normalised', patch: { make: (P) => new Channels(P.P.map((p) => p.map((v) => v * 1.3)) as never, 'bad', false) } });

  if (stocks.length === 0) fail('E_INTERNAL', 'no stocks');
  return [bounds, baseRel, concave, metamer, kinds, flatWedge];
}
