// The PhysicsData the GPU engine uses unless one is passed (GpuEngineOptions.data): core's interim
// data set (packages/core/data/interim), bundled by Vite so it works in a page, a worker and Vitest.
//
// SWITCH POINT (CHB-004): when the data packs land, return the pack provider here (or pass it as
// GpuEngineOptions.data). Nothing else in packages/gpu reads stock data: everything downstream takes a
// PhysicsData and goes through @chromobench/core.
import { interimFromJson, type PhysicsData } from '@chromobench/core';

const files = import.meta.glob<unknown>('../../../core/data/interim/**/*.json', { eager: true, import: 'default' });
const file = (rel: string): unknown => files[`../../../core/data/interim/${rel}`];

let cached: PhysicsData | null = null;

export function defaultPhysicsData(): PhysicsData {
  return (cached ??= interimFromJson({
    reference: file('reference.json'),
    index: file('index.json') as { stocks: string[] },
    stock: (id) => file(`stocks/${id}.json`),
  }));
}
