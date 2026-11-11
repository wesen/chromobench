// Grey balance (§3.6, Hunt 16.7) and the darkroom's balance tools (CHB-010 stage 2): the aim, LATD,
// integrate-to-grey, warmth and tint, roll consistency, match frame, grey pick, hold density, and the
// translation of printer lights into filtration and time (and Bake). Ported from Chromogen params.js
// (colourOffset/autoLights/frameParams), aim() and state.js (lightsToSliders/neutralise, rollInfo),
// 05-inline.js 1810–1840, 2087–2193, 4047–4054, 4222–4257; filtration from the CHB-010 guide §6.4.
//
// Every tool works in printer lights (log H per paper layer), on top of the aim lights that
// print.expose adds: recipe lights 0 print the stock's grey card as the aim.
import { fail, type Cmy, type FrameRecipe, type Mutation } from '@chromobench/contract';
import type { PhysicsData } from '../data/provider.ts';
import type { Channels } from '../spectral/channels.ts';
import type { Conventions } from '../spectral/conventions.ts';
import { solve3, type Mat3, type Vec3 } from '../spectral/linalg.ts';
import { exposeSpectral } from '../spectral/metamer.ts';
import { blackbody } from '../spectral/spectrum.ts';
import { LOGH_PER_POINT } from '../spectral/units.ts';
import { makePrintChain, type PrintChain, type PrintChainOptions } from './chain.ts';
import { REFERENCE_OPTICS } from './enlarger.ts';
import { Lights } from './lights.ts';

const LOG10_2 = Math.log10(2);
const PT = LOGH_PER_POINT;

/** −log10 of the mean transmittance per paper band over the frame's spectral densities. */
export function latd(printing: Channels, Ds: Iterable<ArrayLike<number>>): Vec3 {
  const T = [0, 0, 0];
  let n = 0;
  for (const D of Ds) {
    const t = printing.transmittance(D);
    for (let k = 0; k < 3; k++) T[k]! += t[k]!;
    n++;
  }
  return T.map((t) => -Math.log10(t / n)) as Vec3;
}

/** LATD from an interleaved printing-density buffer (`stride` floats per pixel; frameStats). */
export function latdFromPD(pd: ArrayLike<number>, n: number, stride = 3): Vec3 {
  const T = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) T[k]! += 10 ** -pd[stride * i + k]!;
  return T.map((t) => -Math.log10(t / n)) as Vec3;
}

/** A frame's balance statistics from its printing densities (Chromogen frameStats): LATD and mean PD. */
export function frameStats(pd: ArrayLike<number>, n: number, stride = 3): { latd: Vec3; meanPD: Vec3 } {
  const M = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) M[k]! += pd[stride * i + k]!;
  return { latd: latdFromPD(pd, n, stride), meanPD: M.map((v) => v / n) as Vec3 };
}

/** ℓ = ℓ_aim + m + α(Δ − m): density corrected in full, colour by α (default 0.75). */
export function integrateToGrey(frameLatd: ArrayLike<number>, aim: { latd: ArrayLike<number>; lights: Lights }, alpha = 0.75): Lights {
  const d = [0, 1, 2].map((k) => frameLatd[k]! - aim.latd[k]!);
  const m = (d[0]! + d[1]! + d[2]!) / 3;
  return Lights.fromLogH(aim.lights.logH.map((a, k) => a + m + alpha * (d[k]! - m)));
}

/** Warmth per mired: the light change that moves the grey card's exposure like a 1 mired shift (Chromogen aim()). */
export const WARM_MIRED = 1.3;
export const TINT_PT = 10;

export function colourOffset(warm: number, tint: number, warmPerMired: ArrayLike<number>): Vec3 {
  const w = [0, 1, 2].map((k) => warmPerMired[k]! * WARM_MIRED * warm);
  const t = [-1 / 3, 2 / 3, -1 / 3].map((v) => (v * PT * TINT_PT * tint) / 100);
  return [w[0]! + t[0]!, w[1]! + t[1]!, w[2]! + t[2]!];
}

export function lightsToSliders(dL: ArrayLike<number>, warmPerMired: ArrayLike<number>): { exposure: number; warmth: number; tint: number } {
  const m = (dL[0]! + dL[1]! + dL[2]!) / 3;
  const d = [0, 1, 2].map((k) => dL[k]! - m);
  const W = colourOffset(1, 0, warmPerMired);
  const T = colourOffset(0, 1, warmPerMired);
  const dot = (a: ArrayLike<number>, b: ArrayLike<number>): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  const a = dot(W, W), b = dot(W, T), c = dot(T, T), p = dot(W, d), q = dot(T, d), det = a * c - b * b;
  return { exposure: -m / LOG10_2, warmth: (c * p - b * q) / det, tint: (a * q - b * p) / det };
}

