// The PhysicsData the GPU engine uses unless one is passed (GpuEngineOptions.data): CHB-004's packs
// (spektrafilm for stocks, illustrative@1 for cameras and lights).
//   Node / Vitest: read from packages/data/packs on disk, synchronously (@chromobench/data/node).
//   Browser / worker: `await loadDefaultPhysicsData()` fetches the packs from `<base>/packs/` (the
//     Vite dev servers serve packages/data/packs there, see packages/data/vite-packs.ts) and keeps them
//     in memory; `defaultPhysicsData()` is then synchronous. GpuEngine.create() does the await itself.
import { DEFAULT_SCANNER_PACK, DEFAULT_STOCK_PACK, fetchSource, openPack, physicsData } from '@chromobench/data';
import { nodePhysicsData } from '@chromobench/data/node';
import type { PhysicsData } from '@chromobench/core';

let cached: PhysicsData | null = null;
let loading: Promise<PhysicsData> | null = null;

const inNode = (): boolean => typeof process !== 'undefined' && typeof process.getBuiltinModule === 'function' && process.getBuiltinModule('node:fs') !== undefined;

/** Fetch and cache the default packs. `base` is the URL of the packs directory (default `<origin>/packs/`). */
export function loadDefaultPhysicsData(base?: string | URL): Promise<PhysicsData> {
  if (cached) return Promise.resolve(cached);
  if (inNode()) return Promise.resolve(defaultPhysicsData());
  return (loading ??= (async () => {
    const src = fetchSource(base ?? new URL('/packs/', globalThis.location?.href ?? 'http://localhost/'));
    const [stocks, scanners] = await Promise.all([openPack(src, DEFAULT_STOCK_PACK), openPack(src, DEFAULT_SCANNER_PACK)]);
    await Promise.all([stocks.preload(), scanners.preload()]);
    return (cached = physicsData(stocks, scanners));
  })());
}

export function defaultPhysicsData(): PhysicsData {
  if (cached) return cached;
  if (inNode()) return (cached = nodePhysicsData());
  throw new Error('packs are not loaded: await loadDefaultPhysicsData() first');
}
