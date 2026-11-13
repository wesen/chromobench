// CHB-031 WS-A (F17): what Time does to the print in each enlarger mode, on core's RefEngine and synthetic frames.
// Normalised mode prints the grey card at the aim whatever the optics, so a time change (and the test strip in
// seconds) changes nothing; real mode exposes the paper for the time, so a longer time prints darker.
import { compile, defaultRecipe, Graph, type FrameRecipe, type SourceInfo } from '@chromobench/contract';
import { integrateToGrey, Lights, nodePacksData, RefEngine } from '@chromobench/core';
import { stripRecipe, stripValues } from '@chromobench/studio-kit';
import { describe, expect, it } from 'vitest';
import { FIRST_PRINT_AIM, firstPrint, measureExposure } from '../src/host/first-print.ts';

const W = 60, H = 40;
type Kind = 'negative-scan' | 'digital-raw';

/** a smooth synthetic frame: a negative's orange-masked densities, or a photo's scene-linear greys */
function source(kind: Kind): { info: SourceInfo; data: Float32Array } {
  const data = new Float32Array(W * H * 3);
  const base = kind === 'negative-scan' ? [0.75, 0.42, 0.2] : [0.3, 0.3, 0.3];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const m = 0.15 + 0.8 * (0.5 + 0.5 * Math.sin((6 * x) / W + (3 * y) / H) * Math.cos((5 * y) / H));
    for (let k = 0; k < 3; k++) data[(y * W + x) * 3 + k] = base[k]! * (kind === 'negative-scan' ? m : 1 - 0.9 * m);
  }
  const info: SourceInfo = {
    sha256: (kind === 'negative-scan' ? 'a' : 'b').repeat(64), format: 'tiff', width: W, height: H, channels: 3, bits: 16, sample: 'uint',
    encoding: { value: 'linear', evidence: 'format' }, levels: { black: [0, 0, 0], white: [1, 1, 1], from: 'default' }, cfa: 'none', clippedFraction: 0, notes: [],
  };
  return { info, data };
}

/** the display chain below output.frame (the studio's host op: crop and orientation) */
function node(g: Graph, r: FrameRecipe) {
  const top = compile(r, g);
  return top.op === 'output.frame' ? g.get(top.inputs[0]!)! : top;
}

function setup(kind: Kind) {
  const { info, data } = source(kind);
  const g = new Graph();
  g.registerSource(info);
  const e = new RefEngine({ data: nodePacksData() });
  e.openDecoded(info, data);
  const r0 = defaultRecipe(kind, { sha256: info.sha256, name: kind });
  const print = async (r: FrameRecipe): Promise<Float32Array> => {
    const n = node(g, r);
    e.adopt(g.closure(n.id));
    return (await e.evaluate(n, { scale: 'full', precision: 'preview' })).read() as Promise<Float32Array>;
  };
  return { e, g, info, r0, print };
}

const withEnlarger = (r: FrameRecipe, o: Partial<FrameRecipe['print']['enlarger']>): FrameRecipe => ({ ...r, print: { ...r.print, enlarger: { ...r.print.enlarger, ...o } } });
const mean = (d: ArrayLike<number>): number => {
  let s = 0;
  for (let i = 0; i < d.length; i++) s += d[i]!;
  return s / d.length;
};
const maxDiff = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!));
  return m;
};
const integrate = (latd: number[], alpha: number) => [...integrateToGrey(latd, { latd: [0, 0, 0], lights: Lights.zero() }, alpha).logH] as [number, number, number];

