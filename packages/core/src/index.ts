// @chromobench/core — the f64 physics reference (CHB-003). Physics modules are pure functions over
// typed arrays; only engine-ref.ts and ops/ speak the contract's Engine interface.
export * from './spectral/spectrum.ts';
export * from './spectral/units.ts';
export * from './spectral/conventions.ts';
export * from './spectral/stock.ts';
export * from './spectral/linalg.ts';
export * from './spectral/channels.ts';
export * from './spectral/metamer.ts';
export * from './data/provider.ts';
// Default data: CHB-004's packs (spektrafilm + illustrative@1), served synchronously from disk in Node.
// `interimData` is kept as the old name of this default; the retired CHB-001 JSON set stays as
// `legacyInterimData` / `interimFromJson` for tests that pin it.
export { nodePhysicsData as packsData, nodePhysicsData as interimData } from '@chromobench/data/node';
export { interimData as legacyInterimData, interimFromJson, type InterimJson } from './data/interim.ts';
export * from './print/enlarger.ts';
export * from './print/lights.ts';
export * from './print/paper.ts';
export * from './print/colour.ts';
export * from './print/gamut.ts';
export * from './scan/scanner.ts';
export * from './print/chain.ts';
export * from './print/balance.ts';
export * from './scan/solve.ts';
export * from './scan/classify.ts';
export * from './scan/forward.ts';
export * from './tables/tables.ts';
export * from './tables/arrays.ts';
export {
  DEFAULT_FILM, DEFAULT_PAPER, DEFAULT_SIGMA_D, densitiesOf, developerAt, displaySetupAt, exposeSettings, filmOf, flareWhite, gradePivot, paperOf, PhysicsEnv,
  rebateBox, viewOf, whiteAt,
  type ChainCtx, type ExposeSettings, type UpNode,
} from './ops/ops.ts';
export * from './engine-ref.ts';
