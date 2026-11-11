// Stage 1 acceptance (guide §8, encoders): CRC vectors, bit-exact 16-bit round trips through independent
// decoders (fast-png, utif), PNG and TIFF structure, streaming memory.
import { decode as decodePngFast } from 'fast-png';
import UTIF from 'utif';
import { describe, expect, it } from 'vitest';
import { crc32 } from '../src/encode/crc32.ts';
import { inflateAll } from '../src/encode/deflate.ts';
import { Png16Writer, pngChunk, pngChunks } from '../src/encode/png16.ts';
import { CountingSink, MemorySink } from '../src/encode/sinks.ts';
import { Tiff16Writer, tiffTags } from '../src/encode/tiff16.ts';
import { zip } from '../src/encode/zip.ts';

/** 256 × 256 holding all 65,536 values in every channel (G and B permuted). */
function gradient(): Uint16Array {
  const out = new Uint16Array(256 * 256 * 3);
  for (let v = 0; v < 65536; v++) {
    out[3 * v] = v;
    out[3 * v + 1] = 65535 - v;
    out[3 * v + 2] = (v * 40503) & 0xffff; // odd multiplier: a permutation of 0..65535
  }
  return out;
}

async function png(data: Uint16Array, w: number, h: number, o: Partial<Parameters<typeof Png16Writer.open>[1]> = {}, rowsPerCall = 37): Promise<Uint8Array> {
  const sink = new MemorySink();
  const pw = await Png16Writer.open(sink, { width: w, height: h, ...o });
  for (let y = 0; y < h; y += rowsPerCall) {
    const n = Math.min(rowsPerCall, h - y);
    await pw.writeRows(data.subarray(y * w * 3, (y + n) * w * 3), n);
  }
  await pw.finish();
  await sink.close();
  return sink.bytes();
}

async function tiff(data: Uint16Array, w: number, h: number, compression: 'none' | 'deflate', o: Partial<Parameters<typeof Tiff16Writer.open>[1]> = {}): Promise<Uint8Array> {
  const sink = new MemorySink();
  const tw = await Tiff16Writer.open(sink, { width: w, height: h, compression, rowsPerStrip: 50, ...o });
  for (let y = 0; y < h; y += 29) {
    const n = Math.min(29, h - y);
    await tw.writeRows(data.subarray(y * w * 3, (y + n) * w * 3), n);
  }
  await tw.finish();
  return sink.bytes();
}

const ab = (u8: Uint8Array): ArrayBuffer => u8.slice().buffer;

describe('CRC-32 (textbook §4.1)', () => {
  it('CRC-32 of "123456789" is 0xCBF43926', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
  it('the IEND chunk ends in AE 42 60 82', () => {
    const c = pngChunk('IEND', new Uint8Array(0));
    expect([...c.subarray(8)]).toEqual([0xae, 0x42, 0x60, 0x82]);
  });
  it('broken variant: a bitwise CRC with the wrong polynomial fails the vector', () => {
    let c = 0xffffffff;
    for (const b of new TextEncoder().encode('123456789')) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0x04c11db7 ^ (c >>> 1) : c >>> 1; // non-reflected polynomial
    }
    expect((c ^ 0xffffffff) >>> 0).not.toBe(0xcbf43926);
  });
});

