// cb.kits.finish: the kit's state, spots of a recipe, the crop check and the common edits (split from kit.ts, CHB-032).
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FrameRecipe, FrameSettings, Mutation, RetouchSpot } from '@chromobench/contract';
import { centreOf, constrain, cropOf, fitCrop, frameValid, fullBox, type Pt } from './geometry.ts';

export type SpotMode = 'heal' | 'clone' | 'dust';
export interface FinishView {
  crop: { aspect: string; locked: boolean };
  spot: { mode: SpotMode; r: number; feather: number; opacity: number };
  /** the selected retouch spot (or dust spot) id */
  selected: string | null;
  /** draw every spot with its source line */
  show: boolean;
  /** before/after of the finishing set: the viewer shows the print without retouch and finishing (never committed) */
  bypass: boolean;
}
export const FINISH_STATE: { finish: FinishView } = {
  finish: { crop: { aspect: 'original', locked: true }, spot: { mode: 'heal', r: 12, feather: 0.5, opacity: 1 }, selected: null, show: true, bypass: false },
};

/** Paths the finishing panel offers: the finishing.* fields the contract compiles today (CHB-015 owns the ops). */
export const FINISHING_PATHS = ['finishing.values.clarity'] as const;

export interface DustSpot { id: string; x: number; y: number; r: number }
export interface SpotRef { id: string; kind: 'retouch' | 'dust'; mode: SpotMode; x: number; y: number; r: number; src: Pt | null; enabled: boolean }

export const plain = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** Every spot of a recipe (retouch and dust), in composite order. */
export function spotsOf(r: FrameRecipe | undefined | null): SpotRef[] {
  if (!r) return [];
  const out: SpotRef[] = [];
  for (const d of (r.scan?.dust.spots ?? []) as DustSpot[]) out.push({ id: d.id, kind: 'dust', mode: 'dust', x: d.x, y: d.y, r: d.r, src: null, enabled: true });
  const ids = Object.keys(r.retouch?.spots ?? {}).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  for (const id of ids) {
    const s = r.retouch.spots[id]!;
    out.push({ id, kind: 'retouch', mode: s.mode, x: s.x, y: s.y, r: s.r, src: s.src, enabled: s.enabled });
  }
  return out;
}
/** The next spot id: s or d plus one more than the largest counter in use. */
export function nextSpotId(r: FrameRecipe, kind: 'retouch' | 'dust'): string {
  const p = kind === 'dust' ? 'd' : 's';
  const used = kind === 'dust' ? ((r.scan?.dust.spots ?? []) as DustSpot[]).map((d) => d.id) : Object.keys(r.retouch.spots);
  const n = Math.max(0, ...used.map((id) => (id.startsWith(p) ? Number(id.slice(1)) : 0)).filter(Number.isFinite));
  return `${p}${n + 1}`;
}

/**
 * CB-F110 (finish/crop-valid, guide §9.5): a frame whose turned crop leaves the picture shows empty corners.
 * Returns the problem and the fix (the largest valid box with the same shape), or null.
 */
export function cropProblem(r: FrameRecipe, W: number, H: number): { code: 'CB-F110'; message: string; fix: FrameSettings } | null {
  const f = r.view.frame;
  if (frameValid(f, W, H)) return null;
  const fix = constrain(f, W, H);
  const b = fix.crop ?? fullBox(W, H);
  return { code: 'CB-F110', message: `the crop turned by ${f.angle_deg}° leaves the picture (empty corners)`, fix: { ...fix, crop: b } };
}

/** The agent's and the tools' common edits (guide §9.4): mutations, so a proposal is the same as a gesture. */
export const edits = {
  /** crop to an aspect at an angle, as large as fits (centre: keep the crop's) */
  crop(r: FrameRecipe, W: number, H: number, o: { aspect?: string | [number, number]; angle_deg?: number; centre?: Pt } = {}): Mutation[] {
    const f = r.view.frame;
    const centre = o.centre ?? centreOf(cropOf(f, W, H));
    const next = fitCrop(W, H, { orientation: f.orientation, angle_deg: o.angle_deg ?? f.angle_deg, aspect: o.aspect ?? 'original', centre });
    return [{ op: 'set', path: 'view.frame.angle_deg', value: next.angle_deg }, { op: 'set', path: 'view.frame.crop', value: next.crop }];
  },
  /** one spot (heal or clone), source given or found by suggestSource on a proxy */
  spot(r: FrameRecipe, s: Omit<RetouchSpot, 'enabled' | 'feather' | 'opacity'> & Partial<RetouchSpot>, id = nextSpotId(r, 'retouch')): Mutation[] {
    return [{ op: 'set', path: `retouch.spots.${id}`, value: { feather: 0.5, opacity: 1, enabled: true, ...s } }];
  },
};
