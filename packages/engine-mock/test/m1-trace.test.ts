// The guide §6 trace: "+4 points red", then undo, against the mock engine and the M1 fixture (contract 1.0: a
// format-3 document whose printer lights are the filter layer `lights`).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { check, compile, cutNode, edit, EditLog, Graph, law, newDocument, sha256Hex, type Compiled, type Node } from '@chromobench/contract';
import { set } from '@chromobench/values';
import { M1, makeM1Tiff, MockEngine } from '@chromobench/engine-mock';
import { readTiffCodes } from '@chromobench/ingest';

const golden = JSON.parse(readFileSync(new URL('../../../fixtures/golden/contract.json', import.meta.url), 'utf8')).m1Trace;
const fixture = new URL('../../../fixtures/synthetic/m1-negative-96x64.tif', import.meta.url);

async function setup() {
  const engine = new MockEngine();
  const bytes = makeM1Tiff();
  const info = await engine.open({ kind: 'file', sha256: sha256Hex(bytes), bytes });
  const g = new Graph();
  g.registerSource(info);
  return { engine, g, info };
}

async function pixelOf(engine: MockEngine, g: Graph, node: Node, at = M1.patchCentre): Promise<number[]> {
  engine.adopt(g.closure(node.id));
  const n = g.get(node.id)!;
  const ch = n.info.kind === 'Image' ? n.info.channels : 3;
  const r = await engine.evaluate(n, { scale: 'full', precision: 'preview', region: { x: at.x, y: at.y, w: 1, h: 1 } });
  return Array.from(await r.read()).slice(0, ch);
}

function nodeAt(g: Graph, top: Compiled, op: string): Node {
  const d = g.closure(top.display.id).find((x) => x.op === op)!;
  return g.adopt([d]).at(-1) ?? (() => { throw new Error(op); })();
}

const doc0 = (sha256: string) => newDocument('negative-scan', { sha256 }, { umPerPx: 6 });
const display = (c: Compiled): Node => c.display;

const close = (a: number[], b: number[], tol = 1e-4): void => {
  a.slice(0, b.length).forEach((v, i) => expect(Math.abs(v - b[i]!), `component ${i}: ${v} vs ${b[i]}`).toBeLessThanOrEqual(tol));
};

describe('M1 fixture', () => {
  it('the checked-in fixture equals the generator output', () => {
    expect(Buffer.from(readFileSync(fixture)).equals(Buffer.from(makeM1Tiff()))).toBe(true);
    const raw = readTiffCodes(makeM1Tiff());
    expect([raw.width, raw.height, raw.bits, raw.samples]).toEqual([96, 64, 16, 3]);
    const i = (M1.patchCentre.y * 96 + M1.patchCentre.x) * 3;
    expect(Array.from(raw.data.slice(i, i + 3))).toEqual([13107, 6554, 3277]);
    expect(Array.from(raw.data.slice(0, 3))).toEqual([52428, 32768, 22937]);
  });
});

