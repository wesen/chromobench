// Stage 2 acceptance (guide §8, colour): profiles bundled and parsed, maths from the profiles, PNG and
// TIFF embedding, lcms round trips, the printer-profile library.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { decode as decodePngFast } from 'fast-png';
import { describe, expect, it } from 'vitest';
import { adaptBradford, D65, ICC_V4_RAW, mulMV, OUTPUT_PRIMARIES, outputSpace, rgbToXYZFromPrimaries, type Mat3, type Vec3 } from '@chromobench/core';
import type { OutputSpaceId } from '@chromobench/contract';
import { inflateAll } from '../src/encode/deflate.ts';
import { Png16Writer, pngChunks } from '../src/encode/png16.ts';
import { MemorySink } from '../src/encode/sinks.ts';
import { Tiff16Writer, tiffTags } from '../src/encode/tiff16.ts';
import { ProfileLibrary, validatePrinterProfile } from '../src/icc/library.ts';
import { createLcms } from '../src/icc/lcms/api.ts';
import { matrixTrc, parseIcc } from '../src/icc/parse.ts';
import { BUNDLED_PROFILES } from '../src/icc/profiles/bundled.ts';
import { getSpace, pngColour, SPACE_IDS } from '../src/spaces.ts';
import { memoryDir, syntheticPrinterProfile } from './helpers.ts';

const fx = JSON.parse(readFileSync(new URL('../../../fixtures/golden/chb-011.json', import.meta.url), 'utf8'));
/** The ICC PCS illuminant (header bytes 68–79, s15Fixed16): lcms's XYZ output is relative to it. */
const PCS_D50: Vec3 = [63190 / 65536, 1, 54061 / 65536];
const maxAbs = (A: Mat3, B: Mat3) => Math.max(...A.flatMap((r, i) => r.map((v, j) => Math.abs(v - B[i]![j]!))));

describe('bundled profiles', () => {
  it('bundled.ts holds exactly the .icc files (CC0 Compact ICC Profiles)', () => {
    for (const [name, p] of Object.entries(BUNDLED_PROFILES)) {
      const file = readFileSync(new URL(`../src/icc/profiles/${name}.icc`, import.meta.url));
      expect(createHash('sha256').update(file).digest('hex')).toBe(p.sha256);
      expect(Buffer.from(p.base64, 'base64').equals(file)).toBe(true);
    }
    expect(Object.keys(BUNDLED_PROFILES).length).toBe(10);
  });

  for (const id of SPACE_IDS) {
    it(`${id}: the v4 profile parses; its tags are core's constants; matrices within 1e-4 of the primaries`, () => {
      const s = getSpace(id);
      const p = parseIcc(s.icc);
      expect(p.header.class).toBe('mntr');
      expect(p.header.colourSpace).toBe('RGB ');
      expect(p.header.pcs).toBe('XYZ ');
      expect(p.header.major).toBe(4);
      const raw = ICC_V4_RAW[id];
      const s15 = (v: number[]) => v.map((x) => x / 65536);
      expect(p.xyz('rXYZ')).toEqual(s15(raw.rXYZ));
      expect(p.xyz('gXYZ')).toEqual(s15(raw.gXYZ));
      expect(p.xyz('bXYZ')).toEqual(s15(raw.bXYZ));
      expect(p.chad!.flat()).toEqual(s15(raw.chad));
      const c = p.curve('rTRC');
      expect(c?.kind).toBe('para');
      if (c?.kind === 'para') expect([c.curve.g, c.curve.a, c.curve.b, c.curve.c, c.curve.d]).toEqual(s15(raw.para));
      const m = matrixTrc(p);
      expect(maxAbs(m.toXYZ, outputSpace(id).toXYZ)).toBeLessThan(1e-12);
      expect(maxAbs(m.toXYZ, rgbToXYZFromPrimaries(OUTPUT_PRIMARIES[id]))).toBeLessThan(1e-4);
      for (const v of [0, 0.001, 0.02, 0.18, 0.5, 1]) expect(Math.abs(m.decode(m.encode(v)) - v)).toBeLessThan(1e-12);
      // the v2 variant describes the same space (sampled or gamma curves; no chad)
      const v2 = matrixTrc(parseIcc(s.iccV2));
      expect(maxAbs(v2.toXYZ, m.toXYZ)).toBeLessThan(2e-3);
      for (const v of [0.05, 0.18, 0.5, 0.9]) expect(Math.abs(v2.encode(v) - m.encode(v))).toBeLessThan(3e-3);
    });
  }

  it('broken variant: an off-by-one tag offset is E_ICC_INVALID, a short file too', () => {
    const b = getSpace('srgb').icc.slice();
    new DataView(b.buffer).setUint32(136, b.length); // rXYZ offset past the end
    expect(() => parseIcc(b)).toThrow(/E_ICC_INVALID/);
    expect(() => parseIcc(new Uint8Array(64))).toThrow(/E_ICC_INVALID/);
  });
});

