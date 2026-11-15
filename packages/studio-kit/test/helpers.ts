// Test helpers: a started studio on MockEngine with the M1 fixture, headless. The frame's edit is its document at
// docs.<f> in the store's log; storePath(f, doc, 'main.params.time_s') is where a control writes it.
import { makeM1Tiff, MockEngine } from '@chromobench/engine-mock';
import { manualClock, type ManualClock } from '@chromobench/shell/testing';
import type { Runtime } from '@chromobench/shell';
import type { Document } from '@chromobench/contract';
import { buildLayout, createStudio, mainExposure, memoryKV, storePath, type KV, type Studio, type LayoutDef, type StudioOptions } from '../src/index.ts';
import { LAYOUTS } from '../layouts/index.js';

export interface Started {
  rt: Runtime;
  studio: Studio;
  clock: ManualClock;
  kv: KV;
  f: string;
}

/** a studio and its runtime (no frame open) */
export async function studioOnly(o: { def?: LayoutDef; kv?: KV; clock?: ManualClock } & Partial<StudioOptions> = {}): Promise<Omit<Started, 'f'>> {
  const clock = o.clock ?? manualClock(1_000);
  const kv = o.kv ?? memoryKV();
  const { def: _d, kv: _k, clock: _c, ...rest } = o;
  const studio = createStudio({ engine: new MockEngine(), kv, ...rest });
  const { app } = buildLayout(o.def ?? (await LAYOUTS.tiny()).default);
  const rt = await app.boot(studio.services({ clock }));
  studio.attach(rt);
  return { rt, studio, clock, kv };
}

export async function started(o: { def?: LayoutDef; kv?: KV; bytes?: Uint8Array; name?: string } & Partial<StudioOptions> = {}): Promise<Started> {
  const { bytes, name, ...rest } = o;
  const s = await studioOnly(rest);
  const e = await s.studio.open(bytes ?? makeM1Tiff(), name ?? 'm1.tif');
  await s.studio.flush();
  return { ...s, f: e.id };
}

/** the M1 fixture with one sample changed: another file (another hash) */
export function otherTiff(k = 1): Uint8Array {
  const b = makeM1Tiff();
  b[b.length - 2] = (b[b.length - 2]! + k) & 0xff;
  return b;
}

/** the frame's committed document */
export const docOf = (rt: Runtime, f: string): Document => rt.store.log.doc<Document>(f);
/** the frame's document as the state shows it (with a gesture's preview) */
export const shown = (rt: Runtime, f: string): Document => rt.store.peek(['docs', f]) as Document;
/** the store path of a document path of frame f */
export const at = (rt: Runtime, f: string, path: string): (string | number)[] => storePath(f, shown(rt, f), path);
/** one set on a frame's document as a transaction */
export const setDoc = (rt: Runtime, f: string, path: string, v: unknown, label = 'Set', o: Record<string, unknown> = {}): unknown =>
  rt.ctx().tx(label, (t: any) => t.$set(at(rt, f, path), v), o); // eslint-disable-line @typescript-eslint/no-explicit-any
/** the main exposure's time as committed */
export const timeOf = (rt: Runtime, f: string): number => mainExposure(docOf(rt, f)).time_s;
