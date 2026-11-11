// Chromogen parity (guide §8.1): on inputs Chromogen handles correctly our decoders and conditioning
// agree with the prototype run in Node; where Chromogen is wrong the difference is the documented bug.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  cameraLinearFromInterleaved, decodePng, decodeTiff, flatGrid, noiseAtScale, openSourceSync, rebateFromBox, region, writeTiff,
} from '@chromobench/ingest';
import { chromogenGold200, GOLD200, GOLD_SETTINGS, loadChromogen } from './chromogen.ts';

const ab = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

describe('decoders vs Chromogen decodeTIFF/decodePNG', () => {
  const W = 21, H = 11;
  const planes = (bits: number): number[][] => [0, 1, 2].map((k) => Array.from({ length: W * H }, (_, i) => (i * 131 + k * 977) % 2 ** bits));
  for (const bits of [8, 16] as const) for (const compression of ['none', 'lzw', 'deflate', 'packbits'] as const) for (const tiled of [false, true]) for (const planar of [false, true]) {
    it(`${bits}-bit ${compression} ${tiled ? 'tiles' : 'strips'} ${planar ? 'planar' : 'chunky'}`, async () => {
      const p = planes(bits);
      const bytes = writeTiff({ images: [{ width: W, height: H, planes: p, bits, compression, planar, predictor: compression === 'none' ? 1 : 2, ...(tiled ? { tile: [16, 16] as [number, number] } : { rowsPerStrip: 3 }) }] });
      const ours = decodeTiff(bytes);
      const theirs = await loadChromogen().decodeTIFF(ab(bytes.slice()));
      const max = 2 ** bits - 1;
      for (let i = 0; i < W * H; i++) for (let k = 0; k < 3; k++) expect(Math.fround(ours.planes[k]![i]! / max)).toBe(theirs.data[3 * i + k]);
    });
  }
  it('32-bit integers: Chromogen divides by (1 << 32) − 1 = 0, ours by 2^32 − 1 (bug 1)', async () => {
    const bytes = writeTiff({ images: [{ width: 1, height: 1, planes: [[2 ** 31]], bits: 32 }] });
    const theirs = await loadChromogen().decodeTIFF(ab(bytes));
    expect(theirs.data[0]).toBe(Infinity);
    expect(decodeTiff(bytes).levels.white[0]).toBe(2 ** 32 - 1);
  });
  it('Gold 200 PNG: identical samples; Chromogen hints sRGB, ours linear (bug 2)', async () => {
    const buf = new Uint8Array(readFileSync(GOLD200));
    const theirs = await loadChromogen().decodePNG(ab(buf));
    const ours = decodePng(buf);
    for (let i = 0; i < ours.width * ours.height; i += 997) for (let k = 0; k < 3; k++) expect(Math.fround(ours.planes[k]![i]! / 65535)).toBe(theirs.data[3 * i + k]);
    expect(theirs.encodedHint).toBe('srgb');
    expect(ours.encoding.value).toBe('linear');
  });
});

