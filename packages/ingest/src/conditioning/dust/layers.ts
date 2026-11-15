// Dust as scan-stage heal layers (CHB-037 P5b-1; CHB-035 design 01 v2 §23: `scan.dust.spots[]` → heal layers in a
// group "Dust"). Detection is detectSpecks on the scan's density planes; each speck becomes one spot of the
// catalogue's `heal` op with an explicit source: the healed pixels are a document edit the photographer sees,
// toggles and removes, not pixels changed at decode. Coordinates are document px (pixel centres at i + 0.5) of the
// image the spots were found on.
import { groupEntry, layerEntry, type Group, type Params, type Vec3 } from '@chromobench/contract';
import { Coll } from '@chromobench/values';
import { sigmaD } from '../sigma.ts';
import { detectSpecks, type DustSpot, type SpeckOptions } from './specks.ts';

/** One spot of a heal (or clone) layer, as the catalogue's `heal.spots` stores it (document px). */
export interface HealSpot {
  x: number;
  y: number;
  r: number;
  src: { x: number; y: number };
  feather: number;
  opacity: number;
}

export interface DustOptions extends SpeckOptions {
  /** Scanner noise σ per channel, D; default: measured (sigmaD), else `fallbackSigma`. */
  sigma?: Vec3;
  /** σ when it cannot be measured (core's DEFAULT_SIGMA_D). */
  fallbackSigma?: Vec3;
  /** Specks below this score are left alone (default 0.5, check.dust's threshold). */
  minScore?: number;
  /** Soft edge of each spot as a fraction of r (default 0.3). */
  feather?: number;
}

const FALLBACK_SIGMA: Vec3 = [0.0043, 0.0033, 0.0057];

/** Scanner density planes of a linear RGB scan against the base transmittance (D = −log10(T / T_base)). */
export function densityPlanes(rgb: Float32Array, w: number, h: number, Treb: Vec3): Float32Array[] {
  const n = w * h;
  return [0, 1, 2].map((k) => {
    const p = new Float32Array(n);
    for (let i = 0; i < n; i++) p[i] = -Math.log10(Math.max(rgb[i * 3 + k]!, 1e-6) / Treb[k]!);
    return p;
  });
}

/** Mean and variance of the neutral density (channel mean) over a disc, or within an annulus [r0, r1). */
function stats(D: Float32Array[], W: number, H: number, cx: number, cy: number, r0: number, r1: number, skip?: (x: number, y: number) => boolean): { mean: number; v: number; n: number } {
  let s = 0, s2 = 0, n = 0;
  for (let y = Math.max(0, Math.floor(cy - r1)); y <= Math.min(H - 1, Math.ceil(cy + r1)); y++) {
    for (let x = Math.max(0, Math.floor(cx - r1)); x <= Math.min(W - 1, Math.ceil(cx + r1)); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d < r0 || d >= r1 || skip?.(x, y)) continue;
      const i = y * W + x;
      const v = (D[0]![i]! + D[1]![i]! + D[2]![i]!) / 3;
      s += v;
      s2 += v * v;
      n++;
    }
  }
  const mean = n ? s / n : 0;
  return { mean, v: n ? Math.max(0, s2 / n - mean * mean) : Infinity, n };
}

/**
 * A source for each target spot: candidates on rings around it (8 directions, at 2.5 r … 6 r), inside the image and
 * clear of every target; the chosen patch is the flattest whose mean density matches the target's surroundings
 * (a small penalty for distance). A target with no clear candidate is left out (null).
 */
export function chooseSources(D: Float32Array[], W: number, H: number, targets: readonly { x: number; y: number; r: number }[]): ({ x: number; y: number } | null)[] {
  const inTarget = (x: number, y: number): boolean => targets.some((t) => Math.hypot(x + 0.5 - t.x, y + 0.5 - t.y) < t.r);
  return targets.map((t) => {
    const ring = stats(D, W, H, t.x, t.y, t.r, 1.6 * t.r + 1, inTarget);
    let best: { x: number; y: number } | null = null;
    let bestCost = Infinity;
    for (const k of [2.5, 3.5, 4.5, 6]) {
      for (let a = 0; a < 8; a++) {
        const th = (a * Math.PI) / 4;
        const x = Number((t.x + k * t.r * Math.cos(th)).toFixed(2)), y = Number((t.y + k * t.r * Math.sin(th)).toFixed(2));
        if (x - t.r < 0 || y - t.r < 0 || x + t.r > W || y + t.r > H) continue;
        if (targets.some((o) => Math.hypot(x - o.x, y - o.y) < o.r + t.r)) continue;
        const p = stats(D, W, H, x, y, 0, t.r);
        if (!p.n) continue;
        const cost = (p.v + (p.mean - ring.mean) ** 2) * (1 + 0.02 * k);
        if (cost < bestCost) [bestCost, best] = [cost, { x, y }];
      }
      // the nearest ring that has a clear candidate wins unless a farther one is much flatter
      if (best && k >= 3.5) break;
    }
    return best;
  });
}

/** Heal spots for detected specks: the speck plus a pixel of margin at full opacity, its source chosen from D. */
export function healSpotsFor(D: Float32Array[], w: number, h: number, specks: readonly Pick<DustSpot, 'cx' | 'cy' | 'r'>[], feather = 0.3): HealSpot[] {
  const targets = specks.map((s) => ({ x: Number((s.cx + 0.5).toFixed(2)), y: Number((s.cy + 0.5).toFixed(2)), r: Number(((s.r + 1) / (1 - feather)).toFixed(2)) }));
  const src = chooseSources(D, w, h, targets);
  const out: HealSpot[] = [];
  targets.forEach((t, i) => {
    const s = src[i];
    if (s) out.push({ ...t, src: s, feather, opacity: 1 });
  });
  return out;
}

/**
 * Dust of a negative scan as heal spots (what the old decode-time healDust healed into the pixels): specks in
 * scanner density against the base `Treb`, each with an explicit source. Document px of this image.
 */
export function dustSpots(rgb: Float32Array, w: number, h: number, Treb: Vec3, o: DustOptions = {}): HealSpot[] {
  const D = densityPlanes(rgb, w, h, Treb);
  const sigma = o.sigma ?? sigmaD(rgb, w, h, Treb) ?? o.fallbackSigma ?? FALLBACK_SIGMA;
  const found = detectSpecks(D, w, h, sigma, o).spots.filter((s) => s.score >= (o.minScore ?? 0.5));
  return healSpotsFor(D, w, h, found, o.feather ?? 0.3);
}

/** The id of the dust group in `stages.scan.stack`. */
export const DUST_GROUP_ID = 'dust';

/**
 * The scan stage's "Dust" group: a pass group with one heal layer per speck (`dust-1`, `dust-2`, …), made by
 * ingest's dust detection. Insert it with `insert('stages.scan.stack', DUST_GROUP_ID, dustGroup(spots))`; adjacent
 * heal layers coalesce into one node, so forty specks cost one heal.
 */
export function dustGroup(spots: readonly HealSpot[]): Group {
  const source = { kind: 'auto', by: 'ingest.dust' };
  const layers = spots.map((s, i) => {
    const id = `dust-${i + 1}`;
    const spot = { x: s.x, y: s.y, r: s.r, src: { x: s.src.x, y: s.src.y }, feather: s.feather, opacity: s.opacity };
    return [id, layerEntry('heal', { spots: Coll.of([[`${id}-s`, spot]]) as unknown as Params[string] }, { name: `Dust ${i + 1}`, source })] as const;
  });
  return groupEntry('Dust', Coll.of(layers), { source });
}
