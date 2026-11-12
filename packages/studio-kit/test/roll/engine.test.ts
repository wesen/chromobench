// CHB-020 stages 1–2 (guide §11): roll analysis on a planted roll through MockEngine, the first print and
// "print the roll like this frame" as mutation batches, their laws (match law, one undo restores every frame,
// stale frames are reported, hand-edited frames are skipped), divergence, and the Gold 200 numbers with their scale.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { canonicalJSON, compile, defaultRecipe, Graph, type Box, type FrameRecipe, type Vec3 } from '@chromobench/contract';
import { openSourceSync, orientedToSensorBox, region } from '@chromobench/ingest';
import { integrateToGrey, Lights, nodePacksData, RefEngine } from '@chromobench/core';
import {
  analysePixels, analyseRoll, divergence, firstPrintBatch, fragmentOf, matchBatch, newRoll, previewOf, rollTotals, splitTotal, totalOf,
  type FrameAnalysis, type Roll, type RollAnalysis,
} from '../../kits/roll/src/index.ts';
import { OFFSETS, openRoll, physics, tiffOf, type RollStudio } from './fixtures.ts';

const dD = (a: readonly number[], b: readonly number[]): number => Math.max(...a.map((t, k) => Math.abs(Math.log10(t / b[k]!))));
const overlap = (a: Box, b: Box): number => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return ix * iy;
};
const entriesOf = (r: RollStudio) => r.ids.map((id) => {
  const e = r.studio.frames.get(id)!;
  return { id, sha256: e.sha, graph: e.graph, recipe: e.log.committed };
});

describe('roll analysis of a planted 12-frame roll (stage 1)', () => {
  let r: RollStudio;
  let a: RollAnalysis;
  beforeAll(async () => {
    r = await openRoll(OFFSETS);
    a = await analyseRoll(r.studio.engine, entriesOf(r), physics(), { now: () => 1 });
  }, 60_000);
  it('recovers the planted base within 0.005 D (median offset 0.005 D) and flags exactly the mixed frame', () => {
    const truth = r.strips[0]!.truth.baseT.map((t) => t * 10 ** -0.005);
    expect(a.base.used.length).toBe(12);
    expect(dD(a.base.T!, truth)).toBeLessThan(0.005);
    expect(a.base.mixed).toEqual([r.ids[10]]);
    expect(a.diagnostics.map((d) => d.code)).toContain('W_ROLL_MIXED');
  });
  it('reads the veil on the holder and the flare against the sprocket holes', () => {
    expect(a.base.veilFrames).toBe(12);
    expect(dD(a.base.veil!, r.strips[0]!.truth.veil)).toBeLessThan(0.02);
    for (const f of a.base.flare!) expect(Math.abs(f - 0.004)).toBeLessThan(0.0003);
  });
  it('ranks Gold 200 first through the open gate, C200 too close to call (W_ROLL_STOCK_AMBIGUOUS)', () => {
    expect(a.ranking!.slice(0, 2).map((x) => x.stock)).toEqual(['kodak_gold_200', 'fujifilm_c200']);
    expect(a.diagnostics.map((d) => d.code)).toContain('W_ROLL_STOCK_AMBIGUOUS');
    expect(a.ranking!.find((x) => x.stock === 'kodak_portra_400')!.maxDiffD).toBeGreaterThan(a.ranking![0]!.maxDiffD + 0.05);
  });
  it('every frame: an edge rebate box clear of the sprocket holes, σ and class shares with their size', () => {
    for (const [i, id] of r.ids.entries()) {
      const fa = a.frames[id]!;
      expect(fa.layout.rebate!.from).toBe('edge');
      expect(r.strips[i]!.truth.holes.every((h) => overlap(fa.layout.rebate!.box, h) === 0)).toBe(true);
      expect(r.strips[i]!.truth.rebate.some((b) => overlap(fa.layout.rebate!.box, b) > 0)).toBe(true);
      expect(fa.size[0]).toBeGreaterThan(100);
      expect(fa.scale).toBe(1);
      fa.sigma!.forEach((s, k) => expect(s).toBeGreaterThan([0.005, 0.004, 0.006][k]! * 0.6));
      expect(fa.classes!.blank + fa.classes!.below + fa.classes!.above).toBeCloseTo(1, 9);
    }
  });
  it('the frames\' own departures follow the planted exposure (denser frames need more light)', () => {
    const m = (v: Vec3): number => (v[0] + v[1] + v[2]) / 3;
    const planted = r.ids.map((_, i) => 0.35 * Math.sin(1.7 * i));
    const got = r.ids.map((id) => m(a.frames[id]!.latd));
    // the planted exposure offsets explain the measured departures (scenes differ, so not exactly)
    const mean = (xs: number[]): number => xs.reduce((p, q) => p + q, 0) / xs.length;
    const mp = mean(planted), mg = mean(got);
    const cov = planted.reduce((p, x, i) => p + (x - mp) * (got[i]! - mg), 0);
    const corr = cov / Math.sqrt(planted.reduce((p, x) => p + (x - mp) ** 2, 0) * got.reduce((p, x) => p + (x - mg) ** 2, 0));
    expect(corr).toBeGreaterThan(0.9);
    expect(a.rollMean).not.toBeNull();
  });
});

