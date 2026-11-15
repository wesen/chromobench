// CHB-034 fusz: the first print meters a fixed analysis image, so its Time does not depend on the engine's working
// size. The GPU engine (4000 px) and the CPU engine (640 px) proposed 5.612 s and 6.3 s for the same NEF: the mean of
// the paper exposure through a nonlinear chain depends on the resolution of the image it is taken over. The decode
// now also makes the analysis image (the file at the analysis size, as a decode at that size makes its working image)
// when the working size differs; the first print meters it. Synthetic files only.
import { MessageChannel } from 'node:worker_threads';
import { Graph, newDocument, sha256Hex, type Box, type Document, type Vec3 } from '@chromobench/contract';
import { lightsOf, mainExposure } from '@chromobench/studio-kit';
import { CLASS_CODE, classify, DEFAULT_SIGMA_D, integrateToGrey, Lights, nodePacksData, RefEngine } from '@chromobench/core';
import { makeM1Tiff } from '@chromobench/engine-mock';
import { plantedFrames, writeTiff16, type RawDecoder } from '@chromobench/ingest';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeFile, decodeScan } from '../src/host/decode.ts';
import { serveEngine, type EngineScope } from '../src/host/engine-serve.ts';
import { firstPrint, onAnalysis, photoDocument } from '../src/host/first-print.ts';
import { ANALYSIS_LONG, analysisSha, StudioEngine, type AnalysisImage, type HostServices } from '../src/host/studio-engine.ts';
import { WorkerClient, WorkerEngine, type WorkerLike } from '../src/host/worker-engine.ts';

const noRaw: RawDecoder = { name: 'none', decode: () => Promise.reject(new Error('no camera RAW in this test')) };
const integrate = (latd: Vec3, alpha: number): Vec3 => [...integrateToGrey(latd, { latd: [0, 0, 0], lights: Lights.zero() }, alpha).logH] as Vec3;
const total = (d: Document): number => {
  const l = lightsOf(d);
  return Math.log10(mainExposure(d).time_s) + (l[0] + l[1] + l[2]) / 3;
};
const cropOf = (d: Document): Box | null => d.geometry.crop;
const scanOf = (d: Document) => d.stages.scan!.medium as { rebate: Box | null; openGate: unknown; umPerPx: number };

/** A photo with fine detail (a 2 px checker over a gradient), so the metered exposure depends on the resolution. */
function detailedTiff(w = 240, h = 160): Uint8Array {
  const codes = new Uint16Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const base = 0.03 + 0.25 * (x / w);
      const v = ((x >> 1) + (y >> 1)) % 2 ? base * 3 : base / 3;
      for (let k = 0; k < 3; k++) codes[(y * w + x) * 3 + k] = Math.round(65535 * Math.min(1, v * [1.1, 1, 0.8][k]!));
    }
  }
  return writeTiff16(w, h, codes);
}

function stripTiff(): Uint8Array {
  const p = plantedFrames({ frames: 3, pxPerMm: 8 });
  const codes = new Uint16Array(p.rgb.length);
  for (let i = 0; i < p.rgb.length; i++) codes[i] = Math.round(65535 * Math.min(1, Math.max(0, p.rgb[i]!)));
  return writeTiff16(p.w, p.h, codes);
}

const opts = (long: number, analysisLong?: number) => ({ long, dust: false, roll: new Map(), raw: noRaw, ...(analysisLong ? { analysisLong } : {}) });

