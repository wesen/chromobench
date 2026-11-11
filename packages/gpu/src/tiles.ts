// Tile planner (guide §5.3): tile size, halo, and which wide kernels become global fields computed
// once at reduced resolution and read by every tile through frame coordinates.
import type { Box, Diagnostic, TilePlan } from '@chromobench/contract';
import type { GpuCaps } from './device.ts';

export interface SpatialKernel {
  /** e.g. 'film.halation/bounce', 'pd.grainReduction' */
  id: string;
  /** Gaussian σ on the film, µm (radius = ⌈3σ⌉). */
  sigmaUm?: number;
  /** Box/bilateral radius on the film, µm. */
  radiusUm?: number;
  /** Radius in pixels of the evaluated grid (look operators defined in render pixels). */
  radiusPx?: number;
  /**
   * Neighbourhood passes in the same chain compound: a pass reading 2 px of a pass that read 2 px
   * needs 4. Kernels with the same `chain` sum; different chains take the max. Default 'main'.
   */
  chain?: string;
  /** May it be computed at reduced resolution (smooth result)? */
  fieldOk: boolean;
  /** Kernels sharing a field (e.g. the three halation bounces) share one downsample. */
  field?: string;
  /** Compute the field at this long side in px instead of by the σ/s ≥ 2 rule (statistics-size fields). */
  fieldLongSide?: number;
}

export interface GlobalField { field: string; kernels: string[]; downsample: number; w: number; h: number; sigmaPx: number }

export interface GpuTilePlan extends TilePlan {
  fields: GlobalField[];
  /** Size of the statistics pass, reported with every statistic. */
  stats: { w: number; h: number };
  /** Local kernels and their radius in px at full resolution. */
  local: { id: string; rPx: number; chain: string }[];
  diagnostics: Diagnostic[];
}

export interface PlanOptions {
  maxHaloPx?: number;
  minTile?: number;
  /** Bytes per pixel over the live intermediates of one tile (default 5 × rgba32float = 80). */
  bytesPerPixel?: number;
  /** Long side of the statistics pass (default 640, as in the Studio). */
  statsLongSide?: number;
  /** Halo alignment (default 8). */
  haloAlign?: number;
  /** Force a tile size (tests). */
  tile?: number;
}

type PlanCaps = Pick<GpuCaps, 'budgetBytes'> & { limits: Pick<GpuCaps['limits'], 'maxTextureDimension2D'> };

const pow2Floor = (x: number): number => 2 ** Math.floor(Math.log2(x));

function radiusPx(k: SpatialKernel, umPerPx: number): number {
  if (k.radiusPx !== undefined) return Math.ceil(k.radiusPx);
  if (k.sigmaUm !== undefined) return Math.ceil((3 * k.sigmaUm) / umPerPx);
  if (k.radiusUm !== undefined) return Math.ceil(k.radiusUm / umPerPx);
  return 0;
}

function sigmaPx(k: SpatialKernel, umPerPx: number): number {
  if (k.sigmaUm !== undefined) return k.sigmaUm / umPerPx;
  return radiusPx(k, umPerPx) / 3;
}

