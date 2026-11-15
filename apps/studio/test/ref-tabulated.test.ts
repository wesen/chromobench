// CHB-031 WS-B (F10): the reference engine as the studio runs it by default, previews through core's tables and the
// export precision exact (engine-serve.ts TabulatedPreviews), directly and behind the engine worker.
import { MessageChannel } from 'node:worker_threads';
import { compile, Graph, newDocument, sha256Hex, type Node } from '@chromobench/contract';
import { withMeasured } from '../src/host/first-print.ts';
import { nodePacksData, RefEngine } from '@chromobench/core';
import { makeM1Tiff } from '@chromobench/engine-mock';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeFile } from '../src/host/decode.ts';
import { referenceEngine, serveEngine, TabulatedPreviews, type EngineScope } from '../src/host/engine-serve.ts';
import { WorkerClient, WorkerEngine, type WorkerLike } from '../src/host/worker-engine.ts';

const data = nodePacksData();
const bytes = makeM1Tiff();
const sha = sha256Hex(bytes);
const noRaw = { name: 'none', decode: () => Promise.reject(new Error('no camera RAW in this test')) };
const ports: { close(): void }[] = [];
afterEach(() => {
  for (const p of ports.splice(0)) p.close();
});

async function decoded() {
  return decodeFile(bytes, sha, 'm1.tif', 'scan', { long: 64, dust: false, roll: new Map(), raw: noRaw });
}

/** The display chain below output.frame (the document geometry) of a negative's neutral document with its measured base. */
function chain(g: Graph, d: Awaited<ReturnType<typeof decoded>>): Node {
  const r = withMeasured(newDocument('negative-scan', { sha256: sha, name: 'm1', width: d.info.width, height: d.info.height }), d);
  let top = compile(r, g).display;
  if (top.op === 'output.frame') top = g.get(top.inputs[0]!)!;
  return top;
}

const px = async (e: { evaluate: RefEngine['evaluate'] }, n: Node, precision: 'preview' | 'export') =>
  Array.from(await (await e.evaluate(n, { scale: 'full', precision })).read());

describe('TabulatedPreviews (CHB-031 F10)', () => {
  it('previews are the tabulated engine\'s pixels, exports the exact engine\'s', async () => {
    const d = await decoded();
    const g = new Graph();
    g.registerSource(d.info);
    const n = chain(g, d);
    const two = new TabulatedPreviews({ data, sampled: true });
    const tab = new RefEngine({ data, sampled: true, mode: 'tabulated' });
    const exact = new RefEngine({ data, sampled: true, mode: 'exact' });
    for (const e of [two, tab, exact]) {
      e.openDecoded(d.info, d.data);
      e.adopt(g.closure(n.id));
    }
    const [pTwo, eTwo, pTab, eExact] = [await px(two, n, 'preview'), await px(two, n, 'export'), await px(tab, n, 'preview'), await px(exact, n, 'export')];
    expect(pTwo).toEqual(pTab);
    expect(eTwo).toEqual(eExact);
    // the two physics differ (else this test proves nothing) but stay close (core bounds tables vs exact)
    const diff = Math.max(...pTwo.map((v, i) => Math.abs(v - eTwo[i]!)));
    expect(diff).toBeGreaterThan(0);
    expect(diff).toBeLessThan(0.05);
    // a measurement at preview precision is the tabulated engine's
    const stats = g.intern('measure.stats', [n.id], {}).node;
    for (const e of [two, tab, exact]) e.adopt(g.closure(stats.id));
    expect((await two.measure(stats, { precision: 'preview' })).value).toEqual((await tab.measure(stats)).value);
    expect((await two.measure(stats, { precision: 'export' })).value).toEqual((await exact.measure(stats)).value);
  });

  it('forgetSource drops the source from both engines', async () => {
    const d = await decoded();
    const g = new Graph();
    g.registerSource(d.info);
    const n = chain(g, d);
    const two = new TabulatedPreviews({ data });
    two.openDecoded(d.info, d.data);
    two.adopt(g.closure(n.id));
    await px(two, n, 'preview');
    two.forgetSource(sha);
    expect(two.preview.graph.source(sha)).toBeUndefined();
    expect(two.exact.graph.source(sha)).toBeUndefined();
    expect(() => two.adopt(g.closure(n.id))).toThrow(/E_NO_SOURCE/);
  });

  it('referenceEngine: exact is one RefEngine, tabulated the pair', () => {
    expect(referenceEngine({ data, mode: 'exact' })).toBeInstanceOf(RefEngine);
    expect(referenceEngine({ data, mode: 'tabulated' })).toBeInstanceOf(TabulatedPreviews);
  });

  it('the engine worker in mode tabulated: previews tabulated, exports exact', async () => {
    const { port1, port2 } = new MessageChannel();
    ports.push(port1, port2);
    serveEngine(port1 as unknown as EngineScope, { raw: noRaw });
    port1.start();
    port2.start();
    const client = new WorkerClient(port2 as unknown as WorkerLike);
    const init = await client.init({ engine: 'reference', librawWasmUrl: 'unused', mode: 'tabulated' });
    const we = new WorkerEngine(client, init.caps!);
    const w = await client.decode(bytes, sha, 'm1.tif', 'scan', { long: 64, dust: false, keep: 'register' });
    we.register(w.info.sha256);
    const d = await decoded();
    const g = new Graph();
    g.registerSource(d.info);
    const n = chain(g, d);
    we.adopt(g.closure(n.id));
    const tab = new RefEngine({ data, sampled: true, mode: 'tabulated' });
    const exact = new RefEngine({ data, sampled: true, mode: 'exact' });
    for (const e of [tab, exact]) {
      e.openDecoded(d.info, d.data);
      e.adopt(g.closure(n.id));
    }
    expect(await px(we, n, 'preview')).toEqual(await px(tab, n, 'preview'));
    expect(await px(we, n, 'export')).toEqual(await px(exact, n, 'export'));
  });
});
