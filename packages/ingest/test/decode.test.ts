// Stage 1 decoder tests (guide §8.1): generated round trips over the TIFF feature matrix, interop with
// libtiff-written files, the §4.2 bug regressions, PNG encoding evidence, and the averaging order.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isChromobenchError } from '@chromobench/contract';
import {
  cameraLinearFromInterleaved, decodePng, decodeSync, decodeTiff, floatToHalf, halfToFloat, linearise, lzwDecode, lzwEncode,
  openSourceSync, packbitsDecode, packbitsEncode, readIfds, region, srgbDecode, toInterleaved, tripletRef, tripletSha256,
  writePng, writeTiff, decodeAsync, mergeTriplet, sniff, type Plane, type TiffImageSpec,
} from '@chromobench/ingest';

const fx = (name: string): Uint8Array => new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));

const W = 13;
const H = 9;
function pattern(bits: 8 | 16 | 32, float: boolean, spp: number): number[][] {
  return Array.from({ length: spp }, (_, k) => Array.from({ length: W * H }, (_, i) => {
    if (float) return Math.fround(((i * 37 + k * 101) % 997) / 997 * 1.5 - 0.1);
    const max = 2 ** bits - 1;
    return Math.floor(((i * 2654435761 + k * 40503) % 4294967296) / 4294967296 * max);
  }));
}

function expectFormatError(f: () => unknown, re: RegExp): void {
  try {
    f();
  } catch (e) {
    expect(isChromobenchError(e) && e.code === 'E_FORMAT').toBe(true);
    expect((e as Error).message).toMatch(re);
    return;
  }
  throw new Error('expected E_FORMAT');
}

describe('codecs', () => {
  it('LZW round-trips random and repetitive data (table resets, 12-bit codes)', () => {
    const rnd = new Uint8Array(20000).map((_, i) => (i * 7919 + ((i * i) >> 3)) & 255);
    const rep = new Uint8Array(20000).map((_, i) => (i >> 6) & 3);
    for (const d of [rnd, rep, new Uint8Array(1), new Uint8Array([5, 5, 5, 5])]) expect(lzwDecode(lzwEncode(d), d.length)).toEqual(d);
  });
  it('PackBits round-trips', () => {
    const d = new Uint8Array(1000).map((_, i) => (i % 50 < 20 ? 7 : i & 255));
    expect(packbitsDecode(packbitsEncode(d), d.length)).toEqual(d);
  });
  it('half floats', () => {
    expect(halfToFloat(0x3c00)).toBe(1);
    expect(halfToFloat(0xc000)).toBe(-2);
    expect(halfToFloat(floatToHalf(0.333))).toBeCloseTo(0.333, 3);
  });
});

describe('TIFF feature matrix (generated)', () => {
  const cases: { name: string; spec: Omit<TiffImageSpec, 'planes' | 'width' | 'height'>; spp: number; le: boolean }[] = [];
  for (const le of [true, false]) for (const [bits, float] of [[8, false], [16, false], [32, false], [32, true], [16, true]] as const) {
    for (const compression of ['none', 'lzw', 'deflate', 'packbits'] as const) {
      const preds: (1 | 2 | 3)[] = float ? [1, 3] : [1, 2];
      for (const predictor of preds) for (const layout of ['strips', 'tiles'] as const) for (const planar of [false, true]) for (const spp of [1, 3, 4]) {
        if (spp === 1 && planar) continue;
        cases.push({
          name: `${le ? 'II' : 'MM'} ${bits}${float ? 'f' : 'u'} ${compression} p${predictor} ${layout} ${planar ? 'planar' : 'chunky'} spp${spp}`,
          spec: { bits, sampleFormat: float ? 'float' : 'uint', compression, predictor, ...(layout === 'tiles' ? { tile: [16, 16] as [number, number] } : { rowsPerStrip: 4 }), planar, ...(spp === 4 ? { extraSamples: [0] } : {}) },
          spp, le,
        });
      }
    }
  }
  it(`covers ${cases.length} combinations`, () => expect(cases.length).toBeGreaterThan(300));
  for (const c of cases) {
    it(c.name, () => {
      const float = c.spec.sampleFormat === 'float';
      const planes = pattern(c.spec.bits, float, c.spp);
      const bytes = writeTiff({ littleEndian: c.le, images: [{ ...c.spec, width: W, height: H, planes }] });
      const copy = bytes.slice();
      const img = decodeTiff(bytes);
      expect(bytes).toEqual(copy); // never writes into the caller's buffer (bug 9)
      expect(img.width).toBe(W);
      expect(img.channels).toBe(c.spp);
      for (let k = 0; k < c.spp; k++) {
        const got = Array.from(img.planes[k]!);
        if (float && c.spec.bits === 16) got.forEach((v, i) => expect(v).toBeCloseTo(halfToFloat(floatToHalf(planes[k]![i]!)), 6));
        else expect(got).toEqual(planes[k]);
      }
      expect(Array.from(decodeTiff(bytes).planes[0]!)).toEqual(Array.from(img.planes[0]!)); // decoding twice is identical
    });
  }
});

