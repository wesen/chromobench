// Orchestrator check: our NEF colour (LibRaw's single Adobe D65 matrix, as-shot neutral from cam_mul) against
// Adobe's own colour for the same photo (Adobe DNG Converter 19.0's DNG: dual-illuminant ColorMatrix1/2 and
// AsShotNeutral, read by our DNG path). Both through core's cameraMatrix (as-shot), to CIE Lab (D65) at 256 px,
// exposure matched on mean Y. Private files read in place (.playwright-mcp/dng/ is git-ignored); numbers only.
import { existsSync, readFileSync } from 'node:fs';
import { LibRawDecoder, readDngColour } from '@chromobench/ingest';
import { cameraMatrix } from '../../../../../../packages/core/src/film/camera.ts';
import { decodePhoto } from '../../../../../../apps/studio/src/host/decode.ts';
const ROOT = '/home/manuel/code/wesen/chromobench';
const NEF = `${process.env.HOME}/Downloads/2026-11-11 - manfred test bilder`;
const raw = new LibRawDecoder();
const Xn = [0.95047, 1, 1.08883];
const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
const labW = (W: number[]) => (X: number, Y: number, Z: number) => { const fx = f(X / W[0]!), fy = f(Y / W[1]!), fz = f(Z / W[2]!); return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]; };
const lab = labW(Xn);
const labD50 = labW([0.96422, 1, 0.82521]);
const CCT: Record<number, number> = { 17: 2856, 21: 6504, 20: 5503, 23: 5003, 1: 5503 };
/** Adobe's DNG SDK with forward matrices: XYZ(D50) = FM(cct) · diag(1 / neutral) · camera RGB (no AB/CC here). */
function adobeForward(bytes: Uint8Array, white: number[]): { FM: number[][]; neutral: number[] } | null {
  const d = readDngColour(bytes);
  if (!d?.forwardMatrix1 || !d.asShotNeutral) return null;
  const x = white[0]! / (white[0]! + white[1]! + white[2]!), y = white[1]! / (white[0]! + white[1]! + white[2]!);
  const n = (x - 0.332) / (0.1858 - y), cct = 449 * n ** 3 + 3525 * n ** 2 + 6823.3 * n + 5520.33; // McCamy
  const t1 = CCT[d.calibrationIlluminant1 ?? 21] ?? 6504, t2 = CCT[d.calibrationIlluminant2 ?? 21] ?? 6504;
  const m = (v: number[]) => [v.slice(0, 3), v.slice(3, 6), v.slice(6, 9)];
  const F1 = m(d.forwardMatrix1), F2 = d.forwardMatrix2 ? m(d.forwardMatrix2) : F1;
  const [lo, hi, Flo, Fhi] = t1 < t2 ? [t1, t2, F1, F2] : [t2, t1, F2, F1];
  const g = cct <= lo ? 1 : cct >= hi ? 0 : (1 / cct - 1 / hi) / (1 / lo - 1 / hi);
  return { FM: Flo.map((r, i) => r.map((v, j) => g * v + (1 - g) * Fhi[i]![j]!)), neutral: d.asShotNeutral };
}
function de2000(a: number[], b: number[]): number {
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
async function scene(path: string) {
  const d = await decodePhoto(new Uint8Array(readFileSync(path)), 'd'.repeat(64), path.split('/').pop()!, { long: 256, raw });
  const cam = d.info.camera!;
  const { M } = cameraMatrix(cam, { mode: 'as-shot' });
  const n = d.info.width * d.info.height, xyz = new Float64Array(n * 3);
  let Ysum = 0;
  for (let i = 0; i < n; i++) for (let r = 0; r < 3; r++) { const v = M[r]![0]! * d.data[i * 3]! + M[r]![1]! * d.data[i * 3 + 1]! + M[r]![2]! * d.data[i * 3 + 2]!; xyz[i * 3 + r] = v; if (r === 1) Ysum += v; }
  const camWhite = cam.camToXyz ? cam.camToXyz.map((r) => r[0]! * cam.asShotNeutral![0]! + r[1]! * cam.asShotNeutral![1]! + r[2]! * cam.asShotNeutral![2]!) : [1, 1, 1];
  const fwd = path.endsWith('.dng') ? adobeForward(new Uint8Array(readFileSync(path)), camWhite) : null;
  let fxyz: Float64Array | null = null, fY = 0;
  if (fwd) {
    fxyz = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) for (let r = 0; r < 3; r++) { let v = 0; for (let c = 0; c < 3; c++) v += fwd.FM[r]![c]! * d.data[i * 3 + c]! / fwd.neutral[c]!; fxyz[i * 3 + r] = v; if (r === 1) fY += v; }
  }
  return { xyz, n, w: d.info.width, h: d.info.height, Ymean: Ysum / n, cam, fxyz, fYmean: fY / n };
}
for (const name of ['DSC_8559', 'DSC_8541', 'DSC_8536', 'DSC_8655']) {
  const nef = `${NEF}/${name}.NEF`, dng = `${ROOT}/.playwright-mcp/dng/${name}.dng`;
  if (!existsSync(nef) || !existsSync(dng)) { console.log('absent', name); continue; }
  const A = await scene(nef), B = await scene(dng);
  if (A.w !== B.w || A.h !== B.h) { console.log(name, 'size differs', A.w, A.h, B.w, B.h); continue; }
  const k = A.Ymean / B.Ymean; // exposure matched on mean Y (Adobe's BaselineExposure is not applied by us)
  const des: number[] = [], fdes: number[] = [];
  for (let i = 0; i < A.n; i++) {
    const Y = A.xyz[i * 3 + 1]! / A.Ymean * 0.18;
    if (Y < 0.005 || Y > 0.9) continue; // skip deep shadows and highlights (noise, clipping)
    const s = 0.18 / A.Ymean;
    const la = lab(A.xyz[i * 3]! * s, A.xyz[i * 3 + 1]! * s, A.xyz[i * 3 + 2]! * s);
    const lb = lab(B.xyz[i * 3]! * k * s, B.xyz[i * 3 + 1]! * k * s, B.xyz[i * 3 + 2]! * k * s);
    des.push(de2000(la, lb));
    if (B.fxyz) { const kf = A.Ymean / B.fYmean; fdes.push(de2000(la, labD50(B.fxyz[i * 3]! * kf * s, B.fxyz[i * 3 + 1]! * kf * s, B.fxyz[i * 3 + 2]! * kf * s))); }
  }
  des.sort((x, y) => x - y); fdes.sort((x, y) => x - y);
  const q = (p: number, a = des) => a.length ? a[Math.floor(p * (a.length - 1))]!.toFixed(2) : '-';
  const nA = A.cam.asShotNeutral!, nB = B.cam.asShotNeutral!;
  console.log(`${name}: neutral NEF [${nA.map((v) => v.toFixed(3))}] vs Adobe DNG [${nB.map((v) => v.toFixed(3))}]; matrix ${A.cam.from} vs ${B.cam.from}; exposure ratio ${k.toFixed(3)}; ΔE2000 median ${q(0.5)}, p90 ${q(0.9)}, p99 ${q(0.99)} (n ${des.length}); vs Adobe forward matrix: median ${q(0.5, fdes)}, p90 ${q(0.9, fdes)}, p99 ${q(0.99, fdes)}`);
}
