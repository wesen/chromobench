// CHB-023 host pieces without a browser: the StudioEngine's host ops (output.frame orientation and
// crop, view.inspect, P3 re-encode) against the mock engine's own implementations, the automatic first
// print on core's RefEngine (the frame integrates to grey), the test-strip bands and the time grid.
import {
  compile, cutNode, edit, Graph, newDocument, sha256Hex,
  type Box, type Document, type Engine, type EngineCaps, type EvalTarget, type Geometry, type ImageResult, type Measurement, type NodeDef, type NodeRef, type SourceInfo, type SourceRef,
} from '@chromobench/contract';
import { set } from '@chromobench/values';
import { bakeLights, CLASS_CODE, classify, DEFAULT_CONVENTIONS, DEFAULT_SIGMA_D, integrateToGrey, nodePacksData, Lights, RefEngine } from '@chromobench/core';
import { makeM1Tiff, MockEngine } from '@chromobench/engine-mock';
import { conditionScan, plantedFrames, plantedStrip, stripFrames } from '@chromobench/ingest';
import { describe, expect, it } from 'vitest';
import { firstPrint, gridTime, integratedExposure, measureExposure, withMeasured, withRebate } from '../src/host/first-print.ts';
import { HOST_OPS, srgbToP3, StudioEngine, type HostServices } from '../src/host/studio-engine.ts';
import { bandBoxes, evaluateBands, layerOf, lightsOf, mainExposure, stripMutation, stripValues } from '@chromobench/studio-kit';

const bytes = makeM1Tiff();
const sha = sha256Hex(bytes);

/** A negative's neutral document for a source of w × h px (the studio's frames start from it). */
const neg = (s: string, w: number, h: number): Document => newDocument('negative-scan', { sha256: s, name: 'm1', width: w, height: h });
const withGeometry = (d: Document, g: Geometry): Document => ({ ...d, geometry: g });
const withCrop = (d: Document, crop: Box): Document => ({ ...d, geometry: { ...d.geometry, crop } });
const timeOf = (d: Document): number => mainExposure(d).time_s;
const autoOf = (d: Document): Record<string, unknown> => layerOf(d, 'lights')!.source;
const scanOf = (d: Document) => d.stages.scan!.medium as { rebate: Box | null; flare: unknown; baseT: unknown };

/** The mock engine without the ops the StudioEngine provides, so the wrapper must compute them. */
class Without implements Engine {
  readonly id = 'mock' as const;
  readonly inner = new MockEngine();
  private readonly drop: Set<string>;
  constructor(drop: string[]) {
    this.drop = new Set(drop);
  }
  capabilities(): EngineCaps {
    const c = this.inner.capabilities();
    return { ...c, ops: c.ops.filter((o) => !this.drop.has(o)) };
  }
  open(s: SourceRef): Promise<SourceInfo> { return this.inner.open(s); }
  adopt(d: readonly NodeDef[]): void { this.inner.adopt(d); }
  evaluate(n: NodeRef, t: EvalTarget): Promise<ImageResult> { return this.inner.evaluate(n, t); }
  measure(n: NodeRef): Promise<Measurement> { return this.inner.measure(n); }
  prepare(): Promise<void> { return Promise.resolve(); }
  dispose(): void {}
}

const services = (primary: Without): HostServices => ({
  decode: async (b, s, name) => {
    const info = await primary.inner.open({ kind: 'file', sha256: s, name, bytes: b });
    return { info, data: new Float32Array(0), full: { width: info.width, height: info.height }, notes: ['test'] };
  },
  register: () => undefined,
  classify: (D, sigma, res) => CLASS_CODE[classify(D, sigma, res).cls],
  defaultSigma: DEFAULT_SIGMA_D,
});

async function both(drop: string[]): Promise<{ wrap: StudioEngine; mock: MockEngine; g: Graph; info: SourceInfo }> {
  const p = new Without(drop);
  const wrap = new StudioEngine(p, services(p), 'test');
  const info = await wrap.open({ kind: 'file', sha256: sha, name: 'm1.tif', bytes });
  const mock = new MockEngine();
  await mock.open({ kind: 'file', sha256: sha, bytes });
  const g = new Graph();
  g.registerSource(info);
  return { wrap, mock, g, info };
}

