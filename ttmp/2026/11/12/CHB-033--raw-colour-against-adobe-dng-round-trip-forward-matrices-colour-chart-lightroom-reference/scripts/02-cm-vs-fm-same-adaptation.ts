// CHB-033 step 2: our colour-matrix path vs Adobe's forward-matrix path, with the SAME chromatic adaptation, so the
// remaining difference is the matrices alone. Per DNG spec 1.4 ("Mapping Camera Color Space to CIE XYZ Space"):
//   CM path (no ForwardMatrix): XYZ_D50 = CA_Bradford(white → D50) · inverse(AB · CC · CM(cct)) · cam
//   FM path:                    XYZ_D50 = FM(cct) · diag(1 / neutral) · cam            (AB = CC = I here)
// CM(cct)/FM(cct) interpolated in 1/cct between the two calibration illuminants at the as-shot white's cct.
// Input: Adobe DNG Converter's DNG (.playwright-mcp/dng/, private). Output: numbers, plus PPM renders and a ΔE heat
// map under various/shots/ (private pixels; the repository has no remote). Usage: node 02-…ts [name…]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { LibRawDecoder, readDngColour } from '@chromobench/ingest';
import { decodePhoto } from '../../../../../../apps/studio/src/host/decode.ts';
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
const bradford = (from: number[], to: number[]): M3 => {
  const s = app(BRAD, from), d = app(BRAD, to);
  return mul(inv(BRAD), mul([[d[0]! / s[0]!, 0, 0], [0, d[1]! / s[1]!, 0], [0, 0, d[2]! / s[2]!]], BRAD));
};
const CCT: Record<number, number> = { 17: 2856, 21: 6504, 20: 5503, 23: 5003 };
const xyOf = (X: number[]) => [X[0]! / (X[0]! + X[1]! + X[2]!), X[1]! / (X[0]! + X[1]! + X[2]!)];
const mccamy = (x: number, y: number) => { const n = (x - 0.332) / (0.1858 - y); return 449 * n ** 3 + 3525 * n ** 2 + 6823.3 * n + 5520.33; };
const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
const lab = (X: number[]) => { const fx = f(X[0]! / D50[0]!), fy = f(X[1]!), fz = f(X[2]! / D50[2]!); return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]; };
export function de2000(a: number[], b: number[]): number {
  const [L1, a1, b1] = a as [number, number, number], [L2, a2, b2] = b as [number, number, number];
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2, G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2, C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h = (x: number, y: number) => { const d = (Math.atan2(y, x) * 180) / Math.PI; return d < 0 ? d + 360 : d; };
  const h1 = h(a1p, b1), h2 = h(a2p, b2), dL = L2 - L1, dC = C2p - C1p;
  let dh = h2 - h1; if (C1p * C2p === 0) dh = 0; else if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin((dh * Math.PI) / 360), Lb = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hb = h1 + h2; if (C1p * C2p !== 0) hb = Math.abs(h1 - h2) > 180 ? (h1 + h2 + (h1 + h2 < 360 ? 360 : -360)) / 2 : (h1 + h2) / 2;
  const T = 1 - 0.17 * Math.cos(((hb - 30) * Math.PI) / 180) + 0.24 * Math.cos((2 * hb * Math.PI) / 180) + 0.32 * Math.cos(((3 * hb + 6) * Math.PI) / 180) - 0.2 * Math.cos(((4 * hb - 63) * Math.PI) / 180);
  const SL = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2), SC = 1 + 0.045 * Cbp, SH = 1 + 0.015 * Cbp * T;
  const RT = -2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7)) * Math.sin((60 * Math.exp(-(((hb - 275) / 25) ** 2)) * Math.PI) / 180);
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}
// XYZ D50 → sRGB 8-bit (Bradford D50 → D65, sRGB primaries, sRGB curve); exposure k so mean Y maps to 0.18
const XYZ_SRGB: M3 = [[3.2404542, -1.5371385, -0.4985314], [-0.969266, 1.8760108, 0.041556], [0.0556434, -0.2040259, 1.0572252]];
const TO_SRGB = mul(XYZ_SRGB, bradford(D50, [0.95047, 1, 1.08883]));
const enc = (v: number) => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)));
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
  const neutral = dc.asShotNeutral!;
  const t1 = CCT[dc.calibrationIlluminant1!]!, t2 = CCT[dc.calibrationIlluminant2!]!;
  const weight = (cct: number) => (cct <= t1 ? 1 : cct >= t2 ? 0 : (1 / cct - 1 / t2) / (1 / t1 - 1 / t2)); // share of illuminant 1
  const lerp = (A: M3, B: M3, g: number): M3 => A.map((r, i) => r.map((v, j) => g * v + (1 - g) * B[i]![j]!));
  const CM1 = m3(dc.colorMatrix1!), CM2 = m3(dc.colorMatrix2!), FM1 = m3(dc.forwardMatrix1!), FM2 = m3(dc.forwardMatrix2!);
  // the as-shot white's xy, by the spec's iteration (camera neutral → XYZ with CM at that white's cct)
  let xy = [0.3457, 0.3585], cct = 5000;
  for (let it = 0; it < 30; it++) { const W = app(inv(lerp(CM1, CM2, weight(cct))), neutral); xy = xyOf(W); cct = mccamy(xy[0]!, xy[1]!); }
  const g = weight(cct);
  const camToXyz = inv(lerp(CM1, CM2, g));
  const Wcam = app(camToXyz, neutral), Wn = [Wcam[0]! / Wcam[1]!, 1, Wcam[2]! / Wcam[1]!];
  const A_M = mul(bradford(Wn, D50), camToXyz.map((r) => r.map((v) => v / Wcam[1]!)));      // CM path → XYZ D50
  const B_M = mul(lerp(FM1, FM2, g), [[1 / neutral[0]!, 0, 0], [0, 1 / neutral[1]!, 0], [0, 0, 1 / neutral[2]!]]); // FM path
  const d = await decodePhoto(bytes, 'e'.repeat(64), `${name}.dng`, { long: 384, raw });
  const n = d.info.width * d.info.height, w = d.info.width, h = d.info.height;
  const XA: number[][] = [], XB: number[][] = [];
  let YA = 0, YB = 0;
  for (let i = 0; i < n; i++) { const c = [d.data[i * 3]!, d.data[i * 3 + 1]!, d.data[i * 3 + 2]!]; const a = app(A_M, c), b = app(B_M, c); XA.push(a); XB.push(b); YA += a[1]!; YB += b[1]!; }
  // one exposure for both: both paths map the camera neutral to the same white (Y = 1), so a common factor keeps
  // their luminance comparable (separate factors would add an L* offset to every pixel)
  const kA = 0.18 / (YA / n), kB = kA;
  let CA = 0, CB = 0, nC = 0, dh = 0;
  const bins: number[][] = Array.from({ length: 12 }, () => []), all: number[] = [], des = new Float64Array(n), chromaBins: number[][] = [[], [], []];
  for (let i = 0; i < n; i++) {
    const a = XA[i]!.map((v) => v * kA), b = XB[i]!.map((v) => v * kB);
    if (a[1]! < 0.005 || a[1]! > 0.9) { des[i] = NaN; continue; }
    const la = lab(a), lb = lab(b), e = de2000(la, lb);
    des[i] = e; all.push(e);
    { const ca = Math.hypot(la[1]!, la[2]!), cb = Math.hypot(lb[1]!, lb[2]!); CA += ca; CB += cb; nC++; if (ca > 8 && cb > 8) { let x = Math.atan2(lb[2]!, lb[1]!) - Math.atan2(la[2]!, la[1]!); if (x > Math.PI) x -= 2 * Math.PI; if (x < -Math.PI) x += 2 * Math.PI; dh += Math.abs(x) * 180 / Math.PI; } }
    const C = Math.hypot(lb[1]!, lb[2]!), hue = ((Math.atan2(lb[2]!, lb[1]!) * 180) / Math.PI + 360) % 360;
    if (C > 8) bins[Math.floor(hue / 30)]!.push(e);
    chromaBins[C < 8 ? 0 : C < 25 ? 1 : 2]!.push(e);
  }
  const med = (v: number[]) => (v.length ? [...v].sort((x, y) => x - y)[v.length >> 1]!.toFixed(2) : '-');
  const p = (v: number[], q: number) => (v.length ? [...v].sort((x, y) => x - y)[Math.floor(q * (v.length - 1))]!.toFixed(2) : '-');
  // white check: the neutral itself through both paths
  const wA = app(A_M, neutral).map((v, _, a) => v / a[1]!), wB = app(B_M, neutral);
  console.log(`${name}: as-shot white xy ${xy.map((v) => v.toFixed(4))} cct ${cct.toFixed(0)} K, share of StdA ${g.toFixed(3)}; neutral → CM path ${wA.map((v) => v.toFixed(4))}, FM path ${wB.map((v) => v.toFixed(4))}`);
  console.log(`  ΔE2000 CM vs FM (same Bradford adaptation): median ${med(all)}, p90 ${p(all, 0.9)}, p99 ${p(all, 0.99)} (n ${all.length})`);
  console.log(`  mean chroma C*ab: CM path ${(CA / nC).toFixed(2)}, FM path ${(CB / nC).toFixed(2)} (FM/CM ${(CB / CA).toFixed(3)}); mean |hue difference| (both C*>8) ${(dh / nC).toFixed(2)}° per pixel`);
  console.log(`  by chroma C*ab <8: ${med(chromaBins[0]!)} (n ${chromaBins[0]!.length}), 8–25: ${med(chromaBins[1]!)} (n ${chromaBins[1]!.length}), >25: ${med(chromaBins[2]!)} (n ${chromaBins[2]!.length})`);
  console.log(`  by hue (C*>8), 30° bins from 0° (red/magenta) through 90° (yellow), 180° (green/cyan), 270° (blue): ${bins.map((b, i) => `${i * 30}:${med(b)}(${b.length})`).join(' ')}`);
  // renders: CM path | FM path | ΔE map (0 → black, 10 → white)
  const W3 = w * 3 + 16;
  ppm(`${OUT}/02-${name}-cm-fm-de.ppm`, W3, h, (i) => {
    const y = Math.floor(i / W3), x = i % W3;
    if (x < w) return app(TO_SRGB, XA[y * w + x]!.map((v) => v * kA)).map(enc);
    if (x < w + 8) return [40, 40, 40];
    if (x < 2 * w + 8) return app(TO_SRGB, XB[y * w + x - w - 8]!.map((v) => v * kB)).map(enc);
    if (x < 2 * w + 16) return [40, 40, 40];
    const e = des[y * w + x - 2 * w - 16]!; const v = Number.isNaN(e) ? 0 : Math.round(255 * Math.min(1, e / 10)); return [v, v, Number.isNaN(e) ? 60 : v];
  });
}