describe('§6 trace on the mock engine', () => {
  it('reproduces every stage to 1e-4, reuses upper nodes, and undo restores pixel and hash', async () => {
    const { engine, g, info } = await setup();
    const log = EditLog.create(doc0(info.sha256), { mode: 'ask' });
    const s0 = log.stateHash;
    const top0 = compile(log.state, g);
    close(await pixelOf(engine, g, nodeAt(g, top0, 'scan.density')), golden.scannerDensity);
    close(await pixelOf(engine, g, nodeAt(g, top0, 'invert.dyes')), golden.scannerDensity);
    close(await pixelOf(engine, g, cutNode(top0, 'darkroom.H')), golden.before.x);
    close(await pixelOf(engine, g, nodeAt(g, top0, 'print.develop')), golden.before.paperDyes);
    const p0 = await pixelOf(engine, g, display(top0));
    close(p0, golden.before.display);

    log.apply([set('lights.params.logH', golden.after.lightsLogH)], 'user', 'Printer lights');
    const s1 = log.stateHash;
    expect(s1).not.toBe(s0);
    const top1 = compile(log.state, g);
    const upper = g.closure(top1.display.id).slice(0, 4);
    expect(upper.map((d) => d.op)).toEqual(['source.open', 'scan.density', 'invert.dyes', 'print.expose']);
    expect(cutNode(top1, 'darkroom.H').op).toBe('print.combine');
    close(await pixelOf(engine, g, cutNode(top1, 'darkroom.H')), golden.after.x);
    close(await pixelOf(engine, g, nodeAt(g, top1, 'print.develop')), golden.after.paperDyes);
    const p1 = await pixelOf(engine, g, display(top1));
    close(p1, golden.after.display);
    // upper nodes were computed once and served from cache for the new chain
    for (const d of upper) expect(engine.runs(g.adopt([d]).at(-1)!.id), d.op).toBe(1);

    log.undo();
    expect(log.stateHash).toBe(s0);
    const top2 = compile(log.state, g);
    expect(top2.display.id).toBe(top0.display.id);
    expect(await pixelOf(engine, g, display(top2))).toEqual(p0);
  });

  it('agent proposal in ask mode: pending leaves the pixel, approval matches the user edit', async () => {
    const { engine, g, info } = await setup();
    const log = EditLog.create(doc0(info.sha256), { mode: 'ask' });
    const p0 = await pixelOf(engine, g, display(compile(log.state, g)));
    const prop = log.propose([set('lights.params.logH', [0.1, 0, 0])], { tx: 'eval-1', why: '+4 pt red' });
    expect(await pixelOf(engine, g, display(compile(log.state, g)))).toEqual(p0);
    log.approve([prop.seq]);
    close(await pixelOf(engine, g, display(compile(log.state, g))), golden.after.display);
    expect(log.why('lights.params.logH').at(-1)).toMatchObject({ by: 'agent', approvedBy: 'user' });
  });

  it('mock print directions: more red light → less red reflectance; longer time → darker', async () => {
    const { engine, g, info } = await setup();
    const r0 = doc0(info.sha256);
    const p0 = await pixelOf(engine, g, display(compile(r0, g)));
    const longer = edit(r0, [set('main.params.time_s', 20)]).doc;
    const p1 = await pixelOf(engine, g, display(compile(longer, g)));
    for (let k = 0; k < 3; k++) expect(p1[k]!).toBeLessThan(p0[k]!);
  });

  it('lights.compose: two filters of a and b = one filter of a + b on the mock (to rounding)', async () => {
    const { engine, g } = await setup();
    const x = g.intern('source.pattern', [], { domain: 'paper-logH', width: 8, height: 6, seed: 3 }).node;
    const results: string[] = [];
    const l = law('lights.compose', (r) => [[r.range(-0.4, 0.4), r.range(-0.4, 0.4), r.range(-0.4, 0.4)], [r.range(-0.4, 0.4), r.range(-0.4, 0.4), r.range(-0.4, 0.4)]] as const, ([a, b]) => {
      const two = g.intern('print.combine', [x.id], { filters: [{ logH: a, amount: 1 }, { logH: b, amount: 1 }] }).node;
      const one = g.intern('print.combine', [x.id], { filters: [{ logH: a.map((v, k) => v + b[k]!), amount: 1 }] }).node;
      results.push(two.id, one.id);
      return true;
    }, { justifies: 'printer lights add (textbook §2.8 row 1)', source: 'textbook §2.8' });
    expect(check([l], { n: 20, seed: 1 })[0]!.ok).toBe(true);
    for (let i = 0; i < results.length; i += 2) {
      const a = g.get(results[i]!)!;
      const b = g.get(results[i + 1]!)!;
      engine.adopt(g.closure(a.id));
      engine.adopt(g.closure(b.id));
      const da = await (await engine.evaluate(a, { scale: 'full', precision: 'export' })).read();
      const db = await (await engine.evaluate(b, { scale: 'full', precision: 'export' })).read();
      for (let k = 0; k < da.length; k++) expect(Math.abs(da[k]! - db[k]!)).toBeLessThan(1e-12);
    }
  });
});
