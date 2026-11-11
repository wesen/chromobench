// Stage 3 acceptance (guide §8, colour and renderings) on core's f64 output path (print/gamut.ts
// displaySetup, the reference engine's output.display): paper white in both renderings, flare and the
// black, the knee numbers and laws, CAM16-UCS against colour-science, and the knee-last rule.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  adaptBradford, addFlare, cam16, compressOutput, D65, displayLinear, displayPixel, displaySetup, interimData, jmhToUcs, knee, makePrintChain,
  mulMV, outputSpace, perceptual, SPEKTRAFILM, tanhShoulder, type KneeName, type Vec3,
} from '@chromobench/core';
import { SPACE_IDS } from '../src/spaces.ts';

const fx = JSON.parse(readFileSync(new URL('../../../fixtures/golden/chb-011.json', import.meta.url), 'utf8'));
const R = fx.renderings;
// the textbook's print: Portra 400 on Portra Endura under a 5,000 K light (core ch2 goldens' setup)
const ch = makePrintChain({ data: interimData(), film: 'kodak_portra_400', paper: 'kodak_portra_endura', conv: { ...SPEKTRAFILM, cmf: 'chromogen-fit' }, view: 'bb5000', aim: 'midgray-normalised' });
// print-xyz after view.adapt to D65 (what output.display receives)
const toD65 = (X: ArrayLike<number>): Vec3 => adaptBradford(X, ch.white, D65);
const paperWhite = toD65(ch.paperWhite);
const black = toD65(ch.print([0, 0, 0]).XYZ);
const setup = (rendering: 'print-as-seen' | 'scan-of-print', space: (typeof SPACE_IDS)[number], k: KneeName = 'oklch') =>
  displaySetup({ rendering, white: D65, paperWhite, space, knee: k });
const u16 = (v: number) => Math.round(v * 65535);
const lum = (space: (typeof SPACE_IDS)[number], lin: Vec3) => mulMV(outputSpace(space).toXYZ, lin)[1] / outputSpace(space).white[1];

describe('renderings (guide §2.5)', () => {
  for (const space of SPACE_IDS) {
    for (const k of ['oklch', 'cam16-ucs', 'clip'] as const) {
      it(`scan-of-print: paper white is exactly 65,535 in every channel (${space}, ${k})`, () => {
        expect(displayPixel(paperWhite, setup('scan-of-print', space, k)).map(u16)).toEqual([65535, 65535, 65535]);
      });
    }
  }
  it("broken variant: the Studio's Y-only gain plus the tanh shoulder puts paper white at 0.957 linear (250 of 255)", () => {
    expect(Math.abs(tanhShoulder(1) - R.studioPaperWhiteLinear)).toBeLessThan(5e-4);
    expect(Math.round(outputSpace('srgb').encode(tanhShoulder(1)) * 255)).toBe(R.studioPaperWhite8);
    // the real paper white after the Y-only gain: every channel lands near 250, none at 255
    const studio = mulMV(outputSpace('srgb').fromXYZ, paperWhite.map((v) => v / paperWhite[1]));
    studio.map((v) => Math.round(outputSpace('srgb').encode(tanhShoulder(v)) * 255)).forEach((v) => expect(Math.abs(v - R.studioPaperWhite8)).toBeLessThanOrEqual(1));
    // and our tanh-shoulder knee in scan-of-print has the same limitation (kept only for Studio comparison)
    expect(displayPixel(paperWhite, setup('scan-of-print', 'srgb', 'tanh-shoulder')).map(u16)[1]).toBeLessThan(65535);
  });

  it('print-as-seen: paper white keeps its level (Y 0.813) and tint; the oklch lightness knee leaves it alone', () => {
    for (const space of SPACE_IDS) {
      const s = setup('print-as-seen', space);
      const lin = displayLinear(paperWhite, s);
      expect(Math.abs(lum(space, lin) - R.printAsSeenPaperWhiteY)).toBeLessThan(2e-3);
      const clipped = displayLinear(paperWhite, setup('print-as-seen', space, 'clip'));
      lin.forEach((v, i) => expect(Math.abs(v - clipped[i]!)).toBeLessThan(1e-3));
    }
  });

  it('print-as-seen black: density 2.09 with the default 0.48 % flare, 1.35 with surface reflection k1 = 4 %', () => {
    const s = setup('print-as-seen', 'srgb', 'clip');
    const D = (X: Vec3) => -Math.log10(lum('srgb', displayLinear(X, s)));
    expect(Math.abs(D(addFlare(black, 0.0048, paperWhite)) - R.blackDensityFlare048)).toBeLessThan(R.tolDensity);
    // k1 is a fraction of the incident light (a perfect white), i.e. k1 / Y_paper of the paper white
    expect(Math.abs(D(addFlare(black, R.k1 / paperWhite[1], paperWhite)) - R.blackDensityK1)).toBeLessThan(R.tolDensity);
  });

  it('scan-of-print black: no flare, 2.28 below paper white (luminance 0.0052 of display white)', () => {
    for (const space of SPACE_IDS) {
      const Y = lum(space, displayLinear(black, setup('scan-of-print', space, 'clip')));
      expect(Math.abs(-Math.log10(Y) - R.scanOfPrintBlackBelowPaperWhite)).toBeLessThan(R.tolDensity);
      expect(Math.abs(Y - R.scanOfPrintBlackLuminance)).toBeLessThan(1.5e-4);
    }
    // broken variant: flare applied in scan-of-print lifts the black visibly
    const Yf = lum('srgb', displayLinear(addFlare(black, 0.0048, paperWhite), setup('scan-of-print', 'srgb', 'clip')));
    expect(-Math.log10(Yf)).toBeLessThan(R.scanOfPrintBlackBelowPaperWhite - 0.2);
  });

  it('the reference engine renders through the same setup (output.display, both renderings)', async () => {
    const { Graph } = await import('@chromobench/contract');
    const { RefEngine } = await import('@chromobench/core');
    const g = new Graph();
    const e = new RefEngine({ data: interimData() });
    const I = (op: string, inputs: string[], args: Record<string, unknown> = {}) => { const n = g.intern(op, inputs, args).node; e.adopt(g.closure(n.id)); return n.id; };
    const pat = I('source.pattern', [], { domain: 'paper-dyes', width: 4, height: 2, seed: 3 });
    const xyz = I('view.adapt', [I('view.flare', [I('view.reflect', [pat], { illuminant: 'D50' })], { flare: 0 })], { to: 'D65' });
    for (const rendering of ['print-as-seen', 'scan-of-print'] as const) {
      for (const space of ['srgb', 'prophoto'] as const) {
        const out = I('output.display', [xyz], { rendering, space, knee: 'oklch' });
        const r = await e.evaluate({ id: out, info: g.get(out)!.info }, { scale: 'full', precision: 'export' });
        const d = await r.read();
        expect(d.every((v) => v >= 0 && v <= 1)).toBe(true);
      }
    }
  });
});

