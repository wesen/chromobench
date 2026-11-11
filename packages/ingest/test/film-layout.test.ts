// CHB-020 roll setup: the film layout of a scan (holder veil, open gate, image area, rebate) and the roll's
// base, on planted strips (truth known) and on the Gold 200 sample (CHB-006 goldens).
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Box, Vec3 } from '@chromobench/contract';
import {
  filmLayout, frameBaseOf, openSourceSync, orientedToSensorBox, plantedStrip, rebateFromBox, region, rollBase, subtractVeil,
  type FilmLayout, type PlantedStrip,
} from '@chromobench/ingest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const golden = JSON.parse(readFileSync(`${root}fixtures/golden/ingest-gold200.json`, 'utf8'));
const c1 = readdirSync(`${root}ttmp/2026/11/11`).find((d) => d.startsWith('CHB-001--'))!;
const SAMPLE = `${root}ttmp/2026/11/11/${c1}/sources/chromogen-studio-1.2/samples/gold200.png`;

const dD = (a: readonly number[], b: readonly number[]): number => Math.max(...a.map((t, k) => Math.abs(Math.log10(t / b[k]!))));
const inside = (a: Box, b: Box): boolean => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
const overlap = (a: Box, b: Box): number => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return (ix * iy) / (a.w * a.h);
};
/** The rule scan.density uses without a box (core's rebateBox): the brightest 5 % of columns. */
function brightestColumnsT(p: PlantedStrip): Vec3 {
  const { w, h, rgb } = p;
  const cols = Array.from({ length: w }, (_, x) => {
    let s = 0;
    for (let y = 0; y < h; y++) for (let k = 0; k < 3; k++) s += rgb[(y * w + x) * 3 + k]!;
    return { x, s };
  }).sort((a, b) => b.s - a.s).slice(0, Math.round(w * 0.05)).map((c) => c.x);
  const x0 = Math.min(...cols), x1 = Math.max(...cols);
  const T = [0, 0, 0];
  for (let y = 0; y < h; y++) for (let x = x0; x <= x1; x++) for (let k = 0; k < 3; k++) T[k]! += rgb[(y * w + x) * 3 + k]!;
  return T.map((t) => t / (h * (x1 - x0 + 1))) as Vec3;
}

describe('film layout on a planted 135 strip in its holder', () => {
  let p: PlantedStrip;
  let l: FilmLayout;
  beforeAll(() => {
    p = plantedStrip({ pxPerMm: 7, seed: 3 });
    l = filmLayout(p.rgb, p.w, p.h);
  });
  it('reads the veil on the holder and the flare as a fraction of the open gate', () => {
    expect(l.surround).not.toBeNull();
    expect(dD(l.surround!.L, p.truth.veil)).toBeLessThan(0.01);
    expect(l.openGate).not.toBeNull();
    expect(dD(l.openGate!.T, p.truth.openT.map((t, k) => t + p.truth.veil[k]!))).toBeLessThan(0.002);
    for (const f of l.flare!) expect(Math.abs(f - p.truth.flare)).toBeLessThan(0.0002);
    expect(l.notes).toEqual([]);
  });
  it('finds the image area and the rebate on the film edge, not the sprocket holes', () => {
    const c = l.crop!;
    for (const k of ['x', 'y', 'w', 'h'] as const) expect(Math.abs(c[k] - p.truth.crop[k])).toBeLessThanOrEqual(2);
    expect(l.rebate!.from).toBe('edge');
    expect(l.rebate!.confidence).toBeGreaterThanOrEqual(0.5);
    expect(p.truth.holes.some((b) => overlap(l.rebate!.box, b) > 0)).toBe(false);
    expect(dD(l.rebate!.T, p.truth.baseT)).toBeLessThan(0.002);
  });
  it('without the veil correction the base reads 0.01–0.03 D thin (the error it removes)', () => {
    const e = dD(l.rebate!.Traw, p.truth.baseT);
    expect(e).toBeGreaterThan(0.01);
    expect(e).toBeLessThan(0.03);
  });
  it('the brightest-columns rule takes the sprocket holes for the base (the demo bug)', () => {
    const T = brightestColumnsT(p);
    expect(dD(T, p.truth.baseT)).toBeGreaterThan(0.25);
  });
  it('subtractVeil makes the holder read ~0 and the rebate read the planted base', () => {
    const rgb = Float32Array.from(p.rgb);
    subtractVeil(rgb, l.surround!.L);
    const again = filmLayout(rgb, p.w, p.h);
    expect(dD(again.rebate!.T, p.truth.baseT)).toBeLessThan(0.002);
    expect(Math.max(...again.surround!.L)).toBeLessThan(2e-4);
  });
});

describe('film layout without holder, holes or rebate', () => {
  it('no holder, no holes: the base includes the (unmeasurable) veil and says so', () => {
    const p = plantedStrip({ pxPerMm: 7, holes: false, holder: false });
    const l = filmLayout(p.rgb, p.w, p.h);
    expect(l.notes.map((n) => n.code).sort()).toEqual(['W_NO_OPEN_GATE', 'W_NO_SURROUND']);
    expect(l.rebate!.from).toBe('edge');
    expect(dD(l.rebate!.T, p.truth.baseT.map((t, k) => t + p.truth.veil[k]!))).toBeLessThan(0.002);
  });
  it('a cropped (lab) scan: blank film inside the frame, low confidence, no false holder', () => {
    const p = plantedStrip({ pxPerMm: 7, seed: 5 });
    const c = p.truth.crop;
    const rgb = new Float32Array(c.w * c.h * 3);
    for (let y = 0; y < c.h; y++) rgb.set(p.rgb.subarray(((c.y + y) * p.w + c.x) * 3, ((c.y + y) * p.w + c.x + c.w) * 3), y * c.w * 3);
    const l = filmLayout(rgb, c.w, c.h);
    expect(l.surround).toBeNull();
    expect(l.rebate!.from).toBe('blank');
    expect(l.rebate!.confidence).toBeLessThanOrEqual(0.3);
    expect(l.notes.map((n) => n.code)).toContain('W_REBATE_BLANK');
    // the planted shadow patch is blank film: base + veil within noise
    expect(dD(l.rebate!.T, p.truth.baseT.map((t, k) => t + p.truth.veil[k]!))).toBeLessThan(0.01);
  });
});