describe('TIFF interop with libtiff (Pillow) files', () => {
  const rgb8 = (x: number, y: number): number[] => [(x * 7 + y * 3) % 256, (x * 5 + y * 11 + 40) % 256, (x * y + 9) % 256];
  for (const comp of ['raw', 'tiff_lzw', 'tiff_adobe_deflate', 'packbits']) {
    it(`RGB8 ${comp}`, () => {
      const img = decodeTiff(fx(`pil-rgb8-${comp}.tif`));
      for (let y = 0; y < 23; y++) for (let x = 0; x < 37; x++) expect([0, 1, 2].map((k) => img.planes[k]![y * 37 + x])).toEqual(rgb8(x, y));
      expect(img.encoding).toEqual({ value: 'srgb', evidence: 'bit-depth' });
    });
    it(`grey16 ${comp}`, () => {
      const img = decodeTiff(fx(`pil-grey16-${comp}.tif`));
      expect(img.channels).toBe(1);
      for (let y = 0; y < 23; y++) for (let x = 0; x < 37; x++) expect(img.planes[0]![y * 37 + x]).toBe((x * 1543 + y * 977 + 12345) % 65536);
      expect(img.encoding.value).toBe('linear');
      expect(img.meta.notes.map((n) => n.code)).toContain('W_ENCODING_ASSUMED');
    });
  }
  it('RGB8 LZW with predictor 2', () => {
    const img = decodeTiff(fx('pil-rgb8-lzw-pred2.tif'));
    expect([0, 1, 2].map((k) => img.planes[k]![5 * 37 + 9])).toEqual(rgb8(9, 5));
  });
  it('large LZW image (12-bit codes, clear codes)', () => {
    const img = decodeTiff(fx('pil-rgb8-lzw-big.tif'));
    const ref = fx('pil-rgb8-lzw-big.rgb');
    for (let i = 0; i < 96 * 128; i++) for (let k = 0; k < 3; k++) expect(img.planes[k]![i]).toBe(ref[i * 3 + k]);
  });
});