describe('first print and match as batches (stage 2)', () => {
  let r: RollStudio;
  let roll: Roll;
  const recipeOf = (f: string): FrameRecipe | undefined => r.studio.frames.get(f)?.log.committed;
  beforeAll(async () => {
    r = await openRoll(OFFSETS.slice(0, 6));
    const a = await analyseRoll(r.studio.engine, entriesOf(r), physics(), { now: () => 1 });
    roll = { ...newRoll('roll-1', 'test', r.ids, { ...fragmentOf(recipeOf(r.ids[0]!)!), 'print.enlarger.mode': 'real' }), analysis: a };
  }, 60_000);

  it('the first print writes the rebate box, a real enlarger, time and lights, auto = roll; the base is the film edge, not the holes', async () => {
    const b = firstPrintBatch(roll, recipeOf);
    expect(b.by).toBe('auto');
    expect(b.frames.length).toBe(6);
    r.studio.route.applyBatch(b.frames, b.label, { by: 'auto', tx: b.id });
    const after = recipeOf(r.ids[0]!)!;
    expect(after.print.lights.auto.method).toBe('roll');
    expect(after.print.enlarger.mode).toBe('real');
    expect(after.scan!.rebate).not.toBeNull();
    // on core's reference engine: scan.density with no box takes the brightest 5 % of columns (through the
    // sprocket holes), so the rebate reads as image density; with the roll's box it is the zero of density
    const ref = new RefEngine({ data: nodePacksData() });
    const info = await ref.open({ kind: 'file', sha256: r.studio.frames.get(r.ids[0]!)!.sha, name: 'f.tif', bytes: tiffOf(r.strips[0]!) });
    const g = new Graph();
    g.registerSource(info);
    const densityAt = async (rec: FrameRecipe, box: Box): Promise<Vec3> => {
      const def = g.closure(compile(rec, g).id).find((d) => d.op === 'scan.density')!;
      const n = g.adopt([def])[0]!;
      ref.adopt(g.closure(n.id));
      const res = await ref.evaluate(n, { scale: 'full', precision: 'preview', region: box });
      const px = await res.read();
      const acc = [0, 0, 0];
      for (let i = 0; i < res.width * res.height; i++) for (let k = 0; k < 3; k++) acc[k]! += Number(px[i * res.info.channels + k]);
      return acc.map((v) => v / (res.width * res.height)) as Vec3;
    };
    const band = r.strips[0]!.truth.rebate[0]!;
    const probe = { x: band.x + 10, y: band.y + 1, w: 20, h: Math.max(1, band.h - 2) };
    const before = await densityAt(r.studio.frames.get(r.ids[0]!)!.initial, probe);
    expect(Math.max(...before.map(Math.abs))).toBeGreaterThan(0.1);
    const d = await densityAt(after, probe);
    for (const v of d) expect(Math.abs(v)).toBeLessThan(0.005);
    // the log: one 'auto' unit "First print" per frame, under one tx
    for (const id of r.ids) {
      const log = r.studio.frames.get(id)!.log;
      expect(log.units.map((u) => u.label)).toEqual(['First print']);
      expect(log.inEffect().every((x) => x.by === 'auto' && x.tx === b.id)).toBe(true);
    }
  });

  it('roll totals: density per frame in full; colour shares r of the roll mean (r = 1: one colour for the roll)', () => {
    const t1 = rollTotals(roll, { consistency: 1 });
    const colour = (v: Vec3): Vec3 => v.map((x) => x - (v[0] + v[1] + v[2]) / 3) as Vec3;
    const c0 = colour(t1.get(r.ids[0]!)!);
    for (const id of r.ids) colour(t1.get(id)!).forEach((x, k) => expect(x).toBeCloseTo(c0[k]!, 9));
    const t0 = rollTotals(roll, { consistency: 0 });
    for (const id of r.ids) t0.get(id)!.forEach((x, k) => expect(x).toBeCloseTo(roll.analysis!.frames[id]!.auto[k]!, 9));
  });

  it('a total goes back as time on the 1/6-stop grid plus lights, exactly', () => {
    const total: Vec3 = [0.137, 0.08, -0.02];
    const s = splitTotal(total);
    expect(Math.log2(s.time_s / 10) * 6).toBeCloseTo(Math.round(Math.log2(s.time_s / 10) * 6), 2);
    const back = totalOf({ print: { lights: { logH: s.logH }, enlarger: { time_s: s.time_s } } } as FrameRecipe);
    back.forEach((v, k) => expect(v).toBeCloseTo(total[k]!, 5));
  });
});

