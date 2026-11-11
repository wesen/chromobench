// Grey balance (§3.6, Hunt 16.7): LATD, integrate-to-grey, grey pick, and the Studio's light arithmetic
// (params.js colourOffset/autoLights, state.js lightsToSliders/neutralise; 05-inline.js 2087–2193, 4222–4257).
import type { Channels } from '../spectral/channels.ts';
import type { Vec3 } from '../spectral/linalg.ts';
import type { PrintChain } from './chain.ts';
import { Lights } from './lights.ts';

const LOG10_2 = Math.log10(2);

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

/** ℓ = ℓ_aim + m + α(Δ − m): density corrected in full, colour by α (default 0.75). */
export function integrateToGrey(frameLatd: ArrayLike<number>, aim: { latd: ArrayLike<number>; lights: Lights }, alpha = 0.75): Lights {
  const d = [0, 1, 2].map((k) => frameLatd[k]! - aim.latd[k]!);
  const m = (d[0]! + d[1]! + d[2]!) / 3;
  return Lights.fromLogH(aim.lights.logH.map((a, k) => a + m + alpha * (d[k]! - m)));
}

/** Warmth per mired: the light change that moves the grey card's exposure like a 1 mired shift (Chromogen aim()). */
export const WARM_MIRED = 1.3;
export const TINT_PT = 10;
const PT = 0.025;

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