describe('the analysis image (decode.ts)', () => {
  it('is the file at the analysis size, as a decode at that size makes its working image; none when the sizes agree', async () => {
    const bytes = detailedTiff();
    const sha = sha256Hex(bytes);
    for (const mode of ['photo', 'scan'] as const) {
      const big = await decodeFile(bytes.slice(), sha, 'p.tif', mode, opts(0, 60));
      const small = await decodeFile(bytes.slice(), sha, 'p.tif', mode, opts(60));
      expect(big.info.width, mode).toBe(240);
      expect(big.analysis!.info.sha256).toBe(analysisSha(sha));
      expect([big.analysis!.info.width, big.analysis!.info.height]).toEqual([small.info.width, small.info.height]);
      expect(Array.from(big.analysis!.data!)).toEqual(Array.from(small.data));
      // the CPU engine's case: the working image is the analysis image; a file smaller than the analysis size: none
      expect((await decodeFile(bytes.slice(), sha, 'p.tif', mode, opts(60, 60))).analysis).toBeUndefined();
      expect((await decodeFile(bytes.slice(), sha, 'p.tif', mode, opts(0, 640))).analysis).toBeUndefined();
    }
    expect(analysisSha(sha)).toMatch(/^[0-9a-f]{64}$/);
    expect(analysisSha(sha)).not.toBe(sha);
  });

  it('a strip: the analysis image is the strip decoded at the analysis size (sized for its frames, F20), on a copy of the roll', async () => {
    const bytes = stripTiff();
    const sha = 'f'.repeat(64);
    const roll = new Map();
    const big = await decodeScan(bytes.slice(), sha, 'strip.tif', { ...opts(512, 128), roll });
    const small = await decodeScan(bytes.slice(), sha, 'strip.tif', opts(128));
    expect(big.frames).toHaveLength(3);
    const a = big.analysis!;
    expect([a.info.width, a.info.height]).toEqual([small.info.width, small.info.height]);
    expect(Array.from(a.data!)).toEqual(Array.from(small.data));
    // its frames are ≈ 128 px, as the decode at 128 px makes them (not the big decode's frames scaled)
    expect(Math.max(...small.frames!.map((b) => Math.max(b.w, b.h)))).toBeGreaterThan(128 * 0.9);
    expect([...roll.keys()]).toEqual([sha]);
  });

});

describe('the first print meters the analysis image (first-print.ts)', () => {
  it('a large working image with its analysis image proposes what the analysis-size working image proposes; without it, not', async () => {
    const bytes = detailedTiff();
    const sha = sha256Hex(bytes);
    const big = await decodeFile(bytes.slice(), sha, 'p.tif', 'photo', opts(0, 60));
    const small = await decodeFile(bytes.slice(), sha, 'p.tif', 'photo', opts(60));
    const print = async (d: typeof big, analysis: AnalysisImage | null): Promise<Document> => {
      const e = new RefEngine({ data: nodePacksData(), mode: 'tabulated', sampled: true });
      e.openDecoded(d.info, d.data);
      if (d.analysis) e.openDecoded(d.analysis.info, d.analysis.data!);
      const g = new Graph();
      g.registerSource(d.info);
      const r0 = photoDocument(newDocument('digital-raw', { sha256: sha, name: 'p' }), false);
      return firstPrint(e, g, r0, { integrate, analysis });
    };
    const a = big.analysis!.info;
    const metered = await print(big, { info: a, kx: a.width / big.info.width, ky: a.height / big.info.height });
    const reference = await print(small, null);
    const own = await print(big, null);
    expect(mainExposure(metered).time_s).toBe(mainExposure(reference).time_s);
    expect(lightsOf(metered)).toEqual(lightsOf(reference));
    // the document stays on its own source; only the measurement moved
    expect(metered.source.sha256).toBe(sha);
    // the resolution matters for this picture: metered on the 240 px image the total is elsewhere
    expect(Math.abs(total(own) - total(reference))).toBeGreaterThan(0.005);
  });

  it('onAnalysis moves the source, the film pitch and the boxes a first print has (crop, rebate, open gate) onto the analysis image', () => {
    const r0 = newDocument('negative-scan', { sha256: 'a'.repeat(64), name: 'n', width: 400, height: 240 });
    const s0 = r0.stages.scan!;
    const r: Document = {
      ...r0,
      geometry: { ...r0.geometry, crop: { x: 100, y: 40, w: 300, h: 200 } },
      stages: { ...r0.stages, scan: { ...s0, medium: { ...(s0.medium as object), rebate: { x: 8, y: 4, w: 40, h: 20 }, openGate: 'flat' } as never } },
    };
    const info = { sha256: 'b'.repeat(64), width: 100, height: 60 } as AnalysisImage['info'];
    const m = onAnalysis(r, { info, kx: 0.25, ky: 0.25 });
    expect(m.source.sha256).toBe('b'.repeat(64));
    expect(cropOf(m)).toEqual({ x: 25, y: 10, w: 75, h: 50 });
    expect(scanOf(m).rebate).toEqual({ x: 2, y: 1, w: 10, h: 5 });
    expect(scanOf(m).openGate).toBe('flat');
    // a pixel of the analysis image covers four times the film
    expect(scanOf(m).umPerPx).toBeCloseTo(scanOf(r).umPerPx * 4, 9);
    expect(cropOf(r)).toEqual({ x: 100, y: 40, w: 300, h: 200 }); // not mutated
    // a strip frame: its frame as the decode at the analysis size found it; a crop that is no frame: scaled
    const frames = { working: [{ x: 0, y: 0, w: 90, h: 60 }, { x: 100, y: 40, w: 300, h: 200 }], analysis: [{ x: 0, y: 0, w: 23, h: 15 }, { x: 24, y: 9, w: 77, h: 51 }] };
    expect(cropOf(onAnalysis(r, { info, kx: 0.25, ky: 0.25, frames }))).toEqual({ x: 24, y: 9, w: 77, h: 51 });
    const moved: Document = { ...r, geometry: { ...r.geometry, crop: { x: 104, y: 40, w: 300, h: 200 } } };
    expect(cropOf(onAnalysis(moved, { info, kx: 0.25, ky: 0.25, frames }))).toEqual({ x: 26, y: 10, w: 75, h: 50 });
  });
});