describe('the match law (guide §11): integrate-to-grey with the reference as the aim', () => {
  const ph = physics();
  const fake = (latds: Vec3[], refTotal: Vec3): { roll: Roll; recipes: Record<string, FrameRecipe> } => {
    const ids = latds.map((_, i) => `f${i}`);
    const frames: Record<string, FrameAnalysis> = {};
    const recipes: Record<string, FrameRecipe> = {};
    ids.forEach((id, i) => {
      frames[id] = { id, sha256: '0', size: [1, 1], scale: 1, layout: { rebate: null, veil: null, openGate: null, crop: null, notes: [] }, sigma: null, classes: null, latd: latds[i]!, auto: [0, 0, 0], hint: null, under: '' };
      const base = defaultRecipe('negative-scan', { sha256: String(i).padStart(64, '0'), name: id });
      const s = splitTotal(i === 0 ? refTotal : [0, 0, 0]);
      recipes[id] = { ...base, frame: id, print: { ...base.print, enlarger: { ...base.print.enlarger, mode: 'real', time_s: s.time_s }, lights: { ...base.print.lights, logH: s.logH } } };
    });
    const analysis: RollAnalysis = { at: 0, long: 512, alpha: 0.75, frames, base: { T: null, used: [], spreadD: 0, deviationD: {}, mixed: [], veil: null, veilFrames: 0, openGate: null, absD: null, flare: null, notes: [] }, ranking: null, rollMean: null, diagnostics: [] };
    return { roll: { ...newRoll('r', 'r', ids), analysis }, recipes };
  };
  let seed = 7;
  const rnd = (): number => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296 - 0.5) * 0.4;
  for (let trial = 0; trial < 20; trial++) {
    it(`trial ${trial}: α = 1 gives ℓ_ref + Δ, α = 0 gives ℓ_ref + mean(Δ)`, () => {
      const latds = Array.from({ length: 4 }, () => [rnd(), rnd(), rnd()] as Vec3);
      const refTotal = [rnd(), rnd(), rnd()] as Vec3;
      const { roll, recipes } = fake(latds, refTotal);
      const ref = totalOf(recipes['f0']!);
      for (const alpha of [1, 0, 0.45]) {
        const b = matchBatch(roll, 'f0', (f) => recipes[f], ph, { alpha });
        for (let i = 1; i < 4; i++) {
          const got = totalOf(previewOf(b, `f${i}`, recipes[`f${i}`]!));
          const D = latds[i]!.map((v, k) => v - latds[0]![k]!);
          const m = (D[0]! + D[1]! + D[2]!) / 3;
          const want = ref.map((l, k) => l + m + alpha * (D[k]! - m));
          got.forEach((v, k) => expect(v).toBeCloseTo(want[k]!, 5));
          // and it is core's integrateToGrey
          const core = integrateToGrey(latds[i]!, { latd: latds[0]!, lights: Lights.fromLogH(ref) }, alpha).logH;
          got.forEach((v, k) => expect(v).toBeCloseTo(core[k]!, 5));
        }
      }
    });
  }
});