const read = async (e: Engine, g: Graph, id: string, t: EvalTarget): Promise<{ w: number; h: number; d: number[] }> => {
  e.adopt(g.closure(id));
  const r = await e.evaluate(g.get(id)!, t);
  return { w: r.width, h: r.height, d: Array.from(await r.read()) };
};

describe('StudioEngine host ops', () => {
  it('output.frame is the engines\' own (CHB-037 P3b): the host neither lists nor computes it', async () => {
    expect(HOST_OPS as readonly string[]).not.toContain('output.frame');
    const { wrap, g, info: src } = await both(['output.frame']);
    expect(wrap.capabilities().ops).not.toContain('output.frame');
    const n = compile(withGeometry(neg(sha, src.width, src.height), { orientation: 'cw90', angle_deg: 0, crop: { x: 10, y: 6, w: 70, h: 50 } }), g).display;
    await expect(read(wrap, g, n.id, { scale: 'full', precision: 'preview' })).rejects.toMatchObject({ code: 'E_NOT_IMPLEMENTED' });
  });

  it('view.inspect: every inspection view renders as display RGB in [0, 1]', async () => {
    const { wrap, g, info } = await both(['view.inspect']);
    const c = compile(neg(sha, info.width, info.height), g);
    const src = cutNode(c, 'source');
    const dyes = cutNode(c, 'negative');
    const classes = g.intern('invert.classes', [dyes.id], {}).node;
    for (const [inner, mode] of [[src, 'negative'], [dyes, 'dyes'], [classes, 'classes']] as const) {
      const n = g.intern('view.inspect', [inner.id], { mode }).node;
      const px = await read(wrap, g, n.id, { scale: 0.5, precision: 'preview' });
      expect(px.d.length, mode).toBe(px.w * px.h * 3);
      expect(px.d.every((v) => v >= 0 && v <= 1), mode).toBe(true);
    }
  });

  it('P3 re-encode keeps white and black and greys, and widens nothing inside sRGB', () => {
    const out = srgbToP3(Float32Array.from([1, 1, 1, 0, 0, 0, 0.5, 0.5, 0.5, 1, 0, 0]), 4, 3);
    for (const k of [0, 1, 2]) {
      expect(out[k]).toBeCloseTo(1, 5);
      expect(out[3 + k]).toBeCloseTo(0, 6);
      expect(out[6 + k]).toBeCloseTo(0.5, 4);
    }
    // sRGB red is inside P3: less saturated there (r < 1, g > 0)
    expect(out[9]!).toBeLessThan(1);
    expect(out[10]!).toBeGreaterThan(0);
  });

  it('a node the engine cannot compute names the missing ops', async () => {
    const { wrap, g } = await both(['mask.paint']);
    const n = g.intern('mask.paint', [g.intern('source.open', [], { source: sha, encoding: 'linear', umPerPx: 6 }).node.id], { strokes: [] }).node;
    wrap.adopt(g.closure(n.id));
    await expect(wrap.evaluate(n, { scale: 'full', precision: 'preview' })).rejects.toMatchObject({ code: 'E_NOT_IMPLEMENTED', message: expect.stringContaining('mask.paint') });
  });
});