describe('conditioning vs Chromogen Source', () => {
  it('rebate and σ at both scales on Gold 200 agree to 1e-6 relative', async () => {
    const C = loadChromogen();
    const S = new C.Source(await chromogenGold200(), {});
    const s = GOLD_SETTINGS;
    const TrebC = S.rebate(s);
    const c = S.crop(s);
    const sg = 640 / 1090;
    const nC = S.noise(s, TrebC, sg, { data: S.region(s, c, 640, 443), w: 640, h: 443 });
    const src = openSourceSync(new Uint8Array(readFileSync(GOLD200)), { options: { levels: { black: [32, 32, 32], white: [64032, 64032, 64032] } } });
    const G = { orientation: 'flipH' as const };
    const rebate = { x: 1174, y: 100, w: 20, h: 680 };
    const Treb = rebateFromBox(src.linear, rebate, G).T;
    Treb.forEach((v, k) => expect(Math.abs(v / TrebC[k]! - 1)).toBeLessThan(1e-6));
    const n = noiseAtScale(src.linear, Treb, sg, { rgb: region(src.linear, { x: 76, y: 60, w: 1090, h: 754 }, 640, 443, G), w: 640, h: 443 }, rebate, G);
    n.sigma.forEach((v, k) => expect(Math.abs(v / nC.sig[k]! - 1)).toBeLessThan(1e-5));
  });
  it('flat-field division on Gold 200 (0.26 D vignette): same densities as Chromogen region() with its flat', async () => {
    const C = loadChromogen();
    const img = await chromogenGold200();
    const W = img.w, H = img.h;
    const V = (x: number, y: number): number => 10 ** (-0.26 * (((x + 0.5) / W - 0.5) ** 2 + ((y + 0.5) / H - 0.5) ** 2) / 0.5);
    const vig = new Float32Array(img.data.length);
    const flat = new Float32Array(img.data.length);
    for (let i = 0; i < W * H; i++) for (let k = 0; k < 3; k++) {
      const v = V(i % W, Math.floor(i / W));
      vig[3 * i + k] = img.data[3 * i + k]! * v;
      flat[3 * i + k] = 0.8 * v;
    }
    C.FLATS.set('f', { w: W, h: H, data: flat });
    const s = { ...GOLD_SETTINGS, flat: { id: 'f', detail: 'smooth' } };
    const S0 = new C.Source(img, {});
    const S1 = new C.Source({ w: W, h: H, data: vig }, {});
    const c = S0.crop(GOLD_SETTINGS);
    const a = S0.region(GOLD_SETTINGS, c, 640, 443);
    const b = S1.region(s, c, 640, 443);
    const T0 = S0.rebate(GOLD_SETTINGS);
    const T1 = S1.rebate(s);
    let worstC = 0;
    for (let i = 0; i < 640 * 443 * 3; i++) worstC = Math.max(worstC, Math.abs(Math.log10((b[i]! / T1[i % 3]!) / (a[i]! / T0[i % 3]!))));
    // ours, same inputs
    const G = { orientation: 'flipH' as const };
    const src0 = cameraLinearFromInterleaved(W, H, img.data);
    const src1 = cameraLinearFromInterleaved(W, H, vig);
    const F = flatGrid(cameraLinearFromInterleaved(W, H, flat));
    const crop = { x: 76, y: 60, w: 1090, h: 754 };
    const rb = { x: 1174, y: 100, w: 20, h: 680 };
    const a2 = region(src0, crop, 640, 443, G);
    const b2 = region(src1, crop, 640, 443, { ...G, flat: F });
    const U0 = rebateFromBox(src0, rb, G).T;
    const U1 = rebateFromBox(src1, rb, { ...G, flat: F }).T;
    let worst = 0;
    for (let i = 0; i < 640 * 443 * 3; i++) worst = Math.max(worst, Math.abs(Math.log10((b2[i]! / U1[i % 3]!) / (a2[i]! / U0[i % 3]!))));
    expect(Math.abs(worst - worstC)).toBeLessThan(2e-5);
  });
  it('flatGrid: same grid on linear data (Chromogen averages before its transfer; identical when linear)', () => {
    const w = 300, h = 200;
    const d = new Float32Array(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) {
      d[(y * w + x) * 3 + k] = (0.5 + 0.1 * k) * (1 - 0.3 * (((x - 150) / 150) ** 2 + ((y - 100) / 100) ** 2)) * (1 + 0.01 * Math.sin(x * 7 + y * 3 + k));
    }
    const theirs = loadChromogen().flatGrid({ w, h, data: d }, (v) => v, 96);
    const ours = flatGrid(cameraLinearFromInterleaved(w, h, d), 'smooth');
    expect([ours.gw, ours.gh]).toEqual([theirs.gw, theirs.gh]);
    for (let i = 0; i < ours.grid.length; i++) expect(Math.abs(ours.grid[i]! - theirs.data[i]!)).toBeLessThan(2e-6);
    ours.falloffD.forEach((v, k) => expect(v).toBeCloseTo(theirs.falloff[k]!, 5));
  });
});
