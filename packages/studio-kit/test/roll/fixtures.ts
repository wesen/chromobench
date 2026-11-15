// Roll fixtures (CHB-020 guide §11): planted 135 strips in a holder (sprocket holes, veil, one frame with a
// mixed base), as 16-bit TIFFs a MockEngine opens; the roll physics from ingest + core; a started roll studio.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MockEngine } from '@chromobench/engine-mock';
import { writeTiff16 } from '@chromobench/ingest';
import { plantedStrip, type PlantedStrip } from '@chromobench/ingest';
import { CHROMOGEN, nodePacksData, scannerForward } from '@chromobench/core';
import { manualClock, type ManualClock } from '@chromobench/shell/testing';
import type { Runtime } from '@chromobench/shell';
import { buildLayout, createStudio, memoryKV, type Studio } from '../../src/index.ts';
import type { RollPhysics } from '../../kits/roll/src/index.ts';
import { rollPhysics } from '../../demo/roll-physics.ts';
import { LAYOUTS } from '../../layouts/index.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const laws = JSON.parse(readFileSync(`${root}fixtures/golden/ingest-laws.json`, 'utf8'));
export const STOCKS: string[] = Object.keys(laws.stockBases.D);
/** The guide's illustrative X-T5 LED scanner under Chromogen's conventions (the CHB-006 base table). */
export const physics = (): RollPhysics => rollPhysics({ fwd: scannerForward(nodePacksData(), 'xt5-rgb-led', CHROMOGEN), stocks: STOCKS });

/** base offsets 0–0.01 D and one frame (index 10) at 0.04 D: a mixed roll */
export const OFFSETS = [0, 0.002, 0.004, 0.006, 0.008, 0.01, 0.001, 0.003, 0.005, 0.007, 0.04, 0.009];

export function strip(i: number, offsetD = 0, o: { pxPerMm?: number; holder?: boolean; holes?: boolean } = {}): PlantedStrip {
  return plantedStrip({
    pxPerMm: o.pxPerMm ?? 4, seed: 101 + i, scene: i, baseOffsetD: offsetD,
    exposureD: 0.35 * Math.sin(1.7 * i), castD: [0.04 * Math.cos(i), 0, -0.03 * Math.sin(i)], sigma: [0.005, 0.004, 0.006],
    ...(o.holder !== undefined ? { holder: o.holder } : {}), ...(o.holes !== undefined ? { holes: o.holes } : {}),
  });
}
export function tiffOf(p: PlantedStrip): Uint8Array {
  const c = new Uint16Array(p.rgb.length);
  for (let i = 0; i < c.length; i++) c[i] = Math.max(0, Math.min(65535, Math.round(p.rgb[i]! * 65535)));
  return writeTiff16(p.w, p.h, c);
}

export interface RollStudio {
  studio: Studio;
  strips: PlantedStrip[];
  ids: string[];
}
export async function openRoll(offsets: number[], o: { now?: () => number } = {}): Promise<RollStudio> {
  const studio = createStudio({ engine: new MockEngine(), kv: null, ...(o.now ? { now: o.now } : {}) });
  const strips = offsets.map((d, i) => strip(i, d));
  const ids: string[] = [];
  for (const [i, s] of strips.entries()) ids.push((await studio.open(tiffOf(s), `frame-${String(i + 1).padStart(2, '0')}.tif`)).id);
  return { studio, strips, ids };
}

export interface StartedRoll extends RollStudio {
  rt: Runtime;
  clock: ManualClock;
}
/** the 'roll' layout booted headless on MockEngine with the planted frames open */
export async function startedRoll(offsets: number[]): Promise<StartedRoll> {
  const clock = manualClock(1_000);
  // a KV, as in the browser: the logs are saved (structured-cloned) on every unit
  const studio = createStudio({ engine: new MockEngine(), kv: memoryKV(), now: () => clock.now() });
  const { app } = buildLayout((await LAYOUTS.roll()).default);
  const rt = await app.boot(studio.services({ clock, rollPhysics: physics() }));
  studio.attach(rt);
  const strips = offsets.map((d, i) => strip(i, d));
  const ids: string[] = [];
  for (const [i, s] of strips.entries()) ids.push((await studio.open(tiffOf(s), `frame-${String(i + 1).padStart(2, '0')}.tif`)).id);
  return { rt, clock, studio, strips, ids };
}