describe('first print (core RefEngine)', () => {
  const integrate = (latd: number[], alpha: number) => [...integrateToGrey(latd, { latd: [0, 0, 0], lights: Lights.zero() }, alpha).logH] as [number, number, number];

  it('integrates the frame to the aim, neutralising 75 % of its cast (D8): real mode, time on the 1/6-stop grid', async () => {
    const e = new RefEngine({ data: nodePacksData() });
    const info = await e.open({ kind: 'file', sha256: sha, bytes });
    const g = new Graph();
    g.registerSource(info);
    const r0 = neg(sha, info.width, info.height);
    const x0 = await measureExposure(e, g, r0);
    const m0 = (x0[0] + x0[1] + x0[2]) / 3;
    const r = await firstPrint(e, g, r0, { integrate });
    expect((r.stages.darkroom.medium as { mode: string }).mode).toBe('real');
    expect(gridTime(timeOf(r))).toBe(timeOf(r));
    expect(autoOf(r)).toMatchObject({ kind: 'auto', method: 'integrate', alpha: 0.75, applied: true, logH: lightsOf(r) });
    // the density at the aim; a quarter of the frame's cast kept (it was taken out in full until CHB-046)
    const x = await measureExposure(e, g, r);
    expect(Math.abs((x[0] + x[1] + x[2]) / 3)).toBeLessThan(0.01);
    x.forEach((v, k) => expect(Math.abs(v - 0.25 * (x0[k]! - m0))).toBeLessThan(0.01));
    // with Neutralise 100 % the frame prints to grey
    const grey = await firstPrint(e, g, r0, { integrate, aim: { alpha: 1 } });
    for (const v of await measureExposure(e, g, grey)) expect(Math.abs(v)).toBeLessThan(0.01);
    // the colour remainder is in the lights, the density in the time: the lights' mean is within half a grid step
    const l = lightsOf(r);
    const m = (l[0] + l[1] + l[2]) / 3;
    expect(Math.abs(m)).toBeLessThanOrEqual(Math.log10(2) / 12 + 1e-9);
  });

  it('a frame of a strip (CHB-027 WS-D) is printed for its own crop: each frame integrates to grey on its own', async () => {
    // three frames, the first 0.5 D denser (overexposed): the strip's average would print the others too light
    const strip = plantedFrames({ frames: 3, pxPerMm: 1.5, exposureD: [0.5, 0, 0] });
    const sha = 'd'.repeat(64);
    const info: SourceInfo = {
      sha256: sha, format: 'tiff', width: strip.w, height: strip.h, channels: 3, bits: 16, sample: 'uint',
      encoding: { value: 'linear', evidence: 'format' }, levels: { black: [0, 0, 0], white: [1, 1, 1], from: 'default' },
      cfa: 'none', clippedFraction: 0, notes: [],
    };
    const c = conditionScan(Float32Array.from(strip.rgb), strip.w, strip.h, { id: sha, subtract: false });
    const boxes = stripFrames(strip.rgb, strip.w, strip.h, { layout: c.layout });
    expect(boxes.split).toBe(true);
    const e = new RefEngine({ data: nodePacksData() });
    e.openDecoded(info, Float32Array.from(strip.rgb));
    const g = new Graph();
    g.registerSource(info);
    const base = withMeasured(neg(sha, strip.w, strip.h), { rebate: c.rebate, flare: c.flare, baseT: c.scanBaseT });
    const times: number[] = [];
    for (const f of boxes.frames) {
      const r = await firstPrint(e, g, withCrop(base, f.box), { integrate });
      times.push(timeOf(r));
      const x = await measureExposure(e, g, r);
      for (const v of x) expect(Math.abs(v)).toBeLessThan(0.05);
    }
    // the dense frame passes 0.5 D less light: it needs a longer time; the two alike frames get about the same
    expect(times[0]!).toBeGreaterThan(times[1]! * 1.5);
    expect(Math.abs(Math.log2(times[1]! / times[2]!))).toBeLessThan(0.5);
  }, 60_000);

  it('integratedExposure: log of the mean of 10^x, clamped, NaN skipped', () => {
    expect(integratedExposure([0, 0, 0, 0, 0, 0], 2)).toEqual([0, 0, 0]);
    const v = integratedExposure([1, 0, -1, NaN, 0, 0, -1, 0, 1], 3);
    expect(v[0]).toBeCloseTo(Math.log10((10 + 0.1) / 2), 12);
    expect(integratedExposure([9, 9, 9], 1)[0]).toBeCloseTo(2, 12);
  });

  it('gridTime: 10 s · 2^(k/6), clamped to 2…120 s', () => {
    expect(gridTime(10)).toBe(10);
    expect(gridTime(11.3)).toBe(11.225);
    expect(gridTime(0.5)).toBe(gridTime(2));
    expect(gridTime(1000)).toBeLessThanOrEqual(120);
  });
});