describe('Chromogen bug regressions (guide §4.2)', () => {
  const one = (bits: 8 | 16 | 32, values: number[], extra: Partial<TiffImageSpec> = {}): Uint8Array =>
    writeTiff({ images: [{ width: values.length, height: 1, planes: [values], bits, ...extra }] });
  it('1: a 32-bit unsigned TIFF of 2^31 reads 0.5', () => {
    const img = decodeTiff(one(32, [2 ** 31, 2 ** 32 - 1]));
    expect(img.levels.white[0]).toBe(2 ** 32 - 1);
    const lin = linearise(img, { sha256: 'x' });
    const row = new Float64Array(2);
    lin.row(0, 0, row);
    expect(row[0]).toBeCloseTo(0.5, 9);
    expect(row[1]).toBe(1);
  });
  it('4: a half-float TIFF of 1.0 reads 1.0', () => {
    const img = decodeTiff(one(16, [1, 0.5], { sampleFormat: 'float' }));
    expect(Array.from(img.planes[0]!)).toEqual([1, 0.5]);
    expect(img.encoding.value).toBe('linear');
  });
  it('5: predictor 3 is undone; predictor 2 on 32-bit integers is undone', () => {
    expect(Array.from(decodeTiff(one(32, [0.25, 0.75, 1.5], { sampleFormat: 'float', predictor: 3, compression: 'deflate' })).planes[0]!)).toEqual([0.25, 0.75, 1.5]);
    expect(Array.from(decodeTiff(one(32, [7, 4_000_000_000, 3], { predictor: 2 })).planes[0]!)).toEqual([7, 4_000_000_000, 3]);
  });
  it('6: SRATIONAL matrices parse; two type-13 SubIFDs are both found', () => {
    const img = (w: number): TiffImageSpec => ({ width: w, height: 2, planes: [Array(2 * w).fill(9)], bits: 16 });
    const bytes = writeTiff({
      images: [{ ...img(2), newSubfileType: 1 }],
      subImages: [img(3), { ...img(5), photometric: 34892 }], subIfdType: 13,
      ifd0Tags: [{ tag: 50706, type: 1, values: [1, 4, 0, 0] }, { tag: 50721, type: 10, values: [0.5, -0.25, 0, -0.125, 1, 0, 0, 0, 1.5] }],
    });
    const ifds = readIfds(bytes);
    expect(ifds.length).toBe(3);
    const raw = decodeTiff(bytes);
    expect(raw.width).toBe(5);
    expect(raw.meta.format).toBe('dng');
    expect(raw.meta.dng?.colorMatrix1).toEqual([0.5, -0.25, 0, -0.125, 1, 0, 0, 0, 1.5]);
  });
  it('8: an RGBI TIFF keeps its fourth plane as infrared', () => {
    const img = decodeTiff(writeTiff({ images: [{ width: 2, height: 1, planes: [[1, 2], [3, 4], [5, 6], [7, 8]], bits: 16, extraSamples: [0] }] }));
    expect(img.channels).toBe(4);
    expect(Array.from(img.planes[3]!)).toEqual([7, 8]);
    expect(img.meta.irPlane).toBe(3);
    const alpha = decodeTiff(writeTiff({ images: [{ width: 2, height: 1, planes: [[1, 2], [3, 4], [5, 6], [7, 8]], bits: 16, extraSamples: [2] }] }));
    expect(alpha.channels).toBe(3);
  });
  it('10: short strips are refused, not zero-filled', () => {
    const b = one(16, [1, 2, 3, 4]);
    const ifd = readIfds(b)[0]!;
    const off = ifd.tags.get(273)![0]!;
    expectFormatError(() => decodeTiff(b.slice(0, off + 5)), /past the end|holds/);
  });
  it('refuses with the feature named', () => {
    expectFormatError(() => decodeTiff(writeTiff({ images: [{ width: 2, height: 1, planes: [[1, 2]], bits: 8, tags: [{ tag: 339, type: 3, values: [2] }] }] })), /signed/);
    expectFormatError(() => decodeTiff(writeTiff({ images: [{ width: 2, height: 1, planes: [[1, 2]], bits: 8, photometric: 32803 }] })), /CFA/);
    expectFormatError(() => decodeTiff(writeTiff({ images: [{ width: 2, height: 1, planes: [[1, 2], [1, 2], [1, 2]], bits: 8, photometric: 6 }] })), /photometric/);
  });
});