/** Grey pick: Newton in the colour plane of the lights (mean removed) until a*, b* < 0.05; density untouched. */
export function greyPick(chain: PrintChain, c: ArrayLike<number>, start: Lights = Lights.zero()): Lights {
  const e1 = [1 / Math.SQRT2, -1 / Math.SQRT2, 0];
  const e2 = [1 / Math.sqrt(6), 1 / Math.sqrt(6), -2 / Math.sqrt(6)];
  const at = (u: number, v: number): Lights => Lights.fromLogH(start.logH.map((s, k) => s + u * e1[k]! + v * e2[k]!));
  const ab = (u: number, v: number): [number, number] => {
    const L = chain.print(c, at(u, v)).lab;
    return [L[1], L[2]];
  };
  let u = 0;
  let v = 0;
  for (let it = 0; it < 20; it++) {
    const r = ab(u, v);
    // Chromogen stops at 0.05; Newton converges quadratically, so we go to 1e-6 at little cost.
    if (Math.hypot(r[0], r[1]) < 1e-6) break;
    const h = 1e-4;
    const ru = ab(u + h, v);
    const rv = ab(u, v + h);
    const J = [[(ru[0] - r[0]) / h, (rv[0] - r[0]) / h], [(ru[1] - r[1]) / h, (rv[1] - r[1]) / h]];
    const det = J[0]![0]! * J[1]![1]! - J[0]![1]! * J[1]![0]!;
    if (Math.abs(det) < 1e-12) break;
    u -= (J[1]![1]! * r[0] - J[0]![1]! * r[1]) / det;
    v -= (-J[1]![0]! * r[0] + J[0]![0]! * r[1]) / det;
  }
  return at(u, v);
}

// ---- the aim, warmth and the darkroom tools (CHB-010 stage 2) -------------------------------------

/** The aim of a print chain (Chromogen aim(), 05-inline.js 1810–1840), read through the chain's pack. */
export interface AimInfo {
  /** Printing density of the grey card through the current pack (integrate-to-grey compares LATD with it). */
  A: Vec3;
  /** The aim lights (fitted at the calibration; print.expose adds them). */
  lights: Lights;
  /** Log H through an empty gate with the current pack, κ and optics. */
  clear: Vec3;
  /** The aim grey's paper exposure at the calibration: the grade's pivot (Chromogen g). */
  g: Vec3;
  /** Warmth direction in log H per mired, mean removed (warmthVector). */
  warmPerMired: Vec3;
  /** Print window per layer: [first x with dye > Dmin + 0.04, first x with dye > 0.9·Dmax]. */
  window: [number, number][];
}

/**
 * Warmth direction (Chromogen aim() 1818–1833 with the enlarger lamp as a parameter): the film's grey
 * card shot under blackbodies at 5,500 K ± `mired`, developed, read as printing density through the
 * chain's calibration pack; −ΔPD per mired with the mean removed. Warmth +1 adds 1.3× this vector.
 */
export function warmthVector(chain: PrintChain, mired = 20): Vec3 {
  const S0 = blackbody(5500).values;
  const enl = chain.reference.enlarger;
  const pdAt = (T: number): Vec3 => {
    const x = exposeSpectral(chain.film, blackbody(T).values, { illuminant: S0, grey: 1 });
    return enl.printingDensity(chain.film.spectral(chain.film.develop(x)));
  };
  const m0 = 1e6 / 5500;
  const p1 = pdAt(1e6 / (m0 + mired));
  const p0 = pdAt(1e6 / (m0 - mired));
  const dw = [0, 1, 2].map((k) => -(p1[k]! - p0[k]!) / (2 * mired));
  const mw = (dw[0]! + dw[1]! + dw[2]!) / 3;
  return dw.map((v) => v - mw) as Vec3;
}

/** The print window of each paper layer, on a 0.01 log H grid over [−2.5, 2.5]. */
export function printWindow(chain: PrintChain): [number, number][] {
  const xs = Array.from({ length: 501 }, (_, i) => -2.5 + i * 0.01);
  const ys = xs.map((x) => chain.develop([x, x, x]));
  return [0, 1, 2].map((k) => {
    const v = ys.map((y) => y[k]!);
    const mn = Math.min(...v);
    const mx = Math.max(...v);
    return [xs.find((_, i) => v[i]! > mn + 0.04) ?? NaN, xs.find((_, i) => v[i]! > 0.9 * mx) ?? NaN];
  });
}

