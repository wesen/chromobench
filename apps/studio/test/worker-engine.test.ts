// CHB-027 WS-B (F4): the engine worker's job loop (engine-serve.ts) behind WorkerClient and WorkerEngine, over a
// MessageChannel in Node. Decoding in the worker, the reference engine in the worker giving the same pixels as one
// in this thread, pixels coming back for an engine on this thread, and cancellation between stages.
import { MessageChannel } from 'node:worker_threads';
import { compile, defaultRecipe, Graph, sha256Hex, type FrameRecipe } from '@chromobench/contract';
import { CLASS_CODE, classify, DEFAULT_SIGMA_D, nodePacksData, RefEngine } from '@chromobench/core';
import { makeM1Tiff } from '@chromobench/engine-mock';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeFile } from '../src/host/decode.ts';
import { serveEngine, type EngineScope } from '../src/host/engine-serve.ts';
import { StudioEngine, type HostServices } from '../src/host/studio-engine.ts';
import { WorkerClient, WorkerEngine, type WorkerLike } from '../src/host/worker-engine.ts';

const bytes = makeM1Tiff();
const sha = sha256Hex(bytes);
const noRaw = { name: 'none', decode: () => Promise.reject(new Error('no camera RAW in this test')) };
const ports: { close(): void }[] = [];
afterEach(() => {
  for (const p of ports.splice(0)) p.close();
});

/** A worker in this thread: the job loop on one end of a channel, the client on the other. */
async function start(engine: 'reference' | 'none' = 'reference'): Promise<{ client: WorkerClient; studio: StudioEngine | null }> {
  const { port1, port2 } = new MessageChannel();
  ports.push(port1, port2);
  serveEngine(port1 as unknown as EngineScope, { raw: noRaw });
  port1.start();
  port2.start();
  const client = new WorkerClient(port2 as unknown as WorkerLike);
  const init = await client.init({ engine, librawWasmUrl: 'unused' });
  if (engine === 'none') return { client, studio: null };
  const we = new WorkerEngine(client, init.caps!);
  const host: HostServices = {
    decode: (b, s, name, mode) => client.decode(b, s, name, mode ?? 'scan', { long: 0, dust: false, keep: 'register' }),
    register: (_e, info, px) => {
      expect(px).toBeUndefined(); // the pixels stayed in the worker
      we.register(info.sha256);
    },
    forget: (_e, s) => we.forgetSource(s),
    classify: (D, sigma, res) => CLASS_CODE[classify(D, sigma, res).cls],
    defaultSigma: DEFAULT_SIGMA_D,
  };
  return { client, studio: new StudioEngine(we, host, 'worker') };
}

/** The display chain below output.frame (a host op). */
function chain(r: FrameRecipe, g: Graph) {
  let top = compile(r, g);
  if (top.op === 'output.frame') top = g.get(top.inputs[0]!)!;
  return top;
}

describe('engine worker (CHB-027)', () => {
  it('decodes and conditions in the worker; the reference engine there gives this thread\'s pixels', async () => {
    const { studio } = await start();
    const info = await studio!.open({ kind: 'file', sha256: sha, name: 'm1.tif', bytes });
    expect(studio!.notes.get(sha)?.notes.join(' ')).toMatch(/TIFF/);
    expect(studio!.notes.get(sha)?.data).toBeUndefined(); // the pixels stay in the worker
    // the same decode in this thread, on a RefEngine here
    const local = await decodeFile(bytes, sha, 'm1.tif', 'scan', { long: 0, dust: false, roll: new Map(), raw: noRaw });
    expect(local.info).toEqual(info);
    const ref = new RefEngine({ data: nodePacksData(), sampled: true });
    ref.openDecoded(local.info, local.data);
    const g = new Graph();
    g.registerSource(info);
    const r0 = defaultRecipe('negative-scan', { sha256: sha, name: 'm1' });
    const r = withMeasured(r0, studio!.notes.get(sha)!);
    const n = chain(r, g);
    studio!.adopt(g.closure(n.id));
    ref.adopt(g.closure(n.id));
    for (const t of [{ scale: 'full' as const, precision: 'preview' as const }, { scale: 0.5, precision: 'preview' as const, region: { x: 4, y: 2, w: 40, h: 30 } }]) {
      const [a, b] = [await studio!.evaluate(n, t), await ref.evaluate(n, t)];
      expect([a.width, a.height, a.format]).toEqual([b.width, b.height, b.format]);
      expect(Array.from(await a.read())).toEqual(Array.from(await b.read()));
    }
    const stats = g.intern('measure.stats', [n.id], {}).node;
    studio!.adopt(g.closure(stats.id));
    ref.adopt(g.closure(stats.id));
    expect((await studio!.measure(stats)).value).toEqual((await ref.measure(stats)).value);
  });

  it('a cancelled evaluation rejects with E_CANCELLED in the worker; the next one completes', async () => {
    const { studio } = await start();
    await studio!.open({ kind: 'file', sha256: sha, name: 'm1.tif', bytes });
    const g = new Graph();
    g.registerSource(studio!.graph.source(sha)!);
    const n = chain(defaultRecipe('negative-scan', { sha256: sha, name: 'm1' }), g);
    studio!.adopt(g.closure(n.id));
    const ctl = new AbortController();
    const p = studio!.evaluate(n, { scale: 'full', precision: 'preview', signal: ctl.signal });
    ctl.abort();
    await expect(p).rejects.toMatchObject({ diag: { code: 'E_CANCELLED' } });
    const r = await studio!.evaluate(n, { scale: 'full', precision: 'preview' });
    expect(r.width).toBe(studio!.graph.source(sha)!.width);
  });

  it('re-open as a photo (WS-A openAs): the worker forgets the negative decode and registers the photo one', async () => {
    const { studio } = await start();
    const a = await studio!.openAs({ kind: 'file', sha256: sha, name: 'm1.tif', bytes }, 'negative');
    expect(a.kind).toBe('negative-scan');
    const b = await studio!.openAs({ kind: 'file', sha256: sha, name: 'm1.tif', bytes }, 'photo');
    expect(b.kind).toBe('digital-raw');
    expect(studio!.notes.get(sha)?.notes.join(' ')).toMatch(/^photo:/);
    const g = new Graph();
    g.registerSource(b.info);
    const src = g.intern('source.open', [], { source: sha }).node;
    studio!.adopt(g.closure(src.id));
    const r = await studio!.evaluate(src, { scale: 'full', precision: 'preview' });
    // the photo decode's pixels, as decoded in this thread
    const local = await decodeFile(bytes, sha, 'm1.tif', 'photo', { long: 0, dust: false, roll: new Map(), raw: noRaw });
    expect(Array.from(await r.read())).toEqual(Array.from(local.data, (v) => v));
  });

  it('decode-only (the GPU engine on the main thread): the working image comes back, resampled', async () => {
    const { client } = await start('none');
    const d = await client.decode(bytes, sha, 'm1.tif', 'scan', { long: 48, dust: false, keep: 'return' });
    expect(Math.max(d.info.width, d.info.height)).toBe(48);
    expect(d.data!.length).toBe(d.info.width * d.info.height * 3);
    expect(d.notes.join(' ')).toMatch(/working image/);
  });
});

function withMeasured(r: FrameRecipe, m: { rebate?: unknown; flare?: unknown; baseT?: unknown }): FrameRecipe {
  const scan = { ...r.scan! };
  if (m.rebate) scan.rebate = m.rebate as never;
  if (m.flare) scan.flare = m.flare as never;
  if (m.baseT) scan.baseT = m.baseT as never;
  return { ...r, scan };
}