describe('LinearRaw DNG', () => {
  const dng = (extra: { tag: number; type: number; values: number[] }[] = [], photometric = 34892, compression: 'none' | 'lzw' = 'lzw'): Uint8Array => writeTiff({
    images: [{ width: 4, height: 2, planes: [[0, 1, 2, 3, 4, 5, 6, 7], [10, 11, 12, 13, 14, 15, 16, 17], [600, 1600, 2600, 3600, 4096, 2000, 1000, 512]].map((p) => p.map((v) => v * 10)), bits: 16, photometric, compression, newSubfileType: 0, tags: extra }],
    ifd0Tags: [{ tag: 50706, type: 1, values: [1, 4, 0, 0] }, { tag: 271, type: 2, values: 'TestMake' as never }, { tag: 50728, type: 5, values: [0.5, 1, 0.7] }, { tag: 274, type: 3, values: [6] }],
  });
  it('reads black/white levels, colour tags, orientation; linear by format', () => {
    const raw = decodeTiff(dng([{ tag: 50714, type: 3, values: [100, 100, 200] }, { tag: 50717, type: 3, values: [40960] }]));
    expect(raw.levels).toEqual({ black: [100, 100, 200], white: [40960, 40960, 40960], from: 'file' });
    expect(raw.encoding).toEqual({ value: 'linear', evidence: 'format' });
    expect(raw.meta.dng?.asShotNeutral).toEqual([0.5, 1, 0.7]);
    expect(raw.meta.orientationTag).toBe(6);
    expect(raw.meta.camera?.make).toBe('TestMake');
    const lin = linearise(raw, { sha256: 'd' });
    const row = new Float64Array(4);
    lin.row(2, 1, row);
    expect(row[0]).toBeCloseTo((40960 - 200) / (40960 - 200), 9);
    expect(lin.clippedFraction).toBeCloseTo(1 / 8, 9);
  });
  it('applies ActiveArea, records DefaultCrop, folds LinearizationTable into the LUT', () => {
    const lut = Array.from({ length: 65536 }, (_, u) => Math.min(65535, u * 2));
    const raw = decodeTiff(dng([{ tag: 50829, type: 3, values: [0, 1, 2, 4] }, { tag: 50719, type: 3, values: [0, 0] }, { tag: 50720, type: 3, values: [2, 2] }, { tag: 50712, type: 3, values: lut }, { tag: 50717, type: 4, values: [65535] }]));
    expect(raw.width).toBe(3);
    expect(Array.from(raw.planes[0]!)).toEqual([10, 20, 30, 50, 60, 70]);
    expect(raw.meta.defaultCrop).toEqual({ x: 0, y: 0, w: 2, h: 2 });
    const row = new Float64Array(3);
    linearise(raw, { sha256: 'd' }).row(0, 0, row);
    expect(row[1]).toBeCloseTo(40 / 65535, 7);
  });
  it('routes CFA DNG to LibRaw (E_FORMAT without a decoder)', async () => {
    const b = dng([], 32803);
    expectFormatError(() => decodeTiff(b), /LibRaw/);
    await expect(decodeAsync(b)).rejects.toThrow(/LibRaw/);
    const raw = await decodeAsync(b, { raw: { name: 'fake', decode: async () => decodeTiff(dng()) } });
    expect(raw.width).toBe(4);
  });
});

describe('PNG and the encoding evidence table (guide §5.2)', () => {
  const planes = [[0, 30000, 65535, 1], [5, 6, 7, 8], [9, 10, 11, 12]];
  const enc = (o: Parameters<typeof writePng>[0]): string => {
    const r = decodePng(writePng(o));
    return `${r.encoding.value}/${r.encoding.evidence}/${r.meta.notes.map((n) => n.code).join(',')}`;
  };
  it('decodes 16-bit RGB exactly through every filter', () => {
    for (const filter of [0, 1, 2, 3, 4] as const) {
      const r = decodePng(writePng({ width: 2, height: 2, planes, bits: 16, filter }));
      expect(r.planes.map((p) => Array.from(p))).toEqual(planes);
    }
  });
  it('16-bit without colour evidence is linear with W_ENCODING_ASSUMED (bug 2)', () => {
    expect(enc({ width: 2, height: 2, planes, bits: 16 })).toBe('linear/bit-depth/W_ENCODING_ASSUMED');
  });
  it('chunks and metadata', () => {
    expect(enc({ width: 2, height: 2, planes, bits: 16, srgb: true })).toBe('srgb/chunk/');
    expect(enc({ width: 2, height: 2, planes, bits: 16, gama: 45455 })).toBe('srgb/chunk/');
    expect(enc({ width: 2, height: 2, planes, bits: 8 as const, gama: 100000 } as never)).toBe('linear/chunk/');
    expect(enc({ width: 2, height: 2, planes, bits: 16, iccp: true })).toBe('srgb/chunk/W_ICC_IGNORED');
    expect(enc({ width: 2, height: 2, planes, bits: 16, srgb: true, chromobenchEncoding: 'gamma22' })).toBe('gamma22/metadata/');
    expect(enc({ width: 2, height: 2, planes: planes.map((p) => p.map((v) => v & 255)), bits: 8 })).toBe('srgb/bit-depth/');
    const declared = decodePng(writePng({ width: 2, height: 2, planes, bits: 16 }), { declaredEncoding: 'srgb' });
    expect(declared.encoding).toEqual({ value: 'srgb', evidence: 'declared' });
  });
  it('refuses palette and interlace', () => {
    const p = writePng({ width: 2, height: 2, planes, bits: 16 });
    p[8 + 8 + 12] = 1; // interlace byte of IHDR (CRC mismatch is not checked)
    expectFormatError(() => decodePng(p), /interlaced/);
  });
});