export function aimOf(chain: PrintChain): AimInfo {
  const D = chain.film.spectral(chain.grey);
  return {
    A: chain.enlarger.printingDensity(D), lights: chain.aimLights, clear: chain.enlarger.clear(), g: chain.aimX,
    warmPerMired: warmthVector(chain), window: printWindow(chain),
  };
}

/** Integrate-to-grey as recipe lights (on top of the aim lights): ℓ = m + α(Δ − m), Δ = LATD − A. */
export function autoLights(frameLatd: ArrayLike<number>, aim: Pick<AimInfo, 'A'>, alpha = 0.75): Vec3 {
  return integrateToGrey(frameLatd, { latd: aim.A, lights: Lights.zero() }, alpha).logH;
}

/** The roll's mean auto lights (Chromogen rollInfo: needs at least two frames). */
export function rollMean(autos: readonly ArrayLike<number>[]): Vec3 | null {
  if (autos.length < 2) return null;
  return [0, 1, 2].map((k) => autos.reduce((s, a) => s + a[k]!, 0) / autos.length) as Vec3;
}

/** Roll consistency: ℓ = (1 − r)·ℓ_auto + r·mean_roll(ℓ_auto), r in [0, 1]. */
export function rollConsistency(auto: ArrayLike<number>, mean: ArrayLike<number>, r: number): Vec3 {
  return [0, 1, 2].map((k) => (1 - r) * auto[k]! + r * mean[k]!) as Vec3;
}

/** A frame's mean paper exposure x̄ = clear − mean PD + ℓ (match frame's measure). */
export function meanX(clear: ArrayLike<number>, meanPD: ArrayLike<number>, lights: ArrayLike<number>): Vec3 {
  return [0, 1, 2].map((k) => clear[k]! - meanPD[k]! + lights[k]!) as Vec3;
}

/** Match frame: the light change m·(x̄_ref − x̄_this), m in [0, 1] (Chromogen frameParams 2109–2113). */
export function matchFrame(refMeanX: ArrayLike<number>, thisMeanX: ArrayLike<number>, amount: number): Vec3 {
  return [0, 1, 2].map((k) => amount * (refMeanX[k]! - thisMeanX[k]!)) as Vec3;
}

/**
 * Grey pick on the sliders (Chromogen neutralise, 4236–4257): Newton on (warmth, tint) with finite
 * differences of 2 units until the picked dyes print with |a*, b*| < `tol`, at most 12 iterations,
 * sliders clamped to ±100. `base` is the frame's other lights (auto, exposure); the result's lights are
 * base + colourOffset(warmth, tint).
 */
export function greyPickSliders(
  chain: PrintChain, c: ArrayLike<number>,
  o: { base?: ArrayLike<number>; warmth?: number; tint?: number; warmPerMired?: ArrayLike<number>; tol?: number; maxIt?: number } = {},
): { warmth: number; tint: number; lights: Vec3; iterations: number; ab: [number, number] } {
  const wpm = o.warmPerMired ?? warmthVector(chain);
  const base = o.base ?? [0, 0, 0];
  const lightsOf = (w: number, t: number): Vec3 => {
    const off = colourOffset(w, t, wpm);
    return [base[0]! + off[0], base[1]! + off[1], base[2]! + off[2]];
  };
  const ab = (w: number, t: number): [number, number] => {
    const L = chain.print(c, Lights.fromLogH(lightsOf(w, t))).lab;
    return [L[1], L[2]];
  };
  const tol = o.tol ?? 0.05;
  let w = o.warmth ?? 0;
  let t = o.tint ?? 0;
  let r = ab(w, t);
  let it = 0;
  for (; it < (o.maxIt ?? 12) && Math.hypot(r[0], r[1]) >= tol; it++) {
    const h = 2;
    const rw = ab(w + h, t);
    const rt = ab(w, t + h);
    const J = [[(rw[0] - r[0]) / h, (rt[0] - r[0]) / h], [(rw[1] - r[1]) / h, (rt[1] - r[1]) / h]];
    const det = J[0]![0]! * J[1]![1]! - J[0]![1]! * J[1]![0]!;
    if (Math.abs(det) < 1e-9) break;
    w = Math.max(-100, Math.min(100, w - (J[1]![1]! * r[0] - J[0]![1]! * r[1]) / det));
    t = Math.max(-100, Math.min(100, t - (-J[1]![0]! * r[0] + J[0]![0]! * r[1]) / det));
    r = ab(w, t);
  }
  return { warmth: w, tint: t, lights: lightsOf(w, t), iterations: it, ab: r };
}

