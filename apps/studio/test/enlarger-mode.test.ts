// CHB-031 WS-A (F17): what Time does to the print in each enlarger mode, on core's RefEngine and synthetic frames.
// Normalised mode prints the grey card at the aim whatever the optics, so a time change (and the test strip in
// seconds) changes nothing; real mode exposes the paper for the time, so a longer time prints darker.
import { compile, edit, Graph, newDocument, type Document, type SourceInfo } from '@chromobench/contract';
import { set, type Mutation } from '@chromobench/values';
import { DEFAULT_CONVENTIONS, integrateToGrey, Lights, modeShiftLogH, nodePacksData, PhysicsEnv, RefEngine } from '@chromobench/core';
import { darkroomMedium, exposureSettingsOf, LIGHTS_PATH, lightsOf, mainExposure, MODE_PATH, modeSwitch, referenceOpticsShift, stripMutation, stripValues, TIME_PATH } from '@chromobench/studio-kit';
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

/** the display chain below output.frame (the document geometry) */
function node(g: Graph, d: Document) {
  const top = compile(d, g).display;
  return top.op === 'output.frame' ? g.get(top.inputs[0]!)! : top;
}

function setup(kind: Kind) {
  const { info, data } = source(kind);
  const g = new Graph();
  g.registerSource(info);
  const e = new RefEngine({ data: nodePacksData() });
  e.openDecoded(info, data);
  const r0 = newDocument(kind, { sha256: info.sha256, name: kind, width: W, height: H });
  const print = async (r: Document): Promise<Float32Array> => {
    const n = node(g, r);
    e.adopt(g.closure(n.id));
    return (await e.evaluate(n, { scale: 'full', precision: 'preview' })).read() as Promise<Float32Array>;
  };
  return { e, g, info, r0, print };
}

/** the document with its enlarger mode and its main exposure's time set */
const withEnlarger = (d: Document, o: { mode?: 'real' | 'normalised'; time_s?: number }): Document => {
  const ms: Mutation[] = [];
  if (o.mode) ms.push(set(MODE_PATH, o.mode));
  if (o.time_s !== undefined) ms.push(set(TIME_PATH, o.time_s));
  return edit(d, ms).doc;
};
const modeOf = (d: Document): string => darkroomMedium(d).mode;
const timeOf = (d: Document): number => mainExposure(d).time_s;
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
      const bands = async (r: Document): Promise<Float32Array[]> =>
        Promise.all(stripValues('time', timeOf(r), 1 / 3, 5).map(async (v) => {
          const mu = stripMutation('time', r, v);
          const n = node(g, edit(r, [set(mu.path, mu.value)]).doc);
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
      expect(modeOf(r0)).toBe('real'); // the contract's default
      const real = await firstPrint(e, g, r0, { integrate });
      expect(modeOf(real)).toBe('real');
      expect(timeOf(real)).not.toBe(10);
      const lightsMean = (r: Document) => {
        const l = lightsOf(r);
        return (l[0] + l[1] + l[2]) / 3;
      };
      const norm = await firstPrint(e, g, withEnlarger(r0, { mode: 'normalised' }), { integrate });
      expect(modeOf(norm)).toBe('normalised');
      expect(timeOf(norm)).toBe(10);
      // the density the real print put in its time (log10 t/10) is in the normalised print's lights
      expect(lightsMean(norm)).toBeCloseTo(lightsMean(real) + Math.log10(timeOf(real) / 10), 2);
      for (const r of [real, norm]) (await measureExposure(e, g, r)).forEach((v, k) => expect(Math.abs(v - colour0[k]!)).toBeLessThan(0.01));
    }
  });
});