/** Encoded 16-bit codes of D65-relative XYZ in a space (print-as-seen, no knee needed for the card). */
function codes(id: OutputSpaceId, X: ArrayLike<number>, toRGB?: Mat3): number[] {
  const S = outputSpace(id);
  const lin = mulMV(toRGB ?? S.fromXYZ, toRGB ? X : adaptBradford(X, D65, S.white));
  return lin.map((v) => Math.round(S.encode(Math.min(1, Math.max(0, v))) * 65535));
}

describe('grey card in the five spaces (guide §2.1, textbook §2.7)', () => {
  const g = fx.greyCard;
  for (const id of SPACE_IDS) {
    it(`${id}: 16-bit codes within ±${g.tolCodes16} of the guide's table`, () => {
      const got = codes(id, g.xyzD65);
      const want: number[] = id === 'adobe-rgb' ? g.spaces[id].u16Profile : g.spaces[id].u16;
      got.forEach((v, k) => expect(Math.abs(v - want[k]!), `${id}[${k}] ${v} vs ${want[k]}`).toBeLessThanOrEqual(g.tolCodes16));
      const S = outputSpace(id);
      const lin = mulMV(S.fromXYZ, adaptBradford(g.xyzD65, D65, S.white));
      lin.forEach((v, k) => expect(Math.abs(v - g.spaces[id].linear[k])).toBeLessThan(6e-5));
      const u8 = lin.map((v) => Math.round(S.encode(v) * 255));
      expect(u8).toEqual(g.spaces[id].u8);
    });
  }
  it('sRGB is #70757b', () => {
    const hex = '#' + codes('srgb', g.xyzD65).map((v) => Math.round(v / 257).toString(16).padStart(2, '0')).join('');
    expect(hex).toBe('#70757b');
  });
  it("Adobe RGB: the guide's 563/256 gamma differs from the embedded profile's 2.2 + toe by 8 codes, as recorded", () => {
    const got = codes('adobe-rgb', g.xyzD65);
    got.forEach((v, k) => expect(v - g.spaces['adobe-rgb'].u16[k]).toBe(8));
  });
  it("broken variant: the Studio's constant P3 matrix shifts P3 codes by more than 2", () => {
    const studio = codes('display-p3', g.xyzD65, fx.brokenP3Matrix.studioXyzToP3);
    const ours = codes('display-p3', g.xyzD65);
    expect(Math.max(...studio.map((v, k) => Math.abs(v - ours[k]!)))).toBeGreaterThan(2);
  });
});

describe('embedding', () => {
  const tiny = new Uint16Array([1000, 2000, 3000, 4000, 5000, 6000]);
  for (const id of SPACE_IDS) {
    it(`${id}: PNG colour chunks follow the policy table; iCCP inflates to the profile`, async () => {
      const s = getSpace(id);
      const sink = new MemorySink();
      const w = await Png16Writer.open(sink, { width: 2, height: 1, colour: pngColour(s, 'icc+cicp'), dpi: 300 });
      await w.writeRows(tiny, 1);
      await w.finish();
      const chunks = pngChunks(sink.bytes());
      const types = chunks.map((c) => c.type);
      expect(types.includes('sRGB') && types.includes('iCCP')).toBe(false);
      expect(types.includes('sRGB')).toBe(id === 'srgb');
      expect(types.includes('iCCP')).toBe(id !== 'srgb');
      expect(types.includes('cICP')).toBe(id === 'display-p3');
      if (id === 'display-p3') expect([...chunks.find((c) => c.type === 'cICP')!.data]).toEqual([12, 13, 0, 1]);
      if (id !== 'srgb') {
        const d = chunks.find((c) => c.type === 'iCCP')!.data;
        const nul = d.indexOf(0);
        expect(new TextDecoder('latin1').decode(d.subarray(0, nul))).toBe(s.label);
        expect(Buffer.from(await inflateAll(d.subarray(nul + 2))).equals(Buffer.from(s.icc))).toBe(true);
        expect(types.indexOf('iCCP')).toBeLessThan(types.indexOf('IDAT'));
      }
      expect(decodePngFast(sink.bytes()).width).toBe(2);
    });
    it(`${id}: TIFF tag 34675 holds the profile byte for byte`, async () => {
      const s = getSpace(id);
      const sink = new MemorySink();
      const w = await Tiff16Writer.open(sink, { width: 2, height: 1, compression: 'deflate', icc: s.icc });
      await w.writeRows(tiny, 1);
      await w.finish();
      const t = tiffTags(sink.bytes()).find((x) => x.tag === 34675)!;
      expect(t.type).toBe(7);
      expect(Buffer.from(t.value).equals(Buffer.from(s.icc))).toBe(true);
    });
  }
});

