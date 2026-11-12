// CHB-027 WS-D (F16): the frames on a scan of a strip of film, on planted strips (truth known), on the
// single-frame planted strip of CHB-020 (one frame, not split), and on the photographer's scans (skipped when absent).
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Box } from '@chromobench/contract';
import { conditionScan, decodeAsync, LibRawDecoder, linearise, plantedFrames, plantedStrip, region, stripFrames, type PlantedFramesOptions } from '@chromobench/ingest';

/** Intersection over union of two boxes. */
const iou = (a: Box, b: Box): number => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return (ix * iy) / (a.w * a.h + b.w * b.h - ix * iy);
};

function check(o: PlantedFramesOptions, minIou = 0.9): void {
  const p = plantedFrames(o);
  const r = stripFrames(p.rgb, p.w, p.h);
  if (p.truth.frames.length === 1) {
    // a single frame is not split (its box is not used: the scan opens whole, as before)
    expect(r.split).toBe(false);
    expect(r.frames.length).toBeLessThanOrEqual(1);
    return;
  }
  expect(r.split).toBe(true);
  expect(r.axis).toBe(o.axis ?? 'y');
  expect(r.frames.map((f) => f.box)).toHaveLength(p.truth.frames.length);
  r.frames.forEach((f, i) => {
    expect(iou(f.box, p.truth.frames[i]!), `frame ${i + 1}: ${JSON.stringify(f.box)} vs ${JSON.stringify(p.truth.frames[i])}`).toBeGreaterThan(minIou);
  });
  expect(r.confidence).toBeGreaterThan(0.5);
}

describe('stripFrames on planted strips', () => {
  for (const film of ['120', '135'] as const) {
    for (const axis of ['y', 'x'] as const) {
      for (const frames of [1, 2, 3, 6]) {
        it(`${frames} frame(s) of ${film}, ${axis === 'y' ? 'vertical' : 'horizontal'}`, () => check({ film, axis, frames }));
      }
    }
  }
  it('uneven exposure: a dense frame and a thin one', () => check({ frames: 4, exposureD: [0.6, 0, -0.1, 0.3] }));
  it('a dark frame nearly at base is one frame, not split, not lost', () => check({ frames: 3, dark: [1] }));
  it('a dark frame with a band at base right across its middle is not split', () => check({ frames: 3, dark: [1], darkBand: 0.2 }));
  it('a dark first frame of a 135 strip', () => check({ film: '135', frames: 4, dark: [0], darkBand: 0.15 }));
  it('no holder, no leader', () => check({ frames: 3, holder: false, leaderMm: 0 }, 0.85));
  it('the noisy scan', () => check({ frames: 3, sigma: 0.02 }));
  it('the single 135 frame with slivers of its neighbours (CHB-020 planted strip) is one frame', () => {
    const p = plantedStrip();
    const r = stripFrames(p.rgb, p.w, p.h);
    expect(r.frames.length).toBeLessThanOrEqual(1);
    if (r.frames[0]) expect(iou(r.frames[0].box, p.truth.crop)).toBeGreaterThan(0.8);
  });
  it('a flat grey picture (no film) has no frames to split', () => {
    const w = 120, h = 300;
    const rgb = new Float32Array(w * h * 3).fill(0.3);
    expect(stripFrames(rgb, w, h).split).toBe(false);
  });
  it('boxes are in input pixels at any working size', () => {
    const p = plantedFrames({ frames: 3, pxPerMm: 8 });
    const r = stripFrames(p.rgb, p.w, p.h, { long: 256 });
    expect(r.frames).toHaveLength(3);
    r.frames.forEach((f, i) => expect(iou(f.box, p.truth.frames[i]!)).toBeGreaterThan(0.9));
  });
});

// The photographer's scans (CHB-026, private: read here when present, never copied). Epson V600 via VueScan,
// linear 16-bit DNG; the Negative Lab Pro conversions beside them are one frame each, about 1.40 : 1.
const SCANS = '/home/manuel/code/wesen/chromobench/.playwright-mcp/scans';
const CASES: [string, number][] = [
  ['/home/manuel/Downloads/raw010.dng', 3],
  [`${SCANS}/2025-08-09_raw000.dng`, 3],
  [`${SCANS}/2025-08-09_raw004.dng`, 3],
  [`${SCANS}/2025-08-09_raw013.dng`, 3],
  [`${SCANS}/2025-08-09_raw007.dng`, 2],
  // single medium-format frames, black-and-white (one frame or none: not a strip)
  [`${SCANS}/2025-10-07_roll-102_raw000.dng`, 0],
  [`${SCANS}/2025-10-07_roll-102_raw001.dng`, 0],
  [`${SCANS}/2024-12-07_raw0001.dng`, 0],
  // an 8-bit greyscale scan: must not throw
  [`${SCANS}/2024-10-05_2024-10-05-0001.tif`, 0],
];
const dec = new LibRawDecoder();
describe('stripFrames on the photographer’s scans (skipped when absent)', () => {
  for (const [path, want] of CASES) {
    it.skipIf(!existsSync(path))(`${basename(path)}: ${want > 1 ? `${want} frames` : 'not a strip'}`, async () => {
      const raw = await decodeAsync(new Uint8Array(readFileSync(path)), { fileName: path, options: { mode: 'scan', bin: 'cfa' }, raw: dec });
      const lin = linearise(raw, { sha256: 'x', ir: false });
      const s = Math.min(1, 1024 / Math.max(lin.width, lin.height));
      const w = Math.round(lin.width * s), h = Math.round(lin.height * s);
      const rgb = region(lin, { x: 0, y: 0, w: lin.width, h: lin.height }, w, h, { channels: 3 });
      const r = stripFrames(rgb, w, h, { layout: conditionScan(rgb, w, h, { subtract: false }).layout });
      if (want > 1) {
        expect(r.split).toBe(true);
        expect(r.frames).toHaveLength(want);
        expect(r.confidence).toBeGreaterThan(0.5);
        // each a 645 frame, as Negative Lab Pro cut them (≈ 1.40 : 1), across the strip
        for (const f of r.frames) expect(f.box.w / f.box.h).toBeGreaterThan(1.3), expect(f.box.w / f.box.h).toBeLessThan(1.55);
      } else expect(r.split).toBe(false);
    }, 120_000);
  }
});
