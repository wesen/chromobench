// CHB-037 P3 (node, no device): the GPU's plan of print.combine replays to the contract's lightH, the fused form is
// lightH where it applies, the planner's barrier rule, the blur's field compensation and the heal's predecessors.
import { describe, expect, it } from 'vitest';
import { lightH, type LightSample, type Node } from '@chromobench/contract';
import { combineIsPointwise, lightPasses, lightPointwise, replayPasses, type CombineArgs, type LightContext } from '../src/engine/light.ts';
import { isBarrier, readsOf } from '../src/engine/dag.ts';
import { fieldSigma } from '../src/engine/textures.ts';
import { priorSpots, type RepairSpot } from '../src/retouch.ts';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

type Role = CombineArgs['terms'][number]['role'];
const ROLES: Role[] = ['burn', 'dodge', 'flash-base', 'flash-open'];

/** A random print.combine with images and masks named by id, and a pixel of values for each. */
function randomCase(r: () => number, textureFree = false) {
  const n = (k: number) => Math.floor(r() * k);
  const x: Record<string, number[]> = {};
  const m: Record<string, number> = {};
  const ratio: Record<string, number> = {};
  const xMain = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1];
  const mask = (): string | undefined => {
    if (textureFree || r() < 0.4) return undefined;
    const id = `m${Object.keys(m).length}`;
    m[id] = r() < 0.2 ? 1 : r();
    return id;
  };
  const terms = Array.from({ length: n(6) }, (_, i) => {
    const role = textureFree ? (r() < 0.5 ? 'flash-base' : 'flash-open') : ROLES[n(4)]!;
    const id = `t${i}`;
    // a term's light below the main's, as the contract's property test draws it (the dodge clamp rarely engages)
    x[id] = xMain.map((v) => v + (role.startsWith('flash') ? -1.5 : -0.4 - 2 * r()));
    ratio[id] = r() < 0.5 ? 1 : 0.2 + r();
    const mk = mask();
    return { role, image: id, amount: r() * 2, ...(mk ? { mask: mk } : {}) };
  });
  const densities = textureFree ? [] : Array.from({ length: n(3) }, (_, i) => {
    x[`d${i}`] = [r() * 0.5, 0, 0];
    const mk = mask();
    return { image: `d${i}`, amount: r(), ...(mk ? { mask: mk } : {}) };
  });
  const filters = Array.from({ length: n(3) }, () => {
    const mk = mask();
    return { logH: [r() - 0.5, r() - 0.5, r() - 0.5], amount: r() * 2, ...(mk ? { mask: mk } : {}) };
  });
  const preflash = Array.from({ length: n(2) }, () => {
    const mk = mask();
    return { fraction: r() * 0.05, amount: r(), ...(mk ? { mask: mk } : {}) };
  });
  const mm = mask();
  const c: CombineArgs = { mainAmount: 0.2 + r() * 1.5, ...(mm ? { mainMask: mm } : {}), terms, densities, filters, preflash };
  const lc: LightContext = { ratio: (id) => ratio[id]!, flashX: (id) => x[id]! };
  const cov = (id: string | undefined) => (id === undefined ? 1 : m[id]!);
  const sample: LightSample = {
    xMain, wMain: c.mainAmount * cov(c.mainMask),
    terms: terms.map((t) => ({ role: t.role, x: x[t.image]!, w: t.amount * cov(t.mask) * ratio[t.image]! })),
    densities: densities.map((d) => ({ d: x[d.image]![0]!, w: d.amount * cov(d.mask) })),
    filters: filters.map((f) => ({ logH: f.logH, w: f.amount * cov(f.mask) })),
    preflash: preflash.map((p) => ({ fraction: p.fraction, w: p.amount * cov(p.mask) })),
  };
  return { c, lc, x, m, xMain, sample };
}