describe('test strip bands', () => {
  it('bands tile the frame; each band of the composite is the print with its own value', async () => {
    const e = new MockEngine();
    const info = await e.open({ kind: 'file', sha256: sha, bytes });
    const g = new Graph();
    g.registerSource(info);
    const r = neg(sha, info.width, info.height);
    const values = stripValues('time', timeOf(r), 1 / 3, 5);
    const boxes = bandBoxes(5, info.width, info.height);
    expect(boxes.reduce((s, b) => s + b.w, 0)).toBe(info.width);
    const bands = values.map((v, i) => {
      const mu = stripMutation('time', r, v);
      const n = compile(edit(r, [set(mu.path, mu.value)]).doc, g).display;
      e.adopt(g.closure(n.id));
      return { node: n, box: boxes[i]! };
    });
    const c = await evaluateBands(e, bands, { scale: 'full', precision: 'preview' });
    expect([c.result.width, c.result.height]).toEqual([info.width, info.height]);
    for (const b of bands) {
      const own = await e.evaluate(b.node, { scale: 'full', precision: 'preview', region: b.box });
      const d = await own.read();
      const x = b.box.x + 1, y = 7;
      const i = (y * info.width + x) * 3, j = (y * b.box.w + 1) * 3;
      expect(Array.from(c.data.slice(i, i + 3))).toEqual(Array.from(d.slice(j, j + 3)));
    }
  });

  it('stripMutation changes only the varied quantity', () => {
    const r = neg(sha, 96, 64);
    expect(stripMutation('time', r, 12.3)).toEqual({ path: 'main.params.time_s', value: 12.3 });
    const f = stripMutation('filtration.m', r, 5);
    expect(f).toEqual({ path: 'main.params.filtration', value: { ...mainExposure(r).filtration, m: 5 } });
  });
});

