// CHB-031 round 2 WS-C: the first print's colour aim (F30) and the photo's first print (F31), on core's RefEngine
// and synthetic frames; the local check on a daylight NEF of the photographer skips when the file is absent.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { compile, defaultRecipe, Graph, type FrameRecipe, type SourceInfo, type Vec3 } from '@chromobench/contract';
import { integrateToGrey, Lights, nodePacksData, RefEngine } from '@chromobench/core';
import { LibRawDecoder } from '@chromobench/ingest';
import { describe, expect, it } from 'vitest';
import { decodePhoto } from '../src/host/decode.ts';
import { FIRST_PRINT_AIM, firstPrint, firstPrintAim, integratedExposure, LAB_SUBJECT_FAILURE, measureExposure, photoRecipe } from '../src/host/first-print.ts';

const integrate = (latd: Vec3, alpha: number): Vec3 => [...integrateToGrey(latd, { latd: [0, 0, 0], lights: Lights.zero() }, alpha).logH] as Vec3;
const W = 64, H = 40;
const mean3 = (v: ArrayLike<number>): number => (v[0]! + v[1]! + v[2]!) / 3;
const colourOf = (v: ArrayLike<number>): Vec3 => [0, 1, 2].map((k) => v[k]! - mean3(v)) as Vec3;
const spread = (v: ArrayLike<number>): number => Math.max(v[0]!, v[1]!, v[2]!) - Math.min(v[0]!, v[1]!, v[2]!);

/** A synthetic source: `pixel(x, y)` gives linear RGB (a photo's scene light, or a negative scan's transmittance). */
function source(kind: FrameRecipe['kind'], pixel: (x: number, y: number) => readonly number[]): { e: RefEngine; g: Graph; r0: FrameRecipe } {
  const data = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data.set(pixel(x, y), (y * W + x) * 3);
  const sha = (kind === 'digital-raw' ? 'c' : 'e').repeat(64);
  const info: SourceInfo = {
    sha256: sha, format: 'tiff', width: W, height: H, channels: 3, bits: 16, sample: 'uint',
    encoding: { value: 'linear', evidence: 'format' }, levels: { black: [0, 0, 0], white: [1, 1, 1], from: 'default' }, cfa: 'none', clippedFraction: 0, notes: [],
  };
  const e = new RefEngine({ data: nodePacksData() });
  e.openDecoded(info, data);
  const g = new Graph();
  g.registerSource(info);
  const d = defaultRecipe(kind, { sha256: sha, name: kind });
  return { e, g, r0: kind === 'digital-raw' ? photoRecipe(d, false) : d };
}

/** a dim, warm daylight photo: a smooth scene, red above blue (a camera's as-shot colour the print must keep) */
const warmPhoto = (x: number, y: number): number[] => {
  const m = 0.02 + 0.06 * (0.5 + 0.5 * Math.sin((6 * x) / W + (3 * y) / H));
  return [1.3 * m, m, 0.7 * m];
};

const withMode = (r: FrameRecipe, mode: 'real' | 'normalised'): FrameRecipe => ({ ...r, print: { ...r.print, enlarger: { ...r.print.enlarger, mode } } });

