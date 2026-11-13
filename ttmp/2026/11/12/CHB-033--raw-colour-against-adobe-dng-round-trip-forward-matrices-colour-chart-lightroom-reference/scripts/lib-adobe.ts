// CHB-033: the DNG SDK 1.7.1 rendering stages ported to TypeScript (see 03-adobe-render-port.ts for references),
// shared by scripts 03 and 04.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
export type M3 = number[][];
export const ROOT = '/home/manuel/code/wesen/chromobench';

export const mul = (A: M3, B: M3): M3 => A.map((r) => B[0]!.map((_, j) => r.reduce((s, v, k) => s + v * B[k]![j]!, 0)));
export const app = (A: M3, v: number[]) => A.map((r) => r[0]! * v[0]! + r[1]! * v[1]! + r[2]! * v[2]!);
export const inv = (m: M3): M3 => {
  const [[a, b, c], [d, e, f], [g, h, i]] = m as [[number, number, number], [number, number, number], [number, number, number]];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  return [[A / det, -(b * i - c * h) / det, (b * f - c * e) / det], [B / det, (a * i - c * g) / det, -(a * f - c * d) / det], [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]];
};
export const m3 = (v: number[]): M3 => [v.slice(0, 3), v.slice(3, 6), v.slice(6, 9)];
export const D50 = [0.96422, 1, 0.82521];
export const BRAD: M3 = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]];
export const bradford = (from: number[], to: number[]): M3 => { const s = app(BRAD, from), d = app(BRAD, to); return mul(inv(BRAD), mul([[d[0]! / s[0]!, 0, 0], [0, d[1]! / s[1]!, 0], [0, 0, d[2]! / s[2]!]], BRAD)); };
export const PP_TO_PCS: M3 = [[0.7977, 0.1352, 0.0313], [0.288, 0.7119, 0.0001], [0, 0, 0.8249]]; // dng_color_space.cpp, dng_space_ProPhoto
export const PCS_TO_PP = inv(PP_TO_PCS);
export const PCS_TO_SRGB: M3 = [[3.1338561, -1.6168667, -0.4906146], [-0.9787684, 1.9161415, 0.033454], [0.0719453, -0.2289914, 1.4052427]];
export const xyOf = (X: number[]) => [X[0]! / (X[0]! + X[1]! + X[2]!), X[1]! / (X[0]! + X[1]! + X[2]!)];
export const mccamy = (x: number, y: number) => { const n = (x - 0.332) / (0.1858 - y); return 449 * n ** 3 + 3525 * n ** 2 + 6823.3 * n + 5520.33; };
export const CCT: Record<number, number> = { 17: 2856, 21: 6504, 20: 5503, 23: 5003 };
export const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
export const lab = (X: number[]) => { const fx = f(X[0]! / D50[0]!), fy = f(X[1]!), fz = f(X[2]! / D50[2]!); return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]; };
export const labPP = (rgb: number[]) => lab(app(PP_TO_PCS, rgb));
export const ACR3: number[] = JSON.parse(readFileSync(`${ROOT}/.playwright-mcp/dng/acr3-tone.json`, 'utf8'));
export const pin = (x: number) => Math.min(1, Math.max(0, x));
export const acr3 = (x: number) => { const y = pin(x) * (ACR3.length - 1); const i = Math.min(ACR3.length - 2, Math.max(0, Math.floor(y))); const fr = y - i; return ACR3[i]! * (1 - fr) + ACR3[i + 1]! * fr; };
// DNG_RGBtoHSV / DNG_HSVtoRGB (dng_utils.h:834, 904), h in [0, 6)
export function rgb2hsv(r: number, g: number, b: number): [number, number, number] {
  const v = Math.max(r, g, b), gap = v - Math.min(r, g, b);
  if (!(gap > 0)) return [0, 0, v];
  let h = r === v ? (g - b) / gap : g === v ? 2 + (b - r) / gap : 4 + (r - g) / gap;
  if (r === v && h < 0) h += 6;
  return [h, gap / v, v];
}
export function hsv2rgb(h: number, s: number, v: number): [number, number, number] {
  if (!(s > 0)) return [v, v, v];
  h = h % 6; if (h < 0) h += 6;
  const i = Math.floor(h), fr = h - i, p = v * (1 - s), q = v * (1 - s * fr), t = v * (1 - s * (1 - fr));
  switch (i) { case 0: case 6: return [v, t, p]; case 1: return [q, v, p]; case 2: return [p, v, t]; case 3: return [p, q, v]; case 4: return [t, p, v]; default: return [v, p, q]; }
}
export type Table = { H: number; S: number; V: number; d: Float64Array }; // entries (hueShift°, satScale, valScale), v-major, h, s
// RefBaselineHueSatMap (dng_reference.cpp:1508), linear value encoding, no overrange
export function hueSat(t: Table, rgb: number[]): number[] {
  let [h, s, v] = rgb2hsv(rgb[0]!, rgb[1]!, rgb[2]!);
  const hScale = t.H < 2 ? 0 : t.H / 6, sScale = t.S - 1, vScale = t.V - 1;
  const hueStep = t.S, valStep = t.H * hueStep;
  const hS = h * hScale, sS = s * sScale;
  let h0 = Math.floor(hS); const s0 = Math.min(Math.floor(sS), t.S - 2);
  let h1 = h0 + 1; if (h0 >= t.H - 1) { h0 = t.H - 1; h1 = 0; }
  const hf1 = hS - h0, sf1 = sS - s0, hf0 = 1 - hf1, sf0 = 1 - sf1;
  const E = (vi: number, hi: number, si: number, k: number) => t.d[(vi * valStep + hi * hueStep + si) * 3 + k]!;
  let hue = 0, sat = 0, val = 0;
  if (t.V < 2) {
    for (let k = 0; k < 3; k++) {
      const a0 = hf0 * E(0, h0, s0, k) + hf1 * E(0, h1, s0, k), a1 = hf0 * E(0, h0, s0 + 1, k) + hf1 * E(0, h1, s0 + 1, k);
      const r = sf0 * a0 + sf1 * a1; if (k === 0) hue = r; else if (k === 1) sat = r; else val = r;
    }
  } else {
    const vS = v * vScale, v0 = Math.min(Math.floor(vS), t.V - 2), vf1 = vS - v0, vf0 = 1 - vf1;
    for (let k = 0; k < 3; k++) {
      const at = (si: number) => vf0 * (hf0 * E(v0, h0, si, k) + hf1 * E(v0, h1, si, k)) + vf1 * (hf0 * E(v0 + 1, h0, si, k) + hf1 * E(v0 + 1, h1, si, k));
      const r = sf0 * at(s0) + sf1 * at(s0 + 1); if (k === 0) hue = r; else if (k === 1) sat = r; else val = r;
    }
  }
  h += hue * (6 / 360);
  s = Math.min(s * sat, 1);
  v = pin(v * val);
  return hsv2rgb(h, s, v);
}
// RefBaselineRGBTone (dng_reference.cpp:1868): the curve on max and min, the middle channel keeps its proportion
export function rgbTone(c: number[], T: (x: number) => number): number[] {
  const [r, g, b] = c.map(pin) as [number, number, number];
  const tone = (hi: number, mid: number, lo: number) => { const H = T(hi), L = T(lo); return [H, L + ((H - L) * (mid - lo)) / (hi - lo), L]; };
  if (r >= g) {
    if (g > b) { const [R, G, B] = tone(r, g, b); return [R!, G!, B!]; }
    if (b > r) { const [B, R, G] = tone(b, r, g); return [R!, G!, B!]; }
    if (b > g) { const [R, B, G] = tone(r, b, g); return [R!, G!, B!]; }
    const G = T(g); return [T(r), G, G];
  }
  if (r >= b) { const [G, R, B] = tone(g, r, b); return [R!, G!, B!]; }
  if (b > g) { const [B, G, R] = tone(b, g, r); return [R!, G!, B!]; }
  const [G, B, R] = tone(g, b, r); return [R!, G!, B!];
}
// dng_function_exposure_ramp (dng_render.cpp): white, black, minBlack = black
export function ramp(white: number, black: number) {
  const slope = 1 / (white - black), radius = Math.min(0.5 * black, (1 / 16) / slope), q = radius > 0 ? slope / (4 * radius) : 0;
  return (x: number) => x <= black - radius ? 0 : x >= black + radius ? Math.min(1, (x - black) * slope) : q * (x - (black - radius)) ** 2;
}
export const nums = (path: string, tag: string) => execFileSync('exiftool', ['-m', '-b', `-${tag}`, path], { encoding: 'utf8' }).trim().split(/\s+/).map(Number);
