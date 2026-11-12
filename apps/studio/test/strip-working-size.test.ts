// CHB-031 WS-B (F20, F10): a strip's working image is sized for its frames, so each frame of a strip gets about the
// working size a single picture gets (the reference engine's 512 px over a three-frame strip left ≈ 170–220 px a
// frame: blocky), and a strip's base is read on the gaps between its frames when the film edge found lies on a frame
// (raw010's thin first frame). Synthetic strips only (ingest's plantedFrames).
import { describe, expect, it } from 'vitest';
import { plantedFrames, writeTiff16, type RawDecoder } from '@chromobench/ingest';
import { decodeScan, gapBase, scaleBox, stripScale } from '../src/host/decode.ts';

const noRaw: RawDecoder = { name: 'none', decode: () => Promise.reject(new Error('no camera RAW here')) };

function stripTiff(o: { frames?: number; pxPerMm?: number; film?: '135' | '120'; dark?: number[] } = {}): Uint8Array {
  const p = plantedFrames({ frames: o.frames ?? 3, pxPerMm: o.pxPerMm ?? 8, ...(o.film === '135' ? { film: '135' as const } : {}), ...(o.dark ? { dark: o.dark } : {}) });
  const codes = new Uint16Array(p.rgb.length);
  for (let i = 0; i < p.rgb.length; i++) codes[i] = Math.round(65535 * Math.min(1, Math.max(0, p.rgb[i]!)));
  return writeTiff16(p.w, p.h, codes);
}

describe('stripScale', () => {
  it('sizes a strip so its largest frame gets ≈ long px, capped at 4 × long and the file size', () => {
    // raw010: 1672 × 3695 at 512 px is 232 × 512, its frames ≈ 220 × 150
    const s = 512 / 3695;
    const boxes = [0, 1, 2].map((i) => ({ x: 6, y: 10 + i * 165, w: 220, h: 150 }));
    const s2 = stripScale(s, boxes, 512, 1672, 3695);
    expect(220 * (s2 / s)).toBeCloseTo(512, 0);
    expect(Math.round(3695 * s2)).toBeLessThanOrEqual(4 * 512);
    // a file at its own size already (the GPU's 4000 px), no long side, no boxes: unchanged
    expect(stripScale(1, boxes, 4000, 1672, 3695)).toBe(1);
    expect(stripScale(s, boxes, 0, 1672, 3695)).toBe(s);
    expect(stripScale(s, [], 512, 1672, 3695)).toBe(s);
    // six small frames: the cap, 4 × long for the strip
    const tiny = [0, 1, 2, 3, 4, 5].map((i) => ({ x: 4, y: i * 80, w: 70, h: 50 }));
    expect(Math.round(3695 * stripScale(s, tiny, 512, 1672, 3695))).toBe(2048);
    // never above the file's own size
    expect(stripScale(0.5, [{ x: 0, y: 0, w: 100, h: 60 }], 512, 400, 1000)).toBe(1);
  });

  it('scaleBox keeps a box inside its old edges', () => {
    expect(scaleBox({ x: 3, y: 5, w: 10, h: 7 }, 2.3, 2.3)).toEqual({ x: 7, y: 12, w: 22, h: 15 });
    const b = scaleBox({ x: 1, y: 1, w: 99, h: 49 }, 1.5, 1.5);
    expect(b.x + b.w).toBeLessThanOrEqual(150);
    expect(b.y + b.h).toBeLessThanOrEqual(75);
  });
});