describe('first print on a roll scan (CHB-020 host wiring)', () => {
  const integrate = (latd: number[], alpha: number) => [...integrateToGrey(latd, { latd: [0, 0, 0], lights: Lights.zero() }, alpha).logH] as [number, number, number];
  const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  it('measures the base on the film edge, not on a sprocket hole', async () => {
    const strip = plantedStrip();
    const data = Float32Array.from(strip.rgb);
    const sha = 'f'.repeat(64);
    const c = conditionScan(data, strip.w, strip.h, { id: sha });
    expect(c.rebate).not.toBeNull();
    expect(c.veilFrom).toBe('frame');
    for (const hole of strip.truth.holes) expect(overlaps(c.rebate!, hole)).toBe(false);
    const info: SourceInfo = {
      sha256: sha, format: 'tiff', width: strip.w, height: strip.h, channels: 3, bits: 16, sample: 'uint',
      encoding: { value: 'linear', evidence: 'format' }, levels: { black: [0, 0, 0], white: [1, 1, 1], from: 'default' },
      cfa: 'none', clippedFraction: 0, notes: [],
    };
    const e = new RefEngine({ data: nodePacksData() });
    e.openDecoded(info, data);
    const g = new Graph();
    g.registerSource(info);
    const r0 = neg(sha, strip.w, strip.h);
    // total paper exposure the first print settles on: time and lights together, per channel
    const total = async (box: { x: number; y: number; w: number; h: number } | null | undefined): Promise<number[]> => {
      const r = await firstPrint(e, g, withRebate(r0, box), { integrate });
      return lightsOf(r).map((l) => l + Math.log10(timeOf(r)));
    };
    const measured = await total(c.rebate);
    const truth = await total(strip.truth.rebate[0]);
    const hole = await total(strip.truth.holes[0]);
    const dist = (a: number[], b: number[]): number => Math.max(...a.map((v, k) => Math.abs(v - b[k]!)));
    expect(dist(measured, truth)).toBeLessThan(0.1);
    expect(dist(hole, truth)).toBeGreaterThan(0.3);
    expect(scanOf(withRebate(r0, null)).rebate).toBeNull();
    expect(scanOf(withRebate(r0, c.rebate)).rebate).toEqual(c.rebate);
  }, 60_000);

  it('CHB-010 bake: the first print can carry its colour in the filtration dials; the print stays within the dials\' rounding', async () => {
    const strip = plantedStrip({ castD: [0.12, 0, -0.1] });
    const sha = 'd'.repeat(64);
    const info: SourceInfo = {
      sha256: sha, format: 'tiff', width: strip.w, height: strip.h, channels: 3, bits: 16, sample: 'uint',
      encoding: { value: 'linear', evidence: 'format' }, levels: { black: [0, 0, 0], white: [1, 1, 1], from: 'default' },
      cfa: 'none', clippedFraction: 0, notes: [],
    };
    const c = conditionScan(Float32Array.from(strip.rgb), strip.w, strip.h, { id: sha, subtract: false });
    const e = new RefEngine({ data: nodePacksData() });
    e.openDecoded(info, Float32Array.from(strip.rgb));
    const g = new Graph();
    g.registerSource(info);
    const r0 = withMeasured(neg(sha, strip.w, strip.h), { rebate: c.rebate, flare: c.flare, baseT: c.scanBaseT });
    const plain = await firstPrint(e, g, r0, { integrate });
    const baked = await firstPrint(e, g, r0, { integrate, bake: (d) => bakeLights(d, nodePacksData(), DEFAULT_CONVENTIONS).mutations });
    expect(mainExposure(baked).filtration).not.toEqual(mainExposure(plain).filtration);
    expect(Math.max(...lightsOf(baked).map(Math.abs))).toBeLessThan(Math.max(...lightsOf(plain).map(Math.abs)) + 1e-9);
    expect(autoOf(baked)['logH']).toEqual(autoOf(plain)['logH']);
    const x = async (r: typeof plain): Promise<number[]> => [...(await measureExposure(e, g, r))];
    const [xp, xb] = [await x(plain), await x(baked)];
    expect(Math.max(...xp.map((v, k) => Math.abs(v - xb[k]!)))).toBeLessThan(0.05);
  }, 60_000);

  it('the veil goes into the document (the scan medium\'s flare and baseT), not out of the pixels: same print as subtracting it', async () => {
    const strip = plantedStrip();
    const sha = 'e'.repeat(64);
    const info: SourceInfo = {
      sha256: sha, format: 'tiff', width: strip.w, height: strip.h, channels: 3, bits: 16, sample: 'uint',
      encoding: { value: 'linear', evidence: 'format' }, levels: { black: [0, 0, 0], white: [1, 1, 1], from: 'default' },
      cfa: 'none', clippedFraction: 0, notes: [],
    };
    const raw = Float32Array.from(strip.rgb);
    const kept = conditionScan(raw, strip.w, strip.h, { id: sha, subtract: false });
    expect(raw).toEqual(Float32Array.from(strip.rgb)); // untouched
    expect(kept.flare!.every((f) => f > 0 && f <= 20)).toBe(true);
    const gone = Float32Array.from(strip.rgb);
    const sub = conditionScan(gone, strip.w, strip.h, { id: sha });
    const r0 = neg(sha, strip.w, strip.h);
    const printed = async (px: Float32Array, m: Parameters<typeof withMeasured>[1]): Promise<number[]> => {
      const e = new RefEngine({ data: nodePacksData() });
      e.openDecoded(info, px);
      const g = new Graph();
      g.registerSource(info);
      const r = await firstPrint(e, g, withMeasured(r0, m), { integrate });
      return lightsOf(r).map((l) => l + Math.log10(timeOf(r)));
    };
    const measured = { rebate: kept.rebate, flare: kept.flare, baseT: kept.scanBaseT };
    const viaRecipe = await printed(raw, measured);
    const viaPixels = await printed(gone, { rebate: sub.rebate });
    expect(Math.max(...viaRecipe.map((v, k) => Math.abs(v - viaPixels[k]!)))).toBeLessThan(0.05);
    const r = withMeasured(r0, measured);
    expect(scanOf(r).flare).toEqual(kept.flare);
    expect(scanOf(r).baseT).toEqual(kept.scanBaseT);
  }, 60_000);
});