describe('the first print\'s aim (CHB-031 F30): one setting', () => {
  it('FIRST_PRINT_AIM: a negative integrates to grey; a photo keeps its colour and half its exposure; no subject-failure rule', () => {
    expect(FIRST_PRINT_AIM['negative-scan']).toEqual({ density: 1, alpha: 1, subjectFailure: null });
    expect(FIRST_PRINT_AIM['digital-raw']).toEqual({ density: 0.5, alpha: 0, subjectFailure: null });
    expect(firstPrintAim('negative-scan')).toEqual(FIRST_PRINT_AIM['negative-scan']);
  });

  it('page overrides: ?alpha and ?subjectFailure (1, 0, or chroma:…,trim:…) for a negative, ?photoDensity for a photo', () => {
    const p = (o: Record<string, string>) => (k: string): string | null => o[k] ?? null;
    expect(firstPrintAim('negative-scan', p({ alpha: '0.75' }))).toEqual({ density: 1, alpha: 0.75, subjectFailure: null });
    expect(firstPrintAim('negative-scan', p({ alpha: '3' })).alpha).toBe(1);
    expect(firstPrintAim('negative-scan', p({ alpha: 'warm' })).alpha).toBe(1);
    expect(firstPrintAim('negative-scan', p({ subjectFailure: '1' })).subjectFailure).toEqual(LAB_SUBJECT_FAILURE);
    expect(firstPrintAim('negative-scan', p({ subjectFailure: '0' })).subjectFailure).toBeNull();
    expect(firstPrintAim('negative-scan', p({ subjectFailure: 'chroma:0.12,trim:0.01,bogus:3' })).subjectFailure).toEqual({ chroma: 0.12, trim: 0.01 });
    expect(firstPrintAim('negative-scan', p({ photoDensity: '0.2' })).density).toBe(1);
    expect(firstPrintAim('digital-raw', p({ alpha: '1', subjectFailure: '1' }))).toEqual(FIRST_PRINT_AIM['digital-raw']);
    expect(firstPrintAim('digital-raw', p({ photoDensity: '1' })).density).toBe(1);
  });

  it('integratedExposure with a subject-failure rule leaves out strong colours and extremes; too few kept: every pixel counts', () => {
    // 50 grey pixels at −0.2 log H, 50 strongly red ones
    const x: number[] = [];
    for (let i = 0; i < 50; i++) x.push(-0.2, -0.2, -0.2);
    for (let i = 0; i < 50; i++) x.push(0.4, -0.3, -0.3);
    const all = integratedExposure(x, 100);
    expect(all[0]).toBeGreaterThan(0);
    integratedExposure(x, 100, 3, { chroma: 0.1 }).forEach((v) => expect(v).toBeCloseTo(-0.2, 12));
    // trim: a grey ramp from −1 to +0.98 log H, 2 % of each end left out
    const ramp: number[] = [];
    for (let i = 0; i < 100; i++) ramp.push(-1 + i * 0.02, -1 + i * 0.02, -1 + i * 0.02);
    const kept = Array.from({ length: 96 }, (_, i) => 10 ** (-1 + (i + 2) * 0.02));
    expect(integratedExposure(ramp, 100, 3, { trim: 0.02 })[0]).toBeCloseTo(Math.log10(kept.reduce((a, b) => a + b, 0) / 96), 12);
    // nothing grey: the rule would keep no pixel, so it keeps them all
    const red = x.slice(150);
    expect(integratedExposure(red, 50, 3, { chroma: 0.1 })).toEqual(integratedExposure(red, 50));
  });

  it('alpha is the colour share however many passes: α = 0.5 leaves half the frame\'s colour, 2 or 3 passes alike', async () => {
    const { e, g, r0 } = source('digital-raw', warmPhoto);
    const c0 = colourOf(await measureExposure(e, g, r0));
    expect(spread(c0)).toBeGreaterThan(0.1);
    for (const passes of [2, 3]) {
      const r = await firstPrint(e, g, r0, { integrate, aim: { density: 1, alpha: 0.5 }, passes });
      const x = await measureExposure(e, g, r);
      expect(Math.abs(mean3(x))).toBeLessThan(0.01);
      colourOf(x).forEach((c, k) => expect(Math.abs(c - 0.5 * c0[k]!)).toBeLessThan(0.01));
      expect(r.print.lights.auto.alpha).toBe(0.5);
    }
  });

  it('LAB_SUBJECT_FAILURE: a large strong colour does not pull the grey; the grey half of the frame prints grey', async () => {
    // left half a neutral grey, right half a strong green (a lawn): alpha 1 over the whole frame turns the grey magenta
    const { e, g, r0 } = source('digital-raw', (x) => (x < W / 2 ? [0.12, 0.12, 0.12] : [0.03, 0.2, 0.03]));
    const greyHalf = (r: FrameRecipe): FrameRecipe => ({ ...r, view: { ...r.view, frame: { ...r.view.frame, crop: { x: 2, y: 2, w: W / 2 - 6, h: H - 4 } } } });
    const whole = await firstPrint(e, g, r0, { integrate, aim: { density: 1, alpha: 1 } });
    const lab = await firstPrint(e, g, r0, { integrate, aim: { density: 1, alpha: 1, subjectFailure: LAB_SUBJECT_FAILURE } });
    const greyWhole = colourOf(await measureExposure(e, g, greyHalf(whole)));
    const greyLab = colourOf(await measureExposure(e, g, greyHalf(lab)));
    expect(spread(greyWhole)).toBeGreaterThan(0.1);
    expect(spread(greyLab)).toBeLessThan(0.01);
  }, 30_000);
});

