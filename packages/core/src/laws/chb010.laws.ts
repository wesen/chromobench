// CHB-010 laws (guide §9.1), each with the mutant it must catch: the calibration, the scalar κ, the
// optics and the grade pivot.
import { lightH } from '@chromobench/contract';
import type { PhysicsData } from '../data/provider.ts';
import { makePrintChain, type PrintChain, type PrintChainOptions } from '../print/chain.ts';
import { opticsLogH, type EnlargerOptics } from '../print/enlarger.ts';
import { gradeX } from '../print/paper.ts';
import { maskExposure } from '../print/densityMask.ts';
import { gaussianBlur1 } from '../print/masks.ts';
import { SPEKTRAFILM } from '../spectral/conventions.ts';
import type { Vec3 } from '../spectral/linalg.ts';
import { defineLaw, near, type CoreLaw } from './harness.ts';

type Cmy = { c: number; m: number; y: number };

export function chb010Laws(data: PhysicsData): CoreLaw[] {
  const O: PrintChainOptions = { data, film: 'kodak_portra_400', paper: 'kodak_portra_endura', conv: SPEKTRAFILM, view: 'D50' };
  const neutral = data.neutralFilter('kodak_portra_endura', 'kodak_portra_400')!;
  const ref = makePrintChain({ ...O, mode: 'real' });
  const Dgrey = ref.film.spectral(ref.grey);
  const shiftGen = (r: { range(a: number, b: number): number }): Cmy => ({ c: r.range(0, 30), m: r.range(-30, 30), y: r.range(-30, 30) });

  const calibration = defineLaw('filters cost light', {
    justifies: 'the aim is fitted once at the calibration: in real mode a filter change moves the grey card by exactly the change of the raw spectral sum',
    section: 'CHB-010 §3.1, §6.3',
  },
  { chainAt: (sh: Cmy): PrintChain => makePrintChain({ ...O, mode: 'real', filtrationShift: sh }) },
  (r) => shiftGen(r),
  (im) => (sh) => {
    const ch = im.chainAt(sh);
    const got = ch.xOfDyes(ch.grey);
    const x0 = ref.xOfDyes(ref.grey);
    const r1 = ch.enlarger.rawLog(Dgrey);
    const r0 = ref.enlarger.rawLog(Dgrey);
    for (let k = 0; k < 3; k++) { const m = near(got[k]! - x0[k]!, r1[k]! - r0[k]!, 1e-12, `Δx[${k}]`); if (m !== true) return m; }
    return true;
  },
  { name: 'aim lights refitted at every pack (the pre-CHB-010 chain)', patch: { chainAt: (sh) => makePrintChain({ ...O, mode: 'real', filtrationShift: sh, referencePack: { c: neutral.c + sh.c, m: neutral.m + sh.m, y: neutral.y + sh.y } }) } });

  const scalarKappa = defineLaw('real vs normalised', {
    justifies: 'the two modes differ by one scalar per setting (κ), never per layer: a per-layer κ would absorb every filter',
    section: 'CHB-010 §3.1, §9.1',
  },
  { realOffset: (ch: PrintChain): Vec3 => { const o = ch.enlarger.offset_logH; return [o, o, o]; } },
  (r) => ({ sh: shiftGen(r), c: [r.range(0, 2.5), r.range(0, 2.5), r.range(0, 2.5)] }),
  (im) => ({ sh, c }) => {
    const rch = makePrintChain({ ...O, mode: 'real', filtrationShift: sh, optics: { time_s: 14 } });
    const nch = makePrintChain({ ...O, mode: 'normalised', filtrationShift: sh });
    const D = rch.film.spectral(c);
    const raw = rch.enlarger.rawLog(D);
    const off = im.realOffset(rch);
    const xr = raw.map((v, k) => v + off[k]!);
    const xn = nch.enlarger.exposureOfDensity(D);
    const d0 = xr[0]! - xn[0]!;
    for (let k = 1; k < 3; k++) { const m = near(xr[k]! - xn[k]!, d0, 1e-12, `real − normalised in layer ${k}`); if (m !== true) return m; }
    return true;
  },
  { name: 'per-layer κ in real mode (each layer normalised at the calibration pack)', patch: { realOffset: (ch) => ch.reference.enlarger.rawLog(ch.enlarger.midgray).map((v) => -v + ch.enlarger.optics_logH) as Vec3 } });

  const optics = defineLaw('optics', {
    justifies: 'light on the paper ∝ t / (N²·(m + 1)²): time, aperture and head height are exact log-exposure offsets',
    section: 'CHB-010 §2.2',
  },
  { optics: (o: Partial<EnlargerOptics>): number => opticsLogH(o) },
  (r) => ({ time_s: 10 * 2 ** r.range(-3, 3), fstop: 8 * 2 ** r.range(-1, 2), magnification: r.range(0.5, 20) }),
  (im) => (o) => {
    const H = 10 ** im.optics(o) * o.fstop ** 2 * (o.magnification + 1) ** 2 / o.time_s;
    return near(H, 8 ** 2 * 9 ** 2 / 10, 1e-9, 'H·N²(m+1)²/t');
  },
  { name: 'magnification as 1/m² instead of 1/(m + 1)²', patch: { optics: (o) => Math.log10(o.time_s! / 10) - 2 * Math.log10(o.fstop! / 8) - 2 * Math.log10(o.magnification! / 8) } });

  const gradePivot = defineLaw('grade pivot', {
    justifies: 'the grade is a gamma about the aim grey: changing it leaves the grey card print unchanged',
    section: 'CHB-010 §6.8',
  },
  { pivot: (ch: PrintChain): Vec3 => ch.aimX },
  (r) => ({ g: r.range(0.7, 1.8) }),
  (im) => ({ g }) => {
    const want = ref.develop(ref.xOfDyes(ref.grey));
    const got = ref.develop(gradeX(ref.xOfDyes(ref.grey), g, im.pivot(ref)));
    for (let k = 0; k < 3; k++) { const m = near(got[k]!, want[k]!, 1e-12, `grey paper dye ${k}`); if (m !== true) return m; }
    return true;
  },
  { name: "spektrafilm's morph centre x = 0 as the pivot", patch: { pivot: () => [0, 0, 0] } });

  return [calibration, scalarKappa, optics, gradePivot, ...exposureLaws(ref)];
}

