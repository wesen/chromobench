// @chromobench/studio-kit — `cb`: chromobench's studio vocabulary on the CraftKit shell (CHB-019).
// Headless: nothing here touches the DOM. Renderers are '@chromobench/studio-kit/dom'.
export { createCb, current, visibleFrames, CORE_STATE, type Cb, type CbState, type CatalogFrame } from './cb.ts';
export { defineVariant, buildVariant, type VariantDef, type VariantEnv, type BuiltVariant } from './variant.ts';
export { Studio, createStudio, type StudioOptions } from './studio.ts';
export { frameRef, isImageHandle, isFrameRef, effectiveRecipe, ACCESSORS, PRINT_OPTIONS, type FrameRef, type ImageHandle, type Accessor } from './handles.ts';
export { EditLogRoute, recipePathOf, BURST_MS, type Proposal } from './bridge/editlog-route.ts';
export { Frames, type FrameEntry } from './bridge/frames.ts';
export { FrameRenderBridge, type Lowered } from './bridge/render-bridge.ts';
export { memoryKV, localStorageKV, KV_STORES, type KV, type KvStore } from './bridge/kv.ts';
export { kvPersistence } from './bridge/persistence.ts';
export { argModel, argProblem, parseEntry, parseStep, stepValue, controlModels, controlPaths, STRIPPABLE, type ArgModel } from './kit/args.ts';
export { CB_FORMS } from './kit/forms.ts';
export * as units from './model/units.ts';
export * from './model/controls.ts';
export * from './model/history.ts';
export * from './model/arrangement.ts';
export * from './model/tools.ts';
export * from './model/recipes.ts';