describe('lcms (lcms-wasm 1.0.5, Little CMS 2.16)', () => {
  it('reads the bundled profiles', async () => {
    const l = await createLcms();
    expect(l.version).toBe(2160);
    for (const id of SPACE_IDS) {
      const h = await l.open(getSpace(id).icc);
      const info = await l.info(h);
      expect(info.colourSpace).toBe('RGB');
      expect(info.description.length).toBeGreaterThan(2);
      await l.close(h);
    }
    l.dispose();
  });

  // guide §8: encoded test colours, read back through lcms with the embedded profile to D50 PCS XYZ and
  // adapted to D65, match the input within 2e-4
  it('round trip: 16-bit codes → lcms with the embedded profile → D50 XYZ → D65 matches the input within 2e-4', async () => {
    const l = await createLcms();
    const xyzP = await l.openXYZ();
    const colours: Vec3[] = [[0.1664, 0.1754, 0.2131], [0.4, 0.3, 0.2], [0.05, 0.06, 0.08], [0.6, 0.65, 0.7], [0.2, 0.35, 0.15], [0.01, 0.012, 0.015], [0.95047, 1, 1.08883]];
    for (const id of SPACE_IDS) {
      const S = outputSpace(id);
      const h = await l.open(getSpace(id).icc);
      const t = await l.transform(h, xyzP, { intent: 'relative', bpc: false, in: 'RGB_16', out: 'XYZ_FLT' });
      const px = new Uint16Array(colours.flatMap((X) => codes(id, X)));
      const out = (await l.run(t, px, colours.length)) as Float32Array;
      let worst = 0;
      colours.forEach((X, i) => {
        const back = adaptBradford([out[3 * i]!, out[3 * i + 1]!, out[3 * i + 2]!], PCS_D50, D65);
        // only in-gamut colours round-trip; all of these are inside every space
        worst = Math.max(worst, ...back.map((v, k) => Math.abs(v - X[k]!)));
      });
      expect(worst, `${id} worst ${worst}`).toBeLessThan(2e-4);
      await l.close(t);
      await l.close(h);
    }
    l.dispose();
  });
});

describe('printer-profile library', () => {
  it('imports the synthetic printer profile into OPFS by SHA-256, once; lcms opens it', async () => {
    const dir = memoryDir();
    const lib = await ProfileLibrary.open(dir);
    const l = await createLcms();
    const bytes = syntheticPrinterProfile();
    const e = await lib.import(bytes, { lcms: l });
    expect(e.class).toBe('prtr');
    expect(e.colourSpace).toBe('RGB');
    expect(e.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    await lib.import(bytes);
    expect((await lib.list()).length).toBe(1);
    expect(Buffer.from(await lib.get(e.sha256)).equals(Buffer.from(bytes))).toBe(true);
    await lib.remove(e.sha256);
    expect(await lib.list()).toEqual([]);
    l.dispose();
  });
  it('refuses a display profile (E_ICC_CLASS) and garbage (E_ICC_INVALID)', () => {
    expect(() => validatePrinterProfile(getSpace('display-p3').icc)).toThrow(/E_ICC_CLASS/);
    expect(() => validatePrinterProfile(new Uint8Array(500).fill(1))).toThrow(/E_ICC_INVALID/);
  });
});
