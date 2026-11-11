// Test helpers: a started studio on MockEngine with the M1 fixture, headless.
import { makeM1Tiff, MockEngine } from '@chromobench/engine-mock';
import { manualClock, type ManualClock } from '@chromobench/shell/testing';
import type { Runtime } from '@chromobench/shell';
import { buildVariant, createStudio, memoryKV, type KV, type Studio, type VariantDef } from '../src/index.ts';
import { VARIANTS } from '../variants/index.js';

export interface Started {
  rt: Runtime;
  studio: Studio;
  clock: ManualClock;
  kv: KV;
  f: string;
}

export async function started(o: { def?: VariantDef; kv?: KV; mode?: 'ask' | 'auto' | 'read-only'; bytes?: Uint8Array; name?: string } = {}): Promise<Started> {
  const clock = manualClock(1_000);
  const kv = o.kv ?? memoryKV();
  const studio = createStudio({ engine: new MockEngine(), kv, now: () => clock.now(), ...(o.mode ? { mode: o.mode } : {}) });
  const { app } = buildVariant(o.def ?? (await VARIANTS.tiny()).default);
  const rt = await app.boot(studio.services({ clock }));
  studio.attach(rt);
  const e = await studio.open(o.bytes ?? makeM1Tiff(), o.name ?? 'm1.tif');
  return { rt, studio, clock, kv, f: e.id };
}

export const recipePath = (f: string, p: string): (string | number)[] => ['recipes', f, ...p.split('.')];