describe('enlarger mode and time (CHB-031 F17)', () => {
  for (const kind of ['negative-scan', 'digital-raw'] as const) {
    it(`${kind}: in normalised mode a time change leaves the print identical; in real mode a longer time prints darker`, async () => {
      const { r0, print } = setup(kind);
      const norm = withEnlarger(r0, { mode: 'normalised' });
      const [n10, n20] = [await print(withEnlarger(norm, { time_s: 10 })), await print(withEnlarger(norm, { time_s: 20 }))];
      expect(maxDiff(n10, n20)).toBe(0);
      const real = withEnlarger(r0, { mode: 'real' });
      const [r10, r20] = [await print(withEnlarger(real, { time_s: 10 })), await print(withEnlarger(real, { time_s: 20 }))];
      // at the calibration optics (10 s, f/8, 8×) and the neutral pack both modes print the same
      expect(maxDiff(r10, n10)).toBeLessThan(1e-6);
      // one stop more: a darker print (lower display values)
      expect(mean(r20)).toBeLessThan(mean(r10) - 0.01);
    });

    it(`${kind}: the test strip in seconds varies in both modes; normalised moves the lights by the bands' stops`, async () => {
      const { e, g, r0 } = setup(kind);
      // each band as the whole print at its own value (a band's box of the composite would mix in the picture)
      const bands = async (r: FrameRecipe): Promise<Float32Array[]> =>
        Promise.all(stripValues('time', r.print.enlarger.time_s, 1 / 3, 5).map(async (v) => {
          const n = node(g, stripRecipe('time', r, v));
          e.adopt(g.closure(n.id));
          return (await e.evaluate(n, { scale: 'full', precision: 'preview' })).read() as Promise<Float32Array>;
        }));
      const real = await bands(withEnlarger(r0, { mode: 'real' }));
      for (let i = 1; i < real.length; i++) expect(mean(real[i]!)).toBeLessThan(mean(real[i - 1]!) - 0.002);
      // before CHB-031 every band of a normalised strip was the same print (the bands set a time it ignores)
      const norm = await bands(withEnlarger(r0, { mode: 'normalised' }));
      for (let i = 1; i < norm.length; i++) expect(mean(norm[i]!)).toBeLessThan(mean(norm[i - 1]!) - 0.002);
      // at the neutral pack and the reference optics a stop of lights is a stop of time: the same bands
      for (let i = 0; i < real.length; i++) expect(maxDiff(norm[i]!, real[i]!)).toBeLessThan(1e-6);
    });
  }

  it('the automatic first print: real mode puts the density into the time, normalised mode into the lights; both print the frame at the aim', async () => {
    for (const kind of ['negative-scan', 'digital-raw'] as const) {
      const { e, g, r0 } = setup(kind);
      // a negative integrates to grey; a photo (F31) keeps its colour and half its departure in density (FIRST_PRINT_AIM)
      const x0 = await measureExposure(e, g, r0);
      const m0 = (x0[0] + x0[1] + x0[2]) / 3;
      const { density, alpha } = FIRST_PRINT_AIM[kind];
      const colour0 = x0.map((v) => v - density * m0 - alpha * (v - m0));
      expect(r0.print.enlarger.mode).toBe('real'); // the contract's default since 0.4
      const real = await firstPrint(e, g, r0, { integrate });
      expect(real.print.enlarger.mode).toBe('real');
      expect(real.print.enlarger.time_s).not.toBe(10);
      const lightsMean = (r: FrameRecipe) => (r.print.lights.logH[0] + r.print.lights.logH[1] + r.print.lights.logH[2]) / 3;
      const norm = await firstPrint(e, g, withEnlarger(r0, { mode: 'normalised' }), { integrate });
      expect(norm.print.enlarger.mode).toBe('normalised');
      expect(norm.print.enlarger.time_s).toBe(10);
      // the density the real print put in its time (log10 t/10) is in the normalised print's lights
      expect(lightsMean(norm)).toBeCloseTo(lightsMean(real) + Math.log10(real.print.enlarger.time_s / 10), 2);
      for (const r of [real, norm]) (await measureExposure(e, g, r)).forEach((v, k) => expect(Math.abs(v - colour0[k]!)).toBeLessThan(0.01));
    }
  });
});
