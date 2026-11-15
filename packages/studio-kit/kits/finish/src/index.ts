// @chromobench/studio-kit/kits/finish — crop and straighten, heal and clone, finishing tones (CHB-022). Headless.
export { createFinishKit, type FinishKit } from './kit.ts';
export { CLARITY, cropProblem, edits, FINISH_STATE, FINISHING_PATHS, nextSpotId, removeSpots, spotData, spotsOf, stackWithSpot, withoutFinishing, type FinishView, type HealSpotData, type SpotMode, type SpotRef } from './state.ts';
export { finishPasses } from './passes.ts';
export * from './geometry.ts';
export * from './suggest.ts';
