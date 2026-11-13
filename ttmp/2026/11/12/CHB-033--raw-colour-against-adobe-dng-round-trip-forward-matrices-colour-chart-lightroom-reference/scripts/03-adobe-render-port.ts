// CHB-033 step 4: Adobe's DNG rendering (DNG SDK 1.7.1, dng_render.cpp dng_render_task::ProcessArea) ported stage by
// stage, applied to Adobe DNG Converter's DNGs, against our colour. Stages (SDK source references):
//   S1 ABCtoRGB:  linear ProPhoto = ProPhoto.MatrixFromPCS · FM(g) · diag(1/AsShotNeutral) · camera RGB (dng_render.cpp
//                 Start: fCameraToRGB = ProPhoto.MatrixFromPCS() * spec->CameraToPCS(); DNG spec 1.4 ch. 6)
//   S2 HueSatMap: profile.HueSatMapForWhite(white): entry-wise g·map1 + (1−g)·map2 (dng_camera_profile.cpp), applied in
//                 HSV by RefBaselineHueSatMap (dng_reference.cpp:1508), 2.5D (90 hue × 30 sat × 1 val)
//   S3 exposure:  dng_function_exposure_ramp(white = 2^−max(0, BaselineExposure), black = Shadows 5 · 0.001) on R, G, B
//   S4 LookTable: RefBaselineHueSatMap with the 36 × 8 × 16 LookTable (linear value encoding: no encoding tag)
//   S5 tone:      RefBaselineRGBTone (dng_reference.cpp:1868) with dng_tone_curve_acr3_default (dng_render.cpp:164);
//                 the exposure tone is a no-op for exposure ≥ 0
//   S6 output:    linear ProPhoto → XYZ(D50) → sRGB (D50-adapted matrix) → sRGB curve
// g = share of calibration illuminant 1 at the as-shot white, 1/T interpolation (the SDK uses dng_temperature
// (Robertson); McCamy here, a known approximation). Tables: exiftool -m -b (ProfileHueSatMapData1/2,
// ProfileLookTableData); the ACR3 table: .playwright-mcp/dng/acr3-tone.json, parsed from the SDK source.
// Private files read in place; numbers and renders (various/shots, this ticket only). Usage: node 03-…ts [name…]
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { LibRawDecoder, readDngColour } from '@chromobench/ingest';
import { decodePhoto } from '../../../../../../apps/studio/src/host/decode.ts';
import { de2000 } from './lib-colour.ts';
type M3 = number[][];
const ROOT = '/home/manuel/code/wesen/chromobench';
const OUT = `${ROOT}/ttmp/2026/11/12/CHB-033--raw-colour-against-adobe-dng-round-trip-forward-matrices-colour-chart-lightroom-reference/various/shots`;
const raw = new LibRawDecoder();
const mul = (A: M3, B: M3): M3 => A.map((r) => B[0]!.map((_, j) => r.reduce((s, v, k) => s + v * B[k]![j]!, 0)));
const app = (A: M3, v: number[]) => A.map((r) => r[0]! * v[0]! + r[1]! * v[1]! + r[2]! * v[2]!);
const inv = (m: M3): M3 => {
  const [[a, b, c], [d, e, f], [g, h, i]] = m as [[number, number, number], [number, number, number], [number, number, number]];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  return [[A / det, -(b * i - c * h) / det, (b * f - c * e) / det], [B / det, (a * i - c * g) / det, -(a * f - c * d) / det], [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]];
};
const m3 = (v: number[]): M3 => [v.slice(0, 3), v.slice(3, 6), v.slice(6, 9)];
const D50 = [0.96422, 1, 0.82521];
const BRAD: M3 = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]];
const bradford = (from: number[], to: number[]): M3 => { const s = app(BRAD, from), d = app(BRAD, to); return mul(inv(BRAD), mul([[d[0]! / s[0]!, 0, 0], [0, d[1]! / s[1]!, 0], [0, 0, d[2]! / s[2]!]], BRAD)); };
const PP_TO_PCS: M3 = [[0.7977, 0.1352, 0.0313], [0.288, 0.7119, 0.0001], [0, 0, 0.8249]]; // dng_color_space.cpp, dng_space_ProPhoto
const PCS_TO_PP = inv(PP_TO_PCS);
const PCS_TO_SRGB: M3 = [[3.1338561, -1.6168667, -0.4906146], [-0.9787684, 1.9161415, 0.033454], [0.0719453, -0.2289914, 1.4052427]];
const xyOf = (X: number[]) => [X[0]! / (X[0]! + X[1]! + X[2]!), X[1]! / (X[0]! + X[1]! + X[2]!)];
const mccamy = (x: number, y: number) => { const n = (x - 0.332) / (0.1858 - y); return 449 * n ** 3 + 3525 * n ** 2 + 6823.3 * n + 5520.33; };
const CCT: Record<number, number> = { 17: 2856, 21: 6504, 20: 5503, 23: 5003 };
const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
const lab = (X: number[]) => { const fx = f(X[0]! / D50[0]!), fy = f(X[1]!), fz = f(X[2]! / D50[2]!); return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]; };
const labPP = (rgb: number[]) => lab(app(PP_TO_PCS, rgb));
const ACR3: number[] = JSON.parse(readFileSync(`${ROOT}/.playwright-mcp/dng/acr3-tone.json`, 'utf8'));
const pin = (x: number) => Math.min(1, Math.max(0, x));
const acr3 = (x: number) => { const y = pin(x) * (ACR3.length - 1); const i = Math.min(ACR3.length - 2, Math.max(0, Math.floor(y))); const fr = y - i; return ACR3[i]! * (1 - fr) + ACR3[i + 1]! * fr; };
// DNG_RGBtoHSV / DNG_HSVtoRGB (dng_utils.h:834, 904), h in [0, 6)
function rgb2hsv(r: number, g: number, b: number): [number, number, number] {
  const v = Math.max(r, g, b), gap = v - Math.min(r, g, b);
  if (!(gap > 0)) return [0, 0, v];
  let h = r === v ? (g - b) / gap : g === v ? 2 + (b - r) / gap : 4 + (r - g) / gap;
  if (r === v && h < 0) h += 6;
  return [h, gap / v, v];
}
function hsv2rgb(h: number, s: number, v: number): [number, number, number] {
  if (!(s > 0)) return [v, v, v];
  h = h % 6; if (h < 0) h += 6;
  const i = Math.floor(h), fr = h - i, p = v * (1 - s), q = v * (1 - s * fr), t = v * (1 - s * (1 - fr));
  switch (i) { case 0: case 6: return [v, t, p]; case 1: return [q, v, p]; case 2: return [p, v, t]; case 3: return [p, q, v]; case 4: return [t, p, v]; default: return [v, p, q]; }
}
type Table = { H: number; S: number; V: number; d: Float64Array }; // entries (hueShift°, satScale, valScale), v-major, h, s
// RefBaselineHueSatMap (dng_reference.cpp:1508), linear value encoding, no overrange
function hueSat(t: Table, rgb: number[]): number[] {
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
function rgbTone(c: number[], T: (x: number) => number): number[] {
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
function ramp(white: number, black: number) {
  const slope = 1 / (white - black), radius = Math.min(0.5 * black, (1 / 16) / slope), q = radius > 0 ? slope / (4 * radius) : 0;
  return (x: number) => x <= black - radius ? 0 : x >= black + radius ? Math.min(1, (x - black) * slope) : q * (x - (black - radius)) ** 2;
}
const nums = (path: string, tag: string) => execFileSync('exiftool', ['-m', '-b', `-${tag}`, path], { encoding: 'utf8' }).trim().split(/\s+/).map(Number);
const enc = (v: number) => Math.round(255 * pin(v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
const toSrgb8 = (pp: number[]) => app(PCS_TO_SRGB, app(PP_TO_PCS, pp)).map(enc);
const ppm = (path: string, w: number, h: number, px: (i: number) => number[]) => {
  const head = Buffer.from(`P6\n${w} ${h}\n255\n`), body = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) { const c = px(i); body[i * 3] = c[0]!; body[i * 3 + 1] = c[1]!; body[i * 3 + 2] = c[2]!; }
  writeFileSync(path, Buffer.concat([head, body]));
};
const names = process.argv.slice(2).length ? process.argv.slice(2) : ['DSC_8559', 'DSC_8541', 'DSC_8536', 'DSC_8655'];
for (const name of names) {
  const path = `${ROOT}/.playwright-mcp/dng/${name}.dng`;
  if (!existsSync(path)) { console.log('absent', name); continue; }
  const bytes = new Uint8Array(readFileSync(path));
  const dc = readDngColour(bytes)!;
  const neutral = dc.asShotNeutral!, t1 = CCT[dc.calibrationIlluminant1!]!, t2 = CCT[dc.calibrationIlluminant2!]!;
  const weight = (cct: number) => (cct <= t1 ? 1 : cct >= t2 ? 0 : (1 / cct - 1 / t2) / (1 / t1 - 1 / t2));
  const lerp = (A: M3, B: M3, g: number): M3 => A.map((r, i) => r.map((v, j) => g * v + (1 - g) * B[i]![j]!));
  const CM1 = m3(dc.colorMatrix1!), CM2 = m3(dc.colorMatrix2!), FM1 = m3(dc.forwardMatrix1!), FM2 = m3(dc.forwardMatrix2!);
  let xy = [0.3457, 0.3585], cct = 5000;
  for (let it = 0; it < 30; it++) { xy = xyOf(app(inv(lerp(CM1, CM2, weight(cct))), neutral)); cct = mccamy(xy[0]!, xy[1]!); }
  const g = weight(cct);
  const FM_PP = mul(PCS_TO_PP, mul(lerp(FM1, FM2, g), [[1 / neutral[0]!, 0, 0], [0, 1 / neutral[1]!, 0], [0, 0, 1 / neutral[2]!]]));
  const camToXyz = inv(lerp(CM1, CM2, g)), Wc = app(camToXyz, neutral);
  const CM_PP = mul(PCS_TO_PP, mul(bradford([Wc[0]! / Wc[1]!, 1, Wc[2]! / Wc[1]!], D50), camToXyz.map((r) => r.map((v) => v / Wc[1]!))));
  const h1 = nums(path, 'ProfileHueSatMapData1'), h2 = nums(path, 'ProfileHueSatMapData2'), lt = nums(path, 'ProfileLookTableData');
  const hsm: Table = { H: 90, S: 30, V: 1, d: Float64Array.from(h1, (v, i) => g * v + (1 - g) * h2[i]!) };
  const look: Table = { H: 36, S: 8, V: 16, d: Float64Array.from(lt) };
  const baseline = dc.baselineExposure ?? 0;
  const R = ramp(1 / 2 ** Math.max(0, baseline), Math.min(5 * 0.001, 0.99 / 2 ** Math.max(0, baseline)));
  const d = await decodePhoto(bytes, 'f'.repeat(64), `${name}.dng`, { long: 384, raw });
  const w = d.info.width, h = d.info.height, n = w * h;
  const C = { s1: 0, s2: 0, s4: 0, s5: 0, cm: 0, fm: 0 }; let nC = 0;
  const adobe: number[][] = [], cmT: number[][] = [], fmT: number[][] = [];
  const deCM: number[] = [], deFM: number[] = [], deMap = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const cam = [d.data[i * 3]!, d.data[i * 3 + 1]!, d.data[i * 3 + 2]!];
    const s1 = app(FM_PP, cam).map((x) => Math.max(0, x));
    const s2 = hueSat(hsm, s1);
    const s3 = s2.map(R);
    const s4 = hueSat(look, s3);
    const s5 = rgbTone(s4, acr3);
    const cm5 = rgbTone(app(CM_PP, cam).map((x) => R(Math.max(0, x))), acr3); // our colour, Adobe's exposure and tone, no tables
    const fm5 = rgbTone(s1.map(R), acr3);                                      // Adobe's matrix, exposure and tone, no tables
    adobe.push(s5); cmT.push(cm5); fmT.push(fm5);
    const Y = app(PP_TO_PCS, s5)[1]!;
    if (Y < 0.01 || Y > 0.95) { deMap[i] = NaN; continue; }
    const LA = labPP(s5), Lc = labPP(cm5), Lf = labPP(fm5);
    const ch = (L: number[]) => Math.hypot(L[1]!, L[2]!);
    C.s1 += ch(labPP(s1.map(R))); C.s2 += ch(labPP(s2.map(R))); C.s4 += ch(labPP(s4)); C.s5 += ch(LA); C.cm += ch(Lc); C.fm += ch(Lf); nC++;
    const e = de2000(Lc, LA); deCM.push(e); deFM.push(de2000(Lf, LA)); deMap[i] = e;
  }
  const q = (v: number[], p: number) => [...v].sort((a, b) => a - b)[Math.floor(p * (v.length - 1))]!.toFixed(2);
  const c = (k: keyof typeof C) => (C[k] / nC).toFixed(2);
  console.log(`${name}: cct ${cct.toFixed(0)} K, StdA share ${g.toFixed(3)}, BaselineExposure ${baseline}`);
  console.log(`  mean C*ab (Lab D50): Adobe S1 FM ${c('s1')} → S2 +HueSatMap ${c('s2')} → S4 +LookTable ${c('s4')} → S5 +tone ${c('s5')}; references with Adobe's exposure+tone, no tables: our CM ${c('cm')}, Adobe FM ${c('fm')}`);
  console.log(`  ΔE2000 vs Adobe's full render: our CM colour ${q(deCM, 0.5)} / ${q(deCM, 0.9)} / ${q(deCM, 0.99)}; Adobe FM without tables ${q(deFM, 0.5)} / ${q(deFM, 0.9)} / ${q(deFM, 0.99)} (median / p90 / p99, n ${deCM.length})`);
  const W3 = w * 3 + 16;
  ppm(`${OUT}/03-${name}-adobe-ours-de.ppm`, W3, h, (i) => {
    const y = Math.floor(i / W3), x = i % W3;
    if (x < w) return toSrgb8(adobe[y * w + x]!);
    if (x < w + 8) return [40, 40, 40];
    if (x < 2 * w + 8) return toSrgb8(cmT[y * w + x - w - 8]!);
    if (x < 2 * w + 16) return [40, 40, 40];
    const e = deMap[y * w + x - 2 * w - 16]!; const v = Number.isNaN(e) ? 0 : Math.round(255 * Math.min(1, e / 10)); return [v, v, Number.isNaN(e) ? 60 : v];
  });
}
