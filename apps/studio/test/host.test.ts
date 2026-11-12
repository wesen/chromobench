// CHB-023 host pieces without a browser: the StudioEngine's host ops (output.frame orientation and
// crop, view.inspect, P3 re-encode) against the mock engine's own implementations, the automatic first
// print on core's RefEngine (the frame integrates to grey), the test-strip bands and the time grid.
import {
  compile, defaultRecipe, Graph, ORIENTATIONS, sha256Hex,
  type Engine, type EngineCaps, type EvalTarget, type FrameRecipe, type ImageResult, type Measurement, type NodeDef, type NodeRef, type SourceInfo, type SourceRef,
} from '@chromobench/contract';
import { bakeRecipe, CLASS_CODE, classify, DEFAULT_CONVENTIONS, DEFAULT_SIGMA_D, integrateToGrey, nodePacksData, Lights, RefEngine } from '@chromobench/core';
import { makeM1Tiff, MockEngine } from '@chromobench/engine-mock';
import { conditionScan, plantedFrames, plantedStrip, stripFrames } from '@chromobench/ingest';
import { describe, expect, it } from 'vitest';
import { firstPrint, gridTime, integratedExposure, measureExposure, withMeasured, withRebate } from '../src/host/first-print.ts';
import { srgbToP3, StudioEngine, unorientBox, type HostServices } from '../src/host/studio-engine.ts';
import { bandBoxes, evaluateBands, stripRecipe, stripValues } from '@chromobench/studio-kit';

const bytes = makeM1Tiff();
const sha = sha256Hex(bytes);

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
  it('output.frame: a straightened crop (contract 0.3) equals the mock engine, every orientation, with a region', async () => {
    const { wrap, mock, g } = await both(['output.frame']);
    const r = defaultRecipe('negative-scan', { sha256: sha, name: 'm1' });
    for (const o of ORIENTATIONS) {
      const rr: FrameRecipe = { ...r, view: { ...r.view, frame: { orientation: o, angle_deg: 3.5, crop: { x: 10, y: 6, w: 70, h: 50 } } } };
      const n = compile(rr, g);
      const full = await read(wrap, g, n.id, { scale: 'full', precision: 'preview' });
      expect(full, o).toEqual(await read(mock, g, n.id, { scale: 'full', precision: 'preview' }));
      const info = n.info as { width: number; height: number };
      const region = { x: 3, y: 5, w: info.width - 9, h: info.height - 11 };
      const part = await read(wrap, g, n.id, { scale: 0.5, precision: 'preview', region });
      expect(part, `${o} region`).toEqual(await read(mock, g, n.id, { scale: 0.5, precision: 'preview', region }));
    }
  });

  it('output.frame: every orientation, with a crop and a region, equals the mock engine', async () => {
    const { wrap, mock, g } = await both(['output.frame']);
    const r = defaultRecipe('negative-scan', { sha256: sha, name: 'm1' });
    for (const o of ORIENTATIONS) {
      const rr: FrameRecipe = { ...r, view: { ...r.view, frame: { orientation: o, angle_deg: 0, crop: { x: 10, y: 6, w: 70, h: 50 } } } };
      const n = compile(rr, g);
      const full = await read(wrap, g, n.id, { scale: 'full', precision: 'preview' });
      expect(full, o).toEqual(await read(mock, g, n.id, { scale: 'full', precision: 'preview' }));
      const info = n.info as { width: number; height: number };
      const region = { x: 3, y: 5, w: info.width - 9, h: info.height - 11 };
      const part = await read(wrap, g, n.id, { scale: 'full', precision: 'preview', region });
      expect(part, `${o} region`).toEqual(await read(mock, g, n.id, { scale: 'full', precision: 'preview', region }));
    }
  });

  it('unorientBox maps the whole oriented frame onto the whole receiver', () => {
    for (const o of ORIENTATIONS) {
      const swap = ['cw90', 'ccw90', 'transpose', 'transverse'].includes(o);
      expect(unorientBox(o, { x: 0, y: 0, w: swap ? 40 : 60, h: swap ? 60 : 40 }, 60, 40), o).toEqual({ x: 0, y: 0, w: 60, h: 40 });
    }
  });

  it('view.inspect: every inspection view renders as display RGB in [0, 1]', async () => {
    const { wrap, g } = await both(['view.inspect']);
    const r = defaultRecipe('negative-scan', { sha256: sha, name: 'm1' });
    const top = compile(r, g);
    const def = (op: string) => g.closure(top.id).find((x) => x.op === op)!;
    const src = g.intern(def('source.open').op, def('source.open').inputs, def('source.open').args).node;
    const dyes = g.intern(def('invert.dyes').op, def('invert.dyes').inputs, def('invert.dyes').args).node;
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
    const n = g.intern('mask.paint', [g.intern('source.open', [], { source: sha, encoding: 'linear' }).node.id], { strokes: '[]' }).node;
    wrap.adopt(g.closure(n.id));
    await expect(wrap.evaluate(n, { scale: 'full', precision: 'preview' })).rejects.toMatchObject({ code: 'E_NOT_IMPLEMENTED', message: expect.stringContaining('mask.paint') });
  });
});