describe('the analysis image through the engine worker and StudioEngine', () => {
  const ports: { close(): void }[] = [];
  afterEach(() => {
    for (const p of ports.splice(0)) p.close();
  });
  async function worker(engine: 'reference' | 'none'): Promise<WorkerClient> {
    const { port1, port2 } = new MessageChannel();
    ports.push(port1, port2);
    serveEngine(port1 as unknown as EngineScope, { raw: noRaw });
    port1.start();
    port2.start();
    const client = new WorkerClient(port2 as unknown as WorkerLike);
    await client.init({ engine, librawWasmUrl: 'unused' });
    return client;
  }

  it('decode-only (the GPU engine): the analysis image comes back with the working image', async () => {
    const client = await worker('none');
    const bytes = detailedTiff();
    const d = await client.decode(bytes, sha256Hex(bytes), 'p.tif', 'photo', { long: 200, dust: false, keep: 'return', analysisLong: 50 });
    expect(d.info.width).toBe(200);
    expect(d.analysis!.info.width).toBe(50);
    expect(d.analysis!.data!.length).toBe(50 * d.analysis!.info.height * 3);
  });

  it('the reference engine in the worker registers the analysis image with the source; StudioEngine knows its scale and forgets it', async () => {
    const client = await worker('reference');
    const caps = (await client.init({ engine: 'reference', librawWasmUrl: 'unused' })).caps!;
    const we = new WorkerEngine(client, caps);
    const forgotten: string[] = [];
    const host: HostServices = {
      decode: (b, s, name, mode) => client.decode(b, s, name, mode, { long: 200, dust: false, keep: 'register', analysisLong: 50 }),
      register: (_e, info, px) => {
        expect(px).toBeUndefined();
        we.register(info.sha256);
      },
      forget: (_e, s) => {
        forgotten.push(s);
        we.forgetSource(s);
      },
      classify: (D, sigma, res) => CLASS_CODE[classify(D, sigma, res).cls],
      defaultSigma: DEFAULT_SIGMA_D,
    };
    const studio = new StudioEngine(we, host, 'worker');
    const bytes = detailedTiff();
    const sha = sha256Hex(bytes);
    await studio.openAs({ kind: 'file', sha256: sha, name: 'p.tif', bytes }, 'photo');
    const a = studio.analysisOf(sha)!;
    expect(a.info.sha256).toBe(analysisSha(sha));
    expect([a.kx, a.ky]).toEqual([50 / 200, a.info.height / studio.graph.source(sha)!.height]);
    expect(studio.notes.get(sha)!.analysis!.data).toBeUndefined();
    // the first print meters it in the worker: the analysis source is open there
    const r0 = photoDocument(newDocument('digital-raw', { sha256: sha, name: 'p' }), false);
    const g = new Graph();
    g.registerSource(studio.graph.source(sha)!);
    const r = await firstPrint(studio, g, r0, { integrate, analysis: a });
    expect(mainExposure(r).time_s).toBeGreaterThan(0);
    // re-open as a negative: both sources are forgotten
    await studio.openAs({ kind: 'file', sha256: sha, name: 'p.tif', bytes }, 'negative');
    expect(forgotten).toEqual([sha, analysisSha(sha)]);
    expect(ANALYSIS_LONG).toBe(640);
  });
});