describe('decodeScan of a strip', () => {
  it('a 3-frame strip decoded at 256 px gives each frame ≈ 256 px, not a third of it; the boxes and rebate fit the image', async () => {
    const bytes = stripTiff();
    const d = await decodeScan(bytes, 'f'.repeat(64), 'strip.tif', { long: 256, dust: false, roll: new Map(), raw: noRaw });
    expect(d.frames).toHaveLength(3);
    const long = Math.max(...d.frames!.map((b) => Math.max(b.w, b.h)));
    expect(long).toBeGreaterThan(256 * 0.9);
    expect(long).toBeLessThanOrEqual(256);
    expect(Math.max(d.info.width, d.info.height)).toBeGreaterThan(256 * 2);
    expect(d.data.length).toBe(d.info.width * d.info.height * 3);
    for (const b of [...d.frames!, ...(d.rebate ? [d.rebate] : [])]) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(d.info.width);
      expect(b.y + b.h).toBeLessThanOrEqual(d.info.height);
    }
    expect(d.notes.some((n) => /strip working image/.test(n))).toBe(true);
    // the same strip at its own size (the GPU engine's long side): untouched
    const full = await decodeScan(bytes, 'e'.repeat(64), 'strip.tif', { long: 4000, dust: false, roll: new Map(), raw: noRaw });
    expect(full.notes.some((n) => /strip working image/.test(n))).toBe(false);
    expect(full.frames).toHaveLength(3);
  });
});

const D = (T: readonly number[], ref: readonly number[]): number => Math.max(...T.map((t, k) => Math.abs(Math.log10(t / ref[k]!))));

describe('a strip\'s base (CHB-031 F20: frame 1 hazy)', () => {
  it('gapBase reads the unexposed film between frames: the planted base, veil included', () => {
    for (const axis of ['y', 'x'] as const) {
      const p = plantedFrames({ frames: 3, pxPerMm: 3, axis, dark: [0] });
      const boxes = p.truth.frames;
      const g = gapBase(p.rgb, p.w, boxes, axis)!;
      expect(g.pixels).toBeGreaterThan(100);
      expect(D(g.Traw.map((t, k) => t - p.truth.veil[k]!), p.truth.baseT)).toBeLessThan(0.01);
      // the box is a gap: on no frame
      for (const b of boxes) expect(Math.max(0, Math.min(b.x + b.w, g.box.x + g.box.w) - Math.max(b.x, g.box.x)) * Math.max(0, Math.min(b.y + b.h, g.box.y + g.box.h) - Math.max(b.y, g.box.y))).toBe(0);
    }
    expect(gapBase(new Float32Array(30), 5, [{ x: 0, y: 0, w: 5, h: 2 }, { x: 0, y: 3, w: 5, h: 2 }], 'y')).toBeNull();
  });

  it('an underexposed first frame: the film edge found lies on it, so the base comes from the gaps (as the planted base)', async () => {
    const p = plantedFrames({ frames: 3, pxPerMm: 3, dark: [0] });
    const bytes = stripTiff({ pxPerMm: 3, dark: [0] });
    const roll = new Map();
    const d = await decodeScan(bytes, 'd'.repeat(64), 'strip.tif', { long: 4000, dust: false, roll, raw: noRaw });
    expect(d.frames).toHaveLength(3);
    // the base as scanned (scan.baseT): the planted base within 0.01 D; the film edge on frame 1 read 0.09 D denser
    expect(D(d.baseT!, p.truth.baseT)).toBeLessThan(0.01);
    expect(d.notes.some((n) => /from the gaps between frames .*: the film edge found lay on a frame/.test(n))).toBe(true);
    // scan.rebate is a gap now, on no frame; the roll's base for this file too
    const r = d.rebate!;
    for (const b of d.frames!) expect(r.y + r.h <= b.y || r.y >= b.y + b.h || r.x + r.w <= b.x || r.x >= b.x + b.w).toBe(true);
    expect(D(roll.get('d'.repeat(64)).T, p.truth.baseT)).toBeLessThan(0.01);
    // a strip whose film edge is film: its base as before (the edge)
    const ok = await decodeScan(stripTiff({ pxPerMm: 3 }), 'c'.repeat(64), 'strip.tif', { long: 4000, dust: false, roll: new Map(), raw: noRaw });
    expect(ok.notes.some((n) => /from the gaps between frames/.test(n))).toBe(false);
    expect(D(ok.baseT!, p.truth.baseT)).toBeLessThan(0.01);
  });
});