describe('first print (core RefEngine)', () => {
  const integrate = (latd: number[], alpha: number) => [...integrateToGrey(latd, { latd: [0, 0, 0], lights: Lights.zero() }, alpha).logH] as [number, number, number];

  it('integrates the frame to grey: real mode, time on the 1/6-stop grid, exposure ≈ aim', async () => {
    const e = new RefEngine({ data: nodePacksData() });
    const info = await e.open({ kind: 'file', sha256: sha, bytes });
    const g = new Graph();
    g.registerSource(info);
    const r0 = defaultRecipe('negative-scan', { sha256: sha, name: 'm1' });
    const r = await firstPrint(e, g, r0, { integrate });
    expect(r.print.enlarger.mode).toBe('real');
    expect(gridTime(r.print.enlarger.time_s)).toBe(r.print.enlarger.time_s);
    expect(r.print.lights.auto).toMatchObject({ method: 'integrate', alpha: 1, applied: true, logH: r.print.lights.logH });
    const x = await measureExposure(e, g, r);
    for (const v of x) expect(Math.abs(v)).toBeLessThan(0.01);
    // the colour remainder is in the lights, the density in the time: the lights' mean is within half a grid step
    const m = (r.print.lights.logH[0] + r.print.lights.logH[1] + r.print.lights.logH[2]) / 3;
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
    const base = withMeasured(defaultRecipe('negative-scan', { sha256: sha, name: 'strip' }), { rebate: c.rebate, flare: c.flare, baseT: c.scanBaseT });
    const times: number[] = [];
    for (const f of boxes.frames) {
      const r0 = { ...base, view: { ...base.view, frame: { ...base.view.frame, crop: f.box } } };
      const r = await firstPrint(e, g, r0, { integrate });
      times.push(r.print.enlarger.time_s);
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
    const r = defaultRecipe('negative-scan', { sha256: sha, name: 'm1' });
    const values = stripValues('time', r.print.enlarger.time_s, 1 / 3, 5);
    const boxes = bandBoxes(5, info.width, info.height);
    expect(boxes.reduce((s, b) => s + b.w, 0)).toBe(info.width);
    const bands = values.map((v, i) => {
      const n = compile(stripRecipe('time', r, v), g);
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

  it('stripRecipe changes only the varied quantity', () => {
    const r = defaultRecipe('negative-scan', { sha256: sha, name: 'm1' });
    expect(stripRecipe('time', r, 12.3).print.enlarger.time_s).toBe(12.3);
    const f = stripRecipe('filtration.m', r, 5).print.enlarger.filtration;
    expect(f).toEqual({ ...r.print.enlarger.filtration, m: 5 });
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
    const r0 = defaultRecipe('negative-scan', { sha256: sha, name: 'strip' });
    // total paper exposure the first print settles on: time and lights together, per channel
    const total = async (box: { x: number; y: number; w: number; h: number } | null | undefined): Promise<number[]> => {
      const r = await firstPrint(e, g, withRebate(r0, box), { integrate });
      return r.print.lights.logH.map((l) => l + Math.log10(r.print.enlarger.time_s));
    };
    const measured = await total(c.rebate);
    const truth = await total(strip.truth.rebate[0]);
    const hole = await total(strip.truth.holes[0]);
    const dist = (a: number[], b: number[]): number => Math.max(...a.map((v, k) => Math.abs(v - b[k]!)));
    expect(dist(measured, truth)).toBeLessThan(0.1);
    expect(dist(hole, truth)).toBeGreaterThan(0.3);
    expect(withRebate(r0, null).scan?.rebate).toBeNull();
    expect(withRebate(r0, c.rebate).scan?.rebate).toEqual(c.rebate);
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
    const r0 = withMeasured(defaultRecipe('negative-scan', { sha256: sha, name: 'strip' }), { rebate: c.rebate, flare: c.flare, baseT: c.scanBaseT });
    const plain = await firstPrint(e, g, r0, { integrate });
    const baked = await firstPrint(e, g, r0, { integrate, bake: (r) => bakeRecipe(r, nodePacksData(), DEFAULT_CONVENTIONS).mutations });
    expect(baked.print.enlarger.filtration).not.toEqual(plain.print.enlarger.filtration);
    expect(Math.max(...baked.print.lights.logH.map(Math.abs))).toBeLessThan(Math.max(...plain.print.lights.logH.map(Math.abs)) + 1e-9);
    expect(baked.print.lights.auto.logH).toEqual(plain.print.lights.auto.logH);
    const x = async (r: typeof plain): Promise<number[]> => [...(await measureExposure(e, g, r))];
    const [xp, xb] = [await x(plain), await x(baked)];
    expect(Math.max(...xp.map((v, k) => Math.abs(v - xb[k]!)))).toBeLessThan(0.05);
  }, 60_000);

  it('the veil goes into the recipe (scan.flare, scan.baseT), not out of the pixels: same print as subtracting it', async () => {
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
    const r0 = defaultRecipe('negative-scan', { sha256: sha, name: 'strip' });
    const printed = async (px: Float32Array, m: Parameters<typeof withMeasured>[1]): Promise<number[]> => {
      const e = new RefEngine({ data: nodePacksData() });
      e.openDecoded(info, px);
      const g = new Graph();
      g.registerSource(info);
      const r = await firstPrint(e, g, withMeasured(r0, m), { integrate });
      return r.print.lights.logH.map((l) => l + Math.log10(r.print.enlarger.time_s));
    };
    const measured = { rebate: kept.rebate, flare: kept.flare, baseT: kept.scanBaseT };
    const viaRecipe = await printed(raw, measured);
    const viaPixels = await printed(gone, { rebate: sub.rebate });
    expect(Math.max(...viaRecipe.map((v, k) => Math.abs(v - viaPixels[k]!)))).toBeLessThan(0.05);
    const r = withMeasured(r0, measured);
    expect(r.scan?.flare).toEqual(kept.flare);
    expect(r.scan?.baseT).toEqual(kept.scanBaseT);
  }, 60_000);
});
