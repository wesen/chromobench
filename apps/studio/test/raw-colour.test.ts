// CHB-047 OUT-7 (CHB-033 t:y8dh): the RAW colour regression test from CHB-033 script 01. Our camera colour of a NEF
// (LibRaw's single Adobe D65 colour matrix, the as-shot neutral from the camera's multipliers) against Adobe's colour
// of the same photo (Adobe DNG Converter's DNG: dual-illuminant ColorMatrix1/2 and AsShotNeutral, read by our DNG
// path): both through the contract's sceneMatrix (as-shot) to CIE Lab (D65) at 256 px, exposure matched on mean Y, deep
// shadows and highlights left out. CHB-033 measured ΔE2000 median 0.13–0.51 and p99 ≤ 1.3 on four photos and the
// same white balance; the bounds here leave room for LibRaw updates but catch a wrong matrix, white balance or decode.
//
// The files are the photographer's (private, never committed): NEFs in <private>/photos and Adobe's DNGs of them in
// <private>/dng, paired by file name; <private> is $CHROMOBENCH_PRIVATE or the repository's .playwright-mcp. Without a
// pair the test is skipped. It prints numbers only, never file names.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LibRawDecoder } from '@chromobench/ingest';
import { asShotWhiteBalance, sceneMatrix } from '@chromobench/contract';
import { decodePhoto } from '../src/host/decode.ts';

const PRIVATE = process.env['CHROMOBENCH_PRIVATE'] ?? join(import.meta.dirname, '../../../.playwright-mcp');
const stem = (f: string): string => f.replace(/\.[^.]+$/, '');
function pairs(): { nef: string; dng: string }[] {
  const pd = join(PRIVATE, 'photos'), dd = join(PRIVATE, 'dng');
  if (!existsSync(pd) || !existsSync(dd)) return [];
  const dngs = new Map(readdirSync(dd).filter((f) => /\.dng$/i.test(f)).map((f) => [stem(f), join(dd, f)]));
  return readdirSync(pd).filter((f) => /\.nef$/i.test(f) && dngs.has(stem(f))).map((f) => ({ nef: join(pd, f), dng: dngs.get(stem(f))! }));
}

const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
function lab(X: number, Y: number, Z: number): [number, number, number] {
  const fx = f(X / 0.95047), fy = f(Y), fz = f(Z / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
/** CIEDE2000 (Sharma, Wu and Dalal 2005). */
function de2000([L1, a1, b1]: number[], [L2, a2, b2]: number[]): number {
  const C1 = Math.hypot(a1!, b1!), C2 = Math.hypot(a2!, b2!), Cb = (C1 + C2) / 2, G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1!, a2p = (1 + G) * a2!, C1p = Math.hypot(a1p, b1!), C2p = Math.hypot(a2p, b2!);
  const h = (x: number, y: number): number => {
    const d = (Math.atan2(y, x) * 180) / Math.PI;
    return d < 0 ? d + 360 : d;
  };
  const h1 = h(a1p, b1!), h2 = h(a2p, b2!), dL = L2! - L1!, dC = C2p - C1p;
  let dh = h2 - h1;
  if (C1p * C2p === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin((dh * Math.PI) / 360), Lb = (L1! + L2!) / 2, Cbp = (C1p + C2p) / 2;
  let hb = h1 + h2;
  if (C1p * C2p !== 0) hb = Math.abs(h1 - h2) > 180 ? (h1 + h2 + (h1 + h2 < 360 ? 360 : -360)) / 2 : (h1 + h2) / 2;
  const T = 1 - 0.17 * Math.cos(((hb - 30) * Math.PI) / 180) + 0.24 * Math.cos((2 * hb * Math.PI) / 180) + 0.32 * Math.cos(((3 * hb + 6) * Math.PI) / 180) - 0.2 * Math.cos(((4 * hb - 63) * Math.PI) / 180);
  const SL = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2), SC = 1 + 0.045 * Cbp, SH = 1 + 0.015 * Cbp * T;
  const RT = -2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7)) * Math.sin((60 * Math.exp(-(((hb - 275) / 25) ** 2)) * Math.PI) / 180);
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}

const raw = new LibRawDecoder();

/** The photo's scene XYZ (D65) at 256 px through the contract's scene matrix, as shot. */
async function scene(path: string) {
  const d = await decodePhoto(new Uint8Array(readFileSync(path)), 'd'.repeat(64), path.split('/').pop()!, { long: 256, raw });
  const cam = d.info.camera!;
  const M = sceneMatrix(cam, asShotWhiteBalance(cam)!);
  const n = d.info.width * d.info.height, xyz = new Float64Array(n * 3);
  let Y = 0;
  for (let i = 0; i < n; i++) for (let r = 0; r < 3; r++) {
    const v = M[r]![0]! * d.data[i * 3]! + M[r]![1]! * d.data[i * 3 + 1]! + M[r]![2]! * d.data[i * 3 + 2]!;
    xyz[i * 3 + r] = v;
    if (r === 1) Y += v;
  }
  return { xyz, n, w: d.info.width, h: d.info.height, Ymean: Y / n, neutral: cam.asShotNeutral! };
}

const found = pairs();

describe('RAW colour against Adobe (CHB-033 script 01; private files)', () => {
  it.skipIf(!found.length)(`our camera colour is Adobe's within ΔE2000 median 0.75, p99 2 (${found.length} photos)`, async () => {
    let i = 0;
    for (const p of found) {
      i++;
      const A = await scene(p.nef), B = await scene(p.dng);
      expect([A.w, A.h]).toEqual([B.w, B.h]);
      // the same white balance: the NEF's multipliers are Adobe's AsShotNeutral (CHB-031 50c46a2)
      for (let k = 0; k < 3; k++) expect(Math.abs(A.neutral[k]! / B.neutral[k]! - 1)).toBeLessThan(0.005);
      const k = A.Ymean / B.Ymean, s = 0.18 / A.Ymean;
      const des: number[] = [];
      for (let j = 0; j < A.n; j++) {
        const Y = A.xyz[j * 3 + 1]! * s;
        if (Y < 0.005 || Y > 0.9) continue;
        des.push(de2000(lab(A.xyz[j * 3]! * s, Y, A.xyz[j * 3 + 2]! * s), lab(B.xyz[j * 3]! * k * s, B.xyz[j * 3 + 1]! * k * s, B.xyz[j * 3 + 2]! * k * s)));
      }
      des.sort((a, b) => a - b);
      const q = (x: number): number => des[Math.floor(x * (des.length - 1))]!;
      console.log(`photo ${i}: ΔE2000 median ${q(0.5).toFixed(2)}, p90 ${q(0.9).toFixed(2)}, p99 ${q(0.99).toFixed(2)} (n ${des.length}); exposure ratio ${k.toFixed(3)}`);
      expect(des.length).toBeGreaterThan(1000);
      expect(q(0.5)).toBeLessThan(0.75);
      expect(q(0.99)).toBeLessThan(2);
    }
  }, 0);
});