export function planTiles(frame: { w: number; h: number; umPerPx: number }, kernels: SpatialKernel[], caps: PlanCaps, opts: PlanOptions = {}): GpuTilePlan {
  const haloBudget = opts.maxHaloPx ?? 32;
  const maxTex = caps.limits.maxTextureDimension2D;
  const diagnostics: Diagnostic[] = [];
  const local: { id: string; rPx: number; chain: string }[] = [];
  const wide: SpatialKernel[] = [];
  for (const k of kernels) {
    const r = radiusPx(k, frame.umPerPx);
    if (r <= haloBudget || !k.fieldOk) local.push({ id: k.id, rPx: r, chain: k.chain ?? 'main' });
    else wide.push(k);
  }
  const chains = new Map<string, number>();
  for (const l of local) chains.set(l.chain, (chains.get(l.chain) ?? 0) + l.rPx);
  const reach = Math.max(0, ...chains.values());
  const align = opts.haloAlign ?? 8;
  const halo = reach === 0 ? 0 : Math.ceil((1 + reach) / align) * align; // +1 for bilinear safety

  // global fields: one per field group, downsample from the narrowest kernel in the group
  const groups = new Map<string, SpatialKernel[]>();
  for (const k of wide) {
    const g = k.field ?? k.id;
    groups.set(g, [...(groups.get(g) ?? []), k]);
  }
  const long = Math.max(frame.w, frame.h);
  const fields: GlobalField[] = [];
  for (const [g, ks] of groups) {
    const sMin = Math.min(...ks.map((k) => sigmaPx(k, frame.umPerPx)));
    let s: number;
    const fls = ks.find((k) => k.fieldLongSide !== undefined)?.fieldLongSide;
    if (fls !== undefined) s = Math.max(1, long / fls);
    else {
      s = Math.max(1, pow2Floor(sMin / 2)); // largest power of two with σ/s ≥ 2
      while (Math.ceil(frame.w / s) > maxTex || Math.ceil(frame.h / s) > maxTex) s *= 2;
    }
    fields.push({ field: g, kernels: ks.map((k) => k.id), downsample: s, w: Math.ceil(frame.w / s), h: Math.ceil(frame.h / s), sigmaPx: sMin / s });
  }

  const bpp = opts.bytesPerPixel ?? 80;
  const minTile = opts.minTile ?? 256;
  let T = opts.tile ?? 0;
  if (!T) {
    T = pow2Floor(Math.max(minTile, maxTex));
    while (T > minTile && ((T + 2 * halo) ** 2 * bpp > caps.budgetBytes / 2 || T + 2 * halo > maxTex)) T /= 2;
    // a frame smaller than one tile is one tile
    T = Math.min(T, Math.max(minTile, pow2Ceil(long)));
  }
  if ((T + 2 * halo) ** 2 * bpp > caps.budgetBytes / 2) {
    diagnostics.push({ code: 'E_GPU_OOM', message: `a ${T}-px tile with a ${halo}-px halo needs ${(T + 2 * halo) ** 2 * bpp} bytes, over half the ${caps.budgetBytes}-byte budget` });
  }
  for (const l of local) {
    const k = kernels.find((x) => x.id === l.id)!;
    if (!k.fieldOk && l.rPx > T / 4) {
      diagnostics.push({ code: 'E_HALO_TOO_WIDE', message: `${l.id} reads ${l.rPx} px, more than a quarter of the ${T}-px tile`, hint: 'use a larger budget or a field-capable kernel' });
    }
  }

  const tiles: { index: number; core: Box; read: Box }[] = [];
  const nx = Math.ceil(frame.w / T);
  const ny = Math.ceil(frame.h / T);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const core = { x: i * T, y: j * T, w: Math.min(T, frame.w - i * T), h: Math.min(T, frame.h - j * T) };
    const x0 = Math.max(0, core.x - halo);
    const y0 = Math.max(0, core.y - halo);
    const x1 = Math.min(frame.w, core.x + core.w + halo);
    const y1 = Math.min(frame.h, core.y + core.h + halo);
    tiles.push({ index: j * nx + i, core, read: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } });
  }
  const sl = opts.statsLongSide ?? 640;
  const ss = Math.min(1, sl / long);
  return {
    frame: { ...frame }, tile: T, halo, tiles, bytesPerTile: (T + 2 * halo) ** 2 * bpp,
    fields, stats: { w: Math.max(1, Math.round(frame.w * ss)), h: Math.max(1, Math.round(frame.h * ss)) },
    local, diagnostics,
  };
}

function pow2Ceil(x: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(1, x)));
}

/** Fraction of extra pixels a plan computes because of halos. */
export function haloOverhead(p: TilePlan): number {
  let core = 0;
  let read = 0;
  for (const t of p.tiles) {
    core += t.core.w * t.core.h;
    read += t.read.w * t.read.h;
  }
  return read / core - 1;
}
