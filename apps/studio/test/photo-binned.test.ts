// CHB-031 WS-B (F22): a camera RAW photo for a small working image (the CPU engine's 640 px) is read binned (2 × 2
// Bayer photosites a pixel, raw camera colour) instead of LibRaw's full-size AHD demosaic: the same working image,
// in less than half the decode time. A synthetic camera DNG (CFA) only.
import { describe, expect, it } from 'vitest';
import { decodeAsync, LibRawDecoder, linearise, region, writeTiff } from '@chromobench/ingest';
import { BINNED_PHOTO_MAX_LONG, decodePhoto } from '../src/host/decode.ts';

const W = 240, H = 160;
/** A camera DNG of a daylight scene (grey ramp, a red patch), RGGB, 2W × 2H photosites. */
function photoDng(orientation?: number): Uint8Array {
  const w = 2 * W, h = 2 * H;
  const raw = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const X = x >> 1, Y = y >> 1;
    const L = 0.03 + 0.5 * (X / W) ** 2 * (1 + 0.2 * Math.sin(X * 0.7 + Y * 0.3));
    const c = X > 30 && X < 70 && Y > 90 && Y < 130 ? [0.35, 0.05, 0.05] : [L, L, L];
    const k = (y & 1) * 2 + (x & 1);
    raw[y * w + x] = 512 + Math.round(Math.min(1, k === 0 ? c[0]! : k === 3 ? c[2]! : c[1]!) * 14000);
  }
  return writeTiff({
    images: [{ width: w, height: h, planes: [raw], bits: 16, photometric: 32803, newSubfileType: 0, rowsPerStrip: 64, tags: [
      { tag: 33421, type: 3, values: [2, 2] }, { tag: 33422, type: 1, values: [0, 1, 1, 2] }, { tag: 50710, type: 1, values: [0, 1, 2] },
      { tag: 50714, type: 3, values: [512] }, { tag: 50717, type: 3, values: [15000] }] }],
    ifd0Tags: [{ tag: 50706, type: 1, values: [1, 4, 0, 0] }, { tag: 271, type: 2, values: 'Synth' }, { tag: 272, type: 2, values: 'Camera' }, { tag: 50708, type: 2, values: 'Synth Camera' },
      { tag: 50721, type: 10, values: [0.8, -0.2, -0.05, -0.4, 1.2, 0.2, -0.05, 0.15, 0.6] }, { tag: 50778, type: 3, values: [21] }, ...(orientation ? [{ tag: 274, type: 3, values: [orientation] }] : [])],
  });
}

const raw = new LibRawDecoder();
const sha = 'b'.repeat(64);

describe('decodePhoto: binned for small working images (CHB-031 F22)', () => {
  it('reads 2 × 2 bins, names the sensor size, and gives the demosaiced working image', async () => {
    const bytes = photoDng();
    const long = 96;
    expect(long).toBeLessThanOrEqual(BINNED_PHOTO_MAX_LONG);
    const d = await decodePhoto(bytes, sha, 'DSC_0001.dng', { long, raw });
    expect(Math.max(d.info.width, d.info.height)).toBe(long);
    expect(d.full).toEqual({ width: 2 * W, height: 2 * H });
    expect(d.notes[0]).toMatch(new RegExp(`^photo: camera RAW \\(Synth Camera\\) via LibRaw, photo mode, ${2 * W}×${2 * H}, read binned ${W}×${H} \\(2 × 2 photosites a pixel\\)`));
    // the demosaiced (AHD) decode, area-averaged to the same working size
    const ahd = await decodeAsync(bytes, { fileName: 'DSC_0001.dng', options: { mode: 'photo' }, raw });
    const lin = linearise(ahd, { sha256: sha, ir: false });
    const ref: Float32Array = region(lin, { x: 0, y: 0, w: lin.width, h: lin.height }, d.info.width, d.info.height, { channels: 3 });
    for (let k = 0; k < 3; k++) {
      let a = 0, b = 0;
      for (let i = k; i < ref.length; i += 3) (a += ref[i]!), (b += d.data[i]!);
      expect(Math.abs(b / a - 1)).toBeLessThan(0.01);
    }
    // pixel by pixel: the same picture (AHD interpolates at the edges of the red patch)
    let sum = 0;
    for (let i = 0; i < ref.length; i++) sum += Math.abs(d.data[i]! - ref[i]!) / Math.max(ref[i]!, 0.02);
    expect(sum / ref.length).toBeLessThan(0.03);
  });

  it('a working size the bins cannot fill, or none (the GPU engine\'s), reads the demosaic', async () => {
    const bytes = photoDng();
    const big = await decodePhoto(bytes, sha, 'DSC_0001.dng', { long: W + 50, raw });
    expect(big.notes[0]).not.toMatch(/binned/);
    expect(Math.max(big.info.width, big.info.height)).toBe(W + 50);
    const full = await decodePhoto(bytes, sha, 'DSC_0001.dng', { long: 0, raw });
    expect(full.notes[0]).not.toMatch(/binned/);
    expect(full.full).toEqual({ width: 2 * W, height: 2 * H });
  });

  it('a portrait (EXIF orientation 6 or 8) is turned upright as the demosaic is (CHB-031 session 04, S04-N1)', async () => {
    for (const tag of [6, 8]) {
      const bytes = photoDng(tag);
      const d = await decodePhoto(bytes, sha, 'DSC_0002.dng', { long: 96, raw });
      expect(d.notes[0]).toMatch(/binned/);
      expect(d.info.height).toBe(96); // portrait: the long side is the height
      expect(d.full).toEqual({ width: 2 * H, height: 2 * W });
      // LibRaw's demosaic of the same file is turned by the tag: the binned working image matches it pixel for pixel
      const ahd = await decodeAsync(bytes, { fileName: 'DSC_0002.dng', options: { mode: 'photo' }, raw });
      expect([ahd.width, ahd.height]).toEqual([2 * H, 2 * W]);
      const lin = linearise(ahd, { sha256: sha, ir: false });
      const ref: Float32Array = region(lin, { x: 0, y: 0, w: lin.width, h: lin.height }, d.info.width, d.info.height, { channels: 3 });
      let sum = 0;
      for (let i = 0; i < ref.length; i++) sum += Math.abs(d.data[i]! - ref[i]!) / Math.max(ref[i]!, 0.02);
      expect(sum / ref.length).toBeLessThan(0.03);
    }
  });
});