/**
 * Hold density: the uniform light s (log H in every layer) that prints dyes `c` (default the grey card)
 * at visual density `target`, by a secant on s (Filmbench matchScope 2756–2763). In real mode this is
 * a time factor 10^s; it is how a filter change is compensated (Kodak: ~1 % per CC of magenta).
 */
export function holdDensity(chain: PrintChain, target: number, o: { c?: ArrayLike<number>; lights?: ArrayLike<number> } = {}): { logH: number; factor: number; stops: number } {
  const c = o.c ?? chain.grey;
  const l = o.lights ?? [0, 0, 0];
  const D = (s: number): number => chain.print(c, Lights.fromLogH([l[0]! + s, l[1]! + s, l[2]! + s])).Dvis - target;
  let s0 = 0;
  let s1 = 0.05;
  let f0 = D(s0);
  let f1 = D(s1);
  for (let it = 0; it < 40 && Math.abs(f1) > 1e-12; it++) {
    if (f1 === f0) break;
    const s2 = s1 - (f1 * (s1 - s0)) / (f1 - f0);
    s0 = s1; f0 = f1;
    s1 = Math.max(-3, Math.min(3, s2)); f1 = D(s1);
  }
  if (Math.abs(f1) > 1e-6) fail('E_EVAL', `hold density did not converge (ΔD ${f1.toFixed(4)})`);
  return { logH: s1, factor: 10 ** s1, stops: s1 / LOG10_2 };
}

const KEYS = ['c', 'm', 'y'] as const;

/**
 * Printer lights as dial changes, first order (CHB-010 guide §6.4): solve
 *   Δℓ = J[:, a]·Δv_a + J[:, b]·Δv_b + (1, 1, 1)·u
 * with two filters free and the third held. Magenta and yellow are free and cyan is held, as a colour
 * pack without cyan should be (Kodak: three colours only add neutral density); a free dial that would
 * go below 0 is held at 0 and cyan freed instead. u is the uniform part: a time change of 10^u in real
 * mode, a light that stays in normalised mode (where time does nothing).
 */
export function lightsToFiltration(dL: ArrayLike<number>, J: Mat3, pack: Cmy): { filtration: Cmy; uniform: number } {
  // (free dials, held dial and its value): M+Y with cyan as it is; then cyan freed for a dial pinned at 0.
  const solveWith = (free: [number, number], hold: number, value: number): { next: Cmy; u: number } => {
    const rhs = [0, 1, 2].map((k) => dL[k]! - J[k]![hold]! * (value - pack[KEYS[hold]!]));
    const sol = solve3([0, 1, 2].map((k) => [J[k]![free[0]]!, J[k]![free[1]]!, 1]) as Mat3, rhs);
    const next = { ...pack, [KEYS[hold]!]: value };
    next[KEYS[free[0]]!] = pack[KEYS[free[0]]!] + sol[0];
    next[KEYS[free[1]]!] = pack[KEYS[free[1]]!] + sol[1];
    return { next, u: sol[2] };
  };
  let r = solveWith([1, 2], 0, pack.c);
  if (r.next.m < 0 || r.next.y < 0) r = r.next.m <= r.next.y ? solveWith([0, 2], 1, 0) : solveWith([0, 1], 2, 0);
  const f = r.next;
  return { filtration: { c: Math.max(0, f.c), m: Math.max(0, f.m), y: Math.max(0, f.y) }, uniform: r.u };
}

export interface FiltrationFit {
  /** Absolute pack after the change. */
  filtration: Cmy;
  /** Shift on the database neutral pack (print.enlarger.filtration). */
  shift: Cmy;
  /** Real mode: the new exposure time; normalised mode: unchanged. */
  time_s: number;
  stops: number;
  /** Normalised mode: the uniform light that time cannot carry and stays in the lights (log H). */
  lights: Vec3;
  /** What filtration and time do not reproduce at the grey card, in points. */
  residual_pt: Vec3;
  iterations: number;
}

const round = (v: number, step: number): number => Math.round(v / step) * step;