describe('PNG16', () => {
  it('a gradient with all 65,536 values decodes bit-exactly with fast-png', async () => {
    const g = gradient();
    const bytes = await png(g, 256, 256, { colour: { srgbIntent: 0 }, dpi: 300, text: { Software: 'test' }, idatBytes: 4096 });
    const img = decodePngFast(bytes);
    expect([img.width, img.height, img.depth, img.channels]).toEqual([256, 256, 16, 3]);
    expect(img.data).toBeInstanceOf(Uint16Array);
    expect(Buffer.from((img.data as Uint16Array).buffer).equals(Buffer.from(g.buffer))).toBe(true);
  });

  it('samples are big-endian in IDAT (broken variant: little-endian bytes would not round-trip)', async () => {
    const d = new Uint16Array([0x0102, 0x0304, 0x0506]);
    const bytes = await png(d, 1, 1);
    const idat = pngChunks(bytes).filter((c) => c.type === 'IDAT').map((c) => c.data);
    const raw = await inflateAll(Uint8Array.from(idat.flatMap((x) => [...x])));
    expect([...raw]).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect([...raw]).not.toEqual([0, 2, 1, 4, 3, 6, 5]);
  });

  it('structure: IHDR first, colour chunks and pHYs before IDAT, several IDATs, valid CRCs, IEND last', async () => {
    const g = gradient();
    const bytes = await png(g, 256, 256, { colour: { icc: { name: 'Display P3', bytes: new Uint8Array(480).fill(7) }, cicp: [12, 13, 0, 1] }, dpi: 300, idatBytes: 8192 });
    const chunks = pngChunks(bytes);
    const types = chunks.map((c) => c.type);
    expect(types[0]).toBe('IHDR');
    expect(types.at(-1)).toBe('IEND');
    expect(chunks.every((c) => c.crcOk)).toBe(true);
    const firstIdat = types.indexOf('IDAT');
    expect(types.indexOf('cICP')).toBeLessThan(firstIdat);
    expect(types.indexOf('iCCP')).toBeLessThan(firstIdat);
    expect(types.indexOf('pHYs')).toBeLessThan(firstIdat);
    expect(types.filter((t) => t === 'IDAT').length).toBeGreaterThan(3);
    expect(types.includes('sRGB')).toBe(false);
    const phys = chunks.find((c) => c.type === 'pHYs')!.data;
    expect(new DataView(phys.buffer, phys.byteOffset).getUint32(0)).toBe(11811);
    expect([...chunks.find((c) => c.type === 'cICP')!.data]).toEqual([12, 13, 0, 1]);
    // the decompressed iCCP bytes equal the profile
    const iccp = chunks.find((c) => c.type === 'iCCP')!.data;
    const nul = iccp.indexOf(0);
    expect(new TextDecoder('latin1').decode(iccp.subarray(0, nul))).toBe('Display P3');
    expect(iccp[nul + 1]).toBe(0);
    expect([...(await inflateAll(iccp.subarray(nul + 2)))]).toEqual(new Array(480).fill(7));
    expect(decodePngFast(bytes).width).toBe(256);
  });

  it('refuses sRGB and iCCP together', async () => {
    await expect(Png16Writer.open(new MemorySink(), { width: 1, height: 1, colour: { srgbIntent: 0, icc: { name: 'x', bytes: new Uint8Array(4) } } })).rejects.toThrow(/iCCP and sRGB/);
  });

  it('8-bit output dithers from 16 bits and keeps exact 8-bit values (paper white stays 255)', async () => {
    const w = 64, h = 4;
    const d = new Uint16Array(w * h * 3);
    for (let i = 0; i < w * h; i++) { d[3 * i] = 65535; d[3 * i + 1] = 257 * 100; d[3 * i + 2] = 257 * 100 + 128; }
    const img = decodePngFast(await png(d, w, h, { bits: 8 }));
    expect(img.depth).toBe(8);
    const px = img.data as Uint8Array;
    const vals = (k: number) => new Set(Array.from({ length: w * h }, (_, i) => px[3 * i + k]));
    expect([...vals(0)]).toEqual([255]);
    expect([...vals(1)]).toEqual([100]);
    expect([...vals(2)].sort()).toEqual([100, 101]); // half-way values split by the dither
  });
});