describe('divergence (guide §6.1, §11)', () => {
  it('editing scan.flare on one frame marks exactly that frame on exactly that path; analysis writes no recipe', async () => {
    const r = await openRoll(OFFSETS.slice(0, 3));
    const rec = (f: string) => r.studio.frames.get(f)!.log.committed;
    const roll = newRoll('r', 'r', r.ids, fragmentOf(rec(r.ids[0]!)));
    expect(divergence(roll, rec)).toEqual({});
    r.studio.route.applyMutations(r.ids[1]!, [{ op: 'set', path: 'scan.flare', value: 1.2 }], 'Flare');
    expect(divergence(roll, rec)).toEqual({ 'scan.flare': [r.ids[1]] });
    const hashes = r.ids.map((f) => r.studio.frames.get(f)!.log.stateHash);
    await analyseRoll(r.studio.engine, entriesOf(r), physics());
    expect(r.ids.map((f) => r.studio.frames.get(f)!.log.stateHash)).toEqual(hashes);
  }, 60_000);
});

describe('Gold 200: the kit reports σ and class shares with their size (CHB-006 goldens)', () => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const golden = JSON.parse(readFileSync(`${root}fixtures/golden/ingest-gold200.json`, 'utf8'));
  const c1 = readdirSync(`${root}ttmp/2026/11/11`).find((d) => d.startsWith('CHB-001--'))!;
  let full: Float32Array;
  let recipe: FrameRecipe;
  beforeAll(() => {
    const src = openSourceSync(new Uint8Array(readFileSync(`${root}ttmp/2026/11/11/${c1}/sources/chromogen-studio-1.2/samples/gold200.png`)), { options: { levels: golden.decode.levels } });
    full = region(src.linear, { x: 0, y: 0, w: 1292, h: 863 }, 1292, 863, { channels: 3 });
    const base = defaultRecipe('negative-scan', { sha256: golden.sha256, name: 'gold200.png' });
    const [rx, ry, rw, rh] = golden.oriented.rebate;
    const [cx, cy, cw, ch] = golden.oriented.crop;
    recipe = { ...base, scan: { ...base.scan!, rebate: orientedToSensorBox('flipH', { x: rx, y: ry, w: rw, h: rh }, 1292, 863) }, view: { ...base.view, frame: { ...base.view.frame, crop: orientedToSensorBox('flipH', { x: cx, y: cy, w: cw, h: ch }, 1292, 863) } } };
  });
  it('with the picked boxes at full size: σ (0.0090, 0.0069, 0.0122) D, blank 21.5 %, below 7.2 % at 1090×754', () => {
    const p = analysePixels({ rgb: full, w: 1292, h: 863, scale: 1 }, recipe, physics(), { veil: false });
    expect(p.size).toEqual([1090, 754]);
    p.sigma!.forEach((s, k) => expect(Math.abs(s - golden.sigmaFull.value[k])).toBeLessThanOrEqual(golden.sigmaFull.tol));
    expect(Math.abs(p.classes!.blank - golden.classes.full.blank)).toBeLessThanOrEqual(golden.classes.full.tol);
    expect(Math.abs(p.classes!.below - golden.classes.full.below)).toBeLessThanOrEqual(golden.classes.full.tol);
    expect(dD(p.layout.rebate!.T, golden.rebateT.value)).toBeLessThan(0.0005);
  });
  it('automatic: the rebate strip, the holder veil (< 0.1 % of base), no open gate; numbers at the found image size', () => {
    const base = defaultRecipe('negative-scan', { sha256: golden.sha256, name: 'gold200.png' });
    const p = analysePixels({ rgb: full, w: 1292, h: 863, scale: 1 }, base, physics());
    expect(p.layout.rebate!.from).toBe('edge');
    expect(dD(p.layout.rebate!.T, golden.rebateT.value)).toBeLessThan(0.005);
    expect(p.layout.openGate).toBeNull();
    expect(p.layout.notes).toEqual(['W_NO_OPEN_GATE']);
    expect(Math.max(...p.layout.veil!.map((v, k) => v / p.layout.rebate!.T[k]!))).toBeLessThan(0.001);
    expect(p.size).toEqual([p.layout.crop!.w, p.layout.crop!.h]);
    // σ from the auto box agrees with the picked box's within 20 %; the size is what makes the number
    p.sigma!.forEach((s, k) => expect(Math.abs(s / golden.sigmaFull.value[k] - 1)).toBeLessThan(0.2));
    expect(canonicalJSON(p.hint)).toBe('null');
  });
});