describe('a photo\'s first print (CHB-031 F31): density from the frame, colour from the camera', () => {
  it('photoRecipe keeps the layout\'s enlarger mode and takes the as-shot white balance when the camera has one', () => {
    const d = withMode(defaultRecipe('digital-raw', { sha256: 'f'.repeat(64), name: 'DSC_0001.NEF' }), 'normalised');
    const r = photoRecipe(d, true);
    expect(r.print.enlarger.mode).toBe('normalised');
    expect(r.capture!.whiteBalance.mode).toBe('as-shot');
    expect(r.source.decode?.mode).toBe('photo');
    expect(photoRecipe(withMode(d, 'real'), false).capture!.whiteBalance.mode).toBe('daylight');
  });

  it('real mode: the density goes into the time, the lights stay equal (the colour untouched), half way to the aim', async () => {
    const { e, g, r0 } = source('digital-raw', warmPhoto);
    const x0 = await measureExposure(e, g, r0);
    const c0 = colourOf(x0);
    expect(Math.abs(mean3(x0))).toBeGreaterThan(0.2);
    const r = await firstPrint(e, g, r0, { integrate });
    expect(r.print.enlarger.mode).toBe('real');
    expect(r.print.enlarger.time_s).not.toBe(10);
    expect(r.print.lights.auto).toMatchObject({ method: 'integrate', alpha: 0, applied: true });
    expect(spread(r.print.lights.logH)).toBeLessThan(1e-5);
    // the time carries the density to within half a 1/6-stop grid step
    expect(Math.abs(mean3(r.print.lights.logH))).toBeLessThanOrEqual(Math.log10(2) / 12 + 1e-9);
    const x = await measureExposure(e, g, r);
    expect(Math.abs(mean3(x) - 0.5 * mean3(x0))).toBeLessThan(0.01);
    colourOf(x).forEach((c, k) => expect(Math.abs(c - c0[k]!)).toBeLessThan(0.005));
    // the whole density share (?photoDensity=1) prints the frame's integrated exposure at the aim, colour still kept
    const full = await firstPrint(e, g, r0, { integrate, aim: { density: 1 } });
    const xf = await measureExposure(e, g, full);
    expect(Math.abs(mean3(xf))).toBeLessThan(0.01);
    colourOf(xf).forEach((c, k) => expect(Math.abs(c - c0[k]!)).toBeLessThan(0.005));
    expect(Math.log2(10 / full.print.enlarger.time_s)).toBeGreaterThan(Math.log2(10 / r.print.enlarger.time_s) * 1.7);
  });

  it('normalised mode: the time stays, the three lights move together by the density share', async () => {
    const { e, g, r0 } = source('digital-raw', warmPhoto);
    const x0 = await measureExposure(e, g, withMode(r0, 'normalised'));
    const r = await firstPrint(e, g, withMode(r0, 'normalised'), { integrate });
    expect(r.print.enlarger.time_s).toBe(10);
    expect(spread(r.print.lights.logH)).toBeLessThan(1e-5);
    expect(mean3(r.print.lights.logH)).toBeCloseTo(-0.5 * mean3(x0), 2);
    expect(Math.abs(mean3(await measureExposure(e, g, r)) - 0.5 * mean3(x0))).toBeLessThan(0.01);
  });
});

// The photographer's daylight truck (session 03: 10.0 s f/8, luma 57/255 on screen). Private: read in place, numbers only.
const NEF = join(homedir(), 'Downloads/2026-11-11 - manfred test bilder/DSC_8559.NEF');

describe.skipIf(!existsSync(NEF))('local: a daylight NEF opens near the aim, not dark (F31)', () => {
  it('DSC_8559.NEF at the CPU engine\'s 640 px: time and luma before and after the first print', async () => {
    const bytes = new Uint8Array(readFileSync(NEF));
    const sha = '8'.repeat(64);
    const d = await decodePhoto(bytes, sha, 'DSC_8559.NEF', { long: 640, raw: new LibRawDecoder() });
    const e = new RefEngine({ data: nodePacksData(), mode: 'tabulated' });
    e.openDecoded(d.info, d.data);
    const g = new Graph();
    g.registerSource(d.info);
    const before = photoRecipe(defaultRecipe('digital-raw', { sha256: sha, name: 'DSC_8559.NEF' }), d.info.camera?.asShotNeutral !== undefined);
    const luma = async (r: FrameRecipe): Promise<{ luma: number; rgb: number[] }> => {
      const top = compile(r, g);
      const n = top.op === 'output.frame' ? g.get(top.inputs[0]!)! : top;
      e.adopt(g.closure(n.id));
      const res = await e.evaluate(n, { scale: 'full', precision: 'preview' });
      const px = await res.read();
      const c = res.info.channels, m = [0, 0, 0];
      for (let i = 0; i < res.width * res.height; i++) for (let k = 0; k < 3; k++) m[k]! += Math.min(1, Math.max(0, px[i * c + k]!));
      const rgb = m.map((v) => (255 * v) / (res.width * res.height));
      return { luma: 0.299 * rgb[0]! + 0.587 * rgb[1]! + 0.114 * rgb[2]!, rgb };
    };
    const a = await luma(before);
    const after = await firstPrint(e, g, before, { integrate });
    const b = await luma(after);
    console.log(`DSC_8559.NEF ${d.info.width}×${d.info.height}: before ${before.print.enlarger.time_s} s, luma ${a.luma.toFixed(1)} (RGB ${a.rgb.map((v) => v.toFixed(1)).join('/')}, B/R ${(a.rgb[2]! / a.rgb[0]!).toFixed(3)}); after ${after.print.enlarger.time_s} s, lights ${after.print.lights.logH.join(' ')}, luma ${b.luma.toFixed(1)} (RGB ${b.rgb.map((v) => v.toFixed(1)).join('/')}, B/R ${(b.rgb[2]! / b.rgb[0]!).toFixed(3)})`);
    expect(after.print.enlarger.time_s).toBeLessThan(before.print.enlarger.time_s);
    expect(b.luma).toBeGreaterThan(a.luma + 15);
    // a daylight street prints light and not washed out (session 03's tester asked for about 2/3 stop: 6.3 s, luma 98)
    expect(b.luma).toBeGreaterThan(80);
    expect(b.luma).toBeLessThan(140);
    expect(spread(after.print.lights.logH)).toBeLessThan(1e-5);
  }, 120_000);
});