describe('TIFF16', () => {
  for (const compression of ['none', 'deflate'] as const) {
    it(`${compression}: all 65,536 values decode bit-exactly with utif`, async () => {
      const g = gradient();
      const bytes = await tiff(g, 256, 256, compression, { icc: new Uint8Array(480).fill(3), dpi: 300 });
      const ifds = UTIF.decode(ab(bytes));
      UTIF.decodeImage(ab(bytes), ifds[0]!);
      const ifd = ifds[0]!;
      expect([ifd.width, ifd.height]).toEqual([256, 256]);
      const got = new Uint16Array(ifd.data.buffer, ifd.data.byteOffset, 256 * 256 * 3);
      expect(Buffer.from(got.buffer, got.byteOffset, got.byteLength).equals(Buffer.from(g.buffer))).toBe(true);
    });
  }

  it('structure: sorted tags, 282/283/296 present, 34675 holds the profile, strips, predictor with deflate', async () => {
    const g = gradient();
    const icc = Uint8Array.from({ length: 480 }, (_, i) => i & 255);
    for (const compression of ['none', 'deflate'] as const) {
      const bytes = await tiff(g, 256, 256, compression, { icc, dpi: 300, description: '{"chromobench":{}}' });
      const tags = tiffTags(bytes);
      const ids = tags.map((t) => t.tag);
      expect([...ids].sort((a, b) => a - b)).toEqual(ids);
      for (const t of [256, 257, 258, 259, 262, 273, 277, 278, 279, 282, 283, 284, 296, 305, 306, 339, 34675]) expect(ids).toContain(t);
      expect(ids.includes(317)).toBe(compression === 'deflate');
      const get = (id: number) => tags.find((t) => t.tag === id)!;
      expect([...get(34675).value]).toEqual([...icc]);
      const xr = new DataView(get(282).value.buffer, get(282).value.byteOffset);
      expect(xr.getUint32(0, true) / xr.getUint32(4, true)).toBe(300);
      expect(get(273).count).toBe(Math.ceil(256 / 50));
      expect(new DataView(bytes.buffer).getUint32(4, true) % 2).toBe(0); // IFD on a word boundary
    }
  });

  it('the deflate writer refuses a sink without writeAt', async () => {
    const s = new CountingSink();
    const noWriteAt = { write: (c: Uint8Array) => s.write(c), close: () => s.close(), abort: () => s.abort(), get size() { return s.size; } };
    await expect(Tiff16Writer.open(noWriteAt, { width: 4, height: 4, compression: 'deflate' })).rejects.toThrow(/writeAt/);
  });
});

describe('zip', () => {
  it('stores entries with their CRC (readable by the local-header layout)', () => {
    const a = new TextEncoder().encode('hello');
    const z = zip([['a.txt', a], ['b.json', new TextEncoder().encode('{}')]]);
    const dv = new DataView(z.buffer);
    expect(dv.getUint32(0, true)).toBe(0x04034b50);
    expect(dv.getUint32(14, true)).toBe(crc32(a));
    expect(dv.getUint32(z.length - 22, true)).toBe(0x06054b50);
    expect(dv.getUint16(z.length - 22 + 10, true)).toBe(2);
  });
});

// Guide §7 stage 1: "a 100 MP synthetic export streams with peak memory below 200 MB". The full
// 100 MP run (≈ 600 MB of samples) takes tens of seconds, so it runs only with CHB_SLOW=1; the default
// run streams 4 MP and checks the same bound.
describe('streaming memory', () => {
  const MP = process.env['CHB_SLOW'] ? 100 : 4;
  for (const fmt of ['png', 'tiff'] as const) {
    it(`${fmt}: ${MP} MP streams through a counting sink with < 200 MB heap+external growth`, async () => {
      const w = 11600, h = Math.round((MP * 1e6) / w);
      const sink = new CountingSink();
      const band = new Uint16Array(w * 64 * 3);
      const mem = () => { const m = process.memoryUsage(); return m.heapUsed + m.external + m.arrayBuffers; };
      globalThis.gc?.();
      const base = mem();
      let peak = 0;
      const writer = fmt === 'png'
        ? await Png16Writer.open(sink, { width: w, height: h })
        : await Tiff16Writer.open(sink, { width: w, height: h, compression: 'deflate', rowsPerStrip: 64 });
      for (let y = 0; y < h; y += 64) {
        const n = Math.min(64, h - y);
        for (let i = 0; i < n * w; i++) { const v = ((y + Math.floor(i / w)) * 5 + (i % w) * 3) & 0xffff; band[3 * i] = v; band[3 * i + 1] = v ^ 0x5555; band[3 * i + 2] = 65535 - v; }
        await writer.writeRows(band, n);
        if ((y / 64) % 16 === 0) peak = Math.max(peak, mem() - base);
      }
      await writer.finish();
      peak = Math.max(peak, mem() - base);
      expect(sink.size).toBeGreaterThan(1000);
      expect(peak).toBeLessThan(200 * 2 ** 20);
      console.log(`${fmt} ${MP} MP: ${(sink.size / 2 ** 20).toFixed(1)} MiB written, peak growth ${(peak / 2 ** 20).toFixed(1)} MiB`);
    }, 600_000);
  }
});
