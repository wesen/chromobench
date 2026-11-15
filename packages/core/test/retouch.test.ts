// CHB-022 stage 7, contract 1.0: heal and clone in the reference engine. Planted spots on synthetic print-xyz frames:
// heal matches the surroundings (the seam correction is the disc's harmonic function), clone copies, the speck is
// gone, nothing outside a disc changes, spots apply in order; on scanner density the seam is additive; the engine
// through compile(document) equals the pure function, and a coalesced run equals its layers kept apart.
import { describe, expect, it } from 'vitest';
import { type Node } from '@chromobench/contract';
import { healCoefficients, healOffset, retouch, spotAlpha, type RepairMode, type Spot } from '../src/index.ts';
import { compiled, G, L, m1Engine, opsOf, pixels, push, spot as docSpot, spots, withEdits } from './doc-helpers.ts';

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
const spot = (o: Partial<Spot> = {}): Spot => ({ x: 30, y: 30, r: 6, src: { x: 60, y: 42 }, feather: 0, opacity: 1, ...o });

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

describe('heal and clone: the reference (core print/retouch.ts)', () => {
  const truth = field();
  const specked = field({ speck: { x: 30, y: 30, r: 3, k: 3 } });

  it('heal removes a planted speck and matches the surroundings to < 1 % (clone is off by the level ratio)', () => {
    const s = spot();
    const healed = retouch(specked, W, H, 3, [s], 'heal');
    const cloned = retouch(specked, W, H, 3, [s], 'clone');
    const h = ratios(healed, truth, s), c = ratios(cloned, truth, s);
    expect(h.max).toBeLessThan(0.01);
    expect(Math.abs(c.mean - 1)).toBeGreaterThan(0.05);
    expect(ratios(specked, truth, s).max).toBeGreaterThan(1.5);
  });

  it('nothing outside the target disc changes; heal with feather blends to the receiver at r', () => {
    const s = spot({ feather: 0.5 });
    const out = retouch(specked, W, H, 3, [s], 'heal');
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
    const s = spot({ r: 4 });
    const out = retouch(specked, W, H, 3, [s], 'clone');
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
    const s = spot();
    const out = retouch(dark, W, H, 3, [s], 'heal');
    expect(out.every((v) => Number.isFinite(v) && v > 0)).toBe(true);
    expect(ratios(out, dark, s).max).toBeLessThan(0.01);
  });

  it('spots apply in order, each reading the image as the spots before it left it; r ≤ 0 and opacity 0 change nothing', () => {
    const a = spot({ x: 20, y: 20, r: 4, src: { x: 40, y: 20 } });
    const b = spot({ x: 40, y: 20, r: 4, src: { x: 70, y: 30 } });
    const ab = retouch(specked, W, H, 3, [a, b], 'clone');
    const seq = retouch(retouch(specked, W, H, 3, [a], 'clone'), W, H, 3, [b], 'clone');
    expect(Array.from(ab)).toEqual(Array.from(seq));
    // b first moves (70, 30) to (40, 20); a then reads the moved pixels: the order matters when a source overlaps a target
    const ba = retouch(specked, W, H, 3, [b, a], 'clone');
    expect(ba[(20 * W + 20) * 3]).toBe(specked[(30 * W + 70) * 3]);
    expect(ab[(20 * W + 20) * 3]).toBe(specked[(20 * W + 40) * 3]);
    expect(Array.from(retouch(specked, W, H, 3, [spot({ opacity: 0 }), spot({ r: 0 })], 'heal'))).toEqual(Array.from(specked));
  });

  it('on scanner density the seam is additive: healing d equals healing the transmittance 10^−d multiplicatively', () => {
    const T = field({ speck: { x: 30, y: 30, r: 3, k: 0.2 } });
    const d = T.map((v) => -Math.log10(v));
    const s = spot({ feather: 0.4 });
    const viaT = retouch(T, W, H, 3, [s], 'heal', 'linear');
    const viaD = retouch(d, W, H, 3, [s], 'heal', 'log');
    let worst = 0;
    for (let i = 0; i < d.length; i++) worst = Math.max(worst, Math.abs(viaD[i]! - -Math.log10(viaT[i]!)));
    // the same seam up to where each encoding interpolates: the seam rings are sampled bilinearly (in T or in d) and
    // the soft edge mixes T or d, so inside r(1 − feather) they agree to the rings' interpolation (~1e-6 D)
    let inner = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (Math.hypot(x + 0.5 - s.x, y + 0.5 - s.y) > s.r * (1 - s.feather)) continue;
      for (let k = 0; k < 3; k++) inner = Math.max(inner, Math.abs(viaD[(y * W + x) * 3 + k]! + Math.log10(viaT[(y * W + x) * 3 + k]!)));
    }
    expect(inner).toBeLessThan(1e-5);
    expect(worst).toBeLessThan(0.05);
  });
});