describe('print.combine on the GPU is the contract\'s lightH', () => {
  it('the barrier passes, replayed in f64, equal lightH on random stacks of every kind (n = 400)', () => {
    const r = rng(7);
    let worst = 0, n = 0;
    for (let i = 0; i < 400; i++) {
      const { c, lc, x, m, xMain, sample } = randomCase(r);
      const want = [0, 0, 0], got = [0, 0, 0];
      lightH(sample, want);
      replayPasses(lightPasses(c, lc), xMain, (id) => x[id]!, (id) => m[id]!, got);
      for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(got[k]! - want[k]!));
      n++;
    }
    expect(n).toBe(400);
    expect(worst).toBeLessThan(1e-12);
  });

  it('the dodge clamp: a dodge of more than the main light leaves paper white, then the burns add', () => {
    const c: CombineArgs = { mainAmount: 1, terms: [{ role: 'dodge', image: 'a', amount: 1 }, { role: 'burn', image: 'b', amount: 1 }], densities: [], filters: [], preflash: [] };
    const lc: LightContext = { ratio: () => 1, flashX: () => [0, 0, 0] };
    const got = [0, 0, 0];
    replayPasses(lightPasses(c, lc), [0, 0, 0], (id) => (id === 'a' ? [1, 1, 1] : [-1, -1, -1]), () => 1, got);
    for (const v of got) expect(v).toBeCloseTo(-1, 12); // max(1 − 10, 0) + 0.1
  });

  it('the fused form (no texture terms, no masks) equals lightH; the additive form is x + Σ a·logH + log10 w_main', () => {
    const r = rng(11);
    for (let i = 0; i < 200; i++) {
      const { c, lc, xMain, sample } = randomCase(r, true);
      expect(combineIsPointwise(c)).toBe(true);
      const lp = lightPointwise(c, lc);
      const want = [0, 0, 0];
      lightH(sample, want);
      for (let k = 0; k < 3; k++) {
        const got = lp.additive ? Math.max(xMain[k]! + lp.logGain[k]!, -8) : Math.log10(Math.max(lp.gain[k]! * 10 ** xMain[k]! + lp.offset[k]!, 1e-8));
        expect(got).toBeCloseTo(want[k]!, 11);
      }
      expect(lp.additive).toBe(c.terms.length === 0 && c.preflash.every((p) => p.amount * p.fraction === 0));
    }
  });

  it('a masked entry, a burn, a dodge or a density mask makes it a barrier', () => {
    const base: CombineArgs = { mainAmount: 1, terms: [], densities: [], filters: [{ logH: [0.1, 0, 0], amount: 1 }], preflash: [] };
    expect(combineIsPointwise(base)).toBe(true);
    expect(combineIsPointwise({ ...base, mainMask: 'm' })).toBe(false);
    expect(combineIsPointwise({ ...base, filters: [{ logH: [0.1, 0, 0], amount: 1, mask: 'm' }] })).toBe(false);
    expect(combineIsPointwise({ ...base, terms: [{ role: 'burn', image: 'b', amount: 1 }] })).toBe(false);
    expect(combineIsPointwise({ ...base, terms: [{ role: 'flash-open', image: 'f', amount: 1 }] })).toBe(true);
    expect(combineIsPointwise({ ...base, densities: [{ image: 'd', amount: 1 }] })).toBe(false);
  });
});

describe('the planner', () => {
  const node = (op: string, inputs: string[], args: Record<string, unknown>): Node => ({ id: `${op}#${inputs.join(',')}`, op, inputs, args, info: { kind: 'Image', domain: 'paper-logH', width: 4, height: 4, channels: 3, umPerPx: {} } });
  it('a fused print.combine reads its receiver only; a barrier one every texture but the flashes', () => {
    const fused = node('print.combine', ['x', 'f'], { mainAmount: 1, terms: [{ role: 'flash-base', image: 'f', amount: 1 }], densities: [], filters: [], preflash: [] });
    expect(isBarrier(fused)).toBe(false);
    expect(readsOf(fused)).toEqual(['x']);
    const bar = node('print.combine', ['x', 'b', 'm', 'f', 'd'], { mainAmount: 1, terms: [{ role: 'burn', image: 'b', amount: 1, mask: 'm' }, { role: 'flash-open', image: 'f', amount: 1 }], densities: [{ image: 'd', amount: 1 }], filters: [], preflash: [] });
    expect(isBarrier(bar)).toBe(true);
    expect(readsOf(bar)).toEqual(['x', 'b', 'm', 'd']);
  });
  it('generators read nothing; composite.mix, mask.combine, heal, clone and clarity are barriers', () => {
    expect(readsOf(node('mask.constant', ['s'], { value: 1 }))).toEqual([]);
    expect(readsOf(node('mask.linear', ['s'], {}))).toEqual([]);
    for (const op of ['composite.mix', 'mask.combine', 'heal', 'clone', 'clarity', 'mask.feather']) expect(isBarrier(node(op, ['a'], {})), op).toBe(true);
    for (const op of ['mask.invert', 'mask.luminance', 'print.expose']) expect(isBarrier(node(op, ['a'], {})), op).toBe(false);
  });
});

describe('wide blurs and sequential spots', () => {
  it('the field blur, with the box average and the bilinear read back, adds up to σ²', () => {
    for (const [sigma, s] of [[40, 2], [94, 3], [208, 7]] as const) {
      const fs = fieldSigma(sigma, s);
      expect(fs).toBeLessThanOrEqual(32);
      expect((fs * s) ** 2 + (s * s - 1) / 12 + (s * s) / 6).toBeCloseTo(sigma * sigma, 9);
    }
  });
  it('a spot reads the earlier spots whose targets meet its window, and only those', () => {
    const sp = (x: number, y: number, r = 3): RepairSpot => ({ x, y, r, src: { x: 0, y: 0 }, feather: 0, opacity: 1 });
    const spots = [sp(10, 10), sp(40, 40), sp(12, 30)];
    expect(priorSpots(spots, 2, { x: 5, y: 5, w: 10, h: 10 })).toEqual([0]);
    expect(priorSpots(spots, 0, { x: 5, y: 5, w: 10, h: 10 })).toEqual([]);
    expect(priorSpots(spots, 3, { x: 0, y: 0, w: 50, h: 50 })).toEqual([0, 1, 2]);
    expect(priorSpots(spots, 3, { x: 20, y: 0, w: 5, h: 5 })).toEqual([]);
  });
});
