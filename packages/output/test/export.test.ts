// Stage 5 acceptance (guide §8, tiled export) and the screen-size regression (bug 4484), with core's
// reference engine: tiles equal one pass, progress is monotonic and ends at the tile count,
// cancellation leaves no file, an edit during an export does not change it.
import { decode as decodePngFast } from 'fast-png';
import UTIF from 'utif';
import { describe, expect, it } from 'vitest';
import { defaultRecipe, Graph, sha256Hex, type ExportSettings, type Node } from '@chromobench/contract';
import { RefEngine } from '@chromobench/core';
import { makeM1Tiff } from '@chromobench/engine-mock';
import { writeTiff16 } from '@chromobench/ingest';
import { toU16 } from '../src/encode/quantise.ts';
import { MemorySink, opfsSink } from '../src/encode/sinks.ts';
import { exportFrame, exportNode, type ExportProgress } from '../src/export/run.ts';
import { memoryDir } from './helpers.ts';

const SETTINGS: ExportSettings = { format: 'png16', space: 'srgb', knee: { method: 'oklch', strength: 6 }, scale: 'full', dpi: 300, compression: 'deflate', signal: 'icc', recipe: 'none' };

/** A frame in the reference engine and its export node (output.display; the reference engine has no output.frame). */
async function setup(tiff = makeM1Tiff(), space: ExportSettings['space'] = 'srgb') {
  const e = new RefEngine();
  const g = new Graph();
  const info = await e.open({ kind: 'file', sha256: sha256Hex(tiff), bytes: tiff });
  g.registerSource(info);
  const r = defaultRecipe('negative-scan', { sha256: info.sha256 });
  r.view.output.export.space = space;
  const frame = exportNode(r, g);
  const display = g.get(frame.inputs[0]!)!;
  e.adopt(g.closure(display.id));
  return { e, g, r, display };
}

async function pixels(e: RefEngine, n: Node, scale: number | 'full' = 'full'): Promise<Uint16Array> {
  const res = await e.evaluate(n, { scale, precision: 'export' });
  return toU16(await res.read(), res.info.channels, res.width, res.height);
}

/** A smooth 16-bit negative: a wide density ramp, so a quarter-size export has many distinct values. */
function smoothTiff(w = 512, h = 256): Uint8Array {
  const u16 = new Uint16Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = 3 * (y * w + x);
    const t = 0.08 + 0.7 * (x / (w - 1));
    u16[i] = Math.round(65535 * t * 0.9);
    u16[i + 1] = Math.round(65535 * t * (0.6 + 0.2 * y / (h - 1)));
    u16[i + 2] = Math.round(65535 * t * 0.45);
  }
  return writeTiff16(w, h, u16);
}

