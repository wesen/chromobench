// CHB-027 WS-A (F1, F15): photo or negative, guessed from the pixels. Synthetic images with known truth; the
// photographer's own files (private, never in the repository) are checked only when present on this machine.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@chromobench/contract';
import { decodeAsync, guessOpenMode, LibRawDecoder, linearise, openPrior, plantedStrip, region } from '@chromobench/ingest';

/** A daylight scene as camera-colour linear light: grey ramp, sky, foliage, a red object, a blown highlight; textured. */
function photo(o: { w?: number; h?: number; light?: Vec3 } = {}): { rgb: Float32Array; w: number; h: number } {
  const w = o.w ?? 300, h = o.h ?? 200;
  const L = o.light ?? [1, 1, 1];
  const rgb = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let c: number[];
    if (y < h * 0.3) c = [0.25, 0.35, 0.6]; // sky
    else if (y > h * 0.75) c = [0.06, 0.12, 0.04]; // foliage
    else c = [0.02 + 0.4 * (x / w), 0.02 + 0.4 * (x / w), 0.02 + 0.4 * (x / w)]; // a grey wall
    if (x > w * 0.1 && x < w * 0.25 && y > h * 0.4 && y < h * 0.6) c = [0.4, 0.05, 0.04]; // a red object
    if (x > w * 0.8 && y > h * 0.35 && y < h * 0.45) c = [1, 1, 1]; // blown highlight
    // texture, as every real scene has (a flat band at the border would read as film rebate)
    const t = 1 + 0.25 * Math.sin(x * 0.9 + y * 0.37) * Math.cos(y * 0.71 - x * 0.23);
    for (let k = 0; k < 3; k++) rgb[(y * w + x) * 3 + k] = Math.min(1, c[k]! * L[k]! * t);
  }
  return { rgb, w, h };
}

/** That scene as a colour negative scanned tight to the image: the base (orange mask) × 10^−D, D = 0.6 · lg(exposure / 0.01). */
function negativeOf(s: { rgb: Float32Array; w: number; h: number }): Float32Array {
  const base = [0.75, 0.42, 0.22];
  const out = new Float32Array(s.rgb.length);
  for (let i = 0; i < s.w * s.h; i++) for (let k = 0; k < 3; k++) out[i * 3 + k] = 0.9 * base[k]! * 10 ** -(0.6 * Math.log10(Math.max(s.rgb[i * 3 + k]!, 0.01) / 0.01));
  return out;
}

describe('guessOpenMode on synthetic images', () => {
  it('a 135 frame in its holder (rebate, sprocket holes, orange base) is a negative, surely', () => {
    const p = plantedStrip({ pxPerMm: 6 });
    const g = guessOpenMode(p.rgb, p.w, p.h, { name: 'scan-001.tif', format: 'tiff' });
    expect(g.kind).toBe('negative');
    expect(g.confident).toBe(true);
    expect(g.evidence.castRB).toBeGreaterThan(0.4);
  });

  it('a negative cropped tight to the image (no film edge) is still a negative by its mask', () => {
    const s = photo();
    const g = guessOpenMode(negativeOf(s), s.w, s.h, { name: 'frame.png', format: 'png' });
    expect(g.kind).toBe('negative');
    expect(g.confident).toBe(true);
    expect(g.evidence.orangeShare).toBeGreaterThan(0.7);
  });

  it('the same tight crop from a camera RAW: negative, but asks (it could be a photo in tungsten light)', () => {
    const s = photo();
    expect(guessOpenMode(negativeOf(s), s.w, s.h, { name: 'DSC_0001.NEF', format: 'raw' })).toMatchObject({ kind: 'negative', confident: false });
  });

  it('a daylight photo is a photo, surely, even as a TIFF with a blown highlight', () => {
    const s = photo();
    expect(guessOpenMode(s.rgb, s.w, s.h, { name: 'DSC_8559.NEF', format: 'raw' })).toMatchObject({ kind: 'photo', confident: true });
    expect(guessOpenMode(s.rgb, s.w, s.h, { name: 'export.jpg', format: 'image' })).toMatchObject({ kind: 'photo', confident: true });
    // a TIFF leans negative: a photo there is still the guess, but asked
    expect(guessOpenMode(s.rgb, s.w, s.h, { name: 'export.tif', format: 'tiff' })).toMatchObject({ kind: 'photo', confident: false });
  });

  it('a warm (tungsten, no white balance) photo is not taken for a negative', () => {
    const s = photo({ light: [1, 0.62, 0.3] });
    const g = guessOpenMode(s.rgb, s.w, s.h, { name: 'DSC_8541.NEF', format: 'raw' });
    expect(g.kind).toBe('photo');
  });

  it('white-balance multipliers apply before the colour is read', () => {
    // camera-native data: green twice red and blue; with the daylight multipliers it is the neutral scene again
    const neutral = photo();
    const s = photo({ light: [0.5, 1, 0.7] });
    const g = guessOpenMode(s.rgb, s.w, s.h, { name: 'x.dng', format: 'dng', wb: [2, 1, 1 / 0.7] });
    const n = guessOpenMode(neutral.rgb, neutral.w, neutral.h, { name: 'x.dng', format: 'dng' });
    expect(g.evidence.castRG).toBeCloseTo(n.evidence.castRG, 3);
    expect(g.evidence.castRB).toBeCloseTo(n.evidence.castRB, 3);
    expect(g.kind).toBe('photo');
  });

  it('priors by file type', () => {
    expect(openPrior({ name: 'DSC_8559.NEF' })).toBe('photo');
    expect(openPrior({ name: 'IMG_1.CR3' })).toBe('photo');
    expect(openPrior({ name: 'a.jpeg' })).toBe('photo');
    expect(openPrior({ name: 'scan.tif' })).toBe('negative');
    expect(openPrior({ name: 'raw010.dng' })).toBe(null);
  });
});

// The photographer's own files (CHB-026 session 01). Private: read here when present, never copied.
const NEF = '/home/manuel/Downloads/2026-11-11 - manfred test bilder/DSC_8559.NEF';
const STRIP = '/home/manuel/Downloads/raw010.dng';
const dec = new LibRawDecoder();
async function working(path: string, mode: 'photo' | 'scan') {
  const raw = await decodeAsync(new Uint8Array(readFileSync(path)), { fileName: path, options: mode === 'scan' ? { mode, bin: 'cfa' } : { mode }, raw: dec });
  const lin = linearise(raw, { sha256: 'x', ir: false });
  const s = Math.min(1, 512 / Math.max(lin.width, lin.height));
  const w = Math.round(lin.width * s), h = Math.round(lin.height * s);
  return { rgb: region(lin, { x: 0, y: 0, w: lin.width, h: lin.height }, w, h, { channels: 3 }), w, h, format: raw.meta.format };
}
describe('guessOpenMode on the photographer’s files (skipped when absent)', () => {
  it.skipIf(!existsSync(NEF))('a D750 NEF (daylight) is a photo, surely', async () => {
    const x = await working(NEF, 'photo');
    expect(guessOpenMode(x.rgb, x.w, x.h, { name: NEF, format: x.format })).toMatchObject({ kind: 'photo', confident: true });
  }, 120_000);
  it.skipIf(!existsSync(STRIP))('the 3-frame negative strip (raw010.dng) is a negative, surely, in either decode mode', async () => {
    for (const mode of ['scan', 'photo'] as const) {
      const x = await working(STRIP, mode);
      expect(guessOpenMode(x.rgb, x.w, x.h, { name: STRIP, format: x.format })).toMatchObject({ kind: 'negative', confident: true });
    }
  }, 120_000);
});