describe('the knee (guide §2.4, §5.4)', () => {
  it("spektrafilm's numbers: d = 0.5, 0.8, 1, 2 → 0.4987, 0.770, 0.891, 0.997 (t, ℓ, p = 0, 1, 6)", () => {
    fx.knee.d.forEach((d: number, i: number) => expect(Math.abs(knee(d, 0, 1, 6) - fx.knee.out[i])).toBeLessThan(fx.knee.tol));
  });
  it('law (textbook §2.8): a gain of 1.25 after the knee leaves the cube (0.9 → 1.048), before it stays inside (0.935)', () => {
    expect(Math.abs(1.25 * knee(0.9, 0, 1, 6) - fx.knee.gainAfter)).toBeLessThan(fx.knee.tol);
    expect(Math.abs(knee(1.25 * 0.9, 0, 1, 6) - fx.knee.gainBefore)).toBeLessThan(fx.knee.tol);
  });

  it('CAM16-UCS matches colour-science (spektrafilm viewing conditions; D from L_A, and D = 1 as used here)', () => {
    const w = fx.cam16ucs.white.map((v: number) => 100 * v);
    const camD = cam16(w, { L_A: 64, Y_b: 20, F: 1, c: 0.69, N_c: 1 });
    const cam1 = cam16(w);
    for (const s of fx.cam16ucs.samples) {
      const X = s.XYZ.map((v: number) => 100 * v);
      const a = jmhToUcs(camD.fwd(X));
      const b = jmhToUcs(cam1.fwd(X));
      a.forEach((v, k) => expect(Math.abs(v - s.ucs[k])).toBeLessThan(1e-9));
      b.forEach((v, k) => expect(Math.abs(v - s.ucsD1[k])).toBeLessThan(1e-9));
      const back = cam1.inv(cam1.fwd(X));
      back.forEach((v, k) => expect(Math.abs(v - X[k]!)).toBeLessThan(1e-9));
    }
  });

  // a deterministic cloud of colours in and far outside every cube (super-saturated, negative, super-white)
  const cloud: Vec3[] = [];
  let seed = 7;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
  for (let i = 0; i < 300; i++) cloud.push([rnd() * 1.6 - 0.3, rnd() * 1.6 - 0.3, rnd() * 1.6 - 0.3]);

  for (const algorithm of ['oklch', 'cam16-ucs'] as const) {
    it(`${algorithm}: every output lies in [0, 1]³; hue kept within 0.1°; in-gamut neutrals unchanged`, () => {
      for (const space of ['srgb', 'display-p3', 'prophoto'] as const) {
        const P = perceptual(algorithm, space);
        for (const rgb of cloud) {
          const o = compressOutput(rgb, { algorithm, chroma: [0, 1, 6], lightness: [0.7, 1, 2.2], space });
          expect(o.every((v) => v >= 0 && v <= 1)).toBe(true);
          const [L0, a0, b0] = P.fwd(rgb);
          const [L1, a1, b1] = P.fwd(o);
          // hue is kept unless the result is (nearly) neutral or clipped at black/white
          if (L0 > 0.05 * P.white && L1 < 0.98 * P.white && Math.hypot(a1, b1) > 1e-3 * P.white && o.every((v) => v > 1e-6 && v < 1 - 1e-6)) {
            let dh = Math.abs(Math.atan2(b1, a1) - Math.atan2(b0, a0)) * 180 / Math.PI;
            if (dh > 180) dh = 360 - dh;
            expect(dh, `${space} ${rgb.join(',')}`).toBeLessThan(0.1);
          }
        }
        for (const g of [0.05, 0.2, 0.5, 0.9]) {
          const o = compressOutput([g, g, g], { algorithm, chroma: [0, 1, 6], lightness: null, space });
          o.forEach((v) => expect(Math.abs(v - g)).toBeLessThan(1e-12));
        }
      }
    });
  }

  it('knee last: output.display ends with the knee and the TRC — a gain after the knee leaves the cube, before it does not', () => {
    const s = setup('scan-of-print', 'srgb');
    const sat: Vec3 = [0.5, 0.18, 0.12];
    const lin = displayLinear(sat, s);
    expect(lin.every((v) => v <= 1)).toBe(true);
    const after = lin.map((v) => 1.25 * v);
    const before = displayLinear(sat.map((v) => 1.25 * v), s);
    expect(Math.max(...after)).toBeGreaterThan(1);
    expect(Math.max(...before)).toBeLessThanOrEqual(1);
  });
});