describe('tiled export (stage 5)', () => {
  it('PNG16: 4 × 3 tiles equal one pass bit for bit; progress is monotonic and ends at the tile count', async () => {
    const { e, display } = await setup();
    const sink = new MemorySink();
    const seen: ExportProgress[] = [];
    const f = await exportFrame(e, { node: display, settings: SETTINGS, sink, name: 'm1.png', tile: 24, onProgress: (p) => seen.push(p) });
    expect([f.width, f.height, f.bits, f.mime, f.space]).toEqual([96, 64, 16, 'image/png', 'srgb']);
    expect(f.bytes).toBe(sink.bytes().length);
    const img = decodePngFast(sink.bytes());
    const want = await pixels(e, display);
    expect(Buffer.from((img.data as Uint16Array).buffer).equals(Buffer.from(want.buffer))).toBe(true);
    const tiles = seen.filter((p) => p.phase === 'tiles').map((p) => p.tilesDone);
    expect(tiles).toEqual([...tiles].sort((a, b) => a - b));
    expect(seen.at(-1)).toMatchObject({ phase: 'done', tilesDone: 12, tilesTotal: 12 });
    expect(seen.map((p) => p.phase).filter((p, i, a) => p !== a[i - 1])).toEqual(['plan', 'tiles', 'finalise', 'done']);
  });

  it('TIFF16 with Deflate in ProPhoto: decodes with utif to the one-pass pixels and embeds the profile', async () => {
    const { e, display } = await setup(makeM1Tiff(), 'prophoto');
    const sink = new MemorySink();
    const f = await exportFrame(e, { node: display, settings: { ...SETTINGS, format: 'tiff16', space: 'prophoto' }, sink, name: 'm1.tif', tile: 32 });
    expect(f.iccSha256.length).toBe(64);
    const b = sink.bytes();
    const ifds = UTIF.decode(b.slice().buffer);
    UTIF.decodeImage(b.slice().buffer, ifds[0]!);
    const got = new Uint16Array(ifds[0]!.data.slice().buffer);
    expect(Buffer.from(got.buffer).equals(Buffer.from((await pixels(e, display)).buffer))).toBe(true);
  });

  it('bug 4484 regression: a quarter-size 16-bit export has > 256 distinct values per channel, not all multiples of 257', async () => {
    const { e, display } = await setup(smoothTiff());
    const sink = new MemorySink();
    const f = await exportFrame(e, { node: display, settings: { ...SETTINGS, scale: 0.25 }, sink, name: 'q.png' });
    expect([f.width, f.height]).toEqual([128, 64]);
    const d = decodePngFast(sink.bytes()).data as Uint16Array;
    for (let k = 0; k < 3; k++) expect(new Set(Array.from({ length: 128 * 64 }, (_, i) => d[3 * i + k])).size).toBeGreaterThan(256);
    expect(d.every((v) => v % 257 === 0)).toBe(false);
    // the Studio's way (render 8-bit, multiply by 257) has at most 256 values per channel, all multiples of 257
    const studio = d.map((v) => Math.round(v / 257) * 257);
    expect(new Set(studio).size).toBeLessThanOrEqual(256);
  }, 30_000); // a 512 × 256 frame through the f64 reference chain: ~2 s alone, ~12 s in the full parallel suite

  it('cancellation after tile 3 of 12: rejects with E_CANCELLED, no file remains in OPFS; the next export succeeds', async () => {
    const { e, display } = await setup();
    const dir = memoryDir();
    const ac = new AbortController();
    const sink = await opfsSink('exports/m1.tif', { root: dir, sync: false });
    let last = 0;
    const p = exportFrame(e, { node: display, settings: { ...SETTINGS, format: 'tiff16' }, sink, name: 'm1.tif', tile: 24, signal: ac.signal, onProgress: (q) => { last = q.tilesDone; if (q.tilesDone === 3) ac.abort(); } });
    await expect(p).rejects.toThrow(/E_CANCELLED/);
    expect(last).toBe(3);
    const exportsDir = dir.dirs.get('exports') as ReturnType<typeof memoryDir>;
    expect(exportsDir.files.has('m1.tif')).toBe(false);
    const sink2 = await opfsSink('exports/m1.tif', { root: dir, sync: false });
    const f = await exportFrame(e, { node: display, settings: { ...SETTINGS, format: 'tiff16' }, sink: sink2, name: 'm1.tif', tile: 24 });
    expect(exportsDir.files.get('m1.tif')?.length).toBe(f.bytes);
  });

  it('a failing sink aborts the export with E_SINK naming the phase and tile', async () => {
    const { e, display } = await setup();
    const inner = new MemorySink();
    let writes = 0;
    const sink = { get size() { return inner.size; }, write: async (c: Uint8Array) => { if (++writes > 3) throw new Error('disk full'); await inner.write(c); }, writeAt: (o: number, c: Uint8Array) => inner.writeAt(o, c), close: () => inner.close(), abort: () => inner.abort() };
    await expect(exportFrame(e, { node: display, settings: { ...SETTINGS, format: 'tiff16', compression: 'none' }, sink, name: 'x.tif', tile: 24 })).rejects.toThrow(/export failed in (tiles|finalise)/);
    expect(inner.aborted).toBe(true);
  });

  it('consistency: an edit made during the export (print.lights) does not change the file', async () => {
    const { e, g, r, display } = await setup();
    const ref = new MemorySink();
    await exportFrame(e, { node: display, settings: SETTINGS, sink: ref, name: 'a.png', tile: 24 });
    const sink = new MemorySink();
    await exportFrame(e, {
      node: display, settings: SETTINGS, sink, name: 'a.png', tile: 24,
      onProgress: (p) => {
        if (p.tilesDone !== 2) return;
        // the photographer moves the lights: a new recipe, new nodes; the export keeps its NodeRef
        const r2 = structuredClone(r);
        r2.print.lights.logH = [0.2, -0.1, 0];
        const n2 = exportNode(r2, g);
        e.adopt(g.closure(n2.inputs[0]!));
      },
    });
    const a = decodePngFast(ref.bytes()).data as Uint16Array;
    const b = decodePngFast(sink.bytes()).data as Uint16Array;
    expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(true);
  });

  it('refuses a node that is not display-rgb, and JPEG (needs a canvas encoder)', async () => {
    const { e, g, display } = await setup();
    const xyz = g.get(display.inputs[0]!)!;
    await expect(exportFrame(e, { node: xyz, settings: SETTINGS, sink: new MemorySink(), name: 'x.png' })).rejects.toThrow(/E_DOMAIN/);
    await expect(exportFrame(e, { node: display, settings: { ...SETTINGS, format: 'jpeg' }, sink: new MemorySink(), name: 'x.jpg' })).rejects.toThrow(/E_NOT_IMPLEMENTED/);
  });

  it('recipe sidecar and embedding', async () => {
    const { e, r, display } = await setup();
    const json = JSON.stringify(r);
    const recipe = { json, sha256: sha256Hex(new TextEncoder().encode(json)) };
    const f = await exportFrame(e, { node: display, settings: { ...SETTINGS, recipe: 'sidecar' }, sink: new MemorySink(), name: 'frame_0042.png', recipe });
    expect(f.sidecar?.name).toBe('frame_0042.recipe.json');
    expect(f.recipeSha256).toBe(recipe.sha256);
    const sink = new MemorySink();
    await exportFrame(e, { node: display, settings: { ...SETTINGS, format: 'tiff16', recipe: 'embedded' }, sink, name: 'f.tif', recipe });
    expect(new TextDecoder().decode(sink.bytes())).toContain('"recipeSha256"');
  });
});