/**
 * The darkroom equivalent of a change of printer lights on chain `o` (real mode: filtration and time;
 * normalised mode: filtration, the density part stays as lights). Newton on lightsToFiltration with
 * the exact chain re-evaluated at the grey card (or `c`), the filter Jacobian taken there; dials are
 * rounded to 0.1 CC and 0.01 s, and the residual is measured after rounding.
 */
export function filtrationForLights(o: PrintChainOptions, dL: ArrayLike<number>, opt: { c?: ArrayLike<number>; maxIt?: number } = {}): FiltrationFit {
  const ch0 = makePrintChain(o);
  const mode = ch0.enlarger.setup.mode;
  const c = opt.c ?? ch0.grey;
  const D = ch0.film.spectral(c);
  const time0 = o.optics?.time_s ?? REFERENCE_OPTICS.time_s;
  const target = ch0.xOfDyes(c).map((v, k) => v + dL[k]!);
  const at = (pack: Cmy, time_s: number): PrintChain => makePrintChain({
    ...o, filtration: pack, referencePack: ch0.reference.pack, ...(mode === 'real' ? { optics: { ...o.optics, time_s } } : {}),
  });
  let pack = ch0.filtration;
  let time = time0;
  let uniform = 0;
  let ch = ch0;
  let it = 0;
  for (; it < (opt.maxIt ?? 4); it++) {
    const x = ch.xOfDyes(c);
    const r = [0, 1, 2].map((k) => target[k]! - x[k]! - uniform);
    if (Math.max(...r.map(Math.abs)) < 1e-7) break;
    const step = lightsToFiltration(r, ch.enlarger.dxdCC(D), pack);
    pack = step.filtration;
    if (mode === 'real') time = Math.max(0.1, Math.min(600, time * 10 ** step.uniform));
    else uniform += step.uniform;
    ch = at(pack, time);
  }
  pack = { c: Math.max(0, round(pack.c, 0.1)), m: Math.max(0, round(pack.m, 0.1)), y: Math.max(0, round(pack.y, 0.1)) };
  if (mode === 'real') time = round(time, 0.01);
  ch = at(pack, time);
  const x = ch.xOfDyes(c);
  const lights: Vec3 = [uniform, uniform, uniform];
  const nt = ch0.neutral;
  return {
    filtration: pack, shift: { c: pack.c - nt.c, m: pack.m - nt.m, y: pack.y - nt.y }, time_s: time, stops: Math.log2(time / time0), lights,
    residual_pt: [0, 1, 2].map((k) => (target[k]! - x[k]! - lights[k]!) / PT) as Vec3, iterations: it,
  };
}

/**
 * Bake (CHB-010 guide §6.4): move printer lights into the enlarger. The mutations set the filtration
 * shift and the time (real mode) and replace the lights by what the dials cannot carry; apply them as
 * one EditLog transaction so a single undo restores the old state.
 */
export function bakeMutations(fit: FiltrationFit, mode: 'real' | 'normalised'): Mutation[] {
  const ms: Mutation[] = [{ op: 'set', path: 'print.enlarger.filtration', value: { ...fit.shift } }];
  if (mode === 'real') ms.push({ op: 'set', path: 'print.enlarger.time_s', value: fit.time_s });
  ms.push({ op: 'set', path: 'print.lights.logH', value: [...fit.lights] });
  return ms;
}

/** The print chain a recipe's print.expose node evaluates (as compile and the engines read it): film, paper, pack, optics, aim. */
export function chainOptionsOf(r: FrameRecipe, data: PhysicsData, conv: Conventions): PrintChainOptions {
  const e = r.print.enlarger;
  const film = r.scan?.stock ?? r.capture?.stock ?? fail('E_RECIPE', 'recipe has neither scan nor capture settings');
  return {
    data, conv, film, paper: r.print.paper, lamp: e.lamp, filtrationShift: e.filtration, mode: e.mode,
    optics: { time_s: e.time_s, fstop: e.fstop, ...(e.magnification !== null ? { magnification: e.magnification } : {}) },
    aim: r.print.aim, view: r.view.illuminant,
  };
}

/** Bake a recipe's printer lights into its enlarger: the fit and the mutations (apply as one EditLog transaction). */
export function bakeRecipe(r: FrameRecipe, data: PhysicsData, conv: Conventions): { fit: FiltrationFit; mutations: Mutation[] } {
  const fit = filtrationForLights(chainOptionsOf(r, data, conv), r.print.lights.logH);
  return { fit, mutations: bakeMutations(fit, r.print.enlarger.mode) };
}
