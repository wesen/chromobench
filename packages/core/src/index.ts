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
// Data. Engines take a PhysicsData explicitly (RefEngineOptions.data is required). In Node, nodePacksData()
// serves CHB-004's packs (spektrafilm + illustrative@1) synchronously from packages/data/packs; in a browser
// a host loads the same packs with @chromobench/data (gpu's loadDefaultPhysicsData). The retired CHB-001 JSON
// set stays as chb001InterimData / interimFromJson for the tests that pin numbers computed on it.
export { nodePhysicsData as nodePacksData } from '@chromobench/data/node';
export { chb001InterimData, interimFromJson, type InterimJson } from './data/interim.ts';
export * from './print/enlarger.ts';
export * from './print/lights.ts';
export * from './print/paper.ts';
export * from './print/colour.ts';
export * from './print/gamut.ts';
export * from './scan/scanner.ts';
export * from './print/chain.ts';
export * from './print/balance.ts';
export * from './print/masks.ts';
export * from './print/exposures.ts';
export * from './print/densityMask.ts';
export * from './print/retouch.ts';
export * from './scan/solve.ts';
export * from './scan/classify.ts';
export * from './scan/forward.ts';
export * from './tables/tables.ts';
export * from './tables/arrays.ts';
export {
  DEFAULT_FILM, DEFAULT_PAPER, DEFAULT_SIGMA_D, densitiesOf, developerAt, displaySetupAt, exposeSettings, filmOf, flareWhite, gradePivot, paperOf, PhysicsEnv,
  clearExposure, flashExposure, isCapture, rebateBox, viewOf, whiteAt,
  type ChainCtx, type ExposeSettings, type UpNode,
} from './ops/ops.ts';
export * from './film/upsample.ts';
export * from './film/expose.ts';
export * from './film/camera.ts';
export * from './film/curves.ts';
export * from './film/couple.ts';
export * from './film/blur.ts';
export * from './film/halation.ts';
export * from './film/rng.ts';
export * from './film/grain.ts';
export * from './film/develop.ts';
export * from './film/forward.ts';
export * from './ops/film.ts';
export * from './engine-ref.ts';