/** A burn (+1) or dodge (−1) of mask value m and seconds ratio r (the light law's weight w = m·r). */
interface CombineTerm { x: ArrayLike<number>; m: number; sign: 1 | -1; ratio: number }
type Combine = (xMain: ArrayLike<number>, terms: readonly CombineTerm[], out: number[]) => unknown;

/** The contract's light law (lightH) for the main exposure with burns and dodges. */
const combinePixel: Combine = (xMain, terms, out) => lightH({
  xMain, wMain: 1, densities: [], filters: [], preflash: [],
  terms: terms.map((t) => ({ role: t.sign < 0 ? 'dodge' : 'burn', x: t.x, w: t.m * t.ratio })),
}, out);

/** A log-domain burn/dodge: each exposure as x + m·log10(1 ± r·10^(x_i − x)), applied in order on the running x. */
const logDomainCombine: Combine = (xMain, terms, out) => {
  for (let k = 0; k < 3; k++) {
    let x = xMain[k]!;
    for (const t of terms) x += t.m * Math.log10(Math.max(1 + t.sign * t.ratio * 10 ** (t.x[k]! - x), 1e-8));
    out[k] = x;
  }
};

/** Stage 3–4 laws (guide §9.1): linear sum, same-pack merge, dodge/burn cancel, neutral mask, mask blur in linear light. */
function exposureLaws(ref: PrintChain): CoreLaw[] {
  const vec = (r: { range(a: number, b: number): number }, lo: number, hi: number): Vec3 => [r.range(lo, hi), r.range(lo, hi), r.range(lo, hi)];

  const linearSum = defineLaw('linear sum', {
    justifies: 'exposures add in linear H and the log is taken once: a burn of s stops at mask m adds log10(1 + m(2^s − 1)); two equal exposures add exactly 0.30103',
    section: 'CHB-010 §6.5 finding 1, §9.1',
  },
  { combine: combinePixel },
  (r) => ({ x: vec(r, -2, 1), m: r.range(0, 1), s: r.range(0.1, 2) }),
  (im) => ({ x, m, s }) => {
    const out = [0, 0, 0];
    im.combine(x, [{ x, m, sign: 1, ratio: 2 ** s - 1 }], out);
    const two = [0, 0, 0];
    im.combine(x, [{ x, m: 1, sign: 1, ratio: 1 }], two);
    for (let k = 0; k < 3; k++) {
      let q = near(out[k]! - x[k]!, Math.log10(1 + m * (2 ** s - 1)), 1e-12, `burn layer ${k}`);
      if (q !== true) return q;
      q = near(two[k]! - x[k]!, Math.log10(2), 1e-12, `doubled layer ${k}`);
      if (q !== true) return q;
    }
    return true;
  },
  { name: 'log-domain burns (m·s·log10 2 at mask m)', patch: { combine: (xMain, terms, out) => { for (let k = 0; k < 3; k++) out[k] = xMain[k]! + terms.reduce((a, t) => a + t.sign * t.m * Math.log10(1 + t.ratio), 0); } } });

  const merge = defineLaw('same-pack exposures merge', {
    justifies: 'two exposures through one pack equal one exposure of the summed seconds, pixel by pixel (real mode: time is an exact log offset)',
    section: 'CHB-010 §6.5, §9.1',
  },
  { combine: combinePixel },
  (r) => ({ c: vec(r, 0, 2.5), t1: r.range(1, 30), t2: r.range(0.5, 30) }),
  (im) => ({ c, t1, t2 }) => {
    const x = (t: number): Vec3 => { const x0 = ref.xOfDyes(c); const o = opticsLogH({ time_s: t }); return [x0[0] + o, x0[1] + o, x0[2] + o]; };
    const out = [0, 0, 0];
    im.combine(x(t1), [{ x: x(t2), m: 1, sign: 1, ratio: 1 }], out);
    const want = x(t1 + t2);
    for (let k = 0; k < 3; k++) { const q = near(out[k]!, want[k]!, 1e-12, `layer ${k}`); if (q !== true) return q; }
    return true;
  },
  { name: 'summing log exposures', patch: { combine: (xMain, terms, out) => { for (let k = 0; k < 3; k++) out[k] = xMain[k]! + terms.reduce((a, t) => a + t.sign * t.m * t.x[k]!, 0); } } });

  const cancel = defineLaw('dodge and burn cancel', {
    justifies: 'dodging a region by t seconds and burning it by t through the same pack returns the original print (dodges withhold main light, they do not change the filter)',
    section: 'CHB-010 §6.5, §9.1',
  },
  { combine: combinePixel },
  (r) => ({ x: vec(r, -2, 1), q: r.range(0.01, 0.9), m: r.range(0, 1) }),
  (im) => ({ x, q, m }) => {
    const xe = x.map((v) => v + Math.log10(q));
    const out = [0, 0, 0];
    im.combine(x, [{ x: xe, m, sign: -1, ratio: 1 }, { x: xe, m, sign: 1, ratio: 1 }], out);
    for (let k = 0; k < 3; k++) { const v = near(out[k]!, x[k]!, 1e-12, `layer ${k}`); if (v !== true) return v; }
    return true;
  },
  { name: 'dodge and burn applied in the log domain, one after the other', patch: { combine: logDomainCombine } });

  const neutralMask = defineLaw('neutral mask is a light', {
    justifies: 'a flat density d added to D(λ) equals −d added to every paper layer: a silver mask is a per-pixel printer light',
    section: 'CHB-010 §6.6, §9.1',
  },
  { addMask: (D: Float64Array, d: number): Float64Array => D.map((v) => v + d) },
  (r) => ({ c: vec(r, 0, 2.5), d: r.range(0, 1) }),
  (im) => ({ c, d }) => {
    const D = ref.film.spectral(c);
    const x0 = ref.enlarger.exposureOfDensity(D);
    const x1 = ref.enlarger.exposureOfDensity(im.addMask(D, d));
    for (let k = 0; k < 3; k++) { const v = near(x1[k]!, x0[k]! - d, 1e-12, `layer ${k}`); if (v !== true) return v; }
    return true;
  },
  { name: 'a mask that only darkens the red end (one layer)', patch: { addMask: (D, d) => D.map((v, i) => (i > 0.6 * D.length ? v + d : v)) } });

  const blurLinear = defineLaw('mask blur in linear light', {
    justifies: 'the mask film is exposed by light through the negative: log10(G*T) ≥ G*log10 T pointwise, strictly at an edge (blurring density instead would be equal)',
    section: 'CHB-010 §6.6, §9.1',
  },
  { exposure: maskExposure },
  (r) => ({ a: r.range(0, 1.5), step: r.range(0.3, 1.5), sigma: r.range(0.6, 3) }),
  (im) => ({ a, step, sigma }) => {
    const w = 24, h = 3;
    const pd = new Float64Array(w * h * 3).map((_, i) => (Math.floor(i / 3) % w < w / 2 ? a : a + step));
    const Hm = im.exposure(pd, w, h, 3, sigma);
    const logT = new Float64Array(w * h).map((_, i) => Math.log10(10 ** -pd[3 * i]!));
    const blurredLog = gaussianBlur1(logT, w, h, sigma);
    for (let i = 0; i < w * h; i++) if (Math.log10(Hm[i]!) < blurredLog[i]! - 1e-12) return `pixel ${i}: log10(G*T) ${Math.log10(Hm[i]!)} < G*log10 T ${blurredLog[i]}`;
    const e = w + w / 2;
    return Math.log10(Hm[e]!) - blurredLog[e]! > 1e-4 ? true : `no Jensen gap at the edge: ${Math.log10(Hm[e]!) - blurredLog[e]!}`;
  },
  { name: 'blurring density (log10 T) instead of transmittance', patch: { exposure: (pd, w, h, c, sigma) => {
    const L = new Float64Array(w * h).map((_, i) => -(pd[i * c]! + pd[i * c + 1]! + pd[i * c + 2]!) / 3);
    return gaussianBlur1(L, w, h, sigma).map((v) => 10 ** v);
  } } });

  return [linearSum, merge, cancel, neutralMask, blurLinear];
}