describe('heal and clone in RefEngine through compile(document)', () => {
  async function setup(mode: RepairMode) {
    const { e, doc } = await m1Engine();
    const s1 = docSpot(40, 30, 5, { x: 60, y: 34 });
    const s2 = docSpot(20, 20, 3, { x: 40, y: 30 }, { opacity: 0.7 });
    return { e, doc, mode, s1, s2 };
  }

  it('equals retouch() on the print cut; no spots, a disabled layer or amount 0 → no node', async () => {
    const { e, doc, s1 } = await setup('heal');
    expect(opsOf(e, compiled(e, doc))).not.toContain('heal');
    const d1 = withEdits(doc, push('print', 'h1', L('heal', spots(['a', s1]))));
    const c = compiled(e, d1);
    const top = c.cuts.finished!;
    expect(top.op).toBe('heal');
    const [a, b] = [await pixels(e, c.cuts.print!), await pixels(e, top)];
    const info = c.cuts.print!.info as { width: number; height: number };
    const want = retouch(a, info.width, info.height, 3, [s1 as unknown as Spot], 'heal');
    expect(Array.from(b)).toEqual(Array.from(want));
    let changed = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) changed++;
    expect(changed).toBeGreaterThan(30);
    for (const off of [withEdits(doc, push('print', 'h1', L('heal', spots(['a', s1]), { enabled: false }))), withEdits(doc, push('print', 'h1', L('heal', spots(['a', s1]), { amount: 0 }))), withEdits(doc, push('print', 'h1', L('heal', spots())))]) {
      expect(compiled(e, off).display.id).toBe(compiled(e, doc).display.id);
    }
  });

  it('a run of one-spot heal layers (in a group) is one node equal to the layers kept apart; a clone ends the run', async () => {
    const { e, doc, s1, s2 } = await setup('heal');
    const run = withEdits(doc, push('print', 'g', G('Retouch', [['h1', L('heal', spots(['a', s1]))], ['h2', L('heal', spots(['b', s2]))], ['c1', L('clone', spots(['c', s2]), { amount: 0.5 })]])));
    const c = compiled(e, run);
    const ops = opsOf(e, c);
    expect(ops.filter((o) => o === 'heal')).toHaveLength(1);
    expect(ops.filter((o) => o === 'clone')).toHaveLength(1);
    expect(c.entries['h1']).toEqual(c.entries['h2']);
    // apart: a heal layer, then a masked-out separator would end the run; compare with retouch() of the two spots in order
    const p = await pixels(e, c.cuts.print!);
    const info = c.cuts.print!.info as { width: number; height: number };
    const heal = (c.entries['h1']![0]!);
    const want = retouch(retouch(p, info.width, info.height, 3, [s1 as unknown as Spot], 'heal'), info.width, info.height, 3, [s2 as unknown as Spot], 'heal');
    expect(Array.from(await pixels(e, e.graph.get(heal) as Node))).toEqual(Array.from(want));
  });

  it('in the scan stage heal works on scanner density (the seam is additive there)', async () => {
    const { e, doc, s1 } = await setup('heal');
    const c = compiled(e, withEdits(doc, push('scan', 'd1', L('heal', spots(['a', s1])))));
    const scan = c.cuts.scan!;
    expect(scan.op).toBe('heal');
    const src = e.graph.get(scan.inputs[0]!)!;
    const info = scan.info as { width: number; height: number; domain: string };
    expect(info.domain).toBe('scanner-density');
    const want = retouch(await pixels(e, src), info.width, info.height, 3, [s1 as unknown as Spot], 'heal', 'log');
    expect(Array.from(await pixels(e, scan))).toEqual(Array.from(want));
  });
});