describe('linearise first, average second (DR-1, guide §2.1)', () => {
  it('a 2×1 sRGB edge (0.2, 0.8) resamples to linear 0.3185, not 0.2140', () => {
    const codes = [Math.round(0.2 * 65535), Math.round(0.8 * 65535)];
    const bytes = writePng({ width: 2, height: 1, planes: [codes, codes, codes], bits: 16, srgb: true });
    const { linear } = openSourceSync(bytes);
    const v = region(linear, { x: 0, y: 0, w: 2, h: 1 }, 1, 1)[0]!;
    expect(v).toBeCloseTo(0.3185, 4);
    // The broken variant (Chromogen's region: average the codes, then decode) is 0.17 D off.
    const broken = srgbDecode((codes[0]! + codes[1]!) / 2 / 65535);
    expect(broken).toBeCloseTo(0.2140, 4);
    expect(-Math.log10(broken) - -Math.log10(v)).toBeCloseTo(0.173, 3);
  });
});

describe('identity, routing and triplets', () => {
  it('triplet identity is order-defined', () => {
    const ref = tripletRef([{ role: 'B', sha256: 'b' }, { role: 'R', sha256: 'r' }, { role: 'G', sha256: 'g' }]);
    expect(ref.sha256).toBe(tripletSha256('r', 'g', 'b'));
    expect(ref.parts!.map((p) => p.role)).toEqual(['R', 'G', 'B']);
  });
  it('sniffs RAW by extension and magic', () => {
    expect(sniff(new Uint8Array([0x49, 0x49, 42, 0, 8, 0, 0, 0]), 'x.NEF')).toBe('libraw');
    expect(sniff(new TextEncoder().encode('FUJIFILMCCD-RAW 0201'))).toBe('libraw');
    expect(sniff(new Uint8Array([0x49, 0x49, 42, 0, 8, 0, 0, 0]), 'x.tif')).toBe('tiff');
    expect(() => decodeSync(new Uint8Array(16))).toThrow(/unrecognised/);
  });
  it('merges a triplet with roles from the data, and warns on a shift', () => {
    const w = 64, h = 48;
    const make = (dom: number, shift: number): ReturnType<typeof cameraLinearFromInterleaved> => {
      const d = new Float32Array(w * h * 3);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const t = 0.2 + 0.6 * (((x - shift) >> 3) % 2 ? 1 : 0) * ((y >> 3) % 2 ? 1 : 0.5);
        for (let k = 0; k < 3; k++) d[(y * w + x) * 3 + k] = t * (k === dom ? 1 : 0.1);
      }
      return cameraLinearFromInterleaved(w, h, d, 3, `h${dom}`);
    };
    const parts = [make(2, 0), make(0, 0), make(1, 0)]; // files in B, R, G order
    const m = mergeTriplet(parts);
    expect(m.roles).toEqual(['R', 'G', 'B']);
    expect(m.sha256).toBe(tripletSha256('h0', 'h1', 'h2'));
    expect(m.notes.some((n) => /disagree/.test(n.message))).toBe(true);
    expect(m.shifts.every((s) => Math.hypot(s.dx, s.dy) < 0.5)).toBe(true);
    const all = toInterleaved(m.linear);
    expect([all[0], all[1], all[2]].map((v) => +v!.toFixed(6))).toEqual([0.2, 0.2, 0.2]); // own channel of each LED exposure
    const shifted = mergeTriplet([make(0, 0), make(1, 0), make(2, 2)]);
    expect(Math.abs(shifted.shifts[1]!.dx - 2)).toBeLessThan(0.75);
    expect(shifted.notes.some((n) => n.code === 'W_TRIPLET_SHIFT' && /shifted/.test(n.message))).toBe(true);
  });
  it('planes are typed by bit depth', () => {
    const p: Plane = decodeTiff(writeTiff({ images: [{ width: 1, height: 1, planes: [[3]], bits: 16 }] })).planes[0]!;
    expect(p).toBeInstanceOf(Uint16Array);
  });
});
