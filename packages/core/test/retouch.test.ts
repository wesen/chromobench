// CHB-022 stage 7: retouch.heal in the reference engine. Planted spots on synthetic print-xyz frames: heal
// matches the surroundings (the seam correction is the disc's harmonic function), clone copies, the speck is
// gone, nothing outside a disc changes; the engine through compile(recipe) equals the pure function.
import { describe, expect, it } from 'vitest';
import { compile, defaultRecipe, Graph, setPath, type FrameRecipe, type RetouchSpot } from '@chromobench/contract';
import { makeM1Tiff } from '@chromobench/engine-mock';
import { healCoefficients, healOffset, parseSpots, RefEngine, retouch, spotAlpha, spotOrder, type Spot } from '../src/index.ts';

const W = 96, H = 64;
const GAIN = [0.95, 1, 1.09];
/** smooth level A(x, y) per channel times a texture of period 6 in x and y */
function field(o: { level?: (x: number, y: number) => number; speck?: { x: number; y: number; r: number; k: number } } = {}): Float64Array {
  const level = o.level ?? ((x: number, y: number) => 0.2 + 0.15 * (x / W) + 0.05 * Math.sin(y / 30));
  const d = new Float64Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const tex = 1 + 0.06 * Math.sin((2 * Math.PI * x) / 6) * Math.cos((2 * Math.PI * y) / 6);
    const sp = o.speck && Math.hypot(x + 0.5 - o.speck.x, y + 0.5 - o.speck.y) < o.speck.r ? o.speck.k : 1;
    for (let k = 0; k < 3; k++) d[(y * W + x) * 3 + k] = level(x + 0.5, y + 0.5) * GAIN[k]! * tex * sp;
  }
  return d;
}
const spot = (o: Partial<Spot>): Spot => ({ id: 's1', mode: 'heal', x: 30, y: 30, r: 6, src: { x: 60, y: 42 }, feather: 0, opacity: 1, enabled: true, ...o });

function ratios(a: Float64Array, b: Float64Array, s: Spot): { max: number; mean: number } {
  let max = 0, sum = 0, n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (Math.hypot(x + 0.5 - s.x, y + 0.5 - s.y) >= s.r) continue;
    for (let k = 0; k < 3; k++) {
      const q = a[(y * W + x) * 3 + k]! / b[(y * W + x) * 3 + k]!;
      max = Math.max(max, Math.abs(q - 1));
      sum += q;
      n++;
    }
  }
  return { max, mean: sum / n };
}

