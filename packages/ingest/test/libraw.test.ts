// Stage 2: LibRaw (WASM) in scan mode and photo mode, the worker protocol, and camera → XYZ
// (guide §5.4, §7 stage 2 "done when"). Fixtures are synthetic CFA DNGs written by our TIFF writer,
// so every expected value is known exactly.
import { describe, expect, it } from 'vitest';
import {
  apply3, decodeAsync, dngCameraToXyz, inv3, LibRawDecoder, linearise, m3, mul3, scanMode, serveRawJobs, workerRawDecoder, writeTiff, XYZtoxy, xyToXYZ,
  type TagValue,
} from '@chromobench/ingest';

const XT = [[1, 1, 0, 1, 1, 2], [1, 1, 2, 1, 1, 0], [2, 0, 1, 0, 2, 1], [1, 1, 2, 1, 1, 0], [1, 1, 0, 1, 1, 2], [0, 2, 1, 2, 0, 1]];
const RGGB = [[0, 1], [1, 2]];
const CM = [0.8, -0.2, -0.05, -0.4, 1.2, 0.2, -0.05, 0.15, 0.6];

interface Synth { bytes: Uint8Array; raw: number[]; w: number; h: number; pattern: number[][]; black: (r: number, c: number) => number; white: number }

/** A CFA DNG: value per channel + small deterministic texture; optional 2×2 black pattern; optional clipped photosites. */
function cfaDng(o: { pattern: number[][]; w?: number; h?: number; black?: number[]; white?: number; clip?: [number, number][]; extraIfd0?: TagValue[] }): Synth {
  const w = o.w ?? 72, h = o.h ?? 48, white = o.white ?? 15000;
  const P = o.pattern, p = P.length;
  const blk = o.black ?? [512];
  const bdim = blk.length === 4 ? 2 : 1;
  const black = (r: number, c: number): number => (bdim === 2 ? blk[(r % 2) * 2 + (c % 2)]! : blk[0]!);
  const raw = new Array<number>(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw[y * w + x] = black(y, x) + [1000, 3000, 2000][P[y % p]![x % p]!]! + ((x * 7 + y * 13) % 11);
  for (const [x, y] of o.clip ?? []) raw[y * w + x] = white;
  const bytes = writeTiff({
    images: [{
      width: w, height: h, planes: [raw], bits: 16, photometric: 32803, newSubfileType: 0,
      tags: [
        { tag: 33421, type: 3, values: [p, p] }, { tag: 33422, type: 1, values: P.flat() },
        { tag: 50710, type: 1, values: [0, 1, 2] }, { tag: 50711, type: 3, values: [1] },
        { tag: 50713, type: 3, values: [bdim, bdim] }, { tag: 50714, type: 3, values: blk }, { tag: 50717, type: 3, values: [white] },
      ],
    }],
    ifd0Tags: [
      { tag: 50706, type: 1, values: [1, 4, 0, 0] }, { tag: 271, type: 2, values: 'Synth' }, { tag: 272, type: 2, values: 'CFA' },
      { tag: 50708, type: 2, values: 'Synth CFA' }, { tag: 50721, type: 10, values: CM }, { tag: 50778, type: 3, values: [21] },
      ...(o.extraIfd0 ?? []),
    ],
  });
  return { bytes, raw, w, h, pattern: P, black, white };
}

/** Expected mean of channel ch over the photosites of block (X, Y) of size b. */
function expectedBin(s: Synth, X: number, Y: number, b: number, ch: number): number {
  let sum = 0, n = 0;
  for (let r = Y * b; r < Y * b + b; r++) for (let c = X * b; c < X * b + b; c++) {
    if (s.pattern[r % s.pattern.length]![c % s.pattern.length] !== ch) continue;
    sum += s.raw[r * s.w + c]! - s.black(r, c);
    n++;
  }
  return sum / n;
}

const dec = new LibRawDecoder();

describe('LibRaw build (DR-4)', () => {
  it('loads @colorhythm/libraw-wasm and reports its LibRaw version', async () => {
    expect(await LibRawDecoder.version()).toMatch(/^0\.22\./);
  });
  it('reports CFA, levels and the black pattern', async () => {
    const s = cfaDng({ pattern: RGGB, black: [500, 510, 505, 515] });
    const { info, sha256 } = await dec.probe(s.bytes);
    expect(sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(info.cfa).toEqual({ kind: 'bayer', period: 2, map: [0, 1, 3, 2] });
    expect(info.blackPattern).toEqual({ rows: 2, cols: 2, values: [500, 510, 505, 515] });
    expect(info.white).toBe(15000);
    expect(info.camera.make).toBe('Synth');
  });
});

describe('scan mode', () => {
  it('Bayer 2×2 binning equals the mean of the matching photosites, black pattern subtracted', async () => {
    const s = cfaDng({ pattern: RGGB, black: [500, 510, 505, 515] });
    const img = await dec.decode(s.bytes, { mode: 'scan', bin: 'cfa' });
    expect([img.width, img.height, img.channels]).toEqual([36, 24, 3]);
    for (const [X, Y] of [[0, 0], [7, 5], [35, 23]] as const) for (let k = 0; k < 3; k++) expect(img.planes[k]![Y * 36 + X]).toBeCloseTo(expectedBin(s, X, Y, 2, k), 2);
    expect(img.levels.white).toEqual([14500, 15000 - 507.5, 14485]);
    expect(img.levels.from).toBe('libraw');
    // linear: 1 at the white level, no white balance, no matrix
    const lin = linearise(img, { sha256: 'x' });
    const row = new Float64Array(36);
    lin.row(1, 0, row);
    expect(row[0]).toBeCloseTo(expectedBin(s, 0, 0, 2, 1) / (15000 - 507.5), 6);
  });
  it('X-Trans 6×6 (8 R, 20 G, 8 B) and 3×3 (2, 5, 2) binning', async () => {
    const s = cfaDng({ pattern: XT, black: [600] });
    const full = await dec.decode(s.bytes, { bin: 'cfa' });
    expect([full.width, full.height]).toEqual([12, 8]);
    for (let k = 0; k < 3; k++) expect(full.planes[k]![3 * 12 + 5]).toBeCloseTo(expectedBin(s, 5, 3, 6, k), 2);
    const half = await dec.decode(s.bytes, { bin: 'cfa-half' });
    expect([half.width, half.height]).toEqual([24, 16]);
    for (let k = 0; k < 3; k++) expect(half.planes[k]![7 * 24 + 11]).toBeCloseTo(expectedBin(s, 11, 7, 3, k), 2);
    expect(full.meta.cfa).toBe('xtrans');
  });
  it('bin none keeps every photosite with the CFA map', async () => {
    const s = cfaDng({ pattern: RGGB });
    const img = await dec.decode(s.bytes, { bin: 'none' });
    expect([img.width, img.channels]).toEqual([72, 1]);
    expect(img.planes[0]![5 * 72 + 9]).toBe(s.raw[5 * 72 + 9]! - 512);
    expect(img.meta.cfaMap).toEqual({ period: 2, map: [0, 1, 1, 2] });
  });
  it('clipping is flagged per binned pixel', async () => {
    const s = cfaDng({ pattern: RGGB, clip: [[11, 6]] });
    const img = await dec.decode(s.bytes, { bin: 'cfa' });
    const lin = linearise(img, { sha256: 'x' });
    expect(lin.clipped![3 * 36 + 5]).toBe(1);
    expect(lin.clippedFraction).toBeCloseTo(1 / (36 * 24), 9);
  });
  it('scanMode is pure: it refuses blocks without a channel', () => {
    expect(() => scanMode({ data: new Uint16Array(4), stride: 2, info: { libraw: 't', rawSize: [2, 2], visible: { x: 0, y: 0, w: 2, h: 2 }, cfa: { kind: 'bayer', period: 2, map: [0, 0, 0, 0] }, black: [0, 0, 0, 0], white: 10, flip: 0, camera: { make: '', model: '', iso: 0, exposure_s: 0, fnumber: 0 } } })).toThrow(/no photosite/);
  });
});

describe('routing, errors and the worker', () => {
  it('the registry routes a CFA DNG to LibRaw', async () => {
    const s = cfaDng({ pattern: RGGB });
    const img = await decodeAsync(s.bytes, { raw: dec, options: { bin: 'cfa' } });
    expect(img.meta.format).toBe('raw');
    expect(img.meta.dng?.colorMatrix1).toEqual(CM);
    expect(img.meta.camera?.from).toBe('dng');
  });
  it('a non-RAW file is E_FORMAT with LibRaw\'s message', async () => {
    await expect(dec.decode(new Uint8Array(1000).fill(7))).rejects.toMatchObject({ code: 'E_FORMAT' });
  });
  it('decodes through the worker protocol with transferred buffers', async () => {
    const ch = new MessageChannel();
    serveRawJobs(ch.port1);
    const w = workerRawDecoder(ch.port2);
    const s = cfaDng({ pattern: RGGB });
    const copy = s.bytes.slice();
    const img = await w.decode(copy, { bin: 'cfa' });
    expect(copy.byteLength).toBe(0); // transferred, zero copy
    expect(img.planes[0]).toBeInstanceOf(Float32Array);
    expect(img.planes[2]![0]).toBeCloseTo(expectedBin(s, 0, 0, 2, 2), 2);
    expect(img.meta.clipped).toBeInstanceOf(Uint8Array);
    const { info } = await w.probe(s.bytes.slice());
    expect(info.cfa.kind).toBe('bayer');
    await expect(w.decode(new Uint8Array(100).fill(1), {})).rejects.toMatchObject({ code: 'E_FORMAT' });
    ch.port1.close();
    ch.port2.close();
  });
});

describe('photo mode and camera → XYZ (DNG chapter 6)', () => {
  it('photo mode demosaics to linear 16-bit camera RGB with a DNG matrix', async () => {
    const s = cfaDng({ pattern: RGGB, extraIfd0: [{ tag: 50728, type: 5, values: [0.5, 1, 0.7] }] });
    const img = await dec.decode(s.bytes, { mode: 'photo' });
    expect(img.channels).toBe(3);
    expect(img.bits).toBe(16);
    expect(img.width).toBeGreaterThanOrEqual(70);
    expect(img.meta.camera?.asShotNeutral).toEqual([0.5, 1, 0.7]);
    // no white balance: the green of a flat patch stays near (3000 + 5) / (15000 − 512) of full scale
    const g = img.planes[1]![20 * img.width + 30]! / 65535;
    expect(g).toBeCloseTo(3005 / 14488, 1);
  });
  it('maps AsShotNeutral to the white\'s chromaticity within 1e-3 (two illuminants)', () => {
    const cmA = m3([0.9, -0.25, -0.1, -0.45, 1.3, 0.15, -0.1, 0.25, 0.55]);
    const cmD65 = m3(CM);
    for (const xy of [[0.3457, 0.3585], [0.3324, 0.3474], [0.4, 0.38], [0.3127, 0.329]] as [number, number][]) {
      // forward: the camera neutral of white xy, built with the matrix interpolated at that white
      const est = dngCameraToXyz({ colorMatrix1: [...cmA.flat()], colorMatrix2: [...cmD65.flat()], calibrationIlluminant1: 17, calibrationIlluminant2: 21, asShotWhiteXY: xy });
      const neutral = apply3(inv3(est.camToXyz), xyToXYZ(...xy));
      const r = dngCameraToXyz({ colorMatrix1: [...cmA.flat()], colorMatrix2: [...cmD65.flat()], calibrationIlluminant1: 17, calibrationIlluminant2: 21, asShotNeutral: neutral });
      expect(Math.hypot(r.whiteXy[0] - xy[0], r.whiteXy[1] - xy[1])).toBeLessThan(1e-3);
      const white = XYZtoxy(apply3(r.camToXyz, neutral));
      expect(Math.hypot(white[0] - xy[0], white[1] - xy[1])).toBeLessThan(1e-3);
      expect(apply3(r.camToXyz, neutral)[1]).toBeCloseTo(1, 9);
    }
    expect(mul3(inv3(cmD65), cmD65)[0]![0]).toBeCloseTo(1, 12);
  });
});
