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
export { interimData } from './data/interim.ts';
export * from './print/enlarger.ts';
export * from './print/lights.ts';
export * from './print/paper.ts';
export * from './print/colour.ts';
export * from './print/gamut.ts';
export * from './scan/scanner.ts';
export * from './print/chain.ts';