describe('film layout on the Gold 200 sample', () => {
  let l: FilmLayout;
  let picked: Box;
  let Treb: Vec3;
  beforeAll(() => {
    const src = openSourceSync(new Uint8Array(readFileSync(SAMPLE)), { options: { levels: golden.decode.levels } });
    const [rx, ry, rw, rh] = golden.oriented.rebate;
    picked = orientedToSensorBox('flipH', { x: rx, y: ry, w: rw, h: rh }, 1292, 863);
    Treb = rebateFromBox(src.linear, picked, { orientation: 'flipH' }).T;
    const full = region(src.linear, { x: 0, y: 0, w: 1292, h: 863 }, 1292, 863, { channels: 3 });
    l = filmLayout(full, 1292, 863);
  });
  it('finds the rebate strip inside the picked box, within 0.005 D of the golden T_reb', () => {
    expect(l.rebate!.from).toBe('edge');
    expect(inside(l.rebate!.box, picked)).toBe(true);
    expect(dD(l.rebate!.T, golden.rebateT.value)).toBeLessThan(0.005);
    expect(dD(l.rebate!.T, Treb)).toBeLessThan(0.005);
  });
  it('reads the holder: a veil below 0.1 % of the base, no open gate (W_NO_OPEN_GATE, as CHB-006 §6 says)', () => {
    expect(l.surround).not.toBeNull();
    expect(l.surround!.fraction).toBeGreaterThan(0.1);
    for (const v of l.veilOfBase!) expect(v).toBeLessThan(0.001);
    expect(l.openGate).toBeNull();
    expect(l.flare).toBeNull();
    expect(l.notes.map((n) => n.code)).toEqual(['W_NO_OPEN_GATE']);
  });
  it('the image area covers the picked crop to within 30 px', () => {
    const c = l.crop!;
    const g = golden.sensor.crop;
    expect(Math.abs(c.x - g.x)).toBeLessThan(30);
    expect(Math.abs(c.y - g.y)).toBeLessThan(30);
    expect(Math.abs(c.x + c.w - (g.x + g.w))).toBeLessThan(40);
    expect(Math.abs(c.y + c.h - (g.y + g.h))).toBeLessThan(30);
  });
});

describe('roll base (guide §4.2, §11)', () => {
  const offsets = [0, 0.002, 0.004, 0.006, 0.008, 0.01, 0.001, 0.003, 0.005, 0.007, 0.04, 0.009];
  const roll = (offs: number[]): { layouts: FilmLayout[]; strips: PlantedStrip[] } => {
    const strips = offs.map((o, i) => plantedStrip({ pxPerMm: 5, seed: 11 + i, scene: i, baseOffsetD: o, exposureD: 0.3 * Math.sin(i), sigma: [0.006, 0.005, 0.008] }));
    return { strips, layouts: strips.map((s) => filmLayout(s.rgb, s.w, s.h)) };
  };
  let r: ReturnType<typeof roll>;
  beforeAll(() => {
    r = roll(offsets);
  });
  it('recovers the planted base within 0.005 D and flags exactly the mixed frame', () => {
    const rb = rollBase(r.layouts.map((l, i) => frameBaseOf(`f${i}`, l)));
    const truth = r.strips[0]!.truth.baseT;
    expect(rb.used.length).toBe(12);
    expect(dD(rb.T!, truth.map((t) => t * 10 ** -0.005))).toBeLessThan(0.005);
    expect(rb.mixed).toEqual(['f10']);
    expect(rb.notes.map((n) => n.code)).toEqual(['W_ROLL_MIXED']);
    expect(rb.spreadD).toBeGreaterThan(0.03);
    expect(rb.veilFrames).toBe(12);
    expect(dD(rb.veil!, r.strips[0]!.truth.veil)).toBeLessThan(0.01);
    for (const f of rb.flare!) expect(Math.abs(f - 0.004)).toBeLessThan(0.0002);
    // absolute base density through the open gate: the planted Gold 200 base (+ the median offset)
    expect(dD(rb.absD!.map((d) => 10 ** -d), [0.282, 0.643, 0.84].map((d) => 10 ** -(d + 0.005)))).toBeLessThan(0.005);
  });
  it('without the mixed frame no warning fires, and the spread is the roll\'s', () => {
    const rb = rollBase(r.layouts.filter((_, i) => i !== 10).map((l, i) => frameBaseOf(`f${i}`, l)));
    expect(rb.mixed).toEqual([]);
    expect(rb.notes).toEqual([]);
    expect(rb.spreadD).toBeLessThan(0.008);
  });
  it('only weak (blank-film) estimates: a median with W_ROLL_BASE_WEAK', () => {
    const rb = rollBase([{ id: 'a', T: [0.5, 0.2, 0.1], confidence: 0.2, veil: null, openGate: null }, { id: 'b', T: [0.51, 0.2, 0.1], confidence: 0.1, veil: null, openGate: null }]);
    expect(rb.notes.map((n) => n.code)).toEqual(['W_ROLL_BASE_WEAK']);
    expect(rb.T).not.toBeNull();
    expect(rb.absD).toBeNull();
  });
});
