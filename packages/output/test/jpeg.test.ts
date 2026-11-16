// The streaming JPEG writer (CHB-047, OUT-2): the file's structure (JFIF density, ICC profile in APP2 chunks, comments,
// tables, 4:4:4), a round trip through an independent baseline decoder, band-size independence, the IJG quality scale.
import { describe, expect, it } from 'vitest';
import { fdct8x8, ICC_CHUNK, JpegWriter, quantTable, ZIGZAG } from '../src/encode/jpeg.ts';
import { ditherTo8 } from '../src/encode/quantise.ts';
import { MemorySink } from '../src/encode/sinks.ts';
import { getSpace } from '../src/spaces.ts';
import { decodeJpeg } from './jpeg-decode.ts';

/** A smooth 16-bit picture with a hard edge: gradients in all three channels, a dark block on the right. */
function picture(w: number, h: number): Uint16Array {
  const out = new Uint16Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = 3 * (y * w + x);
    const edge = x > (2 * w) / 3 ? 0.35 : 1;
    out[i] = Math.round(65535 * edge * (0.1 + 0.8 * (x / Math.max(1, w - 1))));
    out[i + 1] = Math.round(65535 * edge * (0.2 + 0.6 * (y / Math.max(1, h - 1))));
    out[i + 2] = Math.round(65535 * edge * (0.5 + 0.3 * Math.sin(x / 5 + y / 7)));
  }
  return out;
}

async function encode(rgb: Uint16Array, w: number, h: number, o: { quality?: number; bands?: number[]; icc?: Uint8Array; comments?: string[]; dpi?: number } = {}): Promise<Uint8Array> {
  const sink = new MemorySink();
  const jw = await JpegWriter.open(sink, { width: w, height: h, ...(o.quality ? { quality: o.quality } : {}), ...(o.icc ? { icc: o.icc } : {}), ...(o.comments ? { comments: o.comments } : {}), ...(o.dpi ? { dpi: o.dpi } : {}) });
  const bands = o.bands ?? [h];
  let y = 0;
  for (let i = 0; y < h; i++) {
    const n = Math.min(bands[i % bands.length]!, h - y);
    await jw.writeRows(rgb.subarray(y * w * 3, (y + n) * w * 3), n);
    y += n;
  }
  await jw.finish();
  await sink.close();
  return sink.bytes();
}

/** Mean and max absolute difference (8-bit levels) of a decoded file to the dithered 8-bit input. */
function error(rgb16: Uint16Array, got: Uint8Array, w: number, h: number): { mean: number; max: number } {
  let sum = 0, max = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) {
    const i = (y * w + x) * 3 + k;
    const d = Math.abs(got[i]! - ditherTo8(rgb16[i]!, x, y, k));
    sum += d;
    max = Math.max(max, d);
  }
  return { mean: sum / (w * h * 3), max };
}

describe('JPEG writer (CHB-047)', () => {
  it('IJG quality scale: 50 is the Annex K table, 100 all ones, 1 clamped to 255', () => {
    const base = [16, 11, 10, 16, 24, 40, 51, 61];
    expect(Array.from(quantTable([...base, ...Array(56).fill(99)], 50).subarray(0, 8))).toEqual(base);
    expect(Array.from(quantTable(Array(64).fill(99), 100))).toEqual(Array(64).fill(1));
    expect(Array.from(quantTable(Array(64).fill(99), 1))).toEqual(Array(64).fill(255));
    expect(quantTable(Array(64).fill(16), 90)[0]).toBe(Math.floor((16 * 20 + 50) / 100));
  });

  it('forward DCT: a flat block has only its DC term (64 × the level with the AAN scale of DC = 8)', () => {
    const d = new Float64Array(64).fill(10);
    fdct8x8(d);
    expect(d[0]).toBeCloseTo(640, 9);
    for (let i = 1; i < 64; i++) expect(Math.abs(d[i]!)).toBeLessThan(1e-9);
    expect(ZIGZAG.length).toBe(64);
    expect(new Set(ZIGZAG).size).toBe(64);
  });

  it('structure: JFIF density in dpi, the ICC profile in chunks reassembles, comments, tables, 4:4:4, EOI', async () => {
    const w = 37, h = 21;
    // a profile longer than two APP2 chunks
    const icc = Uint8Array.from({ length: 2 * ICC_CHUNK + 1234 }, (_, i) => (i * 7 + 3) & 255);
    const b = await encode(picture(w, h), w, h, { quality: 85, icc, comments: ['chromobench', 'ünïcode ✓'], dpi: 300 });
    const d = decodeJpeg(b);
    expect([d.width, d.height]).toEqual([w, h]);
    expect(d.jfif).toEqual({ units: 1, x: 300, y: 300 });
    expect(d.icc && Buffer.from(d.icc).equals(Buffer.from(icc))).toBe(true);
    expect(d.comments).toEqual(['chromobench', 'ünïcode ✓']);
    expect(d.sampling).toEqual([0x11, 0x11, 0x11]);
    expect(d.dqt[0]).toEqual(Array.from(ZIGZAG, (z) => quantTable([16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99], 85)[z]!));
    // the bundled profiles fit in one chunk
    expect(getSpace('prophoto').icc.length).toBeLessThan(ICC_CHUNK);
  });

  it('round trip through an independent decoder: quality 95 within 1.5 levels on average, quality 100 within 1', async () => {
    const w = 61, h = 45;
    const src = picture(w, h);
    const e95 = error(src, decodeJpeg(await encode(src, w, h, { quality: 95 })).rgb, w, h);
    const e100 = error(src, decodeJpeg(await encode(src, w, h, { quality: 100 })).rgb, w, h);
    const e50 = error(src, decodeJpeg(await encode(src, w, h, { quality: 50 })).rgb, w, h);
    expect(e95.mean).toBeLessThan(1.5);
    expect(e100.mean).toBeLessThan(1);
    expect(e100.max).toBeLessThanOrEqual(4);
    expect(e50.mean).toBeGreaterThan(e95.mean);
  });

  it('the file does not depend on how the rows arrive (bands of 1, 3, 8, 13 rows or all at once)', async () => {
    const w = 29, h = 27;
    const src = picture(w, h);
    const ref = await encode(src, w, h, { quality: 90 });
    for (const bands of [[1], [3], [8], [13], [5, 2, 9]]) {
      const b = await encode(src, w, h, { quality: 90, bands });
      expect(Buffer.from(b).equals(Buffer.from(ref))).toBe(true);
    }
  });

  it('a lower quality makes a smaller file; too many rows and too few are refused', async () => {
    const w = 64, h = 48;
    const src = picture(w, h);
    expect((await encode(src, w, h, { quality: 60 })).length).toBeLessThan((await encode(src, w, h, { quality: 95 })).length);
    const jw = await JpegWriter.open(new MemorySink(), { width: w, height: h });
    await expect(jw.writeRows(src, h + 1)).rejects.toThrow(/samples|exceed/);
    await jw.writeRows(src.subarray(0, w * 3 * 10), 10);
    await expect(jw.finish()).rejects.toThrow(/10 of 48 rows/);
    await expect(JpegWriter.open(new MemorySink(), { width: 70000, height: 10 })).rejects.toThrow(/65535/);
  });
});