describe('retouch.heal: the reference (core print/retouch.ts)', () => {
  const truth = field();
  const specked = field({ speck: { x: 30, y: 30, r: 3, k: 3 } });

  it('heal removes a planted speck and matches the surroundings to < 1 % (clone is off by the level ratio)', () => {
    const s = spot({});
    const healed = retouch(specked, W, H, 3, [s]);
    const cloned = retouch(specked, W, H, 3, [spot({ mode: 'clone' })]);
    const h = ratios(healed, truth, s), c = ratios(cloned, truth, s);
    expect(h.max).toBeLessThan(0.01);
    expect(Math.abs(c.mean - 1)).toBeGreaterThan(0.05);
    expect(ratios(specked, truth, s).max).toBeGreaterThan(1.5);
  });

  it('nothing outside the target disc changes; heal with feather blends to the receiver at r', () => {
    const s = spot({ feather: 0.5 });
    const out = retouch(specked, W, H, 3, [s]);
    let outside = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (Math.hypot(x + 0.5 - s.x, y + 0.5 - s.y) < s.r) continue;
      for (let k = 0; k < 3; k++) outside = Math.max(outside, Math.abs(out[(y * W + x) * 3 + k]! - specked[(y * W + x) * 3 + k]!));
    }
    expect(outside).toBe(0);
    expect(spotAlpha(6, 6, 0.5, 1)).toBe(0);
    expect(spotAlpha(3, 6, 0.5, 1)).toBe(1);
    expect(spotAlpha(4.5, 6, 0.5, 0.8)).toBeCloseTo(0.4, 12);
  });

  it('clone at an integer offset copies the source pixels exactly', () => {
    const s = spot({ mode: 'clone', r: 4 });
    const out = retouch(specked, W, H, 3, [s]);
    for (let y = 26; y < 34; y++) for (let x = 26; x < 34; x++) {
      if (Math.hypot(x + 0.5 - 30, y + 0.5 - 30) >= 4) continue;
      for (let k = 0; k < 3; k++) expect(out[(y * W + x) * 3 + k]).toBe(specked[((y + 12) * W + x + 30) * 3 + k]);
    }
  });

  it('the seam correction is harmonic: a boundary log-ratio linear in x is reproduced inside the disc (σ-factor: within 3 %)', () => {
    // log L = q·x²: log T(t + ρe) − log S(s + ρe) = q(t² − s²) + 2qρ(t − s)·cos θ, whose harmonic extension
    // is the plane q(t² − s²) + 2q(t − s)·dx (exact for the Poisson integral; σ_1 = sinc(1/9) damps the slope)
    const q = 2e-4;
    const lin = field({ level: (x) => 0.1 * Math.exp(q * x * x) });
    const at = (x: number, y: number, k: number) => lin[(y * W + x) * 3 + k]! / GAIN[k]!;
    const s = spot({ x: 30, y: 30, src: { x: 54, y: 30 } });
    const c = healCoefficients(at, W, H, s, 3);
    expect(c[0]).toBeCloseTo(q * (30 * 30 - 54 * 54), 2);
    const slope = (healOffset(c, 3, 0, 4, 0, s.r) - healOffset(c, 3, 0, -4, 0, s.r)) / 8;
    const sigma1 = Math.sin(Math.PI / 9) / (Math.PI / 9);
    expect(slope / (2 * q * (30 - 54) * sigma1)).toBeGreaterThan(0.97);
    expect(slope / (2 * q * (30 - 54) * sigma1)).toBeLessThan(1.03);
    // no y-dependence
    expect(Math.abs(healOffset(c, 3, 0, 0, 4, s.r) - healOffset(c, 3, 0, 0, -4, s.r))).toBeLessThan(1e-3);
  });

  it('works near paper black (Y ≈ 0.003): positive, finite, matched', () => {
    const dark = field({ level: (x) => 0.003 + 0.002 * (x / W) });
    const s = spot({});
    const out = retouch(dark, W, H, 3, [s]);
    expect(out.every((v) => Number.isFinite(v) && v > 0)).toBe(true);
    expect(ratios(out, dark, s).max).toBeLessThan(0.01);
  });

  it('every source is read from the receiver: the order of overlapping-source spots does not matter, ids sort naturally', () => {
    const a = spot({ id: 's1', mode: 'clone', x: 20, y: 20, r: 4, src: { x: 40, y: 20 } });
    const b = spot({ id: 's2', mode: 'clone', x: 40, y: 20, r: 4, src: { x: 70, y: 30 } });
    const ab = retouch(specked, W, H, 3, [a, b]);
    const ba = retouch(specked, W, H, 3, [b, a]);
    expect(Array.from(ab)).toEqual(Array.from(ba));
    expect(['s10', 's2', 's1'].sort(spotOrder)).toEqual(['s1', 's2', 's10']);
    const rec: Record<string, RetouchSpot> = { s10: { ...a, enabled: true }, s2: { ...a, enabled: false }, s3: { ...a, opacity: 0 }, s1: a };
    expect(parseSpots(JSON.stringify(rec)).map((x) => x.id)).toEqual(['s1', 's10']);
  });
});

describe('retouch.heal in RefEngine through compile(recipe)', () => {
  it('equals retouch() on the view.adapt image; no spots → no node; disabled spots → no node', async () => {
    const e = new RefEngine();
    const info = await e.open({ kind: 'file', sha256: '', bytes: makeM1Tiff() });
    let r: FrameRecipe = defaultRecipe('negative-scan', { sha256: info.sha256, name: 'm1' });
    const g = new Graph();
    g.registerSource(info);
    const plain = compile(r, g);
    expect(g.closure(plain.id).some((d) => d.op === 'retouch.heal')).toBe(false);
    const sp: RetouchSpot = { mode: 'heal', x: 40, y: 30, r: 5, src: { x: 60, y: 34 }, feather: 0.3, opacity: 1, enabled: true };
    r = setPath(r, 'retouch.spots', { s1: sp, s2: { ...sp, enabled: false } });
    const top = compile(r, g);
    const heal = g.closure(top.id).find((d) => d.op === 'retouch.heal')!;
    expect(JSON.parse(heal.args['spots'] as string)).toEqual({ s1: sp });
    const healNode = g.intern(heal.op, heal.inputs, heal.args).node;
    const adapt = g.get(healNode.inputs[0]!)!;
    e.adopt(g.closure(healNode.id));
    const [a, b] = [await (await e.evaluate(adapt, { scale: 'full', precision: 'export' })).read(), await (await e.evaluate(healNode, { scale: 'full', precision: 'export' })).read()];
    const want = retouch(Float64Array.from(a), adapt.info.kind === 'Image' ? adapt.info.width : 0, adapt.info.kind === 'Image' ? adapt.info.height : 0, 3, parseSpots(heal.args['spots'] as string));
    expect(Array.from(b)).toEqual(Array.from(want));
    let changed = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) changed++;
    expect(changed).toBeGreaterThan(30);
    const off = compile(setPath(r, 'retouch.spots', { s1: { ...sp, enabled: false } }), g);
    expect(g.closure(off.id).some((d) => d.op === 'retouch.heal')).toBe(false);
  });
});