// CHB-046 (CHB-028 F44): switching a print between Real and Normalised darkened it (luma 105 → 52 in the session): the
// mode's shift was dropped. modeSwitch carries it into the printer lights, so the print keeps its density.
describe('Real ↔ Normalised keeps the print (CHB-046, F44)', () => {
  const env = new PhysicsEnv(nodePacksData(), DEFAULT_CONVENTIONS);
  const shift = (s: Parameters<typeof modeShiftLogH>[1]) => modeShiftLogH(env, s);
  /** a corrected print away from the calibration: a long time, another aperture, some yellow, lights off zero */
  const corrected = (r0: Document): Document => edit(r0, [set(TIME_PATH, 31.75), set('main.params.fstop', 11), set('main.params.filtration', { c: 0, m: 5, y: 15 }), set(LIGHTS_PATH, [0.05, -0.02, 0.03])]).doc;
  const luma = (p: Float32Array): number => {
    let s = 0;
    for (let i = 0; i < p.length; i += 3) s += 0.2126 * p[i]! + 0.7152 * p[i + 1]! + 0.0722 * p[i + 2]!;
    return (255 * s) / (p.length / 3);
  };

  for (const kind of ['negative-scan', 'digital-raw'] as const) {
    it(`${kind}: the switch there and back keeps every pixel; the bare mode change does not`, async () => {
      const { r0, print } = setup(kind);
      const real = corrected(r0);
      const p0 = await print(real);
      // the bug: the mode alone (the time's density dropped)
      const bare = await print(withEnlarger(real, { mode: 'normalised' }));
      const s = modeSwitch(real, 'normalised', shift);
      const norm = edit(real, s.mutations).doc;
      expect(modeOf(norm)).toBe('normalised');
      const p1 = await print(norm);
      const before = luma(p0), dropped = luma(bare), kept = luma(p1);
      expect(Math.abs(dropped - before)).toBeGreaterThan(2);
      expect(Math.abs(kept - before)).toBeLessThan(0.05);
      expect(maxDiff(p1, p0)).toBeLessThan(1e-4);
      // and back: the same document as before (lights and time), the same print
      const back = edit(norm, modeSwitch(norm, 'real', shift).mutations).doc;
      expect(modeOf(back)).toBe('real');
      expect(timeOf(back)).toBe(31.75);
      lightsOf(back).forEach((l, k) => expect(l).toBeCloseTo(lightsOf(real)[k]!, 6));
      expect(maxDiff(await print(back), p0)).toBeLessThan(1e-4);
    });
  }

  it('the shift is the optics alone at the neutral pack (the fallback without the physics); a filter adds its cost in real mode', () => {
    const { r0 } = setup('negative-scan');
    const at = edit(r0, [set(TIME_PATH, 20), set('main.params.fstop', 5.6)]).doc;
    const s = exposureSettingsOf(at);
    expect(shift(s)).toBeCloseTo(referenceOpticsShift(s), 9);
    expect(referenceOpticsShift(s)).toBeCloseTo(Math.log10(2) - 2 * Math.log10(5.6 / 8), 12);
    // yellow in the pack: real mode (κ at the calibration pack) loses light that normalised mode renormalises away
    const y = exposureSettingsOf(edit(at, [set('main.params.filtration', { c: 0, m: 0, y: 30 })]).doc);
    expect(shift(y)).toBeLessThan(shift(s) - 0.01);
    // no change when the document is in the mode already
    expect(modeSwitch(at, 'real', shift).mutations).toEqual([]);
  });

  it('lights at their limit: the rest goes into the time on the way to real mode', () => {
    const { r0 } = setup('negative-scan');
    const norm = edit(r0, [set(MODE_PATH, 'normalised'), set(TIME_PATH, 10), set(LIGHTS_PATH, [-1.4, -1.45, -1.4])]).doc;
    // a long time hidden in normalised mode: back in real mode its shift (≈ +0.6 log H) cannot come off the lights
    const at = edit(norm, [set(TIME_PATH, 40)]).doc;
    const r = modeSwitch(at, 'real', referenceOpticsShift);
    const set_ = Object.fromEntries(r.mutations.map((m) => (m.op === 'set' ? [m.path, m.value] : [m.op, null])));
    expect(set_[LIGHTS_PATH]).toEqual([-1.5, -1.5, -1.5]);
    // what the lights could not take off comes off the time
    expect(set_[TIME_PATH] as number).toBeLessThan(40);
  });
});
