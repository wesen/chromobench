// @chromobench/studio-kit/kits/looks — looks, presets, sync and comparison (CHB-021; CHB-037 P7: looks are links).
// Headless; renderers are ./dom.ts.
export { createLooksKit, slider, choice, type LooksKit } from './kit.ts';
export { agentBatches, looksView, amountOf, LOOKS_STATE, type LooksDoc, type LooksView, type CompareSource, type AgentBatch, type SyncMode } from './state.ts';
export { defaultsOf } from './model.ts';
export * from './engine/looks.ts';
export * from './engine/describe.ts';
export * from './engine/paths.ts';
export * from './engine/diff.ts';
export * from './engine/groups.ts';
export * from './engine/sweep.ts';
export * from './engine/files.ts';
